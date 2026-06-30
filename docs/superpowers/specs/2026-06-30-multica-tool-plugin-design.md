# multica-tool plugin — design

**Date:** 2026-06-30
**Status:** Approved (design phase)

## Purpose

A new marketplace plugin `multica-tool` that exports Multica skills, agents, and squads
to a local folder and imports them back — primarily to **migrate resources between
Multica workspaces**. Export is selective (skill / agent+skills / squad+all); import
replays the whole exported folder into a target workspace.

Backed by the `multica` CLI (https://multica.ai/docs/cli), already installed at
`/opt/homebrew/bin/multica`.

## Key constraints discovered

The `multica` CLI has **no native export command**. Export is composed from read
commands; import from create/link commands:

| Resource | Export (read → files) | Import (files → platform) |
|----------|-----------------------|---------------------------|
| Skill | `skill get <id>` *(includes files)* | `skill create` + `skill files upsert` (or `skill update` if exists) |
| Agent | `agent get <id>` + `agent skills list <id>` | `agent create`/`update` + `agent skills set` |
| Squad | `squad get <id>` + `squad member list <id>` | `squad create`/`update` + `squad member add` |

Two consequences shape the design:

1. **Re-created resources get new IDs.** A link graph captured by ID is meaningless after
   import (and across workspaces). All wiring is resolved by **name**.
2. **`agent create` requires `--runtime-id`**, which is workspace-specific and not portable
   content. It must be remapped on import.

## Central invariants

- **Name is the identity key** for all three resource types. Matching on import is by
  **exact name**.
- **Import is idempotent.** If a resource with the same name exists in the target, it is
  **updated in place** (preserving its ID and existing bindings); otherwise created.
  Re-running import never produces duplicates.
- **Links resolved by name, never by source ID.** Import builds a `name → newId` map per
  resource type and uses it to wire `agent skills set`, squad leader, and squad members.

## Decisions (from brainstorming)

- **Layout:** directory tree + `manifest.json`.
- **Runtime ID:** captured on export; on import the user is prompted to map each distinct
  source runtime to a target runtime. Never invented.
- **Conflicts:** overwrite/update existing (by name).
- **Selection:** export takes args if given, else interactive list-and-pick; import targets
  a whole folder.
- **Logic split (approach A):** script-backed skills. Deterministic work (graph walk,
  manifest build, ID remapping, conflict resolution) lives in Node helpers; the model drives
  interaction (scope pick, runtime remap, workspace confirm). Node chosen — native JSON, no
  `jq` dependency.

## Components

```
plugins/multica-tool/
  .claude-plugin/plugin.json
  skills/export/SKILL.md      # drive scope pick → call exporter → report
  skills/import/SKILL.md      # point at folder → confirm workspace → remap runtimes → call importer → report
  scripts/multica-export.mjs  # graph walk + write dir tree + manifest
  scripts/multica-import.mjs  # read manifest + remap IDs + replay (idempotent upsert by name)
  scripts/lib.mjs             # shared: CLI runner (injectable), JSON helpers, slugify
```

Invokable as `/multica-tool:export` and `/multica-tool:import`. No separate command files —
skills are directly invokable.

## Export folder layout

```
<export-dir>/
  manifest.json
  skills/
    <skill-slug>/
      SKILL.md          # skill content (SKILL.md body)
      config.json       # skill config
      <other files>     # any extra files from `skill get` files[], at their paths
  agents/
    <agent-slug>.json
  squads/
    <squad-slug>.json
```

`<slug>` is a filesystem-safe slug of the resource name; the manifest holds the real name.

## Manifest schema (`manifest.json`)

```json
{
  "version": "1",
  "scope": "squad | agent | skill",
  "sourceWorkspaceId": "ws_...",
  "skills":  [{ "name": "...", "dir": "skills/<slug>", "sourceId": "sk_..." }],
  "agents":  [{ "name": "...", "file": "agents/<slug>.json",
               "sourceRuntimeId": "rt_...", "skillNames": ["..."] }],
  "squads":  [{ "name": "...", "file": "squads/<slug>.json",
               "leaderName": "...", "members": [{ "agentName": "...", "role": "..." }] }]
}
```

`sourceId` / `sourceWorkspaceId` are retained for debugging only. All import wiring is by name.

## Agent file (`agents/<slug>.json`)

Captures: `name`, `description`, `instructions`, `model`, `visibility`,
`maxConcurrentTasks`, `runtimeConfig`, `customArgs`, `sourceRuntimeId`, `skillNames[]`.

**Secrets (`customEnv`) are NOT written to disk** — see Error handling.

## Squad file (`squads/<slug>.json`)

Captures: `name`, `description`, `instructions`, `leaderName`, `members[] {agentName, role}`.

## Export data flow

1. Verify auth (`multica auth status`). Resolve workspace (current, or `--workspace-id`).
2. Determine scope + resource: use args if provided, else `skill/agent/squad list` and
   prompt the user to pick.
3. Walk the dependency graph (dedup shared skills):
   - `skill` scope → just that skill.
   - `agent` scope → agent + `agent skills list` → its skills.
   - `squad` scope → `squad get` + `squad member list` → each member agent → each agent's
     skills.
4. For each skill: `skill get <id>` → write `SKILL.md`, `config.json`, and any extra files.
5. For each agent: `agent get <id>` → write `agent.json`, redacting `customEnv`; record
   `skillNames` and `sourceRuntimeId`.
6. Write `squad.json` (if applicable) and `manifest.json`.

## Import data flow (replay whole folder, idempotent)

1. Read `manifest.json` from the given folder. Confirm the **target workspace**.
2. **Runtime remap:** collect distinct `sourceRuntimeId`s → `multica runtime list` → prompt
   the user to map each to a target runtime. Abort if any is left unmapped.
3. **Skills first:** for each, look up by exact name in `skill list`.
   - Exists → `skill update` content/config + `skill files upsert` for each file (in-place,
     preserves ID and bindings).
   - Missing → `skill create` + `skill files upsert`.
   - Build `skillName → newId`.
4. **Agents:** look up by name. Create (with remapped `--runtime-id`) or update. Then
   `agent skills set <id> --skill-ids <mapped newIds>` (replaces assignments to match export).
5. **Squad:** look up by name. Create with mapped leader or update. Then reconcile members:
   `squad member add` for each manifest member (mapped agent id + role); members are matched
   by agent name so re-runs don't duplicate.
6. Report: created vs updated counts per type, the `name → newId` maps, unmapped runtimes
   (if aborted), and any secrets the user must re-set.

## Error handling (fail loud)

- Not authenticated → stop; instruct `multica login`. No partial work.
- **Secrets:** `customEnv` values are never written to export files. Export warns when an
  agent has custom env; import reminds the user to set them on the target via
  `multica agent env <slug>`.
- Unresolvable / unmapped runtime on import → stop and prompt; never invent an ID.
- Missing referenced resource during export → abort naming the resource; no silent partial.
- **Duplicate names already in the target** (same name on >1 existing resource) → abort with
  the name; do not guess which to update.
- Any CLI non-zero exit → surface stderr and stop; report what was already done.

## Testing (`tests/multica-tool/`)

Scripts accept an **injectable CLI runner**, so tests mock `multica` with canned JSON
fixtures. Coverage (each test encodes *why* it matters):

- Manifest is built correctly from sample `get` output (graph walk, skill dedup).
- **Links are rewired by name** — a fixture where source IDs differ from target IDs fails if
  wiring regresses to copying source IDs.
- **Idempotency** — running import twice updates (one resource) rather than duplicating.
- Overwrite path calls `update` (not a second `create`) when a name already exists.
- Runtime remap is applied to `agent create --runtime-id`.
- Secrets (`customEnv`) never appear in written export files.

Run: `node --test tests/multica-tool/*.test.mjs`.

## Marketplace wiring (one commit)

Per repo CLAUDE.md, adding the plugin updates together:
1. `plugins/multica-tool/.claude-plugin/plugin.json`
2. `.claude-plugin/marketplace.json` → `plugins[]` entry
3. `README.md` → Plugins table row
4. Run `/validate-skills` and the `plugin-validator` agent; fix all `[FAIL]` items.

## Out of scope (YAGNI)

- No sync/diff/merge — import is replay-with-update, not three-way merge.
- No secret migration — secrets are re-set manually on the target.
- No selective import (pick subset of a folder) — import replays the whole bundle.
- No support for projects/issues/labels/autopilots — only skills, agents, squads.
