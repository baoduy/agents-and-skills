// RAW canned CLI `get`/`list` output (matches multica 0.3.29 field names).
// Source IDs deliberately DIFFER from any target IDs so tests catch
// link-by-id regressions in later tasks.
export const SKILL_GET = {
  id: "sk_SRC1", name: "Greet", description: "says hi",
  content: "# Greet\nbody", config: { tone: "warm" },
  files: [{ path: "ref.md", content: "extra", id: "f1", skill_id: "sk_SRC1" }],
};
// A second skill referenced by NO agent — used to test orphan-skill pruning.
export const SKILL_GET_2 = {
  id: "sk_SRC2", name: "Lonely", description: "nobody uses me",
  content: "# Lonely\nbody", config: {}, files: [],
};
export const AGENT_GET = {
  id: "ag_SRC1", name: "Helper", description: "helps", instructions: "be nice",
  model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6,
  runtime_config: {}, custom_args: [], runtime_id: "rt_SRC1", thinking_level: "",
  has_custom_env: true, custom_env_key_count: 1, avatar_url: "emoji:🤖",
  service_tier: "", permission_mode: "public_to",
  invocation_targets: [{ target_id: "ws_SRC", target_type: "workspace" }],
  mcp_config: { mcpServers: { x: { token: "t" } } }, mcp_config_redacted: false,
  skills: [{ id: "sk_SRC1", name: "Greet", description: "says hi" }],
};
// A second agent: no skills, no secrets (used by the squad export test).
export const AGENT_GET_2 = {
  id: "ag_SRC2", name: "Helper2", description: "", instructions: "",
  model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6,
  runtime_config: {}, custom_args: [], runtime_id: "rt_SRC1", thinking_level: "",
  has_custom_env: false, custom_env_key_count: 0, mcp_config: {}, mcp_config_redacted: false,
  avatar_url: "emoji:🐸", skills: [],
};
// An agent with an uploaded-image avatar — export downloads it into the bundle.
export const AGENT_GET_IMG = {
  id: "ag_SRC4", name: "Pixel", description: "", instructions: "",
  model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6,
  runtime_config: {}, custom_args: [], runtime_id: "rt_SRC1", thinking_level: "",
  has_custom_env: false, custom_env_key_count: 0, mcp_config: {}, mcp_config_redacted: false,
  avatar_url: "https://cdn.example.com/uploads/pixel.png", skills: [],
};
// A third agent: mcp_config is present at the source but redacted for this caller —
// must never be written to the bundle (see redactAgent's guard in multica-export.mjs).
export const AGENT_GET_REDACTED = {
  id: "ag_SRC3", name: "HelperRedacted", description: "", instructions: "",
  model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6,
  runtime_config: {}, custom_args: [], runtime_id: "rt_SRC1", thinking_level: "",
  has_custom_env: false, custom_env_key_count: 0,
  mcp_config: { mcpServers: { masked: {} } }, mcp_config_redacted: true,
  skills: [],
};
export const SQUAD_GET = { id: "sq_SRC1", name: "Team", description: "the team", instructions: "# Team charter\nShip it.", leader_id: "ag_SRC1", avatar_url: "emoji:🦍" };
export const SQUAD_MEMBERS = [
  { id: "m1", member_id: "ag_SRC1", member_type: "agent", role: "leader", squad_id: "sq_SRC1" },
  { id: "m2", member_id: "ag_SRC2", member_type: "agent", role: "", squad_id: "sq_SRC1" },
];
export const RUNTIME_LIST = [{ id: "rt_TGT1", name: "My Runtime", provider: "claude" }];
// Source-side runtime list — rt_SRC1 (used by AGENT_GET/AGENT_GET_2) is "claude".
export const RUNTIME_LIST_SRC = [{ id: "rt_SRC1", name: "Source Runtime", provider: "claude" }];
// Destination workspace with exactly one "claude" runtime — auto-map succeeds.
export const RUNTIME_LIST_DEST_UNIQUE = [
  { id: "rt_TGT1", name: "Target Runtime", provider: "claude" },
  { id: "rt_TGT2", name: "Other Runtime", provider: "opencode" },
];
// Destination workspace with two "claude" runtimes — auto-map is ambiguous.
export const RUNTIME_LIST_DEST_AMBIGUOUS = [
  { id: "rt_TGT1", name: "Target Runtime A", provider: "claude" },
  { id: "rt_TGT2", name: "Target Runtime B", provider: "claude" },
];
// Raw `agent env get` response — the audited, owner/admin-only command.
export const AGENT_ENV_GET = { agent_id: "ag_SRC1", custom_env: { API_KEY: "secret-value" } };

// Two projects: one agent-led with mixed resources + non-none priority,
// one unled with no resources. Lead ag_SRC1 = "Helper" (AGENT_GET).
export const PROJECT_LIST = [
  { id: "pr_SRC1", title: "Launch", lead_id: "ag_SRC1", lead_type: "agent", priority: "high" },
  { id: "pr_SRC2", title: "Backlog", lead_id: null, lead_type: null, priority: "none" },
];
export const PROJECT_GET_1 = {
  id: "pr_SRC1", title: "Launch", description: "the launch", icon: "🚀",
  priority: "high", status: "in_progress", due_date: null, start_date: null,
  lead_id: "ag_SRC1", lead_type: "agent",
};
export const PROJECT_GET_2 = {
  id: "pr_SRC2", title: "Backlog", description: "", icon: null,
  priority: "none", status: "planned", due_date: null, start_date: null,
  lead_id: null, lead_type: null,
};
export const PROJECT_RESOURCES_1 = [
  { resource_type: "github_repo", resource_ref: { url: "https://github.com/x/repo.git" }, label: null, position: 0 },
  { resource_type: "local_directory", resource_ref: { path: "/x", daemon_id: "d1" }, label: "local", position: 1 },
];
export const PROJECT_RESOURCES_2 = [];

// autopilot fixtures
export const AUTOPILOT_GET = {
  autopilot: {
    id: "ap_SRC1", title: "Nightly Scan", description: "scan deps nightly", execution_mode: "run_only",
    issue_title_template: "[Scan] {{.Date}}", priority: null, project_id: "pr_SRC1",
    assignee_id: "ag_SRC1", assignee_type: "agent",
    subscribers: [{ user_id: "u1", user_type: "user" }, { user_id: "u_missing", user_type: "user" }],
  },
  triggers: [
    { kind: "schedule", label: "nightly", enabled: true, cron_expression: "0 9 * * *", timezone: "UTC" },
    { kind: "webhook", label: "ci", enabled: true, cron_expression: null, timezone: null },
    { kind: "manual", label: null, enabled: true, cron_expression: null, timezone: null },
  ],
};

export const AUTOPILOT_GET_SQUAD = {
  autopilot: {
    id: "ap_SRC2", title: "Squad Pilot", description: "", execution_mode: "create_issue",
    issue_title_template: null, priority: null, project_id: null,
    assignee_id: "sq_SRC1", assignee_type: "squad",
    subscribers: [],
  },
  triggers: [
    { kind: "schedule", label: "weekly", enabled: true, cron_expression: "0 0 * * 0", timezone: "UTC" },
  ],
};

export const AUTOPILOT_GET_MINIMAL = {
  autopilot: {
    id: "ap_SRC3", title: "Minimal", description: "", execution_mode: "create_issue",
    issue_title_template: null, priority: null, project_id: null,
    assignee_id: "ag_SRC2", assignee_type: "agent",
    subscribers: [],
  },
  triggers: [],
};

export const WORKSPACE_MEMBERS = [
  { user_id: "u1", name: "Alice", user_type: "user" },
  { user_id: "u2", name: "Bob", user_type: "user" },
];

export const RUNTIME_LIST_AGENT2 = [{ id: "rt_TGT3", name: "Extra Runtime", provider: "claude" }];
