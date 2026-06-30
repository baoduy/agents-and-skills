import { test } from "node:test";
import assert from "node:assert/strict";
import { redactAgent, buildManifest } from "../../plugins/multica-tool/scripts/multica-export.mjs";
import { getAgent } from "../../plugins/multica-tool/scripts/lib.mjs";
import { AGENT_GET } from "./fixtures.mjs";

test("redactAgent strips secrets/id/skills and records runtime + hadSecrets", () => {
  const normalized = getAgent({ json: () => AGENT_GET }, "ag_SRC1");
  const { record, hadSecrets } = redactAgent(normalized);
  assert.equal(hadSecrets, true, "has_custom_env true OR mcp_config non-empty");
  assert.ok(!("mcpConfig" in record), "mcp_config (secret) must not be written");
  assert.ok(!("hasCustomEnv" in record));
  assert.ok(!("skills" in record));
  assert.ok(!("id" in record));
  assert.equal(record.sourceRuntimeId, "rt_SRC1");
  assert.equal(record.maxConcurrentTasks, 6, "normalized field survives");
  assert.equal(record.hadSecrets, true);
  assert.equal(record.name, "Helper");
});

test("buildManifest dedups skills/agents by name and wires by name", () => {
  const m = buildManifest({
    scope: "squad",
    sourceWorkspaceId: "ws_SRC",
    skills: [{ name: "Greet", sourceId: "sk_SRC1" }, { name: "Greet", sourceId: "sk_SRC1" }],
    agents: [{ name: "Helper", sourceRuntimeId: "rt_SRC1", skillNames: ["Greet"], hadSecrets: true }],
    squad: { name: "Team", description: "the team", leaderName: "Helper", members: [{ agentName: "Helper2", role: "member" }] },
  });
  assert.equal(m.version, "1");
  assert.equal(m.skills.length, 1, "skills deduped by name");
  assert.equal(m.skills[0].dir, "skills/greet");
  assert.equal(m.agents[0].file, "agents/helper.json");
  assert.deepEqual(m.agents[0].skillNames, ["Greet"]);
  assert.equal(m.agents[0].hadSecrets, true);
  assert.equal(m.squads[0].leaderName, "Helper");
  assert.equal(m.squads[0].description, "the team");
});
