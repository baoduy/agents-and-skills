import { test } from "node:test";
import assert from "node:assert/strict";
import { importSkills } from "../../plugins/multica-tool/scripts/multica-import.mjs";

const MANIFEST = {
  version: "1", scope: "skill", sourceWorkspaceId: "ws_SRC",
  skills: [{ name: "Greet", dir: "skills/greet", sourceId: "sk_SRC1" }],
  agents: [], squads: [],
};
function memFs(files) {
  return {
    existsSync: (p) => p in files,
    readFileSync: (p) => files[p],
    readdirSync: (p) => Object.keys(files).filter((f) => f.startsWith(p + "/")).map((f) => f.slice(p.length + 1)),
  };
}
// Records every cli.run argv; json() drives existence + created-id.
function recordingCli({ existing = [] } = {}) {
  const calls = [];
  return {
    calls,
    json: (args) => (args[0] === "skill" && args[1] === "list" ? existing : {}),
    run: (args) => { calls.push(args); return args.includes("create") ? '{"id":"sk_NEW1"}' : "{}"; },
  };
}

test("importSkills creates a missing skill and upserts its files", () => {
  const fs = memFs({ "skills/greet/SKILL.md": "# Greet", "skills/greet/config.json": '{"tone":"warm"}', "skills/greet/ref.md": "extra" });
  const cli = recordingCli();
  const { idMap, created, updated } = importSkills({ cli, manifest: MANIFEST, dir: ".", fs });
  assert.equal(created, 1); assert.equal(updated, 0);
  assert.equal(idMap.get("Greet"), "sk_NEW1");
  assert.ok(cli.calls.some((a) => a[0] === "skill" && a[1] === "create"));
  assert.ok(cli.calls.some((a) => a.join(" ").startsWith("skill files upsert sk_NEW1 --path ref.md")));
});

test("importSkills updates (not re-creates) when name exists — idempotent", () => {
  const fs = memFs({ "skills/greet/SKILL.md": "# Greet", "skills/greet/config.json": "{}" });
  const cli = recordingCli({ existing: [{ id: "sk_TGT9", name: "Greet" }] });
  const { created, updated, idMap } = importSkills({ cli, manifest: MANIFEST, dir: ".", fs });
  assert.equal(created, 0); assert.equal(updated, 1);
  assert.equal(idMap.get("Greet"), "sk_TGT9", "reused target id, not source id");
  assert.ok(cli.calls.some((a) => a[0] === "skill" && a[1] === "update" && a[2] === "sk_TGT9"));
  assert.ok(!cli.calls.some((a) => a[1] === "create"));
});

import { importAgents } from "../../plugins/multica-tool/scripts/multica-import.mjs";

const AGENT_MANIFEST = {
  version: "1", scope: "agent", sourceWorkspaceId: "ws_SRC", skills: [],
  agents: [{ name: "Helper", file: "agents/helper.json", sourceRuntimeId: "rt_SRC1", skillNames: ["Greet"] }],
  squads: [],
};
const AGENT_FILE = JSON.stringify({ name: "Helper", instructions: "be nice", model: "claude-sonnet-4-6", visibility: "workspace", maxConcurrentTasks: 6, sourceRuntimeId: "rt_SRC1", skillNames: ["Greet"] });

test("importAgents remaps runtime id and sets mapped skill ids", () => {
  const fs = { existsSync: () => true, readFileSync: () => AGENT_FILE, readdirSync: () => [] };
  const calls = [];
  const cli = { calls, json: (a) => (a[1] === "list" ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; } };
  const { idMap } = importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  assert.equal(idMap.get("Helper"), "ag_NEW1");
  const create = calls.find((a) => a[1] === "create");
  assert.ok(create.includes("--runtime-id") && create[create.indexOf("--runtime-id") + 1] === "rt_TGT1", "mapped runtime applied");
  const set = calls.find((a) => a[1] === "skills" && a[2] === "set");
  assert.equal(set[set.indexOf("--skill-ids") + 1], "sk_NEW1", "mapped skill id applied");
});

test("importAgents throws when runtime is unmapped", () => {
  const fs = { existsSync: () => true, readFileSync: () => AGENT_FILE, readdirSync: () => [] };
  const cli = { json: () => [], run: () => "{}" };
  assert.throws(
    () => importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map(), runtimeMap: new Map(), fs }),
    /unmapped runtime/i
  );
});

import { importSquad } from "../../plugins/multica-tool/scripts/multica-import.mjs";

const SQUAD_ENTRY = {
  name: "Team", file: "squads/team.json", leaderName: "Helper",
  members: [{ agentName: "Helper", role: "leader" }, { agentName: "Helper2", role: "member" }],
};

test("importSquad creates with mapped leader and adds non-leader members by mapped id", () => {
  const calls = [];
  const cli = { calls, json: (a) => (a[1] === "list" ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"sq_NEW1"}' : "{}"; } };
  const agentIdMap = new Map([["Helper", "ag_NEW1"], ["Helper2", "ag_NEW2"]]);
  const { newId } = importSquad({ cli, squad: SQUAD_ENTRY, agentIdMap });
  assert.equal(newId, "sq_NEW1");
  const create = calls.find((a) => a[1] === "create");
  assert.equal(create[create.indexOf("--leader") + 1], "ag_NEW1");
  const adds = calls.filter((a) => a[1] === "member" && a[2] === "add");
  assert.equal(adds.length, 1, "leader is not double-added as member");
  assert.equal(adds[0][adds[0].indexOf("--member-id") + 1], "ag_NEW2");
});
