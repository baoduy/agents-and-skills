# html-effectiveness Plugin — Design Spec

**Date:** 2026-05-12
**Author:** Steven Hoang (with Claude)
**Status:** Draft — awaiting user review
**Repo:** drunkcoding/agents-and-skills (menkent)

## 1. Goal

Add a new plugin, `html-effectiveness`, that lets a user turn dense information into self-contained interactive HTML reports. The plugin ships:

- A rewritten **skill** (`html-effectiveness`) validated against the actual upstream template set.
- A conversational **agent** (`report-builder`) that walks the user from intent to rendered HTML in a single file.
- 20 reusable template skeletons extracted from `ThariqS/html-effectiveness`, plus shared CSS/JS assets and a Node render script.

Upstream sources:

- Skill blueprint: `https://raw.githubusercontent.com/ghoulvspol/html-effectiveness-skill/refs/heads/main/skill.md`
- Templates: `https://github.com/ThariqS/html-effectiveness` (20 HTML files + `index.html` gallery)

## 2. Problem & Why

The upstream skill claims **9 patterns**, but the template repo actually ships **20 templates** (`01-exploration-code-approaches.html` … `20-editor-prompt-tuner.html`). The skill is out of date and undersells the available palette. There is also no agent to drive the workflow end-to-end, so a user wanting "make a status report" must hand-author HTML or copy a template manually.

We want:

1. A skill that accurately describes all 20 patterns and tells Claude when to invoke the plugin.
2. An agent that conversationally picks the right template, gathers slot data, and renders a polished self-contained HTML report into `docs/reports/`.
3. A token-efficient template format: shared CSS/JS extracted to common assets, per-template `.html.tmpl` files kept minimal.

## 3. Scope

**In scope**

- All 20 templates from `ThariqS/html-effectiveness` extracted as skeletons.
- Single conversational agent that infers template from user intent and confirms before rendering.
- Node-based render script that inline-bundles shared assets into a self-contained HTML file.
- JSON slot-data file + sidecar copy alongside output for future regeneration.
- User-configurable output directory via `CLAUDE.md` (`html-effectiveness.reportDir`); default `docs/reports/YYYY-MM-DD-<slug>.html`.

**Out of scope**

- Authoring new patterns not present in upstream.
- Live preview server (use existing `snip render` for preview).
- Multi-agent fleet (one agent covers all 20).
- Publishing to npm (existing repo-wide release process applies on bump).

## 4. Decisions Locked During Brainstorm

| # | Decision |
|---|----------|
| Q1 | Support all 20 templates; agent auto-picks best fit. |
| Q2 | Conversational agent; infer template + confirm before render. |
| Q3 | Bundle skeleton `.html.tmpl` files; extract CSS/JS to shared assets for token savings. |
| Q4 | Output default `docs/reports/YYYY-MM-DD-<slug>.html`; `CLAUDE.md` override. |
| Q5 | Inline-bundle final HTML (single self-contained file, matches upstream spirit). |
| Q6 | Script-assisted render via Node `scripts/render.js`. |
| Q7 | Slot data passed as JSON file; sidecar `<report>.data.json` kept beside output for regen. |

## 5. Plugin Layout

```
plugins/html-effectiveness/
  .claude-plugin/
    plugin.json                # name, version, skills[], agents[]
  skills/
    html-effectiveness/
      SKILL.md
  agents/
    report-builder.md
  templates/
    manifest.json              # id → title, use_cases, slots schema, asset_bundles, extra_js
    01-exploration-code.html.tmpl
    02-exploration-visual.html.tmpl
    03-code-review-pr.html.tmpl
    04-code-understanding.html.tmpl
    05-design-system.html.tmpl
    06-component-variants.html.tmpl
    07-prototype-animation.html.tmpl
    08-prototype-interaction.html.tmpl
    09-slide-deck.html.tmpl
    10-svg-illustrations.html.tmpl
    11-status-report.html.tmpl
    12-incident-report.html.tmpl
    13-flowchart-diagram.html.tmpl
    14-research-feature-explainer.html.tmpl
    15-research-concept-explainer.html.tmpl
    16-implementation-plan.html.tmpl
    17-pr-writeup.html.tmpl
    18-editor-triage-board.html.tmpl
    19-editor-feature-flags.html.tmpl
    20-editor-prompt-tuner.html.tmpl
  assets/
    base.css                   # CSS vars, light/dark via prefers-color-scheme, print
    components.css             # cards, timeline, kanban, matrix, swatches, slides
    base.js                    # search, filter, nav, copy-on-click, theme toggle
    charts.js                  # inline SVG chart helpers (opt-in via manifest)
  scripts/
    render.js                  # CLI: tmpl + data → inline-bundled HTML
    catalog.js                 # list/filter templates by use-case
    sync-upstream.js           # diff local templates vs upstream snapshot
  docs/
    template-gallery.md
  tests/
    render.test.js
    manifest.test.js
    sync-upstream.test.js
    fixtures/
      <id>.data.json           # one fixture per template
  README.md
```

Root `.claude-plugin/plugin.json` adds the skill path to its `skills[]`. Plugin's own `plugin.json` lists its own skill + agent so the marketplace consumer sees both.

## 6. Template Extraction & Asset Split

One-time process (scripted in `scripts/sync-upstream.js`):

1. Fetch all 20 HTML files plus `index.html` from upstream.
2. Per file, parse → strip demo content → keep structural shell with Mustache slot markers (`{{title}}`, `{{#sections}}…{{/sections}}`, etc.).
3. Categorize CSS rules:
   - **Shared theme + components** (CSS variables, typography, cards, print) → `assets/base.css` + `assets/components.css`.
   - **Per-template unique** → keep inline at the bottom of the `.html.tmpl` file.
4. Categorize JS:
   - **Shared interactions** (theme toggle, nav, search, copy-on-click) → `assets/base.js`.
   - **Per-template** (slide nav, kanban drag-and-drop, prompt-tuner sliders) → either inline in tmpl or opt-in addon (`charts.js`) referenced via `manifest.asset_bundles`.
5. Record the upstream commit SHA + extraction date at the top of `manifest.json` for drift tracking.

**Template file shape** (`NN-name.html.tmpl`):

```html
<!--
template: 11-status-report
slots: { title, period, stats[], sections[] }
-->
<main class="report report--status">
  <header>
    <h1>{{title}}</h1>
    <p class="subtitle">{{period}}</p>
  </header>
  <section class="stats">
    {{#stats}}<div class="stat"><span class="value">{{value}}</span><span class="label">{{label}}</span><span class="delta">{{delta}}</span></div>{{/stats}}
  </section>
  {{#sections}}
    <section><h2>{{heading}}</h2><div class="body">{{{body}}}</div></section>
  {{/sections}}
</main>
<!-- per-template extra CSS/JS, if any -->
```

**Slot syntax**: Mustache subset. `{{var}}` for HTML-escaped strings, `{{{raw}}}` for opt-in raw HTML (manifest must flag the slot as `"html"`). `{{#list}}…{{/list}}` for arrays. `{{^list}}…{{/list}}` for empty-state fallback. Implementation: hand-rolled ~50 LOC inside `render.js` to avoid runtime dependency.

**Manifest entry shape** (`templates/manifest.json`):

```json
{
  "_meta": {
    "upstream_repo": "ThariqS/html-effectiveness",
    "upstream_sha": "<commit>",
    "extracted_at": "2026-05-12"
  },
  "11-status-report": {
    "title": "Status Report",
    "use_cases": ["weekly update", "project status", "team digest"],
    "pattern": "interactive_report",
    "slots": {
      "title":    { "type": "string", "required": true },
      "period":   { "type": "string", "required": true },
      "stats":    { "type": "array",  "of": { "label": "string", "value": "string", "delta": "string" } },
      "sections": { "type": "array",  "of": { "heading": "string", "body": "html", "status": "string" } }
    },
    "asset_bundles": ["base", "components"],
    "extra_js": null
  }
}
```

Agent reads `manifest.json` (small) to pick template + know slot contract before asking the user for data.

## 7. Render Script (`scripts/render.js`)

**CLI**:

```bash
node plugins/html-effectiveness/scripts/render.js \
  --template=11-status-report \
  --data=./report.data.json \
  --out=docs/reports/2026-05-12-q2-status.html
```

**Behavior**:

1. Load `templates/manifest.json`, resolve `--template`.
2. Load `--data` JSON and validate against `slots` schema:
   - Required fields present.
   - Type matches (`string`, `number`, `array`, nested object shapes).
   - Unknown fields warned, not fatal.
   - Fail loud on mismatch with `template:slot expected <type> got <type>`.
3. Load `templates/<id>.html.tmpl`.
4. Load asset bundles listed in `manifest[id].asset_bundles` (e.g. `base.css`, `components.css`, `base.js`) and `extra_js` if set.
5. Mustache-render tmpl against `data`:
   - `{{var}}` → HTML-escape (`& < > " '`).
   - `{{{raw}}}` → no escape; only allowed when manifest slot type is `"html"`.
   - `{{#list}}…{{/list}}` → iterate array, sub-context per item.
6. Wrap rendered body in HTML5 shell:
   ```html
   <!doctype html>
   <html lang="en">
   <head>
     <meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>{{data.title}}</title>
     <style>/* inlined base.css + components.css + per-template extra */</style>
   </head>
   <body>
     {{rendered_body}}
     <script>/* inlined base.js + extras */</script>
   </body>
   </html>
   ```
7. `mkdir -p` parent of `--out`; write final HTML.
8. Write sidecar `<out>.data.json` (copy of input data + `{ template, rendered_at, render_version }` envelope).
9. Print final absolute path to stdout. Exit 0 on success.
10. Exit codes: `2` template-not-found, `3` slot schema mismatch, `4` filesystem write error, `1` other.

**Dependencies**: zero runtime deps. Optional dev deps for tests only.

## 8. Skill (`skills/html-effectiveness/SKILL.md`)

**Frontmatter**:

```yaml
---
name: html-effectiveness
description: Use when the user wants dense information, status, comparison, plan, code review, or research output rendered as a self-contained interactive HTML report instead of plain markdown. Renders via plugin templates and scripts/render.js into a single HTML file under docs/reports/ (overridable via CLAUDE.md).
---
```

**Body sections**:

1. **When to invoke** — explicit triggers: "make a report", "render as HTML", "interactive view", "status report", "incident writeup", "PR explainer", "slide deck", "decision matrix", "comparison board", "timeline", "feature explainer", etc.
2. **Template catalog** — table generated from `manifest.json`: id, title, use-cases, slot summary. Single source of truth; if manifest changes, the table regenerates via `scripts/catalog.js > docs/template-gallery.md` and the relevant section of `SKILL.md`.
3. **Render contract** (invariants):
   - Always inline-bundle the final HTML (single self-contained file).
   - HTML-escape string slots by default; raw-HTML slots only when manifest flags the slot as `"html"`.
   - Output path: read repo `CLAUDE.md` for `html-effectiveness.reportDir`; fallback to `docs/reports/`.
   - Filename: `YYYY-MM-DD-<slug>.html`; slug derived from title (kebab-case, ASCII-only, max 60 chars).
   - Sidecar `<name>.data.json` always written next to the HTML.
4. **Workflow** — pick template → fill slots from convo → write data JSON → invoke `node plugins/html-effectiveness/scripts/render.js --template=<id> --data=<file> --out=<path>` → confirm output path → offer `snip render --format html < <path>` to preview in browser.
5. **Design principles** (preserved from upstream): no purple/blue gradient backgrounds, no generic feature grids, no center-everything layouts, no decorative patterns. Prioritize real data, scannable hierarchy, spatial grouping, progressive disclosure.
6. **Technical requirements** (preserved): single `.html` file, fully self-contained; CSS vars for light/dark theming via `prefers-color-scheme`; system font stack; 150ms smooth transitions; responsive 375px–1440px; semantic HTML5 with ARIA; print styles that expand all hidden content.
7. **Failure modes** — when no template fits: present top 2 closest matches with one-line summaries, ask user to confirm, or offer plain-markdown fallback. Never silently force a poor fit.
8. **Sync footer** — `Generated from upstream ThariqS/html-effectiveness@<sha> on <date>. Re-run scripts/sync-upstream.js to refresh.`

## 9. Agent (`agents/report-builder.md`)

**Frontmatter**:

```yaml
---
name: report-builder
description: Conversational wizard that helps the user generate an HTML report from one of 20 templates (status, incident, PR writeup, decision matrix, slide deck, code review, research explainer, ...). Use when the user wants a polished interactive HTML output instead of markdown.
tools: Read, Write, Bash, Glob, Grep
---
```

**System prompt (body)**:

1. **Role** — guide the user from intent to a rendered HTML report. Speak briefly. Ask one question at a time.
2. **Startup** (every run):
   - Read `CLAUDE.md` from repo root; extract `html-effectiveness.reportDir` if set, else default `docs/reports/`.
   - Read `plugins/html-effectiveness/templates/manifest.json` to know catalog and slot schemas.
   - Greet briefly, confirm intent.
3. **Conversation loop**:
   - **Classify** — infer top 2-3 templates from the user's stated need by matching against `use_cases` and `pattern` fields.
   - **Confirm** — present top picks with one-line summaries; let the user pick or override.
   - **Slot fill** — walk required slots in `manifest[id].slots` order; batch obvious slots and infer from prior context to minimize questions.
   - **Preview data** — show a JSON summary of slot values; ask "looks right?" before rendering.
4. **Render**:
   - Compute slug from title (kebab-case, ASCII, trim to 60 chars).
   - Build path `<reportDir>/YYYY-MM-DD-<slug>.html`.
   - Write `<path>.data.json`.
   - Invoke `node plugins/html-effectiveness/scripts/render.js --template=<id> --data=<json> --out=<html>` via Bash.
   - On success: print the path; offer `snip render --format html < <path>` to preview.
   - On render error: surface stderr, locate offending slot, ask the user to fix, retry.
5. **Regen path** — if invoked with an existing `.data.json`, skip slot fill; edit only requested fields; re-render.
6. **Guardrails**:
   - Never write to paths outside the repo root.
   - Create `reportDir` if missing.
   - Refuse to overwrite an existing file without explicit confirmation; suggest `-2` suffix.
   - Cap conversation at 6 user-facing questions before forcing render with best-guess defaults plus a one-line note of what was assumed.
7. **Tone** — terse, expert, no fluff. Match the user's caveman setting if active.

## 10. Validation Against Upstream Templates

Performed as part of initial implementation, codified in `scripts/sync-upstream.js`.

**Steps**:

1. Fetch all 20 HTML files via `gh api repos/ThariqS/html-effectiveness/contents/<file>` (or raw URL).
2. Per template extract: DOM structure (slot inventory), CSS rules (shared vs unique), JS (shared vs per-template), actual semantic pattern in use.
3. Build mapping table in `docs/template-gallery.md`:

   | ID | File | Upstream pattern claim | Actual pattern | Use cases | Notes |
   |----|------|------------------------|----------------|-----------|-------|

4. Drive `SKILL.md` rewrites from the table:
   - Replace upstream's "Nine Output Patterns" section with the full 20-row catalog auto-rendered from `manifest.json`.
   - Update Integration Points to add triggers for plan / PR-writeup / editor-* patterns (gaps in upstream).
   - Preserve upstream's design principles and technical requirements verbatim.
5. `scripts/sync-upstream.js` records upstream SHA, fetches each file, regenerates the diff report, and warns when local templates drift from upstream. Safe to run on schedule.

## 11. Error Handling

| Layer | Failure | Handling |
|-------|---------|----------|
| Agent | User intent ambiguous | Show top 2-3 candidates, ask the user to pick. |
| Agent | No template fits | Suggest closest match + offer markdown fallback. |
| Agent | User cancels mid-flow | Save partial `data.json.draft`, exit cleanly. |
| `render.js` | Template id not found | Exit 2; list valid ids. |
| `render.js` | Slot schema mismatch | Exit 3; print `template:slot expected <type> got <type>`. |
| `render.js` | Output dir not writable | Exit 4; suggest a path fix. |
| `render.js` | XSS-suspect input in non-html slot | Escape silently; log a warning to stderr. |
| Browser | Asset load failure | Not applicable — inline-bundled, no external load. |

## 12. Testing

`npm test` runs Node's built-in `node --test`:

- `tests/render.test.js`:
  - Each of 20 templates renders from a fixture `data.json` without error.
  - Output is valid HTML5 (starts with `<!doctype html>`, balanced `<html>`).
  - Output contains no leftover `{{...}}` markers.
  - HTML escaping verified (`<script>` in a `string` slot becomes `&lt;script&gt;`).
  - Sidecar `.data.json` written next to the HTML.
- `tests/manifest.test.js`:
  - Every `.html.tmpl` has a manifest entry.
  - Every manifest entry references an existing file.
  - Every slot type is recognized (`string`, `number`, `boolean`, `array`, `object`, `html`).
- `tests/sync-upstream.test.js`:
  - Fixture upstream snapshot; run sync; assert no drift.

Tests are added to root `package.json` `scripts.test` entry.

## 13. Ops & Release

- README in plugin documents: install, invoke the agent, `CLAUDE.md` override syntax, regen from sidecar, sync upstream.
- Plugin version is bumped in `plugins/html-effectiveness/.claude-plugin/plugin.json` and root `package.json` together, per the existing repo CLAUDE.md rule.
- The new skill path is added to root `.claude-plugin/plugin.json` `skills[]` so marketplace consumers see it.
- `.npmignore` reviewed: `templates/`, `assets/`, and `scripts/` are published; `tests/fixtures/` and `node_modules` excluded.
- `AGENTS.md` mirror updated alongside `CLAUDE.md` if either changes (per repo rule).

## 14. Open Questions

None at brainstorm close. To revisit during implementation:

- Whether to ship a `package.json` inside the plugin for test deps, or keep all tests at the repo root.
- Whether `snip render` invocation belongs in the agent or as a separate command surface.

## 15. Acceptance Criteria

- [ ] Plugin scaffold present at `plugins/html-effectiveness/` with the layout in §5.
- [ ] All 20 templates extracted with slot markers; verified by `tests/render.test.js`.
- [ ] `manifest.json` covers all 20 with slot schemas; verified by `tests/manifest.test.js`.
- [ ] `SKILL.md` lists all 20 patterns (no "nine patterns" residue from upstream).
- [ ] `report-builder` agent converses, picks template, gathers data, and renders to `docs/reports/YYYY-MM-DD-<slug>.html` (or `CLAUDE.md` override path).
- [ ] Rendered HTML is self-contained (no external `<link>` or `<script src>`).
- [ ] Sidecar `<name>.data.json` is written alongside every render.
- [ ] `scripts/sync-upstream.js` runs and reports drift against upstream.
- [ ] `npm test` passes.
- [ ] Root `plugin.json` skills list includes the new skill; both versions bumped.
