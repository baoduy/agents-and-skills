# Multica-tool: default import/export folders

**Date:** 2026-07-30
**Status:** Approved (design)
**Scope:** Prose-only edits to `plugins/multica-tool/skills/export/SKILL.md` and `plugins/multica-tool/skills/import/SKILL.md`. No `.mjs` script changes, no new CLI flags, no manifest changes.

## Problem

Users must always spell out where an export lands and which workspace an import targets. Two sensible defaults are missing:

- **Export:** "export all from `<workspace>`" with no destination should default to `export/<workspace-name>`.
- **Import:** "import all from `<path>/<folder-name>`" with no workspace named should default the target workspace to `<folder-name>`.

These two defaults are symmetric: an export written to `export/<workspace-name>` re-imports back into workspace `<workspace-name>` with no extra arguments.

## Design

### Export — default output directory (`export/SKILL.md`, Step 3)

Replace the current default (`./multica-export-<slug>-<type>`) with a workspace-rooted default. Applied **only when the user gives no output directory**; an explicit directory still wins.

1. **Resolve `<workspace-name>`:**
   - If the user named a source workspace (the value passed as `--workspace <name>`) → use that name.
   - Otherwise → run `multica workspace get --output json` and read `.name` (the current default workspace).
   - Slugify the name for filesystem safety, matching the existing `slugify` rules in `scripts/lib.mjs` (lowercase, runs of non-`[a-z0-9]` → single `-`, trim leading/trailing `-`).
2. **Construct the path by scope:**
   - `all` / `projects` (whole workspace) → `export/<workspace-name>`
   - single resource (`skill` / `agent` / `squad` / `project`) → `export/<workspace-name>/<slug>-<type>`, where `<slug>` is the slugified resource name and `<type>` is the resource type.

The computed path is passed to the export script as `--out`. The script is unchanged.

Examples:
- `export all from mx-workspace` → `export/mx-workspace`
- `export skill "Foo Bar" from mx-workspace` → `export/mx-workspace/foo-bar-skill`
- `export all` (no workspace named, current default is `mx-workspace`) → `export/mx-workspace`

### Import — default target workspace (`import/SKILL.md`, Step 1)

Currently Step 1 always asks the user to confirm the target workspace. New behavior:

- If the user named a target workspace → use it (unchanged).
- If the user did **not** name one → default the target workspace to the **basename of the import folder** (e.g. `import all from export/mx-workspace` → workspace `mx-workspace`). State the inferred workspace name to the user before proceeding.

The inferred name is passed to the import script as `--workspace`. The script is unchanged; the Step 2 dry-run already surfaces an `Unknown workspace "<name>"` error if the inferred workspace does not exist in the target account, so no extra validation is added in the skill.

## Non-goals

- The `sync` skill is untouched — it operates workspace→workspace with no folder involved.
- No changes to `manifest.json` (its `source_workspace_id` is a source ID, not the target; the import default deliberately derives from the folder basename, not the manifest).
- No new flags, no script logic — the defaults live entirely in skill prose that the agent follows when constructing `--out` / `--workspace`.

## Verification

- Re-read both edited `SKILL.md` files for internal consistency.
- Run `/validate-skills` against the two skills.
- Run the `plugin-validator` agent against `multica-tool`.
