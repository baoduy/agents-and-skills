// Source-workspace canned `get` output. Source IDs deliberately DIFFER from
// any target IDs so tests catch link-by-id regressions.
export const SKILL_GET = {
  id: "sk_SRC1", name: "Greet", description: "says hi",
  content: "# Greet\nbody", config: { tone: "warm" },
  files: [{ path: "ref.md", content: "extra" }],
};
export const AGENT_GET = {
  id: "ag_SRC1", name: "Helper", description: "helps", instructions: "be nice",
  model: "claude-sonnet-4-6", visibility: "workspace", maxConcurrentTasks: 6,
  runtimeConfig: {}, customArgs: [], runtimeId: "rt_SRC1",
  customEnv: { SECRET: "shh" }, mcpConfig: { mcpServers: { x: { token: "t" } } },
};
export const AGENT_SKILLS = [{ id: "sk_SRC1", name: "Greet" }];
export const SQUAD_GET = { id: "sq_SRC1", name: "Team", description: "the team", leaderName: "Helper" };
export const SQUAD_MEMBERS = [
  { agentName: "Helper", role: "leader" },
  { agentName: "Helper2", role: "member" },
];
