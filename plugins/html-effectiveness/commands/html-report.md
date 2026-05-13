---
description: Conversational wizard that renders dense info as a self-contained interactive HTML report (status, incident, PR writeup, slide deck, decision matrix, ...).
argument-hint: [optional one-line intent or path to existing .data.json]
---

Dispatch the `report-builder` subagent using the Agent tool. Pass `$ARGUMENTS` (which may be empty) as the initial intent seed in the subagent prompt.

Subagent dispatch prompt template:

> Run the html-effectiveness report wizard. Initial intent seed: `$ARGUMENTS`.
> If the seed looks like a path to an existing `*.data.json` sidecar, enter the regen flow: load it, ask which slots to change, re-render. Otherwise classify the intent against `plugins/html-effectiveness/templates/manifest.json`, confirm the template pick with the user, fill slots (cap 6 questions), preview the data JSON, then render via `plugins/html-effectiveness/scripts/render.js`. Respect `html-effectiveness.reportDir` from repo `CLAUDE.md` (fallback `docs/reports/`).

Do not render or write files in the main thread — the subagent owns the full wizard and the render call.
