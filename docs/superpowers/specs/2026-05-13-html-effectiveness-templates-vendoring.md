# html-effectiveness — Templates Vendoring + `.tmp/` Discipline

**Date:** 2026-05-13
**Author:** Steven Hoang
**Status:** Approved
**Supersedes (partial):** [2026-05-12 html-effectiveness plugin design](./2026-05-12-html-effectiveness-plugin-design.md) §6, §10, §13, §15 sync items.

## 1. Why this amendment

The 2026-05-12 spec describes `scripts/sync-upstream.js` as a periodic drift-check tool with its own automated test. The empty `templates/` folder shows that workflow was never executed. We are changing the integration model:

- Templates are **vendored** into this repo from `ThariqS/html-effectiveness`. After the first fetch, the 20 `.html.tmpl` files and `manifest.json` are the single source of truth.
- The fetch script becomes a **manual on-demand helper** for this repo only — used when a maintainer wants to check for or pull in upstream changes. It never runs automatically and ships no automated drift test.
- All scratch work performed by plugin scripts is confined to `.tmp/html-effectiveness/` at the repo root, with deterministic cleanup.

## 2. Goal

1. Fill the empty `plugins/html-effectiveness/templates/` folder with 20 vendored template skeletons + a complete `manifest.json`.
2. Replace the auto-sync model with a manual `scripts/fetch-upstream.js` that fetches into `.tmp/` and prints a diff for the maintainer to review.
3. Establish `.tmp/` convention so no plugin script leaves stray temp dirs at `/tmp/` or in the repo working tree.

## 3. Non-goals

- Rendering a gallery of sample reports under `docs/reports/`. Separate follow-up.
- Authoring templates not present upstream.
- Continuous drift monitoring or CI-driven re-fetch.

## 4. Vendoring model

**One-time extraction (covered by Task 7 + Task 8 of the existing plan):**

1. Fetch all 20 upstream HTML files plus the upstream commit SHA at fetch time.
2. Per file, strip example data, replace structural content with Mustache slot markers, hoist genuinely shared CSS into `assets/base.css` / `assets/components.css` only when a rule appears in ≥3 templates **and** is generic (typography, theme vars, layout primitives). Bias toward inline.
3. Commit `.html.tmpl` files + matching `manifest.json` entries. One commit per template for review-ability.

**After the initial extraction, the upstream repo has no runtime role.** Templates live in this repo. Changes are made by hand-editing the local files, exactly like any other vendored source.

### `manifest.json` `_meta` shape (informational only)

```json
{
  "_meta": {
    "upstream_repo": "ThariqS/html-effectiveness",
    "upstream_sha": "<sha-at-fetch>",
    "fetched_at": "2026-05-13",
    "note": "Templates vendored. Re-fetch is manual; see scripts/fetch-upstream.js."
  }
}
```

`_meta` is a fetch-time snapshot. No script enforces it. No test compares it to live upstream.

## 5. `scripts/fetch-upstream.js`

Renamed from `sync-upstream.js`. Behavior:

1. CLI: `node plugins/html-effectiveness/scripts/fetch-upstream.js [--write]`.
2. Workdir: `.tmp/html-effectiveness/upstream/`. Create it; `rm -rf` it on every exit (`try/finally` + `SIGINT` handler).
3. Fetch the upstream tree at `main` (configurable via `--ref=<sha|branch>`), download all 20 HTML files plus `index.html`.
4. For each upstream file, recompute the slot-marker extraction the same way the initial vendoring did. Compare against the vendored `.html.tmpl`. Print a per-file unified diff to stdout.
5. Print the upstream SHA so the maintainer can update `_meta.upstream_sha` if they choose to accept changes.
6. **Without `--write`**: read-only. Exit 0 if no diffs, exit 1 if diffs exist (so the script is shell-friendly).
7. **With `--write`**: overwrite vendored `.html.tmpl` files in place and update `_meta.upstream_sha` + `_meta.fetched_at`. Print the list of changed paths. Maintainer reviews + commits by hand.
8. Always cleans `.tmp/html-effectiveness/upstream/` before exit, including on error or `Ctrl-C`.
9. Zero runtime deps; uses `node:fetch` and `node:fs`.

No automated test. The script is a manual maintenance tool; smoke-test by running it after templates are vendored and asserting "no diff" the first time.

## 6. `.tmp/` discipline

1. Add `.tmp/` to repo root `.gitignore` (top-level rule, not plugin-local).
2. Plugin ships `plugins/html-effectiveness/scripts/_tmp.js` exporting:

   ```js
   import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
   import { join, resolve } from 'node:path';

   const REPO_ROOT = resolve(new URL('../../../..', import.meta.url).pathname);
   const ROOT = join(REPO_ROOT, '.tmp', 'html-effectiveness');

   export function getTmpDir(purpose) {
     const dir = join(ROOT, purpose);
     rmSync(dir, { recursive: true, force: true });
     mkdirSync(dir, { recursive: true });
     return dir;
   }

   export function cleanup(purpose) {
     rmSync(join(ROOT, purpose), { recursive: true, force: true });
   }

   export function withTmp(purpose, fn) {
     const dir = getTmpDir(purpose);
     const onSig = () => { try { cleanup(purpose); } finally { process.exit(130); } };
     process.once('SIGINT', onSig);
     process.once('SIGTERM', onSig);
     try {
       return fn(dir);
     } finally {
       cleanup(purpose);
       process.off('SIGINT', onSig);
       process.off('SIGTERM', onSig);
     }
   }
   ```

3. `fetch-upstream.js` uses `withTmp('upstream', dir => …)`.
4. Plan Task 16 smoke-test paths change from `/tmp/htmleff-smoke/` → `.tmp/html-effectiveness/smoke/`.
5. **Leave `tests/render.test.js` alone.** It uses `os.tmpdir()` via `mkdtempSync` — that is Node's OS-managed scratch space and auto-cleans. Out of scope for the `.tmp/` rule, which targets plugin-owned scratch.

## 7. Documentation updates

- `plugins/html-effectiveness/README.md`: replace `node …/scripts/sync-upstream.js` with `node …/scripts/fetch-upstream.js` and one sentence: "Manual upstream check. Prints diff; pass `--write` to overwrite local templates."
- `plugins/html-effectiveness/skills/html-effectiveness/SKILL.md`: update Sync footer to "Vendored from `ThariqS/html-effectiveness@<sha>` on `<date>`. Re-fetch via `scripts/fetch-upstream.js`."

No CLAUDE.md / AGENTS.md changes needed — `.tmp/` is project-private convention, not a marketplace-facing contract.

## 8. Plan delta vs 2026-05-12 plan

| Task | Status | Change |
|------|--------|--------|
| 1–6, 12, 13 | done in code, but not all checked off | leave |
| 7 | run now | canonical extraction of `11-status-report.html.tmpl` |
| 8 | run now | extract remaining 19 |
| 9 | run now | manifest consistency tests |
| 10 | run now | `catalog.js` + `docs/template-gallery.md` |
| 11 | **rewritten** | becomes `fetch-upstream.js` (manual tool, no test). Drops `tests/sync-upstream.test.js`. |
| 14 | run now | wire root marketplace + bump |
| 15 | trimmed | no CLAUDE.md / AGENTS.md edits for vendoring; only mention the new plugin if not already mentioned |
| 16 | adjusted | smoke-test paths move to `.tmp/html-effectiveness/smoke/` |
| (new) | new task | add `.tmp/` to root `.gitignore`; ship `scripts/_tmp.js`; wire `fetch-upstream.js` through it |

## 9. Acceptance criteria

- [ ] `plugins/html-effectiveness/templates/` contains 20 `.html.tmpl` files matching IDs `01-..-20-..` from the 2026-05-12 spec §5.
- [ ] `plugins/html-effectiveness/templates/manifest.json` has an entry per template with `title`, `use_cases`, `pattern`, `slots` schema, `asset_bundles`, `extra_js`. `_meta` carries upstream SHA + `fetched_at` date.
- [ ] `plugins/html-effectiveness/scripts/fetch-upstream.js` exists. With no args, exits 0 immediately after fetch if no diff vs vendored files; non-zero if diff. Always cleans `.tmp/html-effectiveness/upstream/`.
- [ ] No file under `plugins/html-effectiveness/` references `sync-upstream`.
- [ ] `.gitignore` at repo root contains `.tmp/`.
- [ ] `plugins/html-effectiveness/scripts/_tmp.js` ships and is consumed by `fetch-upstream.js`.
- [ ] No `/tmp/htmleff-*` paths remain in plan or scripts; all moved to `.tmp/html-effectiveness/<purpose>/`.
- [ ] `npm test` passes (render + manifest tests, no sync-upstream test).
- [ ] `docs/template-gallery.md` generated and committed.

## 10. Out of scope

- Rendering example reports for each template.
- Pruning shared CSS aggressively. Keep extraction conservative; rules go shared only when they appear in ≥3 templates and are generic.
- Reorganizing `assets/` beyond what the existing files already provide.
