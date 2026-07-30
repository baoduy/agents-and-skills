import * as nodeFs from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { slugify, getSkill, getAgent, getAgentCustomEnv, getSquad, getSquadMembers, listRuntimes, listSkills, listAgents, listSquads, listProjects, getProject, getProjectResources, listWorkspaceMembers, getAutopilot, makeCli, realExec, requireAuth, resolveWorkspaceId } from "./lib.mjs";

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
  const res = spawnSync(process.execPath, ["-e", script, "--", url], { maxBuffer: 64 * 1024 * 1024, timeout: 15_000 });
  if (res.status !== 0 || !res.stdout?.length) return null;
  return res.stdout;
}

export function redactAgent(a) {
  // a is a normalized agent from getAgent, with `custom_env`/
  // `custom_env_fetch_failed` attached by the caller (collectAgent) — getAgent
  // itself never fetches custom_env, since it requires a separate audited call.
  const { id, has_custom_env, mcp_config_redacted, custom_env_fetch_failed, mcp_config, custom_env, skills, runtime_id, instructions, ...rest } = a;
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
    // instructions are written to a sibling .md by the caller (see avatar_file),
    // never embedded in the JSON record.
    instructions: instructions ?? "",
  };
}

export function buildManifest({ scope, sourceWorkspaceId, skills, agents, squads, projects, autopilots }) {
  const seenSkills = new Map();
  for (const s of skills) if (!seenSkills.has(s.name)) seenSkills.set(s.name, s);
  const seenAgents = new Map();
  for (const a of agents) if (!seenAgents.has(a.name)) seenAgents.set(a.name, a);
  const seenProjects = new Map();
  for (const p of projects ?? []) if (!seenProjects.has(p.title)) seenProjects.set(p.title, p);
  return {
    version: "1",
    scope,
    source_workspace_id: sourceWorkspaceId,
    skills: [...seenSkills.values()].map((s) => ({ name: s.name, dir: `skills/${slugify(s.name)}`, source_id: s.source_id })),
    agents: [...seenAgents.values()].map((a) => ({ name: a.name, file: `agents/${slugify(a.name)}.json`, source_id: a.source_id, source_runtime_id: a.source_runtime_id, source_runtime_provider: a.source_runtime_provider ?? null, skill_names: a.skill_names, had_secrets: !!a.had_secrets })),
    squads: (squads ?? []).map((squad) => {
      const file = `squads/${slugify(squad.name)}.json`;
      const entry = { name: squad.name, file, description: squad.description ?? "", avatar_url: squad.avatar_url ?? null, leader_name: squad.leader_name, members: squad.members };
      // Instructions go to a sibling .md (see squad write loop); only referenced when non-empty.
      if (squad.instructions) entry.instructions_file = file.replace(/\.json$/, ".md");
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

// Collect a project's portable metadata + its lead agent (bundled, like a squad
// leader) and github_repo/other resources. Returns the project bundle record.
function collectProject(cli, id, agentsById, skills, providerById) {
  const p = getProject(cli, id);
  let lead_name = null;
  if (p.lead_type === "agent" && p.lead_id) {
    lead_name = collectAgent(cli, p.lead_id, agentsById, skills, providerById).raw.name;
  }
  return {
    title: p.title, description: p.description, icon: p.icon,
    priority: p.priority, status: p.status, due_date: p.due_date, start_date: p.start_date,
    source_id: id, lead_type: p.lead_type, lead_name, lead_source_id: p.lead_id,
    resources: getProjectResources(cli, id),
  };
}

export function exportResource({ cli, scope, ids, outDir, sourceWorkspaceId, fs = nodeFs, download = fetchBinary }) {
  const skills = new Map();       // name -> normalized skill
  const agentsById = new Map();   // id   -> { raw, red, skill_names }
  const squads = [];
  const projects = [];
  const autopilots = [];
  // Lazy + memoized: only fetched when an agent is actually collected (skips
  // the extra CLI call on skill-only exports).
  let providerById = null;
  const getProviderById = () => providerById ??= new Map(listRuntimes(cli).map((r) => [r.id, r.provider]));

  // Collect a squad's agents (leader + members) and return the squad bundle object.
  function collectOneSquad(squadId) {
    const sq = getSquad(cli, squadId);
    const members = getSquadMembers(cli, squadId).filter((m) => m.member_type === "agent");
    for (const m of members) collectAgent(cli, m.member_id, agentsById, skills, getProviderById());
    if (!agentsById.has(sq.leader_id)) collectAgent(cli, sq.leader_id, agentsById, skills, getProviderById());
    const nameOf = (id) => agentsById.get(id)?.raw.name;
    return {
      name: sq.name, description: sq.description, instructions: sq.instructions, avatar_url: sq.avatar_url,
      leader_name: nameOf(sq.leader_id),
      members: members.map((m) => ({ agent_name: nameOf(m.member_id), role: m.role })),
    };
  }

  // Collect a single autopilot: its assignee (agent, or squad + members + skills)
  // and, when present, the destination-portable project title / subscriber names.
  // Webhook trigger secrets (url/token) are never read into the bundle — only
  // kind/label/enabled, matching the existing agent MCP/env redaction pattern.
  function collectOneAutopilot(autopilotId) {
    const ap = getAutopilot(cli, autopilotId);
    let assignee_name = null;
    if (ap.assignee_type === "agent") {
      assignee_name = collectAgent(cli, ap.assignee_id, agentsById, skills, getProviderById()).raw.name;
    } else if (ap.assignee_type === "squad") {
      const sq = collectOneSquad(ap.assignee_id);
      squads.push(sq);
      assignee_name = sq.name;
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
      execution_mode: ap.execution_mode, issue_title_template: ap.issue_title_template,
      priority: ap.priority, project_title, assignee_type: ap.assignee_type, assignee_name,
      subscriber_names, had_webhook_trigger: ap.triggers.some((t) => t.kind === "webhook"),
      triggers: ap.triggers.map((t) => t.kind === "webhook"
        ? { kind: "webhook", label: t.label, enabled: t.enabled }
        : { kind: "schedule", label: t.label, enabled: t.enabled, cron_expression: t.cron_expression, timezone: t.timezone }),
    };
  }

  if (scope === "skill") collectSkill(cli, ids.skillId, skills);
  else if (scope === "agent") collectAgent(cli, ids.agentId, agentsById, skills, getProviderById());
  else if (scope === "squad") squads.push(collectOneSquad(ids.squadId));
  else if (scope === "project") projects.push(collectProject(cli, ids.projectId, agentsById, skills, getProviderById()));
  else if (scope === "projects") for (const p of listProjects(cli)) projects.push(collectProject(cli, p.id, agentsById, skills, getProviderById()));
  else if (scope === "autopilot") autopilots.push(collectOneAutopilot(ids.autopilotId));
  else if (scope === "all") {
    for (const s of listSkills(cli)) collectSkill(cli, s.id, skills);
    for (const a of listAgents(cli)) collectAgent(cli, a.id, agentsById, skills, getProviderById());
    for (const sq of listSquads(cli)) squads.push(collectOneSquad(sq.id));
    for (const p of listProjects(cli)) projects.push(collectProject(cli, p.id, agentsById, skills, getProviderById()));
  }

  // Orphan-skill cleanup: drop skills that no exported agent references via its
  // skill_names. Only `all` ever produces these — standalone workspace skills
  // from listSkills that no agent uses. Skipped for `skill` scope: its one
  // skill is the explicit target, not an orphan.
  const pruned_skills = [];
  if (scope !== "skill") {
    const referenced = new Set();
    for (const a of agentsById.values()) for (const n of a.skill_names) referenced.add(n);
    for (const name of [...skills.keys()]) {
      if (!referenced.has(name)) { pruned_skills.push(name); skills.delete(name); }
    }
  }

  const manifest = buildManifest({
    scope, sourceWorkspaceId,
    skills: [...skills.values()].map((s) => ({ name: s.name, source_id: s.id })),
    agents: [...agentsById.values()].map((a) => ({ name: a.raw.name, source_id: a.raw.id, source_runtime_id: a.raw.runtime_id, source_runtime_provider: a.raw.source_runtime_provider, skill_names: a.skill_names, had_secrets: a.red.hadSecrets })),
    squads,
    projects,
    autopilots,
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
    // Instructions live in a sibling .md for reviewability (same sibling-file
    // pattern as avatar_file); only written when non-empty.
    if (red.instructions) {
      const rel = entry.file.replace(/\.json$/, ".md");
      fs.writeFileSync(`${outDir}/${rel}`, red.instructions);
      record.instructions_file = rel;
    }
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(record, null, 2));
  }
  const squadInstrByName = new Map(squads.map((s) => [s.name, s.instructions ?? ""]));
  for (const entry of manifest.squads) {
    fs.mkdirSync(`${outDir}/squads`, { recursive: true });
    if (entry.instructions_file) {
      fs.writeFileSync(`${outDir}/${entry.instructions_file}`, squadInstrByName.get(entry.name) ?? "");
    }
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(entry, null, 2));
  }
  const projectByTitle = new Map(projects.map((p) => [p.title, p]));
  for (const entry of manifest.projects) {
    fs.mkdirSync(`${outDir}/projects`, { recursive: true });
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(projectByTitle.get(entry.title), null, 2));
  }
  const autopilotByTitle = new Map(autopilots.map((a) => [a.title, a]));
  for (const entry of manifest.autopilots) {
    fs.mkdirSync(`${outDir}/autopilots`, { recursive: true });
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(autopilotByTitle.get(entry.title), null, 2));
  }
  fs.writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));
  return {
    manifest, warnings, pruned_skills,
    autopilotWebhookTriggers: autopilots.filter((a) => a.had_webhook_trigger).map((a) => a.title),
  };
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

  const scope     = get("--scope");
  const id        = get("--id");
  const out       = get("--out");
  const workspace = get("--workspace"); // optional: source workspace name

  if (!scope || !out || (scope !== "all" && scope !== "projects" && !id)) {
    console.error("Usage: multica-export.mjs --scope <skill|agent|squad|project|projects|autopilot|all> --id <id> --out <dir> [--workspace <name>]  (--id not needed for --scope all|projects)");
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
  else if (scope === "project")  ids.projectId = id;
  else if (scope === "projects") { /* all projects — no id */ }
  else if (scope === "autopilot") ids.autopilotId = id;
  else if (scope === "all")    { /* whole workspace — no id */ }
  else { console.error(`Unknown scope "${scope}" — use skill|agent|squad|project|projects|autopilot|all`); process.exit(1); }

  const result = exportResource({ cli, scope, ids, outDir: out, sourceWorkspaceId, fs: nodeFs });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
