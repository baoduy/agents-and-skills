---
description: Step-by-step wizard for generating technical diagrams (SVG/PNG).
argument-hint: [optional one-line topic]
---

Dispatch the `tech-graph` subagent using the Agent tool. Pass `$ARGUMENTS` (which may be empty) as the initial topic seed in the subagent prompt.

Subagent dispatch prompt template:

> Run the tech-graph wizard. Initial topic seed: `$ARGUMENTS`.
> Walk the user through all 6 steps even when a seed is provided. Use multiple-choice options with the marked default (★). Maintain wizard state as JSON in your working memory across turns. Do not skip steps unless the user explicitly says "use defaults".

Do not perform any rendering or file generation in the main thread — the subagent owns the full wizard and the render call.
