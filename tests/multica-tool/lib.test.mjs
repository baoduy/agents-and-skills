import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, makeCli, requireAuth } from "../../plugins/multica-tool/scripts/lib.mjs";

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

test("cli.run throws stderr on non-zero exit", () => {
  const exec = () => ({ stdout: "", stderr: "boom", status: 1 });
  const cli = makeCli(exec);
  assert.throws(() => cli.run(["skill", "list"]), /boom/);
});

test("requireAuth throws when auth status fails", () => {
  assert.throws(() => requireAuth(() => ({ stdout: "", stderr: "", status: 1 })), /multica login/);
  assert.doesNotThrow(() => requireAuth(() => ({ stdout: "ok", stderr: "", status: 0 })));
});
