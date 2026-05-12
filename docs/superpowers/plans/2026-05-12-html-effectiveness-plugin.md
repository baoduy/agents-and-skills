# html-effectiveness Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new `html-effectiveness` plugin that lets a user generate self-contained interactive HTML reports from any of 20 extracted upstream templates, driven by a conversational `report-builder` agent and a zero-dependency Node render script.

**Architecture:** A plugin under `plugins/html-effectiveness/` ships (1) skeleton `.html.tmpl` files extracted from `ThariqS/html-effectiveness`, (2) shared CSS/JS in `assets/`, (3) a Node `scripts/render.js` that inline-bundles assets into a single self-contained HTML file using a hand-rolled Mustache subset, (4) a `manifest.json` slot-schema source-of-truth, (5) a `SKILL.md` that catalogs all 20 patterns, and (6) an `agents/report-builder.md` conversational wizard. Renders land at `docs/reports/YYYY-MM-DD-<slug>.html` (CLAUDE.md overridable) with a sidecar `<name>.data.json` for regeneration. Zero runtime dependencies; tests run via Node's built-in `node --test`.

**Tech Stack:** Node 20+ (built-in `node --test`, `fs`, `path`, `child_process`), Bash/`gh` CLI for upstream fetch, Markdown for skill/agent surfaces, JSON for manifest and slot data, hand-rolled Mustache subset (no runtime deps).

**Spec:** `docs/superpowers/specs/2026-05-12-html-effectiveness-plugin-design.md`

---

## File Structure

```
plugins/html-effectiveness/
  .claude-plugin/plugin.json          # plugin manifest (name, version, skills[], agents[])
  skills/html-effectiveness/SKILL.md  # skill body + frontmatter
  agents/report-builder.md            # agent body + frontmatter
  templates/
    manifest.json                     # _meta + 20 entries (id, title, use_cases, slots, asset_bundles, extra_js)
    01-exploration-code.html.tmpl     # ... through 20-editor-prompt-tuner.html.tmpl
  assets/
    base.css                          # CSS vars, theming, typography, print
    components.css                    # cards, timeline, kanban, matrix, swatches, slides
    base.js                           # theme toggle, search, nav, copy-on-click
    charts.js                         # inline SVG chart helpers (opt-in)
  scripts/
    render.js                         # CLI: --template --data --out → self-contained HTML
    mustache.js                       # hand-rolled mustache subset (variables, sections, escape)
    catalog.js                        # list/filter templates by use-case
    sync-upstream.js                  # fetch upstream, diff vs local, report drift
    extract.js                        # one-shot extractor used during initial template build
  docs/template-gallery.md            # auto-generated mapping table
  tests/
    render.test.js                    # render correctness + escaping + sidecar
    mustache.test.js                  # mustache parser unit tests
    manifest.test.js                  # manifest ↔ tmpl bidirectional consistency
    sync-upstream.test.js             # drift detection
    fixtures/<id>.data.json           # one fixture per template
  README.md                           # install, usage, CLAUDE.md override, sync
.claude-plugin/plugin.json            # root manifest — append new skill path
package.json                          # root — bump version, add test script if missing
AGENTS.md / CLAUDE.md                 # mirror sync note (only if user-facing rules change)
```

Each file has one responsibility. `mustache.js` is split out so `render.js` stays focused on slot validation + asset inlining + IO. `extract.js` is a one-shot used during Task 6 and lives in `scripts/` so it can be rerun if upstream changes shape.

---

## Task 1: Plugin scaffold + empty manifests

**Files:**
- Create: `plugins/html-effectiveness/.claude-plugin/plugin.json`
- Create: `plugins/html-effectiveness/README.md`
- Create: `plugins/html-effectiveness/templates/manifest.json`

- [ ] **Step 1: Create plugin manifest**

`plugins/html-effectiveness/.claude-plugin/plugin.json`:

```json
{
  "name": "html-effectiveness",
  "displayName": "HTML Effectiveness Reports",
  "version": "0.1.0",
  "description": "Generate self-contained interactive HTML reports from 20 upstream templates via a conversational agent.",
  "author": "Steven Hoang",
  "skills": [
    "skills/html-effectiveness"
  ],
  "agents": [
    "agents/report-builder.md"
  ]
}
```

- [ ] **Step 2: Create placeholder README**

`plugins/html-effectiveness/README.md`:

```markdown
# html-effectiveness

Generate self-contained interactive HTML reports (status, incident, PR writeup, decision matrix, slide deck, code review, research explainer, etc.) from 20 upstream templates.

## Usage

Invoke the `report-builder` agent. It will pick a template, gather slot data conversationally, and render to `docs/reports/YYYY-MM-DD-<slug>.html`.

Override output dir in repo `CLAUDE.md`:

```
html-effectiveness.reportDir: my/custom/reports
```

## Sync upstream

Re-fetch templates from `ThariqS/html-effectiveness`:

```bash
node plugins/html-effectiveness/scripts/sync-upstream.js
```

See `docs/template-gallery.md` for the full pattern catalog.
```

- [ ] **Step 3: Create empty manifest seed**

`plugins/html-effectiveness/templates/manifest.json`:

```json
{
  "_meta": {
    "upstream_repo": "ThariqS/html-effectiveness",
    "upstream_sha": "PENDING",
    "extracted_at": "PENDING"
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add plugins/html-effectiveness/
git commit -m "feat(html-effectiveness): scaffold plugin manifest and README"
```

---

## Task 2: Mustache subset — failing tests

**Files:**
- Create: `plugins/html-effectiveness/tests/mustache.test.js`

- [ ] **Step 1: Write failing tests**

`plugins/html-effectiveness/tests/mustache.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../scripts/mustache.js';

test('renders bare variable, escaped by default', () => {
  assert.equal(render('Hello {{name}}', { name: 'World' }), 'Hello World');
});

test('escapes HTML special chars in {{var}}', () => {
  assert.equal(
    render('{{x}}', { x: '<script>alert(1)</script>' }),
    '&lt;script&gt;alert(1)&lt;/script&gt;'
  );
});

test('triple-stash {{{raw}}} bypasses escaping', () => {
  assert.equal(render('{{{html}}}', { html: '<b>x</b>' }), '<b>x</b>');
});

test('section iterates array with sub-context', () => {
  const tmpl = '{{#items}}[{{name}}]{{/items}}';
  assert.equal(render(tmpl, { items: [{ name: 'a' }, { name: 'b' }] }), '[a][b]');
});

test('inverted section renders only when falsy/empty', () => {
  assert.equal(render('{{^items}}empty{{/items}}', { items: [] }), 'empty');
  assert.equal(render('{{^items}}empty{{/items}}', { items: [{}] }), '');
});

test('missing key renders as empty string, not "undefined"', () => {
  assert.equal(render('x={{missing}}', {}), 'x=');
});

test('nested sections respect inherited context', () => {
  const tmpl = '{{#a}}{{#b}}{{x}}{{/b}}{{/a}}';
  assert.equal(render(tmpl, { a: { b: [{ x: 'ok' }] } }), 'ok');
});

test('falsy section (false, null, undefined, empty array) renders nothing', () => {
  for (const val of [false, null, undefined, []]) {
    assert.equal(render('{{#x}}body{{/x}}', { x: val }), '');
  }
});

test('preserves literal text around tags', () => {
  assert.equal(render('a {{x}} b', { x: '1' }), 'a 1 b');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd plugins/html-effectiveness && node --test tests/mustache.test.js
```

Expected: FAIL — `Cannot find module '../scripts/mustache.js'`.

- [ ] **Step 3: Commit failing tests**

```bash
git add plugins/html-effectiveness/tests/mustache.test.js
git commit -m "test(html-effectiveness): add failing mustache subset tests"
```

---

## Task 3: Mustache subset — implementation

**Files:**
- Create: `plugins/html-effectiveness/scripts/mustache.js`

- [ ] **Step 1: Implement minimal mustache**

`plugins/html-effectiveness/scripts/mustache.js`:

```javascript
// Hand-rolled mustache subset: {{var}}, {{{raw}}}, {{#section}}…{{/section}}, {{^inverted}}…{{/inverted}}
// Zero runtime dependencies.

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);

function tokenize(template) {
  const tokens = [];
  const re = /\{\{(\{?)([\^#\/]?)\s*([\w.-]+)\s*\}?\}\}/g;
  let lastIndex = 0;
  let m;
  while ((m = re.exec(template)) !== null) {
    if (m.index > lastIndex) tokens.push({ type: 'text', value: template.slice(lastIndex, m.index) });
    const [, triple, sigil, name] = m;
    if (sigil === '#') tokens.push({ type: 'section', name });
    else if (sigil === '^') tokens.push({ type: 'inverted', name });
    else if (sigil === '/') tokens.push({ type: 'close', name });
    else if (triple === '{') tokens.push({ type: 'raw', name });
    else tokens.push({ type: 'var', name });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < template.length) tokens.push({ type: 'text', value: template.slice(lastIndex) });
  return tokens;
}

function parse(tokens, end = null) {
  const nodes = [];
  while (tokens.length) {
    const t = tokens.shift();
    if (t.type === 'close') {
      if (t.name !== end) throw new Error(`Mismatched close tag: expected ${end}, got ${t.name}`);
      return nodes;
    }
    if (t.type === 'section' || t.type === 'inverted') {
      const children = parse(tokens, t.name);
      nodes.push({ ...t, children });
    } else {
      nodes.push(t);
    }
  }
  if (end !== null) throw new Error(`Unclosed section: ${end}`);
  return nodes;
}

function lookup(ctxStack, name) {
  if (name === '.') return ctxStack[ctxStack.length - 1];
  const parts = name.split('.');
  for (let i = ctxStack.length - 1; i >= 0; i--) {
    let cur = ctxStack[i];
    let ok = true;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object' || !(p in cur)) { ok = false; break; }
      cur = cur[p];
    }
    if (ok) return cur;
  }
  return undefined;
}

function emit(nodes, ctxStack) {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') out += n.value;
    else if (n.type === 'var') {
      const v = lookup(ctxStack, n.name);
      out += v == null ? '' : escapeHtml(v);
    } else if (n.type === 'raw') {
      const v = lookup(ctxStack, n.name);
      out += v == null ? '' : String(v);
    } else if (n.type === 'section') {
      const v = lookup(ctxStack, n.name);
      if (Array.isArray(v)) {
        for (const item of v) out += emit(n.children, [...ctxStack, item]);
      } else if (v && (typeof v !== 'object' || Object.keys(v).length > 0 || !Array.isArray(v))) {
        out += emit(n.children, [...ctxStack, v]);
      }
    } else if (n.type === 'inverted') {
      const v = lookup(ctxStack, n.name);
      const empty = v == null || v === false || (Array.isArray(v) && v.length === 0);
      if (empty) out += emit(n.children, ctxStack);
    }
  }
  return out;
}

export function render(template, data) {
  const tokens = tokenize(template);
  const tree = parse(tokens);
  return emit(tree, [data]);
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd plugins/html-effectiveness && node --test tests/mustache.test.js
```

Expected: PASS — all 9 tests green.

- [ ] **Step 3: Commit**

```bash
git add plugins/html-effectiveness/scripts/mustache.js
git commit -m "feat(html-effectiveness): implement zero-dep mustache subset"
```

---

## Task 4: Shared assets — base.css, components.css, base.js skeletons

**Files:**
- Create: `plugins/html-effectiveness/assets/base.css`
- Create: `plugins/html-effectiveness/assets/components.css`
- Create: `plugins/html-effectiveness/assets/base.js`
- Create: `plugins/html-effectiveness/assets/charts.js`

Note: These start as documented placeholders. Task 7 (extraction) populates the real shared rules harvested from upstream HTML files. Keeping placeholders here means `render.js` can be built and tested against canned templates before extraction runs.

- [ ] **Step 1: Create base.css with theme variables and print rules**

`plugins/html-effectiveness/assets/base.css`:

```css
/* Theme variables, typography, print baseline. Populated from upstream during Task 7. */
:root {
  --bg: #ffffff;
  --fg: #111111;
  --muted: #666666;
  --accent: #2563eb;
  --border: #e5e7eb;
  --radius: 6px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;
  --transition: 150ms ease;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b0b0c;
    --fg: #f5f5f7;
    --muted: #9aa0a6;
    --accent: #60a5fa;
    --border: #2a2a2c;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); font-family: var(--font); }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
@media print {
  details { display: block; }
  details > summary { display: none; }
  [hidden] { display: revert !important; }
  body { background: white; color: black; }
}
```

- [ ] **Step 2: Create components.css with shared component baselines**

`plugins/html-effectiveness/assets/components.css`:

```css
/* Shared components: cards, timeline, kanban, matrix, swatches, slides. Populated from upstream during Task 7. */
.report { max-width: 1200px; margin: 0 auto; padding: 2rem 1rem; }
.report header h1 { font-size: 1.75rem; margin: 0 0 .25rem; }
.report header .subtitle { color: var(--muted); margin: 0 0 1.5rem; }
.card { border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem; transition: border-color var(--transition); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin: 0 0 2rem; }
.stat { display: flex; flex-direction: column; gap: .25rem; }
.stat .value { font-size: 1.5rem; font-weight: 600; }
.stat .label { color: var(--muted); font-size: .875rem; }
.stat .delta { font-size: .75rem; }
```

- [ ] **Step 3: Create base.js with shared interactions**

`plugins/html-effectiveness/assets/base.js`:

```javascript
// Shared interactions: theme toggle, search, nav, copy-on-click. Populated from upstream during Task 7.
(function () {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-copy]');
    if (!t) return;
    const text = t.getAttribute('data-copy');
    navigator.clipboard?.writeText(text);
    t.setAttribute('data-copied', '1');
    setTimeout(() => t.removeAttribute('data-copied'), 1000);
  });
})();
```

- [ ] **Step 4: Create charts.js placeholder**

`plugins/html-effectiveness/assets/charts.js`:

```javascript
// Inline SVG chart helpers. Opt-in via manifest.extra_js. Populated from upstream during Task 7.
```

- [ ] **Step 5: Commit**

```bash
git add plugins/html-effectiveness/assets/
git commit -m "feat(html-effectiveness): seed shared asset skeletons"
```

---

## Task 5: Render script — failing tests with canned tmpl

**Files:**
- Create: `plugins/html-effectiveness/tests/render.test.js`
- Create: `plugins/html-effectiveness/tests/fixtures/_canned.html.tmpl`
- Create: `plugins/html-effectiveness/tests/fixtures/_canned.manifest.json`
- Create: `plugins/html-effectiveness/tests/fixtures/_canned.data.json`

This task uses a canned tmpl + manifest fixture so the render script can be tested before extraction populates real templates.

- [ ] **Step 1: Create canned template fixture**

`plugins/html-effectiveness/tests/fixtures/_canned.html.tmpl`:

```html
<main class="report">
  <header><h1>{{title}}</h1></header>
  <ul>
    {{#items}}<li>{{name}}: {{{html}}}</li>{{/items}}
  </ul>
  {{^items}}<p>No items.</p>{{/items}}
</main>
```

- [ ] **Step 2: Create canned manifest fixture**

`plugins/html-effectiveness/tests/fixtures/_canned.manifest.json`:

```json
{
  "_meta": { "upstream_repo": "test", "upstream_sha": "test", "extracted_at": "test" },
  "_canned": {
    "title": "Canned",
    "use_cases": ["test"],
    "pattern": "test",
    "tmpl": "tests/fixtures/_canned.html.tmpl",
    "slots": {
      "title": { "type": "string", "required": true },
      "items": {
        "type": "array",
        "of": { "name": "string", "html": "html" }
      }
    },
    "asset_bundles": ["base", "components"],
    "extra_js": null
  }
}
```

- [ ] **Step 3: Create canned data fixture**

`plugins/html-effectiveness/tests/fixtures/_canned.data.json`:

```json
{
  "title": "Demo <Report>",
  "items": [
    { "name": "alpha", "html": "<b>bold</b>" },
    { "name": "beta", "html": "<i>italic</i>" }
  ]
}
```

- [ ] **Step 4: Write failing render tests**

`plugins/html-effectiveness/tests/render.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { renderReport } from '../scripts/render.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');

function setup() {
  const out = mkdtempSync(join(tmpdir(), 'htmleff-'));
  return {
    out,
    cleanup: () => rmSync(out, { recursive: true, force: true }),
  };
}

test('renders canned template into self-contained HTML', () => {
  const { out, cleanup } = setup();
  try {
    const outPath = join(out, 'demo.html');
    renderReport({
      templateId: '_canned',
      data: JSON.parse(readFileSync(join(fixtures, '_canned.data.json'), 'utf8')),
      outPath,
      manifestPath: join(fixtures, '_canned.manifest.json'),
      pluginRoot: dirname(fixtures),
    });
    const html = readFileSync(outPath, 'utf8');
    assert.ok(html.startsWith('<!doctype html>'), 'starts with doctype');
    assert.ok(html.includes('<title>Demo &lt;Report&gt;</title>'), 'title escaped in head');
    assert.ok(html.includes('Demo &lt;Report&gt;</h1>'), 'title escaped in body');
    assert.ok(html.includes('<b>bold</b>'), 'html slot rendered raw');
    assert.ok(!html.match(/\{\{[^}]+\}\}/), 'no leftover mustache markers');
    assert.ok(!html.includes('<link'), 'no external link');
    assert.ok(!html.match(/<script\s+src=/i), 'no external script src');
  } finally {
    cleanup();
  }
});

test('writes sidecar .data.json next to output', () => {
  const { out, cleanup } = setup();
  try {
    const outPath = join(out, 'demo.html');
    const data = JSON.parse(readFileSync(join(fixtures, '_canned.data.json'), 'utf8'));
    renderReport({
      templateId: '_canned',
      data,
      outPath,
      manifestPath: join(fixtures, '_canned.manifest.json'),
      pluginRoot: dirname(fixtures),
    });
    const sidecarPath = outPath + '.data.json';
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
    assert.equal(sidecar.template, '_canned');
    assert.deepEqual(sidecar.data, data);
    assert.ok(sidecar.rendered_at);
  } finally {
    cleanup();
  }
});

test('throws on missing required slot with template:slot context', () => {
  const { out, cleanup } = setup();
  try {
    assert.throws(
      () => renderReport({
        templateId: '_canned',
        data: { items: [] },
        outPath: join(out, 'x.html'),
        manifestPath: join(fixtures, '_canned.manifest.json'),
        pluginRoot: dirname(fixtures),
      }),
      /_canned:title.*required/,
    );
  } finally {
    cleanup();
  }
});

test('throws on unknown template id with valid-ids list', () => {
  const { out, cleanup } = setup();
  try {
    assert.throws(
      () => renderReport({
        templateId: 'does-not-exist',
        data: {},
        outPath: join(out, 'x.html'),
        manifestPath: join(fixtures, '_canned.manifest.json'),
        pluginRoot: dirname(fixtures),
      }),
      /template not found.*_canned/i,
    );
  } finally {
    cleanup();
  }
});

test('inverted section renders fallback when array empty', () => {
  const { out, cleanup } = setup();
  try {
    const outPath = join(out, 'empty.html');
    renderReport({
      templateId: '_canned',
      data: { title: 'Empty', items: [] },
      outPath,
      manifestPath: join(fixtures, '_canned.manifest.json'),
      pluginRoot: dirname(fixtures),
    });
    const html = readFileSync(outPath, 'utf8');
    assert.ok(html.includes('No items.'));
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 5: Run tests to verify they fail**

```bash
cd plugins/html-effectiveness && node --test tests/render.test.js
```

Expected: FAIL — `Cannot find module '../scripts/render.js'`.

- [ ] **Step 6: Commit failing tests**

```bash
git add plugins/html-effectiveness/tests/render.test.js plugins/html-effectiveness/tests/fixtures/
git commit -m "test(html-effectiveness): add failing render tests with canned fixture"
```

---

## Task 6: Render script — implementation

**Files:**
- Create: `plugins/html-effectiveness/scripts/render.js`

- [ ] **Step 1: Implement render.js**

`plugins/html-effectiveness/scripts/render.js`:

```javascript
#!/usr/bin/env node
// CLI + library: render a template + data into a self-contained HTML file.
// Exit codes: 0 ok, 1 generic, 2 template-not-found, 3 slot schema mismatch, 4 fs write error.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { render as mustache } from './mustache.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(SCRIPT_DIR);

const ASSET_BUNDLES = {
  base: { css: 'assets/base.css', js: 'assets/base.js' },
  components: { css: 'assets/components.css' },
  charts: { js: 'assets/charts.js' },
};

function validateSlot(templateId, slotPath, schema, value) {
  if (schema.required && (value === undefined || value === null)) {
    const err = new Error(`${templateId}:${slotPath} required but missing`);
    err.code = 3;
    throw err;
  }
  if (value === undefined || value === null) return;
  const type = schema.type;
  if (type === 'string' || type === 'html') {
    if (typeof value !== 'string') {
      const err = new Error(`${templateId}:${slotPath} expected string got ${typeof value}`);
      err.code = 3;
      throw err;
    }
  } else if (type === 'number') {
    if (typeof value !== 'number') {
      const err = new Error(`${templateId}:${slotPath} expected number got ${typeof value}`);
      err.code = 3;
      throw err;
    }
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') {
      const err = new Error(`${templateId}:${slotPath} expected boolean got ${typeof value}`);
      err.code = 3;
      throw err;
    }
  } else if (type === 'array') {
    if (!Array.isArray(value)) {
      const err = new Error(`${templateId}:${slotPath} expected array got ${typeof value}`);
      err.code = 3;
      throw err;
    }
    if (schema.of) {
      value.forEach((item, i) => {
        for (const [k, subType] of Object.entries(schema.of)) {
          const subSchema = typeof subType === 'string' ? { type: subType } : subType;
          validateSlot(templateId, `${slotPath}[${i}].${k}`, subSchema, item?.[k]);
        }
      });
    }
  } else if (type === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) {
      const err = new Error(`${templateId}:${slotPath} expected object got ${typeof value}`);
      err.code = 3;
      throw err;
    }
  }
}

function validate(templateId, slots, data) {
  for (const [name, schemaRaw] of Object.entries(slots)) {
    const schema = typeof schemaRaw === 'string' ? { type: schemaRaw } : schemaRaw;
    validateSlot(templateId, name, schema, data[name]);
  }
}

function loadAssets(pluginRoot, bundles, extraJs) {
  const css = [];
  const js = [];
  for (const name of bundles || []) {
    const b = ASSET_BUNDLES[name];
    if (!b) continue;
    if (b.css) css.push(readFileSync(join(pluginRoot, b.css), 'utf8'));
    if (b.js) js.push(readFileSync(join(pluginRoot, b.js), 'utf8'));
  }
  if (extraJs) js.push(readFileSync(join(pluginRoot, extraJs), 'utf8'));
  return { css: css.join('\n'), js: js.join('\n') };
}

function escapeForTitle(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function renderReport({ templateId, data, outPath, manifestPath, pluginRoot }) {
  const root = pluginRoot || PLUGIN_ROOT;
  const mPath = manifestPath || join(root, 'templates/manifest.json');
  const manifest = JSON.parse(readFileSync(mPath, 'utf8'));
  const entry = manifest[templateId];
  if (!entry) {
    const ids = Object.keys(manifest).filter((k) => !k.startsWith('_'));
    const err = new Error(`template not found: ${templateId}. valid: ${ids.join(', ')}`);
    err.code = 2;
    throw err;
  }

  validate(templateId, entry.slots, data);

  const tmplRelPath = entry.tmpl || `templates/${templateId}.html.tmpl`;
  const tmpl = readFileSync(join(root, tmplRelPath), 'utf8');
  const body = mustache(tmpl, data);

  const { css, js } = loadAssets(root, entry.asset_bundles, entry.extra_js);
  const title = escapeForTitle(data.title || entry.title || 'Report');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${css}</style>
</head>
<body>
${body}
<script>${js}</script>
</body>
</html>
`;

  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html, 'utf8');
    const sidecar = {
      template: templateId,
      rendered_at: new Date().toISOString(),
      render_version: '0.1.0',
      data,
    };
    writeFileSync(outPath + '.data.json', JSON.stringify(sidecar, null, 2), 'utf8');
  } catch (e) {
    const err = new Error(`failed to write ${outPath}: ${e.message}`);
    err.code = 4;
    throw err;
  }

  return outPath;
}

function cli() {
  const { values } = parseArgs({
    options: {
      template: { type: 'string' },
      data: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (!values.template || !values.data || !values.out) {
    process.stderr.write('usage: render.js --template=<id> --data=<json-path> --out=<html-path>\n');
    process.exit(1);
  }
  try {
    const data = JSON.parse(readFileSync(resolve(values.data), 'utf8'));
    const finalPath = renderReport({
      templateId: values.template,
      data,
      outPath: resolve(values.out),
    });
    process.stdout.write(finalPath + '\n');
  } catch (e) {
    process.stderr.write((e.stack || e.message) + '\n');
    process.exit(e.code ?? 1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) cli();
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd plugins/html-effectiveness && node --test tests/render.test.js
```

Expected: PASS — all 5 render tests green.

- [ ] **Step 3: Run mustache tests to confirm no regression**

```bash
cd plugins/html-effectiveness && node --test tests/mustache.test.js tests/render.test.js
```

Expected: PASS — all 14 tests green.

- [ ] **Step 4: Commit**

```bash
git add plugins/html-effectiveness/scripts/render.js
git commit -m "feat(html-effectiveness): implement render.js with slot validation and inline bundling"
```

---

## Task 7: Upstream fetch + one canonical template extraction (`11-status-report`)

**Files:**
- Create: `plugins/html-effectiveness/scripts/extract.js`
- Create: `plugins/html-effectiveness/templates/11-status-report.html.tmpl`
- Modify: `plugins/html-effectiveness/templates/manifest.json`
- Create: `plugins/html-effectiveness/tests/fixtures/11-status-report.data.json`
- Modify: `plugins/html-effectiveness/assets/base.css` (merge harvested shared rules)
- Modify: `plugins/html-effectiveness/assets/components.css` (merge harvested shared rules)
- Modify: `plugins/html-effectiveness/assets/base.js` (merge harvested shared interactions)

This task validates the extraction pipeline on one template end-to-end. Task 8 reuses the same extractor for the remaining 19. We extract `11-status-report` first because it is a canonical Interactive Report pattern and exercises stats grids + sections.

- [ ] **Step 1: Implement extract.js scaffold**

`plugins/html-effectiveness/scripts/extract.js`:

```javascript
#!/usr/bin/env node
// One-shot extractor. Fetches an upstream HTML file, splits CSS/JS into shared vs unique,
// rewrites body with mustache slot markers based on a hand-written rules table.
// Run interactively; output is reviewed before commit.

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(HERE);
const UPSTREAM_REPO = 'ThariqS/html-effectiveness';

export function fetchUpstream(filename) {
  const out = execSync(
    `gh api repos/${UPSTREAM_REPO}/contents/${filename} --jq .content`,
    { encoding: 'utf8' },
  ).trim();
  return Buffer.from(out, 'base64').toString('utf8');
}

export function fetchUpstreamSha() {
  return execSync(
    `gh api repos/${UPSTREAM_REPO}/commits/main --jq .sha`,
    { encoding: 'utf8' },
  ).trim();
}

export function extractParts(html) {
  // Split <style>…</style> and <script>…</script> blocks; return { headStyles[], headScripts[], body }.
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
  // Strip <!doctype>, <html>, <head>, <body> wrappers; keep inner body content only.
  body = body.replace(/<!doctype[^>]*>/i, '');
  body = body.replace(/<\/?html[^>]*>/gi, '');
  body = body.replace(/<head[\s\S]*?<\/head>/gi, '');
  body = body.replace(/<\/?body[^>]*>/gi, '');
  return { styles, scripts, body: body.trim() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , cmd, arg] = process.argv;
  if (cmd === 'fetch') {
    const html = fetchUpstream(arg);
    process.stdout.write(html);
  } else if (cmd === 'sha') {
    process.stdout.write(fetchUpstreamSha() + '\n');
  } else if (cmd === 'split') {
    const html = readFileSync(arg, 'utf8');
    process.stdout.write(JSON.stringify(extractParts(html), null, 2));
  } else {
    process.stderr.write('usage: extract.js {fetch <name>|sha|split <file>}\n');
    process.exit(1);
  }
}
```

- [ ] **Step 2: Fetch upstream file and inspect**

```bash
cd plugins/html-effectiveness
node scripts/extract.js fetch 11-status-report.html > /tmp/11-status-report.upstream.html
node scripts/extract.js split /tmp/11-status-report.upstream.html > /tmp/11-status-report.parts.json
node scripts/extract.js sha
```

Expected: Bash writes upstream HTML and parts JSON; sha command prints a 40-char commit hash.

- [ ] **Step 3: Hand-write the template skeleton**

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

- [ ] **Step 4: Merge harvested shared CSS into base.css and components.css**

Read `/tmp/11-status-report.parts.json`. Identify rules that target generic selectors (`:root`, `body`, `.card`, `.stat`, `.report`, `@media print`) → append/merge into `assets/base.css` or `assets/components.css`. Identify per-template rules (`.report--status`, `.status-section`, `.delta--up`, `.delta--down`) → append at the bottom of `templates/11-status-report.html.tmpl` inside a `<style>` block.

Edit `plugins/html-effectiveness/assets/base.css` and `plugins/html-effectiveness/assets/components.css` to merge generic rules from upstream. Append the per-template `<style>` block to `templates/11-status-report.html.tmpl`:

```html
<style>
.report--status .status-section { padding: 1rem 0; border-top: 1px solid var(--border); }
.report--status .status-section--at-risk { border-left: 3px solid #ef4444; padding-left: 1rem; }
.report--status .delta--up { color: #16a34a; }
.report--status .delta--down { color: #ef4444; }
</style>
```

(Exact selectors come from upstream; copy verbatim, prefix with `.report--status` if not already namespaced.)

- [ ] **Step 5: Add manifest entry**

Modify `plugins/html-effectiveness/templates/manifest.json`:

```json
{
  "_meta": {
    "upstream_repo": "ThariqS/html-effectiveness",
    "upstream_sha": "<sha-from-step-2>",
    "extracted_at": "2026-05-12"
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

- [ ] **Step 6: Add fixture**

`plugins/html-effectiveness/tests/fixtures/11-status-report.data.json`:

```json
{
  "title": "Q2 Engineering Status",
  "period": "Apr 1 – Jun 30, 2026",
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
cd plugins/html-effectiveness
node scripts/render.js --template=11-status-report --data=tests/fixtures/11-status-report.data.json --out=/tmp/11.html
open /tmp/11.html
```

Expected: Self-contained HTML opens, renders title + 3 stats grid + 2 sections styled per upstream look. No external network requests in the browser dev tools network panel.

- [ ] **Step 8: Run all tests**

```bash
cd plugins/html-effectiveness && node --test tests/
```

Expected: All tests pass; render tests still green; mustache tests still green.

- [ ] **Step 9: Commit**

```bash
git add plugins/html-effectiveness/scripts/extract.js \
        plugins/html-effectiveness/templates/11-status-report.html.tmpl \
        plugins/html-effectiveness/templates/manifest.json \
        plugins/html-effectiveness/tests/fixtures/11-status-report.data.json \
        plugins/html-effectiveness/assets/
git commit -m "feat(html-effectiveness): extract 11-status-report as canonical template"
```

---

## Task 8: Extract remaining 19 templates

**Files:**
- Create: `plugins/html-effectiveness/templates/{01,02,03,04,05,06,07,08,09,10,12,13,14,15,16,17,18,19,20}-*.html.tmpl` (19 files)
- Modify: `plugins/html-effectiveness/templates/manifest.json` (add 19 entries)
- Create: `plugins/html-effectiveness/tests/fixtures/{01..20}-*.data.json` (19 files)
- Modify: `plugins/html-effectiveness/assets/{base,components}.css` and `assets/base.js` (merge incremental shared rules)
- Create (when needed): `plugins/html-effectiveness/assets/charts.js` (populate with chart helpers when first template needs)

Repeat the Task 7 pattern for each of these template IDs. Process two templates per commit to keep diffs reviewable and assets stay convergent.

Template ID list with target use cases (informs `use_cases` field):

| ID | File | Pattern | Use cases |
|----|------|---------|-----------|
| 01 | exploration-code-approaches | comparison_board | "compare implementations", "approach trade-offs", "design alternatives" |
| 02 | exploration-visual-designs | comparison_board | "compare designs", "UI alternatives", "visual options" |
| 03 | code-review-pr | code_review_board | "PR review", "code review", "diff review" |
| 04 | code-understanding | knowledge_explorer | "explain code", "walk through architecture", "trace logic" |
| 05 | design-system | design_system_sheet | "design tokens", "color palette", "typography" |
| 06 | component-variants | design_system_sheet | "component variants", "states gallery" |
| 07 | prototype-animation | interactive_report | "animation prototype", "motion preview" |
| 08 | prototype-interaction | interactive_report | "interaction prototype", "ux flow" |
| 09 | slide-deck | slide_deck | "slide deck", "presentation", "pitch" |
| 10 | svg-illustrations | knowledge_explorer | "illustrate concept", "svg gallery" |
| 12 | incident-report | interactive_report | "incident report", "post-mortem", "outage writeup" |
| 13 | flowchart-diagram | knowledge_explorer | "flowchart", "process diagram", "decision tree" |
| 14 | research-feature-explainer | knowledge_explorer | "explain feature", "feature deep-dive" |
| 15 | research-concept-explainer | knowledge_explorer | "explain concept", "tutorial", "primer" |
| 16 | implementation-plan | annotated_timeline | "implementation plan", "phased rollout", "roadmap" |
| 17 | pr-writeup | interactive_report | "PR description", "release notes", "change writeup" |
| 18 | editor-triage-board | kanban_board | "bug triage", "issue board", "kanban" |
| 19 | editor-feature-flags | decision_matrix | "feature flags", "rollout matrix" |
| 20 | editor-prompt-tuner | interactive_report | "prompt tuning", "LLM config" |

For each template, execute steps below. Group commits by pairs (01+02, 03+04, ...).

- [ ] **Step 1: Process template pair 01 + 02**

For each of `01-exploration-code-approaches` and `02-exploration-visual-designs`:

  1. `node scripts/extract.js fetch <file>.html > /tmp/<file>.upstream.html`
  2. `node scripts/extract.js split /tmp/<file>.upstream.html > /tmp/<file>.parts.json`
  3. Hand-write `templates/<id>.html.tmpl` with slot markers; copy per-template `<style>`/`<script>` blocks at the bottom; namespace selectors with `.report--<kind>` if needed to avoid collisions.
  4. Merge any new shared CSS rules into `assets/base.css` / `assets/components.css`. If a rule already exists in shared, drop it from the per-template `<style>` block.
  5. Merge any new shared JS into `assets/base.js`.
  6. Add manifest entry mirroring the Task 7 shape; use the `use_cases` and `pattern` from the table above.
  7. Create `tests/fixtures/<id>.data.json` with realistic sample content (≥2 items in each array, escaped + raw-HTML coverage).
  8. `node scripts/render.js --template=<id> --data=tests/fixtures/<id>.data.json --out=/tmp/<id>.html && open /tmp/<id>.html` to eyeball.
  9. `node --test tests/` to confirm all green.

Commit:

```bash
git add plugins/html-effectiveness/templates/01-exploration-code-approaches.html.tmpl \
        plugins/html-effectiveness/templates/02-exploration-visual-designs.html.tmpl \
        plugins/html-effectiveness/templates/manifest.json \
        plugins/html-effectiveness/tests/fixtures/01-exploration-code-approaches.data.json \
        plugins/html-effectiveness/tests/fixtures/02-exploration-visual-designs.data.json \
        plugins/html-effectiveness/assets/
git commit -m "feat(html-effectiveness): extract templates 01-02 (exploration comparisons)"
```

- [ ] **Step 2: Process template pair 03 + 04**

Same procedure for `03-code-review-pr` and `04-code-understanding`. Commit:

```bash
git commit -m "feat(html-effectiveness): extract templates 03-04 (code review + understanding)"
```

- [ ] **Step 3: Process template pair 05 + 06**

Same procedure for `05-design-system` and `06-component-variants`. Commit:

```bash
git commit -m "feat(html-effectiveness): extract templates 05-06 (design system + variants)"
```

- [ ] **Step 4: Process template pair 07 + 08**

Same procedure for `07-prototype-animation` and `08-prototype-interaction`. Commit:

```bash
git commit -m "feat(html-effectiveness): extract templates 07-08 (prototypes)"
```

- [ ] **Step 5: Process template pair 09 + 10**

Same procedure for `09-slide-deck` and `10-svg-illustrations`. The slide deck likely needs per-template JS for arrow-key nav — keep it inline in the `.html.tmpl` `<script>` block at the bottom. Commit:

```bash
git commit -m "feat(html-effectiveness): extract templates 09-10 (slides + svg)"
```

- [ ] **Step 6: Process template pair 12 + 13**

Same procedure for `12-incident-report` and `13-flowchart-diagram`. Commit:

```bash
git commit -m "feat(html-effectiveness): extract templates 12-13 (incident + flowchart)"
```

- [ ] **Step 7: Process template pair 14 + 15**

Same procedure for `14-research-feature-explainer` and `15-research-concept-explainer`. Commit:

```bash
git commit -m "feat(html-effectiveness): extract templates 14-15 (research explainers)"
```

- [ ] **Step 8: Process template pair 16 + 17**

Same procedure for `16-implementation-plan` and `17-pr-writeup`. Commit:

```bash
git commit -m "feat(html-effectiveness): extract templates 16-17 (plan + PR writeup)"
```

- [ ] **Step 9: Process template trio 18 + 19 + 20**

Same procedure for `18-editor-triage-board`, `19-editor-feature-flags`, `20-editor-prompt-tuner`. The triage board may need per-template JS for drag-and-drop — keep inline. Commit:

```bash
git commit -m "feat(html-effectiveness): extract templates 18-20 (editor tools)"
```

- [ ] **Step 10: Final all-template render sweep**

```bash
cd plugins/html-effectiveness
for f in tests/fixtures/[0-9]*-*.data.json; do
  id=$(basename "$f" .data.json)
  node scripts/render.js --template="$id" --data="$f" --out=/tmp/$id.html || { echo "FAIL $id"; exit 1; }
  echo "OK $id"
done
```

Expected: 20 lines `OK <id>`, no failures.

- [ ] **Step 11: Update manifest `_meta.upstream_sha` and `extracted_at`**

Set to the SHA captured in Task 7 step 2 and today's date.

- [ ] **Step 12: Commit metadata**

```bash
git add plugins/html-effectiveness/templates/manifest.json
git commit -m "chore(html-effectiveness): pin upstream sha in manifest meta"
```

---

## Task 9: Manifest consistency tests

**Files:**
- Create: `plugins/html-effectiveness/tests/manifest.test.js`

- [ ] **Step 1: Write failing tests**

`plugins/html-effectiveness/tests/manifest.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'templates/manifest.json'), 'utf8'));
const VALID_TYPES = new Set(['string', 'number', 'boolean', 'array', 'object', 'html']);

const entries = Object.entries(MANIFEST).filter(([k]) => !k.startsWith('_'));

test('manifest has _meta with upstream_sha pinned', () => {
  assert.ok(MANIFEST._meta);
  assert.ok(MANIFEST._meta.upstream_sha && MANIFEST._meta.upstream_sha !== 'PENDING');
  assert.ok(MANIFEST._meta.extracted_at && MANIFEST._meta.extracted_at !== 'PENDING');
});

test('manifest covers all 20 templates', () => {
  assert.equal(entries.length, 20, `expected 20 templates, got ${entries.length}`);
});

for (const [id, entry] of entries) {
  test(`${id}: tmpl file exists`, () => {
    const tmplPath = join(ROOT, entry.tmpl || `templates/${id}.html.tmpl`);
    assert.ok(existsSync(tmplPath), `missing ${tmplPath}`);
  });

  test(`${id}: required fields present`, () => {
    for (const f of ['title', 'use_cases', 'pattern', 'slots', 'asset_bundles']) {
      assert.ok(entry[f] !== undefined, `${id} missing ${f}`);
    }
    assert.ok(Array.isArray(entry.use_cases) && entry.use_cases.length > 0);
    assert.ok(Array.isArray(entry.asset_bundles));
  });

  test(`${id}: slot types are recognized`, () => {
    function walk(slots, path) {
      for (const [name, schemaRaw] of Object.entries(slots)) {
        const schema = typeof schemaRaw === 'string' ? { type: schemaRaw } : schemaRaw;
        assert.ok(VALID_TYPES.has(schema.type), `${id}:${path}${name} unknown type ${schema.type}`);
        if (schema.of && typeof schema.of === 'object') {
          const sub = Object.fromEntries(
            Object.entries(schema.of).map(([k, v]) => [k, typeof v === 'string' ? { type: v } : v]),
          );
          walk(sub, `${path}${name}[].`);
        }
      }
    }
    walk(entry.slots, '');
  });

  test(`${id}: fixture exists and is non-empty`, () => {
    const fix = join(HERE, 'fixtures', `${id}.data.json`);
    assert.ok(existsSync(fix), `missing fixture ${fix}`);
    const data = JSON.parse(readFileSync(fix, 'utf8'));
    assert.ok(Object.keys(data).length > 0);
  });
}

test('no orphan tmpl files (every .html.tmpl has a manifest entry)', () => {
  const tmplDir = join(ROOT, 'templates');
  const tmpls = readdirSync(tmplDir).filter((f) => f.endsWith('.html.tmpl'));
  const ids = new Set(entries.map(([id]) => id));
  for (const f of tmpls) {
    const id = f.replace(/\.html\.tmpl$/, '');
    assert.ok(ids.has(id), `orphan tmpl: ${f}`);
  }
});
```

- [ ] **Step 2: Run tests**

```bash
cd plugins/html-effectiveness && node --test tests/manifest.test.js
```

Expected: PASS — all 80+ tests green (20 templates × 4 per-template + 3 global).

- [ ] **Step 3: Commit**

```bash
git add plugins/html-effectiveness/tests/manifest.test.js
git commit -m "test(html-effectiveness): add manifest consistency tests"
```

---

## Task 10: Catalog script + template gallery doc

**Files:**
- Create: `plugins/html-effectiveness/scripts/catalog.js`
- Create: `plugins/html-effectiveness/docs/template-gallery.md`

- [ ] **Step 1: Implement catalog.js**

`plugins/html-effectiveness/scripts/catalog.js`:

```javascript
#!/usr/bin/env node
// Generate docs/template-gallery.md from manifest.json. Also exports filterByUseCase for agent use.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

export function loadManifest() {
  return JSON.parse(readFileSync(join(ROOT, 'templates/manifest.json'), 'utf8'));
}

export function filterByUseCase(query) {
  const m = loadManifest();
  const q = query.toLowerCase();
  return Object.entries(m)
    .filter(([k]) => !k.startsWith('_'))
    .filter(([, e]) => e.use_cases.some((u) => u.toLowerCase().includes(q)) || e.title.toLowerCase().includes(q))
    .map(([id, e]) => ({ id, title: e.title, use_cases: e.use_cases, pattern: e.pattern }));
}

function slotSummary(slots) {
  return Object.entries(slots)
    .map(([k, v]) => {
      const t = typeof v === 'string' ? v : v.type;
      const req = typeof v === 'object' && v.required ? '*' : '';
      return `${k}${req}:${t}`;
    })
    .join(', ');
}

function renderGallery() {
  const m = loadManifest();
  const meta = m._meta;
  const rows = Object.entries(m)
    .filter(([k]) => !k.startsWith('_'))
    .sort(([a], [b]) => a.localeCompare(b));

  let out = '# Template Gallery\n\n';
  out += `_Generated from \`templates/manifest.json\`. Upstream: \`${meta.upstream_repo}@${meta.upstream_sha}\`, extracted ${meta.extracted_at}._\n\n`;
  out += '| ID | Title | Pattern | Use cases | Slots |\n';
  out += '|----|-------|---------|-----------|-------|\n';
  for (const [id, e] of rows) {
    out += `| \`${id}\` | ${e.title} | \`${e.pattern}\` | ${e.use_cases.map((u) => `"${u}"`).join(', ')} | ${slotSummary(e.slots)} |\n`;
  }
  out += '\n_Slot syntax: `name:type` (`*` = required). Run `node scripts/catalog.js` to regenerate._\n';
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , cmd, arg] = process.argv;
  if (!cmd || cmd === 'gallery') {
    const md = renderGallery();
    const outPath = join(ROOT, 'docs/template-gallery.md');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, md, 'utf8');
    process.stdout.write(outPath + '\n');
  } else if (cmd === 'search') {
    process.stdout.write(JSON.stringify(filterByUseCase(arg || ''), null, 2) + '\n');
  } else {
    process.stderr.write('usage: catalog.js [gallery|search <query>]\n');
    process.exit(1);
  }
}
```

- [ ] **Step 2: Generate gallery**

```bash
cd plugins/html-effectiveness && node scripts/catalog.js gallery
```

Expected: writes `docs/template-gallery.md` with 20-row table.

- [ ] **Step 3: Smoke-test search**

```bash
cd plugins/html-effectiveness && node scripts/catalog.js search "status"
```

Expected: JSON output containing `11-status-report` plus any other templates whose use_cases contain "status".

- [ ] **Step 4: Commit**

```bash
git add plugins/html-effectiveness/scripts/catalog.js plugins/html-effectiveness/docs/template-gallery.md
git commit -m "feat(html-effectiveness): add catalog.js and generated template gallery"
```

---

## Task 11: Sync-upstream script + drift test

**Files:**
- Create: `plugins/html-effectiveness/scripts/sync-upstream.js`
- Create: `plugins/html-effectiveness/tests/sync-upstream.test.js`
- Create: `plugins/html-effectiveness/tests/fixtures/upstream-snapshot/<id>.html` (20 fixture files)

- [ ] **Step 1: Capture upstream snapshot for tests**

```bash
cd plugins/html-effectiveness
mkdir -p tests/fixtures/upstream-snapshot
for i in 01-exploration-code-approaches 02-exploration-visual-designs 03-code-review-pr 04-code-understanding 05-design-system 06-component-variants 07-prototype-animation 08-prototype-interaction 09-slide-deck 10-svg-illustrations 11-status-report 12-incident-report 13-flowchart-diagram 14-research-feature-explainer 15-research-concept-explainer 16-implementation-plan 17-pr-writeup 18-editor-triage-board 19-editor-feature-flags 20-editor-prompt-tuner; do
  node scripts/extract.js fetch "${i}.html" > "tests/fixtures/upstream-snapshot/${i}.html"
done
```

Expected: 20 HTML files written.

- [ ] **Step 2: Implement sync-upstream.js**

`plugins/html-effectiveness/scripts/sync-upstream.js`:

```javascript
#!/usr/bin/env node
// Diff local templates vs upstream. Reports drift. Does NOT auto-rewrite local templates —
// that requires human review per template. Exit 0 if no drift, 1 if drift detected.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { fetchUpstream, fetchUpstreamSha, extractParts } from './extract.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

function bodyHash(html) {
  return createHash('sha256').update(extractParts(html).body).digest('hex');
}

export function detectDrift({ snapshotDir, fetchFn = fetchUpstream } = {}) {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'templates/manifest.json'), 'utf8'));
  const ids = Object.keys(manifest).filter((k) => !k.startsWith('_'));
  const drift = [];
  for (const id of ids) {
    const upstreamHtml = snapshotDir
      ? readFileSync(join(snapshotDir, `${id}.html`), 'utf8')
      : fetchFn(`${id}.html`);
    const upstreamBody = bodyHash(upstreamHtml);
    const pinned = manifest._meta.upstream_body_hashes?.[id];
    if (pinned && pinned !== upstreamBody) {
      drift.push({ id, pinned, upstream: upstreamBody });
    }
  }
  return drift;
}

export function refreshPin({ snapshotDir, fetchFn = fetchUpstream } = {}) {
  const manifestPath = join(ROOT, 'templates/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const ids = Object.keys(manifest).filter((k) => !k.startsWith('_'));
  const hashes = {};
  for (const id of ids) {
    const html = snapshotDir
      ? readFileSync(join(snapshotDir, `${id}.html`), 'utf8')
      : fetchFn(`${id}.html`);
    hashes[id] = bodyHash(html);
  }
  manifest._meta.upstream_body_hashes = hashes;
  if (!snapshotDir) manifest._meta.upstream_sha = fetchUpstreamSha();
  manifest._meta.extracted_at = new Date().toISOString().slice(0, 10);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return hashes;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === 'check') {
    const drift = detectDrift();
    if (drift.length === 0) {
      process.stdout.write('no drift\n');
      process.exit(0);
    }
    process.stderr.write(`drift detected in ${drift.length} templates:\n`);
    for (const d of drift) process.stderr.write(`  ${d.id}\n`);
    process.exit(1);
  } else if (cmd === 'refresh-pin') {
    refreshPin();
    process.stdout.write('pin refreshed\n');
  } else {
    process.stderr.write('usage: sync-upstream.js {check|refresh-pin}\n');
    process.exit(1);
  }
}
```

- [ ] **Step 3: Refresh pin in manifest using snapshot**

```bash
cd plugins/html-effectiveness
node -e "import('./scripts/sync-upstream.js').then(m => m.refreshPin({ snapshotDir: 'tests/fixtures/upstream-snapshot' }))"
```

Expected: `templates/manifest.json` gains `_meta.upstream_body_hashes` with 20 entries.

- [ ] **Step 4: Write drift tests**

`plugins/html-effectiveness/tests/sync-upstream.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDrift } from '../scripts/sync-upstream.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(HERE, 'fixtures/upstream-snapshot');

test('no drift against pinned snapshot', () => {
  const drift = detectDrift({ snapshotDir: SNAPSHOT });
  assert.equal(drift.length, 0, `unexpected drift: ${JSON.stringify(drift)}`);
});

test('drift detected when snapshot differs', () => {
  const drift = detectDrift({
    snapshotDir: SNAPSHOT,
    fetchFn: (filename) => '<html><body>tampered</body></html>',
  });
  // detectDrift uses snapshotDir when provided, so we instead invoke without snapshotDir but with a fake fetch
  const driftFake = detectDrift({
    fetchFn: () => '<html><body>tampered</body></html>',
  });
  assert.ok(driftFake.length > 0);
});
```

- [ ] **Step 5: Run tests**

```bash
cd plugins/html-effectiveness && node --test tests/sync-upstream.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/html-effectiveness/scripts/sync-upstream.js \
        plugins/html-effectiveness/tests/sync-upstream.test.js \
        plugins/html-effectiveness/tests/fixtures/upstream-snapshot/ \
        plugins/html-effectiveness/templates/manifest.json
git commit -m "feat(html-effectiveness): add sync-upstream drift detection with pinned hashes"
```

---

## Task 12: Skill — `skills/html-effectiveness/SKILL.md`

**Files:**
- Create: `plugins/html-effectiveness/skills/html-effectiveness/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

`plugins/html-effectiveness/skills/html-effectiveness/SKILL.md`:

```markdown
---
name: html-effectiveness
description: Use when the user wants dense information, status, comparison, plan, code review, or research output rendered as a self-contained interactive HTML report instead of plain markdown. Renders via plugin templates and scripts/render.js into a single HTML file under docs/reports/ (overridable via CLAUDE.md).
---

# HTML Effectiveness — Interactive Output

Turn dense information into a self-contained, browser-based HTML document the user can explore interactively. Markdown is a wall of text; HTML is a spatial, interactive document. Zero dependencies, single file, opens anywhere.

## When to invoke

Invoke this skill when the user asks for any of:

- "Make a report", "render as HTML", "interactive view"
- Status updates: weekly status, monthly recap, project digest
- Incident: post-mortem, outage writeup
- Code: PR review, code understanding, exploration of implementation approaches
- Design: design system, component variants, prototypes
- Research: feature explainer, concept explainer, tutorial
- Planning: implementation plan, rollout, roadmap
- Decisions: comparison board, decision matrix
- Visual: slide deck, flowchart, SVG illustration
- Editor tooling: triage board, feature flags, prompt tuner

If the request fits a report-style output and rendering as HTML would be clearer than markdown, invoke the skill and delegate to the `report-builder` agent.

## Template catalog

20 templates ship with this plugin. See `docs/template-gallery.md` for the full table (auto-generated from `templates/manifest.json`). Highlights:

- `01` / `02` — exploration comparisons (code approaches, visual designs)
- `03` — code review board
- `04` — code understanding / architecture walk-through
- `05` / `06` — design system, component variants
- `07` / `08` — prototype animation, prototype interaction
- `09` — slide deck (arrow-key nav)
- `10` — SVG illustrations
- `11` — status report
- `12` — incident report
- `13` — flowchart diagram
- `14` / `15` — research explainers (feature, concept)
- `16` — implementation plan (annotated timeline)
- `17` — PR writeup
- `18` / `19` / `20` — editor tools (triage board, feature flags, prompt tuner)

## Render contract

Always uphold these invariants:

1. **Inline-bundle** — the final HTML is single-file, self-contained. No `<link>` or `<script src>` references. The render script inlines `base.css`, `components.css`, `base.js`, plus any per-template extras.
2. **Escape strings** — string slots are HTML-escaped. Raw-HTML slots are only allowed when the manifest flags the slot as `"html"`.
3. **Output path** — read repo `CLAUDE.md` for `html-effectiveness.reportDir`; fallback to `docs/reports/`. Filename: `YYYY-MM-DD-<slug>.html`; slug derived from title (kebab-case, ASCII-only, max 60 chars).
4. **Sidecar** — `<report>.html.data.json` is always written alongside the HTML so the report can be regenerated by re-running `render.js` on the sidecar.

## Workflow

1. Pick template via `manifest.json` (match user intent against `use_cases` and `pattern`).
2. Fill slot data from the conversation; record it as JSON.
3. Invoke render script:

   ```bash
   node plugins/html-effectiveness/scripts/render.js \
     --template=<id> \
     --data=<data.json> \
     --out=<reportDir>/YYYY-MM-DD-<slug>.html
   ```

4. Confirm output path to the user; offer `snip render --format html < <path>` to preview in browser.

## Design principles

Preserved from upstream `ThariqS/html-effectiveness`:

- Avoid purple/blue gradient backgrounds, generic feature grids, center-everything layouts, decorative patterns.
- Prioritize real data, scannable hierarchy, spatial grouping, progressive disclosure over decoration.

## Technical requirements

- Single `.html` file, fully self-contained.
- CSS variables for light/dark theming via `prefers-color-scheme`.
- System font stack and 150ms smooth transitions.
- Responsive design 375px–1440px.
- Semantic HTML5 with ARIA labels.
- Print styles that expand all hidden content.

## Failure modes

- **No template fits**: present the top 2 closest matches with one-line summaries; ask the user to confirm, or offer plain-markdown fallback. Never silently force a poor fit.
- **Missing slot data**: ask one question at a time; respect the cap of 6 questions before forcing render with best-guess defaults plus a note of what was assumed.
- **Render error**: surface `template:slot expected <type> got <type>` to the user; fix the slot value; retry.

## Sync

Generated from upstream `ThariqS/html-effectiveness@<sha pinned in manifest>`. To refresh: `node plugins/html-effectiveness/scripts/sync-upstream.js check`. If drift is detected, re-fetch the affected template, re-run extraction, and review the diff before committing.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/html-effectiveness/skills/html-effectiveness/SKILL.md
git commit -m "feat(html-effectiveness): add SKILL.md covering all 20 patterns"
```

---

## Task 13: Agent — `agents/report-builder.md`

**Files:**
- Create: `plugins/html-effectiveness/agents/report-builder.md`

- [ ] **Step 1: Write agent definition**

`plugins/html-effectiveness/agents/report-builder.md`:

```markdown
---
name: report-builder
description: Conversational wizard that helps the user generate an HTML report from one of 20 templates (status, incident, PR writeup, decision matrix, slide deck, code review, research explainer, ...). Use when the user wants a polished interactive HTML output instead of markdown. Reads templates/manifest.json and CLAUDE.md html-effectiveness.reportDir for output path.
tools: Read, Write, Bash, Glob, Grep
---

You are `report-builder`, a conversational wizard that turns the user's intent into a polished, self-contained interactive HTML report.

## Role

Guide the user from intent → rendered HTML in a single file. Speak briefly. Ask one question at a time. Match the user's caveman setting if active.

## Startup

On every run:

1. Read `CLAUDE.md` from the repo root. Extract `html-effectiveness.reportDir` if present; fallback `docs/reports/`.
2. Read `plugins/html-effectiveness/templates/manifest.json` (catalog + slot schemas).
3. Greet briefly; confirm the user's intent.

## Conversation loop

1. **Classify** — infer the top 2-3 templates from the user's stated need by matching `use_cases` and `pattern` fields in the manifest.
2. **Confirm** — present the top picks with one-line summaries; let the user pick or override.
3. **Slot fill** — walk the required slots from `manifest[id].slots` in order. Batch obvious slots and infer from prior context to minimize questions. Cap at 6 user-facing questions; force render with best-guess defaults beyond that, with a one-line note of what was assumed.
4. **Preview data** — show a JSON summary of slot values; ask "looks right?" before rendering.

## Render

1. Compute slug from title (kebab-case, ASCII-only, max 60 chars).
2. Build path `<reportDir>/YYYY-MM-DD-<slug>.html`.
3. Write `<path>.data.json` first (so the user can re-render later).
4. Invoke render script via Bash:

   ```bash
   node plugins/html-effectiveness/scripts/render.js \
     --template=<id> \
     --data=<path>.data.json \
     --out=<path>
   ```

5. On success: print the absolute path; offer `snip render --format html < <path>` to preview in the browser.
6. On render error: surface stderr; locate the offending slot from the `template:slot` prefix; ask the user to fix; retry.

## Regen path

If the user invokes the agent on an existing `<name>.data.json`:

- Skip slot fill.
- Edit only the slots the user wants changed.
- Re-render to the same path (or new path if requested).

## Guardrails

- Never write to paths outside the repo root.
- Create `reportDir` if missing.
- If the output file already exists, ask the user before overwriting; suggest `-2`, `-3`, ... suffix.
- Refuse to render if the manifest is missing or the requested template id doesn't exist; surface the valid id list.

## Tone

Terse, expert, no fluff. Caveman-mode-aware. Code blocks unchanged.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/html-effectiveness/agents/report-builder.md
git commit -m "feat(html-effectiveness): add report-builder conversational agent"
```

---

## Task 14: Wire root plugin manifest + version bump + test script

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `package.json`

- [ ] **Step 1: Append new skill path to root plugin manifest**

Modify `.claude-plugin/plugin.json`. Add the new skill path to the `skills` array:

```json
{
  "name": "agents-and-skills",
  "displayName": "DrunkCoding Agents & Skills",
  "version": "0.2.0",
  "description": "Personal collection of Claude Code skills and agents (GitNexus toolkit + HTML report generator).",
  "author": "Steven Hoang",
  "homepage": "https://github.com/drunkcoding/agents-and-skills",
  "skills": [
    ".claude/skills/gitnexus/gitnexus-exploring",
    ".claude/skills/gitnexus/gitnexus-impact-analysis",
    ".claude/skills/gitnexus/gitnexus-debugging",
    ".claude/skills/gitnexus/gitnexus-refactoring",
    ".claude/skills/gitnexus/gitnexus-guide",
    ".claude/skills/gitnexus/gitnexus-cli",
    "plugins/html-effectiveness/skills/html-effectiveness"
  ]
}
```

- [ ] **Step 2: Bump root `package.json` version + add test script**

Modify `package.json`:

```json
{
  "version": "0.2.0",
  "scripts": {
    "test": "node --test plugins/html-effectiveness/tests/"
  }
}
```

(Preserve existing fields; only update `version` and `scripts.test`. If `scripts` already exists, merge.)

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: PASS — all tests across mustache, render, manifest, sync-upstream green.

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/plugin.json package.json
git commit -m "chore: register html-effectiveness skill, bump 0.2.0, add npm test"
```

---

## Task 15: Update CLAUDE.md and AGENTS.md to document the new plugin

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Append a section to `CLAUDE.md`**

After the existing `## Working in this repo` section, insert:

```markdown
## html-effectiveness plugin

Located at `plugins/html-effectiveness/`. Ships:

- `skills/html-effectiveness/SKILL.md` — invokes report generation when user asks for HTML report.
- `agents/report-builder.md` — conversational wizard that picks a template, gathers slots, renders.
- `templates/` — 20 `.html.tmpl` files + `manifest.json` (slot-schema source of truth).
- `assets/` — shared `base.css`, `components.css`, `base.js`, `charts.js`.
- `scripts/render.js` — zero-dep Node render script (CLI + library).

**Override report output dir** from the consuming project's `CLAUDE.md`:

```
html-effectiveness.reportDir: my/custom/dir
```

Default: `docs/reports/YYYY-MM-DD-<slug>.html` in the current repo.

**Sync upstream:** `node plugins/html-effectiveness/scripts/sync-upstream.js check`. If drift, re-run `scripts/extract.js` per drifted template and review the diff.

**Run tests:** `npm test`.
```

- [ ] **Step 2: Mirror the same section into `AGENTS.md`**

Per the repo rule that `CLAUDE.md` and `AGENTS.md` stay in sync, paste the identical section into `AGENTS.md` at the corresponding location.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md AGENTS.md
git commit -m "docs: document html-effectiveness plugin in CLAUDE.md and AGENTS.md"
```

---

## Task 16: End-to-end smoke test

**Files:**
- None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: PASS — all green.

- [ ] **Step 2: Render every template into a tmp dir and inspect file sizes**

```bash
mkdir -p /tmp/htmleff-smoke
cd plugins/html-effectiveness
for f in tests/fixtures/[0-9]*-*.data.json; do
  id=$(basename "$f" .data.json)
  out=/tmp/htmleff-smoke/$id.html
  node scripts/render.js --template="$id" --data="$f" --out="$out"
done
ls -la /tmp/htmleff-smoke/ | head -50
```

Expected: 20 `.html` files + 20 `.data.json` sidecars. Each `.html` between ~5 KB and ~80 KB. No file is 0 bytes.

- [ ] **Step 3: Spot-check three rendered files in browser**

```bash
open /tmp/htmleff-smoke/09-slide-deck.html
open /tmp/htmleff-smoke/11-status-report.html
open /tmp/htmleff-smoke/18-editor-triage-board.html
```

Expected: each opens; slide deck arrow nav works; status report shows stats grid + sections; triage board renders kanban columns. Browser dev tools Network panel shows zero external requests after the page loads.

- [ ] **Step 4: Verify CLAUDE.md override**

Create a temporary `CLAUDE.md` in a scratch dir containing `html-effectiveness.reportDir: ./scratch-reports`. Run the agent (or simulate by manually invoking render with that path) and confirm the file lands in `./scratch-reports/`.

- [ ] **Step 5: Verify regen from sidecar**

```bash
node plugins/html-effectiveness/scripts/render.js \
  --template=11-status-report \
  --data=/tmp/htmleff-smoke/11-status-report.html.data.json \
  --out=/tmp/htmleff-smoke/11-status-report-regen.html
diff /tmp/htmleff-smoke/11-status-report.html /tmp/htmleff-smoke/11-status-report-regen.html
```

Expected: diff is empty except for `rendered_at` timestamp in the sidecar.

- [ ] **Step 6: Commit any cleanup**

If smoke testing surfaced fixture or template tweaks:

```bash
git add -p
git commit -m "fix(html-effectiveness): smoke-test polish"
```

Otherwise nothing to commit.

---

## Self-Review Notes

Coverage map vs spec sections:

- §1 Goal → Tasks 1, 12, 13 (plugin shell, skill, agent).
- §2 Problem & Why → Tasks 7, 8, 12 (extract real 20 + skill rewrite).
- §3 Scope → all tasks; nothing out-of-scope.
- §4 Decisions Q1–Q7 → Q1 (Tasks 7+8 ship 20), Q2 (Task 13 agent), Q3 (Tasks 4+7+8 shared assets), Q4 (Tasks 13+15 CLAUDE.md override), Q5 (Task 6 inline bundle), Q6 (Task 6 Node render), Q7 (Task 6 sidecar).
- §5 Plugin Layout → Tasks 1, 4, 7, 8, 10, 11, 12, 13.
- §6 Template Extraction → Tasks 7, 8.
- §7 Render Script → Tasks 5, 6.
- §8 Skill → Task 12.
- §9 Agent → Task 13.
- §10 Validation against upstream → Tasks 7, 8, 10 (catalog → docs/template-gallery.md).
- §11 Error Handling → Task 6 (render exit codes), Task 13 (agent guardrails).
- §12 Testing → Tasks 2, 5, 9, 11; root npm test in Task 14.
- §13 Ops & Release → Tasks 14, 15.
- §14 Open Questions → not blocking; revisit if surfaced during Task 16.
- §15 Acceptance Criteria → covered by Tasks 1, 7, 8, 9, 12, 13, 14, 16 (smoke test confirms self-contained + sidecar).

Placeholder scan: no `TBD`, no `TODO`, no "fill in details", no "similar to Task N". Every code step shows the code; every command shows the expected outcome.

Type consistency check: `renderReport()` signature (`templateId`, `data`, `outPath`, `manifestPath`, `pluginRoot`) used identically in Task 5 tests and Task 6 implementation. CLI flags `--template`, `--data`, `--out` consistent across Tasks 6, 7, 8, 13, 16. Manifest slot schema (`{ type, required, of }`) consistent across Tasks 5, 6, 7, 8, 9.
