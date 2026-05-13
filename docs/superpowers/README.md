# Superpowers session workspace

This directory holds the artifacts produced by `/team-feature` runs. The team-superpower plugin seeds it on first use; afterwards, the design / plan / review / checkpoint files for each feature are written by the team and committed.

## Layout

```
docs/superpowers/
├── ESCALATION.md                          # template — referenced by every teammate
├── README.md                              # this file
├── specs/    YYYY-MM-DD-<slug>-design.md  # written by designer (phase 1)
├── plans/    YYYY-MM-DD-<slug>-plan.md    # written by planner (phase 3)
├── reviews/  YYYY-MM-DD-<slug>-review.md  # written by reviewer (phase 5)
└── sessions/ YYYY-MM-DD-<slug>.md         # checkpoint, updated by lead each phase
```

## How to launch

```text
/team-feature <one-line feature idea>
```

The lead handles prechecks, spawns the team, and drives the Superpowers skill chain.

## Owner touchpoints (max 4 per feature)

1. **Brainstorming clarifying questions.** The designer batches them per phase; you answer in plain English.
2. **Design sign-off.** The brainstorming skill's built-in approval step.
3. **Plan approval.** Before any implementer task starts.
4. **Finish-branch decision.** Merge / PR / keep / discard at phase 6.

Anything else that reaches you must use the §7 escalation template in `ESCALATION.md`. Refuse questions that don't follow it — that's the contract.

## Reading a checkpoint

`sessions/YYYY-MM-DD-<slug>.md` is the source of truth for in-flight features. Each phase boundary appends or updates:

- The `## Phases` checklist (which phases are done, file paths to the artifacts).
- The `## Teammates` block (role, agent id, current task or `idle`).
- The `## Open escalations` block (anything blocking the owner or a peer).

The lead commits this file after every phase transition. If the lead crashes, your feature lives in this file.

## Recovery — `/team-feature-resume`

If `/resume` drops the team mid-feature (the platform doesn't restore in-process teammates yet), use:

```text
/team-feature-resume <checkpoint-filename>
```

The lead reads the checkpoint, respawns the right teammates, and continues from the next unchecked phase. Completed phases are not redone. A resume-log entry is appended to the checkpoint for the audit trail.

## Cleanup model

The lead is the only thing that knows when a team's work is done. There is no `TeamShutdown` hook event, so cleanup is driven by the slash commands:

- **Automatic**, the happy path: `/team-feature` runs cleanup immediately after `FINISH_DONE`. The lead verifies all phases complete, all expected commits in place, every teammate idle, then invokes the canonical "clean up the team" primitive and confirms with a final scan. A `## Closing` block is appended to the checkpoint.
- **Manual**, the orphan path: if a lead crashed and left `~/.claude/teams/superpower-<slug>/` behind, run `/team-cleanup <slug>` from a fresh session. The slash command dry-runs first, prints what would be removed, asks for confirmation, then applies. The heartbeat file (`docs/superpowers/sessions/<slug>.heartbeat`) protects against wiping a live team — if it was touched in the last 10 minutes, cleanup refuses unless you explicitly confirm with `--ignore-heartbeat`.

Project-side artefacts (`specs/`, `plans/`, `reviews/`, and the checkpoint itself) are **always preserved**. Only platform-side state under `~/.claude/teams/superpower-<slug>/` and `~/.claude/tasks/superpower-<slug>/` is removed, plus any matching tmux session.

## Heartbeat protocol

The lead touches `docs/superpowers/sessions/<slug>.heartbeat` at every phase boundary. Future sessions read its mtime to decide whether a previous lead is still alive:

- mtime < 10 minutes → lead is likely alive; cleanup refuses without explicit override.
- mtime ≥ 10 minutes (or file missing) → safe to clean up.

If you ever want to confirm liveness manually:

```bash
bash plugins/team-superpower/scripts/team-state.sh scan <slug>
```

## Troubleshooting

| Symptom | What it usually means | First thing to check |
|---|---|---|
| `BLOCKED_IDLE: N unanswered peer messages` from a teammate | A peer asked the teammate something and they tried to idle without replying | Open the teammate's mailbox, reply or escalate |
| `BAD_PREFIX` on a new task | The lead created a task without the `impl:`/`review:`/`meta:`/`block:` prefix | Lead's bug — fix the task title |
| `NO_PLAN_APPROVAL` blocking a task complete | An `impl:` task is missing `metadata.plan_approved_at` | Lead forgot to stamp tasks after owner plan-approval; backfill from the checkpoint timestamp |
| `BAD_ESCALATION: missing field(s) ...` | A teammate posted a blocker without all five template fields | Rewrite using the full template in `ESCALATION.md` |
| Lead refuses to ping the owner | The teammate's request to escalate didn't use the §7 template | Same as above |
| Teammate ran a non-Superpowers approximation of a skill | Teammate paraphrased the SKILL.md instead of following it | The agent's system prompt requires the canonical skill — re-spawn and remind it explicitly |
| Two implementers want the same file | Plan didn't capture file-scope metadata for the overlapping tasks | Serialize by holding one; planner should backfill file-scope on the plan |
| `REFUSED: heartbeat ... is Ns old` from cleanup | Heartbeat is fresh — cleanup script thinks a lead is alive | Verify nothing's running; if certain the previous lead is dead, run with `--ignore-heartbeat` |
| `/team-feature` halts at preflight | Stale team config left over from a previous run | Run `/team-cleanup <slug>` (or resume via `/team-feature-resume`) |
| Auto-cleanup skipped after FINISH_DONE | One of Step A's preconditions failed (missing commits, in-progress tasks, etc.) | Read the lead's halt reason; once resolved, run `/team-cleanup <slug>` |
| Hook log noise | Hooks write tuning data to `.claude/hooks/log.jsonl` | Inspect the file; trim or refine matchers if a hook is over-triggering |

## Emergency bypass

`--dangerously-skip-permissions` will let a single task ship without the hooks firing. **Don't.** The hooks exist because Superpowers gates exist. Use the escalation template to surface the blocker properly.

## Where the methodology lives

The team-superpower plugin is purely the coordination layer. The actual development discipline (TDD, plan format, two-stage review, branch hygiene) is owned by the upstream [obra/superpowers](https://github.com/obra/superpowers) skills. If a skill's behaviour changes, the team picks it up automatically — agents reference skills by name, not by content.
