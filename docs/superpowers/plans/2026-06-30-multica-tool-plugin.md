# multica-tool Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `multica-tool` marketplace plugin that exports/imports/syncs Multica skills, agents, and squads between workspaces, backed by the `multica` CLI.

**Architecture:** Deterministic migration logic lives in injectable-runner Node ESM helpers under `scripts/` (graph walk, manifest build, ID-by-name remapping, idempotent upsert). Three skills drive the model-facing interaction (scope pick, runtime remap, workspace confirm) and call those scripts. Three commands are slash entrypoints; three agents are delegatable executors. `sync` adds no new logic — it runs export→temp-dir→import so rewiring/upsert is exercised once in shared code.

**Tech Stack:** Node.js ESM (`.mjs`, native `child_process.spawnSync` + `fs` + `JSON`, no deps), `multica` CLI 0.3.29, Claude Code plugin conventions (auto-discovered skills/agents/commands).

## Global Constraints

- **Resolve everything by name.** Re-created resources get new IDs; captured source IDs are debug-only. All wiring (agent→skills, squad→leader, squad→members, workspace) resolves by exact name at import time.
- **Import is idempotent.** Re-running updates the matched-by-name resource; it never duplicates.
- **Fail loud, no partial silent work.** Any `multica` non-zero exit → surface stderr and stop. Unauthenticated → stop, instruct `multica login`. Unknown/ambiguous/unmapped name → stop, never guess or invent an ID.
- **Secrets never touch disk.** `customEnv` and `mcpConfig` are NOT written to export files. Export warns when present; import reminds the user to re-set them on the target.
- **JSON everywhere.** Every read command appends `--output json` (CLI default is `table` for `runtime list`/`workspace list`). `auth status` has no JSON — use exit code.
- **Content via files.** Pass skill/skill-file content with `--content-file <path>`, never inline `--content`, to avoid arg-length/escaping limits.
- **Workspace targeting.** `import`/`sync` thread the resolved target workspace through the global `--workspace-id` flag on every CLI call.
- **Tests live at repo-root `tests/multica-tool/`** (not packaged for npm). Run with `node --test tests/multica-tool/*.test.mjs`.
- **Versions stay `0.1.0`** in source; CI rewrites on release. Never bump by hand.
- **Implementation edits stay inside `plugins/multica-tool/`** except the one registration commit (Task 1) which touches `marketplace.json` + `README.md` per repo CLAUDE.md.
- **CLI field-name caveat:** exact JSON field names returned by `get`/`list` are assumed in this plan (documented per get-wrapper). Task 3 Step 6 verifies them against a real authed resource and adjusts the wrappers in one place if reality differs. All downstream tasks consume the wrappers, never raw JSON.

---

## File Structure

```
plugins/multica-tool/
  .claude-plugin/plugin.json        # manifest (name, version, description)
  commands/export.md                # /multica-tool:export → run export skill
  commands/import.md                # /multica-tool:import → run import skill
  commands/sync.md                  # /multica-tool:sync   → run sync skill
  agents/export.md                  # delegatable executor → runs export skill
  agents/import.md                  # delegatable executor → runs import skill
  agents/sync.md                    # delegatable executor → runs sync skill
  skills/export/SKILL.md            # drive scope pick → call exporter → report
  skills/import/SKILL.md            # point at folder → confirm ws → remap runtimes → call importer
  skills/sync/SKILL.md              # parse args → resolve ws → call sync
  scripts/lib.mjs                   # injectable CLI runner, JSON, slugify, resolvers, get-wrappers
  scripts/multica-export.mjs        # buildManifest + exportResource (writes folder)
  scripts/multica-import.mjs        # importSkills/Agents/Squad + importBundle (report)
  scripts/multica-sync.mjs          # sync() = export(src) → temp → import(dest)
tests/multica-tool/
  lib.test.mjs
  export.test.mjs
  import.test.mjs
  sync.test.mjs
  fixtures.mjs                      # shared canned CLI JSON
```

- `scripts/lib.mjs` owns ALL CLI contact and the field-name assumptions. The three operation scripts contain no `spawnSync` and no raw field access — they call lib functions. This keeps the one fragile thing (CLI shape) in one file.
- Operation scripts export pure-ish functions taking an injected `exec` (or a `cli` built from it) so tests never spawn `multica`.

---

## Task 1: Plugin registration (scaffold + marketplace + README)

Registers the plugin in one commit per repo CLAUDE.md. No business logic yet — config only, so no unit test; validated by JSON load.

**Files:**
- Create: `plugins/multica-tool/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json` (add `plugins[]` entry)
- Modify: `README.md` (add Plugins-table row)

**Interfaces:**
- Produces: the plugin directory + manifest that all later tasks add files under.

- [ ] **Step 1: Create the plugin manifest**

Create `plugins/multica-tool/.claude-plugin/plugin.json`:

```json
{
  "name": "multica-tool",
  "version": "0.1.0",
  "description": "Export, import, and sync Multica skills, agents, and squads between workspaces via the multica CLI."
}
```

- [ ] **Step 2: Add the marketplace entry**

In `.claude-plugin/marketplace.json`, add to `plugins[]` (match the shape of existing entries — open the file and copy the field set used by `team-share`):

```json
{
  "name": "multica-tool",
  "source": "./plugins/multica-tool",
  "description": "Export, import, and sync Multica skills, agents, and squads between workspaces.",
  "version": "0.1.0",
  "category": "workflow",
  "keywords": ["multica", "migration", "export", "import", "sync", "skills", "agents", "squads"]
}
```

- [ ] **Step 3: Add the README row**

In `README.md`, find the Plugins table and add a row matching the existing column order (open the file to confirm columns; typical: Plugin | Description):

```markdown
| [multica-tool](plugins/multica-tool) | Export, import, and sync Multica skills, agents, and squads between workspaces. |
```

- [ ] **Step 4: Validate manifests**

Run:
```bash
python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
```
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/.claude-plugin/plugin.json .claude-plugin/marketplace.json README.md
git commit -m "feat(multica-tool): register plugin in marketplace"
```

---

## Task 2: lib core — slugify, injectable CLI runner, auth check

**Files:**
- Create: `plugins/multica-tool/scripts/lib.mjs`
- Test: `tests/multica-tool/lib.test.mjs`

**Interfaces:**
- Produces:
  - `slugify(name: string) -> string` — filesystem-safe slug (lowercase, non-alnum→`-`, collapse/trim dashes, empty→`unnamed`).
  - `makeCli(exec, { workspaceId } = {}) -> { run(args: string[]) -> string, json(args: string[]) -> any }` where `exec(args: string[]) -> { stdout: string, stderr: string, status: number }` (shape of `child_process.spawnSync`). `run` appends `--workspace-id <id>` when set, throws `Error(stderr || "multica exited N")` on non-zero `status`, returns `stdout`. `json` calls `run(args.concat(["--output","json"]))` and returns `JSON.parse(stdout)`.
  - `requireAuth(exec) -> void` — runs `exec(["auth","status"])`; throws `Error("Not authenticated. Run: multica login")` on non-zero status.
  - `realExec(args) -> {stdout,stderr,status}` — default `spawnSync("multica", args, {encoding:"utf8"})`.

- [ ] **Step 1: Write the failing test**

Create `tests/multica-tool/lib.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multica-tool/lib.test.mjs`
Expected: FAIL — cannot find module / `slugify is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/multica-tool/scripts/lib.mjs`:

```js
import { spawnSync } from "node:child_process";

export function slugify(name) {
  const s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "unnamed";
}

export function realExec(args) {
  return spawnSync("multica", args, { encoding: "utf8" });
}

export function makeCli(exec, { workspaceId } = {}) {
  function run(args) {
    const full = workspaceId ? [...args, "--workspace-id", workspaceId] : args;
    const res = exec(full);
    if (res.status !== 0) throw new Error(res.stderr?.trim() || `multica exited ${res.status}`);
    return res.stdout;
  }
  function json(args) {
    return JSON.parse(run([...args, "--output", "json"]));
  }
  return { run, json };
}

export function requireAuth(exec) {
  const res = exec(["auth", "status"]);
  if (res.status !== 0) throw new Error("Not authenticated. Run: multica login");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multica-tool/lib.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/lib.mjs tests/multica-tool/lib.test.mjs
git commit -m "feat(multica-tool): add lib core (slugify, injectable cli, auth)"
```

---

## Task 3: lib resolvers + get-wrappers

Centralizes name→ID resolution and every field-name assumption.

**Files:**
- Modify: `plugins/multica-tool/scripts/lib.mjs`
- Create: `tests/multica-tool/fixtures.mjs`
- Modify: `tests/multica-tool/lib.test.mjs`

**Interfaces:**
- Consumes: `makeCli` from Task 2.
- Produces (all take a `cli` from `makeCli`):
  - `resolveWorkspaceId(cli, name) -> string` — `cli.json(["workspace","list"])` → match `.name === name`; throw if 0 (`Unknown workspace "<name>"`) or >1 (`Ambiguous workspace "<name>"`).
  - `listRuntimes(cli) -> Array<{id,name}>` — `cli.json(["runtime","list"])`.
  - `findByName(list, name) -> object|null` — returns the single match or `null`; throws on >1 (`Duplicate name "<name>"`).
  - `getSkill(cli, id) -> {id,name,description,content,config,files}` where `files: Array<{path,content}>` (extra files only; main body is `content`).
  - `getAgent(cli, id) -> {id,name,description,instructions,model,visibility,maxConcurrentTasks,runtimeConfig,customArgs,runtimeId,customEnv,mcpConfig}`.
  - `getAgentSkills(cli, id) -> Array<{id,name}>`.
  - `getSquad(cli, id) -> {id,name,description,leaderName}`.
  - `getSquadMembers(cli, id) -> Array<{agentName,role}>`.
  - `listSkills(cli)/listAgents(cli)/listSquads(cli) -> Array<{id,name}>`.

> Field-name assumptions live ONLY in this file. If Step 6 finds the real CLI uses different keys, fix them here; downstream code is unaffected.

- [ ] **Step 1: Write fixtures**

Create `tests/multica-tool/fixtures.mjs`:

```js
// Source-workspace canned `get` output. Source IDs deliberately DIFFER from
// any target IDs so tests catch link-by-id regressions.
export const SKILL_GET = {
  id: "sk_SRC1", name: "Greet", description: "says hi",
  content: "# Greet\nbody", config: { tone: "warm" },
  files: [{ path: "ref.md", content: "extra" }],
};
export const AGENT_GET = {
  id: "ag_SRC1", name: "Helper", description: "helps", instructions: "be nice",
  model: "claude-sonnet-4-6", visibility: "workspace", maxConcurrentTasks: 6,
  runtimeConfig: {}, customArgs: [], runtimeId: "rt_SRC1",
  customEnv: { SECRET: "shh" }, mcpConfig: { mcpServers: { x: { token: "t" } } },
};
export const AGENT_SKILLS = [{ id: "sk_SRC1", name: "Greet" }];
export const SQUAD_GET = { id: "sq_SRC1", name: "Team", description: "the team", leaderName: "Helper" };
export const SQUAD_MEMBERS = [
  { agentName: "Helper", role: "leader" },
  { agentName: "Helper2", role: "member" },
];
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/multica-tool/lib.test.mjs`:

```js
import { resolveWorkspaceId, listRuntimes, findByName, getSkill } from "../../plugins/multica-tool/scripts/lib.mjs";
import { SKILL_GET } from "./fixtures.mjs";

function cliReturning(map) {
  // map: JSON.stringify(args-without-output/ws) -> object
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

test("getSkill returns parsed skill object", () => {
  const cli = cliReturning({ "skill get sk_SRC1": SKILL_GET });
  assert.equal(getSkill(cli, "sk_SRC1").content, "# Greet\nbody");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/multica-tool/lib.test.mjs`
Expected: FAIL — `resolveWorkspaceId is not a function`.

- [ ] **Step 4: Write minimal implementation**

Append to `plugins/multica-tool/scripts/lib.mjs`:

```js
export function findByName(list, name) {
  const hits = (list || []).filter((x) => x.name === name);
  if (hits.length > 1) throw new Error(`Duplicate name "${name}" — refusing to guess`);
  return hits[0] || null;
}

export function resolveWorkspaceId(cli, name) {
  const list = cli.json(["workspace", "list"]);
  const hits = list.filter((w) => w.name === name);
  if (hits.length === 0) throw new Error(`Unknown workspace "${name}"`);
  if (hits.length > 1) throw new Error(`Ambiguous workspace "${name}"`);
  return hits[0].id;
}

export const listRuntimes = (cli) => cli.json(["runtime", "list"]);
export const listSkills = (cli) => cli.json(["skill", "list"]);
export const listAgents = (cli) => cli.json(["agent", "list"]);
export const listSquads = (cli) => cli.json(["squad", "list"]);

export const getSkill = (cli, id) => cli.json(["skill", "get", id]);
export const getAgent = (cli, id) => cli.json(["agent", "get", id]);
export const getAgentSkills = (cli, id) => cli.json(["agent", "skills", "list", id]);
export const getSquad = (cli, id) => cli.json(["squad", "get", id]);
export const getSquadMembers = (cli, id) => cli.json(["squad", "member", "list", id]);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/multica-tool/lib.test.mjs`
Expected: PASS (all lib tests).

- [ ] **Step 6: Verify field names against the real CLI (one-time)**

If an authed Multica workspace with at least one skill/agent/squad is reachable, run and compare top-level keys to the wrapper assumptions above:
```bash
multica skill list --output json | head -c 400; echo
multica skill get "$(multica skill list --output json | node -e 'process.stdin.once("data",d=>console.log(JSON.parse(d)[0].id))')" --output json | node -e 'process.stdin.once("data",d=>console.log(Object.keys(JSON.parse(d))))'
```
Expected: keys include `id`, `name`, `content`, `config`, `files`. If a key differs (e.g. `body` vs `content`, or `files[].path` vs `files[].filename`), update ONLY the wrappers in `lib.mjs` and the matching fixture keys, then re-run `node --test tests/multica-tool/lib.test.mjs`. If no authed workspace is available, note this step as deferred and proceed — the wrappers are the single change point later.

- [ ] **Step 7: Commit**

```bash
git add plugins/multica-tool/scripts/lib.mjs tests/multica-tool/lib.test.mjs tests/multica-tool/fixtures.mjs
git commit -m "feat(multica-tool): add lib resolvers and get-wrappers"
```

---

## Task 4: export — buildManifest + redactAgent (pure)

The pure core of export: turn fetched data into a manifest + file plan, stripping secrets.

**Files:**
- Create: `plugins/multica-tool/scripts/multica-export.mjs`
- Create: `tests/multica-tool/export.test.mjs`

**Interfaces:**
- Consumes: `slugify` from lib.
- Produces:
  - `redactAgent(agentRaw) -> { record, hadSecrets }` — `record` is the agent minus `id`,`customEnv`,`mcpConfig`, plus `sourceRuntimeId: agentRaw.runtimeId` and `skillNames: []` (filled by caller). `hadSecrets` true if `customEnv` or `mcpConfig` was non-empty.
  - `buildManifest({ scope, sourceWorkspaceId, skills, agents, squad }) -> manifest` where `skills: Array<{name,sourceId}>`, `agents: Array<{name,sourceRuntimeId,skillNames}>`, `squad: {name,leaderName,members:[{agentName,role}]}|null`. Produces the manifest schema from the spec; slugs via `slugify`; dedups skills by name.

- [ ] **Step 1: Write the failing test**

Create `tests/multica-tool/export.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactAgent, buildManifest } from "../../plugins/multica-tool/scripts/multica-export.mjs";
import { AGENT_GET } from "./fixtures.mjs";

test("redactAgent strips secrets and id, records runtime", () => {
  const { record, hadSecrets } = redactAgent(AGENT_GET);
  assert.equal(hadSecrets, true);
  assert.ok(!("customEnv" in record));
  assert.ok(!("mcpConfig" in record));
  assert.ok(!("id" in record));
  assert.equal(record.sourceRuntimeId, "rt_SRC1");
  assert.equal(record.name, "Helper");
});

test("buildManifest dedups skills by name and wires by name", () => {
  const m = buildManifest({
    scope: "squad",
    sourceWorkspaceId: "ws_SRC",
    skills: [{ name: "Greet", sourceId: "sk_SRC1" }, { name: "Greet", sourceId: "sk_SRC1" }],
    agents: [{ name: "Helper", sourceRuntimeId: "rt_SRC1", skillNames: ["Greet"] }],
    squad: { name: "Team", leaderName: "Helper", members: [{ agentName: "Helper", role: "leader" }] },
  });
  assert.equal(m.version, "1");
  assert.equal(m.skills.length, 1, "skills deduped by name");
  assert.equal(m.skills[0].dir, "skills/greet");
  assert.equal(m.agents[0].file, "agents/helper.json");
  assert.deepEqual(m.agents[0].skillNames, ["Greet"]);
  assert.equal(m.squads[0].leaderName, "Helper");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/multica-tool/scripts/multica-export.mjs`:

```js
import { slugify } from "./lib.mjs";

const nonEmpty = (v) => v && typeof v === "object" && Object.keys(v).length > 0;

export function redactAgent(a) {
  const { id, customEnv, mcpConfig, runtimeId, ...rest } = a;
  return {
    record: { ...rest, sourceRuntimeId: runtimeId, skillNames: [] },
    hadSecrets: nonEmpty(customEnv) || nonEmpty(mcpConfig),
  };
}

export function buildManifest({ scope, sourceWorkspaceId, skills, agents, squad }) {
  const seen = new Map();
  for (const s of skills) if (!seen.has(s.name)) seen.set(s.name, s);
  return {
    version: "1",
    scope,
    sourceWorkspaceId,
    skills: [...seen.values()].map((s) => ({ name: s.name, dir: `skills/${slugify(s.name)}`, sourceId: s.sourceId })),
    agents: agents.map((a) => ({ name: a.name, file: `agents/${slugify(a.name)}.json`, sourceRuntimeId: a.sourceRuntimeId, skillNames: a.skillNames })),
    squads: squad ? [{ name: squad.name, file: `squads/${slugify(squad.name)}.json`, leaderName: squad.leaderName, members: squad.members }] : [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/multica-export.mjs tests/multica-tool/export.test.mjs
git commit -m "feat(multica-tool): add export manifest builder and secret redaction"
```

---

## Task 5: export — exportResource orchestrator (writes folder)

Walks the resource graph via lib wrappers and writes the export folder. Proves secrets never reach disk.

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-export.mjs`
- Modify: `tests/multica-tool/export.test.mjs`

**Interfaces:**
- Consumes: `getSkill,getAgent,getAgentSkills,getSquad,getSquadMembers` (lib), `buildManifest`,`redactAgent`.
- Produces:
  - `exportResource({ cli, scope, ids, outDir, sourceWorkspaceId, fs }) -> { manifest, warnings }` where `scope` ∈ `"skill"|"agent"|"squad"`, `ids` is `{skillId?,agentId?,squadId?}`, `fs` is an injected `{mkdirSync, writeFileSync}` (default `node:fs`). Writes `manifest.json`, `skills/<slug>/SKILL.md`+`config.json`+extra files, `agents/<slug>.json`, `squads/<slug>.json`. `warnings` lists agents whose secrets were skipped.
  - Graph walk: squad → members (agents) → each agent's skills; agent → its skills; skill → itself. Dedup agents and skills by name.

- [ ] **Step 1: Write the failing test**

Append to `tests/multica-tool/export.test.mjs`:

```js
import { exportResource } from "../../plugins/multica-tool/scripts/multica-export.mjs";
import { SKILL_GET, AGENT_GET, AGENT_SKILLS, SQUAD_GET, SQUAD_MEMBERS } from "./fixtures.mjs";

function fakeCli() {
  return {
    json: (args) => {
      const key = args.slice(0, 3).join(" ");
      if (key === "squad get sq_SRC1") return SQUAD_GET;
      if (key === "squad member list") return SQUAD_MEMBERS;
      if (key === "agent get ag_SRC1") return AGENT_GET;
      if (key === "agent get ag_SRC2") return { ...AGENT_GET, id: "ag_SRC2", name: "Helper2", customEnv: {}, mcpConfig: {} };
      if (key === "agent skills list") return AGENT_SKILLS;
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

test("export skill writes SKILL.md, config, extra files, manifest — no secrets", () => {
  const fs = memFs();
  const { manifest } = exportResource({ cli: fakeCli(), scope: "skill", ids: { skillId: "sk_SRC1" }, outDir: "/out", sourceWorkspaceId: "ws_SRC", fs });
  assert.equal(fs.files["/out/skills/greet/SKILL.md"], "# Greet\nbody");
  assert.ok(fs.files["/out/skills/greet/config.json"].includes("warm"));
  assert.equal(fs.files["/out/skills/greet/ref.md"], "extra");
  assert.ok(fs.files["/out/manifest.json"]);
  assert.equal(manifest.skills[0].name, "Greet");
});

test("export agent never writes customEnv or mcpConfig to disk", () => {
  const fs = memFs();
  const { warnings } = exportResource({ cli: fakeCli(), scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/o", sourceWorkspaceId: "ws", fs });
  const blob = Object.values(fs.files).join("\n");
  assert.ok(!blob.includes("shh"), "customEnv value leaked");
  assert.ok(!blob.includes("\"token\""), "mcpConfig leaked");
  assert.deepEqual(warnings, ["Helper"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: FAIL — `exportResource is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to the top imports of `multica-export.mjs`:
```js
import * as nodeFs from "node:fs";
import { getSkill, getAgent, getAgentSkills, getSquad, getSquadMembers } from "./lib.mjs";
```
Append:
```js
function collectSkill(cli, id, skills) {
  const s = getSkill(cli, id);
  if (!skills.has(s.name)) skills.set(s.name, s);
  return s.name;
}

function collectAgent(cli, id, agents, skills) {
  const a = getAgent(cli, id);
  if (agents.has(a.name)) return a.name;
  const assigned = getAgentSkills(cli, id);
  const skillNames = assigned.map((sk) => collectSkill(cli, sk.id, skills));
  agents.set(a.name, { raw: a, skillNames });
  return a.name;
}

export function exportResource({ cli, scope, ids, outDir, sourceWorkspaceId, fs = nodeFs }) {
  const skills = new Map();   // name -> skill get
  const agents = new Map();   // name -> { raw, skillNames }
  let squad = null;

  if (scope === "skill") collectSkill(cli, ids.skillId, skills);
  if (scope === "agent") collectAgent(cli, ids.agentId, agents, skills);
  if (scope === "squad") {
    const sq = getSquad(cli, ids.squadId);
    const members = getSquadMembers(cli, ids.squadId);
    for (const m of members) {
      // member list gives agentName; we need its id — resolve by listing? The
      // squad member objects carry agentId in real output; capture via raw.
      collectAgent(cli, m.agentId, agents, skills);
    }
    squad = { name: sq.name, leaderName: sq.leaderName, members: members.map((m) => ({ agentName: m.agentName, role: m.role })) };
  }

  const manifest = buildManifest({
    scope, sourceWorkspaceId,
    skills: [...skills.values()].map((s) => ({ name: s.name, sourceId: s.id })),
    agents: [...agents.values()].map((a) => ({ name: a.raw.name, sourceRuntimeId: a.raw.runtimeId, skillNames: a.skillNames })),
    squad,
  });

  const warnings = [];
  fs.mkdirSync(outDir, { recursive: true });

  for (const entry of manifest.skills) {
    const s = skills.get(entry.name);
    const dir = `${outDir}/${entry.dir}`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/SKILL.md`, s.content ?? "");
    fs.writeFileSync(`${dir}/config.json`, JSON.stringify(s.config ?? {}, null, 2));
    for (const f of s.files ?? []) fs.writeFileSync(`${dir}/${f.path}`, f.content ?? "");
  }
  for (const entry of manifest.agents) {
    const { raw, skillNames } = agents.get(entry.name);
    const { record, hadSecrets } = redactAgent(raw);
    record.skillNames = skillNames;
    if (hadSecrets) warnings.push(raw.name);
    fs.mkdirSync(`${outDir}/agents`, { recursive: true });
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(record, null, 2));
  }
  for (const entry of manifest.squads) {
    fs.mkdirSync(`${outDir}/squads`, { recursive: true });
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(entry, null, 2));
  }
  fs.writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));
  return { manifest, warnings };
}
```

> **Note for implementer:** `getSquadMembers` must surface `agentId` (used above). Confirm in Task 3 Step 6 that `squad member list --output json` includes an agent id field; if it is named differently (e.g. `memberId`), adjust the `getSquadMembers` wrapper to normalize it to `agentId` so this code is stable. Update the `SQUAD_MEMBERS` fixture to include `agentId: "ag_SRC1"` / `agentId: "ag_SRC2"`.

- [ ] **Step 4: Update the fixture and run**

In `tests/multica-tool/fixtures.mjs`, add `agentId` to each `SQUAD_MEMBERS` entry:
```js
export const SQUAD_MEMBERS = [
  { agentId: "ag_SRC1", agentName: "Helper", role: "leader" },
  { agentId: "ag_SRC2", agentName: "Helper2", role: "member" },
];
```
Run: `node --test tests/multica-tool/export.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/multica-export.mjs tests/multica-tool/export.test.mjs tests/multica-tool/fixtures.mjs
git commit -m "feat(multica-tool): add exportResource folder writer"
```

---

## Task 6: import — skills replay (idempotent upsert by name)

**Files:**
- Create: `plugins/multica-tool/scripts/multica-import.mjs`
- Create: `tests/multica-tool/import.test.mjs`

**Interfaces:**
- Consumes: `listSkills` (lib), `cli.run`.
- Produces:
  - `importSkills({ cli, manifest, dir, fs }) -> { idMap: Map<name,newId>, created: number, updated: number }`. For each manifest skill: `findByName(listSkills(cli), name)`. Exists → `cli.run(["skill","update",id,"--content-file",<dir>/SKILL.md,"--config",<config json>,...])`; missing → `cli.run(["skill","create","--name",name,"--content-file",...,"--config",...])` then parse new id from JSON stdout. Then `cli.run(["skill","files","upsert",newId,"--path",f.path,"--content-file",<path>])` for each extra file. `fs` injected `{readFileSync, readdirSync, existsSync}`.

- [ ] **Step 1: Write the failing test**

Create `tests/multica-tool/import.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/multica-tool/scripts/multica-import.mjs`:

```js
import * as nodeFs from "node:fs";
import { listSkills, findByName } from "./lib.mjs";

export function importSkills({ cli, manifest, dir, fs = nodeFs }) {
  const idMap = new Map();
  let created = 0, updated = 0;
  const existing = listSkills(cli);

  for (const s of manifest.skills) {
    const sdir = `${dir}/${s.dir}`;
    const contentPath = `${sdir}/SKILL.md`;
    const configPath = `${sdir}/config.json`;
    const config = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "{}";
    const match = findByName(existing, s.name);
    let id;
    if (match) {
      cli.run(["skill", "update", match.id, "--content-file", contentPath, "--config", config]);
      id = match.id; updated++;
    } else {
      const out = cli.run(["skill", "create", "--name", s.name, "--content-file", contentPath, "--config", config]);
      id = JSON.parse(out).id; created++;
    }
    idMap.set(s.name, id);
    // upsert extra files (everything except SKILL.md and config.json)
    for (const f of fs.readdirSync(sdir)) {
      if (f === "SKILL.md" || f === "config.json") continue;
      cli.run(["skill", "files", "upsert", id, "--path", f, "--content-file", `${sdir}/${f}`]);
    }
  }
  return { idMap, created, updated };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/multica-import.mjs tests/multica-tool/import.test.mjs
git commit -m "feat(multica-tool): add idempotent skill import"
```

---

## Task 7: import — agents replay (runtime remap + skills set)

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-import.mjs`
- Modify: `tests/multica-tool/import.test.mjs`

**Interfaces:**
- Consumes: `listAgents` (lib), `importSkills`'s `idMap`.
- Produces:
  - `importAgents({ cli, manifest, dir, skillIdMap, runtimeMap, fs }) -> { idMap: Map<name,newId>, created, updated }`. `runtimeMap: Map<sourceRuntimeId,targetRuntimeId>`. For each agent file: read JSON record; `findByName(listAgents(cli), name)`. Missing → `cli.run(["agent","create","--name",name,"--runtime-id",runtimeMap.get(rec.sourceRuntimeId),"--instructions",...,"--model",...,"--visibility",...])` → new id. Exists → `cli.run(["agent","update",id,"--runtime-id",mapped,...])`. Then `cli.run(["agent","skills","set",id,"--skill-ids",skillNames.map(n=>skillIdMap.get(n)).join(",")])`. Throws if a `sourceRuntimeId` is missing from `runtimeMap`.

- [ ] **Step 1: Write the failing test**

Append to `tests/multica-tool/import.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: FAIL — `importAgents is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `multica-import.mjs` (add `listAgents` to the lib import):

```js
import { listSkills, listAgents, findByName } from "./lib.mjs";
// ^ replace the existing lib import line with this one

export function importAgents({ cli, manifest, dir, skillIdMap, runtimeMap, fs = nodeFs }) {
  const idMap = new Map();
  let created = 0, updated = 0;
  const existing = listAgents(cli);

  for (const a of manifest.agents) {
    const rec = JSON.parse(fs.readFileSync(`${dir}/${a.file}`, "utf8"));
    const targetRuntime = runtimeMap.get(rec.sourceRuntimeId);
    if (!targetRuntime) throw new Error(`Unmapped runtime "${rec.sourceRuntimeId}" for agent "${rec.name}"`);
    const common = [
      "--instructions", rec.instructions ?? "",
      "--model", rec.model ?? "",
      "--visibility", rec.visibility ?? "private",
      "--max-concurrent-tasks", String(rec.maxConcurrentTasks ?? 6),
    ];
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
    const skillIds = (rec.skillNames ?? []).map((n) => skillIdMap.get(n)).filter(Boolean);
    cli.run(["agent", "skills", "set", id, "--skill-ids", skillIds.join(",")]);
  }
  return { idMap, created, updated };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: PASS (4 tests total).

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/multica-import.mjs tests/multica-tool/import.test.mjs
git commit -m "feat(multica-tool): add agent import with runtime remap and skill wiring"
```

---

## Task 8: import — squad replay (leader + member reconcile)

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-import.mjs`
- Modify: `tests/multica-tool/import.test.mjs`

**Interfaces:**
- Consumes: `listSquads` (lib), agent `idMap` from `importAgents`.
- Produces:
  - `importSquad({ cli, squad, agentIdMap }) -> { newId, created, updated }` where `squad` is one manifest squad entry. `findByName(listSquads(cli), name)`. Missing → `cli.run(["squad","create","--name",name,"--leader",agentIdMap.get(leaderName),"--description",...])` → id. Exists → `cli.run(["squad","update",id,"--leader",mappedLeader,...])`. Then for each member where `agentName !== leaderName`: `cli.run(["squad","member","add",id,"--member-id",agentIdMap.get(agentName),"--role",role,"--type","agent"])`. Member-add is idempotent server-side (matched by agent), so re-runs don't duplicate.

> Note: `squad update` may not accept `--leader` (check Task 3 Step 6 / `squad update --help`). If it doesn't, on the exists-path skip the leader flag and only reconcile members. The test below only asserts the create path's leader and the member mapping.

- [ ] **Step 1: Write the failing test**

Append to `tests/multica-tool/import.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: FAIL — `importSquad is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `multica-import.mjs` (add `listSquads` to the lib import line):

```js
import { listSkills, listAgents, listSquads, findByName } from "./lib.mjs";
// ^ replace the lib import line again with this one

export function importSquad({ cli, squad, agentIdMap }) {
  const existing = listSquads(cli);
  const leaderId = agentIdMap.get(squad.leaderName);
  const match = findByName(existing, squad.name);
  let id, created = 0, updated = 0;
  if (match) {
    cli.run(["squad", "update", match.id, "--description", squad.description ?? ""]);
    id = match.id; updated++;
  } else {
    const out = cli.run(["squad", "create", "--name", squad.name, "--leader", leaderId, "--description", squad.description ?? ""]);
    id = JSON.parse(out).id; created++;
  }
  for (const m of squad.members) {
    if (m.agentName === squad.leaderName) continue;
    cli.run(["squad", "member", "add", id, "--member-id", agentIdMap.get(m.agentName), "--role", m.role, "--type", "agent"]);
  }
  return { newId: id, created, updated };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/multica-import.mjs tests/multica-tool/import.test.mjs
git commit -m "feat(multica-tool): add squad import with leader and member reconcile"
```

---

## Task 9: import — importBundle orchestrator + report

Wires the three importers, collects distinct source runtimes for the model to remap, and builds the report.

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-import.mjs`
- Modify: `tests/multica-tool/import.test.mjs`

**Interfaces:**
- Consumes: `importSkills`,`importAgents`,`importSquad`.
- Produces:
  - `collectSourceRuntimes(manifest) -> string[]` — distinct `sourceRuntimeId`s across agents.
  - `importBundle({ cli, dir, runtimeMap, fs }) -> report` where `report = { created:{skills,agents,squads}, updated:{...}, skillIdMap, agentIdMap, squadId, secretsReminder: string[] }`. Reads `manifest.json` from `dir`, runs skills → agents → squad in order, threads id maps. `secretsReminder` lists agent names (re-set `customEnv`/`mcpConfig` on target). Throws (before any write) if any collected runtime is missing from `runtimeMap`.

- [ ] **Step 1: Write the failing test**

Append to `tests/multica-tool/import.test.mjs`:

```js
import { collectSourceRuntimes } from "../../plugins/multica-tool/scripts/multica-import.mjs";

test("collectSourceRuntimes returns distinct ids", () => {
  const m = { agents: [{ sourceRuntimeId: "rt_a" }, { sourceRuntimeId: "rt_a" }, { sourceRuntimeId: "rt_b" }] };
  assert.deepEqual(collectSourceRuntimes(m).sort(), ["rt_a", "rt_b"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: FAIL — `collectSourceRuntimes is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `multica-import.mjs`:

```js
export function collectSourceRuntimes(manifest) {
  return [...new Set((manifest.agents ?? []).map((a) => a.sourceRuntimeId).filter(Boolean))];
}

export function importBundle({ cli, dir, runtimeMap, fs = nodeFs }) {
  const manifest = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, "utf8"));
  const missing = collectSourceRuntimes(manifest).filter((r) => !runtimeMap.has(r));
  if (missing.length) throw new Error(`Unmapped runtimes: ${missing.join(", ")} — aborting before any write`);

  const skillRes = importSkills({ cli, manifest, dir, fs });
  const agentRes = importAgents({ cli, manifest, dir, skillIdMap: skillRes.idMap, runtimeMap, fs });
  let squadRes = { newId: null, created: 0, updated: 0 };
  if (manifest.squads?.length) squadRes = importSquad({ cli, squad: manifest.squads[0], agentIdMap: agentRes.idMap });

  return {
    created: { skills: skillRes.created, agents: agentRes.created, squads: squadRes.created },
    updated: { skills: skillRes.updated, agents: agentRes.updated, squads: squadRes.updated },
    skillIdMap: Object.fromEntries(skillRes.idMap),
    agentIdMap: Object.fromEntries(agentRes.idMap),
    squadId: squadRes.newId,
    secretsReminder: (manifest.agents ?? []).map((a) => a.name),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/multica-import.mjs tests/multica-tool/import.test.mjs
git commit -m "feat(multica-tool): add importBundle orchestrator and report"
```

---

## Task 10: sync — export(src)→temp→import(dest) with workspace threading

**Files:**
- Create: `plugins/multica-tool/scripts/multica-sync.mjs`
- Create: `tests/multica-tool/sync.test.mjs`

**Interfaces:**
- Consumes: `makeCli`,`resolveWorkspaceId`,`findByName`,`listSkills/Agents/Squads` (lib), `exportResource`, `importBundle`.
- Produces:
  - `resolveScopeId(cli, type, name) -> {scope, ids}` — looks up the named resource in the source workspace via the matching `list`, returns `{scope:type, ids:{skillId|agentId|squadId}}`; throws on miss/dup (`findByName`).
  - `sync({ exec, type, name, srcWsName, destWsName, tmpDir, runtimeMap }) -> report`. Builds a source cli (`makeCli(exec,{workspaceId: srcId})`) and dest cli (`makeCli(exec,{workspaceId: destId})`). Resolves both workspace names. Exports the named resource to `tmpDir` with the source cli, then `importBundle` from `tmpDir` with the dest cli. Returns the import report. Asserts `--workspace-id srcId` is threaded on export reads and `--workspace-id destId` on import writes (lib `makeCli` does this).

- [ ] **Step 1: Write the failing test**

Create `tests/multica-tool/sync.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { sync } from "../../plugins/multica-tool/scripts/multica-sync.mjs";

// One exec for both workspaces; records every argv so we can assert which
// --workspace-id rode along with reads (export) vs writes (import).
function makeExec() {
  const argvs = [];
  const exec = (args) => {
    argvs.push(args);
    const j = args.join(" ");
    if (j.startsWith("workspace list")) return { stdout: JSON.stringify([{ id: "ws_SRC", name: "Source" }, { id: "ws_DST", name: "Dest" }]), stderr: "", status: 0 };
    if (j.startsWith("skill list")) return { stdout: JSON.stringify([{ id: "sk_SRC1", name: "Greet" }]), stderr: "", status: 0 };
    if (j.startsWith("skill get")) return { stdout: JSON.stringify({ id: "sk_SRC1", name: "Greet", content: "# Greet", config: {}, files: [] }), stderr: "", status: 0 };
    if (j.startsWith("agent list") || j.startsWith("squad list")) return { stdout: "[]", stderr: "", status: 0 };
    if (j.includes("skill create")) return { stdout: '{"id":"sk_DST1"}', stderr: "", status: 0 };
    return { stdout: "{}", stderr: "", status: 0 };
  };
  return { exec, argvs };
}

test("sync resolves both workspaces and threads correct --workspace-id on read vs write", () => {
  const { exec, argvs } = makeExec();
  const tmp = "/tmp/multica-sync-test";
  const report = sync({ exec, type: "skill", name: "Greet", srcWsName: "Source", destWsName: "Dest", tmpDir: tmp, runtimeMap: new Map() });
  assert.equal(report.created.skills, 1);

  const skillGet = argvs.find((a) => a[0] === "skill" && a[1] === "get");
  assert.equal(skillGet[skillGet.indexOf("--workspace-id") + 1], "ws_SRC", "export read used source ws");
  const skillCreate = argvs.find((a) => a[0] === "skill" && a[1] === "create");
  assert.equal(skillCreate[skillCreate.indexOf("--workspace-id") + 1], "ws_DST", "import write used dest ws");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multica-tool/sync.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/multica-tool/scripts/multica-sync.mjs`:

```js
import * as nodeFs from "node:fs";
import { makeCli, resolveWorkspaceId, findByName, listSkills, listAgents, listSquads } from "./lib.mjs";
import { exportResource } from "./multica-export.mjs";
import { importBundle } from "./multica-import.mjs";

export function resolveScopeId(cli, type, name) {
  const lists = { skill: listSkills, agent: listAgents, squad: listSquads };
  if (!lists[type]) throw new Error(`Unknown type "${type}" (skill|agent|squad)`);
  const match = findByName(lists[type](cli), name);
  if (!match) throw new Error(`Unknown ${type} "${name}" in source workspace`);
  const key = { skill: "skillId", agent: "agentId", squad: "squadId" }[type];
  return { scope: type, ids: { [key]: match.id } };
}

export function sync({ exec, type, name, srcWsName, destWsName, tmpDir, runtimeMap, fs = nodeFs }) {
  const resolver = makeCli(exec);                       // no ws — for workspace list
  const srcId = resolveWorkspaceId(resolver, srcWsName);
  const destId = resolveWorkspaceId(resolver, destWsName);
  const srcCli = makeCli(exec, { workspaceId: srcId });
  const destCli = makeCli(exec, { workspaceId: destId });

  const { scope, ids } = resolveScopeId(srcCli, type, name);
  exportResource({ cli: srcCli, scope, ids, outDir: tmpDir, sourceWorkspaceId: srcId, fs });
  return importBundle({ cli: destCli, dir: tmpDir, runtimeMap, fs });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multica-tool/sync.test.mjs`
Expected: PASS (1 test). Then run the whole suite:
```bash
node --test tests/multica-tool/*.test.mjs
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/multica-sync.mjs tests/multica-tool/sync.test.mjs
git commit -m "feat(multica-tool): add sync (export-src to import-dest)"
```

---

## Task 11: skills (export / import / sync SKILL.md)

The model-facing logic. Each skill drives interaction and shells out to its script with `node`.

**Files:**
- Create: `plugins/multica-tool/skills/export/SKILL.md`
- Create: `plugins/multica-tool/skills/import/SKILL.md`
- Create: `plugins/multica-tool/skills/sync/SKILL.md`

**Interfaces:**
- Consumes: the three scripts. Skills invoke them as CLI entrypoints — each script needs a small `main()` guarded by `import.meta.url` so it runs when called directly. Add that guard now (it's the skill's actual entrypoint).

- [ ] **Step 1: Add CLI entrypoints to the three scripts**

At the bottom of `multica-export.mjs`, `multica-import.mjs`, `multica-sync.mjs`, add a `main()` that reads `process.argv`, builds the real cli via `makeCli(realExec, {...})` / `requireAuth(realExec)`, calls the orchestrator, and `console.log`s a JSON report. Guard with:
```js
if (import.meta.url === `file://${process.argv[1]}`) main();
```
Keep `main()` thin — argument parsing only; all logic stays in the exported functions. (No unit test for `main` — it's I/O glue; covered by the skill smoke test in Task 14.)

- [ ] **Step 2: Write `skills/export/SKILL.md`**

Frontmatter `name: export`, `description:` starting with a third-person trigger ("Use when the user wants to export Multica skills, agents, or squads to a local folder..."). Body, in imperative steps:
1. Verify auth (`node .../multica-export.mjs` will fail loud if not).
2. Determine scope: if the user named a resource+type, use it; else run the relevant `multica <type> list --output json` and present a pick list.
3. Determine output dir (default `./multica-export-<slug>-<type>`).
4. Run `node plugins/multica-tool/scripts/multica-export.mjs --scope <type> --id <id> --out <dir>`.
5. Report what was written and surface any secret warnings verbatim.

- [ ] **Step 3: Write `skills/import/SKILL.md`**

Body:
1. Confirm the target workspace with the user (name).
2. Run a "plan" pass: read `manifest.json`, run `multica runtime list --output json` on the target, and for each distinct `sourceRuntimeId` prompt the user to pick a target runtime. Abort if any unmapped.
3. Run `node .../multica-import.mjs --dir <folder> --workspace <name> --runtime-map <src=dst,...>`.
4. Report created/updated counts, name→id maps, and the secrets reminder verbatim.

- [ ] **Step 4: Write `skills/sync/SKILL.md`**

Body: parse `sync <type> <name> from <src-ws> <dest-ws>`; build the runtime map (same prompt as import, using the dest workspace's `runtime list`); run `node .../multica-sync.mjs ...`; report.

- [ ] **Step 5: Validate skills**

Run `/validate-skills` in Claude Code (scans `plugins/`). Fix every `[FAIL]` item (frontmatter `name`/`description`, third-person trigger, length). Re-run until clean.

- [ ] **Step 6: Commit**

```bash
git add plugins/multica-tool/skills plugins/multica-tool/scripts
git commit -m "feat(multica-tool): add export/import/sync skills and script entrypoints"
```

---

## Task 12: agents (export / import / sync)

Delegatable executors that run the matching skill in their own context (for long background migrations).

**Files:**
- Create: `plugins/multica-tool/agents/export.md`
- Create: `plugins/multica-tool/agents/import.md`
- Create: `plugins/multica-tool/agents/sync.md`

**Interfaces:**
- Each agent's instructions: "You are a standalone executor. Invoke the `multica-tool:<op>` skill with the arguments passed to you, run it to completion, and return the final JSON report. You are NOT part of a coordinated team." (Per repo CLAUDE.md, the agent-team checklist does not apply — these are independent executors.)

- [ ] **Step 1: Write the three agent files**

Each with frontmatter `name`, `description` (third-person trigger: "Use when delegating a Multica <op> as a background task..."), and a short instructions body pointing at the matching skill. Pick a minimal tool set (`Bash`, `Read`, plus `Skill` invocation) consistent with other agents in this repo — open `plugins/team-share/agents/*.md` for the house format.

- [ ] **Step 2: Validate agents**

Run `/validate-agents`. Fix every `[FAIL]`. Re-run until clean.

- [ ] **Step 3: Commit**

```bash
git add plugins/multica-tool/agents
git commit -m "feat(multica-tool): add export/import/sync executor agents"
```

---

## Task 13: commands (export / import / sync)

Slash entrypoints that invoke the matching skill.

**Files:**
- Create: `plugins/multica-tool/commands/export.md`
- Create: `plugins/multica-tool/commands/import.md`
- Create: `plugins/multica-tool/commands/sync.md`

- [ ] **Step 1: Write the three command files**

Each with frontmatter `description` and a body that invokes the matching skill with `$ARGUMENTS` (open an existing command in `plugins/` for the house format — e.g. how team-share commands invoke their skill). E.g. export.md body: "Invoke the `multica-tool:export` skill. Arguments: $ARGUMENTS".

- [ ] **Step 2: Validate commands**

Run `/validate-commands`. Fix every `[FAIL]`. Re-run until clean.

- [ ] **Step 3: Commit**

```bash
git add plugins/multica-tool/commands
git commit -m "feat(multica-tool): add export/import/sync slash commands"
```

---

## Task 14: Closeout — full validation + smoke

**Files:** none new (validation + fixes only).

- [ ] **Step 1: Run the full test suite**

Run: `node --test tests/multica-tool/*.test.mjs`
Expected: all PASS.

- [ ] **Step 2: Validate manifests**

Run:
```bash
python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Run the plugin-validator agent**

Invoke the `plugin-validator:plugin-validator` agent (or `/plugin-validator`) against `multica-tool`. Apply fixes for every `[FAIL]` item across skills/agents/commands/hooks.

- [ ] **Step 4: Smoke-test the plugin install**

In Claude Code:
```
/plugin marketplace add file://$(pwd)
/plugin install multica-tool@drunkcoding
```
Confirm `/multica-tool:export`, `:import`, `:sync` are listed and the skills load without "skill is invalid".

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore(multica-tool): validation fixes and closeout"
```

---

## Self-Review

**1. Spec coverage** (each spec section → task):
- Three operations export/import/sync → Tasks 4–10 (logic), 11–13 (surface). ✓
- "No native export command / composed reads" → export uses `skill get`/`agent get`+`agent skills list`/`squad get`+`member list` (Task 5). ✓
- "Re-created resources get new IDs / resolve by name" → `findByName` everywhere; idMaps name→newId (Tasks 6–9). ✓
- "agent create requires --runtime-id, remap on import" → Task 7 runtimeMap + abort-if-unmapped; Task 9 pre-flight abort. ✓
- Name identity / idempotent upsert → Tasks 6 (skill update vs create), 7 (agent), 8 (member-add by agent). ✓
- Layout + manifest schema → Tasks 4–5 produce exactly the spec's tree + manifest. ✓
- Runtime remap captured on export, prompted on import, never invented → Task 4 records `sourceRuntimeId`; Task 9 collects distinct; skill prose (Task 11) prompts. ✓
- Conflicts overwrite/update by name → Tasks 6–8 update path. ✓
- Selection (args else interactive; import whole folder; sync `<type> <name> from <src> <dest>`) → Task 11 skill prose + Task 10 sync signature. ✓
- Logic split (Node helpers deterministic, model drives interaction) → scripts vs skills split. ✓
- sync reuses export+import over temp dir → Task 10. ✓
- Workspace resolution by name via `workspace list`, threaded `--workspace-id`, abort unknown/dup → Task 3 `resolveWorkspaceId` + lib `makeCli`; Task 10 test asserts threading. ✓
- Error handling: auth (Task 2 `requireAuth`), secrets never written (Task 5 test), unmapped runtime (Tasks 7+9), missing/dup names (Task 3 `findByName`/`resolveWorkspaceId`), non-zero exit (Task 2 `run` throws). ✓
- Testing coverage list (manifest build, links-by-name, idempotency, overwrite=update, runtime remap, secrets-not-written, sync ws threading) → Tasks 4,5,6,7,8,10 map 1:1. ✓
- Marketplace wiring one commit → Task 1; final validation → Task 14. ✓
- Out-of-scope (no merge, no secret migration, no selective import, only skills/agents/squads) → respected; nothing in the plan adds them. ✓

**2. Placeholder scan:** no TBD/TODO; every code step shows complete code; the two CLI-shape unknowns (field names, `squad update --leader`) are isolated to lib wrappers with an explicit verify step (Task 3 Step 6) and a documented fallback. ✓

**3. Type consistency:** `makeCli(exec)` → `{run,json}` used identically across export/import/sync. `idMap`/`skillIdMap`/`agentIdMap` are `Map<name,id>` throughout; `importBundle` converts to plain objects only at the report boundary. `runtimeMap` is `Map<src,dst>` in Tasks 7/9/10. `fs` injected shape (`existsSync/readFileSync/readdirSync` for import, `mkdirSync/writeFileSync` for export) is consistent within each script. ✓

---

## Execution Handoff

(Filled in after presenting to the user.)
