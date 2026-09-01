import * as nodeFs from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { slugify, getSkill, getAgent, getAgentCustomEnv, getSquad, getSquadMembers, listRuntimes, listSkills, listAgents, listAgentsIncludingArchived, listSquads, listProjects, getProject, getProjectResources, listWorkspaceMembers, listAutopilots, getAutopilot, listLabels, listProperties, listWorkspaceMcpServers, listAgentMcpServers, makeCli, realExec, requireAuth, resolveWorkspaceId } from "./lib.mjs";

// Export levels for a WHOLE-WORKSPACE export, lowest tier first. A level pulls
// in its own tier plus every tier below it, so `project` is the full workspace
// and `skill` is skills alone. Single-resource exports (`--scope <type> --id`)
// ignore this and always bundle what that one resource needs.
export const LEVELS = ["skill", "agent", "squad", "project"];
export const levelRank = (level) => LEVELS.indexOf(level);
export const levelAtLeast = (level, tier) => levelRank(level) >= levelRank(tier);

const nonEmpty = (v) => v && typeof v === "object" && Object.keys(v).length > 0;

// Externalize a prose field to a sibling .md next to `jsonRel`
// (e.g. agents/x.json + ".description.md" → agents/x.description.md), and record
// the `<field>_file` pointer on `record`. Empty prose writes nothing and adds no
// key — same sibling-file pattern as avatar_file, applied uniformly to every
// resource's instructions/description so no prose is ever embedded in the JSON.
function writeSidecar(fs, outDir, jsonRel, suffix, text, record, key) {
  if (!text) return;
  const rel = jsonRel.replace(/\.json$/, suffix);
  fs.writeFileSync(`${outDir}/${rel}`, text);
  record[key] = rel;
}

// An avatar_url is either an uploaded-image URL (http[s]://…) or an inline
// "emoji:🦍" marker. Only image URLs carry bytes worth bundling; emoji markers
// are just carried as strings in the record.
const isImageAvatar = (url) => typeof url === "string" && /^https?:\/\//.test(url);

// Extension for the bundled avatar file, from the URL path; defaults to .png.
function avatarExt(url) {
  const m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url.split("/").pop() || "");
  return m ? `.${m[1].toLowerCase()}` : ".png";
}

// Synchronous binary fetch (keeps exportResource sync). Runs the download in a
// short-lived node subprocess so no top-level async is needed; returns a Buffer,
// or null on any failure (non-2xx, network error) — a missing avatar is
// non-fatal, the export continues with just the recorded avatar_url string.
export function fetchBinary(url) {
  const script = "fetch(process.argv[1]).then(r=>{if(!r.ok)process.exit(3);return r.arrayBuffer()}).then(b=>process.stdout.write(Buffer.from(b))).catch(()=>process.exit(4))";
  const res = spawnSync(process.execPath, ["-e", script, "--", url], { maxBuffer: 64 * 1024 * 1024, timeout: 15_000 });
  if (res.status !== 0 || !res.stdout?.length) return null;
  return res.stdout;
}

export function redactAgent(a) {
  // a is a normalized agent from getAgent, with `custom_env`/
  // `custom_env_fetch_failed` attached by the caller (collectAgent) — getAgent
  // itself never fetches custom_env, since it requires a separate audited call.
  const { id, has_custom_env, mcp_config_redacted, custom_env_fetch_failed, mcp_config, custom_env, skills, runtime_id, instructions, description, archived_at, ...rest } = a;
  const mcpUsable = !mcp_config_redacted && nonEmpty(mcp_config);
  const envUsable = !custom_env_fetch_failed && nonEmpty(custom_env);
  // mcp_config_redacted / custom_env_fetch_failed alone still flag hadSecrets even
  // when unusable — the user should know something was present at the source
  // but couldn't be captured, not just silently see an empty bundle.
  const hadSecrets = mcpUsable || envUsable || !!mcp_config_redacted || !!custom_env_fetch_failed;
  return {
    record: {
      ...rest,
      // source_id lets import-time mention rewriting map stale `mention://agent/<id>`
      // links (in this or another agent's/squad's instructions) to the new id.
      source_id: id,
      source_runtime_id: runtime_id,
      skill_names: [],
      mcp_config: mcpUsable ? mcp_config : null,
      custom_env: envUsable ? custom_env : null,
      had_secrets: hadSecrets,
    },
    hadSecrets,
    // instructions and description are written to sibling .md files by the caller
    // (see avatar_file), never embedded in the JSON record.
    instructions: instructions ?? "",
    description: description ?? "",
  };
}

export function buildManifest({ scope, level, sourceWorkspaceId, skills, agents, squads, projects, autopilots, labels, properties, mcpServers }) {
  const seenSkills = new Map();
  for (const s of skills) if (!seenSkills.has(s.name)) seenSkills.set(s.name, s);
  const seenAgents = new Map();
  for (const a of agents) if (!seenAgents.has(a.name)) seenAgents.set(a.name, a);
  const seenProjects = new Map();
  for (const p of projects ?? []) if (!seenProjects.has(p.title)) seenProjects.set(p.title, p);
  return {
    version: "1",
    scope,
    // null for a single-resource export; the requested tier for a workspace export.
    level: level ?? null,
    source_workspace_id: sourceWorkspaceId,
    skills: [...seenSkills.values()].map((s) => ({ name: s.name, dir: `skills/${slugify(s.name)}`, source_id: s.source_id })),
    agents: [...seenAgents.values()].map((a) => ({ name: a.name, file: `agents/${slugify(a.name)}.json`, source_id: a.source_id, source_runtime_id: a.source_runtime_id, source_runtime_provider: a.source_runtime_provider ?? null, skill_names: a.skill_names, had_secrets: !!a.had_secrets })),
    squads: (squads ?? []).map((squad) => {
      const file = `squads/${slugify(squad.name)}.json`;
      const entry = { name: squad.name, file, avatar_url: squad.avatar_url ?? null, leader_name: squad.leader_name, members: squad.members };
      // Instructions and description go to sibling .md files (see squad write
      // loop); only referenced when non-empty.
      if (squad.instructions) entry.instructions_file = file.replace(/\.json$/, ".md");
      if (squad.description) entry.description_file = file.replace(/\.json$/, ".description.md");
      return entry;
    }),
    projects: [...seenProjects.values()].map((p) => ({
      title: p.title, file: `projects/${slugify(p.title)}.json`,
      source_id: p.source_id, lead_name: p.lead_name ?? null, lead_type: p.lead_type ?? null,
    })),
    autopilots: (autopilots ?? []).map((ap) => ({
      title: ap.title, file: `autopilots/${slugify(ap.title)}.json`, source_id: ap.source_id,
      assignee_type: ap.assignee_type, assignee_name: ap.assignee_name,
      project_title: ap.project_title, had_webhook_trigger: ap.had_webhook_trigger,
    })),
    // Labels, properties and the workspace MCP roster are workspace-wide sets
    // with no per-resource file to point at, so each gets its own flat folder
    // (labels/, properties/, mcp/) and the manifest carries only a pointer plus
    // a count. Import reads the pointer, falling back to a legacy bundle's
    // inline array. `id` is dropped from labels: both labels and properties are
    // matched by NAME at the destination.
    labels_file: (labels ?? []).length ? "labels/labels.json" : null,
    labels_count: (labels ?? []).length,
    properties_file: (properties ?? []).length ? "properties/properties.json" : null,
    properties_count: (properties ?? []).length,
    mcp_servers_file: (mcpServers ?? []).length ? "mcp/servers.json" : null,
    mcp_servers_count: (mcpServers ?? []).length,
  };
}

// The payloads written to labels/, properties/ and mcp/. Kept next to
// buildManifest so the manifest pointers and the files they name can't drift.
export function buildTaxonomyFiles({ labels, properties, mcpServers }) {
  return {
    "labels/labels.json": (labels ?? []).map(({ id, ...rest }) => rest),
    "properties/properties.json": properties ?? [],
    // The server entry JSON is not readable via the CLI — only name/transport
    // travel, so import re-creates the roster as a to-do list, not a copy.
    "mcp/servers.json": (mcpServers ?? []).map(({ id, ...rest }) => rest),
  };
}

function collectSkill(cli, id, skills) {
  const s = getSkill(cli, id);
  if (!skills.has(s.name)) skills.set(s.name, s);
  return s.name;
}

// Keyed by agent id (so squad leader_id/member_id resolve to names). Stores the
// normalized agent, its redaction result, and its skill names. Returns
// `{ archived: true, name }` instead of collecting when the agent is archived —
// callers reached via a squad/project/explicit id lookup must decide how to
// handle that (the workspace-listing loop never hits this: listAgents() already
// excludes archived agents server-side).
function collectAgent(cli, id, agentsById, skills, providerById) {
  if (agentsById.has(id)) return agentsById.get(id);
  const a = getAgent(cli, id);
  if (a.archived_at) return { archived: true, name: a.name };
  a.source_runtime_provider = providerById.get(a.runtime_id) ?? null;
  a.custom_env = {};
  a.custom_env_fetch_failed = false;
  if (a.has_custom_env) {
    try {
      a.custom_env = getAgentCustomEnv(cli, id);
    } catch {
      a.custom_env_fetch_failed = true; // e.g. insufficient permission — non-fatal, warned via hadSecrets
    }
  }
  // Workspace MCP servers assigned to this agent (name + enabled). Separate from
  // `mcp_config`, which is the agent's own inline server JSON.
  try {
    a.mcp_servers = listAgentMcpServers(cli, id);
  } catch {
    a.mcp_servers = []; // e.g. insufficient permission — non-fatal
  }
  const skill_names = a.skills.map((sk) => collectSkill(cli, sk.id, skills));
  const red = redactAgent(a);
  const entry = { raw: a, red, skill_names };
  agentsById.set(id, entry);
  return entry;
}

export function exportResource({ cli, scope, level, ids, outDir, sourceWorkspaceId, fs = nodeFs, download = fetchBinary }) {
  const skills = new Map();       // name -> normalized skill
  const agentsById = new Map();   // id   -> { raw, red, skill_names }
  const squads = [];
  const projects = [];
  const autopilots = [];
  // Lazy + memoized: only fetched when an agent is actually collected (skips
  // the extra CLI call on skill-only exports).
  let providerById = null;
  const getProviderById = () => providerById ??= new Map(listRuntimes(cli).map((r) => [r.id, r.provider]));

  // Archived agents skipped anywhere below, deduped by (name, path, detail) —
  // the operator-facing "why isn't X in my bundle" report.
  const archivedAgentsSkipped = [];
  const seenArchivedSkip = new Set();
  function recordArchivedSkip(name, path, detail) {
    const key = [name, path, detail ?? ""].join("|");
    if (seenArchivedSkip.has(key)) return;
    seenArchivedSkip.add(key);
    archivedAgentsSkipped.push(detail ? { name, path, detail } : { name, path });
  }

  // Collect a squad's agents (leader + members) and return the squad bundle
  // object — or null when the leader is archived, since a squad can't import
  // without one (the whole squad is excluded from the bundle, not emitted leaderless).
  function collectOneSquad(squadId) {
    const sq = getSquad(cli, squadId);
    const leaderEntry = collectAgent(cli, sq.leader_id, agentsById, skills, getProviderById());
    if (leaderEntry.archived) {
      recordArchivedSkip(leaderEntry.name, "squad leader", sq.name);
      return null;
    }
    const allMembers = getSquadMembers(cli, squadId).filter((m) => m.member_type === "agent");
    const members = [];
    for (const m of allMembers) {
      const entry = collectAgent(cli, m.member_id, agentsById, skills, getProviderById());
      if (entry.archived) { recordArchivedSkip(entry.name, "squad member", sq.name); continue; }
      members.push(m);
    }
    const nameOf = (id) => agentsById.get(id)?.raw.name;
    return {
      name: sq.name, description: sq.description, instructions: sq.instructions, avatar_url: sq.avatar_url,
      leader_name: nameOf(sq.leader_id),
      members: members.map((m) => ({ agent_name: nameOf(m.member_id), role: m.role })),
    };
  }

  // A squad can be reached twice in one export (listed at level `squad`, then
  // again as an autopilot's assignee) — keep exactly one copy, by name.
  function pushSquad(built) {
    if (built && !squads.some((s) => s.name === built.name)) squads.push(built);
  }

  // Collect a project's portable metadata + its lead agent (bundled, like a
  // squad leader) and github_repo/other resources. An archived lead is dropped
  // (project still exports, just with no lead set) — unlike a squad, a project
  // has no hard requirement for one.
  function collectProject(id) {
    const p = getProject(cli, id);
    let lead_name = null, lead_type = p.lead_type, lead_source_id = p.lead_id;
    if (p.lead_type === "agent" && p.lead_id) {
      const entry = collectAgent(cli, p.lead_id, agentsById, skills, getProviderById());
      if (entry.archived) {
        recordArchivedSkip(entry.name, "project lead", p.title);
        lead_type = null; lead_source_id = null;
      } else {
        lead_name = entry.raw.name;
      }
    }
    return {
      title: p.title, description: p.description, icon: p.icon,
      priority: p.priority, status: p.status, due_date: p.due_date, start_date: p.start_date,
      source_id: id, lead_type, lead_name, lead_source_id,
      resources: getProjectResources(cli, id),
    };
  }

  // Collect a single autopilot. Its assignee is BUNDLED (like a squad leader or a
  // project lead) so the bundle is self-contained — import resolves the assignee
  // by name, which only works if that agent/squad travels with it or already
  // exists at the destination.
  // Webhook trigger secrets (url/token) are never read into the bundle — only
  // kind/label/enabled, matching the existing agent MCP/env redaction pattern.
  function collectOneAutopilot(autopilotId) {
    const ap = getAutopilot(cli, autopilotId);
    let assignee_name = null;
    if (ap.assignee_type === "agent") {
      try {
        const entry = collectAgent(cli, ap.assignee_id, agentsById, skills, getProviderById());
        if (entry.archived) recordArchivedSkip(entry.name, "autopilot assignee", ap.title);
        else assignee_name = entry.raw.name;
      } catch { assignee_name = null; }
    } else if (ap.assignee_type === "squad") {
      try {
        const built = collectOneSquad(ap.assignee_id);
        if (built) { pushSquad(built); assignee_name = built.name; }
      } catch { assignee_name = null; }
    }
    let project_title = null;
    if (ap.project_id) {
      try { project_title = getProject(cli, ap.project_id).title; } catch { project_title = null; }
    }
    let subscriber_names = [];
    if (ap.subscribers.length) {
      const members = listWorkspaceMembers(cli);
      subscriber_names = ap.subscribers.map((s) => members.find((m) => m.user_id === s.user_id)?.name).filter(Boolean);
    }
    return {
      title: ap.title, source_id: ap.id, description: ap.description,
      status: ap.status,
      execution_mode: ap.execution_mode, issue_title_template: ap.issue_title_template,
      priority: ap.priority, project_title, assignee_type: ap.assignee_type, assignee_name,
      subscriber_names, had_webhook_trigger: ap.triggers.some((t) => t.kind === "webhook"),
      triggers: ap.triggers.map((t) => t.kind === "webhook"
        ? { kind: "webhook", label: t.label, enabled: t.enabled }
        : { kind: t.kind, label: t.label, enabled: t.enabled, cron_expression: t.cron_expression, timezone: t.timezone }),
    };
  }

  // Labels, custom properties and the workspace MCP roster are workspace-wide,
  // not per-project — three cheap list calls, bundled only where issue-bearing
  // work travels: a single `project` export, or a workspace export at level
  // `project`. Never for a lone skill/agent/squad/autopilot.
  const wantsTaxonomy = scope === "project" || (scope === "workspace" && levelAtLeast(level, "project"));
  const labels = wantsTaxonomy ? listLabels(cli) : [];
  const properties = wantsTaxonomy ? listProperties(cli) : [];
  const mcpServers = wantsTaxonomy ? listWorkspaceMcpServers(cli) : [];

  if (scope === "skill") collectSkill(cli, ids.skillId, skills);
  else if (scope === "agent") {
    const entry = collectAgent(cli, ids.agentId, agentsById, skills, getProviderById());
    if (entry.archived) throw new Error(`Cannot export agent "${entry.name}": it is archived`);
  }
  else if (scope === "squad") pushSquad(collectOneSquad(ids.squadId));
  else if (scope === "project") projects.push(collectProject(ids.projectId));
  else if (scope === "autopilot") autopilots.push(collectOneAutopilot(ids.autopilotId));
  else if (scope === "workspace") {
    // Tiers are cumulative: every level bundles skills; `agent` and up add every
    // agent; `squad` and up add every squad; `project` adds projects + autopilots
    // (plus the taxonomy above).
    for (const s of listSkills(cli)) collectSkill(cli, s.id, skills);
    if (levelAtLeast(level, "agent")) {
      for (const a of listAgents(cli)) collectAgent(cli, a.id, agentsById, skills, getProviderById());
      // listAgents() above already excludes archived agents server-side — surface
      // that exclusion in the report too, not just the squad/project paths.
      for (const a of listAgentsIncludingArchived(cli)) {
        if (a.archived_at) recordArchivedSkip(a.name, "workspace listing");
      }
    }
    if (levelAtLeast(level, "squad")) {
      for (const sq of listSquads(cli)) pushSquad(collectOneSquad(sq.id));
    }
    if (levelAtLeast(level, "project")) {
      for (const p of listProjects(cli)) projects.push(collectProject(p.id));
      for (const ap of listAutopilots(cli)) autopilots.push(collectOneAutopilot(ap.id));
    }
  }

  // Orphan-skill cleanup: drop skills that no exported agent references via its
  // skill_names. Skipped for `scope: skill` (its one skill IS the target, not an
  // orphan) and for a workspace export at level `skill`, where the skills tier is
  // itself what was asked for.
  const pruned_skills = [];
  if (scope !== "skill" && !(scope === "workspace" && level === "skill")) {
    const referenced = new Set();
    for (const a of agentsById.values()) for (const n of a.skill_names) referenced.add(n);
    for (const name of [...skills.keys()]) {
      if (!referenced.has(name)) { pruned_skills.push(name); skills.delete(name); }
    }
  }

  const manifest = buildManifest({
    scope, level, sourceWorkspaceId,
    skills: [...skills.values()].map((s) => ({ name: s.name, source_id: s.id })),
    agents: [...agentsById.values()].map((a) => ({ name: a.raw.name, source_id: a.raw.id, source_runtime_id: a.raw.runtime_id, source_runtime_provider: a.raw.source_runtime_provider, skill_names: a.skill_names, had_secrets: a.red.hadSecrets })),
    squads,
    projects,
    autopilots,
    labels,
    properties,
    mcpServers,
  });

  const warnings = [];
  fs.mkdirSync(outDir, { recursive: true });

  for (const entry of manifest.skills) {
    const s = skills.get(entry.name);
    const dir = `${outDir}/${entry.dir}`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/SKILL.md`, s.content ?? "");
    fs.writeFileSync(`${dir}/config.json`, JSON.stringify(s.config ?? {}, null, 2));
    for (const f of s.files ?? []) {
      const target = `${dir}/${f.path}`;
      fs.mkdirSync(dirname(target), { recursive: true }); // f.path may be nested, e.g. scripts/foo.sh
      fs.writeFileSync(target, f.content ?? "");
    }
  }
  // Index agent entries by name for the manifest writing loop.
  const agentByName = new Map([...agentsById.values()].map((a) => [a.raw.name, a]));
  for (const entry of manifest.agents) {
    const { raw, red, skill_names } = agentByName.get(entry.name);
    const record = { ...red.record, skill_names };
    if (red.hadSecrets) warnings.push(raw.name);
    fs.mkdirSync(`${outDir}/agents`, { recursive: true });
    // Download an uploaded-image avatar into the bundle so import can re-upload
    // it (the only way to set an agent avatar). Emoji avatars stay as the
    // recorded avatar_url string; a failed download leaves avatar_url without a
    // file, and import simply won't restore it.
    if (isImageAvatar(record.avatar_url)) {
      const rel = entry.file.replace(/\.json$/, `.avatar${avatarExt(record.avatar_url)}`);
      const bytes = download(record.avatar_url);
      if (bytes && bytes.length) {
        fs.writeFileSync(`${outDir}/${rel}`, bytes);
        record.avatar_file = rel;
      }
    }
    // Instructions and description each live in a sibling .md for reviewability.
    writeSidecar(fs, outDir, entry.file, ".md", red.instructions, record, "instructions_file");
    writeSidecar(fs, outDir, entry.file, ".description.md", red.description, record, "description_file");
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(record, null, 2));
  }
  const squadByName = new Map(squads.map((s) => [s.name, s]));
  for (const entry of manifest.squads) {
    fs.mkdirSync(`${outDir}/squads`, { recursive: true });
    const s = squadByName.get(entry.name);
    if (entry.instructions_file) fs.writeFileSync(`${outDir}/${entry.instructions_file}`, s?.instructions ?? "");
    if (entry.description_file) fs.writeFileSync(`${outDir}/${entry.description_file}`, s?.description ?? "");
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(entry, null, 2));
  }
  const projectByTitle = new Map(projects.map((p) => [p.title, p]));
  for (const entry of manifest.projects) {
    fs.mkdirSync(`${outDir}/projects`, { recursive: true });
    const record = { ...projectByTitle.get(entry.title) };
    const desc = record.description; delete record.description;
    writeSidecar(fs, outDir, entry.file, ".description.md", desc, record, "description_file");
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(record, null, 2));
  }
  const autopilotByTitle = new Map(autopilots.map((a) => [a.title, a]));
  for (const entry of manifest.autopilots) {
    fs.mkdirSync(`${outDir}/autopilots`, { recursive: true });
    const record = { ...autopilotByTitle.get(entry.title) };
    const desc = record.description; delete record.description;
    writeSidecar(fs, outDir, entry.file, ".description.md", desc, record, "description_file");
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(record, null, 2));
  }
  // labels/, properties/, mcp/ — one flat folder per object type, matching the
  // per-type folders written above. Only written when the manifest points at them.
  const taxonomyFiles = buildTaxonomyFiles({ labels, properties, mcpServers });
  for (const rel of [manifest.labels_file, manifest.properties_file, manifest.mcp_servers_file]) {
    if (!rel) continue;
    fs.mkdirSync(`${outDir}/${dirname(rel)}`, { recursive: true });
    fs.writeFileSync(`${outDir}/${rel}`, JSON.stringify(taxonomyFiles[rel], null, 2));
  }
  fs.writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));
  return {
    manifest, warnings, pruned_skills, archivedAgentsSkipped,
    // Autopilots that were live at the source. Import always lands them paused,
    // so activation is a deliberate manual step at the destination.
    autopilotsActiveAtSource: autopilots.filter((a) => a.status === "active").map((a) => a.title),
    // Only name/transport are readable via `workspace mcp list` — the server
    // entry JSON (and any token in it) must be re-entered at the destination.
    mcpServerConfigsNotPortable: mcpServers.map((m) => m.name),
    autopilotWebhookTriggers: autopilots.filter((a) => a.had_webhook_trigger).map((a) => a.title),
    // Captured in the bundle for review, but `label create`/`update` have no
    // --description flag — flagged at export time so the gap is known before the
    // migration, not discovered at the far end.
    labelDescriptionsNotPortable: labels.filter((l) => l.description).map((l) => l.name),
  };
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

  const rawScope  = get("--scope");
  const rawLevel  = get("--level");
  const id        = get("--id");
  const out       = get("--out");
  const workspace = get("--workspace"); // optional: source workspace name

  const USAGE = "Usage: multica-export.mjs --out <dir> [--level skill|agent|squad|project] [--workspace <name>]\n" +
                "   or: multica-export.mjs --scope <skill|agent|squad|project|autopilot> --id <id> --out <dir> [--workspace <name>]\n" +
                "  --level exports the WHOLE workspace down to that tier (default: squad); --scope exports one named resource.";

  // No --scope means a whole-workspace export driven by --level (default squad).
  const scope = rawScope ?? "workspace";
  const level = scope === "workspace" ? (rawLevel ?? "squad") : null;

  if (rawScope && rawLevel) { console.error("--scope and --level are mutually exclusive.\n" + USAGE); process.exit(1); }
  if (!out || (scope !== "workspace" && !id)) { console.error(USAGE); process.exit(1); }
  if (scope === "workspace" && !LEVELS.includes(level)) {
    console.error(`Unknown level "${level}" — use ${LEVELS.join("|")}`); process.exit(1);
  }

  requireAuth(realExec);

  let sourceWorkspaceId = "";
  const resolver = makeCli(realExec);
  if (workspace) sourceWorkspaceId = resolveWorkspaceId(resolver, workspace);
  const cli = workspace ? makeCli(realExec, { workspaceId: sourceWorkspaceId }) : resolver;

  const ids = {};
  if (scope === "skill")       ids.skillId  = id;
  else if (scope === "agent")  ids.agentId  = id;
  else if (scope === "squad")  ids.squadId  = id;
  else if (scope === "project")  ids.projectId = id;
  else if (scope === "autopilot") ids.autopilotId = id;
  else if (scope === "workspace") { /* whole workspace — no id */ }
  else { console.error(`Unknown scope "${scope}" — use skill|agent|squad|project|autopilot`); process.exit(1); }

  const result = exportResource({ cli, scope, level, ids, outDir: out, sourceWorkspaceId, fs: nodeFs });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
