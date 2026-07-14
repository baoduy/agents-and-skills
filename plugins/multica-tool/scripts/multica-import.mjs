import * as nodeFs from "node:fs";
import { listSkills, listAgents, listSquads, listRuntimes, getSquadMembers, findByName, makeCli, realExec, requireAuth, resolveWorkspaceId } from "./lib.mjs";

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

export function importAgents({ cli, manifest, dir, skillIdMap, runtimeMap, fs = nodeFs }) {
  const idMap = new Map();
  let created = 0, updated = 0;
  const existing = listAgents(cli);

  for (const a of manifest.agents) {
    const rec = JSON.parse(fs.readFileSync(`${dir}/${a.file}`, "utf8"));
    const targetRuntime = runtimeMap.get(rec.sourceRuntimeId);
    if (!targetRuntime) throw new Error(`Unmapped runtime "${rec.sourceRuntimeId}" for agent "${rec.name}"`);
    // Only pass optional flags when present — `--model ""` would CLEAR the model.
    const common = [
      "--visibility", rec.visibility ?? "private",
      "--max-concurrent-tasks", String(rec.maxConcurrentTasks ?? 6),
    ];
    if (rec.description) common.push("--description", rec.description);
    if (rec.instructions) common.push("--instructions", rec.instructions);
    if (rec.model) common.push("--model", rec.model);
    if (rec.thinkingLevel) common.push("--thinking-level", rec.thinkingLevel);
    if (rec.runtimeConfig && Object.keys(rec.runtimeConfig).length) common.push("--runtime-config", JSON.stringify(rec.runtimeConfig));
    if (Array.isArray(rec.customArgs) && rec.customArgs.length) common.push("--custom-args", JSON.stringify(rec.customArgs));
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
    const skillIds = (rec.skillNames ?? []).map((n) => skillIdMap.get(n)).filter(Boolean);
    cli.run(["agent", "skills", "set", id, "--skill-ids", skillIds.join(",")]);
  }
  return { idMap, created, updated };
}

export function importSquad({ cli, squad, agentIdMap }) {
  const existing = listSquads(cli);
  const leaderId = agentIdMap.get(squad.leaderName);
  const match = findByName(existing, squad.name);
  let id, created = 0, updated = 0;
  const instr = squad.instructions ? ["--instructions", squad.instructions] : [];
  if (match) {
    cli.run(["squad", "update", match.id, "--leader", leaderId, "--description", squad.description ?? "", ...instr]);
    id = match.id; updated++;
  } else {
    const out = cli.run(["squad", "create", "--name", squad.name, "--leader", leaderId, "--description", squad.description ?? "", ...instr]);
    id = JSON.parse(out).id; created++;
  }
  // Add non-leader members, skipping any already present so re-runs are idempotent.
  const present = new Set(getSquadMembers(cli, id).map((m) => m.memberId));
  for (const m of squad.members) {
    if (m.agentName === squad.leaderName) continue;
    const memberId = agentIdMap.get(m.agentName);
    if (present.has(memberId)) continue;
    cli.run(["squad", "member", "add", id, "--member-id", memberId, "--role", m.role, "--type", "agent"]);
  }
  return { newId: id, created, updated };
}

export function collectSourceRuntimes(manifest) {
  return [...new Set((manifest.agents ?? []).map((a) => a.sourceRuntimeId).filter(Boolean))];
}

// sourceRuntimeId -> provider (e.g. "claude", "opencode"), from whichever agent recorded it.
function collectRuntimeProviders(manifest) {
  const map = new Map();
  for (const a of manifest.agents ?? []) {
    if (a.sourceRuntimeId && a.sourceRuntimeProvider && !map.has(a.sourceRuntimeId)) {
      map.set(a.sourceRuntimeId, a.sourceRuntimeProvider);
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
  let squadRes = { newId: null, created: 0, updated: 0 };
  if (manifest.squads?.length) squadRes = importSquad({ cli, squad: manifest.squads[0], agentIdMap: agentRes.idMap });

  return {
    created: { skills: skillRes.created, agents: agentRes.created, squads: squadRes.created },
    updated: { skills: skillRes.updated, agents: agentRes.updated, squads: squadRes.updated },
    skillIdMap: Object.fromEntries(skillRes.idMap),
    agentIdMap: Object.fromEntries(agentRes.idMap),
    squadId: squadRes.newId,
    secretsReminder: (manifest.agents ?? []).filter((a) => a.hadSecrets).map((a) => a.name),
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
