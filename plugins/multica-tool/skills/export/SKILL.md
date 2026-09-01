---
name: export
description: Use when the user wants to export Multica skills, agents, squads, projects, or autopilots to a local folder for backup, version control, or cross-workspace migration. Supports whole-workspace exports by level (skill, agent, squad, project) or a single named resource.
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

## Step 2 — Pick a level, or a single resource

There are two ways to export, and they are mutually exclusive:

- **Whole workspace, by level** (`--level`) — the default shape. A level bundles its own tier plus every tier below it. Use this whenever the user asks for a workspace, a backup, or a migration.
- **One named resource** (`--scope <type> --id <id>`) — for a single skill, agent, squad, project, or autopilot.

### Levels

Lowest tier first; **the default level is `squad`**.

| `--level` | Object folders written |
|---|---|
| `skill` | `skills/` |
| `agent` | `skills/`, `agents/` |
| `squad` *(default)* | `skills/`, `agents/`, `squads/` |
| `project` | `skills/`, `agents/`, `squads/`, `projects/`, `autopilots/`, `labels/`, `properties/`, `mcp/` |

Notes on the tiers:

- **Project** carries portable project metadata (title, description, icon, priority, status, dates, lead mapping) plus its attached resource records — **never issues, never members**. Workspace issue **labels**, custom **properties**, and the workspace **MCP server roster** ride along at this level.
- **Autopilots** are bundled **only** at `--level project`. Every other level omits them.
- `--level skill` keeps every workspace skill, including ones no agent references. Every higher level prunes those orphans, since the agents are what reference them.

If the user asked for a single resource but did not name it, list the type and present a pick list:

```bash
multica <type> list --output json
```

Ask the user to select a resource by name. Resolve its `id` from the list output.

## Step 3 — Determine output directory

If the user specified an output directory, use it verbatim. Otherwise default to a workspace-rooted path.

First resolve `<workspace-name>`:

- If the user named a source workspace (the value you would pass as `--workspace <name>`), use that name.
- Otherwise, run `multica workspace get --output json` and take its `.name` (the current default workspace).

Slugify the resolved name for filesystem safety — lowercase it, replace each run of non-`[a-z0-9]` characters with a single `-`, and trim leading/trailing `-` (the same rule the scripts use internally).

Then construct the default directory:

- a whole-workspace export (`--level`) → `export/<workspace-name>`
- a single resource (`--scope <type> --id`) → `export/<workspace-name>/<slug>-<type>`, where `<slug>` is the slugified resource name and `<type>` is the resource type.

Examples: `export everything from mx-workspace` → `export/mx-workspace`; `export skill "Foo Bar" from mx-workspace` → `export/mx-workspace/foo-bar-skill`.

## Step 4 — Run the export

Whole workspace, by level (the default path — `--level` defaults to `squad`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-export.mjs" \
  --out <dir> \
  [--level skill|agent|squad|project] \
  [--workspace <workspace-name>]
```

One named resource:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-export.mjs" \
  --scope <skill|agent|squad|project|autopilot> \
  --id <id> \
  --out <dir> \
  [--workspace <workspace-name>]
```

`--scope` and `--level` are mutually exclusive; the script exits 1 if both are passed. `--id` is required with `--scope`.

A workspace export is one flat, deduped bundle: a skill, agent, or squad reached from several places is written exactly once and referenced by name.

Every export that reaches a resource with a dependency **bundles that dependency** so the bundle is self-contained — a squad's leader and members, a project's lead agent, an autopilot's assignee agent or squad, and every skill those agents use. On import, only `github_repo` project resources are portable and recreated; other resource types are reported and skipped.

### Folder layout

One flat folder per object type:

```
<dir>/
  manifest.json
  skills/<slug>/SKILL.md, config.json, <skill files…>
  agents/<slug>.json, <slug>.md, <slug>.description.md, <slug>.avatar.<ext>
  squads/<slug>.json, <slug>.md, <slug>.description.md
  projects/<slug>.json, <slug>.description.md
  autopilots/<slug>.json, <slug>.description.md
  labels/labels.json
  properties/properties.json
  mcp/servers.json
```

`manifest.json` points at `labels/`, `properties/` and `mcp/` via `labels_file`, `properties_file` and `mcp_servers_file` (with a matching `*_count`); the arrays themselves are no longer inline. Import still reads a pre-folder bundle that carried them inline.

### Issue labels, custom properties, and the MCP roster

`--scope project` and `--level project` also bundle the workspace's **issue labels**, **custom issue property definitions**, and the **workspace MCP server roster**, so a migrated project lands somewhere its issues can actually be labelled and filled in. All three are **workspace-scoped in Multica — there is no project-scoped label, property, or MCP server** — so what travels is the whole workspace's taxonomy, not a per-project subset. State that plainly to the user when they ask for "the project's labels".

Narrower selections (`skill`, `agent`, `squad`, `autopilot` scopes; `skill`/`agent`/`squad` levels) bundle none of the three — a single resource is not a workspace migration.

What travels, and what cannot:

- **Labels** — `name` and `color`. A label's `description` is captured in the bundle for review but **cannot be restored**: `label create`/`label update` expose no `--description` flag. Every affected label is listed in `labelDescriptionsNotPortable`.
- **Properties** — `name`, `type`, `description`, `icon`, `archived`, and each select option's `name` + `color`. Server-assigned `position` and `usage_count` are not bundled (no CLI setter). Option **ids** are deliberately dropped: `property update` re-matches options by name at the destination, which is also how issue values reference them.
- Archived property definitions **are** included (`property list --include-archived`), so a retired definition arrives retired instead of reappearing in every picker.
- **MCP servers** — `name` and `transport` only. A server's entry JSON (command/args/env, and any token inside it) is **write-only in the CLI**: `workspace mcp add`/`update` accept it, and nothing reads it back. So `mcp/servers.json` is a roster, not a copy — every entry is listed in `mcpServerConfigsNotPortable`, and each must be re-added by hand at the destination before agent assignments can attach to it.

Every agent record also carries `mcp_servers` — which workspace MCP servers that agent uses, as `{name, enabled}`. This is separate from the agent's own inline `mcp_config`. Import re-links them by name against the destination library.

The script writes `manifest.json`, skill `SKILL.md` files, agent JSON files, and squad JSON files into `<dir>`. Every resource's prose fields are externalized to sibling Markdown files, never embedded in the JSON — so they are easy to read, diff, and edit:

- **instructions** (system prompt / charter, agents and squads) → `<slug>.md`, referenced by an `instructions_file` key.
- **description** (agents, squads, projects, autopilots) → `<slug>.description.md`, referenced by a `description_file` key.

An empty field gets no file and no `*_file` key. Skills keep their own layout — the description lives in `SKILL.md` frontmatter and the body is the content.

Avatars are captured automatically: an agent's uploaded-image avatar is downloaded into the bundle (`agents/<slug>.avatar.<ext>`) and referenced by `avatar_file`; emoji avatars (agents and squads) and a squad's avatar are recorded as the `avatar_url` string.

Exporting `--scope autopilot` bundles the autopilot configuration **and its assignee** (an agent, or a squad with its members and their skills), so the bundle imports on its own. The assignee is linked by name (`assignee_type` + `assignee_name`); import resolves that name against the bundle first, then the destination workspace. An autopilot's `status` is captured, but **every imported autopilot lands paused** regardless — the ones that were live at the source are listed in `autopilotsActiveAtSource` so they can be re-activated deliberately. The bundle also captures the schedule and webhook triggers, the target project's **title** (not its ID — resolved by name on import) when one is set, and human subscribers' **names** (not their IDs). A webhook trigger's secret (URL/token) is **never** written to the bundle — only that it exists (its label); a fresh secret is issued on import.

## Step 5 — Report results

Parse the JSON output from the script and report:

- Directory written to.
- The level (or the single resource) exported.
- Count of skills, agents, squads, projects, and autopilots exported.
- If `pruned_skills` is non-empty, note it: "Pruned N orphan skill(s) not linked to any agent: `<name>`, …" (these are standalone workspace skills that no exported agent references — only `--scope all` produces them).
- If `warnings` is non-empty, surface every agent name verbatim with this message: "WARNING: the following agents' exported files contain custom environment variables or MCP config in PLAINTEXT — treat the export directory as sensitive (avoid committing it to a public repo, restrict file permissions, delete it once the import is done): `<agent-name>`."
- If `autopilotWebhookTriggers` is non-empty, surface every autopilot title verbatim with: "NOTE: the following autopilots have a webhook trigger — its secret was NOT exported; a newly issued URL will be created on import: `<autopilot-title>`."
- Count of labels and custom properties bundled (`manifest.labels.length`, `manifest.properties.length`), noting that both are workspace-wide, not project-specific.
- If `autopilotsActiveAtSource` is non-empty, surface every title verbatim with: "NOTE: the following autopilots were ACTIVE at the source; every imported autopilot lands paused — re-activate each one deliberately with `multica autopilot update <id> --status active`: `<autopilot-title>`."
- If `mcpServerConfigsNotPortable` is non-empty, surface every server name verbatim with: "NOTE: the following workspace MCP servers travelled by name and transport only — the CLI never returns a server's config on read, so re-add each one at the destination (`multica workspace mcp add <name> --server-config ...`) before importing the agents that use it: `<server-name>`."
- If `labelDescriptionsNotPortable` is non-empty, surface every label name verbatim with: "NOTE: the following labels have a description that the multica CLI cannot set on import (`label create`/`update` have no `--description` flag) — re-enter it in the Multica UI at the destination: `<label-name>`."
