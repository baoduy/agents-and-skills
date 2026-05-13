---
description: Validate every plugin under plugins/** via the plugin-validator agent.
---

Dispatch the `plugin-validator` agent. Surface its full report (per-plugin sections + summary table) to the user. After the report+summary are out, surface the agent's single batched `## Proposed Fixes` block plus the `Apply all / Choose per-item / Skip all` prompt. Apply edits per the user's choice and emit the fix-summary table at the end.

Do not perform any validation logic yourself — defer entirely to the agent.
