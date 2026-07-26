# multica-tool: snake_case bundle format (match multica CLI) — design

**Date:** 2026-07-26
**Status:** Approved (design phase)
**Extends:** `2026-06-30-multica-tool-plugin-design.md`

## Purpose

`multica agent get <id>` (and every other multica CLI `get`/`list` command) returns
snake_case JSON (`max_concurrent_tasks`, `runtime_config`, `runtime_id`, `has_custom_env`,
`mcp_config`, `leader_id`, `member_id`, ...). Today `lib.mjs`'s get-wrappers deliberately
translate this into camelCase before it reaches the rest of the tool, and every bundle file
(`manifest.json`, `agents/*.json`, `skills/*.json`, `squads/*.json`) is written in camelCase.
Round-tripping a resource therefore means: raw CLI snake_case → camelCase (export) →
snake_case CLI flags again (import) — a translation with no purpose other than historical
convention, and one more thing to keep in sync by hand whenever a new field is added.

This design drops the translation: bundle files use the same snake_case field names as the
multica CLI, end to end.

## Scope decisions

1. **All three resource types (agents, skills, squads), not just agents.** Skills/squads
   already have few or no camelCase-only fields, but partial consistency (agents snake_case,
   everything else camelCase) would be worse than the status quo — every future field
   addition would require remembering which convention applies where.
2. **Synthesized (non-CLI) fields also become snake_case** — `source_id`,
   `source_runtime_id`, `source_runtime_provider`, `skill_names`, `had_secrets`,
   `leader_name`, `agent_name`, `source_workspace_id`. These don't come from the CLI at all
   (they're the tool's own bookkeeping — id remapping, name lookups, secret flags), but they
   live in the same bundle files as the CLI-passthrough fields. One convention for the whole
   file beats "CLI fields are snake_case, ours are camelCase" as a rule contributors have to
   remember per-field.
3. **Out of scope: the scripts' own report output.** `exportResource`/`importBundle`'s return
   value — `created`, `updated`, `mentionsRewritten`, `skillIdMap`, `agentIdMap`, `squadId`,
   `secretsReminder`, `secretsApplyFailures` — is printed to stdout for the calling agent to
   parse and report to the user. It never round-trips through the multica CLI and isn't
   persisted to a bundle file, so renaming it wouldn't reduce any transform effort — it would
   be pure churn. Stays camelCase.
4. **Clean break, no back-compat.** Import only understands the new snake_case bundle
   format. A bundle exported before this change must be re-exported; there is no dual-format
   detection in `importBundle`/`importSkills`/`importAgents`/`importSquad`.
5. **JS local variable and function names are unaffected — only serialized object keys
   change.** The codebase's JS convention is camelCase identifiers (Rule 11: match the
   codebase's own conventions). E.g. `collectAgent` keeps a local `const skillNames = ...`,
   but writes it into the record as `skill_names: skillNames` rather than the `{ skillNames }`
   shorthand. This is a wire-format change, not a JS style change.

## Data flow

### `lib.mjs` get-wrappers

Still the single seam that knows the raw CLI field names (an explicit allow-list, so
unexpected/internal CLI fields don't leak into a bundle) — they just stop renaming keys:

- `getAgent`: returns `id, name, description, instructions, model, visibility,
  max_concurrent_tasks, runtime_config, custom_args, thinking_level, runtime_id,
  has_custom_env, mcp_config, mcp_config_redacted, skills`.
- `getSquad`: returns `id, name, description, instructions, leader_id`.
- `getSquadMembers`: returns `member_id, member_type, role`.
- `getSkill`, `getAgentCustomEnv`: unchanged (already snake_case-compatible — no
  camelCase-only fields to begin with).

### `multica-export.mjs`

- `redactAgent`: destructures `has_custom_env, mcp_config_redacted,
  custom_env_fetch_failed, mcp_config, custom_env, skills, runtime_id` off the normalized
  agent; the `record` it returns carries `source_id, source_runtime_id, skill_names,
  mcp_config, custom_env, had_secrets` plus the untouched passthrough fields (`...rest`).
- `collectAgent`: attaches `a.source_runtime_provider`, `a.custom_env`,
  `a.custom_env_fetch_failed` (renamed from the camelCase equivalents); gates the audited
  `agent env get` call on `a.has_custom_env`.
- `buildManifest`: manifest agent entries use `source_id, source_runtime_id,
  source_runtime_provider, skill_names, had_secrets`; manifest squad entry uses
  `leader_name`, and each member uses `agent_name, role`; manifest top level uses
  `source_workspace_id`.

### `multica-import.mjs`

- `importAgents`: reads `rec.max_concurrent_tasks, rec.runtime_config, rec.custom_args,
  rec.thinking_level, rec.source_runtime_id, rec.mcp_config, rec.custom_env,
  rec.skill_names, rec.source_id` (still mapped to the same `--max-concurrent-tasks` etc.
  CLI flags — flag names don't change, only the JSON keys they're read from).
- `rewriteAgentMentions`, `importSquad`, `resolveRuntimeMap`/`collectRuntimeProviders`:
  same mechanical rename of every `rec.*`/`a.*`/`squad.*`/`m.*` property access touched
  above (`sourceRuntimeId` → `source_runtime_id`, `leaderName` → `leader_name`,
  `agentName` → `agent_name`, etc.).

### `multica-sync.mjs`

No changes — it only calls `exportResource`/`importBundle` through a temp directory using
whatever bundle format those two produce.

## Manifest / bundle schema (after)

```json
// agents/<slug>.json
{
  "name": "...", "description": "...", "instructions": "...", "model": "...",
  "visibility": "...", "max_concurrent_tasks": 6, "runtime_config": {}, "custom_args": [],
  "thinking_level": "", "source_id": "ag_...", "source_runtime_id": "rt_...",
  "skill_names": ["..."], "mcp_config": null, "custom_env": null, "had_secrets": false
}
```

```json
// manifest.json (excerpt)
{
  "version": "1", "scope": "agent", "source_workspace_id": "ws_...",
  "agents": [{ "name": "...", "file": "agents/....json", "source_id": "...",
               "source_runtime_id": "...", "source_runtime_provider": "claude",
               "skill_names": ["..."], "had_secrets": false }],
  "squads": [{ "name": "...", "file": "squads/....json", "description": "...",
               "instructions": "...", "leader_name": "...",
               "members": [{ "agent_name": "...", "role": "leader" }] }]
}
```

## Testing (`tests/multica-tool/`)

No new test cases — this changes field *names* asserted by existing tests, not behavior.

- `fixtures.mjs`: already mocks raw CLI responses in snake_case (unaffected).
- `lib.test.mjs`, `export.test.mjs`, `import.test.mjs`: update every expected-field-name
  string in assertions from camelCase to snake_case (~69 occurrences across the three
  files, mechanical).
- `sync.test.mjs`: no field-name assertions of its own — unaffected unless it inlines any
  bundle-shaped fixture data (verify while editing).

Run: `node --test tests/multica-tool/*.test.mjs`.

## Docs

- `skills/import/SKILL.md`, `skills/sync/SKILL.md`: the two prose mentions of
  `sourceRuntimeId` become `source_runtime_id`.

## Out of scope (YAGNI)

- No back-compat/dual-format reading in import (scope decision #4).
- No renaming of the scripts' own stdout report schema (scope decision #3).
- No change to CLI flag names passed to `multica` (e.g. `--max-concurrent-tasks`) — those
  were never camelCase to begin with; only the JSON field names being read/written change.
- No change to `multica-sync.mjs` — it has no bundle-shaped literals of its own.
