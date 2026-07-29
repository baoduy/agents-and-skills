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
  suffix with `.md` — the same sibling-file convention already used for avatars
  (`multica-export.mjs` avatar handling: `entry.file.replace(/\.json$/, ...)`).
- **Empty or absent instructions → no `.md` is written.** Nothing is lost; the
  absence of the file simply means "no instructions".

## Export changes — `scripts/multica-export.mjs`

1. `redactAgent` pulls `instructions` out of the returned `record` (as it already
   pulls `id`, `runtime_id`, etc.) and returns the instructions string alongside
   the record so the caller can write the `.md`.
2. The agent write loop writes `agents/<slug>.md` (derived from `entry.file`) when
   the instructions string is non-empty. The JSON written no longer contains
   `instructions`.
3. `buildManifest` squad entries drop the `instructions` field.
4. The squad write loop writes `squads/<slug>.md` when non-empty; the per-squad
   JSON no longer contains `instructions`.

## Import changes — `scripts/multica-import.mjs`

Add one helper:

```
readInstructions(fs, dir, jsonFile, rec)
  mdPath = jsonFile.replace(/\.json$/, ".md")
  if fs.existsSync(`${dir}/${mdPath}`) → return that file's contents
  else → return rec.instructions ?? ""      // backward-compat fallback
```

The fallback is the compatibility guarantee: an **old bundle** (instructions in
JSON, no `.md`) still imports unchanged, because `rec.instructions` is still
present there. A **new bundle** has no `instructions` key in JSON but has the
`.md`, so the `.md` branch is taken. A new agent that genuinely had no
instructions has neither, and the helper returns `""`. No manifest version bump
is required — import performs no version gate, and the reader is tolerant of both
layouts.

Wire the helper in three places:

1. `importAgents` — replace the direct `rec.instructions` read used to build the
   `--instructions` flag with the helper's result.
2. `rewriteAgentMentions` — read instructions via the helper (not `rec.instructions`)
   before rewriting `mention://agent/<id>` links.
3. The squad loop in `importBundle` — read the squad's instructions from its
   `.md` (fallback to the manifest entry's `instructions`) and set
   `squad.instructions` before calling `importSquad`, so `importSquad` itself
   stays unchanged and its existing mention-rewrite path keeps working.

## Sync — `scripts/multica-sync.mjs`

No change. Sync calls `exportResource` then `importBundle` through a temp
directory, so it inherits the new round-trip automatically.

## Testing — `tests/multica-tool/`

- **export.test.mjs**: assert `agents/<slug>.md` and `squads/<slug>.md` exist with
  the expected instructions, and that the written JSON (and manifest `squads[]`)
  no longer carry an `instructions` key. Assert that an agent/squad with empty
  instructions produces no `.md`.
- **import.test.mjs**: a new-layout bundle restores instructions from the `.md`
  (agent `--instructions`, squad create, and mention rewriting all read the
  `.md`). Add one **backward-compat test**: a JSON-only bundle (instructions in
  JSON, no `.md`) still imports the instructions via the fallback.
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
