# Plugin Workflow — CLAUDE.md Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `## Plugin Workflow` section to `CLAUDE.md` with three ordered sub-workflows: Create, Edit, and Delete a plugin.

**Architecture:** Single prose edit to `CLAUDE.md`. New section inserted after `## Working in this repo`. No code, no new files, no dependency changes.

**Tech Stack:** None — documentation edit only.

## Global Constraints

- Edit `CLAUDE.md` only. Do not touch any file under `plugins/`, `.claude/`, or any other path.
- Preserve all existing content verbatim — surgical insert only.
- House style: minimal diff, no scope creep.
- `AGENTS.md` is a symlink to `CLAUDE.md` — no separate edit needed.

---

### Task 1: Insert `## Plugin Workflow` section into `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (insert after the closing line of `## Working in this repo`, before `## Agent team best practices`)

**Interfaces:**
- Consumes: approved design at `docs/superpowers/specs/2026-06-25-plugin-workflow-claude-md-design.md`
- Produces: nothing consumed by other tasks

- [ ] **Step 1: Read CLAUDE.md to identify exact insertion point**

Run: `grep -n "## Agent team best practices" CLAUDE.md`
Expected: a line number (e.g. `41:## Agent team best practices`)
The new section goes immediately before that line.

- [ ] **Step 2: Insert the new section**

In `CLAUDE.md`, immediately before `## Agent team best practices`, insert:

```markdown
## Plugin Workflow

### Create a plugin

1. Create `plugins/<name>/` with `.claude-plugin/plugin.json` (`name`, `version: "0.1.0"`, `description`).
2. Add entry to `.claude-plugin/marketplace.json` → `plugins[]`.
3. Build plugin content inside `plugins/<name>/` (agents, skills, commands, scripts, etc.).
4. If any `SKILL.md` was added — run `/validate-skills` and fix all `[FAIL]` items.
5. Run `plugin-validator` agent — fix all `[FAIL]` items before continuing.
6. Update `README.md` — add row to the Plugins table.
7. Validate manifests:
   ```bash
   python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
   ```
8. Commit all files in one commit.

### Edit a plugin

1. Edit files inside `plugins/<name>/` only — no manifest or README changes unless renaming.
2. If any `SKILL.md` was added or changed — run `/validate-skills` and fix all `[FAIL]` items.
3. Run `plugin-validator` agent — fix all `[FAIL]` items before marking work done.
4. Commit.

### Delete a plugin

1. Remove `plugins/<name>/` directory.
2. Remove the entry from `.claude-plugin/marketplace.json`.
3. Remove the row from `README.md`.
4. Validate manifests (same command as Create step 7).
5. Commit all removals in one commit.

```

- [ ] **Step 3: Verify insertion looks correct**

Run: `grep -n "## Plugin Workflow\|## Agent team\|## Working in this repo" CLAUDE.md`
Expected output (line numbers will vary):
```
20:## Working in this repo
41:## Plugin Workflow
XX:## Agent team best practices
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Plugin Workflow section to CLAUDE.md (create, edit, delete)"
```
