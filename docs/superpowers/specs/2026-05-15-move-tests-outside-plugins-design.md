# Move plugin tests outside `plugins/`

**Date:** 2026-05-15
**Status:** Draft → awaiting owner review

## Problem

`package.json` ships `files: ["plugins/**", ...]`, which publishes every `plugins/<name>/tests/` directory to npm. Tests are dev artefacts (fixtures, bash assertion scripts, Node `node:test` files); they bloat the installed plugin tarball and serve no consumer.

Two plugins ship test trees today:

- `plugins/html-effectiveness/tests/` — 4 `.test.js` files + 23 fixtures referenced via `__dirname`-relative paths.
- `plugins/team-superpower/tests/` — 16 `.test.sh` files.

A third plugin (`plugins/tech-graph/skills/tech-graph/scripts/test-all-styles.sh`) is vendored from upstream and out of scope.

## Goal

Move both test trees out of `plugins/` so the npm `files` whitelist no longer captures them. Keep tests runnable locally.

## Non-goals

- Touching `plugins/tech-graph/**` (vendored; CLAUDE.md forbids direct edits).
- Test framework changes.
- Adding a top-level test runner script.
- Rewriting historical plan docs under `docs/superpowers/plans/` (kept as historical record).

## Target layout

```
tests/
  html-effectiveness/
    manifest.test.js
    mustache.test.js
    render.test.js
    _tmp.test.js
    fixtures/
      *.data.json
      _canned.*
  team-superpower/
    *.test.sh   (16 files)
```

`plugins/<name>/tests/` directories removed.

## Changes

### 1. Move test directories

Use `git mv` to preserve history:

- `git mv plugins/html-effectiveness/tests tests/html-effectiveness`
- `git mv plugins/team-superpower/tests tests/team-superpower`

### 2. Fix path references inside test files

**html-effectiveness:** `manifest.test.js` resolves `PLUGIN_ROOT` and reads `tests/fixtures/<id>.data.json`. After the move, the test file sits at `tests/html-effectiveness/manifest.test.js`. `PLUGIN_ROOT` must point at `plugins/html-effectiveness`. Update the resolution so the fixture path becomes `<repo>/tests/html-effectiveness/fixtures/<id>.data.json` (fixtures move with the tests) and any reference to the plugin's manifest/templates points back into `plugins/html-effectiveness/...`. Other test files (`mustache.test.js`, `render.test.js`, `_tmp.test.js`) get the same audit.

**team-superpower:** each bash test currently computes repo-root via `cd "$(dirname "$0")/../../.."` or similar. After the move from `plugins/team-superpower/tests/` to `tests/team-superpower/`, the depth from test file to repo root stays the same (two `..` levels). Verify each script's path math against the new location; adjust any hard-coded `plugins/team-superpower/tests/...` references.

### 3. Documentation

- `CLAUDE.md:31` and `AGENTS.md:31` — change "Plugins may ship their own (`plugins/<name>/tests/`); run with `node --test plugins/<name>/tests/`" to point at top-level `tests/<name>/`. Add bash test guidance: `bash tests/<plugin>/<file>.test.sh`.
- `README.md` — no plugin-table change (plugins themselves unchanged); add a short "Tests" note if missing.

### 4. Local settings

- `.claude/settings.local.json:21` — allowed-command path `bash /Users/.../plugins/team-superpower/tests/task-completed-iterations.test.sh` → update to `tests/team-superpower/task-completed-iterations.test.sh`.

### 5. Publish safety

No `package.json` edit required. `files: ["plugins/**", ...]` no longer covers the new top-level `tests/` directory, so npm will not pack it.

`.npmignore` already excludes `docs/`, `.claude/`, etc. Add `tests/` defensively in case a future `files` change is sloppier.

## Verification

1. Manifest JSON parse check (existing): `python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"`.
2. Run each suite from new location:
   - `node --test tests/html-effectiveness/`
   - `for f in tests/team-superpower/*.test.sh; do bash "$f"; done`
3. `npm pack --dry-run` — confirm tarball file list contains zero `tests/` entries.
4. `git log --follow tests/html-effectiveness/manifest.test.js` — confirm history preserved through the move.

## Risks

- **Path-ref breakage:** main risk. Mitigated by running each suite after the move.
- **Vendored script:** none — `tech-graph` left untouched.
- **Historical plan docs reference old paths:** acceptable; they document a prior state.

## Open questions

None.
