# multica-tool: agent configuration round-trip (MCP config + custom env) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `mcp_config` and `custom_env` real round-trip fields on `multica-tool` agent export/import/sync, instead of being silently dropped with a "re-add manually" warning.

**Architecture:** `lib.mjs` gains a stdin-input option on its CLI runner plus a new `getAgentCustomEnv` reader; `multica-export.mjs`'s `redactAgent`/`collectAgent` stop stripping `mcpConfig` and start embedding `customEnv` (both guarded against export-time failures — a redacted `mcp_config` or a permission-denied `agent env get` — so nothing broken or partial ever lands in the bundle); `multica-import.mjs`'s `importAgents` applies both fields via their own follow-up CLI calls **after** the base create/update call, each independently wrapped so a secrets-apply failure never undoes the agent's creation/update.

**Tech Stack:** Node.js (`node --test`), no new dependencies — everything uses `node:child_process`'s existing `spawnSync`.

## Global Constraints

- Bundle storage: both fields inline in the existing `agents/<slug>.json` record — no separate secrets file (per spec §Scope Decision 2).
- Overwrite rule: push the CLI flag/call only when the source value is non-empty; no explicit "clear destination" semantics (per spec §Scope Decision 3, matches the existing `model`/`instructions` convention already in `importAgents`).
- `custom_env` export is unconditional but skipped when `hasCustomEnv` is false — no `--include-env` flag (per spec §Scope Decision 4).
- If `mcp_config_redacted` is true on the source record, `mcpConfig` must never be written to the bundle (per spec §Scope Decision 5) — this is a correctness guard, not optional.
- Both secrets payloads travel via `spawnSync`'s `input` option, never as inline `--mcp-config <json>`/`--custom-env <json>` args (per spec §Scope Decision 6).
- **Correction discovered during planning #1 (mechanism, not intent — supersedes spec's Import §2 wording):** `agent create --mcp-config-stdin --custom-env-stdin` in one call is invalid — verified live against multica CLI 0.4.6: both flags try to consume the same stdin content and the second one fails JSON validation. Neither secret is ever bundled into the base `agent create`/`agent update` call; both are applied via their own separate follow-up call (`agent update <id> --mcp-config-stdin`, `agent env set <id> --custom-env-stdin`) issued after the base call, regardless of whether that base call was a create or an update — `agent update --mcp-config-stdin` is valid on a freshly-created agent id too, so no create/update branching is needed for either follow-up.
- **Correction discovered during planning #2 (restores the spec's approved error-handling table, which the original wording didn't achieve):** the spec's error table calls for import-time secrets failures to be non-fatal ("agent import still counts as created/updated"). That's only achievable if the secrets flags are **not** part of the same atomic CLI call as the rest of the agent's fields — otherwise a rejected `mcp_config` would fail the whole `agent create`/`update` call, taking every other field down with it. Hence Correction #1's separate-follow-up-call architecture is required, not optional, and each follow-up call is individually wrapped in try/catch. `importAgents` gains a new `secretsApplyFailures: string[]` return field (agent names whose follow-up call threw); `importBundle` threads it through as a new top-level `secretsApplyFailures` field, distinct from the existing `secretsReminder` (which now means "bundle carries plaintext secrets, handle the directory carefully" rather than "was dropped").
- `hadSecrets`/`secretsReminder` field names are unchanged — only their meaning and the warning message text change.

---

### Task 1: `lib.mjs` — stdin-capable CLI runner, `getAgentCustomEnv`, capture `mcpConfigRedacted`

**Files:**
- Modify: `plugins/multica-tool/scripts/lib.mjs:11-32` (`realExec`, `makeCli`), `plugins/multica-tool/scripts/lib.mjs:69-83` (`getAgent`)
- Modify: `tests/multica-tool/fixtures.mjs` (fix `mcp_config_redacted` fixture values, add env-get + redacted fixtures)
- Test: `tests/multica-tool/lib.test.mjs`

**Interfaces:**
- Produces: `realExec(args, opts = {})` — `opts` may include `{ input: string }`, forwarded to `spawnSync`.
- Produces: `makeCli(exec, { workspaceId }).run(args, opts)` — `opts` forwarded to `exec` unchanged; `.json(args)` signature is unchanged (no stdin use there).
- Produces: `getAgentCustomEnv(cli, id)` — returns `{}` or the custom-env object.
- Produces: `getAgent(cli, id)` now also returns `mcpConfigRedacted: boolean` (was previously not captured — the raw field was read nowhere).

- [ ] **Step 1: Write the failing tests**

Add to `tests/multica-tool/lib.test.mjs` (after the existing `"cli.json appends --output json..."` test, before `"cli.run throws stderr on non-zero exit"`):

```js
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
```

Add after the existing `"getAgent normalizes snake_case..."` test:

```js
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
```

Update the import line at the top of `tests/multica-tool/lib.test.mjs`:

```js
import { slugify, makeCli, requireAuth, resolveWorkspaceId, listRuntimes, findByName, getSkill, getAgent, getAgentCustomEnv, getSquad, getSquadMembers } from "../../plugins/multica-tool/scripts/lib.mjs";
import { SKILL_GET, AGENT_GET, AGENT_ENV_GET, SQUAD_GET, SQUAD_MEMBERS, RUNTIME_LIST } from "./fixtures.mjs";
```

Note: `cliReturning`'s `json` lookup keys on `args.join(" ")`, so `"agent env get ag_SRC1"` already works with no helper changes — `["agent","env","get","ag_SRC1"].join(" ")` produces exactly that string.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/multica-tool/lib.test.mjs`
Expected: FAIL — `getAgentCustomEnv is not a function`, `AGENT_ENV_GET is not defined`, `mcpConfigRedacted` is `undefined` not `false`.

- [ ] **Step 3: Fix fixtures — `mcp_config_redacted` must be a real boolean, add `AGENT_ENV_GET` and `AGENT_GET_REDACTED`**

In `tests/multica-tool/fixtures.mjs`, both `AGENT_GET` and `AGENT_GET_2` currently have `mcp_config_redacted: {}` (a leftover placeholder — truthy, which would incorrectly trip the new redaction guard in Task 2). Fix both to `false`, matching the real CLI's shape confirmed live against multica 0.4.6, and add a third agent fixture whose `mcp_config` really is redacted:

```js
export const AGENT_GET = {
  id: "ag_SRC1", name: "Helper", description: "helps", instructions: "be nice",
  model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6,
  runtime_config: {}, custom_args: [], runtime_id: "rt_SRC1", thinking_level: "",
  has_custom_env: true, custom_env_key_count: 1,
  mcp_config: { mcpServers: { x: { token: "t" } } }, mcp_config_redacted: false,
  skills: [{ id: "sk_SRC1", name: "Greet", description: "says hi" }],
};
// A second agent: no skills, no secrets (used by the squad export test).
export const AGENT_GET_2 = {
  id: "ag_SRC2", name: "Helper2", description: "", instructions: "",
  model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6,
  runtime_config: {}, custom_args: [], runtime_id: "rt_SRC1", thinking_level: "",
  has_custom_env: false, custom_env_key_count: 0, mcp_config: {}, mcp_config_redacted: false,
  skills: [],
};
// A third agent: mcp_config is present at the source but redacted for this caller —
// must never be written to the bundle (see redactAgent's guard in multica-export.mjs).
export const AGENT_GET_REDACTED = {
  id: "ag_SRC3", name: "HelperRedacted", description: "", instructions: "",
  model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6,
  runtime_config: {}, custom_args: [], runtime_id: "rt_SRC1", thinking_level: "",
  has_custom_env: false, custom_env_key_count: 0,
  mcp_config: { mcpServers: { masked: {} } }, mcp_config_redacted: true,
  skills: [],
};
```

Add near the bottom of `tests/multica-tool/fixtures.mjs` (new export, doesn't replace anything):

```js
// Raw `agent env get` response — the audited, owner/admin-only command.
export const AGENT_ENV_GET = { agent_id: "ag_SRC1", custom_env: { API_KEY: "secret-value" } };
```

- [ ] **Step 4: Implement `lib.mjs` changes**

Replace `plugins/multica-tool/scripts/lib.mjs:11-32`:

```js
export function realExec(args, opts = {}) {
  return spawnSync("multica", args, { encoding: "utf8", ...opts });
}

export function makeCli(exec, { workspaceId } = {}) {
  function run(args, opts) {
    let full = args;
    if (workspaceId) {
      full = [...args, "--workspace-id", workspaceId];
    }
    const res = exec(full, opts);
    if (res.status !== 0) throw new Error(res.stderr?.trim() || `multica exited ${res.status}`);
    return res.stdout;
  }
  function json(args) {
    const fullArgs = workspaceId ? [...args, "--workspace-id", workspaceId, "--output", "json"] : [...args, "--output", "json"];
    const res = exec(fullArgs);
    if (res.status !== 0) throw new Error(res.stderr?.trim() || `multica exited ${res.status}`);
    return JSON.parse(res.stdout);
  }
  return { run, json };
}
```

Replace `getAgent` (currently `plugins/multica-tool/scripts/lib.mjs:69-83`):

```js
export function getAgent(cli, id) {
  const a = cli.json(["agent", "get", id]);
  return {
    id: a.id, name: a.name, description: a.description, instructions: a.instructions,
    model: a.model, visibility: a.visibility,
    maxConcurrentTasks: a.max_concurrent_tasks,
    runtimeConfig: a.runtime_config,
    customArgs: a.custom_args,
    thinkingLevel: a.thinking_level,
    runtimeId: a.runtime_id,
    hasCustomEnv: a.has_custom_env,
    mcpConfig: a.mcp_config,
    mcpConfigRedacted: !!a.mcp_config_redacted,
    skills: (a.skills ?? []).map((sk) => ({ id: sk.id, name: sk.name })),
  };
}
```

Add directly after `getAgent`:

```js
// Custom env is never included in `agent get` — only `has_custom_env`/`custom_env_key_count`.
// Reading actual values requires this dedicated, audited, owner/admin-only command.
export function getAgentCustomEnv(cli, id) {
  const r = cli.json(["agent", "env", "get", id]);
  return r.custom_env ?? {};
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/multica-tool/lib.test.mjs`
Expected: PASS (all tests, including the pre-existing ones).

- [ ] **Step 6: Commit**

```bash
git add plugins/multica-tool/scripts/lib.mjs tests/multica-tool/fixtures.mjs tests/multica-tool/lib.test.mjs
git commit -m "$(cat <<'EOF'
multica-tool: stdin-capable CLI runner, getAgentCustomEnv, capture mcp_config_redacted

Lays the lib.mjs groundwork for round-tripping agent mcp_config and
custom_env: cli.run() can now pass stdin input through to spawnSync (needed
so secrets never appear as inline CLI args/shell history), and
getAgentCustomEnv wraps the separate audited `agent env get` command that
custom_env requires (unlike mcp_config, which agent get already returns in
full to the owner).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `multica-export.mjs` — stop stripping `mcpConfig`, add `customEnv`, guard against redaction/fetch failure

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-export.mjs:1-51` (`redactAgent`, `collectAgent`)
- Test: `tests/multica-tool/export.test.mjs`

**Interfaces:**
- Consumes: `getAgentCustomEnv(cli, id)` from Task 1.
- Produces: `redactAgent(a)` — `a` is a normalized agent (from `getAgent`) that the caller has already attached `customEnv: object` and `customEnvFetchFailed: boolean` to. Returns `{ record, hadSecrets }` where `record.mcpConfig` and `record.customEnv` are each either the real object or `null`.

- [ ] **Step 1: Write the failing tests**

In `tests/multica-tool/export.test.mjs`, the two existing tests that assert secrets are dropped are **now wrong** — they test the exact behavior this task removes. Replace the whole `"redactAgent strips secrets/id/skills..."` test (lines 41-54) with:

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

Replace the `"export agent never writes mcp_config (secret) to disk; warns when secrets present"` test (lines 99-108) — the premise ("never writes... to disk") is exactly what this task changes:

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

test("export skips the audited agent env get call when hasCustomEnv is false", () => {
  const fs = memFs();
  const calls = [];
  const cli = fakeCli();
  const wrapped = { ...cli, json: (args) => { calls.push(args.join(" ")); return cli.json(args); } };
  exportResource({ cli: wrapped, scope: "agent", ids: { agentId: "ag_SRC2" }, outDir: "/o2", sourceWorkspaceId: "ws", fs });
  assert.ok(!calls.some((c) => c.startsWith("agent env get")), "ag_SRC2 has has_custom_env:false — must not trigger the audited call");
});

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: FAIL — `AGENT_GET_REDACTED is not defined`, `record.mcpConfig` is `undefined` (currently stripped entirely, not even `null`), `record.customEnv` is `undefined` (field doesn't exist yet), the permission-failure test throws uncaught since `collectAgent` doesn't yet wrap the call.

Update the import line at the top of `tests/multica-tool/export.test.mjs`:

```js
import { AGENT_GET, SKILL_GET, AGENT_GET_2, AGENT_GET_REDACTED, SQUAD_GET, SQUAD_MEMBERS, RUNTIME_LIST_SRC } from "./fixtures.mjs";
```

- [ ] **Step 3: Implement `multica-export.mjs` changes**

Replace `redactAgent` (currently `plugins/multica-tool/scripts/multica-export.mjs:7-17`):

```js
export function redactAgent(a) {
  // a is a normalized (camelCase) agent from getAgent, with `customEnv`/
  // `customEnvFetchFailed` attached by the caller (collectAgent) — getAgent
  // itself never fetches custom_env, since it requires a separate audited call.
  const { id, hasCustomEnv, mcpConfigRedacted, customEnvFetchFailed, mcpConfig, customEnv, skills, runtimeId, ...rest } = a;
  const mcpUsable = !mcpConfigRedacted && nonEmpty(mcpConfig);
  const envUsable = !customEnvFetchFailed && nonEmpty(customEnv);
  // mcpConfigRedacted / customEnvFetchFailed alone still flag hadSecrets even
  // when unusable — the user should know something was present at the source
  // but couldn't be captured, not just silently see an empty bundle.
  const hadSecrets = mcpUsable || envUsable || !!mcpConfigRedacted || !!customEnvFetchFailed;
  return {
    // sourceId lets import-time mention rewriting map stale `mention://agent/<id>`
    // links (in this or another agent's/squad's instructions) to the new id.
    record: {
      ...rest,
      sourceId: id,
      sourceRuntimeId: runtimeId,
      skillNames: [],
      mcpConfig: mcpUsable ? mcpConfig : null,
      customEnv: envUsable ? customEnv : null,
      hadSecrets,
    },
    hadSecrets,
  };
}
```

Update `collectAgent` (currently `plugins/multica-tool/scripts/multica-export.mjs:42-51`) to fetch `customEnv` before redaction, tolerating a failed audited call:

```js
function collectAgent(cli, id, agentsById, skills, providerById) {
  if (agentsById.has(id)) return agentsById.get(id);
  const a = getAgent(cli, id);
  a.sourceRuntimeProvider = providerById.get(a.runtimeId) ?? null;
  a.customEnv = {};
  a.customEnvFetchFailed = false;
  if (a.hasCustomEnv) {
    try {
      a.customEnv = getAgentCustomEnv(cli, id);
    } catch {
      a.customEnvFetchFailed = true; // e.g. insufficient permission — non-fatal, warned via hadSecrets
    }
  }
  const skillNames = a.skills.map((sk) => collectSkill(cli, sk.id, skills));
  const red = redactAgent(a);
  const entry = { raw: a, red, skillNames };
  agentsById.set(id, entry);
  return entry;
}
```

Update the import line at the top of `plugins/multica-tool/scripts/multica-export.mjs:3`:

```js
import { slugify, getSkill, getAgent, getAgentCustomEnv, getSquad, getSquadMembers, listRuntimes, makeCli, realExec, requireAuth, resolveWorkspaceId } from "./lib.mjs";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: PASS (all tests, including squad/skill export tests untouched by this task).

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/multica-export.mjs tests/multica-tool/export.test.mjs tests/multica-tool/fixtures.mjs
git commit -m "$(cat <<'EOF'
multica-tool: export mcp_config and custom_env instead of dropping them

redactAgent no longer strips mcp_config, and now embeds custom_env
(fetched via the new getAgentCustomEnv, only when hasCustomEnv is true).
Guards against a redacted mcp_config (mcp_config_redacted: true) ever
being written to the bundle, and against a failed (e.g. permission-denied)
agent env get call ever writing a partial/stale customEnv — both cases
still flip hadSecrets so the user is warned, but neither aborts the export.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `multica-import.mjs` — apply `mcpConfig`/`customEnv` via non-fatal follow-up calls

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-import.mjs:58-93` (`importAgents`), `plugins/multica-tool/scripts/multica-import.mjs:188-214` (`importBundle`)
- Test: `tests/multica-tool/import.test.mjs`

**Interfaces:**
- Consumes: `cli.run(args, opts)` from Task 1 (now threads `opts.input` to `exec`).
- Consumes: `rec.mcpConfig`, `rec.customEnv` from the bundle's agent JSON (Task 2's output shape) — both either an object or `null`.
- Produces: `importAgents(...)` now also returns `secretsApplyFailures: string[]` — agent names whose mcp_config/custom_env follow-up call threw (the agent itself is still created/updated; only its secrets weren't applied).
- Produces: `importBundle(...)` now also returns a top-level `secretsApplyFailures: string[]`, threaded straight from `importAgents`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/multica-tool/import.test.mjs`, after the existing `"importAgents remaps runtime id and sets mapped skill ids"` test. First add a new JSON fixture alongside the existing `AGENT_FILE`:

```js
const AGENT_FILE_WITH_SECRETS = JSON.stringify({
  name: "Helper", instructions: "be nice", model: "claude-sonnet-4-6", visibility: "workspace",
  maxConcurrentTasks: 6, sourceId: "ag_SRC1", sourceRuntimeId: "rt_SRC1", skillNames: ["Greet"],
  mcpConfig: { mcpServers: { x: { command: "npx" } } }, customEnv: { API_KEY: "secret-value" },
});
```

```js
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
  const fs = { existsSync: () => true, readFileSync: () => AGENT_FILE, readdirSync: () => [] }; // no mcpConfig/customEnv keys
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: FAIL — no `--mcp-config-stdin`/`agent env set` call is ever issued, `secretsApplyFailures` is `undefined`, and the throwing test propagates the thrown error out of `importAgents` uncaught.

- [ ] **Step 3: Implement `multica-import.mjs` changes**

Replace `importAgents` (currently `plugins/multica-tool/scripts/multica-import.mjs:58-93`):

```js
export function importAgents({ cli, manifest, dir, skillIdMap, runtimeMap, fs = nodeFs }) {
  const idMap = new Map();
  const sourceIdMap = new Map(); // source agent id -> new agent id, for mention rewriting
  const secretsApplyFailures = [];
  let created = 0, updated = 0;
  const existing = listAgents(cli);

  for (const a of manifest.agents) {
    const rec = JSON.parse(fs.readFileSync(`${dir}/${a.file}`, "utf8"));
    const targetRuntime = runtimeMap.get(rec.sourceRuntimeId);
    if (!targetRuntime) throw new Error(`Unmapped runtime "${rec.sourceRuntimeId}" for agent "${rec.name}"`);
    // Only pass optional flags when present — `--model ""` would CLEAR the model.
    const common = [
      "--visibility", rec.visibility ?? "private",
      "--max-concurrent-tasks", String(rec.maxConcurrentTasks ?? 6),
    ];
    if (rec.instructions) common.push("--instructions", rec.instructions);
    if (rec.model) common.push("--model", rec.model);
    if (rec.thinkingLevel) common.push("--thinking-level", rec.thinkingLevel);
    if (rec.runtimeConfig && Object.keys(rec.runtimeConfig).length) common.push("--runtime-config", JSON.stringify(rec.runtimeConfig));
    if (Array.isArray(rec.customArgs) && rec.customArgs.length) common.push("--custom-args", JSON.stringify(rec.customArgs));
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
    if (rec.sourceId) sourceIdMap.set(rec.sourceId, id);
    const skillIds = (rec.skillNames ?? []).map((n) => skillIdMap.get(n)).filter(Boolean);
    cli.run(["agent", "skills", "set", id, "--skill-ids", skillIds.join(",")]);

    // mcp_config/custom_env carry real secrets. Each is applied via its OWN
    // follow-up call, never bundled into the create/update call above — that
    // keeps a rejected secret from failing the whole agent create/update, and
    // sidesteps the fact that only one stdin payload can be read per process
    // anyway. `agent update --mcp-config-stdin` works on a freshly-created id
    // too, so no create/update branching is needed here.
    const hasMcpConfig = rec.mcpConfig && Object.keys(rec.mcpConfig).length > 0;
    if (hasMcpConfig) {
      try {
        cli.run(["agent", "update", id, "--mcp-config-stdin"], { input: JSON.stringify(rec.mcpConfig) });
      } catch {
        secretsApplyFailures.push(rec.name);
      }
    }
    // custom_env has no flag on `agent update` at all — `agent env set` is the
    // only way to set it on an existing agent, so it's always a follow-up call.
    const hasCustomEnv = rec.customEnv && Object.keys(rec.customEnv).length > 0;
    if (hasCustomEnv) {
      try {
        cli.run(["agent", "env", "set", id, "--custom-env-stdin"], { input: JSON.stringify(rec.customEnv) });
      } catch {
        secretsApplyFailures.push(rec.name);
      }
    }
  }
  return { idMap, sourceIdMap, created, updated, secretsApplyFailures };
}
```

Update `importBundle` (currently `plugins/multica-tool/scripts/multica-import.mjs:188-214`) — only the final `return` block changes:

```js
  return {
    created: { skills: skillRes.created, agents: agentRes.created, squads: squadRes.created },
    updated: { skills: skillRes.updated, agents: agentRes.updated, squads: squadRes.updated },
    mentionsRewritten: mentionRes.updated,
    skillIdMap: Object.fromEntries(skillRes.idMap),
    agentIdMap: Object.fromEntries(agentRes.idMap),
    squadId: squadRes.newId,
    secretsReminder: (manifest.agents ?? []).filter((a) => a.hadSecrets).map((a) => a.name),
    secretsApplyFailures: agentRes.secretsApplyFailures,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: PASS (all tests, including the pre-existing skill/mention/squad/runtime-map tests untouched by this task).

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/multica-import.mjs tests/multica-tool/import.test.mjs
git commit -m "$(cat <<'EOF'
multica-tool: apply mcp_config and custom_env on agent import, non-fatally

Both secrets are applied via their own follow-up call after the base
agent create/update — never bundled into it, since (a) only one stdin
payload can be read per multica invocation, confirmed live that combining
--mcp-config-stdin and --custom-env-stdin in one call breaks JSON
validation on the second flag, and (b) bundling would mean a rejected
secret fails the whole agent create/update. Each follow-up is wrapped so
a failure is recorded in the new secretsApplyFailures list (threaded
through importBundle) without undoing the agent's creation/update.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Update warning message text in export/import/sync skill docs

**Files:**
- Modify: `plugins/multica-tool/skills/export/SKILL.md:61`
- Modify: `plugins/multica-tool/skills/import/SKILL.md:51`
- Modify: `plugins/multica-tool/skills/sync/SKILL.md:53`

**Interfaces:**
- None (documentation only — no code interface changes).

- [ ] **Step 1: Update `plugins/multica-tool/skills/export/SKILL.md`**

Replace line 61:

```
- If `warnings` is non-empty, surface every agent name verbatim with this message: "WARNING: the following agents had custom environment variables or MCP config that were NOT exported — re-add secrets manually after import: `<agent-name>`."
```

with:

```
- If `warnings` is non-empty, surface every agent name verbatim with this message: "WARNING: the following agents' exported files contain custom environment variables or MCP config in PLAINTEXT — treat the export directory as sensitive (avoid committing it to a public repo, restrict file permissions, delete it once the import is done): `<agent-name>`."
```

- [ ] **Step 2: Update `plugins/multica-tool/skills/import/SKILL.md`**

Replace line 51:

```
- If `secretsReminder` is non-empty, surface every agent name verbatim with: "WARNING: the following agents had custom environment variables or MCP config that were NOT exported — re-add secrets manually in the Multica UI: `<agent-name>`."
```

with:

```
- If `secretsReminder` is non-empty, surface every agent name verbatim with: "WARNING: the following agents' bundle files contained custom environment variables or MCP config in PLAINTEXT — the source export directory should be treated as sensitive: `<agent-name>`."
- If `secretsApplyFailures` is non-empty, surface every agent name verbatim with: "WARNING: mcp_config or custom_env failed to apply to the following agents during import (the agent itself was still created/updated) — set them manually in the Multica UI: `<agent-name>`."
```

- [ ] **Step 3: Update `plugins/multica-tool/skills/sync/SKILL.md`**

Replace line 53:

```
- If `secretsReminder` is non-empty, surface every agent name verbatim with: "WARNING: the following agents had custom environment variables or MCP config that were NOT exported — re-add secrets manually in the Multica UI: `<agent-name>`."
```

with:

```
- If `secretsReminder` is non-empty, surface every agent name verbatim with: "WARNING: the following agents' bundle files contained custom environment variables or MCP config in PLAINTEXT — the temporary export directory (already cleaned up) briefly held these secrets in plaintext: `<agent-name>`."
- If `secretsApplyFailures` is non-empty, surface every agent name verbatim with: "WARNING: mcp_config or custom_env failed to apply to the following agents during sync (the agent itself was still created/updated) — set them manually in the Multica UI: `<agent-name>`."
```

- [ ] **Step 4: Commit**

```bash
git add plugins/multica-tool/skills/export/SKILL.md plugins/multica-tool/skills/import/SKILL.md plugins/multica-tool/skills/sync/SKILL.md
git commit -m "$(cat <<'EOF'
multica-tool: update secrets warning text now that mcp_config/custom_env round-trip

The old message told users to "re-add secrets manually" — no longer true
now that both fields are actually exported/imported. The new messages
distinguish "bundle now contains plaintext secrets, handle the directory
carefully" (secretsReminder) from "a secret failed to apply at import
time, go set it manually" (the new secretsApplyFailures).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Full verification — test suite, plugin-validator, live smoke test

**Files:**
- None modified — this task only runs verification.

**Interfaces:**
- None.

- [ ] **Step 1: Run the full multica-tool test suite**

Run: `node --test tests/multica-tool/*.test.mjs`
Expected: All tests pass (from Tasks 1-3, plus the pre-existing skill/squad/sync tests, which are untouched by this plan).

- [ ] **Step 2: Validate plugin manifests**

Run: `python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"`
Expected: `OK` — this plan doesn't touch any manifest, but the repo convention runs this after every change.

- [ ] **Step 3: Run the `plugin-validator` agent against `multica-tool`**

Invoke the `plugin-validator` agent (per this repo's `CLAUDE.md` — required after any plugin implementation work) scoped to `plugins/multica-tool/`. Fix any `[FAIL]` items it reports before proceeding.

- [ ] **Step 4: Live smoke test against the local multica instance**

This repo's sandbox has an authenticated `multica` CLI (0.4.6+) pointed at `http://127.0.0.1:8080`. Exercise the real round-trip on throwaway agents, then clean up:

```bash
RUNTIME_ID=$(multica runtime list --output json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
AGENT_ID=$(multica agent create --name "smoke-test-src" --runtime-id "$RUNTIME_ID" \
  --mcp-config '{"mcpServers":{"foo":{"command":"npx","args":["foo"]}}}' \
  --output json | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
multica agent env set "$AGENT_ID" --custom-env '{"SMOKE_KEY":"smoke-value"}' --output json

node plugins/multica-tool/scripts/multica-export.mjs --scope agent --id "$AGENT_ID" --out /tmp/multica-smoke-export

python3 -c "
import json
rec = json.load(open('/tmp/multica-smoke-export/agents/smoke-test-src.json'))
assert rec['mcpConfig']['mcpServers']['foo']['command'] == 'npx', rec
assert rec['customEnv']['SMOKE_KEY'] == 'smoke-value', rec
print('export OK: mcp_config and custom_env present in bundle')
"

# Rename the bundle's agent to a fresh name so import creates a NEW agent
# rather than clobbering the source (keeps this a clean two-agent test).
python3 -c "
import json, os
p = '/tmp/multica-smoke-export/agents/smoke-test-src.json'
rec = json.load(open(p))
rec['name'] = 'smoke-test-dst'
os.rename(p, '/tmp/multica-smoke-export/agents/smoke-test-dst.json')
json.dump(rec, open('/tmp/multica-smoke-export/agents/smoke-test-dst.json', 'w'))
m = '/tmp/multica-smoke-export/manifest.json'
mm = json.load(open(m))
mm['agents'][0]['name'] = 'smoke-test-dst'
mm['agents'][0]['file'] = 'agents/smoke-test-dst.json'
json.dump(mm, open(m, 'w'))
"

WS_NAME=$(multica workspace list --output json | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['name'])")
node plugins/multica-tool/scripts/multica-import.mjs --dir /tmp/multica-smoke-export --workspace "$WS_NAME"

DST_ID=$(multica agent list --output json | python3 -c "
import json,sys
for a in json.load(sys.stdin):
    if a['name'] == 'smoke-test-dst': print(a['id'])
")
multica agent get "$DST_ID" --output json | python3 -c "
import json,sys
d = json.load(sys.stdin)
assert d['mcp_config']['mcpServers']['foo']['command'] == 'npx', d
print('mcp_config round-tripped OK')
"
multica agent env get "$DST_ID" --output json | python3 -c "
import json,sys
d = json.load(sys.stdin)
assert d['custom_env']['SMOKE_KEY'] == 'smoke-value', d
print('custom_env round-tripped OK')
"

multica agent archive "$AGENT_ID"
multica agent archive "$DST_ID"
rm -rf /tmp/multica-smoke-export
```

Expected: `export OK`, `mcp_config round-tripped OK`, `custom_env round-tripped OK`. If any assertion fails, stop and debug before considering this plan complete — do not report success on a partial round-trip.

- [ ] **Step 5: Final report**

Summarize: test suite pass/fail counts, plugin-validator result, live smoke test result. Only claim the feature complete if all three passed.
