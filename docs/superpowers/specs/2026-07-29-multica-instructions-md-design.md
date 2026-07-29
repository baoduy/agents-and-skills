# Externalize agent & squad instructions to `.md` files

**Date:** 2026-07-29
**Plugin:** `multica-tool`
**Status:** approved design, pending implementation plan

## Problem

The `multica-tool` export bundle embeds an agent's `instructions` (its system
prompt) and a squad's `instructions` (its charter) as JSON string values inside
`agents/<slug>.json`, `squads/<slug>.json`, and the manifest's embedded
`squads[]` array. Long prose trapped in JSON is hard to read, review, and
enhance — newlines are escaped, diffs are noisy, and there is no way to edit the
prose as plain Markdown between an export and a re-import.

Skills already avoid this: they export as `SKILL.md` + `config.json`. This design
brings agents and squads in line for the `instructions` field only.

## Goal

Export each agent/squad `instructions` value to a sibling `.md` file for human
review and enhancement, removed from the JSON. Full round-trip: import reads the
instructions back from the `.md`, so edits to the `.md` take effect on the next
import or sync.

Non-goals: no change to skills (already `SKILL.md`); no other agent/squad fields
move out of JSON (`description`, `model`, etc. stay in JSON); no frontmatter in
the new `.md` (plain instructions body only).

## File layout

For an agent whose manifest `file` is `agents/<slug>.json`:

- `agents/<slug>.md` — the raw instructions, plain body, no frontmatter.
- `agents/<slug>.json` — the existing record with the `instructions` key removed.

For a squad whose manifest `file` is `squads/<slug>.json`:

- `squads/<slug>.md` — the raw instructions, plain body.
- `squads/<slug>.json` — the existing per-squad record with `instructions` removed.
- The manifest's embedded `squads[]` entries also drop `instructions`.

Conventions:

- The `.md` path is derived from the manifest `file` by replacing the `.json`
  suffix with `.md` (e.g. `agents/helper.json` → `agents/helper.md`), and the
  path is **recorded explicitly** so import knows where to look — mirroring the
  existing `avatar_file` pattern:
  - **Agents:** the per-agent JSON record gains an `instructions_file` key
    (exactly like the existing `avatar_file` key) and drops `instructions`.
  - **Squads:** the manifest `squads[]` entry (and the per-squad JSON) gains an
    `instructions_file` key alongside `avatar_url` and drops `instructions`.
- Recording the path explicitly (rather than deriving it blind at import time)
  matches how `avatar_file` already works in this codebase, and lets import
  distinguish "new bundle, read the `.md`" from "old bundle, read inline JSON"
  by the mere presence of the key — no path probing on legacy bundles.
- **Empty or absent instructions → no `.md` is written and no
  `instructions_file` key is set.** Nothing is lost; the absence means "no
  instructions".

## Export changes — `scripts/multica-export.mjs`

1. `redactAgent` pulls `instructions` out of the returned `record` (as it already
   pulls `id`, `runtime_id`, etc.) and returns the instructions string alongside
   the record (`{ record, hadSecrets, instructions }`) so the caller can write
   the `.md`.
2. The agent write loop writes `agents/<slug>.md` (derived from `entry.file` by
   `.json`→`.md`) when the instructions string is non-empty, and sets
   `record.instructions_file` to that relative path. The JSON written no longer
   contains `instructions`.
3. `buildManifest` squad entries drop the `instructions` field and set
   `instructions_file` (`squads/<slug>.md`) when instructions are non-empty.
4. The squad write loop writes `squads/<slug>.md` when non-empty; the per-squad
   JSON (a stringify of the manifest entry) therefore carries `instructions_file`
   and no `instructions`.

## Import changes — `scripts/multica-import.mjs`

Add one helper (`rec` is an agent record or a squad manifest entry — both carry
`instructions_file` and `instructions`):

```
readInstructions(fs, dir, rec)
  if rec.instructions_file && fs.existsSync(`${dir}/${rec.instructions_file}`)
      → return that file's contents
  else → return rec.instructions ?? ""      // backward-compat fallback
```

The fallback is the compatibility guarantee: an **old bundle** (instructions in
JSON, no `instructions_file`) still imports unchanged, because `rec.instructions`
is still present and the `instructions_file` guard is falsy. A **new bundle** has
no `instructions` key but has `instructions_file` + the `.md`, so the `.md`
branch is taken. A new agent that genuinely had no instructions has neither key,
and the helper returns `""`. No manifest version bump is required — import
performs no version gate, and the reader is tolerant of both layouts.

Because the guard keys on `rec.instructions_file` (absent on every legacy
record), existing import tests that use a non-path-aware fake fs keep exercising
the JSON fallback and pass unchanged.

Wire the helper in three places:

1. `importAgents` — replace the direct `rec.instructions` read used to build the
   `--instructions` flag with `readInstructions(fs, dir, rec)`.
2. `rewriteAgentMentions` — read instructions via `readInstructions(fs, dir, rec)`
   (not `rec.instructions`) before rewriting `mention://agent/<id>` links.
3. The squad loop in `importBundle` — set `squad.instructions =
   readInstructions(fs, dir, squad)` before calling `importSquad`, so
   `importSquad` itself stays unchanged and its existing mention-rewrite path
   keeps working.

## Sync — `scripts/multica-sync.mjs`

No change. Sync calls `exportResource` then `importBundle` through a temp
directory, so it inherits the new round-trip automatically.

## Testing — `tests/multica-tool/`

- **export.test.mjs**: assert `redactAgent` returns `instructions` separately and
  its `record` has no `instructions` key; assert `agents/<slug>.md` and
  `squads/<slug>.md` exist with the expected instructions, the JSON carries
  `instructions_file` and no `instructions`, and an agent/squad with empty
  instructions produces neither the `.md` nor an `instructions_file` key.
- **import.test.mjs**: a new-layout bundle (record has `instructions_file`, the
  `.md` is present) restores instructions from the `.md` for agent
  `--instructions`, squad create, and mention rewriting. Keep the existing
  JSON-inline tests as the **backward-compat** path (no `instructions_file` →
  fallback to `rec.instructions`); they must pass unchanged.
- **sync.test.mjs**: existing end-to-end behavior must still pass unchanged.

Tests must encode intent: the export tests fail if instructions leak back into
JSON; the backward-compat test fails if the fallback is dropped.

## Docs

- `plugins/multica-tool/skills/export/SKILL.md` — the layout sentence ("The script
  writes `manifest.json`, skill SKILL.md files, agent JSON files, and squad JSON
  files") gains the new `agents/<slug>.md` / `squads/<slug>.md` instructions files.
- `plugins/multica-tool/skills/import/SKILL.md` — note that instructions are read
  from the sibling `.md` when present (with JSON fallback for older bundles), so a
  reviewer knows editing the `.md` is the supported way to enhance instructions
  before import.

## Validation

Per repo CLAUDE.md, after implementation:

- Run `node --test tests/multica-tool/*.test.mjs`.
- Run `/validate-skills` (SKILL.md prose changed).
- Run the `plugin-validator` agent against `multica-tool`.
