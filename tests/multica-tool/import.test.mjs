import { test } from "node:test";
import assert from "node:assert/strict";
import { importSkills } from "../../plugins/multica-tool/scripts/multica-import.mjs";

const MANIFEST = {
  version: "1", scope: "skill", sourceWorkspaceId: "ws_SRC",
  skills: [{ name: "Greet", dir: "skills/greet", sourceId: "sk_SRC1" }],
  agents: [], squads: [],
};
// Mirrors real fs: readdirSync is SHALLOW and (with withFileTypes) reports dirs.
function memFs(files) {
  return {
    existsSync: (p) => p in files,
    readFileSync: (p) => files[p],
    readdirSync: (p, opts) => {
      const seen = new Map(); // immediate child name -> isDir
      for (const f of Object.keys(files)) {
        if (!f.startsWith(p + "/")) continue;
        const rest = f.slice(p.length + 1);
        const slash = rest.indexOf("/");
        const name = slash === -1 ? rest : rest.slice(0, slash);
        if (!seen.has(name)) seen.set(name, slash !== -1);
      }
      const entries = [...seen.entries()];
      return opts?.withFileTypes
        ? entries.map(([name, isDir]) => ({ name, isDirectory: () => isDir }))
        : entries.map(([name]) => name);
    },
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

test("importSkills upserts nested files by relative path, never the dir (regression: scripts/ subdir)", () => {
  const fs = memFs({ "skills/greet/SKILL.md": "# Greet", "skills/greet/config.json": "{}", "skills/greet/scripts/run.sh": "echo hi" });
  const cli = recordingCli();
  importSkills({ cli, manifest: MANIFEST, dir: ".", fs });
  const upserts = cli.calls.filter((a) => a[0] === "skill" && a[1] === "files" && a[2] === "upsert");
  const paths = upserts.map((a) => a[a.indexOf("--path") + 1]);
  assert.ok(paths.includes("scripts/run.sh"), "nested file upserted by its relative path");
  assert.ok(!paths.includes("scripts"), "the scripts dir itself is never upserted");
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

const FM_SKILL = "---\nname: Greet\ndescription: Greets the user warmly.\n---\n# Greet\nbody";

test("importSkills derives --description from SKILL.md frontmatter on create", () => {
  const fs = memFs({ "skills/greet/SKILL.md": FM_SKILL, "skills/greet/config.json": "{}" });
  const cli = recordingCli();
  importSkills({ cli, manifest: MANIFEST, dir: ".", fs });
  const create = cli.calls.find((a) => a[1] === "create");
  assert.equal(create[create.indexOf("--description") + 1], "Greets the user warmly.");
});

test("importSkills fills description on update only when the existing skill has none", () => {
  const fs = memFs({ "skills/greet/SKILL.md": FM_SKILL, "skills/greet/config.json": "{}" });
  // existing skill already has a description -> must NOT be clobbered
  const cliSet = recordingCli({ existing: [{ id: "sk_T1", name: "Greet", description: "keep me" }] });
  importSkills({ cli: cliSet, manifest: MANIFEST, dir: ".", fs });
  assert.ok(!cliSet.calls.find((a) => a[1] === "update").includes("--description"), "set description not overwritten");

  // existing skill has empty description -> fill from frontmatter
  const cliEmpty = recordingCli({ existing: [{ id: "sk_T2", name: "Greet", description: "" }] });
  importSkills({ cli: cliEmpty, manifest: MANIFEST, dir: ".", fs });
  const upd = cliEmpty.calls.find((a) => a[1] === "update");
  assert.equal(upd[upd.indexOf("--description") + 1], "Greets the user warmly.");
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

test("importAgents threads description through to create (regression: was silently dropped)", () => {
  const fs = { existsSync: () => true, readFileSync: () => JSON.stringify({ ...JSON.parse(AGENT_FILE), description: "helps with stuff" }), readdirSync: () => [] };
  const calls = [];
  const cli = { calls, json: (a) => (a[1] === "list" ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; } };
  importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  const create = calls.find((a) => a[1] === "create");
  assert.equal(create[create.indexOf("--description") + 1], "helps with stuff");
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
  name: "Team", file: "squads/team.json", leaderName: "Helper", instructions: "# Team charter\nDeliver features.",
  members: [{ agentName: "Helper", role: "leader" }, { agentName: "Helper2", role: "member" }],
};

test("importSquad creates with mapped leader and adds non-leader members by mapped id", () => {
  const calls = [];
  const cli = { calls, json: (a) => (a.includes("list") ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"sq_NEW1"}' : "{}"; } };
  const agentIdMap = new Map([["Helper", "ag_NEW1"], ["Helper2", "ag_NEW2"]]);
  const { newId } = importSquad({ cli, squad: SQUAD_ENTRY, agentIdMap });
  assert.equal(newId, "sq_NEW1");
  const create = calls.find((a) => a[1] === "create");
  assert.equal(create[create.indexOf("--leader") + 1], "ag_NEW1");
  assert.equal(create[create.indexOf("--instructions") + 1], "# Team charter\nDeliver features.", "squad instructions threaded on create");
  const adds = calls.filter((a) => a[1] === "member" && a[2] === "add");
  assert.equal(adds.length, 1, "leader is not double-added as member");
  assert.equal(adds[0][adds[0].indexOf("--member-id") + 1], "ag_NEW2");
});

test("importSquad skips members already present (regression: idempotent re-run)", () => {
  const calls = [];
  const cli = {
    calls,
    json: (a) => {
      if (a[1] === "member" && a[2] === "list") return [{ member_id: "ag_NEW2", member_type: "agent", role: "member" }];
      if (a.includes("list")) return [{ id: "sq_OLD", name: "Team" }];
      return {};
    },
    run: (a) => { calls.push(a); return "{}"; },
  };
  const agentIdMap = new Map([["Helper", "ag_NEW1"], ["Helper2", "ag_NEW2"]]);
  importSquad({ cli, squad: SQUAD_ENTRY, agentIdMap });
  const adds = calls.filter((a) => a[1] === "member" && a[2] === "add");
  assert.equal(adds.length, 0, "Helper2 already a member → not re-added");
});

import { collectSourceRuntimes } from "../../plugins/multica-tool/scripts/multica-import.mjs";

test("collectSourceRuntimes returns distinct ids", () => {
  const m = { agents: [{ sourceRuntimeId: "rt_a" }, { sourceRuntimeId: "rt_a" }, { sourceRuntimeId: "rt_b" }] };
  assert.deepEqual(collectSourceRuntimes(m).sort(), ["rt_a", "rt_b"]);
});

import { resolveRuntimeMap } from "../../plugins/multica-tool/scripts/multica-import.mjs";
import { RUNTIME_LIST_DEST_UNIQUE, RUNTIME_LIST_DEST_AMBIGUOUS } from "./fixtures.mjs";

const MANIFEST_WITH_PROVIDER = { agents: [{ sourceRuntimeId: "rt_SRC1", sourceRuntimeProvider: "claude" }] };

test("resolveRuntimeMap auto-maps by provider when exactly one destination runtime matches", () => {
  const cli = { json: () => RUNTIME_LIST_DEST_UNIQUE };
  const { effective, unresolved } = resolveRuntimeMap({ cli, manifest: MANIFEST_WITH_PROVIDER, runtimeMap: new Map() });
  assert.deepEqual(unresolved, []);
  assert.equal(effective.get("rt_SRC1"), "rt_TGT1", "the single claude-provider runtime in the destination");
});

test("resolveRuntimeMap leaves it unresolved when the provider is ambiguous in the destination", () => {
  const cli = { json: () => RUNTIME_LIST_DEST_AMBIGUOUS };
  const { effective, unresolved } = resolveRuntimeMap({ cli, manifest: MANIFEST_WITH_PROVIDER, runtimeMap: new Map() });
  assert.ok(!effective.has("rt_SRC1"), "2 matching runtimes — cannot pick one automatically");
  assert.deepEqual(unresolved, [{ srcId: "rt_SRC1", provider: "claude", matchCount: 2 }]);
});

test("resolveRuntimeMap: an explicit --runtime-map entry wins over auto-mapping and skips the runtime list call", () => {
  const cli = { json: () => { throw new Error("must not list runtimes when explicitly mapped"); } };
  const { effective, unresolved } = resolveRuntimeMap({ cli, manifest: MANIFEST_WITH_PROVIDER, runtimeMap: new Map([["rt_SRC1", "rt_EXPLICIT"]]) });
  assert.deepEqual(unresolved, []);
  assert.equal(effective.get("rt_SRC1"), "rt_EXPLICIT");
});

test("resolveRuntimeMap leaves it unresolved (without calling the CLI) when no provider was recorded", () => {
  const cli = { json: () => { throw new Error("must not list runtimes with nothing resolvable"); } };
  const manifest = { agents: [{ sourceRuntimeId: "rt_SRC1" }] }; // older bundle, no sourceRuntimeProvider
  const { unresolved } = resolveRuntimeMap({ cli, manifest, runtimeMap: new Map() });
  assert.deepEqual(unresolved, [{ srcId: "rt_SRC1", provider: undefined, matchCount: 0 }]);
});
