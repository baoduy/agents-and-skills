import { slugify } from "./lib.mjs";

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
    squads: squad ? [{ name: squad.name, file: `squads/${slugify(squad.name)}.json`, description: squad.description ?? "", leaderName: squad.leaderName, members: squad.members }] : [],
  };
}
