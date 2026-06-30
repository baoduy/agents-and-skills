// RAW canned CLI `get`/`list` output (matches multica 0.3.29 field names).
// Source IDs deliberately DIFFER from any target IDs so tests catch
// link-by-id regressions in later tasks.
export const SKILL_GET = {
  id: "sk_SRC1", name: "Greet", description: "says hi",
  content: "# Greet\nbody", config: { tone: "warm" },
  files: [{ path: "ref.md", content: "extra", id: "f1", skill_id: "sk_SRC1" }],
};
export const AGENT_GET = {
  id: "ag_SRC1", name: "Helper", description: "helps", instructions: "be nice",
  model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6,
  runtime_config: {}, custom_args: [], runtime_id: "rt_SRC1", thinking_level: "",
  has_custom_env: true, custom_env_key_count: 1,
  mcp_config: { mcpServers: { x: { token: "t" } } }, mcp_config_redacted: {},
  skills: [{ id: "sk_SRC1", name: "Greet", description: "says hi" }],
};
// A second agent: no skills, no secrets (used by the squad export test).
export const AGENT_GET_2 = {
  id: "ag_SRC2", name: "Helper2", description: "", instructions: "",
  model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6,
  runtime_config: {}, custom_args: [], runtime_id: "rt_SRC1", thinking_level: "",
  has_custom_env: false, custom_env_key_count: 0, mcp_config: {}, mcp_config_redacted: {},
  skills: [],
};
export const SQUAD_GET = { id: "sq_SRC1", name: "Team", description: "the team", leader_id: "ag_SRC1" };
export const SQUAD_MEMBERS = [
  { id: "m1", member_id: "ag_SRC1", member_type: "agent", role: "leader", squad_id: "sq_SRC1" },
  { id: "m2", member_id: "ag_SRC2", member_type: "agent", role: "", squad_id: "sq_SRC1" },
];
export const RUNTIME_LIST = [{ id: "rt_TGT1", name: "My Runtime", provider: "claude" }];
