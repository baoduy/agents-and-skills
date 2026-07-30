# Multica project export / import / sync + selective import

**Date:** 2026-07-30
**Plugin:** `plugins/multica-tool/`
**Status:** approved design

## Goal

Extend the multica-tool migration bundle to carry **projects** (metadata only —
no issues) and the **project → agent-lead** mapping, and make **import
selective**: the user picks which resource types to import, with an
incompatibility pre-flight surfaced before any write.

Two user-approved decisions frame the work:

- **A.** Exporting a project also **bundles its lead agent** (like squads bundle
  their leader), so a projects-only bundle is self-contained and importable
  anywhere.
- **B.** Import is best-effort: "import as much as possible, other info can be
  updated directly on the UI." Incompatible fields are recorded + reported, never
  fatal.

## Domain facts (verified against `multica` 0.4.14)

Project record (`project list`/`get --output json`):
`id, title, description, icon, priority, status, due_date, start_date,
lead_id, lead_type, done_count, issue_count, resource_count, created_at,
updated_at, workspace_id`.

- `lead_type` is `"agent"`, `null`, or (potentially) a member/user type.
- Projects do **not** embed issues — only `issue_count` — so "metadata only
  without issues" needs no special filtering.

Write-side CLI:
- `project create --title <req> [--description --icon --status --due-date
  --start-date --lead <name> --repo <url>...]` — **lead is set by NAME** (member
  or agent), not id. Returns JSON with `id`.
- `project update <id> [--title --description --icon --status --due-date
  --start-date --lead <name>]`.
- `project resource add <id> --type <type> --url <url> [--label <label>]` —
  `github_repo` carries `resource_ref.url`; `local_directory` carries a
  machine-specific `daemon-id`/path.
- `project resource list <id> --output json` → `[{resource_type, resource_ref,
  label, position, ...}]`.
- **No `--priority` flag** on create/update — `priority` is readable but not
  settable.

## Known limitations (warn-and-continue, per decision B)

1. **priority** does not round-trip (no CLI setter). Recorded in JSON; projects
   with non-`none` priority reported as `priorityUnsupported`.
2. Only **`github_repo`** resources are portable. Other resource types
   (`local_directory`, …) are recorded in JSON but not recreated; reported as
   `resourcesUnsupported`.
3. Non-agent (user) **leads** are recorded (`lead_type` + raw id) but not
   re-applied on import (only agent leads round-trip). Reported as
   `leadUnresolved` when a lead cannot be set.

## Export design

### lib.mjs
Add three thin wrappers next to the existing list/get helpers, mirroring their
allow-list style:
- `listProjects(cli)` → `cli.json(["project","list"])`.
- `getProject(cli, id)` → normalized `{ id, title, description, icon, priority,
  status, due_date, start_date, lead_id, lead_type }` (drop counts/timestamps —
  they are source-workspace state, not portable metadata).
- `getProjectResources(cli, id)` → `[{ resource_type, resource_ref, label }]`.

### multica-export.mjs
- New scopes: `--scope projects` (all) and `--scope project --id <id>` (one).
  `--scope all` also collects every project.
- `collectProject(cli, id, agentsById, skills, providerById)`:
  1. `getProject`.
  2. Resolve the lead: when `lead_type === "agent"`, call
     `collectAgent(cli, lead_id, …)` (bundles the lead agent — decision A) and
     record `lead_name = <agent name>`, `lead_source_id = lead_id`. Otherwise
     `lead_name = null`, keep `lead_type` + `lead_source_id`.
  3. `getProjectResources`.
  4. Return `{ title, description, icon, priority, status, due_date,
     start_date, source_id: id, lead_type, lead_name, lead_source_id,
     resources }`.
- `buildManifest` gains a `projects` array:
  `[{ title, file: "projects/<slug>.json", source_id, lead_name, lead_type }]`.
- Write each project record to `projects/<slug>.json` (description stays inline —
  it is a short metadata field, not long-form instructions, so no sibling `.md`).

Scope wiring in `exportResource`:
```
else if (scope === "project")  projects.push(collectProject(cli, ids.projectId, …));
else if (scope === "projects") for (const p of listProjects(cli)) projects.push(collectProject(cli, p.id, …));
// scope "all": add the same listProjects loop after the squads loop
```

## Import design

### Selective import (`--include`)
- New flag `--include <csv>` over the user-facing set `{agents, squads,
  projects}`. **Default (flag omitted): `agents,squads`.** Projects are opt-in.
- `skills` are a dependency of `agents`: imported whenever `agents` is included,
  never a separate toggle.
- `importBundle({ cli, dir, runtimeMap, include, fs })` filters each section by
  `include`; a section absent from `include` is skipped entirely.

### Pre-flight (`--dry-run`)
- New flag `--dry-run`: read the manifest, compute a report, print JSON, **write
  nothing**. Report shape:
  ```
  {
    bundle:     { skills, agents, squads, projects },   // counts present in bundle
    willImport: { skills, agents, squads, projects },   // counts after --include filter
    runtimes:   { resolved: [...], unresolved: [...] }, // from resolveRuntimeMap
    incompatibilities: [ { type, detail }, ... ],
    secretsReminder: [ agentName, ... ]
  }
  ```
- `incompatibilities` entries (only for types in `willImport`):
  - `unmapped-runtime` — a source runtime with no `--runtime-map` and no unique
    provider match (a **blocker**: import aborts before writes, as today).
  - `priority-not-settable` — projects with non-`none` priority.
  - `resource-not-portable` — projects with non-`github_repo` resources.
  - `lead-agent-missing` — projects whose `lead_name` is neither in the bundle's
    agents nor (advisory) guaranteed in the destination.

The **import skill** drives interaction: run `--dry-run`, present bundle contents
+ incompatibilities, ask which types to import (default agents+squads, projects
require explicit opt-in), then run the real import with `--include <selected>`.

### importProjects({ cli, manifest, dir, agentIdMap, fs })
For each `manifest.projects` entry, read `projects/<slug>.json`, then:
1. Match by **title** against `listProjects` (mirrors squad match-by-name):
   exists → `project update <id>`, else `project create`.
2. Metadata flags: `--title`, and `--description --icon --status --due-date
   --start-date` when present (omit empties so nothing is cleared unintentionally;
   dates only passed when non-null).
3. Lead: resolve `lead_name` against `agentIdMap` (just-imported) ∪ destination
   `listAgents`. If `lead_type === "agent"` and the name resolves, pass
   `--lead <lead_name>`. Otherwise skip and record `leadUnresolved`.
4. Resources: for each `github_repo` resource, `project resource add` if a
   resource with the same url is not already attached (idempotent). Non-
   `github_repo` → record `resourcesUnsupported`.
5. Record `priorityUnsupported` for non-`none` priority (never applied).
Returns `{ idMap, created, updated, priorityUnsupported, resourcesUnsupported,
leadUnresolved }`.

### Graceful degradation (decision B)
- `importSquad`: guard the leader lookup — if `agentIdMap.get(leader_name)` is
  undefined (e.g. agents deselected), **skip** the squad and record it in a new
  `squadsSkipped` list instead of issuing `squad create --leader undefined`.
  Same guard is already needed once agents become optional.
- `importProjects`: never throws on a missing lead or unsupported resource —
  create/update the project regardless and accumulate warnings.

### Ordering in importBundle
`skills → agents → mention-rewrite → squads → projects`. Projects last so the
lead agent exists. Each stage gated by `include`.

### Result payload additions
`importBundle` return gains: `created.projects`, `updated.projects`,
`projectIdMap`, `priorityUnsupported`, `resourcesUnsupported`, `leadUnresolved`,
`squadsSkipped`, and echoes the effective `include` set.

## Sync design (multica-sync.mjs)
- `resolveScopeId` gains `project`, resolved by **title** via `listProjects`.
- `sync()` derives the `include` set from the synced type so the bundled lead
  agent is imported alongside the project:
  - `skill` → `{skills}`; `agent` → `{agents}`; `squad` → `{agents,squads}`;
    `project` → `{agents,projects}`.
- Usage unchanged: `multica-sync.mjs project <title> from <src-ws> <dest-ws>`.

## Skill docs
- `skills/export/SKILL.md` — document `--scope projects` / `--scope project`,
  the `projects/` bundle files, and that a project export also bundles its lead
  agent.
- `skills/import/SKILL.md` — document the pre-flight → select → import flow:
  run `--dry-run`, present counts + incompatibilities, ask the user which types
  (default agents+squads; projects opt-in), then import with `--include`. Report
  `priorityUnsupported`, `resourcesUnsupported`, `leadUnresolved`, `squadsSkipped`.
- `skills/sync/SKILL.md` — add `project` as a syncable type.

## Testing (repo-root `tests/multica-tool/`)
Extend `fixtures.mjs` with `PROJECT_LIST`, `PROJECT_GET`, `PROJECT_RESOURCES`
(one `github_repo` + one non-portable resource, an agent lead, a non-`none`
priority) and a project whose lead is unset.

- **export.test.mjs**: `--scope project` bundles the lead agent + writes
  `projects/<slug>.json` with `lead_name`; manifest `projects` populated;
  `--scope all` includes projects; unset-lead project records `lead_name: null`.
- **import.test.mjs**: default include imports agents+squads but **not** projects;
  `--include agents,squads,projects` creates the project, sets `--lead` to the
  imported agent, recreates the `github_repo` resource, and reports
  `priorityUnsupported` + `resourcesUnsupported`; re-run is idempotent
  (update, no duplicate resource); a project with an unresolvable lead is created
  with `leadUnresolved` and no `--lead`; `--dry-run` writes nothing and returns
  the counts + incompatibilities; squad with a deselected leader lands in
  `squadsSkipped`.
- **sync.test.mjs**: `project <title>` resolves by title and imports with the
  agents+projects include set.
- **lib.test.mjs**: `getProject`/`getProjectResources` normalize to the
  allow-listed fields.

Tests assert **intent** (lead maps to the agent by name; priority is reported as
un-settable rather than silently dropped; default import excludes projects), not
just call shapes.

## Out of scope
- Exporting/importing project **issues** (explicitly excluded).
- Round-tripping **priority** and non-`github_repo` resources (CLI-limited).
- A standalone `skills` import toggle (skills follow agents).
