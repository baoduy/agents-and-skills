# Externalize agent & squad instructions to `.md` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export each agent/squad `instructions` value to a sibling `.md` file (referenced by an `instructions_file` key) instead of embedding it in JSON, and have import read it back — a full round-trip that lets a human review/enhance the prose as Markdown.

**Architecture:** Export strips `instructions` from the agent record / squad manifest entry, writes it to `agents/<slug>.md` / `squads/<slug>.md`, and records the relative path under `instructions_file` (exactly mirroring the existing `avatar_file` pattern). Import gains one `readInstructions(fs, dir, rec)` helper that reads the `.md` when `instructions_file` is set and the file exists, else falls back to the inline `rec.instructions` — so legacy bundles import unchanged. `sync` inherits the change for free (it pipes export→import through a temp dir).

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`. No new dependencies.

## Global Constraints

- Edits stay inside `plugins/multica-tool/` (source) and repo-root `tests/multica-tool/` (tests) and `docs/superpowers/` (this plan). No manifest/README/version churn — this is an edit to one existing plugin.
- No manifest `version` bump; import stays tolerant of both layouts.
- Match existing house style in the touched files: terse inline comments explaining *why*, minimal diff, no reformatting of untouched code.
- Empty/absent instructions ⇒ no `.md` written and no `instructions_file` key.
- `.md` path is the `file` path with `.json` replaced by `.md` (`entry.file.replace(/\.json$/, ".md")`).
- Run tests with: `node --test tests/multica-tool/*.test.mjs` (all pass before and after each commit).

---

### Task 1: Export — split `instructions` out of the agent record and write `agents/<slug>.md`

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-export.mjs` — `redactAgent` (~lines 30-55) and the agent write loop (~lines 156-174)
- Test: `tests/multica-tool/export.test.mjs`

**Interfaces:**
- Consumes: `getAgent` fixtures (`AGENT_GET` has `instructions: "be nice"`; `AGENT_GET_2`/`AGENT_GET_IMG` have `instructions: ""`).
- Produces: `redactAgent(a)` now returns `{ record, hadSecrets, instructions }` where `record` has **no** `instructions` key; the agent write loop writes `agents/<slug>.md` and sets `record.instructions_file` when instructions are non-empty.

- [ ] **Step 1: Write the failing tests**

Add to `tests/multica-tool/export.test.mjs` (after the existing `redactAgent` tests, ~line 88):

```javascript
test("redactAgent returns instructions separately and strips them from the record", () => {
  const normalized = getAgent({ json: () => AGENT_GET }, "ag_SRC1");
  normalized.custom_env = {};
  normalized.custom_env_fetch_failed = false;
  const { record, instructions } = redactAgent(normalized);
  assert.equal(instructions, "be nice", "instructions returned alongside the record");
  assert.ok(!("instructions" in record), "instructions no longer embedded in the JSON record");
});

test("redactAgent returns empty-string instructions when the agent has none", () => {
  const normalized = getAgent({ json: () => AGENT_GET_2 }, "ag_SRC2");
  normalized.custom_env = {};
  normalized.custom_env_fetch_failed = false;
  const { instructions } = redactAgent(normalized);
  assert.equal(instructions, "", "empty instructions normalized to \"\"");
});
```

Add after the "export agent writes mcp_config/custom_env" test (~line 142):

```javascript
test("export agent writes instructions to a sibling .md and records instructions_file", () => {
  const fs = memFs();
  exportResource({ cli: fakeCli(), scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/oi", sourceWorkspaceId: "ws", fs });
  const record = JSON.parse(fs.files["/oi/agents/helper.json"]);
  assert.equal(fs.files["/oi/agents/helper.md"], "be nice", "instructions written to agents/<slug>.md");
  assert.equal(record.instructions_file, "agents/helper.md", "record points at the .md");
  assert.ok(!("instructions" in record), "instructions no longer in the JSON record");
});

test("export agent with empty instructions writes no .md and no instructions_file", () => {
  const fs = memFs();
  exportResource({ cli: fakeCli(), scope: "agent", ids: { agentId: "ag_SRC2" }, outDir: "/oe", sourceWorkspaceId: "ws", fs });
  const record = JSON.parse(fs.files["/oe/agents/helper2.json"]);
  assert.equal(fs.files["/oe/agents/helper2.md"], undefined, "no .md written for empty instructions");
  assert.ok(!("instructions_file" in record), "no instructions_file key when empty");
  assert.ok(!("instructions" in record), "instructions never embedded");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: the four new tests FAIL (`redactAgent` still embeds `instructions`; no `.md`/`instructions_file` written).

- [ ] **Step 3: Implement — strip `instructions` in `redactAgent`**

In `plugins/multica-tool/scripts/multica-export.mjs`, change the `redactAgent` destructure and return. Add `instructions` to the destructured keys so it leaves `...rest`, and return it separately:

```javascript
export function redactAgent(a) {
  // ... existing comment ...
  const { id, has_custom_env, mcp_config_redacted, custom_env_fetch_failed, mcp_config, custom_env, skills, runtime_id, instructions, ...rest } = a;
  const mcpUsable = !mcp_config_redacted && nonEmpty(mcp_config);
  const envUsable = !custom_env_fetch_failed && nonEmpty(custom_env);
  const hadSecrets = mcpUsable || envUsable || !!mcp_config_redacted || !!custom_env_fetch_failed;
  return {
    // instructions are written to a sibling .md by the caller (see avatar_file),
    // never embedded in the JSON record.
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
    instructions: instructions ?? "",
  };
}
```

- [ ] **Step 4: Implement — write the `.md` in the agent write loop**

In the agent write loop (the `for (const entry of manifest.agents)` block), add, just before the final `fs.writeFileSync(`${outDir}/${entry.file}`, ...)`:

```javascript
    // Instructions live in a sibling .md for reviewability (same sibling-file
    // pattern as avatar_file); only written when non-empty.
    if (red.instructions) {
      const rel = entry.file.replace(/\.json$/, ".md");
      fs.writeFileSync(`${outDir}/${rel}`, red.instructions);
      record.instructions_file = rel;
    }
```

(`red` is already destructured as `const { raw, red, skill_names } = agentByName.get(entry.name);` at the top of that loop.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: PASS — all tests including the four new ones.

- [ ] **Step 6: Commit**

```bash
git add plugins/multica-tool/scripts/multica-export.mjs tests/multica-tool/export.test.mjs
git commit -m "feat(multica-tool): export agent instructions to a sibling .md"
```

---

### Task 2: Export — write squad instructions to `squads/<slug>.md`

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-export.mjs` — `buildManifest` squads mapping (~line 68) and the squad write loop (~lines 175-178)
- Test: `tests/multica-tool/export.test.mjs`

**Interfaces:**
- Consumes: `SQUAD_GET` (`instructions: "# Team charter\nShip it."`); the "export all" fixture squads have `instructions: ""`.
- Produces: manifest `squads[]` entries drop `instructions` and gain `instructions_file` (`squads/<slug>.md`) when non-empty; the squad write loop writes that `.md`.

- [ ] **Step 1: Update the existing squad test and add the empty-squad test**

In `tests/multica-tool/export.test.mjs`, the test "export squad resolves leader and member names by id and writes squad file" currently asserts `squad.instructions`. Replace that one assertion line:

```javascript
  assert.equal(squad.instructions, "# Team charter\nShip it.", "squad instructions captured in export");
```

with:

```javascript
  assert.ok(!("instructions" in squad), "squad instructions no longer embedded in the JSON");
  assert.equal(squad.instructions_file, "squads/team.md", "squad JSON points at the .md");
  assert.equal(fs.files["/s/squads/team.md"], "# Team charter\nShip it.", "squad instructions written to squads/<slug>.md");
  assert.equal(manifest.squads[0].instructions_file, "squads/team.md", "manifest squad entry carries instructions_file");
  assert.ok(!("instructions" in manifest.squads[0]), "manifest squad entry drops instructions");
```

Then, at the end of the "export all collects every resource" test (which uses squads with empty `instructions`), add before its closing `});`:

```javascript
  assert.equal(fs.files["/all/squads/a.md"], undefined, "empty squad instructions write no .md");
  assert.ok(!("instructions_file" in JSON.parse(fs.files["/all/squads/a.json"])), "no instructions_file for empty squad");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: the updated squad test FAILs (JSON still has `instructions`, no `.md`, no `instructions_file`).

- [ ] **Step 3: Implement — `buildManifest` squad mapping**

In `plugins/multica-tool/scripts/multica-export.mjs`, replace the `squads:` line in `buildManifest`'s returned object:

```javascript
    squads: (squads ?? []).map((squad) => {
      const file = `squads/${slugify(squad.name)}.json`;
      const entry = { name: squad.name, file, description: squad.description ?? "", avatar_url: squad.avatar_url ?? null, leader_name: squad.leader_name, members: squad.members };
      // Instructions go to a sibling .md (see squad write loop); only referenced when non-empty.
      if (squad.instructions) entry.instructions_file = file.replace(/\.json$/, ".md");
      return entry;
    }),
```

- [ ] **Step 4: Implement — write the squad `.md`**

Replace the squad write loop (`for (const entry of manifest.squads) { ... }`). Add a name→instructions lookup from the in-memory `squads` array (which still holds the full prose) and write the `.md`:

```javascript
  const squadInstrByName = new Map(squads.map((s) => [s.name, s.instructions ?? ""]));
  for (const entry of manifest.squads) {
    fs.mkdirSync(`${outDir}/squads`, { recursive: true });
    if (entry.instructions_file) {
      fs.writeFileSync(`${outDir}/${entry.instructions_file}`, squadInstrByName.get(entry.name) ?? "");
    }
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(entry, null, 2));
  }
```

(`squads` is the local array declared near the top of `exportResource` as `const squads = [];` and passed to `buildManifest`; it retains each squad's full `instructions`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/multica-tool/scripts/multica-export.mjs tests/multica-tool/export.test.mjs
git commit -m "feat(multica-tool): export squad instructions to a sibling .md"
```

---

### Task 3: Import — read instructions from the `.md` via a `readInstructions` helper

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-import.mjs` — add helper; wire into `importAgents` (~line 85), `rewriteAgentMentions` (~lines 185-192), and the squad loop in `importBundle` (~lines 282-287)
- Test: `tests/multica-tool/import.test.mjs`

**Interfaces:**
- Consumes: manifest agent entries (`{ name, file }`) and squad entries (`{ name, file, instructions_file?, instructions? }`); the fake fs in tests is path-aware (`existsSync: (p) => p in files`).
- Produces: `readInstructions(fs, dir, rec)` → the `.md` contents when `rec.instructions_file` is set and the file exists, else `rec.instructions ?? ""`. Wired so agent `--instructions`, squad create, and mention rewriting all use it.

- [ ] **Step 1: Write the failing tests**

Add to `tests/multica-tool/import.test.mjs`. First, an `importAgents` test that reads from a `.md` (place near the other `importAgents` tests, and note the manifest entry + bundle both name the `.md`):

```javascript
test("importAgents reads instructions from the sibling .md when instructions_file is set", () => {
  const files = {
    "agents/helper.json": JSON.stringify({ name: "Helper", instructions_file: "agents/helper.md", model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6, source_id: "ag_SRC1", source_runtime_id: "rt_SRC1", skill_names: [] }),
    "agents/helper.md": "enhanced instructions from md",
  };
  const fs = { existsSync: (p) => p in files, readFileSync: (p) => files[p], readdirSync: () => [] };
  const calls = [];
  const cli = { run: (a) => { calls.push(a); return JSON.stringify({ id: "ag_NEW1" }); } };
  importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map(), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  const create = calls.find((a) => a[0] === "agent" && a[1] === "create");
  assert.equal(create[create.indexOf("--instructions") + 1], "enhanced instructions from md", "instructions came from the .md, not the JSON");
});

test("importAgents falls back to inline JSON instructions when there is no instructions_file (legacy bundle)", () => {
  const fs = { existsSync: () => true, readFileSync: () => AGENT_FILE, readdirSync: () => [] };
  const calls = [];
  const cli = { run: (a) => { calls.push(a); return JSON.stringify({ id: "ag_NEW1" }); } };
  importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map(), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  const create = calls.find((a) => a[0] === "agent" && a[1] === "create");
  assert.equal(create[create.indexOf("--instructions") + 1], "be nice", "legacy inline instructions still used when no instructions_file");
});
```

(`AGENT_MANIFEST`, `AGENT_FILE`, and the `cli`/`calls` idiom already exist in this file — reuse them. `AGENT_MANIFEST` is `{ version: "1", skills: [], agents: [{ name: "Helper", file: "agents/helper.json", ... }] }`; if the `cli` in nearby tests is built differently, mirror that file's existing pattern rather than the sketch above.)

Then a squad round-trip test — extend the existing full `importBundle` test's bundle, or add a focused one. Add:

```javascript
test("importBundle reads squad instructions from the squad .md", () => {
  const files = {
    "manifest.json": JSON.stringify({
      version: "1", skills: [],
      agents: [{ name: "Helper", file: "agents/helper.json", source_runtime_id: "rt_SRC1", skill_names: [] }],
      squads: [{ name: "Team", file: "squads/team.json", leader_name: "Helper", instructions_file: "squads/team.md", members: [{ agent_name: "Helper", role: "leader" }] }],
    }),
    "agents/helper.json": JSON.stringify({ name: "Helper", model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6, source_id: "ag_SRC1", source_runtime_id: "rt_SRC1", skill_names: [] }),
    "squads/team.md": "# Charter from md",
  };
  const fs = memFs(files);
  const calls = [];
  const cli = makeImportCli(calls); // reuse this file's helper that returns fresh ids for create + [] for lists
  importBundle({ cli, dir: ".", runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  const squadCreate = calls.find((a) => a[0] === "squad" && a[1] === "create");
  assert.equal(squadCreate[squadCreate.indexOf("--instructions") + 1], "# Charter from md", "squad instructions read from the .md");
});
```

(If this file has no `makeImportCli`/multi-command fake-cli helper, mirror the `cli` object used by the existing end-to-end `importBundle` test — copy its shape rather than inventing a new one.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: the two new `.md`-reading tests FAIL (instructions still come only from inline JSON, which these bundles omit). The legacy-fallback test should already PASS (behavior unchanged) — that is fine; it guards the fallback.

- [ ] **Step 3: Implement — add the helper**

In `plugins/multica-tool/scripts/multica-import.mjs`, near the top (after the imports), add:

```javascript
// Instructions live in a sibling .md referenced by `instructions_file` (mirrors
// avatar_file). Legacy bundles carry no instructions_file and keep instructions
// inline in the JSON — fall back to that so older exports still import.
function readInstructions(fs, dir, rec) {
  if (rec.instructions_file && fs.existsSync(`${dir}/${rec.instructions_file}`)) {
    return fs.readFileSync(`${dir}/${rec.instructions_file}`, "utf8");
  }
  return rec.instructions ?? "";
}
```

- [ ] **Step 4: Implement — wire into `importAgents`**

In `importAgents`, replace:

```javascript
    if (rec.instructions) common.push("--instructions", rec.instructions);
```

with:

```javascript
    const instructions = readInstructions(fs, dir, rec);
    if (instructions) common.push("--instructions", instructions);
```

- [ ] **Step 5: Implement — wire into `rewriteAgentMentions`**

Replace the body of the `for (const a of manifest.agents)` loop in `rewriteAgentMentions`:

```javascript
  for (const a of manifest.agents) {
    const rec = JSON.parse(fs.readFileSync(`${dir}/${a.file}`, "utf8"));
    const instructions = readInstructions(fs, dir, rec);
    if (!instructions) continue;
    const rewritten = rewriteMentions(instructions, sourceIdMap);
    if (rewritten === instructions) continue;
    cli.run(["agent", "update", agentIdMap.get(rec.name), "--instructions", rewritten]);
    updated++;
  }
```

- [ ] **Step 6: Implement — wire into the `importBundle` squad loop**

In `importBundle`, set the squad's instructions from the `.md` before calling `importSquad`:

```javascript
  for (const squad of manifest.squads ?? []) {
    squad.instructions = readInstructions(fs, dir, squad);
    const r = importSquad({ cli, squad, agentIdMap: agentRes.idMap, sourceIdMap: agentRes.sourceIdMap });
    squadIdMap.set(squad.name, r.newId);
    squadsCreated += r.created;
    squadsUpdated += r.updated;
  }
```

- [ ] **Step 7: Run the full import + sync + lib tests to verify they pass**

Run: `node --test tests/multica-tool/*.test.mjs`
Expected: PASS — new `.md` tests pass, all pre-existing tests (including the legacy-fallback path) still pass.

- [ ] **Step 8: Commit**

```bash
git add plugins/multica-tool/scripts/multica-import.mjs tests/multica-tool/import.test.mjs
git commit -m "feat(multica-tool): import reads instructions from the sibling .md"
```

---

### Task 4: Docs — reflect the new `.md` layout in the export/import skills

**Files:**
- Modify: `plugins/multica-tool/skills/export/SKILL.md` (~line 55)
- Modify: `plugins/multica-tool/skills/import/SKILL.md` (~after line 41)

**Interfaces:**
- Consumes: nothing (prose only).
- Produces: user-facing docs describing `agents/<slug>.md` / `squads/<slug>.md` and that editing the `.md` is the supported way to enhance instructions before import.

- [ ] **Step 1: Update export SKILL.md**

Replace the layout sentence:

```
The script writes `manifest.json`, skill SKILL.md files, agent JSON files, and squad JSON files into `<dir>`.
```

with:

```
The script writes `manifest.json`, skill `SKILL.md` files, agent JSON files, and squad JSON files into `<dir>`. Each agent's and squad's **instructions** (system prompt / charter) are written to a sibling Markdown file — `agents/<slug>.md`, `squads/<slug>.md` — referenced by an `instructions_file` key in the JSON, so the prose is easy to read, diff, and edit. Agents/squads with no instructions get no `.md`.
```

- [ ] **Step 2: Update import SKILL.md**

After the mention-rewriting paragraph (line 41), add a new paragraph:

```
Instructions are read back from each resource's sibling `.md` (`agents/<slug>.md`, `squads/<slug>.md`) when present — editing that Markdown is the supported way to review and enhance an agent's or squad's instructions before import. Older bundles that predate the split (instructions inline in the JSON, no `instructions_file`) still import unchanged.
```

- [ ] **Step 3: Validate the changed skills**

Run the `validate-skills` skill against `plugins/multica-tool/skills/export/SKILL.md` and `.../import/SKILL.md` (invoke `/validate-skills`). Fix any `[FAIL]` items.

- [ ] **Step 4: Commit**

```bash
git add plugins/multica-tool/skills/export/SKILL.md plugins/multica-tool/skills/import/SKILL.md
git commit -m "docs(multica-tool): document instructions .md files in export/import skills"
```

---

### Task 5: Full verification & plugin validation

**Files:** none modified (verification only; fix-forward if something fails).

- [ ] **Step 1: Run the whole multica-tool test suite**

Run: `node --test tests/multica-tool/*.test.mjs`
Expected: all tests pass (export, import, sync, lib).

- [ ] **Step 2: End-to-end round-trip sanity via sync tests**

Confirm `tests/multica-tool/sync.test.mjs` passes unchanged — it exercises `exportResource`→`importBundle` through a temp dir, proving the `.md` round-trip end-to-end with no sync code change.

Run: `node --test tests/multica-tool/sync.test.mjs`
Expected: PASS.

- [ ] **Step 3: Run the plugin-validator agent**

Per repo CLAUDE.md, run the `plugin-validator` agent (or `/plugin-validator`) against `multica-tool`. Fix any `[FAIL]` items (skills/agents/commands/hooks).

- [ ] **Step 4: Final commit if the validator required fixes**

```bash
git add -A
git commit -m "fix(multica-tool): address plugin-validator findings for instructions .md"
```

(Skip if the validator reported no fixes.)

---

## Self-Review

**Spec coverage:**
- File layout (`agents/<slug>.md`, `squads/<slug>.md`, `instructions_file`, empty ⇒ none) → Tasks 1 & 2.
- Export changes (redactAgent split, agent loop, buildManifest squad mapping, squad loop) → Tasks 1 & 2.
- Import helper + three wiring sites (importAgents, rewriteAgentMentions, importBundle squad loop) → Task 3.
- Backward-compat fallback (legacy inline instructions) → Task 3, Steps 1 & 7 (fallback test kept/added).
- Sync unchanged → Task 5, Step 2.
- Tests (export `.md` + no-`.md`, import `.md` read + legacy fallback, squad `.md`) → Tasks 1–3.
- Docs (export + import SKILL.md) → Task 4.
- Validation (tests, validate-skills, plugin-validator) → Tasks 4 & 5.

**Placeholder scan:** No TBD/TODO; each code step shows real code. The two import-test steps note "mirror this file's existing fake-cli/`makeImportCli` idiom" because the exact cli-builder name must match what already exists in `import.test.mjs` — the implementer confirms the name when writing Step 1 (an explicit instruction, not a vague placeholder).

**Type/name consistency:** `redactAgent` → `{ record, hadSecrets, instructions }` (Task 1) consumed as `red.instructions` in the agent write loop (Task 1). `instructions_file` key written by Tasks 1–2 and read by `readInstructions` (Task 3). `readInstructions(fs, dir, rec)` signature identical across all three wiring sites. `.json`→`.md` derivation identical in export (Tasks 1–2) and implied by the recorded path in import.
