# Multica export orphan-skill cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a Multica export, drop any skill that no exported agent references so the bundle contains only skills something actually uses.

**Architecture:** Add one pruning block in `exportResource` between resource collection and `buildManifest`. It builds the set of skill names referenced by any exported agent (`skill_names` union) and deletes unreferenced skills from the `skills` map before the manifest and files are written — so orphans are absent from both, with no `fs.rm` and no second manifest write. The `skill` scope is exempt. `exportResource` returns a new `pruned_skills` array; the export SKILL.md reports it.

**Tech Stack:** Node.js ESM, `node --test`, `node:assert`.

## Global Constraints

- Implementation edits stay inside `plugins/multica-tool/` (source) and repo-root `tests/multica-tool/` (tests). No manifest/README churn — this is an edit to one existing plugin.
- Run Node tests with the file-glob form: `node --test tests/multica-tool/export.test.mjs` (directory form throws MODULE_NOT_FOUND in this repo).
- House style: minimal diff, surgical edits, match surrounding conventions.
- Do not bump any `version` field.

---

### Task 1: Prune orphan skills in `exportResource` (+ tests)

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-export.mjs` (in `exportResource`, between the `if (scope === …)` collection chain ending ~line 165 and the `buildManifest` call ~line 167; and the `return` ~line 232)
- Modify: `tests/multica-tool/fixtures.mjs` (add `SKILL_GET_2`)
- Test: `tests/multica-tool/export.test.mjs`

**Interfaces:**
- Consumes: `exportResource({ cli, scope, ids, outDir, sourceWorkspaceId, fs, download })` — existing signature, unchanged. Internal locals `skills` (Map name→normalized skill) and `agentsById` (Map id→`{ raw, red, skill_names }`).
- Produces: `exportResource` now returns `{ manifest, warnings, pruned_skills }` where `pruned_skills` is a `string[]` of pruned skill names (empty when nothing pruned or scope is `skill`).

- [ ] **Step 1: Add the `SKILL_GET_2` fixture**

In `tests/multica-tool/fixtures.mjs`, after the existing `SKILL_GET` block (ends line 8):

```js
// A second skill referenced by NO agent — used to test orphan-skill pruning.
export const SKILL_GET_2 = {
  id: "sk_SRC2", name: "Lonely", description: "nobody uses me",
  content: "# Lonely\nbody", config: {}, files: [],
};
```

- [ ] **Step 2: Write the failing tests**

In `tests/multica-tool/export.test.mjs`, first extend the fixture import to include `SKILL_GET_2` (add it to the existing `from "./fixtures.mjs"` import list at the top of the file). Then append these two tests at the end of the file:

```js
test("export all prunes skills no agent references", () => {
  const fs = memFs();
  const cli = {
    json: (args) => {
      const two = args.slice(0, 2).join(" ");
      const three = args.slice(0, 3).join(" ");
      if (two === "skill list") return [{ id: "sk_SRC1", name: "Greet" }, { id: "sk_SRC2", name: "Lonely" }];
      if (two === "agent list") return [{ id: "ag_SRC1" }, { id: "ag_SRC2" }];
      if (two === "squad list") return [];
      if (two === "project list") return [];
      if (three === "skill get sk_SRC1") return SKILL_GET;
      if (three === "skill get sk_SRC2") return SKILL_GET_2;
      if (three === "agent get ag_SRC1") return AGENT_GET;   // uses skill Greet
      if (three === "agent get ag_SRC2") return AGENT_GET_2; // no skills
      if (three === "runtime list") return RUNTIME_LIST_SRC;
      throw new Error("unexpected " + args.join(" "));
    },
    run: () => "",
  };
  const { manifest, pruned_skills } = exportResource({ cli, scope: "all", ids: {}, outDir: "/all", sourceWorkspaceId: "ws", fs, download: () => null });
  // Why: an export must not ship a skill nothing uses.
  assert.deepEqual(pruned_skills, ["Lonely"], "unreferenced skill reported as pruned");
  assert.deepEqual(manifest.skills.map((s) => s.name), ["Greet"], "orphan absent from manifest, referenced skill kept");
  assert.equal(fs.files["/all/skills/lonely/SKILL.md"], undefined, "orphan skill dir never written");
  assert.ok(fs.files["/all/skills/greet/SKILL.md"], "referenced skill still written");
});

test("export --scope skill never prunes the requested skill", () => {
  const fs = memFs();
  const cli = {
    json: (args) => {
      const three = args.slice(0, 3).join(" ");
      if (three === "skill get sk_SRC2") return SKILL_GET_2;
      throw new Error("unexpected " + args.join(" "));
    },
    run: () => "",
  };
  const { manifest, pruned_skills } = exportResource({ cli, scope: "skill", ids: { skillId: "sk_SRC2" }, outDir: "/one", sourceWorkspaceId: "ws", fs, download: () => null });
  // Why: the explicitly-requested skill is the target, not an orphan.
  assert.deepEqual(pruned_skills, [], "skill scope skips the prune pass");
  assert.deepEqual(manifest.skills.map((s) => s.name), ["Lonely"], "requested lone skill survives");
  assert.ok(fs.files["/one/skills/lonely/SKILL.md"], "requested skill written");
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: the two new tests FAIL — `pruned_skills` is `undefined` (destructuring yields `undefined`, so `assert.deepEqual(undefined, ["Lonely"])` fails), and the `all` test also sees `Lonely` present in `manifest.skills` / written to disk.

- [ ] **Step 4: Implement the prune block**

In `plugins/multica-tool/scripts/multica-export.mjs`, immediately after the scope-collection chain (the line `else if (scope === "all") { … }` closes, ~line 165) and before `const manifest = buildManifest({` (~line 167), insert:

```js
  // Orphan-skill cleanup: drop skills that no exported agent references via its
  // skill_names. Only `all` ever produces these — standalone workspace skills
  // from listSkills that no agent uses. Skipped for `skill` scope: its one
  // skill is the explicit target, not an orphan.
  const pruned_skills = [];
  if (scope !== "skill") {
    const referenced = new Set();
    for (const a of agentsById.values()) for (const n of a.skill_names) referenced.add(n);
    for (const name of [...skills.keys()]) {
      if (!referenced.has(name)) { pruned_skills.push(name); skills.delete(name); }
    }
  }
```

- [ ] **Step 5: Return `pruned_skills`**

In the same function, change the final `return { manifest, warnings };` (~line 232) to:

```js
  return { manifest, warnings, pruned_skills };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: PASS — all export tests, including the two new ones. Confirm the existing `export all collects every resource…` test still passes (its lone skill `Greet` is referenced by `Helper`, so it is not pruned).

- [ ] **Step 7: Commit**

```bash
git add plugins/multica-tool/scripts/multica-export.mjs tests/multica-tool/fixtures.mjs tests/multica-tool/export.test.mjs
git commit -m "feat(multica-tool): prune orphan skills on export

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Report pruned skills in export SKILL.md

**Files:**
- Modify: `plugins/multica-tool/skills/export/SKILL.md` (Step 5 — "Report results", lines 63-69)

**Interfaces:**
- Consumes: the `pruned_skills` array on `exportResource`'s JSON output (from Task 1).
- Produces: nothing code-facing — documentation only.

- [ ] **Step 1: Add a reporting bullet**

In `plugins/multica-tool/skills/export/SKILL.md`, in the Step 5 bullet list (currently: directory, counts, warnings), add a bullet between the counts bullet and the `warnings` bullet:

```markdown
- If `pruned_skills` is non-empty, note it: "Pruned N orphan skill(s) not linked to any agent: `<name>`, …" (these are standalone workspace skills that no exported agent references — only `--scope all` produces them).
```

- [ ] **Step 2: Validate the skill**

Run the `validate-skills` skill against the edited SKILL.md (per repo CLAUDE.md, required after editing any `SKILL.md`). Invoke `/validate-skills`. Fix any `[FAIL]` items on `skills/export/SKILL.md`.
Expected: no `[FAIL]` for `skills/export/SKILL.md`.

- [ ] **Step 3: Commit**

```bash
git add plugins/multica-tool/skills/export/SKILL.md
git commit -m "docs(multica-tool): report pruned orphan skills in export

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Post-implementation

Per repo CLAUDE.md, after the plugin edit is complete, run the `plugin-validator` agent against `multica-tool` and fix any `[FAIL]` items before marking the work done.

## Self-Review

- **Spec coverage:** Behavior table → Task 1 prune block (all/agent/squad/project no-op via referenced set; skill exempt via `scope !== "skill"`). Implementation snippet → Task 1 Step 4. Return value → Task 1 Step 5. Reporting → Task 2. Tests (both cases) → Task 1 Steps 1-2. Out-of-scope (stale folder scrub) correctly has no task. ✓
- **Placeholder scan:** No TBD/TODO; all code blocks are concrete. ✓
- **Type consistency:** `pruned_skills` (`string[]`) named identically in the block, the return, and both tests; `skills` (Map) and `agentsById` (Map with `.skill_names`) match `multica-export.mjs` locals. ✓
