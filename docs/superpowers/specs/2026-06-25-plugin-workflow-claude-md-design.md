# Plugin Workflow — CLAUDE.md Update Design

**Date:** 2026-06-25
**Scope:** Add a `## Plugin Workflow` section to `CLAUDE.md` with ordered steps for Create, Edit, and Delete. No code changes.

## Problem

Plugin development rules in `CLAUDE.md` are scattered across bullet points with no clear sequential ordering. Validation steps exist but are buried, leading to runtime "skill is invalid" errors when steps are skipped out of order.

## Design

Add a new `## Plugin Workflow` section immediately after `## Working in this repo`. Three sub-workflows:

### Create a plugin

1. Create `plugins/<name>/` with `.claude-plugin/plugin.json` (`name`, `version: "0.1.0"`, `description`)
2. Add entry to `.claude-plugin/marketplace.json` → `plugins[]`
3. Build plugin content inside `plugins/<name>/` (agents, skills, commands, scripts, etc.)
4. If any `SKILL.md` was added — run `/validate-skills` and fix all `[FAIL]` items
5. Run `plugin-validator` agent — fix all `[FAIL]` items before continuing
6. Update `README.md` — add row to Plugins table
7. Validate JSON: `python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"`
8. Commit all files in one commit

### Edit a plugin

1. Edit files inside `plugins/<name>/` only — no manifest/README changes unless renaming
2. If any `SKILL.md` was added or changed — run `/validate-skills` and fix all `[FAIL]` items
3. Run `plugin-validator` agent — fix all `[FAIL]` items before marking work done
4. Commit

### Delete a plugin

1. Remove `plugins/<name>/` directory
2. Remove entry from `.claude-plugin/marketplace.json`
3. Remove row from `README.md`
4. Validate JSON (same command as Create step 7)
5. Commit all removals in one commit

## Ordering rationale

- README update is after `plugin-validator` passes in the Create flow — no point documenting a broken plugin.
- `validate-skills` runs before `plugin-validator` — skills must be individually valid before the holistic agent check.
- JSON validation runs after README (last gate before commit) — catches manifest typos introduced during editing.

## What doesn't change

- The existing "Working in this repo" section stays as reference rules (constraints, edge cases, version policy). The new section is the ordered HOW; the existing section is the WHY.
- No code, no scripts, no new files beyond this CLAUDE.md addition.
