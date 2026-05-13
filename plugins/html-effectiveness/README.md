# html-effectiveness

Generate self-contained interactive HTML reports (status, incident, PR writeup, decision matrix, slide deck, code review, research explainer, etc.) from 20 upstream templates.

## Usage

Invoke the `report-builder` agent. It will pick a template, gather slot data conversationally, and render to `docs/reports/YYYY-MM-DD-<slug>.html`.

Override output dir in repo `CLAUDE.md`:

```
html-effectiveness.reportDir: my/custom/reports
```

## Vendored templates

Templates are vendored from `ThariqS/html-effectiveness`. The pinned SHA lives in `templates/manifest.json` (`_meta.upstream_sha`). Re-fetch is **manual** — only run when you want to refresh the snapshot:

```bash
node plugins/html-effectiveness/scripts/extract.js fetch <id>.html
node plugins/html-effectiveness/scripts/extract.js split <id>.html
```

Files land under `.tmp/html-effectiveness/extract/` and are cleaned up automatically. Hand-merge any changes back into `templates/<id>.html.tmpl`.

## Scratch convention

All plugin scratch lives under `.tmp/html-effectiveness/<purpose>/` (gitignored). Helper API: `scripts/_tmp.js` exports `getTmpDir`, `cleanup`, and `withTmp` for try/finally + signal-handler cleanup.
