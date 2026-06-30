import { spawnSync } from "node:child_process";

export function slugify(name) {
  const s = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "unnamed";
}

export function realExec(args) {
  return spawnSync("multica", args, { encoding: "utf8" });
}

export function makeCli(exec, { workspaceId } = {}) {
  function run(args) {
    let full = args;
    if (workspaceId) {
      full = [...args, "--workspace-id", workspaceId];
    }
    const res = exec(full);
    if (res.status !== 0) throw new Error(res.stderr?.trim() || `multica exited ${res.status}`);
    return res.stdout;
  }
  function json(args) {
    const fullArgs = workspaceId ? [...args, "--workspace-id", workspaceId, "--output", "json"] : [...args, "--output", "json"];
    const res = exec(fullArgs);
    if (res.status !== 0) throw new Error(res.stderr?.trim() || `multica exited ${res.status}`);
    return JSON.parse(res.stdout);
  }
  return { run, json };
}

export function requireAuth(exec) {
  const res = exec(["auth", "status"]);
  if (res.status !== 0) throw new Error("Not authenticated. Run: multica login");
}

export function findByName(list, name) {
  const hits = (list || []).filter((x) => x.name === name);
  if (hits.length > 1) throw new Error(`Duplicate name "${name}" — refusing to guess`);
  return hits[0] || null;
}

export function resolveWorkspaceId(cli, name) {
  const list = cli.json(["workspace", "list"]);
  const hits = list.filter((w) => w.name === name);
  if (hits.length === 0) throw new Error(`Unknown workspace "${name}"`);
  if (hits.length > 1) throw new Error(`Ambiguous workspace "${name}"`);
  return hits[0].id;
}

export const listRuntimes = (cli) => cli.json(["runtime", "list"]);
export const listSkills = (cli) => cli.json(["skill", "list"]);
export const listAgents = (cli) => cli.json(["agent", "list"]);
export const listSquads = (cli) => cli.json(["squad", "list"]);

// Get-wrappers: the ONLY place that knows the raw CLI field names. They
// return a stable camelCase shape so downstream code never sees snake_case.
export function getSkill(cli, id) {
  const s = cli.json(["skill", "get", id]);
  return {
    id: s.id, name: s.name, description: s.description,
    content: s.content ?? "", config: s.config ?? {},
    files: (s.files ?? []).map((f) => ({ path: f.path, content: f.content })),
  };
}

export function getAgent(cli, id) {
  const a = cli.json(["agent", "get", id]);
  return {
    id: a.id, name: a.name, description: a.description, instructions: a.instructions,
    model: a.model, visibility: a.visibility,
    maxConcurrentTasks: a.max_concurrent_tasks,
    runtimeConfig: a.runtime_config,
    customArgs: a.custom_args,
    thinkingLevel: a.thinking_level,
    runtimeId: a.runtime_id,
    hasCustomEnv: a.has_custom_env,
    mcpConfig: a.mcp_config,
    skills: (a.skills ?? []).map((sk) => ({ id: sk.id, name: sk.name })),
  };
}

export function getSquad(cli, id) {
  const s = cli.json(["squad", "get", id]);
  return { id: s.id, name: s.name, description: s.description, leaderId: s.leader_id };
}

export const getSquadMembers = (cli, id) =>
  (cli.json(["squad", "member", "list", id]) ?? []).map((m) => ({
    memberId: m.member_id, memberType: m.member_type, role: m.role || "member",
  }));
