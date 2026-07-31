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
export const listWorkspaceMembers = (cli) => cli.json(["workspace", "member", "list"]);

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
    model: a.model, visibility: a.visibility, avatar_url: a.avatar_url ?? null,
    service_tier: a.service_tier ?? "",
    permission_mode: a.permission_mode ?? null,
    invocation_targets: (a.invocation_targets ?? []).map((t) => ({ target_id: t.target_id, target_type: t.target_type })),
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
  return { id: s.id, name: s.name, description: s.description, instructions: s.instructions, leader_id: s.leader_id, avatar_url: s.avatar_url ?? null };
}

export const getSquadMembers = (cli, id) =>
  (cli.json(["squad", "member", "list", id]) ?? []).map((m) => ({
    member_id: m.member_id, member_type: m.member_type, role: m.role || "member",
  }));

export const listProjects = (cli) => cli.json(["project", "list"]);

export function findByTitle(list, title) {
  const hits = (list || []).filter((x) => x.title === title);
  if (hits.length > 1) throw new Error(`Duplicate title "${title}" — refusing to guess`);
  return hits[0] || null;
}

export function getProject(cli, id) {
  const p = cli.json(["project", "get", id]);
  return {
    id: p.id, title: p.title, description: p.description ?? "",
    icon: p.icon ?? null, priority: p.priority ?? "none", status: p.status ?? null,
    due_date: p.due_date ?? null, start_date: p.start_date ?? null,
    lead_id: p.lead_id ?? null, lead_type: p.lead_type ?? null,
  };
}

export const getProjectResources = (cli, id) =>
  (cli.json(["project", "resource", "list", id]) ?? []).map((r) => ({
    resource_type: r.resource_type, resource_ref: r.resource_ref, label: r.label ?? null,
  }));

export const listAutopilots = (cli) => cli.json(["autopilot", "list"]).autopilots ?? [];

// `autopilot get` wraps the record as {autopilot, collaborators, triggers} — only
// autopilot + triggers are portable; collaborators/can_write/can_manage_access are
// caller-relative and never bundled. `priority` is accepted by `autopilot
// create`/`update` but never present in this response (verified live) — kept as a
// field anyway so this starts round-tripping automatically if the API adds it.
export function getAutopilot(cli, id) {
  const r = cli.json(["autopilot", "get", id]);
  const a = r.autopilot;
  return {
    id: a.id, title: a.title, description: a.description ?? "",
    execution_mode: a.execution_mode, issue_title_template: a.issue_title_template ?? null,
    priority: a.priority ?? null,
    project_id: a.project_id ?? null,
    assignee_id: a.assignee_id, assignee_type: a.assignee_type,
    subscribers: (a.subscribers ?? []).map((s) => ({ user_id: s.user_id, user_type: s.user_type })),
    triggers: (r.triggers ?? []).map((t) => ({
      kind: t.kind, label: t.label ?? null, enabled: !!t.enabled,
      cron_expression: t.cron_expression ?? null, timezone: t.timezone ?? null,
    })),
  };
}
