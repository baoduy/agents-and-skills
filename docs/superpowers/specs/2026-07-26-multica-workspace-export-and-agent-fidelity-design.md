# Multica whole-workspace export + agent field fidelity — design

**Date:** 2026-07-26
**Plugin:** `plugins/multica-tool`
**Status:** approved (brainstorming)

## Problem

Two gaps in the current export/import/sync tooling:

1. **Field fidelity.** A re-validation of the export JSON against live Multica
   values found the agent exporter misses two fields the CLI *can* restore:
   - `service_tier` — the Codex execution service tier (`--service-tier` on
     `agent create`/`update`). Empty for Claude agents, meaningful for Codex.
   - `permission_mode` + `invocation_targets` — today only the legacy
     `visibility` field is captured, which cannot express **member-specific**
     `public_to` sharing (visibility is a two-value private/workspace legacy
     field).

   Skills and squads were audited and are already complete — only
   timestamps/identity/derived fields are (correctly) skipped.

2. **Whole-workspace export.** Export is currently single-root-scoped
   (`--scope skill|agent|squad --id <one>`). To back up an entire workspace a
   user must run many exports into separate folders, and resources shared across
   roots (a skill on many agents, an agent on many squads) get **duplicated
   across those folders**. Within a single export the bundle is already 3 flat,
   deduped folders (`skills/`, `agents/`, `squads/`) with references by name —
   so the fix is a new multi-root mode, not a structural change.

## Non-goals (YAGNI)

- No `--scope all` for **sync** — per-resource sync is unchanged. (Can be added
  later if needed.)
- No restore of fields with no CLI setter: `disabled_runtime_skills`,
  `runtime_mode`, `status`. Documented as intentionally skipped.
- No manifest schema/version change — the on-disk format already supports what
  we need.

## Part A — `--scope all` whole-workspace export

### Export (`scripts/multica-export.mjs`, `scripts/lib.mjs`)

- New scope `all` (no `--id`): collect **every** resource:
  - skills: `listSkills` → `getSkill` for each
  - agents: `listAgents` → `collectAgent` for each (custom_env + provider as today)
  - squads: `listSquads` → `getSquad` + members for each; collect each squad's
    leader and member agents (deduped into the shared agent map)
- Generalize the internal single `squad` value into a `squads[]` array.
  `buildManifest`'s `squad` parameter becomes `squads` (array).
- **On-disk format unchanged:** `manifest.squads` is *already* an array
  (`squads: squad ? [{…}] : []`). Whole-workspace export just populates more
  entries. Old single-resource bundles remain valid; manifest `version` stays
  `"1"`.
- The existing write loop already iterates `manifest.squads`, so no change there.
- **Dedup is inherited:** the name-keyed `skills`/`agentsById` Maps already
  collect a shared skill/agent exactly once. An agent in three squads produces
  one `agents/<slug>.json`, referenced by name from each squad.
- `main()`: accept `--scope all`; require `--id` only for skill/agent/squad.

### Import (`scripts/multica-import.mjs`)

- `importBundle` currently imports only `manifest.squads[0]`. Change to **loop
  every squad**. All agents are created before squads (unchanged ordering), so
  each squad resolves its leader/members from the complete `agentIdMap`.
- Return `squadIdMap` (name→id) plus aggregated `created`/`updated` counts,
  replacing the single `squadId`.

### Sync (`scripts/multica-sync.mjs`)

Unchanged — still per-resource (`<type> <name> from <src> <dest>`).

## Part B — agent field fidelity

### Export (`scripts/lib.mjs` `getAgent`)

Add to the allow-list: `service_tier`, `permission_mode`, `invocation_targets`.
They flow into the exported record through `redactAgent`'s `...rest` spread (no
change to `redactAgent` needed — none of the three is in its destructure list).

### Import (`scripts/multica-import.mjs` `importAgents`)

- **`service_tier`:** `if (rec.service_tier) common.push("--service-tier", rec.service_tier)`
  — only when non-empty (empty inherits, matching the existing optional-flag
  pattern for `model`/`thinking_level`).
- **`permission_mode`:** keep the existing `--visibility` create/update flag
  exactly as-is — it already round-trips `private` and workspace-wide
  `public_to`. Add work only for the case `visibility` cannot express,
  **member-specific** sharing:
  - When `permission_mode === "public_to"` **and** `invocation_targets` contains
    `target_type === "user"` entries: after the create/update, list the
    destination `workspace member list`, keep only target_ids that appear as a
    member `user_id`, and issue an isolated follow-up
    `agent update <id> --public-to-member <id>…` (repeatable). This mirrors the
    existing mcp_config/custom_env follow-up pattern. `--public-to-member` is
    authoritative and sets `public_to` regardless of what `--visibility` set.
  - Pure workspace-wide `public_to` (only a `workspace`-type target) needs **no**
    extra call — `--visibility workspace` already covers it.
  - The follow-up is wrapped in try/catch:
    - CLI rejects → `permissionApplyFailures.push(name)`.
    - No target resolves in the destination → skip the call,
      `permissionUnsupported.push(name)`.
  - The destination member list is fetched **once** and memoized (only when at
    least one agent needs it), like the lazy `providerById` in export.

### Reporting

`importAgents` and `importBundle` return two new arrays: `permissionApplyFailures`
and `permissionUnsupported`. The three SKILL.md report sections (import, sync)
surface them verbatim, alongside the existing secrets/avatar warnings.

## Testing

Unit (node --test, injected `cli`/`fs`, no network):

- **Export `all`:** two squads sharing an agent → exactly one `agents/<slug>.json`,
  referenced by name from both squad entries; all skills/agents/squads present;
  new fields (`service_tier`, `permission_mode`, `invocation_targets`) present in
  the record.
- **buildManifest** with a `squads` array of length > 1.
- **Import multiple squads:** both created, shared agent created once, each squad
  resolves members from `agentIdMap`; `squadIdMap` returned.
- **service_tier:** flag passed when non-empty, omitted when empty.
- **Member-specific permission:** resolvable user targets → one
  `agent update --public-to-member` call with only the resolvable ids;
  unresolvable-only → no call + `permissionUnsupported`; workspace-type target →
  no follow-up call.

Live-CLI smoke (read-only): `--scope all` export of the real workspace — verify
skill/agent/squad counts, that a shared agent is written once, and that
`service_tier`/`permission_mode`/`invocation_targets` round-trip in the records.

## Files touched

- `plugins/multica-tool/scripts/lib.mjs` — `getAgent` allow-list.
- `plugins/multica-tool/scripts/multica-export.mjs` — `all` scope, `squads[]`,
  `buildManifest` signature.
- `plugins/multica-tool/scripts/multica-import.mjs` — loop squads, service_tier,
  permission follow-up, new report fields.
- `plugins/multica-tool/skills/{export,import,sync}/SKILL.md` — document
  `--scope all`, the new fields, and the new report warnings.
- `tests/multica-tool/{export,import,fixtures}.mjs` — new coverage.

Manifests, README, and `dist/` (gitignored, generated) need no change.
