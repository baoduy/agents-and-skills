---
description: Resume a team-superpower workflow from a committed checkpoint file in docs/superpowers/sessions/.
argument-hint: <checkpoint-filename>
---

You are the **lead** resuming an in-flight team-superpower workflow. `/resume` does not restore in-process teammates, so you reconstruct the team from the committed checkpoint.

Checkpoint argument:

$ARGUMENTS

## Resume protocol (strict order)

1. **Locate the checkpoint.** If `$ARGUMENTS` is a bare filename, prefix `docs/superpowers/sessions/`. Read it. If it does not exist or fails to parse against the checkpoint format from `/team-feature`, halt and ask the owner to point you at the correct file.
2. **Verify environment.** Same prechecks as `/team-feature`: Superpowers plugin installed, Claude Code ≥ 2.1.32, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Halt on any failure.
3. **Identify resume point.** The next pending phase is the first unchecked box in the `## Phases` section. Open escalations in the checkpoint take precedence — resolve them before resuming.
4. **Reconstruct context.** Read the design doc (if phase ≥ brainstorming complete), the plan (if phase ≥ plan approved), and the latest review report (if any). Note the worktree path; `cd` into it if not already there. If the worktree path no longer exists, halt and escalate via the §7 template.
5. **Respawn only the teammates needed for the next phase.** Use the role definitions shipped with this plugin (`designer`, `planner`, `implementer`, `reviewer`). Hand each one the same `<slug>` and the relevant artifact paths via its spawn prompt. Do not respawn teammates whose phase is already complete unless the next phase requires them again (e.g. reviewer for phase 5/6).
6. **Re-import the shared task list.** If you are resuming inside phase 4 (implementation), re-create any `impl:` tasks that were pending at checkpoint time. Carry forward `plan_approved_at` metadata from the plan-approval timestamp recorded in the checkpoint — without it the `TaskCompleted` hook will reject completions.
7. **Update the checkpoint.** Append a `## Resume log` entry with the current ISO datetime, who was respawned, and which phase you are resuming into. Commit.
8. **Resume the phase chain** at the identified phase, following the same rules as `/team-feature`: owner touchpoints limited to the four allowed events, every escalation via the §7 template, checkpoint after every phase boundary.

## Hard rules

- **Never** restart a completed phase. If a phase is checked in the checkpoint, trust it.
- **Never** assume teammates are still alive. They are not. Always respawn.
- **Never** silently change a previously approved design or plan. If the resumed state contradicts them, halt and escalate.
- **Never** skip the resume-log commit. It is the audit trail that proves the resume happened.

If anything in the checkpoint looks tampered with or inconsistent (e.g. plan listed approved but no plan file exists), halt and escalate to the owner with the §7 template. Do not paper over.
