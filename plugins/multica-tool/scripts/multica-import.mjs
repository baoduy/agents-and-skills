import * as nodeFs from "node:fs";
import { listSkills, listAgents, listAgentsIncludingArchived, listSquads, listRuntimes, listWorkspaceMembers, getSquadMembers, findByName, makeCli, realExec, requireAuth, resolveWorkspaceId, listProjects, getProjectResources, findByTitle, listAutopilots, getAutopilot } from "./lib.mjs";

// User-facing selectable types are agents/squads/projects/autopilots; skills follow agents.
export function parseInclude(raw) {
  const set = new Set((raw ? raw.split(",") : ["agents", "squads"]).map((s) => s.trim()).filter(Boolean));
  if (set.has("agents")) set.add("skills");
  return set;
}

// Instructions live in a sibling .md referenced by `instructions_file` (mirrors
// avatar_file). Legacy bundles carry no instructions_file and keep instructions
// inline in the JSON — fall back to that so older exports still import.
function readInstructions(fs, dir, rec) {
  if (rec.instructions_file && fs.existsSync(`${dir}/${rec.instructions_file}`)) {
    return fs.readFileSync(`${dir}/${rec.instructions_file}`, "utf8");
  }
  return rec.instructions ?? "";
}

// Relative paths of every file under root (recursing into subdirs like scripts/).
function walkSkillFiles(fs, root, rel = "") {
  const out = [];
  for (const ent of fs.readdirSync(rel ? `${root}/${rel}` : root, { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...walkSkillFiles(fs, root, r));
    else out.push(r);
  }
  return out;
}

// Pull `description:` out of a SKILL.md YAML frontmatter block.
// ponytail: single-line values only (the skill frontmatter convention); folded/multi-line YAML not handled.
function frontmatterDescription(text) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!block) return "";
  const line = block[1].split(/\r?\n/).find((l) => /^description\s*:/.test(l));
  return line ? line.replace(/^description\s*:/, "").trim().replace(/^["']|["']$/g, "") : "";
}

export function importSkills({ cli, manifest, dir, fs = nodeFs }) {
  const idMap = new Map();
  let created = 0, updated = 0;
  const existing = listSkills(cli);

  for (const s of manifest.skills) {
    const sdir = dir === "." ? s.dir : `${dir}/${s.dir}`;
    const contentPath = `${sdir}/SKILL.md`;
    const configPath = `${sdir}/config.json`;
    const config = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "{}";
    const match = findByName(existing, s.name);
    // Fall back to the SKILL.md frontmatter description when the manifest carries none.
    const fmDesc = frontmatterDescription(fs.readFileSync(contentPath, "utf8"));
    let id;
    if (match) {
      // Only fill description when the existing skill has none — don't clobber a set one.
      const desc = !match.description && fmDesc ? ["--description", fmDesc] : [];
      cli.run(["skill", "update", match.id, "--content-file", contentPath, "--config", config, ...desc]);
      id = match.id; updated++;
    } else {
      const desc = fmDesc ? ["--description", fmDesc] : [];
      const out = cli.run(["skill", "create", "--name", s.name, "--content-file", contentPath, "--config", config, ...desc]);
      id = JSON.parse(out).id; created++;
    }
    idMap.set(s.name, id);
    // upsert extra files (everything except SKILL.md and config.json), by relative path
    for (const rel of walkSkillFiles(fs, sdir)) {
      if (rel === "SKILL.md" || rel === "config.json") continue;
      cli.run(["skill", "files", "upsert", id, "--path", rel, "--content-file", `${sdir}/${rel}`]);
    }
  }
  return { idMap, created, updated };
}

// True when a resource already carries an avatar (uploaded image or emoji).
const hasAvatar = (r) => !!(r && typeof r.avatar_url === "string" && r.avatar_url);

export function importAgents({ cli, manifest, dir, skillIdMap, runtimeMap, fs = nodeFs }) {
  const idMap = new Map();
  const sourceIdMap = new Map(); // source agent id -> new agent id, for mention rewriting
  const secretsApplyFailures = [];
  const avatarApplyFailures = [];   // image upload rejected
  const avatarUnsupported = [];     // emoji avatar — no CLI setter for agents
  const permissionApplyFailures = [];  // CLI rejected --public-to-member
  const permissionUnsupported = [];    // no member target resolved in the destination
  // Lazy + memoized: destination member user_ids, only listed when an agent needs them.
  let destMemberIds = null;
  const getDestMemberIds = () => destMemberIds ??= new Set(listWorkspaceMembers(cli).map((m) => m.user_id));
  let created = 0, updated = 0, reused = 0;
  // Includes archived agents so a bundle name matching a retired agent restores
  // and reuses it instead of failing to create under the held name.
  const existing = listAgentsIncludingArchived(cli);

  for (const a of manifest.agents) {
    const rec = JSON.parse(fs.readFileSync(`${dir}/${a.file}`, "utf8"));
    const targetRuntime = runtimeMap.get(rec.source_runtime_id);
    if (!targetRuntime) throw new Error(`Unmapped runtime "${rec.source_runtime_id}" for agent "${rec.name}"`);
    // Only pass optional flags when present — `--model ""` would CLEAR the model.
    const common = [
      "--visibility", rec.visibility ?? "private",
      "--max-concurrent-tasks", String(rec.max_concurrent_tasks ?? 6),
    ];
    if (rec.description) common.push("--description", rec.description);
    const instructions = readInstructions(fs, dir, rec);
    if (instructions) common.push("--instructions", instructions);
    if (rec.model) common.push("--model", rec.model);
    if (rec.thinking_level) common.push("--thinking-level", rec.thinking_level);
    if (rec.runtime_config && Object.keys(rec.runtime_config).length) common.push("--runtime-config", JSON.stringify(rec.runtime_config));
    if (Array.isArray(rec.custom_args) && rec.custom_args.length) common.push("--custom-args", JSON.stringify(rec.custom_args));
    if (rec.service_tier) common.push("--service-tier", rec.service_tier);
    const match = findByName(existing, rec.name);
    let id;
    if (match && match.archived_at) {
      // Restored agent then updated exactly like an active-name match — the
      // matched id is now active, so a re-import of this bundle will find it
      // via the plain `match` branch below and never restore twice.
      cli.run(["agent", "restore", match.id]);
      cli.run(["agent", "update", match.id, "--runtime-id", targetRuntime, ...common]);
      id = match.id; reused++;
    } else if (match) {
      cli.run(["agent", "update", match.id, "--runtime-id", targetRuntime, ...common]);
      id = match.id; updated++;
    } else {
      const out = cli.run(["agent", "create", "--name", rec.name, "--runtime-id", targetRuntime, ...common]);
      id = JSON.parse(out).id; created++;
    }
    idMap.set(rec.name, id);
    if (rec.source_id) sourceIdMap.set(rec.source_id, id);
    const skillIds = (rec.skill_names ?? []).map((n) => skillIdMap.get(n)).filter(Boolean);
    cli.run(["agent", "skills", "set", id, "--skill-ids", skillIds.join(",")]);

    // Avatar: only ever set it when the target agent has none — never clobber an
    // avatar an existing agent already has. Agents accept only image uploads
    // (`agent avatar --file`); an emoji-only avatar can't be restored via the CLI.
    if (!hasAvatar(match)) {
      if (rec.avatar_file) {
        try {
          cli.run(["agent", "avatar", id, "--file", `${dir}/${rec.avatar_file}`]);
        } catch {
          avatarApplyFailures.push(rec.name);
        }
      } else if (typeof rec.avatar_url === "string" && rec.avatar_url.startsWith("emoji:")) {
        avatarUnsupported.push(rec.name);
      }
    }

    // Restore member-specific public_to sharing that --visibility can't express.
    // (private and workspace-wide public_to already round-trip via --visibility.)
    if (rec.permission_mode === "public_to") {
      const memberTargets = (rec.invocation_targets ?? []).filter((t) => t.target_type === "user");
      if (memberTargets.length) {
        const resolvable = memberTargets.map((t) => t.target_id).filter((tid) => getDestMemberIds().has(tid));
        if (!resolvable.length) {
          permissionUnsupported.push(rec.name);
        } else {
          try {
            cli.run(["agent", "update", id, "--permission-mode", "public_to", ...resolvable.flatMap((tid) => ["--public-to-member", tid])]);
          } catch {
            permissionApplyFailures.push(rec.name);
          }
        }
      }
    }

    // mcp_config/custom_env carry real secrets. Each is applied via its OWN
    // follow-up call, never bundled into the create/update call above — that
    // keeps a rejected secret from failing the whole agent create/update, and
    // sidesteps the fact that only one stdin payload can be read per process
    // anyway. `agent update --mcp-config-stdin` works on a freshly-created id
    // too, so no create/update branching is needed here.
    const hasMcpConfig = rec.mcp_config && Object.keys(rec.mcp_config).length > 0;
    if (hasMcpConfig) {
      try {
        cli.run(["agent", "update", id, "--mcp-config-stdin"], { input: JSON.stringify(rec.mcp_config) });
      } catch {
        secretsApplyFailures.push(rec.name);
      }
    }
    // custom_env has no flag on `agent update` at all — `agent env set` is the
    // only way to set it on an existing agent, so it's always a follow-up call.
    const hasCustomEnv = rec.custom_env && Object.keys(rec.custom_env).length > 0;
    if (hasCustomEnv) {
      try {
        cli.run(["agent", "env", "set", id, "--custom-env-stdin"], { input: JSON.stringify(rec.custom_env) });
      } catch {
        secretsApplyFailures.push(rec.name);
      }
    }
  }
  return { idMap, sourceIdMap, created, updated, reused, secretsApplyFailures, avatarApplyFailures, avatarUnsupported, permissionApplyFailures, permissionUnsupported };
}

// Rewrites `mention://agent/<id>` links (e.g. `[@dev-backend](mention://agent/<id>)`)
// from a source-workspace agent id to its id in the destination workspace.
// Mentions with no entry in idMap (agent outside this bundle) are left as-is.
const MENTION_RE = /mention:\/\/agent\/([^)\s]+)/g;

export function rewriteMentions(text, idMap) {
  if (!text) return text;
  return text.replace(MENTION_RE, (full, oldId) => {
    const newId = idMap.get(oldId);
    return newId ? `mention://agent/${newId}` : full;
  });
}

// Second pass over agent instructions: an agent's instructions may @mention a
// sibling agent from the same bundle by its SOURCE id, which is only knowable
// once every agent in the bundle has been created/updated (idMap complete) —
// so this must run after the importAgents loop above, not inside it.
export function rewriteAgentMentions({ cli, manifest, dir, agentIdMap, sourceIdMap, fs = nodeFs }) {
  let updated = 0;
  for (const a of manifest.agents) {
    const rec = JSON.parse(fs.readFileSync(`${dir}/${a.file}`, "utf8"));
    const instructions = readInstructions(fs, dir, rec);
    if (!instructions) continue;
    const rewritten = rewriteMentions(instructions, sourceIdMap);
    if (rewritten === instructions) continue;
    cli.run(["agent", "update", agentIdMap.get(rec.name), "--instructions", rewritten]);
    updated++;
  }
  return { updated };
}

export function importSquad({ cli, squad, agentIdMap, sourceIdMap }) {
  const existing = listSquads(cli);
  const leaderId = agentIdMap.get(squad.leader_name);
  if (!leaderId) return { skipped: true, created: 0, updated: 0 };
  const match = findByName(existing, squad.name);
  let id, created = 0, updated = 0;
  // Squad instructions commonly list @mentions of teammate agents by their
  // SOURCE id — rewrite to the destination ids before the squad is created.
  const instructions = sourceIdMap ? rewriteMentions(squad.instructions, sourceIdMap) : squad.instructions;
  const instr = instructions ? ["--instructions", instructions] : [];
  if (match) {
    cli.run(["squad", "update", match.id, "--leader", leaderId, "--description", squad.description ?? "", ...instr]);
    id = match.id; updated++;
  } else {
    const out = cli.run(["squad", "create", "--name", squad.name, "--leader", leaderId, "--description", squad.description ?? "", ...instr]);
    id = JSON.parse(out).id; created++;
  }
  // Avatar: squads accept only an avatar-url string (emoji or URL) via
  // `squad update`. Set it only when the target squad has none — never clobber
  // an existing squad's avatar.
  if (!hasAvatar(match) && squad.avatar_url) {
    cli.run(["squad", "update", id, "--avatar-url", squad.avatar_url]);
  }

  // Add non-leader members, skipping any already present so re-runs are idempotent.
  const present = new Set(getSquadMembers(cli, id).map((m) => m.member_id));
  for (const m of squad.members) {
    if (m.agent_name === squad.leader_name) continue;
    const memberId = agentIdMap.get(m.agent_name);
    if (!memberId || present.has(memberId)) continue;
    cli.run(["squad", "member", "add", id, "--member-id", memberId, "--role", m.role, "--type", "agent"]);
  }
  return { newId: id, created, updated };
}

export function importProjects({ cli, manifest, dir, agentIdMap, fs = nodeFs }) {
  const idMap = new Map();
  let created = 0, updated = 0;
  const priorityUnsupported = [], resourcesUnsupported = [], leadUnresolved = [];
  const existing = listProjects(cli);
  // Lead resolves against just-imported agents first, then destination agents.
  let destAgentNames = null;
  const leadResolvable = (name) =>
    agentIdMap.has(name) || (destAgentNames ??= new Set(listAgents(cli).map((a) => a.name))).has(name);

  for (const entry of manifest.projects ?? []) {
    const rec = JSON.parse(fs.readFileSync(`${dir}/${entry.file}`, "utf8"));
    const flags = ["--title", rec.title];
    if (rec.description) flags.push("--description", rec.description);
    if (rec.icon) flags.push("--icon", rec.icon);
    if (rec.status) flags.push("--status", rec.status);
    if (rec.due_date) flags.push("--due-date", rec.due_date);
    if (rec.start_date) flags.push("--start-date", rec.start_date);
    const wantsLead = rec.lead_type === "agent" && !!rec.lead_name;
    const leadOk = wantsLead && leadResolvable(rec.lead_name);
    if (leadOk) flags.push("--lead", rec.lead_name);

    const match = findByTitle(existing, rec.title);
    let id;
    if (match) {
      cli.run(["project", "update", match.id, ...flags]);
      id = match.id; updated++;
    } else {
      id = JSON.parse(cli.run(["project", "create", ...flags])).id;
      created++;
    }
    idMap.set(rec.title, id);

    if (wantsLead && !leadOk) leadUnresolved.push(rec.title);
    if (rec.priority && rec.priority !== "none") priorityUnsupported.push(rec.title);

    // Resources: recreate github_repo only, idempotent by url.
    const existingUrls = new Set(
      getProjectResources(cli, id).filter((r) => r.resource_type === "github_repo").map((r) => r.resource_ref?.url).filter(Boolean),
    );
    for (const r of rec.resources ?? []) {
      if (r.resource_type !== "github_repo") { resourcesUnsupported.push(`${rec.title}:${r.resource_type}`); continue; }
      const url = r.resource_ref?.url;
      if (!url || existingUrls.has(url)) continue;
      cli.run(["project", "resource", "add", id, "--type", "github_repo", "--url", url, ...(r.label ? ["--label", r.label] : [])]);
      existingUrls.add(url);
    }
  }
  return { idMap, created, updated, priorityUnsupported, resourcesUnsupported, leadUnresolved };
}

// `autopilot create`/`update` only accept `--agent` (name or ID) — there is no
// `--squad` flag, even though the data model supports squad-assigned autopilots
// (dispatch resolves to the squad leader). A squad assignee, or an agent name not
// resolvable in this import or the destination, is reported up front so the whole
// import aborts before any write — mirroring the unmapped-runtime guard above,
// never silently dropped or reassigned to the wrong agent.
function unresolvedAutopilotAssignees({ cli, manifest, recs, agentIdMap }) {
  let destAgentNames = null;
  const agentResolvable = (name) => agentIdMap.has(name) || (destAgentNames ??= new Set(listAgents(cli).map((a) => a.name))).has(name);
  const unresolved = [];
  for (const rec of recs) {
    if (rec.assignee_type === "squad") {
      unresolved.push(`"${rec.title}" → squad "${rec.assignee_name}" (the multica CLI has no command to assign a squad to an autopilot)`);
    } else if (!agentResolvable(rec.assignee_name)) {
      unresolved.push(`"${rec.title}" → agent "${rec.assignee_name}" (not found in this import or the destination workspace)`);
    }
  }
  return unresolved;
}

export function importAutopilots({ cli, manifest, dir, agentIdMap, fs = nodeFs }) {
  const entries = manifest.autopilots ?? [];
  const recs = entries.map((entry) => JSON.parse(fs.readFileSync(`${dir}/${entry.file}`, "utf8")));

  const unresolved = unresolvedAutopilotAssignees({ cli, manifest, recs, agentIdMap });
  if (unresolved.length) {
    throw new Error(`Unresolved autopilot assignees: ${unresolved.join(", ")} — aborting before any write`);
  }

  const idMap = new Map();
  let created = 0, updated = 0;
  const projectUnresolved = [], subscribersUnresolved = [], priorityNotCaptured = [], webhookReissued = [];
  const existing = listAutopilots(cli);
  let destProjects = null;
  const resolveProjectId = (title) => (destProjects ??= listProjects(cli)).find((p) => p.title === title)?.id ?? null;
  let destMembers = null;
  const memberExists = (name) => (destMembers ??= listWorkspaceMembers(cli)).some((m) => m.name === name);

  for (const rec of recs) {
    const common = [];
    if (rec.description) common.push("--description", rec.description);
    if (rec.issue_title_template) common.push("--issue-title-template", rec.issue_title_template);
    // priority is never present today — the multica CLI/API accepts it on write but
    // never returns it on read, so export can't capture the source's real value.
    if (rec.priority && rec.priority !== "none") common.push("--priority", rec.priority);
    else priorityNotCaptured.push(rec.title);

    if (rec.project_title) {
      const projectId = resolveProjectId(rec.project_title);
      if (projectId) common.push("--project", projectId);
      else projectUnresolved.push(rec.title);
    }

    const wantedSubscribers = rec.subscriber_names ?? [];
    const resolvableSubscribers = wantedSubscribers.filter(memberExists);
    subscribersUnresolved.push(...wantedSubscribers.filter((n) => !memberExists(n)).map((n) => `${rec.title}:${n}`));
    if (resolvableSubscribers.length) common.push(...resolvableSubscribers.flatMap((n) => ["--subscriber", n]));

    const match = findByTitle(existing, rec.title);
    let id;
    if (match) {
      cli.run(["autopilot", "update", match.id, "--agent", rec.assignee_name, "--mode", rec.execution_mode, ...common]);
      id = match.id; updated++;
    } else {
      const out = cli.run(["autopilot", "create", "--title", rec.title, "--agent", rec.assignee_name, "--mode", rec.execution_mode, ...common]);
      id = JSON.parse(out).id;
      // Always arrives paused, regardless of source status — activation is a
      // deliberate follow-up action, never automatic on import.
      cli.run(["autopilot", "update", id, "--status", "paused"]);
      created++;
    }
    idMap.set(rec.title, id);

    // Triggers are additive and idempotent by kind+label — a re-import never
    // duplicates a trigger already present on the matched autopilot. Webhook
    // triggers are always reissued fresh (new secret), never copied from the bundle.
    const existingTriggers = match ? getAutopilot(cli, id).triggers : [];
    const present = new Set(existingTriggers.map((t) => `${t.kind}:${t.label ?? ""}`));
    for (const t of rec.triggers ?? []) {
      if (present.has(`${t.kind}:${t.label ?? ""}`)) continue;
      const flags = ["--kind", t.kind];
      if (t.kind === "schedule") {
        flags.push("--cron", t.cron_expression);
        if (t.timezone) flags.push("--timezone", t.timezone);
      }
      if (t.label) flags.push("--label", t.label);
      cli.run(["autopilot", "trigger-add", id, ...flags]);
      if (t.kind === "webhook") webhookReissued.push(rec.title);
    }
  }
  return { idMap, created, updated, projectUnresolved, subscribersUnresolved, priorityNotCaptured, webhookReissued };
}

export function collectSourceRuntimes(manifest) {
  return [...new Set((manifest.agents ?? []).map((a) => a.source_runtime_id).filter(Boolean))];
}

// source_runtime_id -> provider (e.g. "claude", "opencode"), from whichever agent recorded it.
function collectRuntimeProviders(manifest) {
  const map = new Map();
  for (const a of manifest.agents ?? []) {
    if (a.source_runtime_id && a.source_runtime_provider && !map.has(a.source_runtime_id)) {
      map.set(a.source_runtime_id, a.source_runtime_provider);
    }
  }
  return map;
}

// Starts from the explicit --runtime-map (always wins), then auto-resolves any
// remaining source runtime by provider — only when exactly one destination
// runtime shares that provider. Ambiguous (0 or 2+ matches) stays unresolved.
export function resolveRuntimeMap({ cli, manifest, runtimeMap }) {
  const effective = new Map(runtimeMap);
  const missing = collectSourceRuntimes(manifest).filter((r) => !effective.has(r));
  if (!missing.length) return { effective, unresolved: [] };

  const providers = collectRuntimeProviders(manifest);
  const resolvable = missing.filter((r) => providers.has(r));
  const destRuntimes = resolvable.length ? listRuntimes(cli) : [];
  const unresolved = [];
  for (const srcId of missing) {
    const provider = providers.get(srcId);
    const matches = provider ? destRuntimes.filter((r) => r.provider === provider) : [];
    if (matches.length === 1) effective.set(srcId, matches[0].id);
    else unresolved.push({ srcId, provider, matchCount: matches.length });
  }
  return { effective, unresolved };
}

export function importBundle({ cli, dir, runtimeMap, include, fs = nodeFs }) {
  const inc = include ?? new Set(["skills", "agents", "squads"]);
  const manifest = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, "utf8"));

  let effective = new Map();
  if (inc.has("agents")) {
    const r = resolveRuntimeMap({ cli, manifest, runtimeMap });
    if (r.unresolved.length) {
      const detail = r.unresolved.map(({ srcId, provider, matchCount }) => provider
        ? `${srcId} (provider "${provider}": ${matchCount} matching runtimes in destination, expected exactly 1)`
        : `${srcId} (no provider recorded)`).join(", ");
      throw new Error(`Unmapped runtimes: ${detail} — pass --runtime-map, aborting before any write`);
    }
    effective = r.effective;
  }

  const skillRes = inc.has("skills")
    ? importSkills({ cli, manifest, dir, fs })
    : { idMap: new Map(), created: 0, updated: 0 };
  const agentRes = inc.has("agents")
    ? importAgents({ cli, manifest, dir, skillIdMap: skillRes.idMap, runtimeMap: effective, fs })
    : { idMap: new Map(), sourceIdMap: new Map(), created: 0, updated: 0, reused: 0, secretsApplyFailures: [], avatarApplyFailures: [], avatarUnsupported: [], permissionApplyFailures: [], permissionUnsupported: [] };
  // Runs after every agent exists so forward-referencing mentions resolve.
  const mentionRes = inc.has("agents")
    ? rewriteAgentMentions({ cli, manifest, dir, agentIdMap: agentRes.idMap, sourceIdMap: agentRes.sourceIdMap, fs })
    : { updated: 0 };

  const squadIdMap = new Map();
  let squadsCreated = 0, squadsUpdated = 0;
  const squadsSkipped = [];
  if (inc.has("squads")) {
    for (const squad of manifest.squads ?? []) {
      squad.instructions = readInstructions(fs, dir, squad);
      const r = importSquad({ cli, squad, agentIdMap: agentRes.idMap, sourceIdMap: agentRes.sourceIdMap });
      if (r.skipped) { squadsSkipped.push(squad.name); continue; }
      squadIdMap.set(squad.name, r.newId);
      squadsCreated += r.created;
      squadsUpdated += r.updated;
    }
  }

  let projectRes = { idMap: new Map(), created: 0, updated: 0, priorityUnsupported: [], resourcesUnsupported: [], leadUnresolved: [] };
  if (inc.has("projects")) {
    projectRes = importProjects({ cli, manifest, dir, agentIdMap: agentRes.idMap, fs });
  }

  let autopilotRes = { idMap: new Map(), created: 0, updated: 0, projectUnresolved: [], subscribersUnresolved: [], priorityNotCaptured: [], webhookReissued: [] };
  if (inc.has("autopilots")) {
    autopilotRes = importAutopilots({ cli, manifest, dir, agentIdMap: agentRes.idMap, fs });
  }

  return {
    include: [...inc],
    created: { skills: skillRes.created, agents: agentRes.created, squads: squadsCreated, projects: projectRes.created, autopilots: autopilotRes.created },
    updated: { skills: skillRes.updated, agents: agentRes.updated, squads: squadsUpdated, projects: projectRes.updated, autopilots: autopilotRes.updated },
    // Agents restored from archived + updated to the bundle's definition — distinct
    // from a plain update (an active-name match). Only agents can be reused today.
    reused: { agents: agentRes.reused },
    mentionsRewritten: mentionRes.updated,
    skillIdMap: Object.fromEntries(skillRes.idMap),
    agentIdMap: Object.fromEntries(agentRes.idMap),
    squadIdMap: Object.fromEntries(squadIdMap),
    projectIdMap: Object.fromEntries(projectRes.idMap),
    autopilotIdMap: Object.fromEntries(autopilotRes.idMap),
    secretsReminder: (manifest.agents ?? []).filter((a) => a.had_secrets).map((a) => a.name),
    secretsApplyFailures: agentRes.secretsApplyFailures,
    avatarApplyFailures: agentRes.avatarApplyFailures,
    avatarUnsupported: agentRes.avatarUnsupported,
    permissionApplyFailures: agentRes.permissionApplyFailures,
    permissionUnsupported: agentRes.permissionUnsupported,
    squadsSkipped,
    priorityUnsupported: projectRes.priorityUnsupported,
    resourcesUnsupported: projectRes.resourcesUnsupported,
    leadUnresolved: projectRes.leadUnresolved,
    autopilotProjectUnresolved: autopilotRes.projectUnresolved,
    autopilotSubscribersUnresolved: autopilotRes.subscribersUnresolved,
    autopilotPriorityNotCaptured: autopilotRes.priorityNotCaptured,
    autopilotWebhookReissued: autopilotRes.webhookReissued,
  };
}

export function preflight({ cli, dir, runtimeMap, include, fs = nodeFs }) {
  const inc = include ?? new Set(["skills", "agents", "squads"]);
  const manifest = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, "utf8"));
  const count = (k) => (manifest[k] ?? []).length;
  const bundle = { skills: count("skills"), agents: count("agents"), squads: count("squads"), projects: count("projects"), autopilots: count("autopilots") };
  const willImport = {
    skills: inc.has("skills") ? bundle.skills : 0,
    agents: inc.has("agents") ? bundle.agents : 0,
    squads: inc.has("squads") ? bundle.squads : 0,
    projects: inc.has("projects") ? bundle.projects : 0,
    autopilots: inc.has("autopilots") ? bundle.autopilots : 0,
  };

  const incompatibilities = [];
  let runtimes = { resolved: [], unresolved: [] };
  if (inc.has("agents")) {
    const { effective, unresolved } = resolveRuntimeMap({ cli, manifest, runtimeMap });
    runtimes = {
      resolved: [...effective.entries()].map(([s, d]) => `${s}=${d}`),
      unresolved: unresolved.map((u) => u.srcId),
    };
    for (const u of unresolved) {
      incompatibilities.push({ type: "unmapped-runtime", detail: u.provider
        ? `${u.srcId} (provider "${u.provider}": ${u.matchCount} matches, expected 1)`
        : `${u.srcId} (no provider recorded)` });
    }

    // Read-only check, mirrors importAgents' restore-and-reuse match — never
    // calls restore itself, just reports what a real import would do.
    const existingAgents = listAgentsIncludingArchived(cli);
    for (const a of manifest.agents ?? []) {
      const match = findByName(existingAgents, a.name);
      if (match && match.archived_at) {
        incompatibilities.push({ type: "agent-archived-will-restore", detail: `${a.name} (archived in destination — import would restore and reuse it)` });
      }
    }
  }

  if (inc.has("projects")) {
    const bundleAgentNames = new Set((manifest.agents ?? []).map((a) => a.name));
    for (const entry of manifest.projects ?? []) {
      const rec = JSON.parse(fs.readFileSync(`${dir}/${entry.file}`, "utf8"));
      if (rec.priority && rec.priority !== "none") {
        incompatibilities.push({ type: "priority-not-settable", detail: `${rec.title} (priority "${rec.priority}")` });
      }
      for (const r of rec.resources ?? []) {
        if (r.resource_type !== "github_repo") {
          incompatibilities.push({ type: "resource-not-portable", detail: `${rec.title} (${r.resource_type})` });
        }
      }
      const leadAvailable = inc.has("agents") && bundleAgentNames.has(rec.lead_name);
      if (rec.lead_type === "agent" && rec.lead_name && !leadAvailable) {
        incompatibilities.push({ type: "lead-agent-missing", detail: `${rec.title} → ${rec.lead_name} (ensure this agent exists in the destination)` });
      }
    }
  }

  if (inc.has("autopilots")) {
    const bundleAgentNames = new Set((manifest.agents ?? []).map((a) => a.name));
    let destAgentNames = null;
    const agentAvailable = (name) => (inc.has("agents") && bundleAgentNames.has(name))
      || (destAgentNames ??= new Set(listAgents(cli).map((a) => a.name))).has(name);
    let destProjectTitles = null;
    const projectAvailable = (title) => (destProjectTitles ??= new Set(listProjects(cli).map((p) => p.title))).has(title);

    for (const entry of manifest.autopilots ?? []) {
      const rec = JSON.parse(fs.readFileSync(`${dir}/${entry.file}`, "utf8"));
      if (rec.assignee_type === "squad") {
        incompatibilities.push({ type: "autopilot-squad-assignee-unsupported", detail: `${rec.title} → squad "${rec.assignee_name}" (the multica CLI has no command to assign a squad to an autopilot)` });
      } else if (!agentAvailable(rec.assignee_name)) {
        incompatibilities.push({ type: "autopilot-assignee-missing", detail: `${rec.title} → agent "${rec.assignee_name}" (ensure this agent exists in the destination or is included in this import)` });
      }
      if (!rec.priority) {
        incompatibilities.push({ type: "autopilot-priority-not-captured", detail: `${rec.title} (the multica CLI/API never returns an autopilot's priority, so export could not capture it)` });
      }
      if (rec.project_title && !projectAvailable(rec.project_title)) {
        incompatibilities.push({ type: "autopilot-project-missing", detail: `${rec.title} → project "${rec.project_title}" (not found in the destination)` });
      }
      if (rec.had_webhook_trigger) {
        incompatibilities.push({ type: "autopilot-webhook-reissued", detail: `${rec.title} (webhook trigger will get a newly issued URL — the old one never travels)` });
      }
    }
  }

  const secretsReminder = (manifest.agents ?? []).filter((a) => a.had_secrets).map((a) => a.name);
  return { bundle, willImport, runtimes, incompatibilities, secretsReminder };
}

function parseRuntimeMap(raw) {
  // Parse "srcId1=dstId1,srcId2=dstId2" into a Map.
  const map = new Map();
  if (!raw) return map;
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return map;
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

  const dir       = get("--dir");
  const workspace = get("--workspace");
  const rawMap    = get("--runtime-map");
  const rawInclude = get("--include");
  const dryRun    = args.includes("--dry-run");

  if (!dir || !workspace) {
    console.error("Usage: multica-import.mjs --dir <folder> --workspace <name> [--runtime-map <src=dst,...>] [--include <csv>] [--dry-run]");
    process.exit(1);
  }

  requireAuth(realExec);
  const resolver  = makeCli(realExec);
  const wsId      = resolveWorkspaceId(resolver, workspace);
  const cli       = makeCli(realExec, { workspaceId: wsId });
  const runtimeMap = parseRuntimeMap(rawMap);
  const include = parseInclude(rawInclude);

  if (dryRun) {
    console.log(JSON.stringify(preflight({ cli, dir, runtimeMap, include, fs: nodeFs }), null, 2));
    return;
  }
  const result = importBundle({ cli, dir, runtimeMap, include, fs: nodeFs });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
