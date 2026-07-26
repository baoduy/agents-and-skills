# multica-tool: snake_case bundle format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename every field in multica-tool's exported/imported bundle files (manifest.json, `agents/*.json`, `skills/*.json`, `squads/*.json`) from camelCase to snake_case, matching the multica CLI's own `get`/`list` JSON output field names.

**Architecture:** Pure rename, no behavior change. `lib.mjs`'s get-wrappers (`getAgent`, `getSquad`, `getSquadMembers`) stop translating the raw CLI's snake_case into camelCase — they keep acting as the sole allow-list seam onto the raw CLI shape, just without renaming keys. `multica-export.mjs` and `multica-import.mjs` get every property access on agent/skill/squad/manifest data renamed to match. CLI flag names passed to `multica` (e.g. `--max-concurrent-tasks`) are untouched — only the JSON field names being read from/written to are changing.

**Tech Stack:** Node.js (ESM `.mjs`), `node:test` + `node:assert/strict` for tests. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-26-multica-tool-snake-case-format-design.md`

## Global Constraints

- Snake_case applies to **all three resource types** (agents, skills, squads) and to **synthesized/bookkeeping fields** (`source_id`, `source_runtime_id`, `source_runtime_provider`, `skill_names`, `had_secrets`, `leader_name`, `agent_name`, `source_workspace_id`), not just raw CLI passthrough fields.
- **Out of scope, must NOT be renamed:** the scripts' own stdout report shape returned by `exportResource`/`importBundle` — `created`, `updated`, `mentionsRewritten`, `skillIdMap`, `agentIdMap`, `squadId`, `secretsReminder`, `secretsApplyFailures`, and `redactAgent`'s own `{ record, hadSecrets }` return-tuple key `hadSecrets` (as opposed to `record.had_secrets`, which does change). None of these are persisted to a bundle file or round-tripped through the multica CLI.
- **Clean break, no back-compat** — do not add dual-format (camelCase-or-snake_case) detection anywhere in import.
- CLI flag names passed to `multica` (`--max-concurrent-tasks`, `--runtime-config`, etc.) are unchanged — only the JSON keys read from `rec.*` to build those flags change.
- JS local variables/function parameters that are pure code (not directly mirroring a persisted field, e.g. `dir`, `warnings`, `manifest`, `existing`, `calls`) keep idiomatic camelCase. Bindings that directly mirror a persisted snake_case field (e.g. `skill_names`, destructured `leader_id`) may use the snake_case name directly as the JS identifier — don't add a rename hop that serves no purpose.
- Run tests with `node --test tests/multica-tool/*.test.mjs` after every task.

---

### Task 1: `lib.mjs` get-wrappers stop renaming to camelCase

**Files:**
- Modify: `plugins/multica-tool/scripts/lib.mjs:58-101` (comment + `getAgent`, `getSquad`, `getSquadMembers`)
- Test: `tests/multica-tool/lib.test.mjs`

**Interfaces:**
- Produces: `getAgent(cli, id)` now returns `{ id, name, description, instructions, model, visibility, max_concurrent_tasks, runtime_config, custom_args, thinking_level, runtime_id, has_custom_env, mcp_config, mcp_config_redacted, skills: [{id, name}] }`.
- Produces: `getSquad(cli, id)` now returns `{ id, name, description, instructions, leader_id }`.
- Produces: `getSquadMembers(cli, id)` now returns `[{ member_id, member_type, role }]`.
- (`getSkill`, `getAgentCustomEnv` unchanged — already snake_case-compatible.)

- [ ] **Step 1: Update `lib.test.mjs` assertions to the new snake_case field names (this will fail against the current camelCase `lib.mjs`)**

In `tests/multica-tool/lib.test.mjs`, replace these three tests:

```js
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
```

with:

```js
test("getAgent passes through an allow-list of snake_case CLI fields and embeds skills", () => {
  const cli = cliReturning({ "agent get ag_SRC1": AGENT_GET });
  const a = getAgent(cli, "ag_SRC1");
  assert.equal(a.max_concurrent_tasks, 6);
  assert.equal(a.runtime_id, "rt_SRC1");
  assert.equal(a.has_custom_env, true);
  assert.deepEqual(a.mcp_config, { mcpServers: { x: { token: "t" } } });
  assert.deepEqual(a.skills, [{ id: "sk_SRC1", name: "Greet" }]);
});

test("getAgent captures mcp_config_redacted as a boolean", () => {
  const cli = cliReturning({ "agent get ag_SRC1": AGENT_GET });
  assert.equal(getAgent(cli, "ag_SRC1").mcp_config_redacted, false, "AGENT_GET fixture is not redacted");
});
```

And replace:

```js
test("getSquad exposes leaderId; getSquadMembers normalizes member_id and empty role", () => {
  const cli = cliReturning({ "squad get sq_SRC1": SQUAD_GET, "squad member list sq_SRC1": SQUAD_MEMBERS });
  assert.equal(getSquad(cli, "sq_SRC1").leaderId, "ag_SRC1");
  const mem = getSquadMembers(cli, "sq_SRC1");
  assert.deepEqual(mem[0], { memberId: "ag_SRC1", memberType: "agent", role: "leader" });
  assert.equal(mem[1].role, "member", "empty role normalized to member");
});
```

with:

```js
test("getSquad exposes leader_id; getSquadMembers normalizes member_id and empty role", () => {
  const cli = cliReturning({ "squad get sq_SRC1": SQUAD_GET, "squad member list sq_SRC1": SQUAD_MEMBERS });
  assert.equal(getSquad(cli, "sq_SRC1").leader_id, "ag_SRC1");
  const mem = getSquadMembers(cli, "sq_SRC1");
  assert.deepEqual(mem[0], { member_id: "ag_SRC1", member_type: "agent", role: "leader" });
  assert.equal(mem[1].role, "member", "empty role normalized to member");
});
```

- [ ] **Step 2: Run the tests to confirm the 3 updated tests now fail**

Run: `node --test tests/multica-tool/lib.test.mjs`
Expected: 3 failures (the tests above), all other tests in the file still pass.

- [ ] **Step 3: Update `lib.mjs`'s get-wrappers**

In `plugins/multica-tool/scripts/lib.mjs`, replace lines 58-101 (the comment plus `getSkill` through `getSquadMembers`) with:

```js
// Get-wrappers: the ONLY place that knows the raw CLI field names — an
// explicit allow-list, so unexpected/internal CLI fields never leak into a
// bundle. Field names mirror the CLI's own snake_case; nothing is renamed.
export function getSkill(cli, id) {
  const s = cli.json(["skill", "get", id]);
  return {
    id: s.id, name: s.name, description: s.description,
    content: s.content ?? "", config: s.config ?? {},
    files: (s.files ?? []).map((f) => ({ path: f.path, content: f.content })),
  };
}

export function getAgent(cli, id) {
  const a = cli.json(["agent", "get", id]);
  return {
    id: a.id, name: a.name, description: a.description, instructions: a.instructions,
    model: a.model, visibility: a.visibility,
    max_concurrent_tasks: a.max_concurrent_tasks,
    runtime_config: a.runtime_config,
    custom_args: a.custom_args,
    thinking_level: a.thinking_level,
    runtime_id: a.runtime_id,
    has_custom_env: a.has_custom_env,
    mcp_config: a.mcp_config,
    mcp_config_redacted: !!a.mcp_config_redacted,
    skills: (a.skills ?? []).map((sk) => ({ id: sk.id, name: sk.name })),
  };
}

// Custom env is never included in `agent get` — only `has_custom_env`/`custom_env_key_count`.
// Reading actual values requires this dedicated, audited, owner/admin-only command.
export function getAgentCustomEnv(cli, id) {
  const r = cli.json(["agent", "env", "get", id]);
  return r.custom_env ?? {};
}

export function getSquad(cli, id) {
  const s = cli.json(["squad", "get", id]);
  return { id: s.id, name: s.name, description: s.description, instructions: s.instructions, leader_id: s.leader_id };
}

export const getSquadMembers = (cli, id) =>
  (cli.json(["squad", "member", "list", id]) ?? []).map((m) => ({
    member_id: m.member_id, member_type: m.member_type, role: m.role || "member",
  }));
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `node --test tests/multica-tool/lib.test.mjs`
Expected: all tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/lib.mjs tests/multica-tool/lib.test.mjs
git commit -m "multica-tool: get-wrappers pass through snake_case CLI fields, no camelCase rename"
```

---

### Task 2: `multica-export.mjs` writes snake_case bundle fields

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-export.mjs` (`redactAgent`, `buildManifest`, `collectAgent`, `exportResource`)
- Test: `tests/multica-tool/export.test.mjs`

**Interfaces:**
- Consumes: `getAgent`/`getSquad`/`getSquadMembers` from Task 1 (snake_case fields).
- Produces: `redactAgent(a)` returns `{ record: {..., source_id, source_runtime_id, skill_names, mcp_config, custom_env, had_secrets, ...rest}, hadSecrets }` (the `hadSecrets` tuple key itself stays camelCase — internal signal, never serialized directly).
- Produces: `buildManifest(...)` returns a manifest object whose `agents[]` entries use `source_id, source_runtime_id, source_runtime_provider, skill_names, had_secrets`; whose `squads[]` entry uses `leader_name` and members use `agent_name`; and whose top level uses `source_workspace_id`.
- Produces: `exportResource(...)` writes `agents/<slug>.json` records containing `skill_names` (added to `redactAgent`'s `record` at write time) and all of the above manifest shapes to `manifest.json`.

- [ ] **Step 1: Update `export.test.mjs` assertions to snake_case (will fail against current code)**

Replace the 4 `redactAgent` tests:

```js
test("redactAgent embeds mcpConfig and customEnv when both are usable", () => {
  const normalized = getAgent({ json: () => AGENT_GET }, "ag_SRC1");
  normalized.customEnv = { API_KEY: "secret-value" };
  normalized.customEnvFetchFailed = false;
  const { record, hadSecrets } = redactAgent(normalized);
  assert.equal(hadSecrets, true);
  assert.deepEqual(record.mcpConfig, { mcpServers: { x: { token: "t" } } }, "mcp_config is now written, not stripped");
  assert.deepEqual(record.customEnv, { API_KEY: "secret-value" });
  assert.ok(!("hasCustomEnv" in record));
  assert.ok(!("mcpConfigRedacted" in record), "export-time signal, not agent config to restore");
  assert.ok(!("customEnvFetchFailed" in record), "export-time signal, not agent config to restore");
  assert.ok(!("skills" in record));
  assert.ok(!("id" in record));
  assert.equal(record.sourceId, "ag_SRC1", "original agent id kept under sourceId, for mention rewriting on import");
  assert.equal(record.sourceRuntimeId, "rt_SRC1");
  assert.equal(record.maxConcurrentTasks, 6, "normalized field survives");
  assert.equal(record.hadSecrets, true);
  assert.equal(record.name, "Helper");
});

test("redactAgent leaves mcpConfig/customEnv null and hadSecrets false when neither is present", () => {
  const normalized = getAgent({ json: () => AGENT_GET_2 }, "ag_SRC2");
  normalized.customEnv = {};
  normalized.customEnvFetchFailed = false;
  const { record, hadSecrets } = redactAgent(normalized);
  assert.equal(hadSecrets, false);
  assert.equal(record.mcpConfig, null);
  assert.equal(record.customEnv, null);
});

test("redactAgent never surfaces a redacted mcp_config, and still flags hadSecrets", () => {
  const normalized = getAgent({ json: () => AGENT_GET_REDACTED }, "ag_SRC3");
  normalized.customEnv = {};
  normalized.customEnvFetchFailed = false;
  const { record, hadSecrets } = redactAgent(normalized);
  assert.equal(record.mcpConfig, null, "redacted value must never be written to disk");
  assert.equal(hadSecrets, true, "still flagged so the user knows something was skipped");
});

test("redactAgent flags hadSecrets when the audited env fetch failed, writes no stale customEnv", () => {
  const normalized = getAgent({ json: () => AGENT_GET_2 }, "ag_SRC2");
  normalized.customEnv = {};
  normalized.customEnvFetchFailed = true;
  const { record, hadSecrets } = redactAgent(normalized);
  assert.equal(record.customEnv, null);
  assert.equal(hadSecrets, true);
});
```

with:

```js
test("redactAgent embeds mcp_config and custom_env when both are usable", () => {
  const normalized = getAgent({ json: () => AGENT_GET }, "ag_SRC1");
  normalized.custom_env = { API_KEY: "secret-value" };
  normalized.custom_env_fetch_failed = false;
  const { record, hadSecrets } = redactAgent(normalized);
  assert.equal(hadSecrets, true);
  assert.deepEqual(record.mcp_config, { mcpServers: { x: { token: "t" } } }, "mcp_config is now written, not stripped");
  assert.deepEqual(record.custom_env, { API_KEY: "secret-value" });
  assert.ok(!("has_custom_env" in record));
  assert.ok(!("mcp_config_redacted" in record), "export-time signal, not agent config to restore");
  assert.ok(!("custom_env_fetch_failed" in record), "export-time signal, not agent config to restore");
  assert.ok(!("skills" in record));
  assert.ok(!("id" in record));
  assert.equal(record.source_id, "ag_SRC1", "original agent id kept under source_id, for mention rewriting on import");
  assert.equal(record.source_runtime_id, "rt_SRC1");
  assert.equal(record.max_concurrent_tasks, 6, "normalized field survives");
  assert.equal(record.had_secrets, true);
  assert.equal(record.name, "Helper");
});

test("redactAgent leaves mcp_config/custom_env null and hadSecrets false when neither is present", () => {
  const normalized = getAgent({ json: () => AGENT_GET_2 }, "ag_SRC2");
  normalized.custom_env = {};
  normalized.custom_env_fetch_failed = false;
  const { record, hadSecrets } = redactAgent(normalized);
  assert.equal(hadSecrets, false);
  assert.equal(record.mcp_config, null);
  assert.equal(record.custom_env, null);
});

test("redactAgent never surfaces a redacted mcp_config, and still flags hadSecrets", () => {
  const normalized = getAgent({ json: () => AGENT_GET_REDACTED }, "ag_SRC3");
  normalized.custom_env = {};
  normalized.custom_env_fetch_failed = false;
  const { record, hadSecrets } = redactAgent(normalized);
  assert.equal(record.mcp_config, null, "redacted value must never be written to disk");
  assert.equal(hadSecrets, true, "still flagged so the user knows something was skipped");
});

test("redactAgent flags hadSecrets when the audited env fetch failed, writes no stale custom_env", () => {
  const normalized = getAgent({ json: () => AGENT_GET_2 }, "ag_SRC2");
  normalized.custom_env = {};
  normalized.custom_env_fetch_failed = true;
  const { record, hadSecrets } = redactAgent(normalized);
  assert.equal(record.custom_env, null);
  assert.equal(hadSecrets, true);
});
```

Replace the `buildManifest` test:

```js
test("buildManifest dedups skills/agents by name and wires by name", () => {
  const m = buildManifest({
    scope: "squad",
    sourceWorkspaceId: "ws_SRC",
    skills: [{ name: "Greet", sourceId: "sk_SRC1" }, { name: "Greet", sourceId: "sk_SRC1" }],
    agents: [{ name: "Helper", sourceId: "ag_SRC1", sourceRuntimeId: "rt_SRC1", skillNames: ["Greet"], hadSecrets: true }],
    squad: { name: "Team", description: "the team", leaderName: "Helper", members: [{ agentName: "Helper2", role: "member" }] },
  });
  assert.equal(m.version, "1");
  assert.equal(m.skills.length, 1, "skills deduped by name");
  assert.equal(m.skills[0].dir, "skills/greet");
  assert.equal(m.agents[0].file, "agents/helper.json");
  assert.equal(m.agents[0].sourceId, "ag_SRC1", "source agent id carried in manifest for mention rewriting");
  assert.deepEqual(m.agents[0].skillNames, ["Greet"]);
  assert.equal(m.agents[0].hadSecrets, true);
  assert.equal(m.squads[0].leaderName, "Helper");
  assert.equal(m.squads[0].description, "the team");
});
```

with:

```js
test("buildManifest dedups skills/agents by name and wires by name", () => {
  const m = buildManifest({
    scope: "squad",
    sourceWorkspaceId: "ws_SRC",
    skills: [{ name: "Greet", source_id: "sk_SRC1" }, { name: "Greet", source_id: "sk_SRC1" }],
    agents: [{ name: "Helper", source_id: "ag_SRC1", source_runtime_id: "rt_SRC1", skill_names: ["Greet"], had_secrets: true }],
    squad: { name: "Team", description: "the team", leader_name: "Helper", members: [{ agent_name: "Helper2", role: "member" }] },
  });
  assert.equal(m.version, "1");
  assert.equal(m.skills.length, 1, "skills deduped by name");
  assert.equal(m.skills[0].dir, "skills/greet");
  assert.equal(m.agents[0].file, "agents/helper.json");
  assert.equal(m.agents[0].source_id, "ag_SRC1", "source agent id carried in manifest for mention rewriting");
  assert.deepEqual(m.agents[0].skill_names, ["Greet"]);
  assert.equal(m.agents[0].had_secrets, true);
  assert.equal(m.squads[0].leader_name, "Helper");
  assert.equal(m.squads[0].description, "the team");
});
```

Replace the remaining 4 tests that reference camelCase fields:

```js
test("export agent writes mcp_config/customEnv to disk and warns when either is present", () => {
  const fs = memFs();
  const { manifest, warnings } = exportResource({ cli: fakeCli(), scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/o", sourceWorkspaceId: "ws", fs });
  const record = JSON.parse(fs.files["/o/agents/helper.json"]);
  assert.deepEqual(record.mcpConfig, { mcpServers: { x: { token: "t" } } }, "mcp_config now round-trips");
  assert.deepEqual(record.customEnv, { API_KEY: "secret-value" }, "custom_env now round-trips");
  assert.deepEqual(warnings, ["Helper"]);          // has_custom_env true / mcp_config present → warned
  assert.equal(manifest.agents[0].sourceRuntimeProvider, "claude", "runtime provider captured for later auto-mapping");
  assert.equal(record.sourceRuntimeProvider, "claude");
});

test("manifest.json never carries mcpConfig/customEnv, even when the agent record does (regression: secrets must stay out of the manifest/stdout projection)", () => {
  const fs = memFs();
  const { manifest } = exportResource({ cli: fakeCli(), scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/o4", sourceWorkspaceId: "ws", fs });
  assert.ok(!("mcpConfig" in manifest.agents[0]), "manifest agent entry must not carry mcp_config");
  assert.ok(!("customEnv" in manifest.agents[0]), "manifest agent entry must not carry custom_env");
  const manifestBlob = fs.files["/o4/manifest.json"];
  assert.ok(!manifestBlob.includes("token"), "the secret value itself must never appear in manifest.json");
});
```

with:

```js
test("export agent writes mcp_config/custom_env to disk and warns when either is present", () => {
  const fs = memFs();
  const { manifest, warnings } = exportResource({ cli: fakeCli(), scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/o", sourceWorkspaceId: "ws", fs });
  const record = JSON.parse(fs.files["/o/agents/helper.json"]);
  assert.deepEqual(record.mcp_config, { mcpServers: { x: { token: "t" } } }, "mcp_config now round-trips");
  assert.deepEqual(record.custom_env, { API_KEY: "secret-value" }, "custom_env now round-trips");
  assert.deepEqual(warnings, ["Helper"]);          // has_custom_env true / mcp_config present → warned
  assert.equal(manifest.agents[0].source_runtime_provider, "claude", "runtime provider captured for later auto-mapping");
  assert.equal(record.source_runtime_provider, "claude");
});

test("manifest.json never carries mcp_config/custom_env, even when the agent record does (regression: secrets must stay out of the manifest/stdout projection)", () => {
  const fs = memFs();
  const { manifest } = exportResource({ cli: fakeCli(), scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/o4", sourceWorkspaceId: "ws", fs });
  assert.ok(!("mcp_config" in manifest.agents[0]), "manifest agent entry must not carry mcp_config");
  assert.ok(!("custom_env" in manifest.agents[0]), "manifest agent entry must not carry custom_env");
  const manifestBlob = fs.files["/o4/manifest.json"];
  assert.ok(!manifestBlob.includes("token"), "the secret value itself must never appear in manifest.json");
});
```

And:

```js
test("export continues when the audited agent env get call fails (e.g. insufficient permission)", () => {
  const fs = memFs();
  const cli = fakeCli();
  const failing = { ...cli, json: (args) => {
    if (args.join(" ") === "agent env get ag_SRC1") throw new Error("permission denied");
    return cli.json(args);
  } };
  const { manifest, warnings } = exportResource({ cli: failing, scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/o3", sourceWorkspaceId: "ws", fs });
  const record = JSON.parse(fs.files["/o3/agents/helper.json"]);
  assert.equal(record.customEnv, null, "failed fetch never writes a partial/stale value");
  assert.deepEqual(warnings, ["Helper"], "still warned even though the customEnv fetch itself failed");
  assert.ok(manifest.agents[0].hadSecrets);
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
  const helper = manifest.agents.find((a) => a.name === "Helper");
  assert.equal(helper.sourceId, "ag_SRC1", "source agent id recorded in manifest for mention rewriting on import");
});
```

with:

```js
test("export continues when the audited agent env get call fails (e.g. insufficient permission)", () => {
  const fs = memFs();
  const cli = fakeCli();
  const failing = { ...cli, json: (args) => {
    if (args.join(" ") === "agent env get ag_SRC1") throw new Error("permission denied");
    return cli.json(args);
  } };
  const { manifest, warnings } = exportResource({ cli: failing, scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/o3", sourceWorkspaceId: "ws", fs });
  const record = JSON.parse(fs.files["/o3/agents/helper.json"]);
  assert.equal(record.custom_env, null, "failed fetch never writes a partial/stale value");
  assert.deepEqual(warnings, ["Helper"], "still warned even though the custom_env fetch itself failed");
  assert.ok(manifest.agents[0].had_secrets);
});

test("export squad resolves leader and member names by id and writes squad file", () => {
  const fs = memFs();
  const { manifest, warnings } = exportResource({ cli: fakeCli(), scope: "squad", ids: { squadId: "sq_SRC1" }, outDir: "/s", sourceWorkspaceId: "ws", fs });
  const squad = JSON.parse(fs.files["/s/squads/team.json"]);
  assert.equal(squad.leader_name, "Helper", "leader_id ag_SRC1 resolved to name");
  assert.equal(squad.instructions, "# Team charter\nShip it.", "squad instructions captured in export");
  assert.deepEqual(squad.members.map((m) => m.agent_name).sort(), ["Helper", "Helper2"]);
  assert.equal(manifest.agents.length, 2, "both member agents captured");
  assert.deepEqual(warnings, ["Helper"], "only the agent with secrets is warned");
  const helper = manifest.agents.find((a) => a.name === "Helper");
  assert.equal(helper.source_id, "ag_SRC1", "source agent id recorded in manifest for mention rewriting on import");
});
```

(The other 3 tests in the file — skill export, nested skill files, skip-audited-call-when-false — reference no camelCase fields and are unchanged.)

- [ ] **Step 2: Run tests, confirm the updated tests fail against current `multica-export.mjs`**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: the tests just edited fail; the 3 untouched tests still pass.

- [ ] **Step 3: Update `multica-export.mjs`**

Replace `redactAgent`:

```js
export function redactAgent(a) {
  // a is a normalized agent from getAgent, with `custom_env`/
  // `custom_env_fetch_failed` attached by the caller (collectAgent) — getAgent
  // itself never fetches custom_env, since it requires a separate audited call.
  const { id, has_custom_env, mcp_config_redacted, custom_env_fetch_failed, mcp_config, custom_env, skills, runtime_id, ...rest } = a;
  const mcpUsable = !mcp_config_redacted && nonEmpty(mcp_config);
  const envUsable = !custom_env_fetch_failed && nonEmpty(custom_env);
  // mcp_config_redacted / custom_env_fetch_failed alone still flag hadSecrets even
  // when unusable — the user should know something was present at the source
  // but couldn't be captured, not just silently see an empty bundle.
  const hadSecrets = mcpUsable || envUsable || !!mcp_config_redacted || !!custom_env_fetch_failed;
  return {
    // source_id lets import-time mention rewriting map stale `mention://agent/<id>`
    // links (in this or another agent's/squad's instructions) to the new id.
    record: {
      ...rest,
      source_id: id,
      source_runtime_id: runtime_id,
      skill_names: [],
      mcp_config: mcpUsable ? mcp_config : null,
      custom_env: envUsable ? custom_env : null,
      had_secrets: hadSecrets,
    },
    hadSecrets,
  };
}
```

Replace `buildManifest`:

```js
export function buildManifest({ scope, sourceWorkspaceId, skills, agents, squad }) {
  const seenSkills = new Map();
  for (const s of skills) if (!seenSkills.has(s.name)) seenSkills.set(s.name, s);
  const seenAgents = new Map();
  for (const a of agents) if (!seenAgents.has(a.name)) seenAgents.set(a.name, a);
  return {
    version: "1",
    scope,
    source_workspace_id: sourceWorkspaceId,
    skills: [...seenSkills.values()].map((s) => ({ name: s.name, dir: `skills/${slugify(s.name)}`, source_id: s.source_id })),
    agents: [...seenAgents.values()].map((a) => ({ name: a.name, file: `agents/${slugify(a.name)}.json`, source_id: a.source_id, source_runtime_id: a.source_runtime_id, source_runtime_provider: a.source_runtime_provider ?? null, skill_names: a.skill_names, had_secrets: !!a.had_secrets })),
    squads: squad ? [{ name: squad.name, file: `squads/${slugify(squad.name)}.json`, description: squad.description ?? "", instructions: squad.instructions ?? "", leader_name: squad.leader_name, members: squad.members }] : [],
  };
}
```

Replace `collectAgent`:

```js
// Keyed by agent id (so squad leader_id/member_id resolve to names). Stores the
// normalized agent, its redaction result, and its skill names.
function collectAgent(cli, id, agentsById, skills, providerById) {
  if (agentsById.has(id)) return agentsById.get(id);
  const a = getAgent(cli, id);
  a.source_runtime_provider = providerById.get(a.runtime_id) ?? null;
  a.custom_env = {};
  a.custom_env_fetch_failed = false;
  if (a.has_custom_env) {
    try {
      a.custom_env = getAgentCustomEnv(cli, id);
    } catch {
      a.custom_env_fetch_failed = true; // e.g. insufficient permission — non-fatal, warned via had_secrets
    }
  }
  const skill_names = a.skills.map((sk) => collectSkill(cli, sk.id, skills));
  const red = redactAgent(a);
  const entry = { raw: a, red, skill_names };
  agentsById.set(id, entry);
  return entry;
}
```

In `exportResource`, replace the squad-building block and the `buildManifest` call:

```js
  if (scope === "squad") {
    const sq = getSquad(cli, ids.squadId);
    const members = getSquadMembers(cli, ids.squadId).filter((m) => m.memberType === "agent");
    for (const m of members) collectAgent(cli, m.memberId, agentsById, skills, getProviderById());
    if (!agentsById.has(sq.leaderId)) collectAgent(cli, sq.leaderId, agentsById, skills, getProviderById());
    const nameOf = (id) => agentsById.get(id)?.raw.name;
    squad = {
      name: sq.name,
      description: sq.description,
      instructions: sq.instructions,
      leaderName: nameOf(sq.leaderId),
      members: members.map((m) => ({ agentName: nameOf(m.memberId), role: m.role })),
    };
  }

  const manifest = buildManifest({
    scope, sourceWorkspaceId,
    skills: [...skills.values()].map((s) => ({ name: s.name, sourceId: s.id })),
    agents: [...agentsById.values()].map((a) => ({ name: a.raw.name, sourceId: a.raw.id, sourceRuntimeId: a.raw.runtimeId, sourceRuntimeProvider: a.raw.sourceRuntimeProvider, skillNames: a.skillNames, hadSecrets: a.red.hadSecrets })),
    squad,
  });
```

with:

```js
  if (scope === "squad") {
    const sq = getSquad(cli, ids.squadId);
    const members = getSquadMembers(cli, ids.squadId).filter((m) => m.member_type === "agent");
    for (const m of members) collectAgent(cli, m.member_id, agentsById, skills, getProviderById());
    if (!agentsById.has(sq.leader_id)) collectAgent(cli, sq.leader_id, agentsById, skills, getProviderById());
    const nameOf = (id) => agentsById.get(id)?.raw.name;
    squad = {
      name: sq.name,
      description: sq.description,
      instructions: sq.instructions,
      leader_name: nameOf(sq.leader_id),
      members: members.map((m) => ({ agent_name: nameOf(m.member_id), role: m.role })),
    };
  }

  const manifest = buildManifest({
    scope, sourceWorkspaceId,
    skills: [...skills.values()].map((s) => ({ name: s.name, source_id: s.id })),
    agents: [...agentsById.values()].map((a) => ({ name: a.raw.name, source_id: a.raw.id, source_runtime_id: a.raw.runtime_id, source_runtime_provider: a.raw.source_runtime_provider, skill_names: a.skill_names, had_secrets: a.red.hadSecrets })),
    squad,
  });
```

Finally, in the agent-writing loop of `exportResource`, replace:

```js
  const agentByName = new Map([...agentsById.values()].map((a) => [a.raw.name, a]));
  for (const entry of manifest.agents) {
    const { raw, red, skillNames } = agentByName.get(entry.name);
    const record = { ...red.record, skillNames };
```

with:

```js
  const agentByName = new Map([...agentsById.values()].map((a) => [a.raw.name, a]));
  for (const entry of manifest.agents) {
    const { raw, red, skill_names } = agentByName.get(entry.name);
    const record = { ...red.record, skill_names };
```

(The rest of `exportResource` — the skill-writing loop, squad-writing loop, `manifest.json` write, `main()` — is unchanged.)

- [ ] **Step 4: Run tests, confirm all pass**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: all tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/multica-export.mjs tests/multica-tool/export.test.mjs
git commit -m "multica-tool: export writes snake_case bundle fields"
```

---

### Task 3: `multica-import.mjs` reads snake_case bundle fields

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-import.mjs` (`importAgents`, `importSquad`, `collectSourceRuntimes`, `collectRuntimeProviders`, `importBundle`)
- Test: `tests/multica-tool/import.test.mjs`

**Interfaces:**
- Consumes: bundle files written by Task 2's `exportResource` (snake_case throughout).
- Produces: `importAgents(...)`, `importSquad(...)`, `collectSourceRuntimes(...)`, `resolveRuntimeMap(...)` behave identically to before, just reading `rec.max_concurrent_tasks`/`rec.source_runtime_id`/etc. instead of the camelCase equivalents. `rewriteMentions`/`rewriteAgentMentions`/`importSkills` are unaffected (no camelCase-only fields in their inputs).

- [ ] **Step 1: Update `import.test.mjs` fixtures and assertions to snake_case (will fail against current code)**

Replace the `MANIFEST` const:

```js
const MANIFEST = {
  version: "1", scope: "skill", sourceWorkspaceId: "ws_SRC",
  skills: [{ name: "Greet", dir: "skills/greet", sourceId: "sk_SRC1" }],
  agents: [], squads: [],
};
```

with:

```js
const MANIFEST = {
  version: "1", scope: "skill", source_workspace_id: "ws_SRC",
  skills: [{ name: "Greet", dir: "skills/greet", source_id: "sk_SRC1" }],
  agents: [], squads: [],
};
```

Replace the `AGENT_MANIFEST` and `AGENT_FILE` consts:

```js
const AGENT_MANIFEST = {
  version: "1", scope: "agent", sourceWorkspaceId: "ws_SRC", skills: [],
  agents: [{ name: "Helper", file: "agents/helper.json", sourceRuntimeId: "rt_SRC1", skillNames: ["Greet"] }],
  squads: [],
};
const AGENT_FILE = JSON.stringify({ name: "Helper", instructions: "be nice", model: "claude-sonnet-4-6", visibility: "workspace", maxConcurrentTasks: 6, sourceId: "ag_SRC1", sourceRuntimeId: "rt_SRC1", skillNames: ["Greet"] });
```

with:

```js
const AGENT_MANIFEST = {
  version: "1", scope: "agent", source_workspace_id: "ws_SRC", skills: [],
  agents: [{ name: "Helper", file: "agents/helper.json", source_runtime_id: "rt_SRC1", skill_names: ["Greet"] }],
  squads: [],
};
const AGENT_FILE = JSON.stringify({ name: "Helper", instructions: "be nice", model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6, source_id: "ag_SRC1", source_runtime_id: "rt_SRC1", skill_names: ["Greet"] });
```

Replace `AGENT_FILE_WITH_SECRETS`:

```js
const AGENT_FILE_WITH_SECRETS = JSON.stringify({
  name: "Helper", instructions: "be nice", model: "claude-sonnet-4-6", visibility: "workspace",
  maxConcurrentTasks: 6, sourceId: "ag_SRC1", sourceRuntimeId: "rt_SRC1", skillNames: ["Greet"],
  mcpConfig: { mcpServers: { x: { command: "npx" } } }, customEnv: { API_KEY: "secret-value" },
});
```

with:

```js
const AGENT_FILE_WITH_SECRETS = JSON.stringify({
  name: "Helper", instructions: "be nice", model: "claude-sonnet-4-6", visibility: "workspace",
  max_concurrent_tasks: 6, source_id: "ag_SRC1", source_runtime_id: "rt_SRC1", skill_names: ["Greet"],
  mcp_config: { mcpServers: { x: { command: "npx" } } }, custom_env: { API_KEY: "secret-value" },
});
```

Replace the `MENTION_MANIFEST` const's `sourceWorkspaceId` key:

```js
const MENTION_MANIFEST = {
  version: "1", scope: "squad", sourceWorkspaceId: "ws_SRC", skills: [],
```

with:

```js
const MENTION_MANIFEST = {
  version: "1", scope: "squad", source_workspace_id: "ws_SRC", skills: [],
```

Replace `SQUAD_ENTRY`:

```js
const SQUAD_ENTRY = {
  name: "Team", file: "squads/team.json", leaderName: "Helper", instructions: "# Team charter\nDeliver features.",
  members: [{ agentName: "Helper", role: "leader" }, { agentName: "Helper2", role: "member" }],
};
```

with:

```js
const SQUAD_ENTRY = {
  name: "Team", file: "squads/team.json", leader_name: "Helper", instructions: "# Team charter\nDeliver features.",
  members: [{ agent_name: "Helper", role: "leader" }, { agent_name: "Helper2", role: "member" }],
};
```

Replace the `collectSourceRuntimes` test:

```js
test("collectSourceRuntimes returns distinct ids", () => {
  const m = { agents: [{ sourceRuntimeId: "rt_a" }, { sourceRuntimeId: "rt_a" }, { sourceRuntimeId: "rt_b" }] };
  assert.deepEqual(collectSourceRuntimes(m).sort(), ["rt_a", "rt_b"]);
});
```

with:

```js
test("collectSourceRuntimes returns distinct ids", () => {
  const m = { agents: [{ source_runtime_id: "rt_a" }, { source_runtime_id: "rt_a" }, { source_runtime_id: "rt_b" }] };
  assert.deepEqual(collectSourceRuntimes(m).sort(), ["rt_a", "rt_b"]);
});
```

Replace `MANIFEST_WITH_PROVIDER` and the "no provider recorded" test's inline manifest:

```js
const MANIFEST_WITH_PROVIDER = { agents: [{ sourceRuntimeId: "rt_SRC1", sourceRuntimeProvider: "claude" }] };
```

with:

```js
const MANIFEST_WITH_PROVIDER = { agents: [{ source_runtime_id: "rt_SRC1", source_runtime_provider: "claude" }] };
```

and:

```js
test("resolveRuntimeMap leaves it unresolved (without calling the CLI) when no provider was recorded", () => {
  const cli = { json: () => { throw new Error("must not list runtimes with nothing resolvable"); } };
  const manifest = { agents: [{ sourceRuntimeId: "rt_SRC1" }] }; // older bundle, no sourceRuntimeProvider
  const { unresolved } = resolveRuntimeMap({ cli, manifest, runtimeMap: new Map() });
  assert.deepEqual(unresolved, [{ srcId: "rt_SRC1", provider: undefined, matchCount: 0 }]);
});
```

with:

```js
test("resolveRuntimeMap leaves it unresolved (without calling the CLI) when no provider was recorded", () => {
  const cli = { json: () => { throw new Error("must not list runtimes with nothing resolvable"); } };
  const manifest = { agents: [{ source_runtime_id: "rt_SRC1" }] }; // older bundle, no source_runtime_provider
  const { unresolved } = resolveRuntimeMap({ cli, manifest, runtimeMap: new Map() });
  assert.deepEqual(unresolved, [{ srcId: "rt_SRC1", provider: undefined, matchCount: 0 }]);
});
```

(All other tests in the file reference only CLI-call-argv strings, `idMap`/`sourceIdMap` values, or the now-updated consts above — no further body edits needed.)

- [ ] **Step 2: Run tests, confirm they fail against current `multica-import.mjs`**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: failures in tests touching `rec.source_*`/`rec.max_concurrent_tasks`/`rec.skill_names`/`squad.leader_name`/`m.agent_name`/`collectSourceRuntimes`/`resolveRuntimeMap` (the runtime-mapping ones may still pass incidentally if they only check values, not keys — re-run after Step 3 regardless).

- [ ] **Step 3: Update `multica-import.mjs`**

Replace `importAgents`:

```js
export function importAgents({ cli, manifest, dir, skillIdMap, runtimeMap, fs = nodeFs }) {
  const idMap = new Map();
  const sourceIdMap = new Map(); // source agent id -> new agent id, for mention rewriting
  const secretsApplyFailures = [];
  let created = 0, updated = 0;
  const existing = listAgents(cli);

  for (const a of manifest.agents) {
    const rec = JSON.parse(fs.readFileSync(`${dir}/${a.file}`, "utf8"));
    const targetRuntime = runtimeMap.get(rec.source_runtime_id);
    if (!targetRuntime) throw new Error(`Unmapped runtime "${rec.source_runtime_id}" for agent "${rec.name}"`);
    // Only pass optional flags when present — `--model ""` would CLEAR the model.
    const common = [
      "--visibility", rec.visibility ?? "private",
      "--max-concurrent-tasks", String(rec.max_concurrent_tasks ?? 6),
    ];
    if (rec.description) common.push("--description", rec.description);
    if (rec.instructions) common.push("--instructions", rec.instructions);
    if (rec.model) common.push("--model", rec.model);
    if (rec.thinking_level) common.push("--thinking-level", rec.thinking_level);
    if (rec.runtime_config && Object.keys(rec.runtime_config).length) common.push("--runtime-config", JSON.stringify(rec.runtime_config));
    if (Array.isArray(rec.custom_args) && rec.custom_args.length) common.push("--custom-args", JSON.stringify(rec.custom_args));
    const match = findByName(existing, rec.name);
    let id;
    if (match) {
      cli.run(["agent", "update", match.id, "--runtime-id", targetRuntime, ...common]);
      id = match.id; updated++;
    } else {
      const out = cli.run(["agent", "create", "--name", rec.name, "--runtime-id", targetRuntime, ...common]);
      id = JSON.parse(out).id; created++;
    }
    idMap.set(rec.name, id);
    if (rec.source_id) sourceIdMap.set(rec.source_id, id);
    const skillIds = (rec.skill_names ?? []).map((n) => skillIdMap.get(n)).filter(Boolean);
    cli.run(["agent", "skills", "set", id, "--skill-ids", skillIds.join(",")]);

    // mcp_config/custom_env carry real secrets. Each is applied via its OWN
    // follow-up call, never bundled into the create/update call above — that
    // keeps a rejected secret from failing the whole agent create/update, and
    // sidesteps the fact that only one stdin payload can be read per process
    // anyway. `agent update --mcp-config-stdin` works on a freshly-created id
    // too, so no create/update branching is needed here.
    const hasMcpConfig = rec.mcp_config && Object.keys(rec.mcp_config).length > 0;
    if (hasMcpConfig) {
      try {
        cli.run(["agent", "update", id, "--mcp-config-stdin"], { input: JSON.stringify(rec.mcp_config) });
      } catch {
        secretsApplyFailures.push(rec.name);
      }
    }
    // custom_env has no flag on `agent update` at all — `agent env set` is the
    // only way to set it on an existing agent, so it's always a follow-up call.
    const hasCustomEnv = rec.custom_env && Object.keys(rec.custom_env).length > 0;
    if (hasCustomEnv) {
      try {
        cli.run(["agent", "env", "set", id, "--custom-env-stdin"], { input: JSON.stringify(rec.custom_env) });
      } catch {
        secretsApplyFailures.push(rec.name);
      }
    }
  }
  return { idMap, sourceIdMap, created, updated, secretsApplyFailures };
}
```

Replace `importSquad`:

```js
export function importSquad({ cli, squad, agentIdMap, sourceIdMap }) {
  const existing = listSquads(cli);
  const leaderId = agentIdMap.get(squad.leader_name);
  const match = findByName(existing, squad.name);
  let id, created = 0, updated = 0;
  // Squad instructions commonly list @mentions of teammate agents by their
  // SOURCE id — rewrite to the destination ids before the squad is created.
  const instructions = sourceIdMap ? rewriteMentions(squad.instructions, sourceIdMap) : squad.instructions;
  const instr = instructions ? ["--instructions", instructions] : [];
  if (match) {
    cli.run(["squad", "update", match.id, "--leader", leaderId, "--description", squad.description ?? "", ...instr]);
    id = match.id; updated++;
  } else {
    const out = cli.run(["squad", "create", "--name", squad.name, "--leader", leaderId, "--description", squad.description ?? "", ...instr]);
    id = JSON.parse(out).id; created++;
  }
  // Add non-leader members, skipping any already present so re-runs are idempotent.
  const present = new Set(getSquadMembers(cli, id).map((m) => m.member_id));
  for (const m of squad.members) {
    if (m.agent_name === squad.leader_name) continue;
    const memberId = agentIdMap.get(m.agent_name);
    if (present.has(memberId)) continue;
    cli.run(["squad", "member", "add", id, "--member-id", memberId, "--role", m.role, "--type", "agent"]);
  }
  return { newId: id, created, updated };
}
```

Replace `collectSourceRuntimes` and `collectRuntimeProviders`:

```js
export function collectSourceRuntimes(manifest) {
  return [...new Set((manifest.agents ?? []).map((a) => a.source_runtime_id).filter(Boolean))];
}

// source_runtime_id -> provider (e.g. "claude", "opencode"), from whichever agent recorded it.
function collectRuntimeProviders(manifest) {
  const map = new Map();
  for (const a of manifest.agents ?? []) {
    if (a.source_runtime_id && a.source_runtime_provider && !map.has(a.source_runtime_id)) {
      map.set(a.source_runtime_id, a.source_runtime_provider);
    }
  }
  return map;
}
```

In `importBundle`, replace the `secretsReminder` line:

```js
    secretsReminder: (manifest.agents ?? []).filter((a) => a.hadSecrets).map((a) => a.name),
```

with:

```js
    secretsReminder: (manifest.agents ?? []).filter((a) => a.had_secrets).map((a) => a.name),
```

(`importSkills`, `rewriteMentions`, `rewriteAgentMentions`, `resolveRuntimeMap`'s own body, `parseRuntimeMap`, and `main()` are unchanged — they don't reference any renamed field directly.)

- [ ] **Step 4: Run tests, confirm all pass**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: all tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/multica-import.mjs tests/multica-tool/import.test.mjs
git commit -m "multica-tool: import reads snake_case bundle fields"
```

---

### Task 4: Update skill docs and verify `sync.test.mjs` is untouched

**Files:**
- Modify: `plugins/multica-tool/skills/import/SKILL.md:28,32`
- Modify: `plugins/multica-tool/skills/sync/SKILL.md:36`
- Test: `tests/multica-tool/sync.test.mjs` (verify only, no expected edits)

**Interfaces:**
- None (docs + a verification step).

- [ ] **Step 1: Update `skills/import/SKILL.md`**

Change:

```
cat <folder>/manifest.json                 # note each distinct sourceRuntimeId
```

to:

```
cat <folder>/manifest.json                 # note each distinct source_runtime_id
```

Change:

```
Ask the user to pick a matching target runtime by name or ID for each unmapped `sourceRuntimeId`, then re-run with an explicit map (explicit entries always take precedence over auto-mapping):
```

to:

```
Ask the user to pick a matching target runtime by name or ID for each unmapped `source_runtime_id`, then re-run with an explicit map (explicit entries always take precedence over auto-mapping):
```

- [ ] **Step 2: Update `skills/sync/SKILL.md`**

Change:

```
Ask the user to select a matching target runtime by name or ID for each unmapped `sourceRuntimeId`, then re-run with an explicit map (explicit entries always take precedence over auto-mapping):
```

to:

```
Ask the user to select a matching target runtime by name or ID for each unmapped `source_runtime_id`, then re-run with an explicit map (explicit entries always take precedence over auto-mapping):
```

- [ ] **Step 3: Confirm `sync.test.mjs` needs no changes**

Read `tests/multica-tool/sync.test.mjs` and confirm it contains no camelCase bundle-field literals (it only exercises `skill` scope through real `exportResource`/`importBundle`, with no inline agent/squad JSON). Run it standalone to double check it still passes untouched:

Run: `node --test tests/multica-tool/sync.test.mjs`
Expected: passes, unchanged from before this plan.

- [ ] **Step 4: Commit**

```bash
git add plugins/multica-tool/skills/import/SKILL.md plugins/multica-tool/skills/sync/SKILL.md
git commit -m "multica-tool: update sourceRuntimeId doc mentions to source_runtime_id"
```

---

### Task 5: Full verification and plugin validation

**Files:** none (verification only)

- [ ] **Step 1: Run the full multica-tool test suite**

Run: `node --test tests/multica-tool/*.test.mjs`
Expected: all tests across `lib.test.mjs`, `export.test.mjs`, `import.test.mjs`, `sync.test.mjs` pass, 0 failures.

- [ ] **Step 2: Grep for any remaining camelCase bundle-field references**

Run: `grep -rnE "sourceId|sourceRuntimeId|sourceRuntimeProvider|skillNames|hadSecrets|leaderName|leaderId|memberId|memberType|agentName|maxConcurrentTasks|runtimeConfig|customArgs|thinkingLevel|runtimeId|hasCustomEnv|mcpConfig|mcpConfigRedacted|customEnv|customEnvFetchFailed|sourceWorkspaceId" plugins/multica-tool/scripts plugins/multica-tool/skills`
Expected: no matches (aside from the intentionally-unrenamed `hadSecrets` return-tuple key inside `redactAgent`/`buildManifest` call sites and the out-of-scope `skillIdMap`/`agentIdMap` report fields in `importBundle`/`multica-sync.mjs` — verify any hits are one of those two, not a missed bundle field).

- [ ] **Step 3: Run the `plugin-validator` agent against `multica-tool`**

Per this repo's `CLAUDE.md`, run the `plugin-validator` agent (or `/plugin-validator` command) against `plugins/multica-tool/` and fix any `[FAIL]` items before considering this done.

- [ ] **Step 4: Validate marketplace/plugin manifests are still well-formed (unaffected by this change, but cheap to confirm)**

Run: `python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"`
Expected: prints `OK`.
