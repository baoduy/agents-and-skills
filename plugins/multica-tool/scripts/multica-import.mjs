import * as nodeFs from "node:fs";
import { listSkills, listAgents, listSquads, listRuntimes, listWorkspaceMembers, getSquadMembers, findByName, makeCli, realExec, requireAuth, resolveWorkspaceId } from "./lib.mjs";

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
  let created = 0, updated = 0;
  const existing = listAgents(cli);

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
    if (rec.instructions) common.push("--instructions", rec.instructions);
    if (rec.model) common.push("--model", rec.model);
    if (rec.thinking_level) common.push("--thinking-level", rec.thinking_level);
    if (rec.runtime_config && Object.keys(rec.runtime_config).length) common.push("--runtime-config", JSON.stringify(rec.runtime_config));
    if (Array.isArray(rec.custom_args) && rec.custom_args.length) common.push("--custom-args", JSON.stringify(rec.custom_args));
    if (rec.service_tier) common.push("--service-tier", rec.service_tier);
    const match = findByName(existing, rec.name);
    let id;
    if (match) {
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
            cli.run(["agent", "update", id, ...resolvable.flatMap((tid) => ["--public-to-member", tid])]);
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
  return { idMap, sourceIdMap, created, updated, secretsApplyFailures, avatarApplyFailures, avatarUnsupported, permissionApplyFailures, permissionUnsupported };
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
    if (!rec.instructions) continue;
    const rewritten = rewriteMentions(rec.instructions, sourceIdMap);
    if (rewritten === rec.instructions) continue;
    cli.run(["agent", "update", agentIdMap.get(rec.name), "--instructions", rewritten]);
    updated++;
  }
  return { updated };
}

export function importSquad({ cli, squad, agentIdMap, sourceIdMap }) {
  const existing = listSquads(cli);
  const leaderId = agentIdMap.get(squad.leader_name);
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
    if (present.has(memberId)) continue;
    cli.run(["squad", "member", "add", id, "--member-id", memberId, "--role", m.role, "--type", "agent"]);
  }
  return { newId: id, created, updated };
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

export function importBundle({ cli, dir, runtimeMap, fs = nodeFs }) {
  const manifest = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, "utf8"));
  const { effective, unresolved } = resolveRuntimeMap({ cli, manifest, runtimeMap });
  if (unresolved.length) {
    const detail = unresolved.map(({ srcId, provider, matchCount }) => provider
      ? `${srcId} (provider "${provider}": ${matchCount} matching runtimes in destination, expected exactly 1)`
      : `${srcId} (no provider recorded)`).join(", ");
    throw new Error(`Unmapped runtimes: ${detail} — pass --runtime-map, aborting before any write`);
  }

  const skillRes = importSkills({ cli, manifest, dir, fs });
  const agentRes = importAgents({ cli, manifest, dir, skillIdMap: skillRes.idMap, runtimeMap: effective, fs });
  // Runs after every agent exists so forward-referencing mentions resolve.
  const mentionRes = rewriteAgentMentions({ cli, manifest, dir, agentIdMap: agentRes.idMap, sourceIdMap: agentRes.sourceIdMap, fs });
  const squadIdMap = new Map();
  let squadsCreated = 0, squadsUpdated = 0;
  for (const squad of manifest.squads ?? []) {
    const r = importSquad({ cli, squad, agentIdMap: agentRes.idMap, sourceIdMap: agentRes.sourceIdMap });
    squadIdMap.set(squad.name, r.newId);
    squadsCreated += r.created;
    squadsUpdated += r.updated;
  }

  return {
    created: { skills: skillRes.created, agents: agentRes.created, squads: squadsCreated },
    updated: { skills: skillRes.updated, agents: agentRes.updated, squads: squadsUpdated },
    mentionsRewritten: mentionRes.updated,
    skillIdMap: Object.fromEntries(skillRes.idMap),
    agentIdMap: Object.fromEntries(agentRes.idMap),
    squadIdMap: Object.fromEntries(squadIdMap),
    secretsReminder: (manifest.agents ?? []).filter((a) => a.had_secrets).map((a) => a.name),
    secretsApplyFailures: agentRes.secretsApplyFailures,
    avatarApplyFailures: agentRes.avatarApplyFailures,
    avatarUnsupported: agentRes.avatarUnsupported,
    permissionApplyFailures: agentRes.permissionApplyFailures,
    permissionUnsupported: agentRes.permissionUnsupported,
  };
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

  if (!dir || !workspace) {
    console.error("Usage: multica-import.mjs --dir <folder> --workspace <name> [--runtime-map <src=dst,...>]");
    process.exit(1);
  }

  requireAuth(realExec);
  const resolver  = makeCli(realExec);
  const wsId      = resolveWorkspaceId(resolver, workspace);
  const cli       = makeCli(realExec, { workspaceId: wsId });
  const runtimeMap = parseRuntimeMap(rawMap);

  const result = importBundle({ cli, dir, runtimeMap, fs: nodeFs });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
