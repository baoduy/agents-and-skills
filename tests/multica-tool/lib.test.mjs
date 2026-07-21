import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, makeCli, requireAuth, resolveWorkspaceId, listRuntimes, findByName, getSkill, getAgent, getAgentCustomEnv, getSquad, getSquadMembers } from "../../plugins/multica-tool/scripts/lib.mjs";
import { SKILL_GET, AGENT_GET, AGENT_ENV_GET, SQUAD_GET, SQUAD_MEMBERS, RUNTIME_LIST } from "./fixtures.mjs";

test("slugify makes filesystem-safe slugs", () => {
  assert.equal(slugify("My Cool Skill!"), "my-cool-skill");
  assert.equal(slugify("  a / b  "), "a-b");
  assert.equal(slugify(""), "unnamed");
});

test("cli.json appends --output json and threads workspace id, parses stdout", () => {
  const calls = [];
  const exec = (args) => { calls.push(args); return { stdout: '{"ok":true}', stderr: "", status: 0 }; };
  const cli = makeCli(exec, { workspaceId: "ws_9" });
  const out = cli.json(["skill", "get", "sk_1"]);
  assert.deepEqual(out, { ok: true });
  assert.deepEqual(calls[0], ["skill", "get", "sk_1", "--workspace-id", "ws_9", "--output", "json"]);
});

test("cli.run forwards an opts bag (e.g. stdin input) through to exec", () => {
  const calls = [];
  const exec = (args, opts) => { calls.push({ args, opts }); return { stdout: "ok", stderr: "", status: 0 }; };
  const cli = makeCli(exec, { workspaceId: "ws_9" });
  cli.run(["agent", "update", "ag_1", "--mcp-config-stdin"], { input: '{"mcpServers":{}}' });
  assert.deepEqual(calls[0].args, ["agent", "update", "ag_1", "--mcp-config-stdin", "--workspace-id", "ws_9"]);
  assert.deepEqual(calls[0].opts, { input: '{"mcpServers":{}}' });
});

test("cli.run works with no opts arg (backward compatible)", () => {
  const exec = (args, opts) => { assert.equal(opts, undefined); return { stdout: "ok", stderr: "", status: 0 }; };
  const cli = makeCli(exec);
  assert.equal(cli.run(["skill", "list"]), "ok");
});

test("cli.run throws stderr on non-zero exit", () => {
  const exec = () => ({ stdout: "", stderr: "boom", status: 1 });
  const cli = makeCli(exec);
  assert.throws(() => cli.run(["skill", "list"]), /boom/);
});

test("requireAuth throws when auth status fails", () => {
  assert.throws(() => requireAuth(() => ({ stdout: "", stderr: "", status: 1 })), /multica login/);
  assert.doesNotThrow(() => requireAuth(() => ({ stdout: "ok", stderr: "", status: 0 })));
});

function cliReturning(map) {
  // map: args.join(" ") -> object
  return {
    json: (args) => map[args.join(" ")],
    run: () => "",
  };
}

test("resolveWorkspaceId returns id for exact name", () => {
  const cli = cliReturning({ "workspace list": [{ id: "ws_1", name: "Alpha" }, { id: "ws_2", name: "Beta" }] });
  assert.equal(resolveWorkspaceId(cli, "Beta"), "ws_2");
});

test("resolveWorkspaceId throws on unknown and ambiguous", () => {
  const cli = cliReturning({ "workspace list": [{ id: "ws_1", name: "Dup" }, { id: "ws_2", name: "Dup" }] });
  assert.throws(() => resolveWorkspaceId(cli, "Nope"), /Unknown workspace/);
  assert.throws(() => resolveWorkspaceId(cli, "Dup"), /Ambiguous workspace/);
});

test("findByName throws on duplicate, null on miss", () => {
  assert.equal(findByName([{ name: "a" }], "b"), null);
  assert.throws(() => findByName([{ name: "a" }, { name: "a" }], "a"), /Duplicate name/);
});

test("listRuntimes returns parsed list", () => {
  const cli = cliReturning({ "runtime list": RUNTIME_LIST });
  assert.equal(listRuntimes(cli)[0].name, "My Runtime");
});

test("getSkill trims files to {path,content}", () => {
  const cli = cliReturning({ "skill get sk_SRC1": SKILL_GET });
  const s = getSkill(cli, "sk_SRC1");
  assert.equal(s.content, "# Greet\nbody");
  assert.deepEqual(s.files, [{ path: "ref.md", content: "extra" }]);
});

test("getAgent normalizes snake_case to camelCase and embeds skills", () => {
  const cli = cliReturning({ "agent get ag_SRC1": AGENT_GET });
  const a = getAgent(cli, "ag_SRC1");
  assert.equal(a.maxConcurrentTasks, 6);
  assert.equal(a.runtimeId, "rt_SRC1");
  assert.equal(a.hasCustomEnv, true);
  assert.deepEqual(a.mcpConfig, { mcpServers: { x: { token: "t" } } });
  assert.deepEqual(a.skills, [{ id: "sk_SRC1", name: "Greet" }]);
});

test("getAgent captures mcpConfigRedacted as a boolean", () => {
  const cli = cliReturning({ "agent get ag_SRC1": AGENT_GET });
  assert.equal(getAgent(cli, "ag_SRC1").mcpConfigRedacted, false, "AGENT_GET fixture is not redacted");
});

test("getAgentCustomEnv reads custom_env via the audited agent env get command", () => {
  const cli = cliReturning({ "agent env get ag_SRC1": AGENT_ENV_GET });
  assert.deepEqual(getAgentCustomEnv(cli, "ag_SRC1"), { API_KEY: "secret-value" });
});

test("getAgentCustomEnv defaults to {} when custom_env is absent", () => {
  const cli = cliReturning({ "agent env get ag_SRC2": { agent_id: "ag_SRC2" } });
  assert.deepEqual(getAgentCustomEnv(cli, "ag_SRC2"), {});
});

test("getSquad exposes leaderId; getSquadMembers normalizes member_id and empty role", () => {
  const cli = cliReturning({ "squad get sq_SRC1": SQUAD_GET, "squad member list sq_SRC1": SQUAD_MEMBERS });
  assert.equal(getSquad(cli, "sq_SRC1").leaderId, "ag_SRC1");
  const mem = getSquadMembers(cli, "sq_SRC1");
  assert.deepEqual(mem[0], { memberId: "ag_SRC1", memberType: "agent", role: "leader" });
  assert.equal(mem[1].role, "member", "empty role normalized to member");
});
