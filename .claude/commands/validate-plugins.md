---
description: Validate every plugin under plugins/** via the plugin-validator agent.
---

Dispatch the `plugin-validator` agent. Surface its full report (per-plugin sections + summary table) to the user. Then forward the interactive fix prompts to the user one at a time, applying edits on `Apply fix` and updating the fix-summary table at the end.

Do not perform any validation logic yourself — defer entirely to the agent.
