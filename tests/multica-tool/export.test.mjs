import { test } from "node:test";
import assert from "node:assert/strict";
import { redactAgent, buildManifest, exportResource } from "../../plugins/multica-tool/scripts/multica-export.mjs";
import { getAgent } from "../../plugins/multica-tool/scripts/lib.mjs";
import { AGENT_GET, SKILL_GET, AGENT_GET_2, SQUAD_GET, SQUAD_MEMBERS } from "./fixtures.mjs";

function fakeCli() {
  return {
    json: (args) => {
      const key = args.slice(0, 3).join(" ");           // first 3 tokens identify the call
      if (key === "squad get sq_SRC1") return SQUAD_GET;
      if (key === "squad member list") return SQUAD_MEMBERS;
      if (key === "agent get ag_SRC1") return AGENT_GET;
      if (key === "agent get ag_SRC2") return AGENT_GET_2;
      if (key === "skill get sk_SRC1") return SKILL_GET;
      throw new Error("unexpected " + args.join(" "));
    },
    run: () => "",
  };
}
function memFs() {
  const files = {};
  return { files, mkdirSync: () => {}, writeFileSync: (p, c) => { files[p] = c; } };
}
// Like memFs but enforces that a file's parent dir was mkdir'd first — mirrors
// the real fs ENOENT, so a missing mkdir for nested skill files is caught.
function strictFs() {
  const files = {}, dirs = new Set();
  return {
    files,
    mkdirSync: (p) => { const parts = p.split("/"); for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join("/")); },
    writeFileSync: (p, c) => {
      const parent = p.slice(0, p.lastIndexOf("/"));
      if (!dirs.has(parent)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      files[p] = c;
    },
  };
}

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

test("export skill writes SKILL.md, config, extra files, manifest", () => {
  const fs = memFs();
  const { manifest } = exportResource({ cli: fakeCli(), scope: "skill", ids: { skillId: "sk_SRC1" }, outDir: "/out", sourceWorkspaceId: "ws_SRC", fs });
  assert.equal(fs.files["/out/skills/greet/SKILL.md"], "# Greet\nbody");
  assert.ok(fs.files["/out/skills/greet/config.json"].includes("warm"));
  assert.equal(fs.files["/out/skills/greet/ref.md"], "extra");
  assert.ok(fs.files["/out/manifest.json"]);
  assert.equal(manifest.skills[0].name, "Greet");
});

test("export creates nested parent dirs for skill files (regression: scripts/ subdir)", () => {
  const fs = strictFs();
  const cli = {
    json: (args) => {
      if (args.slice(0, 3).join(" ") === "skill get sk_N")
        return { id: "sk_N", name: "Nested", content: "x", config: {}, files: [{ path: "scripts/run.sh", content: "echo hi" }] };
      throw new Error("unexpected " + args.join(" "));
    },
    run: () => "",
  };
  exportResource({ cli, scope: "skill", ids: { skillId: "sk_N" }, outDir: "/out", sourceWorkspaceId: "", fs });
  assert.equal(fs.files["/out/skills/nested/scripts/run.sh"], "echo hi");
});

test("export agent never writes mcp_config (secret) to disk; warns when secrets present", () => {
  const fs = memFs();
  const { warnings } = exportResource({ cli: fakeCli(), scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/o", sourceWorkspaceId: "ws", fs });
  const blob = Object.values(fs.files).join("\n");
  assert.ok(!blob.includes("token"), "mcp_config leaked to disk");
  assert.deepEqual(warnings, ["Helper"]);          // has_custom_env true → warned
});

test("export squad resolves leader and member names by id and writes squad file", () => {
  const fs = memFs();
  const { manifest, warnings } = exportResource({ cli: fakeCli(), scope: "squad", ids: { squadId: "sq_SRC1" }, outDir: "/s", sourceWorkspaceId: "ws", fs });
  const squad = JSON.parse(fs.files["/s/squads/team.json"]);
  assert.equal(squad.leaderName, "Helper", "leaderId ag_SRC1 resolved to name");
  assert.equal(squad.instructions, "# Team charter\nShip it.", "squad instructions captured in export");
  assert.deepEqual(squad.members.map((m) => m.agentName).sort(), ["Helper", "Helper2"]);
  assert.equal(manifest.agents.length, 2, "both member agents captured");
  assert.deepEqual(warnings, ["Helper"], "only the agent with secrets is warned");
});
