---
name: export
description: Use when the user wants to export Multica skills, agents, or squads to a local folder for backup, version control, or cross-workspace migration.
allowed-tools: Bash, Read
---

# export

Export a Multica resource (skill, agent, squad, project, or autopilot) to a local bundle directory.

## Step 1 — Verify authentication

Run `multica auth status` directly. The export script performs this same check internally before doing any work (via `requireAuth` in `scripts/lib.mjs`), but only after `--scope`/`--out` are supplied — so checking it here up front avoids masking an auth failure behind a later usage error:

```bash
multica auth status 2>&1 || true
```

If `multica login` is required, surface that message verbatim and stop.

## Step 2 — Determine scope and resource ID

If the user named a specific resource and type (`skill`, `agent`, `squad`, `project`, or `autopilot`), use those directly.

Otherwise, list available resources for the chosen type and present a pick list:

```bash
multica <type> list --output json
```

Ask the user to select a resource by name. Resolve its `id` from the list output.

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
- a single resource (`skill`, `agent`, `squad`, `project`, or `autopilot`) → `export/<workspace-name>/<slug>-<type>`, where `<slug>` is the slugified resource name and `<type>` is the resource type.

Examples: `export all from mx-workspace` → `export/mx-workspace`; `export skill "Foo Bar" from mx-workspace` → `export/mx-workspace/foo-bar-skill`.

## Step 4 — Run the export

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-export.mjs" \
  --scope <skill|agent|squad|project|projects|autopilot|all> \
  --id <id> \
  --out <dir> \
  [--workspace <workspace-name>]
```

`--id` is required for `skill`, `agent`, `squad`, `project`, and `autopilot` (a single named resource); it is **not needed** for `projects` (every project in the workspace) or `all` (the entire workspace). `all` does **not** include autopilots — an autopilot is always exported explicitly, by name, never auto-bundled.

Pass `--scope all` (with no `--id`) to export the **entire workspace** — every skill, agent, squad, and project — into one flat, deduped bundle. A skill or agent shared across many agents/squads is written exactly once and referenced by name.

Exporting a project (or `projects`/`all`) also **bundles the project's lead agent** so the bundle is self-contained; projects carry metadata only (title, description, icon, priority, status, dates, lead mapping) plus their attached resource records — never issues. On import, only `github_repo` resources are portable and recreated; other resource types are reported and skipped.

The script writes `manifest.json`, skill `SKILL.md` files, agent JSON files, and squad JSON files into `<dir>`. Each agent's and squad's **instructions** (system prompt / charter) are written to a sibling Markdown file — `agents/<slug>.md`, `squads/<slug>.md` — referenced by an `instructions_file` key in the JSON, so the prose is easy to read, diff, and edit. Agents/squads with no instructions get no `.md`.

Avatars are captured automatically: an agent's uploaded-image avatar is downloaded into the bundle (`agents/<slug>.avatar.<ext>`) and referenced by `avatar_file`; emoji avatars (agents and squads) and a squad's avatar are recorded as the `avatar_url` string.

Exporting `--scope autopilot` bundles the autopilot's **assignee** so the bundle is self-contained — an agent assignee (and its skills), or a squad assignee (its members, their skills, and the squad itself). It also captures the schedule and webhook triggers, the target project's **title** (not its ID — resolved by name on import) when one is set, and human subscribers' **names** (not their IDs). A webhook trigger's secret (URL/token) is **never** written to the bundle — only that it exists (its label); a fresh secret is issued on import.

## Step 5 — Report results

Parse the JSON output from the script and report:

- Directory written to.
- Count of skills, agents, squads, and projects exported.
- If `pruned_skills` is non-empty, note it: "Pruned N orphan skill(s) not linked to any agent: `<name>`, …" (these are standalone workspace skills that no exported agent references — only `--scope all` produces them).
- If `warnings` is non-empty, surface every agent name verbatim with this message: "WARNING: the following agents' exported files contain custom environment variables or MCP config in PLAINTEXT — treat the export directory as sensitive (avoid committing it to a public repo, restrict file permissions, delete it once the import is done): `<agent-name>`."
- If `autopilotWebhookTriggers` is non-empty, surface every autopilot title verbatim with: "NOTE: the following autopilots have a webhook trigger — its secret was NOT exported; a newly issued URL will be created on import: `<autopilot-title>`."
