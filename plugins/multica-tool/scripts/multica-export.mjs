import * as nodeFs from "node:fs";
import { dirname } from "node:path";
import { slugify, getSkill, getAgent, getSquad, getSquadMembers, makeCli, realExec, requireAuth, resolveWorkspaceId } from "./lib.mjs";

const nonEmpty = (v) => v && typeof v === "object" && Object.keys(v).length > 0;

export function redactAgent(a) {
  // a is a normalized (camelCase) agent from getAgent.
  const { id, hasCustomEnv, mcpConfig, skills, runtimeId, ...rest } = a;
  const hadSecrets = !!hasCustomEnv || nonEmpty(mcpConfig);
  return {
    record: { ...rest, sourceRuntimeId: runtimeId, skillNames: [], hadSecrets },
    hadSecrets,
  };
}

export function buildManifest({ scope, sourceWorkspaceId, skills, agents, squad }) {
  const seenSkills = new Map();
  for (const s of skills) if (!seenSkills.has(s.name)) seenSkills.set(s.name, s);
  const seenAgents = new Map();
  for (const a of agents) if (!seenAgents.has(a.name)) seenAgents.set(a.name, a);
  return {
    version: "1",
    scope,
    sourceWorkspaceId,
    skills: [...seenSkills.values()].map((s) => ({ name: s.name, dir: `skills/${slugify(s.name)}`, sourceId: s.sourceId })),
    agents: [...seenAgents.values()].map((a) => ({ name: a.name, file: `agents/${slugify(a.name)}.json`, sourceRuntimeId: a.sourceRuntimeId, skillNames: a.skillNames, hadSecrets: !!a.hadSecrets })),
    squads: squad ? [{ name: squad.name, file: `squads/${slugify(squad.name)}.json`, description: squad.description ?? "", instructions: squad.instructions ?? "", leaderName: squad.leaderName, members: squad.members }] : [],
  };
}

function collectSkill(cli, id, skills) {
  const s = getSkill(cli, id);
  if (!skills.has(s.name)) skills.set(s.name, s);
  return s.name;
}

// Keyed by agent id (so squad leaderId/memberId resolve to names). Stores the
// normalized agent, its redaction result, and its skill names.
function collectAgent(cli, id, agentsById, skills) {
  if (agentsById.has(id)) return agentsById.get(id);
  const a = getAgent(cli, id);
  const skillNames = a.skills.map((sk) => collectSkill(cli, sk.id, skills));
  const red = redactAgent(a);
  const entry = { raw: a, red, skillNames };
  agentsById.set(id, entry);
  return entry;
}

export function exportResource({ cli, scope, ids, outDir, sourceWorkspaceId, fs = nodeFs }) {
  const skills = new Map();       // name -> normalized skill
  const agentsById = new Map();   // id   -> { raw, red, skillNames }
  let squad = null;

  if (scope === "skill") collectSkill(cli, ids.skillId, skills);
  if (scope === "agent") collectAgent(cli, ids.agentId, agentsById, skills);
  if (scope === "squad") {
    const sq = getSquad(cli, ids.squadId);
    const members = getSquadMembers(cli, ids.squadId).filter((m) => m.memberType === "agent");
    for (const m of members) collectAgent(cli, m.memberId, agentsById, skills);
    if (!agentsById.has(sq.leaderId)) collectAgent(cli, sq.leaderId, agentsById, skills);
    const nameOf = (id) => agentsById.get(id)?.raw.name;
    squad = {
      name: sq.name,
      description: sq.description,
      instructions: sq.instructions,
      leaderName: nameOf(sq.leaderId),
      members: members.map((m) => ({ agentName: nameOf(m.memberId), role: m.role })),
    };
  }

  const manifest = buildManifest({
    scope, sourceWorkspaceId,
    skills: [...skills.values()].map((s) => ({ name: s.name, sourceId: s.id })),
    agents: [...agentsById.values()].map((a) => ({ name: a.raw.name, sourceRuntimeId: a.raw.runtimeId, skillNames: a.skillNames, hadSecrets: a.red.hadSecrets })),
    squad,
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
    const { raw, red, skillNames } = agentByName.get(entry.name);
    const record = { ...red.record, skillNames };
    if (red.hadSecrets) warnings.push(raw.name);
    fs.mkdirSync(`${outDir}/agents`, { recursive: true });
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(record, null, 2));
  }
  for (const entry of manifest.squads) {
    fs.mkdirSync(`${outDir}/squads`, { recursive: true });
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(entry, null, 2));
  }
  fs.writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));
  return { manifest, warnings };
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

  const scope     = get("--scope");
  const id        = get("--id");
  const out       = get("--out");
  const workspace = get("--workspace"); // optional: source workspace name

  if (!scope || !id || !out) {
    console.error("Usage: multica-export.mjs --scope <skill|agent|squad> --id <id> --out <dir> [--workspace <name>]");
    process.exit(1);
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
  else { console.error(`Unknown scope "${scope}" — use skill|agent|squad`); process.exit(1); }

  const result = exportResource({ cli, scope, ids, outDir: out, sourceWorkspaceId, fs: nodeFs });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
