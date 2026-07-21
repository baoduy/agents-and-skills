# multica-tool avatar export/import support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry agent and squad avatars through `multica-tool` export/import/sync, per the approved design in `docs/superpowers/specs/2026-07-17-multica-tool-avatar-support-design.md`.

**Architecture:** A new `scripts/avatar.mjs` module isolates all avatar-specific I/O (curl-based download/upload, local Multica credential read) behind small injectable-`exec`/`fs` functions, matching this codebase's existing pattern of injectable `cli`/`fs` for testability. `lib.mjs`'s `getAgent`/`getSquad` start surfacing `avatar_url`. `multica-export.mjs` downloads the avatar into the bundle when present (agents and squads). `multica-import.mjs` re-uploads it: agents always via the existing `multica agent avatar --file` CLI command; squads via CLI passthrough (`squad update --avatar-url`) when source and destination share a Multica server, or one raw `POST /api/upload-file` call when they don't. A dedup rule (skip when the destination already has a non-null `avatar_url`) prevents re-uploads on repeated sync runs.

**Tech Stack:** Node.js (`node:child_process` spawnSync, `node:fs`, `node:os`, `node:url`), `curl` (already-available system binary, used the same way `multica` itself is shelled out to), `node:test` + `node:assert/strict`.

## Global Constraints

- Every new/changed function that shells out or touches the filesystem must accept its `exec`/`fs` as an **injectable parameter with a real default**, exactly like `makeCli`/`exportResource`/`importSquad` already do — this is what keeps the existing test suite (fully mocked, zero real I/O) working, and is required for the new tests too.
- No new npm dependencies. `curl` is used via `spawnSync`, the same way `lib.mjs`'s `realExec` already shells out to the `multica` binary.
- All avatar failures (download at export, upload/set at import) are **non-fatal**: catch, push a human-readable string onto a `warnings` array, and let the rest of the export/import complete. Never let an avatar problem abort a skill/agent/squad migration.
- Existing exported function signatures gain **new parameters with defaults only** — no existing call in `tests/multica-tool/*.test.mjs` should need to change to keep passing (verify this at the end of every task by running the full suite).
- Manifest/record field names, exactly as used below: `avatarUrl`, `avatarFile`, `sourceServerUrl`, `avatarWarnings`. Do not rename partway through.

---

## Task 1: `scripts/avatar.mjs` — download/upload/config primitives

**Files:**
- Create: `plugins/multica-tool/scripts/avatar.mjs`
- Test: `tests/multica-tool/avatar.test.mjs`

**Interfaces:**
- Produces: `pickExtension(url: string): string`, `downloadAvatar(url: string, exec = spawnSync): { bytes: Buffer, ext: string }` (throws on failure), `readLocalConfig(fs = nodeFs, home = os.homedir()): { server_url, app_url, workspace_id, token } | null`, `uploadAvatarFile({ serverUrl, token, bytes, filename, exec = spawnSync }): string` (returns the uploaded `url`, throws on failure).
- Consumes: nothing from other tasks (foundational module).

- [ ] **Step 1: Write the failing tests**

```js
// tests/multica-tool/avatar.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickExtension, downloadAvatar, readLocalConfig, uploadAvatarFile } from "../../plugins/multica-tool/scripts/avatar.mjs";

test("pickExtension picks a known extension from the URL path, case-insensitively", () => {
  assert.equal(pickExtension("https://cdn.example.com/uploads/x.WEBP"), "webp");
  assert.equal(pickExtension("https://cdn.example.com/a/b/avatar.png?x=1"), "png");
});

test("pickExtension defaults to png for unknown extensions or unparsable URLs", () => {
  assert.equal(pickExtension("https://cdn.example.com/avatar.bin"), "png");
  assert.equal(pickExtension("not-a-url"), "png");
});

test("downloadAvatar returns bytes and extension on success", () => {
  const exec = (cmd, args) => {
    assert.equal(cmd, "curl");
    assert.deepEqual(args, ["-sL", "-f", "https://cdn.example.com/a.png"]);
    return { status: 0, stdout: Buffer.from("fake-image-bytes"), stderr: Buffer.from("") };
  };
  const { bytes, ext } = downloadAvatar("https://cdn.example.com/a.png", exec);
  assert.equal(bytes.toString(), "fake-image-bytes");
  assert.equal(ext, "png");
});

test("downloadAvatar throws with curl's stderr on non-zero exit", () => {
  const exec = () => ({ status: 22, stdout: Buffer.from(""), stderr: Buffer.from("404 not found") });
  assert.throws(() => downloadAvatar("https://cdn.example.com/missing.png", exec), /404 not found/);
});

test("readLocalConfig parses the config file when present", () => {
  const fs = {
    existsSync: (p) => p === "/home/test/.multica/config.json",
    readFileSync: (p) => JSON.stringify({ server_url: "http://127.0.0.1:8080", token: "mul_abc" }),
  };
  const cfg = readLocalConfig(fs, "/home/test");
  assert.equal(cfg.server_url, "http://127.0.0.1:8080");
  assert.equal(cfg.token, "mul_abc");
});

test("readLocalConfig returns null when the config file doesn't exist", () => {
  const fs = { existsSync: () => false };
  assert.equal(readLocalConfig(fs, "/home/test"), null);
});

test("uploadAvatarFile posts the file over stdin and returns the response url", () => {
  const exec = (cmd, args, opts) => {
    assert.equal(cmd, "curl");
    assert.deepEqual(args, [
      "-sS", "-f", "-X", "POST", "http://dest:8080/api/upload-file",
      "-H", "Authorization: Bearer mul_tok",
      "-F", "file=@-;filename=avatar.png",
    ]);
    assert.equal(opts.input.toString(), "img-bytes");
    return { status: 0, stdout: Buffer.from(JSON.stringify({ url: "http://dest:8080/uploads/x.png" })), stderr: Buffer.from("") };
  };
  const url = uploadAvatarFile({ serverUrl: "http://dest:8080", token: "mul_tok", bytes: Buffer.from("img-bytes"), filename: "avatar.png", exec });
  assert.equal(url, "http://dest:8080/uploads/x.png");
});

test("uploadAvatarFile throws when curl fails or the response has no url", () => {
  const failExec = () => ({ status: 6, stdout: Buffer.from(""), stderr: Buffer.from("could not resolve host") });
  assert.throws(() => uploadAvatarFile({ serverUrl: "http://x", token: "t", bytes: Buffer.from(""), filename: "a.png", exec: failExec }), /could not resolve host/);

  const noUrlExec = () => ({ status: 0, stdout: Buffer.from("{}"), stderr: Buffer.from("") });
  assert.throws(() => uploadAvatarFile({ serverUrl: "http://x", token: "t", bytes: Buffer.from(""), filename: "a.png", exec: noUrlExec }), /missing url/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/multica-tool/avatar.test.mjs`
Expected: FAIL — `Cannot find module '.../scripts/avatar.mjs'`

- [ ] **Step 3: Write the implementation**

```js
// plugins/multica-tool/scripts/avatar.mjs
import { spawnSync } from "node:child_process";
import * as nodeFs from "node:fs";
import * as os from "node:os";

const KNOWN_EXTS = ["png", "jpg", "jpeg", "gif", "webp"];

// Picks a file extension for a downloaded avatar from the URL's path suffix.
// Real Multica avatar URLs always carry one (e.g. ".../<id>.webp") — skips
// Content-Type sniffing entirely since it's unreachable in practice and would
// need mixing curl's body and header output awkwardly.
export function pickExtension(url) {
  let pathname;
  try { pathname = new URL(url).pathname; } catch { return "png"; }
  const m = /\.([a-zA-Z0-9]+)$/.exec(pathname);
  return m && KNOWN_EXTS.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : "png";
}

// Downloads avatarUrl via curl (keeps this codebase's synchronous,
// spawnSync-based style — no fetch/async infection for one image download).
// Returns raw bytes (as a Buffer) and a picked extension; throws on failure.
export function downloadAvatar(url, exec = spawnSync) {
  const res = exec("curl", ["-sL", "-f", url]);
  if (res.status !== 0) {
    const stderr = res.stderr ? res.stderr.toString().trim() : "";
    throw new Error(`avatar download failed (curl exit ${res.status}): ${stderr || url}`);
  }
  return { bytes: res.stdout, ext: pickExtension(url) };
}

// Reads ~/.multica/config.json. The `multica` CLI has no command that hands
// out its auth token (no `gh auth token` equivalent) — this is the one place
// the plugin reads Multica's local credential store directly, and only ever
// for the squad cross-server avatar upload path.
export function readLocalConfig(fs = nodeFs, home = os.homedir()) {
  const path = `${home}/.multica/config.json`;
  if (!fs.existsSync(path)) return null;
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

// Uploads bytes to <serverUrl>/api/upload-file via curl multipart (file
// content piped over stdin, so callers never need a real on-disk path —
// keeps this testable with the same injectable-fs fixtures as everything
// else). Returns the response's `url` field; throws on failure.
export function uploadAvatarFile({ serverUrl, token, bytes, filename, exec = spawnSync }) {
  const res = exec("curl", [
    "-sS", "-f", "-X", "POST", `${serverUrl}/api/upload-file`,
    "-H", `Authorization: Bearer ${token}`,
    "-F", `file=@-;filename=${filename}`,
  ], { input: bytes });
  if (res.status !== 0) {
    const stderr = res.stderr ? res.stderr.toString().trim() : "";
    throw new Error(`avatar upload failed (curl exit ${res.status}): ${stderr}`);
  }
  const body = JSON.parse(res.stdout.toString());
  if (!body.url) throw new Error("avatar upload response missing url field");
  return body.url;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/multica-tool/avatar.test.mjs`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/avatar.mjs tests/multica-tool/avatar.test.mjs
git commit -m "feat(multica-tool): add avatar download/upload/config primitives"
```

---

## Task 2: `lib.mjs` — surface `avatarUrl` on agents and squads

**Files:**
- Modify: `plugins/multica-tool/scripts/lib.mjs:69-88` (`getAgent`, `getSquad`)
- Modify: `tests/multica-tool/fixtures.mjs` (add two fixtures with `avatar_url` set)
- Test: `tests/multica-tool/lib.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getAgent(...).avatarUrl: string | null`, `getSquad(...).avatarUrl: string | null` — consumed by Tasks 4 and 5 (export loops read `raw.avatarUrl`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/multica-tool/fixtures.mjs` (append at the end, after `RUNTIME_LIST_DEST_AMBIGUOUS`):

```js
// Agent/squad variants carrying an avatar_url, for avatar-support tests.
export const AGENT_GET_WITH_AVATAR = { ...AGENT_GET, avatar_url: "https://cdn.example.com/uploads/ag_SRC1.png" };
export const SQUAD_GET_WITH_AVATAR = { ...SQUAD_GET, avatar_url: "https://cdn.example.com/uploads/sq_SRC1.webp" };
```

Add to `tests/multica-tool/lib.test.mjs` (near the existing `getAgent`/`getSquad` tests):

```js
import { AGENT_GET_WITH_AVATAR, SQUAD_GET_WITH_AVATAR } from "./fixtures.mjs";

test("getAgent surfaces avatar_url as avatarUrl, null when absent", () => {
  const withAvatar = getAgent({ json: () => AGENT_GET_WITH_AVATAR }, "ag_SRC1");
  assert.equal(withAvatar.avatarUrl, "https://cdn.example.com/uploads/ag_SRC1.png");
  const without = getAgent({ json: () => AGENT_GET }, "ag_SRC1");
  assert.equal(without.avatarUrl, null);
});

test("getSquad surfaces avatar_url as avatarUrl, null when absent", () => {
  const cliWith = { json: (args) => (args[1] === "get" ? SQUAD_GET_WITH_AVATAR : SQUAD_MEMBERS) };
  assert.equal(getSquad(cliWith, "sq_SRC1").avatarUrl, "https://cdn.example.com/uploads/sq_SRC1.webp");
  const cliWithout = { json: (args) => (args[1] === "get" ? SQUAD_GET : SQUAD_MEMBERS) };
  assert.equal(getSquad(cliWithout, "sq_SRC1").avatarUrl, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/multica-tool/lib.test.mjs`
Expected: FAIL — `avatarUrl` is `undefined`, not the expected string/`null`

- [ ] **Step 3: Write the implementation**

In `plugins/multica-tool/scripts/lib.mjs`, modify `getAgent` (currently lines 69-83):

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
    avatarUrl: a.avatar_url ?? null,
    skills: (a.skills ?? []).map((sk) => ({ id: sk.id, name: sk.name })),
  };
}
```

And `getSquad` (currently lines 85-88):

```js
export function getSquad(cli, id) {
  const s = cli.json(["squad", "get", id]);
  return { id: s.id, name: s.name, description: s.description, instructions: s.instructions, leaderId: s.leader_id, avatarUrl: s.avatar_url ?? null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/multica-tool/lib.test.mjs`
Expected: PASS (all tests, including the two new ones)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `node --test tests/multica-tool/*.test.mjs`
Expected: PASS (all files, no changed counts elsewhere)

- [ ] **Step 6: Commit**

```bash
git add plugins/multica-tool/scripts/lib.mjs tests/multica-tool/fixtures.mjs tests/multica-tool/lib.test.mjs
git commit -m "feat(multica-tool): surface avatar_url as avatarUrl on agent/squad reads"
```

---

## Task 3: `multica-export.mjs` — agent avatar download

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-export.mjs`
- Test: `tests/multica-tool/export.test.mjs`

**Interfaces:**
- Consumes: `downloadAvatar(url, exec)` and `readLocalConfig(fs, home)` from Task 1's `avatar.mjs`; `getAgent(...).avatarUrl` from Task 2.
- Produces: `exportResource({ ..., avatarExec = spawnSync })` — new optional param. Per-agent manifest entries and `agents/<slug>.json` records gain `avatarFile: string | null` and `avatarUrl: string | null`. Top-level manifest gains `sourceServerUrl: string | null`. Download failures push `"<name> (avatar download failed: <reason>)"` onto the existing `warnings` array. Consumed by Task 6 (`importAgents`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/multica-tool/export.test.mjs` (near the top, alongside the existing `fakeCli`/`memFs` helpers):

```js
import { AGENT_GET_WITH_AVATAR } from "./fixtures.mjs";

function fakeCliWithAvatar() {
  return {
    json: (args) => {
      const key = args.slice(0, 3).join(" ");
      if (key === "agent get ag_SRC1") return AGENT_GET_WITH_AVATAR;
      if (key === "skill get sk_SRC1") return SKILL_GET;
      if (key === "runtime list") return RUNTIME_LIST_SRC;
      throw new Error("unexpected " + args.join(" "));
    },
    run: () => "",
  };
}
```

Note: `AGENT_GET_WITH_AVATAR` spreads `...AGENT_GET`, which carries `AGENT_GET`'s `skills: [{ id: "sk_SRC1", name: "Greet" }]` — `collectAgent` will fetch that skill too, so `skill get sk_SRC1` must be handled here exactly like the original `fakeCli()`.

Append these tests at the end of the file:

```js
test("export agent downloads its avatar and records avatarFile/avatarUrl", () => {
  const fs = memFs();
  const avatarExec = (cmd, args) => {
    assert.equal(cmd, "curl");
    assert.equal(args[2], "https://cdn.example.com/uploads/ag_SRC1.png");
    return { status: 0, stdout: Buffer.from("png-bytes"), stderr: Buffer.from("") };
  };
  const { manifest, warnings } = exportResource({ cli: fakeCliWithAvatar(), scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/o", sourceWorkspaceId: "ws", fs, avatarExec });
  assert.deepEqual(warnings, []);
  assert.equal(manifest.agents[0].avatarFile, "agents/helper-avatar.png");
  assert.equal(manifest.agents[0].avatarUrl, "https://cdn.example.com/uploads/ag_SRC1.png");
  assert.equal(fs.files["/o/agents/helper-avatar.png"].toString(), "png-bytes");
  const record = JSON.parse(fs.files["/o/agents/helper.json"]);
  assert.equal(record.avatarFile, "agents/helper-avatar.png");
});

test("export agent avatar download failure warns but does not abort export", () => {
  const fs = memFs();
  const avatarExec = () => ({ status: 22, stdout: Buffer.from(""), stderr: Buffer.from("404") });
  const { manifest, warnings } = exportResource({ cli: fakeCliWithAvatar(), scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/o", sourceWorkspaceId: "ws", fs, avatarExec });
  assert.ok(warnings.some((w) => w.includes("Helper") && w.includes("avatar download failed")));
  assert.equal(manifest.agents[0].avatarFile, null);
  const record = JSON.parse(fs.files["/o/agents/helper.json"]);
  assert.equal(record.avatarFile, null);
});

test("export agent without an avatar_url never calls avatarExec", () => {
  const fs = memFs();
  const avatarExec = () => { throw new Error("must not be called"); };
  const { manifest } = exportResource({ cli: fakeCli(), scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/o", sourceWorkspaceId: "ws", fs, avatarExec });
  assert.equal(manifest.agents[0].avatarFile, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: FAIL — `manifest.agents[0].avatarFile` is `undefined`, no file written

- [ ] **Step 3: Write the implementation**

In `plugins/multica-tool/scripts/multica-export.mjs`, add imports at the top:

```js
import { spawnSync } from "node:child_process";
import { downloadAvatar, readLocalConfig } from "./avatar.mjs";
```

In `buildManifest`, add `sourceServerUrl: null` to the returned object (so the schema key always exists):

```js
export function buildManifest({ scope, sourceWorkspaceId, skills, agents, squad }) {
  const seenSkills = new Map();
  for (const s of skills) if (!seenSkills.has(s.name)) seenSkills.set(s.name, s);
  const seenAgents = new Map();
  for (const a of agents) if (!seenAgents.has(a.name)) seenAgents.set(a.name, a);
  return {
    version: "1",
    scope,
    sourceWorkspaceId,
    sourceServerUrl: null,
    skills: [...seenSkills.values()].map((s) => ({ name: s.name, dir: `skills/${slugify(s.name)}`, sourceId: s.sourceId })),
    agents: [...seenAgents.values()].map((a) => ({ name: a.name, file: `agents/${slugify(a.name)}.json`, sourceId: a.sourceId, sourceRuntimeId: a.sourceRuntimeId, sourceRuntimeProvider: a.sourceRuntimeProvider ?? null, skillNames: a.skillNames, hadSecrets: !!a.hadSecrets })),
    squads: squad ? [{ name: squad.name, file: `squads/${slugify(squad.name)}.json`, description: squad.description ?? "", instructions: squad.instructions ?? "", leaderName: squad.leaderName, members: squad.members }] : [],
  };
}
```

In `exportResource`, change the signature and add the lazy `sourceServerUrl` getter right after the existing `getProviderById` lazy pattern:

```js
export function exportResource({ cli, scope, ids, outDir, sourceWorkspaceId, fs = nodeFs, avatarExec = spawnSync }) {
  const skills = new Map();
  const agentsById = new Map();
  let squad = null;
  let providerById = null;
  const getProviderById = () => providerById ??= new Map(listRuntimes(cli).map((r) => [r.id, r.provider]));

  let sourceServerUrl; // undefined until first avatar attempt; null if config missing
  const getSourceServerUrl = () => {
    if (sourceServerUrl === undefined) sourceServerUrl = readLocalConfig(fs)?.server_url ?? null;
    return sourceServerUrl;
  };
```

Replace the agent-writing loop (currently):

```js
  const agentByName = new Map([...agentsById.values()].map((a) => [a.raw.name, a]));
  for (const entry of manifest.agents) {
    const { raw, red, skillNames } = agentByName.get(entry.name);
    const record = { ...red.record, skillNames };
    if (red.hadSecrets) warnings.push(raw.name);
    fs.mkdirSync(`${outDir}/agents`, { recursive: true });
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(record, null, 2));
  }
```

with:

```js
  const agentByName = new Map([...agentsById.values()].map((a) => [a.raw.name, a]));
  for (const entry of manifest.agents) {
    const { raw, red, skillNames } = agentByName.get(entry.name);
    let avatarFile = null;
    if (raw.avatarUrl) {
      try {
        const { bytes, ext } = downloadAvatar(raw.avatarUrl, avatarExec);
        avatarFile = `agents/${slugify(raw.name)}-avatar.${ext}`;
        fs.mkdirSync(`${outDir}/agents`, { recursive: true });
        fs.writeFileSync(`${outDir}/${avatarFile}`, bytes);
        manifest.sourceServerUrl = getSourceServerUrl();
      } catch (err) {
        warnings.push(`${raw.name} (avatar download failed: ${err.message})`);
      }
    }
    entry.avatarFile = avatarFile;
    entry.avatarUrl = raw.avatarUrl ?? null;
    const record = { ...red.record, skillNames, avatarFile };
    if (red.hadSecrets) warnings.push(raw.name);
    fs.mkdirSync(`${outDir}/agents`, { recursive: true });
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(record, null, 2));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: PASS (all tests, including the three new ones)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `node --test tests/multica-tool/*.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugins/multica-tool/scripts/multica-export.mjs tests/multica-tool/export.test.mjs
git commit -m "feat(multica-tool): download agent avatar during export"
```

---

## Task 4: `multica-export.mjs` — squad avatar download + `sourceServerUrl`

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-export.mjs`
- Modify: `plugins/multica-tool/skills/export/SKILL.md:55-61` (report step)
- Test: `tests/multica-tool/export.test.mjs`

**Interfaces:**
- Consumes: same `downloadAvatar`/`readLocalConfig` as Task 3; `getSquad(...).avatarUrl` from Task 2.
- Produces: squad manifest entries and `squads/<slug>.json` gain `avatarFile`, `avatarUrl`. Consumed by Task 7 (`importSquad`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/multica-tool/export.test.mjs`:

```js
import { SQUAD_GET_WITH_AVATAR } from "./fixtures.mjs";

function fakeCliSquadWithAvatar() {
  return {
    json: (args) => {
      const key = args.slice(0, 3).join(" ");
      if (key === "squad get sq_SRC1") return SQUAD_GET_WITH_AVATAR;
      if (key === "squad member list") return SQUAD_MEMBERS;
      if (key === "agent get ag_SRC1") return AGENT_GET;
      if (key === "agent get ag_SRC2") return AGENT_GET_2;
      if (key === "skill get sk_SRC1") return SKILL_GET;
      if (key === "runtime list") return RUNTIME_LIST_SRC;
      throw new Error("unexpected " + args.join(" "));
    },
    run: () => "",
  };
}

test("export squad downloads its avatar, records avatarFile/avatarUrl, and captures sourceServerUrl", () => {
  const fs = memFs();
  const avatarExec = (cmd, args) => {
    if (args[2] === "https://cdn.example.com/uploads/sq_SRC1.webp") return { status: 0, stdout: Buffer.from("webp-bytes"), stderr: Buffer.from("") };
    throw new Error("unexpected avatar url " + args[2]);
  };
  fs.existsSync = (p) => p.endsWith("/.multica/config.json");
  fs.readFileSync = (p) => (p.endsWith("/.multica/config.json") ? JSON.stringify({ server_url: "http://127.0.0.1:8080" }) : fs.files[p]);
  const { manifest } = exportResource({ cli: fakeCliSquadWithAvatar(), scope: "squad", ids: { squadId: "sq_SRC1" }, outDir: "/s", sourceWorkspaceId: "ws", fs, avatarExec });
  assert.equal(manifest.squads[0].avatarFile, "squads/team-avatar.webp");
  assert.equal(manifest.squads[0].avatarUrl, "https://cdn.example.com/uploads/sq_SRC1.webp");
  assert.equal(manifest.sourceServerUrl, "http://127.0.0.1:8080");
  assert.equal(fs.files["/s/squads/team-avatar.webp"].toString(), "webp-bytes");
  const squadFile = JSON.parse(fs.files["/s/squads/team.json"]);
  assert.equal(squadFile.avatarFile, "squads/team-avatar.webp");
});

test("export squad without an avatar_url leaves sourceServerUrl null and never calls avatarExec", () => {
  const fs = memFs();
  const avatarExec = () => { throw new Error("must not be called"); };
  const { manifest } = exportResource({ cli: fakeCli(), scope: "squad", ids: { squadId: "sq_SRC1" }, outDir: "/s", sourceWorkspaceId: "ws", fs, avatarExec });
  assert.equal(manifest.sourceServerUrl, null);
  assert.equal(manifest.squads[0].avatarFile, null);
});
```

Note: `memFs()` currently returns `{ files, mkdirSync, writeFileSync }` with no `existsSync`/`readFileSync` — the first test above overrides both directly on the returned object, which works since `exportResource` reads `fs.existsSync`/`fs.readFileSync` at call time, not at destructure time.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: FAIL — `manifest.squads[0].avatarFile` is `undefined`, `manifest.sourceServerUrl` is `null` where a real value was expected

- [ ] **Step 3: Write the implementation**

In `plugins/multica-tool/scripts/multica-export.mjs`, in the `if (scope === "squad")` block, add `avatarUrl` to the constructed `squad` object:

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
      avatarUrl: sq.avatarUrl ?? null,
    };
  }
```

Replace the squad-writing loop (currently):

```js
  for (const entry of manifest.squads) {
    fs.mkdirSync(`${outDir}/squads`, { recursive: true });
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(entry, null, 2));
  }
```

with:

```js
  for (const entry of manifest.squads) {
    let avatarFile = null;
    if (squad.avatarUrl) {
      try {
        const { bytes, ext } = downloadAvatar(squad.avatarUrl, avatarExec);
        avatarFile = `squads/${slugify(entry.name)}-avatar.${ext}`;
        fs.mkdirSync(`${outDir}/squads`, { recursive: true });
        fs.writeFileSync(`${outDir}/${avatarFile}`, bytes);
        manifest.sourceServerUrl = getSourceServerUrl();
      } catch (err) {
        warnings.push(`${entry.name} (avatar download failed: ${err.message})`);
      }
    }
    entry.avatarFile = avatarFile;
    entry.avatarUrl = squad.avatarUrl ?? null;
    fs.mkdirSync(`${outDir}/squads`, { recursive: true });
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(entry, null, 2));
  }
```

In `plugins/multica-tool/skills/export/SKILL.md`, update Step 5 (currently lines 55-61) to add an avatar-warning line after the existing secrets warning line:

```markdown
## Step 5 — Report results

Parse the JSON output from the script and report:

- Directory written to.
- Count of skills, agents, and squads exported.
- If `warnings` is non-empty, surface every agent name verbatim with this message: "WARNING: the following agents had custom environment variables or MCP config that were NOT exported — re-add secrets manually after import: `<agent-name>`."
- Agent and squad avatars are downloaded into the bundle automatically when present. If a name appears in `warnings` with "(avatar download failed: ...)", mention that its avatar was skipped and the rest of the export is unaffected.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `node --test tests/multica-tool/*.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugins/multica-tool/scripts/multica-export.mjs plugins/multica-tool/skills/export/SKILL.md tests/multica-tool/export.test.mjs
git commit -m "feat(multica-tool): download squad avatar and capture sourceServerUrl during export"
```

---

## Task 5: `multica-import.mjs` — agent avatar upload with dedup

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-import.mjs:58-93` (`importAgents`)
- Test: `tests/multica-tool/import.test.mjs`

**Interfaces:**
- Consumes: `rec.avatarFile` (per-agent JSON field written by Task 3); `match.avatar_url` (already present on `multica agent list` output, confirmed live).
- Produces: `importAgents(...)` return value gains `warnings: string[]`. Consumed by Task 6 (`importBundle`'s `avatarWarnings`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/multica-tool/import.test.mjs`, near the existing `importAgents` tests:

```js
const AGENT_MANIFEST_AVATAR = {
  version: "1", scope: "agent", sourceWorkspaceId: "ws_SRC", skills: [],
  agents: [{ name: "Helper", file: "agents/helper.json", sourceRuntimeId: "rt_SRC1", skillNames: [] }],
  squads: [],
};
const AGENT_FILE_WITH_AVATAR = JSON.stringify({
  name: "Helper", instructions: "be nice", model: "claude-sonnet-4-6", visibility: "workspace",
  maxConcurrentTasks: 6, sourceId: "ag_SRC1", sourceRuntimeId: "rt_SRC1", skillNames: [],
  avatarFile: "agents/helper-avatar.png", avatarUrl: "https://cdn.example.com/uploads/ag_SRC1.png",
});

test("importAgents uploads the bundled avatar for a new agent (no existing avatar)", () => {
  const fs = { existsSync: () => true, readFileSync: () => AGENT_FILE_WITH_AVATAR, readdirSync: () => [] };
  const calls = [];
  const cli = { calls, json: (a) => (a[1] === "list" ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; } };
  const { warnings } = importAgents({ cli, manifest: AGENT_MANIFEST_AVATAR, dir: "/bundle", skillIdMap: new Map(), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  assert.deepEqual(warnings, []);
  const avatarCall = calls.find((a) => a[0] === "agent" && a[1] === "avatar");
  assert.ok(avatarCall, "agent avatar --file was called");
  assert.equal(avatarCall[2], "ag_NEW1");
  assert.equal(avatarCall[avatarCall.indexOf("--file") + 1], "/bundle/agents/helper-avatar.png");
});

test("importAgents skips avatar upload when the destination agent already has one (dedup)", () => {
  const fs = { existsSync: () => true, readFileSync: () => AGENT_FILE_WITH_AVATAR, readdirSync: () => [] };
  const calls = [];
  const cli = {
    calls,
    json: (a) => (a[1] === "list" ? [{ id: "ag_TGT1", name: "Helper", avatar_url: "https://dest.example.com/existing.png" }] : {}),
    run: (a) => { calls.push(a); return "{}"; },
  };
  importAgents({ cli, manifest: AGENT_MANIFEST_AVATAR, dir: "/bundle", skillIdMap: new Map(), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  assert.ok(!calls.some((a) => a[0] === "agent" && a[1] === "avatar"), "must not re-upload when destination already has an avatar");
});

test("importAgents warns (but does not throw) when the avatar upload CLI call fails", () => {
  const fs = { existsSync: () => true, readFileSync: () => AGENT_FILE_WITH_AVATAR, readdirSync: () => [] };
  const cli = {
    json: (a) => (a[1] === "list" ? [] : {}),
    run: (a) => {
      if (a[0] === "agent" && a[1] === "avatar") throw new Error("upload rejected");
      return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}";
    },
  };
  const { warnings } = importAgents({ cli, manifest: AGENT_MANIFEST_AVATAR, dir: "/bundle", skillIdMap: new Map(), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  assert.ok(warnings.some((w) => w.includes("Helper") && w.includes("upload rejected")));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: FAIL — no `agent avatar` call is ever issued, `warnings` is `undefined`

- [ ] **Step 3: Write the implementation**

In `plugins/multica-tool/scripts/multica-import.mjs`, replace `importAgents` (currently lines 58-93):

```js
export function importAgents({ cli, manifest, dir, skillIdMap, runtimeMap, fs = nodeFs }) {
  const idMap = new Map();
  const sourceIdMap = new Map();
  const warnings = [];
  let created = 0, updated = 0;
  const existing = listAgents(cli);

  for (const a of manifest.agents) {
    const rec = JSON.parse(fs.readFileSync(`${dir}/${a.file}`, "utf8"));
    const targetRuntime = runtimeMap.get(rec.sourceRuntimeId);
    if (!targetRuntime) throw new Error(`Unmapped runtime "${rec.sourceRuntimeId}" for agent "${rec.name}"`);
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

    // Avatar: only upload if the destination agent doesn't already have one —
    // prevents re-uploading (and duplicate stored files) on every re-sync.
    if (rec.avatarFile && !match?.avatar_url) {
      const avatarPath = dir === "." ? rec.avatarFile : `${dir}/${rec.avatarFile}`;
      try {
        cli.run(["agent", "avatar", id, "--file", avatarPath]);
      } catch (err) {
        warnings.push(`${rec.name} (avatar upload failed: ${err.message})`);
      }
    }
  }
  return { idMap, sourceIdMap, created, updated, warnings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: PASS (all tests, including the three new ones)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `node --test tests/multica-tool/*.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugins/multica-tool/scripts/multica-import.mjs tests/multica-tool/import.test.mjs
git commit -m "feat(multica-tool): upload agent avatar on import, skip when destination already has one"
```

---

## Task 6: `multica-import.mjs` — squad avatar (passthrough / cross-server upload) + `importBundle` wiring

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-import.mjs:125-150` (`importSquad`), `:188-214` (`importBundle`)
- Modify: `plugins/multica-tool/skills/import/SKILL.md:43-51`, `plugins/multica-tool/skills/sync/SKILL.md:46-53` (report steps)
- Test: `tests/multica-tool/import.test.mjs`

**Interfaces:**
- Consumes: `readLocalConfig`, `uploadAvatarFile` from Task 1's `avatar.mjs`; `squad.avatarFile`/`squad.avatarUrl` (Task 4) and `manifest.sourceServerUrl` (Task 4).
- Produces: `importSquad(...)` gains optional params `dir = "."`, `fs = nodeFs`, `sourceServerUrl`, `readConfig = readLocalConfig`, `uploadFile = uploadAvatarFile`, `avatarExec = spawnSync`, and its return value gains `warnings: string[]`. `importBundle(...)` return value gains `avatarWarnings: string[]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/multica-tool/import.test.mjs`, near the existing `importSquad` tests:

```js
const SQUAD_ENTRY_AVATAR = {
  ...SQUAD_ENTRY,
  avatarFile: "squads/team-avatar.webp",
  avatarUrl: "https://src.example.com/uploads/sq_SRC1.webp",
};

test("importSquad passes the original avatar_url through when source and destination share a server", () => {
  const calls = [];
  const cli = { calls, json: (a) => (a.includes("list") ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"sq_NEW1"}' : "{}"; } };
  const agentIdMap = new Map([["Helper", "ag_NEW1"], ["Helper2", "ag_NEW2"]]);
  const fs = { existsSync: () => true, readFileSync: () => JSON.stringify({ server_url: "http://same-server:8080" }) };
  const { warnings } = importSquad({ cli, squad: SQUAD_ENTRY_AVATAR, agentIdMap, dir: "/bundle", fs, sourceServerUrl: "http://same-server:8080" });
  assert.deepEqual(warnings, []);
  const avatarUpdate = calls.find((a) => a.includes("--avatar-url"));
  assert.equal(avatarUpdate[avatarUpdate.indexOf("--avatar-url") + 1], "https://src.example.com/uploads/sq_SRC1.webp");
});

test("importSquad uploads the bundled file and uses the fresh url when servers differ", () => {
  const calls = [];
  const cli = { calls, json: (a) => (a.includes("list") ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"sq_NEW1"}' : "{}"; } };
  const agentIdMap = new Map([["Helper", "ag_NEW1"], ["Helper2", "ag_NEW2"]]);
  const files = { "/bundle/squads/team-avatar.webp": Buffer.from("webp-bytes") };
  const fs = {
    existsSync: () => true,
    readFileSync: (p) => (p.endsWith("config.json") ? JSON.stringify({ server_url: "http://dest-server:8080", token: "mul_tok" }) : files[p]),
  };
  let uploadArgs = null;
  const uploadFile = (args) => { uploadArgs = args; return "http://dest-server:8080/uploads/new.webp"; };
  const { warnings } = importSquad({ cli, squad: SQUAD_ENTRY_AVATAR, agentIdMap, dir: "/bundle", fs, sourceServerUrl: "http://src-server:8080", uploadFile });
  assert.deepEqual(warnings, []);
  assert.equal(uploadArgs.serverUrl, "http://dest-server:8080");
  assert.equal(uploadArgs.token, "mul_tok");
  assert.equal(uploadArgs.bytes.toString(), "webp-bytes");
  assert.equal(uploadArgs.filename, "team-avatar.webp");
  const avatarUpdate = calls.find((a) => a.includes("--avatar-url"));
  assert.equal(avatarUpdate[avatarUpdate.indexOf("--avatar-url") + 1], "http://dest-server:8080/uploads/new.webp");
});

test("importSquad skips avatar entirely when the destination squad already has one (dedup)", () => {
  const calls = [];
  const cli = {
    calls,
    json: (a) => (a.includes("list") ? [{ id: "sq_OLD", name: "Team", avatar_url: "https://dest.example.com/existing.webp" }] : {}),
    run: (a) => { calls.push(a); return "{}"; },
  };
  const agentIdMap = new Map([["Helper", "ag_NEW1"], ["Helper2", "ag_NEW2"]]);
  importSquad({ cli, squad: SQUAD_ENTRY_AVATAR, agentIdMap, dir: "/bundle", sourceServerUrl: "http://same:8080" });
  assert.ok(!calls.some((a) => a.includes("--avatar-url")), "must not touch avatar_url when destination already has one");
});

test("importSquad warns (but does not throw) when the cross-server upload fails", () => {
  const cli = { json: (a) => (a.includes("list") ? [] : {}), run: (a) => (a.includes("create") ? '{"id":"sq_NEW1"}' : "{}") };
  const agentIdMap = new Map([["Helper", "ag_NEW1"], ["Helper2", "ag_NEW2"]]);
  const fs = { existsSync: () => true, readFileSync: (p) => (p.endsWith("config.json") ? JSON.stringify({ server_url: "http://dest:8080", token: "t" }) : Buffer.from("bytes")) };
  const uploadFile = () => { throw new Error("network unreachable"); };
  const { warnings } = importSquad({ cli, squad: SQUAD_ENTRY_AVATAR, agentIdMap, dir: "/bundle", fs, sourceServerUrl: "http://src:8080", uploadFile });
  assert.ok(warnings.some((w) => w.includes("Team") && w.includes("network unreachable")));
});

test("importSquad without an avatarFile never reads config or calls upload (regression: existing callers)", () => {
  const calls = [];
  const cli = { calls, json: (a) => (a.includes("list") ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"sq_NEW1"}' : "{}"; } };
  const agentIdMap = new Map([["Helper", "ag_NEW1"], ["Helper2", "ag_NEW2"]]);
  importSquad({ cli, squad: SQUAD_ENTRY, agentIdMap }); // no dir/fs/sourceServerUrl — matches existing tests above
  assert.ok(!calls.some((a) => a.includes("--avatar-url")));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: FAIL — no `--avatar-url` call is ever issued, `warnings` is `undefined`

- [ ] **Step 3: Write the implementation**

In `plugins/multica-tool/scripts/multica-import.mjs`, add imports at the top:

```js
import { spawnSync } from "node:child_process";
import { readLocalConfig, uploadAvatarFile } from "./avatar.mjs";
```

Replace `importSquad` (currently lines 125-150):

```js
export function importSquad({ cli, squad, agentIdMap, sourceIdMap, dir = ".", fs = nodeFs, sourceServerUrl, readConfig = readLocalConfig, uploadFile = uploadAvatarFile, avatarExec = spawnSync }) {
  const existing = listSquads(cli);
  const leaderId = agentIdMap.get(squad.leaderName);
  const match = findByName(existing, squad.name);
  const warnings = [];
  let id, created = 0, updated = 0;
  const instructions = sourceIdMap ? rewriteMentions(squad.instructions, sourceIdMap) : squad.instructions;
  const instr = instructions ? ["--instructions", instructions] : [];
  if (match) {
    cli.run(["squad", "update", match.id, "--leader", leaderId, "--description", squad.description ?? "", ...instr]);
    id = match.id; updated++;
  } else {
    const out = cli.run(["squad", "create", "--name", squad.name, "--leader", leaderId, "--description", squad.description ?? "", ...instr]);
    id = JSON.parse(out).id; created++;
  }
  const present = new Set(getSquadMembers(cli, id).map((m) => m.memberId));
  for (const m of squad.members) {
    if (m.agentName === squad.leaderName) continue;
    const memberId = agentIdMap.get(m.agentName);
    if (present.has(memberId)) continue;
    cli.run(["squad", "member", "add", id, "--member-id", memberId, "--role", m.role, "--type", "agent"]);
  }

  // Avatar: only act if the destination squad doesn't already have one —
  // prevents re-uploading (and duplicate stored files) on every re-sync.
  if (squad.avatarFile && !match?.avatar_url) {
    try {
      const localConfig = readConfig(fs);
      const destServerUrl = localConfig?.server_url;
      if (sourceServerUrl && destServerUrl && sourceServerUrl === destServerUrl) {
        // Same Multica server as the export — the original URL still resolves.
        cli.run(["squad", "update", id, "--avatar-url", squad.avatarUrl]);
      } else {
        // Different server — the original URL won't resolve there, so
        // re-upload the bundled file and point the squad at the fresh URL.
        const avatarPath = dir === "." ? squad.avatarFile : `${dir}/${squad.avatarFile}`;
        const bytes = fs.readFileSync(avatarPath);
        const filename = squad.avatarFile.split("/").pop();
        const newUrl = uploadFile({ serverUrl: destServerUrl, token: localConfig?.token, bytes, filename, exec: avatarExec });
        cli.run(["squad", "update", id, "--avatar-url", newUrl]);
      }
    } catch (err) {
      warnings.push(`${squad.name} (avatar not carried over: ${err.message})`);
    }
  }

  return { newId: id, created, updated, warnings };
}
```

Replace `importBundle` (currently lines 188-214) — only the squad call and return object change:

```js
export function importBundle({ cli, dir, runtimeMap, fs = nodeFs }) {
  const manifest = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, "utf8"));
  const { effective, unresolved } = resolveRuntimeMap({ cli, manifest, runtimeMap });
  if (unresolved.length) {
    const detail = unresolved.map(({ srcId, provider, matchCount }) => provider
      ? `${srcId} (provider "${provider}": ${matchCount} matching runtimes in destination, expected exactly 1)`
      : `${srcId} (no provider recorded)`).join(", ");
    throw new Error(`Unmapped runtimes: ${detail} — pass --runtime-map, aborting before any write`);
  }

  const skillRes = importSkills({ cli, manifest, dir, fs });
  const agentRes = importAgents({ cli, manifest, dir, skillIdMap: skillRes.idMap, runtimeMap: effective, fs });
  const mentionRes = rewriteAgentMentions({ cli, manifest, dir, agentIdMap: agentRes.idMap, sourceIdMap: agentRes.sourceIdMap, fs });
  let squadRes = { newId: null, created: 0, updated: 0, warnings: [] };
  if (manifest.squads?.length) squadRes = importSquad({ cli, squad: manifest.squads[0], agentIdMap: agentRes.idMap, sourceIdMap: agentRes.sourceIdMap, dir, fs, sourceServerUrl: manifest.sourceServerUrl });

  return {
    created: { skills: skillRes.created, agents: agentRes.created, squads: squadRes.created },
    updated: { skills: skillRes.updated, agents: agentRes.updated, squads: squadRes.updated },
    mentionsRewritten: mentionRes.updated,
    skillIdMap: Object.fromEntries(skillRes.idMap),
    agentIdMap: Object.fromEntries(agentRes.idMap),
    squadId: squadRes.newId,
    secretsReminder: (manifest.agents ?? []).filter((a) => a.hadSecrets).map((a) => a.name),
    avatarWarnings: [...agentRes.warnings, ...squadRes.warnings],
  };
}
```

In `plugins/multica-tool/skills/import/SKILL.md`, update Step 3 (currently lines 43-51) to add one line after the existing `secretsReminder` line:

```markdown
- If `secretsReminder` is non-empty, surface every agent name verbatim with: "WARNING: the following agents had custom environment variables or MCP config that were NOT exported — re-add secrets manually in the Multica UI: `<agent-name>`."
- If `avatarWarnings` is non-empty, surface each entry verbatim — these are avatar images that couldn't be carried over (cosmetic only; the rest of the import still succeeded).
```

In `plugins/multica-tool/skills/sync/SKILL.md`, update Step 3 (currently lines 46-53) the same way:

```markdown
- If `secretsReminder` is non-empty, surface every agent name verbatim with: "WARNING: the following agents had custom environment variables or MCP config that were NOT exported — re-add secrets manually in the Multica UI: `<agent-name>`."
- If `avatarWarnings` is non-empty, surface each entry verbatim — these are avatar images that couldn't be carried over (cosmetic only; the rest of the sync still succeeded).
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: PASS (all tests, including the five new ones)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `node --test tests/multica-tool/*.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugins/multica-tool/scripts/multica-import.mjs plugins/multica-tool/skills/import/SKILL.md plugins/multica-tool/skills/sync/SKILL.md tests/multica-tool/import.test.mjs
git commit -m "feat(multica-tool): carry squad avatar on import via passthrough or cross-server upload"
```

---

## Task 7: End-to-end sync test (same-server passthrough, via fake fs)

**Files:**
- Test: `tests/multica-tool/sync.test.mjs`

**Interfaces:**
- Consumes: `sync(...)` from `multica-sync.mjs` (unmodified — benefits automatically from Tasks 3-6), a fake in-memory `fs` shared across the export→import round trip within one `sync()` call.

- [ ] **Step 1: Write the failing test**

Append to `tests/multica-tool/sync.test.mjs`:

```js
import * as os from "node:os";

function memFsForSync(seed = {}) {
  const files = { ...seed };
  return {
    files,
    mkdirSync: () => {},
    writeFileSync: (p, c) => { files[p] = c; },
    existsSync: (p) => p in files,
    readFileSync: (p) => files[p],
    readdirSync: () => [],
  };
}

test("sync carries a squad avatar through end-to-end via same-server passthrough", () => {
  const configPath = `${os.homedir()}/.multica/config.json`;
  const fs = memFsForSync({ [configPath]: JSON.stringify({ server_url: "http://same-host:8080", token: "mul_tok" }) });
  const avatarUrl = "https://cdn.example.com/uploads/sq_SRC1.webp";
  const exec = (args) => {
    const j = args.join(" ");
    if (j.startsWith("workspace list")) return { stdout: JSON.stringify([{ id: "ws_SRC", name: "Source" }, { id: "ws_DST", name: "Dest" }]), stderr: "", status: 0 };
    if (j.startsWith("skill list") || j.startsWith("agent list")) return { stdout: "[]", stderr: "", status: 0 };
    if (j.startsWith("squad list")) return { stdout: j.includes("ws_SRC") ? "[]" : "[]", stderr: "", status: 0 };
    if (j.startsWith("squad get")) return { stdout: JSON.stringify({ id: "sq_SRC1", name: "Team", description: "", instructions: "", leader_id: "ag_SRC1", avatar_url: avatarUrl }), stderr: "", status: 0 };
    if (j.startsWith("squad member list")) return { stdout: JSON.stringify([{ member_id: "ag_SRC1", member_type: "agent", role: "leader" }]), stderr: "", status: 0 };
    if (j.startsWith("agent get")) return { stdout: JSON.stringify({ id: "ag_SRC1", name: "Leader", description: "", instructions: "", model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6, runtime_config: {}, custom_args: [], runtime_id: "rt_SRC1", thinking_level: "", has_custom_env: false, mcp_config: {}, skills: [] }), stderr: "", status: 0 };
    if (j.startsWith("runtime list")) return { stdout: JSON.stringify([{ id: "rt_SRC1", name: "R", provider: "claude" }]), stderr: "", status: 0 };
    if (j.includes("agent create")) return { stdout: '{"id":"ag_DST1"}', stderr: "", status: 0 };
    if (j.includes("squad create")) return { stdout: '{"id":"sq_DST1"}', stderr: "", status: 0 };
    return { stdout: "{}", stderr: "", status: 0 };
  };
  const argvs = [];
  const recordingExec = (args) => { argvs.push(args); return exec(args); };

  const report = sync({ exec: recordingExec, type: "squad", name: "Team", srcWsName: "Source", destWsName: "Dest", tmpDir: "/tmp/sync-avatar-test", runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });

  assert.equal(report.created.squads, 1);
  const avatarUpdate = argvs.find((a) => a.includes("--avatar-url"));
  assert.ok(avatarUpdate, "squad update --avatar-url was called");
  assert.equal(avatarUpdate[avatarUpdate.indexOf("--avatar-url") + 1], avatarUrl, "same-server sync passes the original avatar URL straight through");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multica-tool/sync.test.mjs`
Expected: FAIL — no `--avatar-url` call found in `argvs` (or an error reading the config path, if `fs` isn't threaded correctly yet)

- [ ] **Step 3: Confirm no source changes are needed**

`multica-sync.mjs` requires no code changes — `sync()` already passes its `fs` through to both `exportResource` and `importBundle` unmodified, and both now read `readLocalConfig(fs)` internally, seeing the same seeded `~/.multica/config.json` entry both times. If this test fails for a reason other than "feature not built yet" (e.g. a wrong path being read), re-check `sync()` in `plugins/multica-tool/scripts/multica-sync.mjs` for how `fs` is threaded into `exportResource`/`importBundle` — it must be passed unchanged, not defaulted.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multica-tool/sync.test.mjs`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `node --test tests/multica-tool/*.test.mjs`
Expected: PASS — every test file green

- [ ] **Step 6: Commit**

```bash
git add tests/multica-tool/sync.test.mjs
git commit -m "test(multica-tool): cover end-to-end squad avatar passthrough via sync"
```

---

## Task 8: Plugin validation pass

**Files:** none created/modified — this task runs the repo's required validation gate over everything Tasks 1-7 touched.

- [ ] **Step 1: Run validate-skills**

Since Tasks 4 and 6 edited `SKILL.md` files, run:

```
/validate-skills
```

Fix any `[FAIL]` items it reports for `plugins/multica-tool/skills/{export,import,sync}/SKILL.md` before continuing.

- [ ] **Step 2: Run the plugin-validator agent**

Per this repo's `CLAUDE.md`, run the `plugin-validator` agent against `plugins/multica-tool` (invoke via the `plugin-validator:plugin-validator` agent type or `/plugin-validator` command). Fix all `[FAIL]` items it proposes.

- [ ] **Step 3: Final full-suite run**

Run: `node --test tests/multica-tool/*.test.mjs`
Expected: PASS — every test across `avatar.test.mjs`, `lib.test.mjs`, `export.test.mjs`, `import.test.mjs`, `sync.test.mjs`

- [ ] **Step 4: Commit any validator-driven fixes**

```bash
git add -A plugins/multica-tool
git commit -m "chore(multica-tool): fix plugin-validator/validate-skills findings for avatar support"
```

(Skip this step entirely if there is nothing to commit — validators found no issues.)
