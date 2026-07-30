# Multica default import/export folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the multica-tool export and import skills sensible default folders — export defaults to `export/<workspace-name>`, import defaults the target workspace to the bundle folder's basename.

**Architecture:** Prose-only edits to two `SKILL.md` files. The skills already compute the `--out` / `--workspace` values passed to the export/import scripts; only the default-derivation prose changes. No `.mjs` scripts, manifests, or CLI flags are touched.

**Tech Stack:** Markdown skill files under `plugins/multica-tool/skills/`. Verification via the `/validate-skills` skill and the `plugin-validator` agent.

## Global Constraints

- Implementation edits stay inside `plugins/multica-tool/` (project CLAUDE.md rule); design/plan docs under `docs/superpowers/`.
- No script (`.mjs`), manifest, or CLI-flag changes — prose only.
- Slugify rules referenced in prose must match `scripts/lib.mjs` `slugify`: lowercase, runs of non-`[a-z0-9]` → single `-`, trim leading/trailing `-`.
- Minimal diff; preserve existing prose except where the feature requires change.
- Do not bump plugin/root `version` fields.

---

### Task 1: Export default output directory

**Files:**
- Modify: `plugins/multica-tool/skills/export/SKILL.md` (Step 3 — "Determine output directory")

**Interfaces:**
- Consumes: `multica workspace get --output json` → `.name` (current default workspace name); the `--workspace <name>` value the user supplied (if any).
- Produces: the `--out <dir>` value used verbatim in Step 4's export command. Path forms: `export/<workspace-name>` for `all`/`projects`; `export/<workspace-name>/<slug>-<type>` for a single resource.

- [ ] **Step 1: Rewrite Step 3 of export/SKILL.md**

Replace the current Step 3 body:

```markdown
## Step 3 — Determine output directory

If the user specified an output directory, use it. Otherwise default to:

```
./multica-export-<slug>-<type>
```

where `<slug>` is a lowercased, hyphenated form of the resource name.
```

with:

```markdown
## Step 3 — Determine output directory

If the user specified an output directory, use it verbatim. Otherwise default to a workspace-rooted path.

First resolve `<workspace-name>`:

- If the user named a source workspace (the value you would pass as `--workspace <name>`), use that name.
- Otherwise, read the current default workspace's name:

```bash
multica workspace get --output json
```

  and take its `.name`.

Slugify the resolved name for filesystem safety — lowercase it, replace each run of non-`[a-z0-9]` characters with a single `-`, and trim leading/trailing `-` (the same rule the scripts use internally).

Then construct the default directory by scope:

- `all` or `projects` (whole workspace) → `export/<workspace-name>`
- a single resource (`skill`, `agent`, `squad`, or `project`) → `export/<workspace-name>/<slug>-<type>`, where `<slug>` is the slugified resource name and `<type>` is the resource type.

Examples: `export all from mx-workspace` → `export/mx-workspace`; `export skill "Foo Bar" from mx-workspace` → `export/mx-workspace/foo-bar-skill`.
```

- [ ] **Step 2: Verify the edit reads consistently**

Re-read `plugins/multica-tool/skills/export/SKILL.md` end to end. Confirm:
- Step 4 still references `--out <dir>` (the value Step 3 now produces) — no wording contradicts the new default.
- The frontmatter `allowed-tools: Bash, Read` already permits `multica workspace get` (Bash). No frontmatter change needed.
- No remaining reference to the old `./multica-export-<slug>-<type>` default anywhere in the file.

- [ ] **Step 3: Validate the skill**

Run `/validate-skills` (scoped to the export skill) in Claude Code.
Expected: no `[FAIL]` items for `plugins/multica-tool/skills/export/SKILL.md`. Fix any that appear.

- [ ] **Step 4: Commit**

```bash
git add plugins/multica-tool/skills/export/SKILL.md
git commit -m "feat(multica-tool): default export dir to export/<workspace-name>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Import default target workspace

**Files:**
- Modify: `plugins/multica-tool/skills/import/SKILL.md` (Step 1 — "Confirm the target workspace")

**Interfaces:**
- Consumes: the import folder path (`--dir <folder>`); the target workspace name the user supplied (if any).
- Produces: the `--workspace <workspace-name>` value used in Steps 2–4. When the user named no workspace, it is the basename of `--dir`.

- [ ] **Step 1: Rewrite Step 1 of import/SKILL.md**

Replace the current Step 1 body:

```markdown
## Step 1 — Confirm the target workspace

Ask the user to confirm the name of the target workspace if not already stated. You will need the exact workspace name as registered in Multica.
```

with:

```markdown
## Step 1 — Determine the target workspace

You need the exact workspace name as registered in Multica for `--workspace` in the steps below.

- If the user named a target workspace, use it.
- If the user did **not** name one, default to the **basename of the import folder** — e.g. importing from `export/mx-workspace` defaults the target workspace to `mx-workspace`. State the inferred workspace name to the user before continuing.

No existence check is needed here: the Step 2 dry-run fails with `Unknown workspace "<name>"` if the inferred workspace is not present in the target account, at which point ask the user for the correct name.
```

- [ ] **Step 2: Verify the edit reads consistently**

Re-read `plugins/multica-tool/skills/import/SKILL.md` end to end. Confirm:
- Steps 2, 3, and 4 still pass `--workspace <workspace-name>` — the value Step 1 now produces — with no contradictory wording.
- The claim about the dry-run error matches reality: `resolveWorkspaceId` in `scripts/lib.mjs` throws `Unknown workspace "<name>"`, and the import runs the resolver during `--dry-run`. If the wording drifts from the actual error text, align the prose to the code.

- [ ] **Step 3: Validate the skill**

Run `/validate-skills` (scoped to the import skill) in Claude Code.
Expected: no `[FAIL]` items for `plugins/multica-tool/skills/import/SKILL.md`. Fix any that appear.

- [ ] **Step 4: Commit**

```bash
git add plugins/multica-tool/skills/import/SKILL.md
git commit -m "feat(multica-tool): default import target workspace to bundle folder basename

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Plugin-level validation

**Files:**
- None modified (validation only; apply fixes only if a `[FAIL]` surfaces).

**Interfaces:**
- Consumes: the two edited `SKILL.md` files from Tasks 1–2.
- Produces: a clean `plugin-validator` run for the `multica-tool` plugin.

- [ ] **Step 1: Run the plugin-validator agent**

Invoke the `plugin-validator` agent (or `/plugin-validator`) against `plugins/multica-tool/`.
Expected: no `[FAIL]` items. This is the project's required post-implementation gate for any plugin change.

- [ ] **Step 2: Apply any proposed fixes**

If the validator reports `[FAIL]` items, apply the proposed fixes (staying inside `plugins/multica-tool/`), then re-run until clean.

- [ ] **Step 3: Commit any fixes**

Only if Step 2 changed files:

```bash
git add plugins/multica-tool/
git commit -m "fix(multica-tool): resolve plugin-validator findings for default-folder skills

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Export default `export/<workspace-name>` (all/projects) + nested `export/<workspace-name>/<slug>-<type>` (single) → Task 1. ✓
- Workspace-name resolution (named workspace, else `workspace get`) → Task 1. ✓
- Import default target workspace = folder basename → Task 2. ✓
- Non-goals (no script/manifest/sync changes) → enforced by Global Constraints and task file lists. ✓
- Verification (`/validate-skills`, `plugin-validator`) → Tasks 1–3. ✓

**Placeholder scan:** No TBD/TODO; every edit shows exact old + new prose. ✓

**Type consistency:** `<workspace-name>`, `<slug>`, `<type>`, `--out`, `--workspace`, `--dir` used consistently across tasks and match the scripts' argument names. ✓
