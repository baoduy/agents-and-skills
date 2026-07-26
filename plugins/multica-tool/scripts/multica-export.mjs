import * as nodeFs from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { slugify, getSkill, getAgent, getAgentCustomEnv, getSquad, getSquadMembers, listRuntimes, makeCli, realExec, requireAuth, resolveWorkspaceId } from "./lib.mjs";

const nonEmpty = (v) => v && typeof v === "object" && Object.keys(v).length > 0;

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
  const res = spawnSync(process.execPath, ["-e", script, url], { maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0 || !res.stdout?.length) return null;
  return res.stdout;
}

export function redactAgent(a) {
  // a is a normalized agent from getAgent, with `custom_env`/
  // `custom_env_fetch_failed` attached by the caller (collectAgent) — getAgent
  // itself never fetches custom_env, since it requires a separate audited call.
  const { id, has_custom_env, mcp_config_redacted, custom_env_fetch_failed, mcp_config, custom_env, skills, runtime_id, ...rest } = a;
  const mcpUsable = !mcp_config_redacted && nonEmpty(mcp_config);
  const envUsable = !custom_env_fetch_failed && nonEmpty(custom_env);
  // mcp_config_redacted / custom_env_fetch_failed alone still flag hadSecrets even
  // when unusable — the user should know something was present at the source
  // but couldn't be captured, not just silently see an empty bundle.
  const hadSecrets = mcpUsable || envUsable || !!mcp_config_redacted || !!custom_env_fetch_failed;
  return {
    // source_id lets import-time mention rewriting map stale `mention://agent/<id>`
    // links (in this or another agent's/squad's instructions) to the new id.
    record: {
      ...rest,
      source_id: id,
      source_runtime_id: runtime_id,
      skill_names: [],
      mcp_config: mcpUsable ? mcp_config : null,
      custom_env: envUsable ? custom_env : null,
      had_secrets: hadSecrets,
    },
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
    source_workspace_id: sourceWorkspaceId,
    skills: [...seenSkills.values()].map((s) => ({ name: s.name, dir: `skills/${slugify(s.name)}`, source_id: s.source_id })),
    agents: [...seenAgents.values()].map((a) => ({ name: a.name, file: `agents/${slugify(a.name)}.json`, source_id: a.source_id, source_runtime_id: a.source_runtime_id, source_runtime_provider: a.source_runtime_provider ?? null, skill_names: a.skill_names, had_secrets: !!a.had_secrets })),
    squads: squad ? [{ name: squad.name, file: `squads/${slugify(squad.name)}.json`, description: squad.description ?? "", instructions: squad.instructions ?? "", avatar_url: squad.avatar_url ?? null, leader_name: squad.leader_name, members: squad.members }] : [],
  };
}

function collectSkill(cli, id, skills) {
  const s = getSkill(cli, id);
  if (!skills.has(s.name)) skills.set(s.name, s);
  return s.name;
}

// Keyed by agent id (so squad leader_id/member_id resolve to names). Stores the
// normalized agent, its redaction result, and its skill names.
function collectAgent(cli, id, agentsById, skills, providerById) {
  if (agentsById.has(id)) return agentsById.get(id);
  const a = getAgent(cli, id);
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
  const skill_names = a.skills.map((sk) => collectSkill(cli, sk.id, skills));
  const red = redactAgent(a);
  const entry = { raw: a, red, skill_names };
  agentsById.set(id, entry);
  return entry;
}

export function exportResource({ cli, scope, ids, outDir, sourceWorkspaceId, fs = nodeFs, download = fetchBinary }) {
  const skills = new Map();       // name -> normalized skill
  const agentsById = new Map();   // id   -> { raw, red, skill_names }
  let squad = null;
  // Lazy + memoized: only fetched when an agent is actually collected (skips
  // the extra CLI call on skill-only exports).
  let providerById = null;
  const getProviderById = () => providerById ??= new Map(listRuntimes(cli).map((r) => [r.id, r.provider]));

  if (scope === "skill") collectSkill(cli, ids.skillId, skills);
  if (scope === "agent") collectAgent(cli, ids.agentId, agentsById, skills, getProviderById());
  if (scope === "squad") {
    const sq = getSquad(cli, ids.squadId);
    const members = getSquadMembers(cli, ids.squadId).filter((m) => m.member_type === "agent");
    for (const m of members) collectAgent(cli, m.member_id, agentsById, skills, getProviderById());
    if (!agentsById.has(sq.leader_id)) collectAgent(cli, sq.leader_id, agentsById, skills, getProviderById());
    const nameOf = (id) => agentsById.get(id)?.raw.name;
    squad = {
      name: sq.name,
      description: sq.description,
      instructions: sq.instructions,
      avatar_url: sq.avatar_url,
      leader_name: nameOf(sq.leader_id),
      members: members.map((m) => ({ agent_name: nameOf(m.member_id), role: m.role })),
    };
  }

  const manifest = buildManifest({
    scope, sourceWorkspaceId,
    skills: [...skills.values()].map((s) => ({ name: s.name, source_id: s.id })),
    agents: [...agentsById.values()].map((a) => ({ name: a.raw.name, source_id: a.raw.id, source_runtime_id: a.raw.runtime_id, source_runtime_provider: a.raw.source_runtime_provider, skill_names: a.skill_names, had_secrets: a.red.hadSecrets })),
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
