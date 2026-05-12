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
