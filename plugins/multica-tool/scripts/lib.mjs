import { spawnSync } from "node:child_process";

export function slugify(name) {
  const s = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "unnamed";
}

export function realExec(args, opts = {}) {
  return spawnSync("multica", args, { encoding: "utf8", ...opts });
}

export function makeCli(exec, { workspaceId } = {}) {
  function run(args, opts) {
    let full = args;
    if (workspaceId) {
      full = [...args, "--workspace-id", workspaceId];
    }
    const res = exec(full, opts);
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

// Get-wrappers: the ONLY place that knows the raw CLI field names — an
// explicit allow-list, so unexpected/internal CLI fields never leak into a
// bundle. Field names mirror the CLI's own snake_case; nothing is renamed.
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
    max_concurrent_tasks: a.max_concurrent_tasks,
    runtime_config: a.runtime_config,
    custom_args: a.custom_args,
    thinking_level: a.thinking_level,
    runtime_id: a.runtime_id,
    has_custom_env: a.has_custom_env,
    mcp_config: a.mcp_config,
    mcp_config_redacted: !!a.mcp_config_redacted,
    skills: (a.skills ?? []).map((sk) => ({ id: sk.id, name: sk.name })),
  };
}

// Custom env is never included in `agent get` — only `has_custom_env`/`custom_env_key_count`.
// Reading actual values requires this dedicated, audited, owner/admin-only command.
export function getAgentCustomEnv(cli, id) {
  const r = cli.json(["agent", "env", "get", id]);
  return r.custom_env ?? {};
}

export function getSquad(cli, id) {
  const s = cli.json(["squad", "get", id]);
  return { id: s.id, name: s.name, description: s.description, instructions: s.instructions, leader_id: s.leader_id };
}

export const getSquadMembers = (cli, id) =>
  (cli.json(["squad", "member", "list", id]) ?? []).map((m) => ({
    member_id: m.member_id, member_type: m.member_type, role: m.role || "member",
  }));
