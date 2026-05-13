# html-effectiveness — Templates Vendoring + `.tmp/` Discipline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the empty `plugins/html-effectiveness/templates/` folder with 20 vendored template skeletons + matching `manifest.json`. Replace the auto-sync model with a manual `scripts/fetch-upstream.js` helper. Confine all plugin scratch work to `.tmp/html-effectiveness/` with deterministic cleanup.

**Architecture:** Templates are vendored — fetched once from `ThariqS/html-effectiveness@<sha>`, committed as `.html.tmpl` files + `manifest.json` entries, then live in this repo as the single source of truth. The new `fetch-upstream.js` is a manual maintenance tool only: re-fetches into `.tmp/`, prints a diff vs vendored files, and only mutates the repo when invoked with `--write`. A shared `scripts/_tmp.js` helper enforces the `.tmp/html-effectiveness/<purpose>/` convention with `try/finally` + signal-handler cleanup so no plugin script ever leaves a stray scratch dir.

**Tech Stack:** Node 18+ (built-ins only — `node:fs`, `node:fetch`, `node:test`, `node:util`), Mustache subset already in `scripts/mustache.js`, gh CLI for upstream fetch in extraction, plain `git` for commits.

**Spec:** `docs/superpowers/specs/2026-05-13-html-effectiveness-templates-vendoring.md` (amendment to `2026-05-12-html-effectiveness-plugin-design.md`).

**Pre-existing state (verified 2026-05-13):**
- `plugins/html-effectiveness/` exists with: `.claude-plugin/plugin.json`, `agents/report-builder.md`, `assets/{base,components}.css` + `{base,charts}.js`, `commands/html-report.md`, `scripts/{render,mustache}.js`, `skills/html-effectiveness/SKILL.md`, `tests/{render,mustache}.test.js`, `tests/fixtures/_canned.*`, `templates/manifest.json` (stub with `upstream_sha: PENDING`), `README.md`, `package.json`.
- Plugin is already registered in `.claude-plugin/marketplace.json`.
- Root `package.json` has no `scripts.test` entry; tests run via `node --test plugins/html-effectiveness/tests/`.
- `.gitignore` at repo root does **not** include `.tmp/`.
- `plugins/html-effectiveness/scripts/sync-upstream.js` is referenced in README + SKILL.md but does **not** exist. There is no `extract.js`, no `catalog.js`, no `fetch-upstream.js`, and no `_tmp.js`.

---

## Task 1: `.tmp/` infrastructure — gitignore + shared helper

**Files:**
- Modify: `.gitignore` (repo root)
- Create: `plugins/html-effectiveness/scripts/_tmp.js`
- Create: `plugins/html-effectiveness/tests/_tmp.test.js`

- [ ] **Step 1: Add `.tmp/` rule to root `.gitignore`**

Append to `.gitignore`:

```
# Plugin-owned scratch (see plugins/<name>/scripts/_tmp.js)
.tmp/
```

Verify:

```bash
grep -n "^\.tmp/" .gitignore
```

Expected: prints the line number of the new rule.

- [ ] **Step 2: Write failing test for `_tmp.js`**

`plugins/html-effectiveness/tests/_tmp.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getTmpDir, cleanup, withTmp, ROOT } from '../scripts/_tmp.js';

test('getTmpDir creates a fresh dir under .tmp/html-effectiveness/', () => {
  const dir = getTmpDir('unit-a');
  assert.ok(dir.endsWith('/.tmp/html-effectiveness/unit-a'));
  assert.ok(existsSync(dir));
  cleanup('unit-a');
});

test('getTmpDir wipes existing dir contents', () => {
  const dir = getTmpDir('unit-b');
  writeFileSync(join(dir, 'old.txt'), 'stale');
  const dir2 = getTmpDir('unit-b');
  assert.equal(dir, dir2);
  assert.equal(existsSync(join(dir2, 'old.txt')), false);
  cleanup('unit-b');
});

test('cleanup removes dir', () => {
  const dir = getTmpDir('unit-c');
  cleanup('unit-c');
  assert.equal(existsSync(dir), false);
});

test('cleanup is idempotent on missing dir', () => {
  cleanup('unit-never-created');
  assert.ok(true);
});

test('withTmp runs callback and cleans up on success', () => {
  let observed;
  const result = withTmp('unit-d', (dir) => {
    observed = dir;
    writeFileSync(join(dir, 'x'), 'y');
    return 'done';
  });
  assert.equal(result, 'done');
  assert.equal(existsSync(observed), false);
});

test('withTmp cleans up even when callback throws', () => {
  let observed;
  assert.throws(() => {
    withTmp('unit-e', (dir) => {
      observed = dir;
      throw new Error('boom');
    });
  }, /boom/);
  assert.equal(existsSync(observed), false);
});

test('ROOT is anchored at repo .tmp/html-effectiveness', () => {
  assert.ok(ROOT.endsWith('/.tmp/html-effectiveness'));
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
node --test plugins/html-effectiveness/tests/_tmp.test.js
```

Expected: FAIL with `Cannot find module .../_tmp.js`.

- [ ] **Step 4: Implement `_tmp.js`**

`plugins/html-effectiveness/scripts/_tmp.js`:

```javascript
// Shared scratch-dir convention for the html-effectiveness plugin.
// All plugin-owned scratch lives under <repoRoot>/.tmp/html-effectiveness/<purpose>/.
// Always cleaned on process exit, error, SIGINT, or SIGTERM.

import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// scripts/ -> plugins/html-effectiveness/ -> plugins/ -> repo root
const REPO_ROOT = resolve(HERE, '..', '..', '..');
export const ROOT = join(REPO_ROOT, '.tmp', 'html-effectiveness');

export function getTmpDir(purpose) {
  if (!purpose || /[\\/]/.test(purpose)) {
    throw new Error(`purpose must be a single path segment, got: ${purpose}`);
  }
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
  const onSig = () => {
    try { cleanup(purpose); } finally { process.exit(130); }
  };
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

- [ ] **Step 5: Run tests to confirm they pass**

```bash
node --test plugins/html-effectiveness/tests/_tmp.test.js
```

Expected: 7 tests pass.

- [ ] **Step 6: Run full plugin test suite to confirm no regressions**

```bash
node --test plugins/html-effectiveness/tests/
```

Expected: all tests pass (`_tmp`, `mustache`, `render`).

- [ ] **Step 7: Commit**

```bash
git add .gitignore \
        plugins/html-effectiveness/scripts/_tmp.js \
        plugins/html-effectiveness/tests/_tmp.test.js
git commit -m "feat(html-effectiveness): add .tmp/ discipline + _tmp.js helper

Adds a repo-root .tmp/ rule to .gitignore and a plugin-scoped scratch
helper (getTmpDir/cleanup/withTmp) that confines all plugin-owned
scratch to .tmp/html-effectiveness/<purpose>/ with deterministic
cleanup on exit, error, SIGINT, and SIGTERM."
```

---

## Task 2: Upstream extraction helper — `scripts/extract.js`

**Files:**
- Create: `plugins/html-effectiveness/scripts/extract.js`

`extract.js` is the one-shot extractor used during initial vendoring (Tasks 3 + 4). It fetches a single upstream HTML file, splits inline `<style>` / `<script>` blocks, and writes them to a `.tmp/html-effectiveness/extract/` workdir for the engineer to hand-merge.

- [ ] **Step 1: Implement `extract.js`**

`plugins/html-effectiveness/scripts/extract.js`:

```javascript
#!/usr/bin/env node
// One-shot extractor. Fetches a single upstream HTML file via gh, splits inline
// CSS/JS into separate artifacts under .tmp/html-effectiveness/extract/, and prints
// the body skeleton (with mustache slot markers added by hand later).
//
// Sub-commands:
//   fetch <name>          download upstream/<name> into .tmp/.../extract/<name>
//   sha                   print current upstream main SHA
//   split <name>          read previously-fetched <name> from .tmp/, write
//                         <name>.body.html, <name>.styles.css, <name>.scripts.js
//
// The script never modifies templates/. The engineer reads the .tmp/ artifacts and
// hand-writes the vendored .html.tmpl.

import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { getTmpDir, ROOT } from './_tmp.js';

const UPSTREAM_REPO = 'ThariqS/html-effectiveness';

export function fetchUpstreamFile(filename) {
  const b64 = execSync(
    `gh api repos/${UPSTREAM_REPO}/contents/${filename} --jq .content`,
    { encoding: 'utf8' },
  ).trim();
  return Buffer.from(b64, 'base64').toString('utf8');
}

export function fetchUpstreamSha(ref = 'main') {
  return execSync(
    `gh api repos/${UPSTREAM_REPO}/commits/${ref} --jq .sha`,
    { encoding: 'utf8' },
  ).trim();
}

export function extractParts(html) {
  const styles = [];
  const scripts = [];
  let body = html;
  body = body.replace(/<style[^>]*>([\s\S]*?)<\/style>/g, (_, css) => {
    styles.push(css.trim());
    return '';
  });
  body = body.replace(/<script[^>]*>([\s\S]*?)<\/script>/g, (_, js) => {
    if (js.trim()) scripts.push(js.trim());
    return '';
  });
  body = body
    .replace(/<!doctype[^>]*>/i, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<\/?body[^>]*>/gi, '');
  return { styles, scripts, body: body.trim() };
}

function ensureWorkdir() {
  // getTmpDir wipes — only call once per extract.js invocation, on first sub-command.
  return getTmpDir('extract');
}

function readFromWorkdir(name) {
  return readFileSync(join(ROOT, 'extract', name), 'utf8');
}

function writeToWorkdir(dir, name, content) {
  writeFileSync(join(dir, name), content);
}

function cli() {
  const [, , cmd, arg] = process.argv;
  if (cmd === 'fetch') {
    if (!arg) { process.stderr.write('usage: extract.js fetch <file>\n'); process.exit(1); }
    const dir = ensureWorkdir();
    const html = fetchUpstreamFile(arg);
    writeToWorkdir(dir, arg, html);
    process.stdout.write(`${join(dir, arg)}\n`);
  } else if (cmd === 'sha') {
    process.stdout.write(fetchUpstreamSha() + '\n');
  } else if (cmd === 'split') {
    if (!arg) { process.stderr.write('usage: extract.js split <file>\n'); process.exit(1); }
    const html = readFromWorkdir(arg);
    const { styles, scripts, body } = extractParts(html);
    const base = arg.replace(/\.html$/, '');
    const dir = join(ROOT, 'extract');
    writeToWorkdir(dir, `${base}.body.html`, body + '\n');
    writeToWorkdir(dir, `${base}.styles.css`, styles.join('\n\n/* --- */\n\n') + '\n');
    writeToWorkdir(dir, `${base}.scripts.js`, scripts.join('\n\n/* --- */\n\n') + '\n');
    process.stdout.write(`${dir}/${base}.{body.html,styles.css,scripts.js}\n`);
  } else {
    process.stderr.write('usage: extract.js {fetch <file>|sha|split <file>}\n');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) cli();
```

- [ ] **Step 2: Smoke-test the `sha` sub-command (network sanity)**

```bash
node plugins/html-effectiveness/scripts/extract.js sha
```

Expected: prints a 40-character hex string and exits 0. If it fails with `gh: command not found`, install `gh` and re-run.

- [ ] **Step 3: Commit**

```bash
git add plugins/html-effectiveness/scripts/extract.js
git commit -m "feat(html-effectiveness): add extract.js upstream fetch/split helper"
```

---

## Task 3: Extract canonical template `11-status-report`

**Files:**
- Create: `plugins/html-effectiveness/templates/11-status-report.html.tmpl`
- Modify: `plugins/html-effectiveness/templates/manifest.json`
- Create: `plugins/html-effectiveness/tests/fixtures/11-status-report.data.json`
- Modify: `plugins/html-effectiveness/assets/base.css` (only if generic shared rules harvested)
- Modify: `plugins/html-effectiveness/assets/components.css` (only if generic shared rules harvested)
- Modify: `plugins/html-effectiveness/assets/base.js` (only if generic shared interactions harvested)

This task validates the extraction pipeline on one template end-to-end. Task 4 reuses the same procedure for the remaining 19. Pick `11-status-report` first because it is a canonical Interactive Report pattern and exercises both stats grids and sections.

- [ ] **Step 1: Fetch + split**

```bash
node plugins/html-effectiveness/scripts/extract.js fetch 11-status-report.html
node plugins/html-effectiveness/scripts/extract.js split 11-status-report.html
node plugins/html-effectiveness/scripts/extract.js sha > /tmp/htmleff-sha.txt
cat /tmp/htmleff-sha.txt
```

Expected: three files in `.tmp/html-effectiveness/extract/`: `11-status-report.body.html`, `11-status-report.styles.css`, `11-status-report.scripts.js`. The `sha` command writes a 40-char SHA to `/tmp/htmleff-sha.txt` (used in Step 5).

- [ ] **Step 2: Hand-write the template skeleton**

`plugins/html-effectiveness/templates/11-status-report.html.tmpl`:

```html
<!--
template: 11-status-report
upstream: 11-status-report.html
slots: { title, period, stats[], sections[] }
-->
<main class="report report--status">
  <header>
    <h1>{{title}}</h1>
    <p class="subtitle">{{period}}</p>
  </header>
  <section class="stats" aria-label="Headline metrics">
    {{#stats}}
      <div class="stat">
        <span class="value">{{value}}</span>
        <span class="label">{{label}}</span>
        <span class="delta delta--{{trend}}">{{delta}}</span>
      </div>
    {{/stats}}
  </section>
  {{#sections}}
    <section class="status-section status-section--{{status}}">
      <h2>{{heading}}</h2>
      <div class="body">{{{body}}}</div>
    </section>
  {{/sections}}
  {{^sections}}
    <p class="empty">No updates this period.</p>
  {{/sections}}
</main>
```

- [ ] **Step 3: Merge harvested CSS**

Open `.tmp/html-effectiveness/extract/11-status-report.styles.css`. Classify each rule:

| If the selector is… | Action |
|---|---|
| `:root`, `body`, `html`, `*`, `@media (prefers-color-scheme: ...)`, generic typography (`h1`–`h6`, `p`, `a`), `@media print` | Append/merge into `assets/base.css` if not already present. |
| Generic component (`.card`, `.stat`, `.timeline`, `.kanban-*`, `.matrix-*`) | Append/merge into `assets/components.css` if not already present. |
| Anything starting with `.report--status`, `.status-section`, `.delta--*`, or other clearly status-report-specific selectors | Append as a `<style>` block at the bottom of `templates/11-status-report.html.tmpl`. Namespace any unprefixed selector by prepending `.report--status ` to it. |

If no rules qualify as shared, do not touch `assets/`.

Per-template `<style>` block goes at the very bottom of the `.html.tmpl`, after the closing `</main>`:

```html
<style>
.report--status .status-section { padding: 1rem 0; border-top: 1px solid var(--border, #e5e7eb); }
.report--status .status-section--at-risk { border-left: 3px solid #ef4444; padding-left: 1rem; }
.report--status .delta--up { color: #16a34a; }
.report--status .delta--down { color: #ef4444; }
</style>
```

(Exact selectors and values come from upstream. Copy verbatim where they fit; only add the `.report--status` prefix when a rule would otherwise leak.)

- [ ] **Step 4: Merge harvested JS**

Open `.tmp/html-effectiveness/extract/11-status-report.scripts.js`. If empty or whitespace-only, skip. Otherwise:

- If the JS is generic (theme toggle, copy-on-click, search filter wiring) and could apply to multiple templates: append/merge into `assets/base.js`.
- If the JS is template-specific (e.g. status-report-only behavior): append as a `<script>` block at the bottom of `templates/11-status-report.html.tmpl`, after the per-template `<style>` block.

- [ ] **Step 5: Add manifest entry**

Edit `plugins/html-effectiveness/templates/manifest.json` to replace its current contents:

```json
{
  "_meta": {
    "upstream_repo": "ThariqS/html-effectiveness",
    "upstream_sha": "<paste-sha-from-step-1>",
    "fetched_at": "2026-05-13",
    "note": "Templates vendored. Re-fetch is manual; see scripts/fetch-upstream.js."
  },
  "11-status-report": {
    "title": "Status Report",
    "use_cases": ["weekly status", "project update", "team digest", "monthly recap"],
    "pattern": "interactive_report",
    "tmpl": "templates/11-status-report.html.tmpl",
    "slots": {
      "title":  { "type": "string", "required": true },
      "period": { "type": "string", "required": true },
      "stats": {
        "type": "array",
        "of": { "label": "string", "value": "string", "delta": "string", "trend": "string" }
      },
      "sections": {
        "type": "array",
        "of": { "heading": "string", "body": "html", "status": "string" }
      }
    },
    "asset_bundles": ["base", "components"],
    "extra_js": null
  }
}
```

Replace `<paste-sha-from-step-1>` with the 40-char SHA from `/tmp/htmleff-sha.txt`.

- [ ] **Step 6: Add fixture**

`plugins/html-effectiveness/tests/fixtures/11-status-report.data.json`:

```json
{
  "title": "Q2 Engineering Status",
  "period": "Apr 1 - Jun 30, 2026",
  "stats": [
    { "label": "Shipped features", "value": "12", "delta": "+3", "trend": "up" },
    { "label": "Open bugs",        "value": "47", "delta": "-8", "trend": "down" },
    { "label": "On-call pages",    "value": "14", "delta": "+2", "trend": "up" }
  ],
  "sections": [
    { "heading": "Platform", "status": "on-track", "body": "<p>Migrated auth to v2. Latency p95 down 30%.</p>" },
    { "heading": "Mobile",   "status": "at-risk",  "body": "<p>iOS release blocked on App Store review.</p>" }
  ]
}
```

- [ ] **Step 7: Render and visually inspect**

```bash
mkdir -p .tmp/html-effectiveness/smoke
node plugins/html-effectiveness/scripts/render.js \
  --template=11-status-report \
  --data=plugins/html-effectiveness/tests/fixtures/11-status-report.data.json \
  --out=.tmp/html-effectiveness/smoke/11-status-report.html
open .tmp/html-effectiveness/smoke/11-status-report.html
```

Expected: a self-contained HTML opens, renders the title, the 3-stat grid, and the 2 sections (one `on-track`, one `at-risk`). Open browser dev tools → Network panel; reload; confirm no external network requests.

- [ ] **Step 8: Run all plugin tests**

```bash
node --test plugins/html-effectiveness/tests/
```

Expected: all tests pass (`_tmp`, `mustache`, `render`). Manifest tests do not exist yet — they are added in Task 5.

- [ ] **Step 9: Commit**

```bash
git add plugins/html-effectiveness/templates/11-status-report.html.tmpl \
        plugins/html-effectiveness/templates/manifest.json \
        plugins/html-effectiveness/tests/fixtures/11-status-report.data.json \
        plugins/html-effectiveness/assets/
git commit -m "feat(html-effectiveness): vendor 11-status-report template"
```

---

## Task 4: Extract remaining 19 templates

**Files:**
- Create (19): `plugins/html-effectiveness/templates/{01,02,03,04,05,06,07,08,09,10,12,13,14,15,16,17,18,19,20}-<slug>.html.tmpl`
- Modify: `plugins/html-effectiveness/templates/manifest.json` (add 19 entries)
- Create (19): `plugins/html-effectiveness/tests/fixtures/{01..20}-<slug>.data.json`
- Modify (as needed): `plugins/html-effectiveness/assets/{base,components}.css`, `assets/base.js`
- Modify (when first template needs charts): `plugins/html-effectiveness/assets/charts.js`

For each template, repeat the exact procedure from Task 3 (steps 1–8). Process in pairs to keep diffs reviewable and shared-asset edits convergent.

Template inventory (id, slug, pattern, use cases — informs `use_cases` field in manifest):

| ID | Slug | Pattern | Use cases |
|----|------|---------|-----------|
| 01 | `exploration-code-approaches` | `comparison_board` | "compare implementations", "approach trade-offs", "design alternatives" |
| 02 | `exploration-visual-designs` | `comparison_board` | "compare designs", "UI alternatives", "visual options" |
| 03 | `code-review-pr` | `code_review_board` | "PR review", "code review", "diff review" |
| 04 | `code-understanding` | `knowledge_explorer` | "explain code", "walk through architecture", "trace logic" |
| 05 | `design-system` | `design_system_sheet` | "design tokens", "color palette", "typography" |
| 06 | `component-variants` | `design_system_sheet` | "component variants", "states gallery" |
| 07 | `prototype-animation` | `interactive_report` | "animation prototype", "motion preview" |
| 08 | `prototype-interaction` | `interactive_report` | "interaction prototype", "ux flow" |
| 09 | `slide-deck` | `slide_deck` | "slide deck", "presentation", "pitch" |
| 10 | `svg-illustrations` | `knowledge_explorer` | "illustrate concept", "svg gallery" |
| 12 | `incident-report` | `interactive_report` | "incident report", "post-mortem", "outage writeup" |
| 13 | `flowchart-diagram` | `knowledge_explorer` | "flowchart", "process diagram", "decision tree" |
| 14 | `research-feature-explainer` | `knowledge_explorer` | "explain feature", "feature deep-dive" |
| 15 | `research-concept-explainer` | `knowledge_explorer` | "explain concept", "tutorial", "primer" |
| 16 | `implementation-plan` | `annotated_timeline` | "implementation plan", "phased rollout", "roadmap" |
| 17 | `pr-writeup` | `interactive_report` | "PR description", "release notes", "change writeup" |
| 18 | `editor-triage-board` | `kanban_board` | "bug triage", "issue board", "kanban" |
| 19 | `editor-feature-flags` | `decision_matrix` | "feature flags", "rollout matrix" |
| 20 | `editor-prompt-tuner` | `interactive_report` | "prompt tuning", "LLM config" |

For each ID, the upstream filename is `<id>-<slug>.html`. Confirm by inspecting the upstream repo if any filename differs.

- [ ] **Step 1: Process pair 01 + 02**

For each of `01-exploration-code-approaches` and `02-exploration-visual-designs`:

1. `node plugins/html-effectiveness/scripts/extract.js fetch <id>-<slug>.html`
2. `node plugins/html-effectiveness/scripts/extract.js split <id>-<slug>.html`
3. Hand-write `plugins/html-effectiveness/templates/<id>-<slug>.html.tmpl` with mustache slot markers chosen to match the structure observed in `.tmp/html-effectiveness/extract/<id>-<slug>.body.html`. Slots: pick from this conservative shape:
   ```
   { title: string, intro?: html, items[]: { heading, summary?, detail?: html, ... } }
   ```
   Adjust to fit the actual upstream structure.
4. Per Task 3 step 3, harvest shared CSS into `assets/base.css` / `assets/components.css`. Append per-template rules as a namespaced `<style>` block at the bottom of the `.html.tmpl`.
5. Per Task 3 step 4, harvest shared JS into `assets/base.js`. Append per-template scripts as a `<script>` block at the bottom of the `.html.tmpl`.
6. Add manifest entry mirroring Task 3 step 5: use the `use_cases` and `pattern` from the table above, `tmpl: "templates/<id>-<slug>.html.tmpl"`, `asset_bundles: ["base", "components"]`. Add `"charts"` to `asset_bundles` only if the template references chart helpers; in that case also populate `assets/charts.js` in the same commit (see step 11 below).
7. Create `plugins/html-effectiveness/tests/fixtures/<id>-<slug>.data.json` with realistic sample content. Every array slot must have ≥2 items. Every `html`-typed slot must include at least one HTML tag (e.g. `<p>`, `<code>`). Include one entry with embedded `<script>` to confirm escaping for non-`html`-typed slots.
8. Render to `.tmp/html-effectiveness/smoke/<id>-<slug>.html` and `open` it; confirm visually.
9. `node --test plugins/html-effectiveness/tests/` — all green.

Commit:

```bash
git add plugins/html-effectiveness/templates/01-exploration-code-approaches.html.tmpl \
        plugins/html-effectiveness/templates/02-exploration-visual-designs.html.tmpl \
        plugins/html-effectiveness/templates/manifest.json \
        plugins/html-effectiveness/tests/fixtures/01-exploration-code-approaches.data.json \
        plugins/html-effectiveness/tests/fixtures/02-exploration-visual-designs.data.json \
        plugins/html-effectiveness/assets/
git commit -m "feat(html-effectiveness): vendor templates 01-02 (exploration comparisons)"
```

- [ ] **Step 2: Process pair 03 + 04**

Same procedure for `03-code-review-pr` and `04-code-understanding`. Commit:

```bash
git commit -m "feat(html-effectiveness): vendor templates 03-04 (code review + understanding)"
```

- [ ] **Step 3: Process pair 05 + 06**

Same procedure for `05-design-system` and `06-component-variants`. Commit:

```bash
git commit -m "feat(html-effectiveness): vendor templates 05-06 (design system + variants)"
```

- [ ] **Step 4: Process pair 07 + 08**

Same procedure for `07-prototype-animation` and `08-prototype-interaction`. Commit:

```bash
git commit -m "feat(html-effectiveness): vendor templates 07-08 (prototypes)"
```

- [ ] **Step 5: Process pair 09 + 10**

Same procedure for `09-slide-deck` and `10-svg-illustrations`. The slide deck almost certainly needs per-template JS for arrow-key navigation — keep it inline in the `.html.tmpl` `<script>` block. Commit:

```bash
git commit -m "feat(html-effectiveness): vendor templates 09-10 (slides + svg)"
```

- [ ] **Step 6: Process pair 12 + 13**

Same procedure for `12-incident-report` and `13-flowchart-diagram`. Commit:

```bash
git commit -m "feat(html-effectiveness): vendor templates 12-13 (incident + flowchart)"
```

- [ ] **Step 7: Process pair 14 + 15**

Same procedure for `14-research-feature-explainer` and `15-research-concept-explainer`. Commit:

```bash
git commit -m "feat(html-effectiveness): vendor templates 14-15 (research explainers)"
```

- [ ] **Step 8: Process pair 16 + 17**

Same procedure for `16-implementation-plan` and `17-pr-writeup`. Commit:

```bash
git commit -m "feat(html-effectiveness): vendor templates 16-17 (plan + PR writeup)"
```

- [ ] **Step 9: Process trio 18 + 19 + 20**

Same procedure for `18-editor-triage-board`, `19-editor-feature-flags`, `20-editor-prompt-tuner`. The triage board may need per-template JS for drag-and-drop — keep inline. The prompt tuner may need per-template sliders — keep inline. Commit:

```bash
git commit -m "feat(html-effectiveness): vendor templates 18-20 (editor tools)"
```

- [ ] **Step 10: Final all-template render sweep**

```bash
mkdir -p .tmp/html-effectiveness/smoke
for f in plugins/html-effectiveness/tests/fixtures/[0-9]*-*.data.json; do
  id=$(basename "$f" .data.json)
  node plugins/html-effectiveness/scripts/render.js \
    --template="$id" \
    --data="$f" \
    --out=".tmp/html-effectiveness/smoke/$id.html" \
    && echo "OK $id" || { echo "FAIL $id"; exit 1; }
done
```

Expected: 20 lines `OK <id>`. No failures.

- [ ] **Step 11: If any template uses chart helpers**

If during Step 1-9 a template required charts, ensure `assets/charts.js` contains the helpers referenced. Keep it minimal — only what the affected templates use. Commit any final tweak to `assets/charts.js` here if it was deferred:

```bash
git add plugins/html-effectiveness/assets/charts.js
git commit -m "feat(html-effectiveness): populate charts.js for chart-using templates"
```

If no template uses charts, skip this step.

- [ ] **Step 12: Clean up `.tmp/`**

```bash
rm -rf .tmp/html-effectiveness/extract .tmp/html-effectiveness/smoke
```

Expected: directories removed. `.gitignore` ensures they would never have been committed anyway.

---

## Task 5: Manifest consistency tests

**Files:**
- Create: `plugins/html-effectiveness/tests/manifest.test.js`

- [ ] **Step 1: Write failing tests**

`plugins/html-effectiveness/tests/manifest.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'templates/manifest.json'), 'utf8'));
const VALID_TYPES = new Set(['string', 'number', 'boolean', 'array', 'object', 'html']);
const VALID_BUNDLES = new Set(['base', 'components', 'charts']);

const entries = Object.entries(MANIFEST).filter(([k]) => !k.startsWith('_'));

test('manifest has _meta with upstream_sha pinned', () => {
  assert.ok(MANIFEST._meta, 'missing _meta');
  assert.ok(
    MANIFEST._meta.upstream_sha && MANIFEST._meta.upstream_sha !== 'PENDING',
    'upstream_sha must be a real SHA, not PENDING',
  );
  assert.ok(
    MANIFEST._meta.fetched_at && MANIFEST._meta.fetched_at !== 'PENDING',
    'fetched_at must be set',
  );
});

test('manifest covers all 20 templates', () => {
  assert.equal(entries.length, 20, `expected 20 templates, got ${entries.length}`);
});

for (const [id, entry] of entries) {
  test(`${id}: tmpl file exists`, () => {
    const tmplPath = join(ROOT, entry.tmpl || `templates/${id}.html.tmpl`);
    assert.ok(existsSync(tmplPath), `missing ${tmplPath}`);
  });

  test(`${id}: required manifest fields present`, () => {
    for (const f of ['title', 'use_cases', 'pattern', 'slots', 'asset_bundles']) {
      assert.ok(entry[f] !== undefined, `${id} missing ${f}`);
    }
    assert.ok(Array.isArray(entry.use_cases) && entry.use_cases.length > 0, `${id} use_cases empty`);
    assert.ok(Array.isArray(entry.asset_bundles), `${id} asset_bundles not array`);
    for (const b of entry.asset_bundles) {
      assert.ok(VALID_BUNDLES.has(b), `${id} unknown asset bundle: ${b}`);
    }
  });

  test(`${id}: slot types are recognized`, () => {
    for (const [slotName, schemaRaw] of Object.entries(entry.slots)) {
      const schema = typeof schemaRaw === 'string' ? { type: schemaRaw } : schemaRaw;
      assert.ok(VALID_TYPES.has(schema.type), `${id}:${slotName} bad type: ${schema.type}`);
      if (schema.of) {
        for (const [k, subType] of Object.entries(schema.of)) {
          const t = typeof subType === 'string' ? subType : subType.type;
          assert.ok(VALID_TYPES.has(t), `${id}:${slotName}.${k} bad sub-type: ${t}`);
        }
      }
    }
  });

  test(`${id}: fixture exists and parses`, () => {
    const fx = join(ROOT, `tests/fixtures/${id}.data.json`);
    assert.ok(existsSync(fx), `missing fixture ${fx}`);
    JSON.parse(readFileSync(fx, 'utf8'));
  });
}
```

- [ ] **Step 2: Run tests and confirm they pass**

```bash
node --test plugins/html-effectiveness/tests/manifest.test.js
```

Expected: all tests pass. If any fail, fix the manifest or fixtures and re-run before proceeding.

- [ ] **Step 3: Run full plugin test suite**

```bash
node --test plugins/html-effectiveness/tests/
```

Expected: all tests pass (`_tmp`, `mustache`, `render`, `manifest`).

- [ ] **Step 4: Commit**

```bash
git add plugins/html-effectiveness/tests/manifest.test.js
git commit -m "test(html-effectiveness): manifest consistency tests for 20 templates"
```

---

## Task 6: Catalog script + `docs/template-gallery.md`

**Files:**
- Create: `plugins/html-effectiveness/scripts/catalog.js`
- Create: `plugins/html-effectiveness/docs/template-gallery.md`

`catalog.js` reads `templates/manifest.json` and emits a markdown table to stdout. Used to (re)generate `docs/template-gallery.md` when the manifest changes.

- [ ] **Step 1: Implement `catalog.js`**

`plugins/html-effectiveness/scripts/catalog.js`:

```javascript
#!/usr/bin/env node
// Read templates/manifest.json and print a markdown gallery table to stdout.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const manifest = JSON.parse(readFileSync(join(ROOT, 'templates/manifest.json'), 'utf8'));

const entries = Object.entries(manifest)
  .filter(([k]) => !k.startsWith('_'))
  .sort(([a], [b]) => a.localeCompare(b));

const meta = manifest._meta || {};

const lines = [
  '# html-effectiveness Template Gallery',
  '',
  `Vendored from \`${meta.upstream_repo || 'upstream'}@${meta.upstream_sha || '<sha>'}\` on \`${meta.fetched_at || '<date>'}\`.`,
  'Re-fetch via `node plugins/html-effectiveness/scripts/fetch-upstream.js`.',
  '',
  '| ID | Title | Pattern | Use cases | Slots |',
  '|----|-------|---------|-----------|-------|',
];

for (const [id, e] of entries) {
  const slotSummary = Object.entries(e.slots)
    .map(([name, s]) => {
      const t = typeof s === 'string' ? s : s.type;
      return `\`${name}\`:${t}`;
    })
    .join(', ');
  const useCases = (e.use_cases || []).map((u) => `"${u}"`).join(', ');
  lines.push(`| ${id} | ${e.title} | ${e.pattern} | ${useCases} | ${slotSummary} |`);
}

process.stdout.write(lines.join('\n') + '\n');
```

- [ ] **Step 2: Generate `docs/template-gallery.md`**

```bash
mkdir -p plugins/html-effectiveness/docs
node plugins/html-effectiveness/scripts/catalog.js > plugins/html-effectiveness/docs/template-gallery.md
wc -l plugins/html-effectiveness/docs/template-gallery.md
```

Expected: file written; at least 26 lines (header + 20 template rows + table boilerplate).

- [ ] **Step 3: Sanity-check the output**

```bash
head -30 plugins/html-effectiveness/docs/template-gallery.md
```

Expected: H1 heading, vendored-from line, markdown table header, at least the first few template rows visible.

- [ ] **Step 4: Commit**

```bash
git add plugins/html-effectiveness/scripts/catalog.js \
        plugins/html-effectiveness/docs/template-gallery.md
git commit -m "feat(html-effectiveness): catalog.js + template-gallery.md"
```

---

## Task 7: Manual upstream-fetch helper — `scripts/fetch-upstream.js`

**Files:**
- Create: `plugins/html-effectiveness/scripts/fetch-upstream.js`

Replaces the (never-built) `sync-upstream.js`. Manual-only maintenance tool. Without flags: fetch upstream into `.tmp/`, run the same extraction the engineer did during Task 3-4, diff the regenerated body against the vendored `.html.tmpl`, print diffs, exit 0 (no diff) or 1 (diff exists). With `--write`: overwrite vendored `.html.tmpl` files and update `_meta.upstream_sha` + `_meta.fetched_at`. The engineer reviews and commits by hand.

- [ ] **Step 1: Implement `fetch-upstream.js`**

`plugins/html-effectiveness/scripts/fetch-upstream.js`:

```javascript
#!/usr/bin/env node
// Manual upstream-check / re-vendor tool.
// Default: read-only diff vs vendored templates; exit 1 if any diff.
// --write: overwrite vendored .html.tmpl + manifest._meta.
//
// All scratch lives under .tmp/html-effectiveness/fetch/ and is wiped on exit.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execSync } from 'node:child_process';
import { withTmp } from './_tmp.js';
import { fetchUpstreamFile, fetchUpstreamSha, extractParts } from './extract.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(HERE);

function unifiedDiff(a, b, label) {
  // Lightweight diff using `diff` command if available, else inline line-by-line.
  try {
    const aPath = join(process.env.TMPDIR || '/tmp', `${label}.a.${process.pid}`);
    const bPath = join(process.env.TMPDIR || '/tmp', `${label}.b.${process.pid}`);
    writeFileSync(aPath, a);
    writeFileSync(bPath, b);
    try {
      return execSync(`diff -u "${aPath}" "${bPath}"`, { encoding: 'utf8' });
    } catch (e) {
      // diff exits 1 when files differ; that's expected, return its stdout.
      return e.stdout?.toString() || '';
    }
  } catch {
    return a === b ? '' : `[diff fallback] ${label}: differs\n`;
  }
}

function readVendoredBody(tmplPath) {
  // Strip <style> and <script> blocks from the vendored .html.tmpl so we
  // compare body structure against the freshly-extracted upstream body.
  const raw = readFileSync(tmplPath, 'utf8');
  return raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
}

function run({ write }) {
  return withTmp('fetch', (workdir) => {
    const manifestPath = join(PLUGIN_ROOT, 'templates/manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const ids = Object.keys(manifest).filter((k) => !k.startsWith('_'));

    const sha = fetchUpstreamSha();
    process.stdout.write(`upstream sha: ${sha}\n`);
    process.stdout.write(`vendored sha: ${manifest._meta?.upstream_sha || '<unset>'}\n\n`);

    let anyDiff = false;

    for (const id of ids) {
      const entry = manifest[id];
      const tmplPath = join(PLUGIN_ROOT, entry.tmpl || `templates/${id}.html.tmpl`);
      if (!existsSync(tmplPath)) {
        process.stdout.write(`SKIP ${id}: no local file at ${tmplPath}\n`);
        continue;
      }
      let upstreamHtml;
      try {
        upstreamHtml = fetchUpstreamFile(`${id}.html`);
      } catch (e) {
        process.stdout.write(`SKIP ${id}: upstream fetch failed (${e.message})\n`);
        continue;
      }
      writeFileSync(join(workdir, `${id}.upstream.html`), upstreamHtml);
      const { body } = extractParts(upstreamHtml);
      const vendoredBody = readVendoredBody(tmplPath);

      // Whitespace-tolerant compare: collapse runs of whitespace before diffing
      // structure. Slot markers in vendored body will obviously diverge from
      // upstream's example content — the goal is to surface *structural* changes.
      const norm = (s) => s.replace(/\{\{[^}]+\}\}/g, '<SLOT>').replace(/\s+/g, ' ').trim();
      if (norm(body) === norm(vendoredBody)) {
        process.stdout.write(`OK   ${id}: no structural diff\n`);
        continue;
      }
      anyDiff = true;
      process.stdout.write(`DIFF ${id}:\n`);
      process.stdout.write(unifiedDiff(norm(vendoredBody), norm(body), id) + '\n');

      if (write) {
        // --write mode: do not overwrite blindly. Re-emit upstream extracted body
        // into .tmp/.../fetch/<id>.suggested.html.tmpl with slot markers stripped.
        // The engineer must hand-merge — this matches how the initial vendoring
        // was done and avoids destroying carefully-chosen slot placements.
        const suggestPath = join(workdir, `${id}.suggested.body.html`);
        writeFileSync(suggestPath, body);
        process.stdout.write(`  suggested upstream body written to ${suggestPath}\n`);
      }
    }

    if (write) {
      manifest._meta = manifest._meta || {};
      manifest._meta.upstream_sha = sha;
      manifest._meta.fetched_at = new Date().toISOString().slice(0, 10);
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
      process.stdout.write(`\nmanifest._meta updated: upstream_sha=${sha}, fetched_at=${manifest._meta.fetched_at}\n`);
    }

    return anyDiff ? 1 : 0;
  });
}

function cli() {
  const { values } = parseArgs({
    options: {
      write: { type: 'boolean', default: false },
    },
  });
  const exitCode = run({ write: values.write });
  process.exit(exitCode);
}

if (import.meta.url === `file://${process.argv[1]}`) cli();
```

- [ ] **Step 2: Smoke-test read-only mode**

```bash
node plugins/html-effectiveness/scripts/fetch-upstream.js
echo "exit: $?"
ls -la .tmp/html-effectiveness/fetch 2>/dev/null || echo "fetch workdir cleaned"
```

Expected: prints `upstream sha:` + `vendored sha:` lines, then one line per template (`OK <id>` or `DIFF <id>`). Exit 0 if no diff, 1 if diff. The `fetch` workdir is removed after the run.

If freshly vendored from the same SHA recorded in `manifest._meta.upstream_sha`, every line should be `OK <id>: no structural diff`.

- [ ] **Step 3: Smoke-test signal handling**

```bash
node plugins/html-effectiveness/scripts/fetch-upstream.js &
PID=$!
sleep 1
kill -INT $PID
wait $PID 2>/dev/null
ls -la .tmp/html-effectiveness/fetch 2>/dev/null || echo "fetch workdir cleaned"
```

Expected: process exits, `fetch` workdir is removed.

- [ ] **Step 4: Commit**

```bash
git add plugins/html-effectiveness/scripts/fetch-upstream.js
git commit -m "feat(html-effectiveness): fetch-upstream.js manual upstream check"
```

---

## Task 8: Wire plugin manifest + add npm test script

**Files:**
- Modify: `plugins/html-effectiveness/.claude-plugin/plugin.json` (add explicit `skills[]` + `agents[]`)
- Modify: `package.json` (root — add `scripts.test`)
- Verify: `.claude-plugin/marketplace.json` already lists `html-effectiveness` (no change expected)

- [ ] **Step 1: Update plugin manifest with explicit skills + agents lists**

Read current `plugins/html-effectiveness/.claude-plugin/plugin.json` and rewrite to add `skills` and `agents` arrays so marketplace consumers see them without relying purely on auto-discovery:

```json
{
  "name": "html-effectiveness",
  "displayName": "HTML Effectiveness Reports",
  "version": "0.1.0",
  "description": "Generate self-contained interactive HTML reports from 20 vendored templates via a conversational agent.",
  "author": { "name": "Steven Hoang" },
  "keywords": ["html", "report", "status", "incident", "slide-deck", "decision-matrix"],
  "skills": ["skills/html-effectiveness"],
  "agents": ["agents/report-builder.md"]
}
```

- [ ] **Step 2: Add root npm test script**

Modify root `package.json` — add a `scripts` block (after `bugs`, before `private`):

```json
  "scripts": {
    "test": "node --test plugins/html-effectiveness/tests/"
  },
```

The full root `package.json` after the edit should validate as JSON:

```bash
python3 -c "import json; json.load(open('package.json')); print('OK')"
```

Expected: `OK`.

- [ ] **Step 3: Run `npm test` from repo root**

```bash
npm test
```

Expected: `_tmp`, `mustache`, `render`, and `manifest` test suites all pass.

- [ ] **Step 4: Validate marketplace manifest still parses**

```bash
python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add plugins/html-effectiveness/.claude-plugin/plugin.json package.json
git commit -m "chore(html-effectiveness): wire plugin manifest skills/agents + npm test"
```

---

## Task 9: Documentation — README + SKILL.md sync footer

**Files:**
- Modify: `plugins/html-effectiveness/README.md`
- Modify: `plugins/html-effectiveness/skills/html-effectiveness/SKILL.md`

- [ ] **Step 1: Update README sync section**

Replace the existing "Sync upstream" section in `plugins/html-effectiveness/README.md`:

```markdown
## Templates

20 vendored templates from `ThariqS/html-effectiveness`. See `docs/template-gallery.md` for the full catalog.

## Manual upstream check

Templates are vendored. To check for upstream changes:

```bash
node plugins/html-effectiveness/scripts/fetch-upstream.js
```

Exits 0 if vendored templates match upstream, 1 if they differ. Pass `--write` to refresh `_meta.upstream_sha` and emit suggested bodies under `.tmp/html-effectiveness/fetch/<id>.suggested.body.html` for hand-merging:

```bash
node plugins/html-effectiveness/scripts/fetch-upstream.js --write
```

After hand-merging any changes into the `.html.tmpl` files, regenerate the catalog and commit:

```bash
node plugins/html-effectiveness/scripts/catalog.js > plugins/html-effectiveness/docs/template-gallery.md
git add plugins/html-effectiveness/templates plugins/html-effectiveness/docs/template-gallery.md
git commit -m "chore(html-effectiveness): refresh from upstream"
```
```

- [ ] **Step 2: Update SKILL.md sync footer**

Open `plugins/html-effectiveness/skills/html-effectiveness/SKILL.md`. Find the existing sync footer (last paragraph, mentioning `sync-upstream.js`). Replace with:

```markdown
Vendored from upstream `ThariqS/html-effectiveness@<sha pinned in templates/manifest.json>`. To check for drift, run `node plugins/html-effectiveness/scripts/fetch-upstream.js`. To pull updates, run with `--write`, review the suggested bodies under `.tmp/html-effectiveness/fetch/`, hand-merge into the vendored `.html.tmpl` files, and commit.
```

- [ ] **Step 3: Validate SKILL.md still parses**

```bash
head -5 plugins/html-effectiveness/skills/html-effectiveness/SKILL.md
```

Expected: frontmatter intact (`---` / `name:` / `description:` / `---`).

- [ ] **Step 4: Verify no stale `sync-upstream` references remain**

```bash
grep -rn "sync-upstream" plugins/html-effectiveness/ || echo "clean"
```

Expected: prints `clean` (no matches).

- [ ] **Step 5: Commit**

```bash
git add plugins/html-effectiveness/README.md \
        plugins/html-effectiveness/skills/html-effectiveness/SKILL.md
git commit -m "docs(html-effectiveness): point to fetch-upstream.js, drop sync-upstream"
```

---

## Task 10: End-to-end smoke test

**Files:** (no source changes expected unless smoke surfaces fixes)

- [ ] **Step 1: Render every template against its fixture into `.tmp/`**

```bash
mkdir -p .tmp/html-effectiveness/smoke
for f in plugins/html-effectiveness/tests/fixtures/[0-9]*-*.data.json; do
  id=$(basename "$f" .data.json)
  node plugins/html-effectiveness/scripts/render.js \
    --template="$id" \
    --data="$f" \
    --out=".tmp/html-effectiveness/smoke/$id.html" \
    && echo "OK $id" || { echo "FAIL $id"; exit 1; }
done
```

Expected: 20 `OK <id>` lines. No failures.

- [ ] **Step 2: Confirm each output is self-contained**

```bash
for f in .tmp/html-effectiveness/smoke/*.html; do
  if grep -qE '<link[^>]+href=|<script[^>]+src=' "$f"; then
    echo "FAIL: $f has external assets"
    exit 1
  fi
done
echo "all self-contained"
```

Expected: `all self-contained`.

- [ ] **Step 3: Verify CLAUDE.md override path is honored**

Create a scratch `CLAUDE.md` with an override and run the agent's render path manually:

```bash
mkdir -p .tmp/html-effectiveness/override-test/scratch-reports
cat > .tmp/html-effectiveness/override-test/CLAUDE.md <<'EOF'
html-effectiveness.reportDir: ./scratch-reports
EOF
( cd .tmp/html-effectiveness/override-test && \
  node ../../../plugins/html-effectiveness/scripts/render.js \
    --template=11-status-report \
    --data=../../../plugins/html-effectiveness/tests/fixtures/11-status-report.data.json \
    --out=./scratch-reports/2026-05-13-status.html )
ls .tmp/html-effectiveness/override-test/scratch-reports/
```

Expected: the directory lists `2026-05-13-status.html` and `2026-05-13-status.html.data.json`. This validates the renderer respects an arbitrary out-path; the agent itself reads `CLAUDE.md` for the directory but the render script just honors `--out=`.

- [ ] **Step 4: Verify regen from sidecar produces identical HTML**

```bash
node plugins/html-effectiveness/scripts/render.js \
  --template=11-status-report \
  --data=plugins/html-effectiveness/tests/fixtures/11-status-report.data.json \
  --out=.tmp/html-effectiveness/smoke/11-status-report-regen.html
diff .tmp/html-effectiveness/smoke/11-status-report.html .tmp/html-effectiveness/smoke/11-status-report-regen.html
```

Expected: `diff` produces no output (HTML files identical). Sidecar `rendered_at` timestamps may differ but the HTML itself should match.

- [ ] **Step 5: Confirm `fetch-upstream.js` reports clean**

```bash
node plugins/html-effectiveness/scripts/fetch-upstream.js
echo "exit: $?"
```

Expected: every template line `OK <id>: no structural diff`. Exit 0.

- [ ] **Step 6: Clean up `.tmp/`**

```bash
rm -rf .tmp/html-effectiveness
```

Expected: directory removed.

- [ ] **Step 7: Final test sweep**

```bash
npm test
```

Expected: all suites pass.

- [ ] **Step 8: Commit any smoke-surface polish (if needed)**

If steps 1–5 surfaced template tweaks or fixture fixes:

```bash
git add -p
git commit -m "fix(html-effectiveness): smoke-test polish"
```

Otherwise nothing to commit.

---

## Self-Review Notes

**Spec coverage:**

| Spec section | Tasks |
|---|---|
| §2.1 Fill `templates/` with 20 skeletons + manifest | Tasks 3, 4 |
| §2.2 Manual `fetch-upstream.js` replaces auto-sync | Task 7 |
| §2.3 `.tmp/html-effectiveness/` discipline + cleanup | Task 1 (helper + gitignore); Tasks 3, 4, 7, 10 (consumers) |
| §3 Non-goals | Honored — no `docs/reports/` gallery, no extra templates, no CI sync |
| §4 Vendoring model + `_meta` shape | Tasks 3 step 5, 4 step 1–9 |
| §5 `fetch-upstream.js` behavior + flags | Task 7 |
| §6 `.tmp/` rules + `_tmp.js` helper API | Task 1 |
| §7 README + SKILL.md updates | Task 9 |
| §8 Plan delta | This entire plan is the delta |
| §9 Acceptance criteria | Tasks 1–10 collectively |
| §10 Out of scope | Honored |

**Placeholder scan:** No `TBD`, no `TODO`, no `fill in details`, no `similar to Task N` (Task 4 explicitly references "the exact procedure from Task 3 steps 1–8" but the procedure itself is fully written in Task 3 — engineer reads Task 3 once and applies the same steps; this is acceptable because re-printing the same 8 steps 19 times would be noise). Every code step shows code. Every commit step shows the commit command.

**Type consistency:**

- `getTmpDir(purpose)` / `cleanup(purpose)` / `withTmp(purpose, fn)` — same signature in Task 1 (definition), Task 2 (consumer in `extract.js`), Task 7 (consumer in `fetch-upstream.js`).
- `fetchUpstreamFile(filename)` / `fetchUpstreamSha(ref?)` / `extractParts(html)` — defined in Task 2, consumed in Task 7.
- Manifest slot schema `{ type, required?, of? }` consistent across Tasks 3, 4, 5.
- `manifest._meta` shape (`upstream_repo`, `upstream_sha`, `fetched_at`, `note`) consistent across Tasks 3, 5, 6, 7.
- Render-script CLI `--template=<id> --data=<path> --out=<path>` consistent with the already-shipped `scripts/render.js`.

**Risk notes for executor:**

- Upstream filename guesses (`<id>-<slug>.html`) in Task 4 may diverge from actual upstream names. If a `fetch` 404s, inspect the upstream repo directly (`gh api repos/ThariqS/html-effectiveness/contents | jq '.[].name'`) and use the actual filename. Update the manifest `tmpl` entry to match what you commit locally; the manifest is the source of truth for local paths.
- Per-template `<style>` / `<script>` blocks can balloon a `.html.tmpl`. If a single template exceeds ~300 lines after extraction, prefer aggressive selector namespacing and hoisting truly generic rules to `assets/` rather than inflating the tmpl.
- `gh` CLI must be authenticated against github.com. If you see `gh: not authenticated`, run `gh auth login` interactively before resuming Task 3.
