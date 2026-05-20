# Handovers

Phase-A → phase-B handover artefacts produced by the analytics team
(solution-architect + feature-planner, plus security-engineer when the project's
`security` block requires it).

One file per feature, named:

```
YYYY-MM-DD-<slug>-handover.md
```

## When written

After the owner approves the plan (touchpoint 2) and before the lead spawns the
team-leader (phase B). The solution-architect is the author; the planner and
security-engineer review before `HANDOVER_READY <slug>` is posted to lead.

## Contents (required sections)

1. **Spec path** — absolute path to `docs/superpowers/specs/<slug>.md`.
2. **Arch-map path** — absolute path to the architecture map produced in phase A.
3. **Plan path** — absolute path to `docs/superpowers/plans/<slug>.md`.
4. **Security note** — present only when security-engineer ran. Either
   `SEC_PASSED` summary or the `SEC_BLOCKED` items that were resolved.
5. **Open questions** — questions deliberately left for implementation, each
   with a one-line reason ("decided at implementation time because …").
6. **Restart policy** — verbatim:
   > If implementation hits an architecturally significant question,
   > team-leader posts RESTART_REQUEST; lead re-runs phase A with this
   > handover + partial commits as input.

## Lifecycle

| Event | Effect |
|-------|--------|
| Owner approves plan | architect writes handover, posts `HANDOVER_READY` to lead |
| Lead receives `HANDOVER_READY` | shuts down architect, planner, security-engineer; spawns team-leader |
| team-leader spawned | reads this handover on first turn |
| `RESTART_REQUEST` | lead re-runs phase A with this handover + partial commits as input; the new handover supersedes |
| `PLAN_COMPLETE` | qc-engineer cross-checks finished work against this handover |

## Cross-references

- Spec §5.5 — Handover protocol
- Spec §6.1 — team-leader spawn prompt (reads handover first)
- Spec §7 — Recovery (RESTART_REQUEST)
- Spec §8.14 — File layout
