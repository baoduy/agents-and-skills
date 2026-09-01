import { test } from "node:test";
import assert from "node:assert/strict";
import { importSkills } from "../../plugins/multica-tool/scripts/multica-import.mjs";

const MANIFEST = {
  version: "1", scope: "skill", source_workspace_id: "ws_SRC",
  skills: [{ name: "Greet", dir: "skills/greet", source_id: "sk_SRC1" }],
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
  version: "1", scope: "agent", source_workspace_id: "ws_SRC", skills: [],
  agents: [{ name: "Helper", file: "agents/helper.json", source_runtime_id: "rt_SRC1", skill_names: ["Greet"] }],
  squads: [],
};
const AGENT_FILE = JSON.stringify({ name: "Helper", instructions: "be nice", model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6, source_id: "ag_SRC1", source_runtime_id: "rt_SRC1", skill_names: ["Greet"] });

test("importAgents remaps runtime id and sets mapped skill ids", () => {
  const fs = { existsSync: () => true, readFileSync: () => AGENT_FILE, readdirSync: () => [] };
  const calls = [];
  const cli = { calls, json: (a) => (a[1] === "list" ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; } };
  const { idMap, sourceIdMap } = importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  assert.equal(idMap.get("Helper"), "ag_NEW1");
  assert.equal(sourceIdMap.get("ag_SRC1"), "ag_NEW1", "source agent id mapped to new id, for mention rewriting");
  const create = calls.find((a) => a[1] === "create");
  assert.ok(create.includes("--runtime-id") && create[create.indexOf("--runtime-id") + 1] === "rt_TGT1", "mapped runtime applied");
  const set = calls.find((a) => a[1] === "skills" && a[2] === "set");
  assert.equal(set[set.indexOf("--skill-ids") + 1], "sk_NEW1", "mapped skill id applied");
});

test("importAgents reads instructions from the sibling .md when instructions_file is set", () => {
  const files = {
    "./agents/helper.json": JSON.stringify({ name: "Helper", instructions_file: "agents/helper.md", model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6, source_id: "ag_SRC1", source_runtime_id: "rt_SRC1", skill_names: [] }),
    "./agents/helper.md": "enhanced instructions from md",
  };
  const fs = memFs(files);
  const calls = [];
  const cli = { calls, json: (a) => (a[1] === "list" ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; } };
  importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map(), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  const create = calls.find((a) => a[0] === "agent" && a[1] === "create");
  assert.equal(create[create.indexOf("--instructions") + 1], "enhanced instructions from md", "instructions came from the .md, not the JSON");
});

test("importAgents falls back to inline JSON instructions when there is no instructions_file (legacy bundle)", () => {
  const fs = { existsSync: () => true, readFileSync: () => AGENT_FILE, readdirSync: () => [] };
  const calls = [];
  const cli = { calls, json: (a) => (a[1] === "list" ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; } };
  importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  const create = calls.find((a) => a[0] === "agent" && a[1] === "create");
  assert.equal(create[create.indexOf("--instructions") + 1], "be nice", "legacy inline instructions still used when no instructions_file");
});

const AGENT_FILE_WITH_SECRETS = JSON.stringify({
  name: "Helper", instructions: "be nice", model: "claude-sonnet-4-6", visibility: "workspace",
  max_concurrent_tasks: 6, source_id: "ag_SRC1", source_runtime_id: "rt_SRC1", skill_names: ["Greet"],
  mcp_config: { mcpServers: { x: { command: "npx" } } }, custom_env: { API_KEY: "secret-value" },
});

test("importAgents (create path): mcp-config and custom-env are applied via separate follow-up calls, not bundled into agent create", () => {
  const fs = { existsSync: () => true, readFileSync: () => AGENT_FILE_WITH_SECRETS, readdirSync: () => [] };
  const calls = [];
  const cli = {
    calls,
    json: (a) => (a[1] === "list" ? [] : {}),
    run: (a, opts) => { calls.push({ a, opts }); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; },
  };
  const { secretsApplyFailures } = importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });

  const create = calls.find((c) => c.a.includes("create"));
  assert.ok(!create.a.includes("--mcp-config-stdin"), "secrets never bundled into the create call itself");
  assert.equal(create.opts, undefined);

  const mcpUpdate = calls.find((c) => c.a[0] === "agent" && c.a[1] === "update" && c.a.includes("--mcp-config-stdin"));
  assert.ok(mcpUpdate, "a separate agent update --mcp-config-stdin follow-up call is issued");
  assert.equal(mcpUpdate.a[2], "ag_NEW1", "targets the newly created agent's id");
  assert.equal(mcpUpdate.opts.input, JSON.stringify({ mcpServers: { x: { command: "npx" } } }), "mcp config JSON piped via stdin, never inline");

  const envSet = calls.find((c) => c.a[0] === "agent" && c.a[1] === "env" && c.a[2] === "set");
  assert.ok(envSet, "a separate agent env set call is issued for custom env");
  assert.equal(envSet.a[3], "ag_NEW1");
  assert.ok(envSet.a.includes("--custom-env-stdin"));
  assert.equal(envSet.opts.input, JSON.stringify({ API_KEY: "secret-value" }));
  assert.deepEqual(secretsApplyFailures, []);
});

test("importAgents (update path): follow-up calls target the existing matched agent's id", () => {
  const fs = { existsSync: () => true, readFileSync: () => AGENT_FILE_WITH_SECRETS, readdirSync: () => [] };
  const calls = [];
  const cli = {
    calls,
    json: (a) => (a[1] === "list" ? [{ id: "ag_TGT9", name: "Helper" }] : {}),
    run: (a, opts) => { calls.push({ a, opts }); return "{}"; },
  };
  importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  const mcpUpdate = calls.find((c) => c.a[0] === "agent" && c.a[1] === "update" && c.a.includes("--mcp-config-stdin"));
  assert.equal(mcpUpdate.a[2], "ag_TGT9", "not a freshly created id — the existing matched agent");
  const envSet = calls.find((c) => c.a[0] === "agent" && c.a[1] === "env" && c.a[2] === "set");
  assert.equal(envSet.a[3], "ag_TGT9");
});

test("importAgents skips both follow-up calls when the source has neither secret", () => {
  const fs = { existsSync: () => true, readFileSync: () => AGENT_FILE, readdirSync: () => [] }; // no mcp_config/custom_env keys
  const calls = [];
  const cli = { calls, json: (a) => (a[1] === "list" ? [] : {}), run: (a, opts) => { calls.push({ a, opts }); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; } };
  const { secretsApplyFailures } = importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  assert.ok(!calls.some((c) => c.a.includes("--mcp-config-stdin")));
  assert.ok(!calls.some((c) => c.a[0] === "agent" && c.a[1] === "env" && c.a[2] === "set"));
  assert.deepEqual(secretsApplyFailures, []);
});

test("importAgents records a secretsApplyFailure and keeps the agent created when a follow-up call throws", () => {
  const fs = { existsSync: () => true, readFileSync: () => AGENT_FILE_WITH_SECRETS, readdirSync: () => [] };
  const cli = {
    json: (a) => (a[1] === "list" ? [] : {}),
    run: (a) => {
      if (a.includes("create")) return '{"id":"ag_NEW1"}';
      if (a[0] === "agent" && a[1] === "update" && a.includes("--mcp-config-stdin")) throw new Error("server rejected mcp_config");
      return "{}";
    },
  };
  const { created, secretsApplyFailures } = importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  assert.equal(created, 1, "the agent itself is still created — only its mcp_config failed to apply");
  assert.deepEqual(secretsApplyFailures, ["Helper"]);
});

test("importAgents threads description through to create (regression: was silently dropped)", () => {
  const fs = { existsSync: () => true, readFileSync: () => JSON.stringify({ ...JSON.parse(AGENT_FILE), description: "helps with stuff" }), readdirSync: () => [] };
  const calls = [];
  const cli = { calls, json: (a) => (a[1] === "list" ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; } };
  importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  const create = calls.find((a) => a[1] === "create");
  assert.equal(create[create.indexOf("--description") + 1], "helps with stuff");
});

test("importAgents reads description from a sibling .description.md when description_file is set", () => {
  const fs = {
    existsSync: () => true,
    readFileSync: (p) => p.endsWith(".description.md")
      ? "the full description prose"
      : JSON.stringify({ ...JSON.parse(AGENT_FILE), description_file: "agents/helper.description.md" }),
    readdirSync: () => [],
  };
  const calls = [];
  const cli = { calls, json: (a) => (a[1] === "list" ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; } };
  importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  const create = calls.find((a) => a[1] === "create");
  assert.equal(create[create.indexOf("--description") + 1], "the full description prose", "description_file content wins over inline");
});

test("importAgents (create): uploads an image avatar from the bundle via agent avatar --file", () => {
  const fs = { existsSync: () => true, readFileSync: () => JSON.stringify({ ...JSON.parse(AGENT_FILE), avatar_file: "agents/helper.avatar.png" }), readdirSync: () => [] };
  const calls = [];
  const cli = { calls, json: (a) => (a[1] === "list" ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; } };
  const { avatarApplyFailures, avatarUnsupported } = importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  const up = calls.find((a) => a[0] === "agent" && a[1] === "avatar");
  assert.deepEqual(up, ["agent", "avatar", "ag_NEW1", "--file", "./agents/helper.avatar.png"]);
  assert.deepEqual(avatarApplyFailures, []);
  assert.deepEqual(avatarUnsupported, []);
});

test("importAgents (update): never clobbers the avatar when the existing agent already has one", () => {
  const fs = { existsSync: () => true, readFileSync: () => JSON.stringify({ ...JSON.parse(AGENT_FILE), avatar_file: "agents/helper.avatar.png" }), readdirSync: () => [] };
  const calls = [];
  const cli = { calls, json: (a) => (a[1] === "list" ? [{ id: "ag_TGT9", name: "Helper", avatar_url: "emoji:🦊" }] : {}), run: (a) => { calls.push(a); return "{}"; } };
  importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  assert.ok(!calls.some((a) => a[0] === "agent" && a[1] === "avatar"), "existing agent already has an avatar → left untouched");
});

test("importAgents (update): sets the avatar when the existing agent has none", () => {
  const fs = { existsSync: () => true, readFileSync: () => JSON.stringify({ ...JSON.parse(AGENT_FILE), avatar_file: "agents/helper.avatar.png" }), readdirSync: () => [] };
  const calls = [];
  const cli = { calls, json: (a) => (a[1] === "list" ? [{ id: "ag_TGT9", name: "Helper" }] : {}), run: (a) => { calls.push(a); return "{}"; } };
  importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  const up = calls.find((a) => a[0] === "agent" && a[1] === "avatar");
  assert.equal(up?.[2], "ag_TGT9", "avatar applied to the existing agent that had none");
});

test("importAgents flags an emoji-only avatar as unsupported (no CLI setter for agents)", () => {
  const fs = { existsSync: () => true, readFileSync: () => JSON.stringify({ ...JSON.parse(AGENT_FILE), avatar_url: "emoji:🤖" }), readdirSync: () => [] };
  const calls = [];
  const cli = { calls, json: (a) => (a[1] === "list" ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; } };
  const { avatarUnsupported } = importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  assert.deepEqual(avatarUnsupported, ["Helper"]);
  assert.ok(!calls.some((a) => a[0] === "agent" && a[1] === "avatar"), "no file to upload for an emoji-only avatar");
});

test("importAgents passes --service-tier when set, omits it when empty", () => {
  const mk = (svc) => {
    const fs = { existsSync: () => true, readFileSync: () => JSON.stringify({ ...JSON.parse(AGENT_FILE), service_tier: svc }), readdirSync: () => [] };
    const calls = [];
    const cli = { calls, json: (a) => (a[1] === "list" ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; } };
    importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
    return calls.find((a) => a[1] === "create");
  };
  const withTier = mk("flex");
  assert.equal(withTier[withTier.indexOf("--service-tier") + 1], "flex");
  assert.ok(!mk("").includes("--service-tier"), "empty service_tier omitted");
});

test("importAgents restores member-specific public_to only for members that exist in the destination", () => {
  const rec = { ...JSON.parse(AGENT_FILE), permission_mode: "public_to", invocation_targets: [{ target_id: "u1", target_type: "user" }, { target_id: "u_missing", target_type: "user" }] };
  const fs = { existsSync: () => true, readFileSync: () => JSON.stringify(rec), readdirSync: () => [] };
  const calls = [];
  const cli = {
    calls,
    json: (a) => {
      if (a[0] === "workspace" && a[1] === "member" && a[2] === "list") return [{ user_id: "u1" }, { user_id: "u2" }];
      if (a[1] === "list") return [];
      return {};
    },
    run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; },
  };
  const { permissionUnsupported } = importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  const pub = calls.find((a) => a.includes("--public-to-member"));
  assert.deepEqual(pub, ["agent", "update", "ag_NEW1", "--permission-mode", "public_to", "--public-to-member", "u1"], "only the resolvable member id applied, with explicit public_to mode");
  assert.deepEqual(permissionUnsupported, [], "at least one member resolved, so not unsupported");
});

test("importAgents reports permissionUnsupported and makes no call when no member target resolves", () => {
  const rec = { ...JSON.parse(AGENT_FILE), permission_mode: "public_to", invocation_targets: [{ target_id: "u_gone", target_type: "user" }] };
  const fs = { existsSync: () => true, readFileSync: () => JSON.stringify(rec), readdirSync: () => [] };
  const calls = [];
  const cli = {
    calls,
    json: (a) => {
      if (a[0] === "workspace" && a[1] === "member" && a[2] === "list") return [{ user_id: "u1" }];
      if (a[1] === "list") return [];
      return {};
    },
    run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; },
  };
  const { permissionUnsupported } = importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  assert.deepEqual(permissionUnsupported, ["Helper"]);
  assert.ok(!calls.some((a) => a.includes("--public-to-member")), "no call when nothing resolves");
});

test("importAgents makes no public-to-member call for a workspace-wide public_to agent", () => {
  const rec = { ...JSON.parse(AGENT_FILE), permission_mode: "public_to", invocation_targets: [{ target_id: "ws", target_type: "workspace" }] };
  const fs = { existsSync: () => true, readFileSync: () => JSON.stringify(rec), readdirSync: () => [] };
  const calls = [];
  const cli = { calls, json: (a) => (a[1] === "list" ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; } };
  importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  assert.ok(!calls.some((a) => a.includes("--public-to-member")), "workspace target handled by --visibility, no follow-up");
  assert.ok(!calls.some((a) => a[0] === "workspace" && a[1] === "member"), "member list never fetched when no user targets");
});

test("importAgents throws when runtime is unmapped", () => {
  const fs = { existsSync: () => true, readFileSync: () => AGENT_FILE, readdirSync: () => [] };
  const cli = { json: () => [], run: () => "{}" };
  assert.throws(
    () => importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map(), runtimeMap: new Map(), fs }),
    /unmapped runtime/i
  );
});

import { rewriteMentions, rewriteAgentMentions } from "../../plugins/multica-tool/scripts/multica-import.mjs";

test("rewriteMentions replaces known agent mention ids, leaves unknown ones untouched", () => {
  const text = "- [@dev-backend](mention://agent/ag_SRC1)\n- [@dev-qc](mention://agent/ag_SRC2)\n- [@ghost](mention://agent/ag_UNKNOWN)";
  const idMap = new Map([["ag_SRC1", "ag_NEW1"], ["ag_SRC2", "ag_NEW2"]]);
  assert.equal(
    rewriteMentions(text, idMap),
    "- [@dev-backend](mention://agent/ag_NEW1)\n- [@dev-qc](mention://agent/ag_NEW2)\n- [@ghost](mention://agent/ag_UNKNOWN)"
  );
});

test("rewriteMentions is a no-op on text with no mentions, or empty/missing text", () => {
  assert.equal(rewriteMentions("plain instructions, no mentions here", new Map([["a", "b"]])), "plain instructions, no mentions here");
  assert.equal(rewriteMentions("", new Map()), "");
  assert.equal(rewriteMentions(undefined, new Map()), undefined);
});

const MENTION_MANIFEST = {
  version: "1", scope: "squad", source_workspace_id: "ws_SRC", skills: [],
  agents: [
    { name: "Helper", file: "agents/helper.json" },
    { name: "Helper2", file: "agents/helper2.json" },
  ],
  squads: [],
};
const MENTION_FILES = {
  "agents/helper.json": JSON.stringify({ name: "Helper", instructions: "Coordinate with [@helper2](mention://agent/ag_SRC2)." }),
  "agents/helper2.json": JSON.stringify({ name: "Helper2", instructions: "no mentions here" }),
};

test("rewriteAgentMentions updates only agents whose instructions reference a known source id", () => {
  const fs = { readFileSync: (p) => MENTION_FILES[p.replace(/^\.\//, "")] };
  const calls = [];
  const cli = { calls, run: (a) => { calls.push(a); return "{}"; } };
  const agentIdMap = new Map([["Helper", "ag_NEW1"], ["Helper2", "ag_NEW2"]]);
  const sourceIdMap = new Map([["ag_SRC1", "ag_NEW1"], ["ag_SRC2", "ag_NEW2"]]);
  const { updated } = rewriteAgentMentions({ cli, manifest: MENTION_MANIFEST, dir: ".", agentIdMap, sourceIdMap, fs });
  assert.equal(updated, 1, "only Helper's instructions contained a rewritable mention");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["agent", "update", "ag_NEW1", "--instructions", "Coordinate with [@helper2](mention://agent/ag_NEW2)."]);
});

import { importSquad } from "../../plugins/multica-tool/scripts/multica-import.mjs";

const SQUAD_ENTRY = {
  name: "Team", file: "squads/team.json", leader_name: "Helper", instructions: "# Team charter\nDeliver features.",
  members: [{ agent_name: "Helper", role: "leader" }, { agent_name: "Helper2", role: "member" }],
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

test("importSquad rewrites agent mentions in instructions from source ids to new ids", () => {
  const calls = [];
  const cli = { calls, json: (a) => (a.includes("list") ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"sq_NEW1"}' : "{}"; } };
  const squad = { ...SQUAD_ENTRY, instructions: "Teammates:\n- [@dev-backend](mention://agent/ag_SRC1)\n- [@dev-qc](mention://agent/ag_SRC2)" };
  const agentIdMap = new Map([["Helper", "ag_NEW1"], ["Helper2", "ag_NEW2"]]);
  const sourceIdMap = new Map([["ag_SRC1", "ag_NEW1"], ["ag_SRC2", "ag_NEW2"]]);
  importSquad({ cli, squad, agentIdMap, sourceIdMap });
  const create = calls.find((a) => a[1] === "create");
  assert.equal(
    create[create.indexOf("--instructions") + 1],
    "Teammates:\n- [@dev-backend](mention://agent/ag_NEW1)\n- [@dev-qc](mention://agent/ag_NEW2)"
  );
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

test("importSquad sets the avatar-url on a newly created squad", () => {
  const calls = [];
  const cli = { calls, json: (a) => (a.includes("list") ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"sq_NEW1"}' : "{}"; } };
  const agentIdMap = new Map([["Helper", "ag_NEW1"], ["Helper2", "ag_NEW2"]]);
  importSquad({ cli, squad: { ...SQUAD_ENTRY, avatar_url: "emoji:🦍" }, agentIdMap });
  const av = calls.find((a) => a[0] === "squad" && a[1] === "update" && a.includes("--avatar-url"));
  assert.deepEqual(av, ["squad", "update", "sq_NEW1", "--avatar-url", "emoji:🦍"]);
});

test("importSquad never clobbers the avatar when the existing squad already has one", () => {
  const calls = [];
  const cli = {
    calls,
    json: (a) => {
      if (a[1] === "member" && a[2] === "list") return [];
      if (a.includes("list")) return [{ id: "sq_OLD", name: "Team", avatar_url: "emoji:🐸" }];
      return {};
    },
    run: (a) => { calls.push(a); return "{}"; },
  };
  const agentIdMap = new Map([["Helper", "ag_NEW1"], ["Helper2", "ag_NEW2"]]);
  importSquad({ cli, squad: { ...SQUAD_ENTRY, avatar_url: "emoji:🦍" }, agentIdMap });
  assert.ok(!calls.some((a) => a.includes("--avatar-url")), "existing squad already has an avatar → left untouched");
});

import { collectSourceRuntimes } from "../../plugins/multica-tool/scripts/multica-import.mjs";

test("collectSourceRuntimes returns distinct ids", () => {
  const m = { agents: [{ source_runtime_id: "rt_a" }, { source_runtime_id: "rt_a" }, { source_runtime_id: "rt_b" }] };
  assert.deepEqual(collectSourceRuntimes(m).sort(), ["rt_a", "rt_b"]);
});

import { resolveRuntimeMap } from "../../plugins/multica-tool/scripts/multica-import.mjs";
import { RUNTIME_LIST_DEST_UNIQUE, RUNTIME_LIST_DEST_AMBIGUOUS } from "./fixtures.mjs";

const MANIFEST_WITH_PROVIDER = { agents: [{ source_runtime_id: "rt_SRC1", source_runtime_provider: "claude" }] };

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
  const manifest = { agents: [{ source_runtime_id: "rt_SRC1" }] }; // older bundle, no source_runtime_provider
  const { unresolved } = resolveRuntimeMap({ cli, manifest, runtimeMap: new Map() });
  assert.deepEqual(unresolved, [{ srcId: "rt_SRC1", provider: undefined, matchCount: 0 }]);
});

import { importBundle, parseInclude } from "../../plugins/multica-tool/scripts/multica-import.mjs";

test("importBundle imports every squad and returns a squadIdMap", () => {
  const files = {
    "b/manifest.json": JSON.stringify({
      version: "1", scope: "all", source_workspace_id: "ws_SRC",
      skills: [],
      agents: [{ name: "Helper", file: "agents/helper.json", source_runtime_id: "rt_SRC1", source_runtime_provider: "claude", skill_names: [] }],
      squads: [
        { name: "A", file: "squads/a.json", leader_name: "Helper", instructions: "", members: [{ agent_name: "Helper", role: "leader" }] },
        { name: "B", file: "squads/b.json", leader_name: "Helper", instructions: "", members: [{ agent_name: "Helper", role: "leader" }] },
      ],
    }),
    "b/agents/helper.json": JSON.stringify({ name: "Helper", instructions: "be nice", model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6, source_id: "ag_SRC1", source_runtime_id: "rt_SRC1", skill_names: [] }),
  };
  const fs = { existsSync: (p) => p in files, readFileSync: (p) => files[p], readdirSync: () => [] };
  let sqN = 0;
  const cli = {
    json: (a) => {
      if (a[0] === "runtime" && a[1] === "list") return [{ id: "rt_TGT1", provider: "claude" }];
      if (a[0] === "squad" && a[1] === "member" && a[2] === "list") return [];
      if (a[1] === "list") return [];
      return {};
    },
    run: (a) => {
      if (a[0] === "squad" && a[1] === "create") return `{"id":"sq_NEW${++sqN}"}`;
      if (a.includes("create")) return '{"id":"ag_NEW1"}';
      return "{}";
    },
  };
  const res = importBundle({ cli, dir: "b", runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  assert.equal(res.created.squads, 2, "both squads created");
  assert.deepEqual(Object.keys(res.squadIdMap).sort(), ["A", "B"]);
  assert.ok(!("squadId" in res), "single squadId replaced by squadIdMap");
});

test("importBundle reads squad instructions from the squad .md", () => {
  const files = {
    "./manifest.json": JSON.stringify({
      version: "1", skills: [],
      agents: [{ name: "Helper", file: "agents/helper.json", source_runtime_id: "rt_SRC1", skill_names: [] }],
      squads: [{ name: "Team", file: "squads/team.json", leader_name: "Helper", instructions_file: "squads/team.md", members: [{ agent_name: "Helper", role: "leader" }] }],
    }),
    "./agents/helper.json": JSON.stringify({ name: "Helper", model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6, source_id: "ag_SRC1", source_runtime_id: "rt_SRC1", skill_names: [] }),
    "./squads/team.md": "# Charter from md",
  };
  const fs = memFs(files);
  const calls = [];
  const cli = {
    json: (a) => {
      if (a[0] === "squad" && a[1] === "member" && a[2] === "list") return [];
      if (a[1] === "list") return [];
      return {};
    },
    run: (a) => {
      calls.push(a);
      if (a[0] === "squad" && a[1] === "create") return '{"id":"sq_NEW1"}';
      if (a.includes("create")) return '{"id":"ag_NEW1"}';
      return "{}";
    },
  };
  importBundle({ cli, dir: ".", runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  const squadCreate = calls.find((a) => a[0] === "squad" && a[1] === "create");
  assert.equal(squadCreate[squadCreate.indexOf("--instructions") + 1], "# Charter from md", "squad instructions read from the .md");
});

import { importProjects } from "../../plugins/multica-tool/scripts/multica-import.mjs";

const PROJECT_MANIFEST = {
  version: "1", scope: "projects", source_workspace_id: "ws_SRC",
  skills: [], agents: [], squads: [],
  projects: [
    { title: "Launch", file: "projects/launch.json", source_id: "pr_SRC1", lead_name: "Helper", lead_type: "agent" },
  ],
};
const LAUNCH_REC = {
  title: "Launch", description: "the launch", icon: "🚀",
  priority: "high", status: "in_progress", due_date: null, start_date: null,
  source_id: "pr_SRC1", lead_type: "agent", lead_name: "Helper", lead_source_id: "ag_SRC1",
  resources: [
    { resource_type: "github_repo", resource_ref: { url: "https://github.com/x/repo.git" }, label: null },
    { resource_type: "local_directory", resource_ref: { path: "/x" }, label: "local" },
  ],
};
// recordingCli that answers project list / resource list / agent list.
function projectRecordingCli({ existingProjects = [], existingAgents = [], existingResources = [] } = {}) {
  const calls = [];
  return {
    calls,
    json: (args) => {
      const k = args.slice(0, 3).join(" ");
      if (args[0] === "project" && args[1] === "list") return existingProjects;
      if (k.startsWith("project resource list")) return existingResources;
      if (args[0] === "agent" && args[1] === "list") return existingAgents;
      return {};
    },
    run: (args) => { calls.push(args); return args.includes("create") ? '{"id":"pr_NEW1"}' : "{}"; },
  };
}

test("importProjects creates the project, sets --lead to the imported agent, adds github_repo resource, reports unsupported bits", () => {
  const fs = memFs({ "./projects/launch.json": JSON.stringify(LAUNCH_REC) });
  const cli = projectRecordingCli();
  const agentIdMap = new Map([["Helper", "ag_NEW1"]]);
  const r = importProjects({ cli, manifest: PROJECT_MANIFEST, dir: ".", agentIdMap, fs });
  assert.equal(r.created, 1);
  const create = cli.calls.find((a) => a[0] === "project" && a[1] === "create");
  assert.equal(create[create.indexOf("--lead") + 1], "Helper", "lead set by agent name");
  assert.equal(create[create.indexOf("--title") + 1], "Launch");
  assert.ok(!create.includes("--priority"), "priority is never passed (no CLI flag)");
  const addRepo = cli.calls.find((a) => a[0] === "project" && a[1] === "resource" && a[2] === "add");
  assert.equal(addRepo[addRepo.indexOf("--url") + 1], "https://github.com/x/repo.git");
  assert.deepEqual(r.priorityUnsupported, ["Launch"]);
  assert.deepEqual(r.resourcesUnsupported, ["Launch:local_directory"]);
  assert.deepEqual(r.leadUnresolved, []);
});

test("importProjects reads description from a sibling .description.md when description_file is set", () => {
  const { description, ...noDesc } = LAUNCH_REC;
  const fs = memFs({
    "./projects/launch.json": JSON.stringify({ ...noDesc, description_file: "projects/launch.description.md" }),
    "./projects/launch.description.md": "the full launch brief",
  });
  const cli = projectRecordingCli();
  importProjects({ cli, manifest: PROJECT_MANIFEST, dir: ".", agentIdMap: new Map([["Helper", "ag_NEW1"]]), fs });
  const create = cli.calls.find((a) => a[1] === "create");
  assert.equal(create[create.indexOf("--description") + 1], "the full launch brief", "description came from the .md, not inline JSON");
});

test("importProjects updates by title and does not re-add an existing resource (idempotent)", () => {
  const fs = memFs({ "./projects/launch.json": JSON.stringify(LAUNCH_REC) });
  const cli = projectRecordingCli({
    existingProjects: [{ id: "pr_TGT9", title: "Launch" }],
    existingResources: [{ resource_type: "github_repo", resource_ref: { url: "https://github.com/x/repo.git" }, label: null }],
  });
  const r = importProjects({ cli, manifest: PROJECT_MANIFEST, dir: ".", agentIdMap: new Map([["Helper", "ag_NEW1"]]), fs });
  assert.equal(r.updated, 1); assert.equal(r.created, 0);
  assert.equal(r.idMap.get("Launch"), "pr_TGT9");
  assert.ok(cli.calls.some((a) => a[0] === "project" && a[1] === "update" && a[2] === "pr_TGT9"));
  assert.ok(!cli.calls.some((a) => a[1] === "resource" && a[2] === "add"), "existing url not re-added");
});

test("importProjects records leadUnresolved and omits --lead when the agent is nowhere", () => {
  const fs = memFs({ "./projects/launch.json": JSON.stringify(LAUNCH_REC) });
  const cli = projectRecordingCli(); // no existing agents, empty agentIdMap
  const r = importProjects({ cli, manifest: PROJECT_MANIFEST, dir: ".", agentIdMap: new Map(), fs });
  const create = cli.calls.find((a) => a[1] === "create");
  assert.ok(!create.includes("--lead"), "no lead flag when unresolvable");
  assert.deepEqual(r.leadUnresolved, ["Launch"]);
});

// Minimal bundle: one agent (Helper) + one project (Launch) led by Helper.
function bundleFs() {
  return memFs({
    "./manifest.json": JSON.stringify({
      version: "1", scope: "all", source_workspace_id: "ws_SRC",
      skills: [], squads: [],
      agents: [{ name: "Helper", file: "agents/helper.json", source_id: "ag_SRC1", source_runtime_id: "rt_SRC1", source_runtime_provider: "claude", skill_names: [], had_secrets: false }],
      projects: [{ title: "Launch", file: "projects/launch.json", source_id: "pr_SRC1", lead_name: "Helper", lead_type: "agent" }],
    }),
    "./agents/helper.json": JSON.stringify({ name: "Helper", visibility: "workspace", max_concurrent_tasks: 6, source_runtime_id: "rt_SRC1", skill_names: [] }),
    "./projects/launch.json": JSON.stringify(LAUNCH_REC),
  });
}
function fullRecordingCli() {
  const calls = [];
  return {
    calls,
    json: (args) => {
      if (args[0] === "runtime" && args[1] === "list") return [{ id: "rt_TGT1", provider: "claude" }];
      if (args[0] === "agent" && args[1] === "list") return [];
      if (args[0] === "project" && args[1] === "list") return [];
      if (args[0] === "project" && args[1] === "resource") return [];
      if (args[0] === "squad" && args[1] === "list") return [];
      return {};
    },
    run: (args) => { calls.push(args); return args.includes("create") ? '{"id":"NEW"}' : "{}"; },
  };
}

test("parseInclude defaults to agents+squads (+skills), projects opt-in", () => {
  assert.deepEqual([...parseInclude(null)].sort(), ["agents", "skills", "squads"]);
  assert.deepEqual([...parseInclude("projects")].sort(), ["projects"]);
  assert.deepEqual([...parseInclude("agents,projects")].sort(), ["agents", "projects", "skills"]);
});

test("importBundle default include does NOT import projects", () => {
  const cli = fullRecordingCli();
  const res = importBundle({ cli, dir: ".", runtimeMap: new Map(), fs: bundleFs() });
  assert.equal(res.created.projects, 0);
  assert.ok(!cli.calls.some((a) => a[0] === "project" && a[1] === "create"), "no project write by default");
  assert.ok(cli.calls.some((a) => a[0] === "agent" && a[1] === "create"), "agents still imported");
});

test("importBundle with projects in include creates the project led by the imported agent", () => {
  const cli = fullRecordingCli();
  const res = importBundle({ cli, dir: ".", runtimeMap: new Map(), include: new Set(["skills", "agents", "projects"]), fs: bundleFs() });
  assert.equal(res.created.projects, 1);
  const create = cli.calls.find((a) => a[0] === "project" && a[1] === "create");
  assert.equal(create[create.indexOf("--lead") + 1], "Helper");
  assert.deepEqual(res.priorityUnsupported, ["Launch"]);
});

test("importBundle skips a squad whose leader was not imported (agents excluded)", () => {
  const fs = memFs({
    "./manifest.json": JSON.stringify({
      version: "1", scope: "all", source_workspace_id: "ws_SRC",
      skills: [], agents: [], projects: [],
      squads: [{ name: "Team", file: "squads/team.json", leader_name: "Helper", members: [] }],
    }),
    "./squads/team.json": JSON.stringify({ name: "Team", description: "", leader_name: "Helper", members: [] }),
  });
  const cli = fullRecordingCli();
  const res = importBundle({ cli, dir: ".", runtimeMap: new Map(), include: new Set(["squads"]), fs });
  assert.deepEqual(res.squadsSkipped, ["Team"]);
  assert.ok(!cli.calls.some((a) => a[0] === "squad" && a[1] === "create"));
});

import { preflight } from "../../plugins/multica-tool/scripts/multica-import.mjs";

test("preflight reports counts and project incompatibilities without writing", () => {
  const cli = fullRecordingCli();
  const rep = preflight({ cli, dir: ".", runtimeMap: new Map(), include: new Set(["skills", "agents", "projects"]), fs: bundleFs() });
  assert.deepEqual(rep.bundle, { skills: 0, agents: 1, squads: 0, projects: 1, autopilots: 0, labels: 0, properties: 0 });
  assert.deepEqual(rep.willImport, { skills: 0, agents: 1, squads: 0, projects: 1, autopilots: 0, labels: 0, properties: 0 });
  assert.ok(rep.incompatibilities.some((i) => i.type === "priority-not-settable" && i.detail.includes("Launch")));
  assert.ok(rep.incompatibilities.some((i) => i.type === "resource-not-portable" && i.detail.includes("local_directory")));
  assert.equal(cli.calls.length, 0, "dry-run performs no writes");
});

test("preflight flags lead-agent-missing when projects are imported without agents", () => {
  const cli = fullRecordingCli();
  const rep = preflight({ cli, dir: ".", runtimeMap: new Map(), include: new Set(["projects"]), fs: bundleFs() });
  assert.equal(rep.willImport.agents, 0);
  assert.ok(rep.incompatibilities.some((i) => i.type === "lead-agent-missing" && i.detail.includes("Helper")));
});
