---
description: Resume an auto-power pipeline from its checkpoint. Re-enters the recorded phase with retry counters preserved. Use --cleared after fixing the issue described in an ESCALATION.md file.
---

# /auto-power-resume

**Usage:** `/auto-power-resume <slug-or-checkpoint-path> [--cleared]`

**Arguments:**

| Flag | Default | Effect |
|---|---|---|
| `<slug-or-checkpoint-path>` (required, positional) | — | Either the slug (resolves to `docs/superpowers/specs/<slug>-checkpoint.json`) or an explicit path |
| `--cleared` | off | Required when the checkpoint `status` is `blocked`. Asserts you have fixed the issue described in the ESCALATION file. Clears `last_error` and resumes from the recorded phase |

## Procedure

1. Resolve the checkpoint path from the positional argument.
2. Invoke the `auto-power-runtime` skill with intent `resume`. The skill executes §8 of its own rules:
   - Verify branch and (if recorded) worktree path exist.
   - Reject if HEAD has uncommitted churn the pipeline did not write.
   - `status: done` ⇒ no-op, print summary, exit.
   - `status: blocked` without `--cleared` ⇒ re-print escalation summary, exit.
   - `status: blocked` with `--cleared` ⇒ clear `last_error`, set `status: running`, re-enter the recorded `phase`.
   - `status: running` ⇒ re-enter the recorded `phase`.
3. Continue the pipeline from that phase until the next escalation or successful finish.

## Hard guarantees

- The resume never changes the recorded `branch`.
- Retry counters survive resume — if `retries.impl` is `2` on a 3-retry budget, only one retry remains.
- The auto-decisions log is appended to, never rewritten.
