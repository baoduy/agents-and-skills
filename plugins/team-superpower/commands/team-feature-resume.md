---
description: Resume a team-superpower workflow from a committed checkpoint file in docs/superpowers/sessions/. Handles stale team state from a dead lead.
argument-hint: <checkpoint-filename>
---

You are the **lead** resuming an in-flight team-superpower workflow. `/resume` does not restore in-process teammates, so you reconstruct the team from the committed checkpoint and clean up any orphaned platform-side state along the way.

Checkpoint argument:

$ARGUMENTS

## Resume protocol (strict order)

### Step 1 — Locate the checkpoint

If `$ARGUMENTS` is a bare filename, prefix `docs/superpowers/sessions/`. Read it. If it doesn't exist or fails to parse against the checkpoint format from `/team-feature`, halt and ask the owner to point you at the correct file.

Extract `<slug>` from the checkpoint filename (`YYYY-MM-DD-<slug>.md`) and from the `**Team:**` line if present (`superpower-<slug>`). They must match.

If the checkpoint has a `## Closing` block with `cleanup: complete`, halt: the feature already finished. Tell the owner.

### Step 2 — Verify environment

Same prechecks as `/team-feature`:
- Superpowers plugin installed
- Claude Code ≥ 2.1.32
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

Halt on any failure.

### Step 3 — Preflight scan

Run:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/team-state.sh scan <slug>
```

Decide based on the output:

| Scan result | Interpretation | Action |
|---|---|---|
| All states `absent`, no heartbeat | Lead exited cleanly without auto-cleanup, or platform-side state was already wiped. | Proceed to Step 4 (fresh respawn). |
| Team config `present`, heartbeat older than 10 min (`liveness: stale`) | Previous lead is dead, platform state lingers. | Run `bash ${CLAUDE_PLUGIN_ROOT}/scripts/team-state.sh cleanup <slug> --force`. The heartbeat check will allow it because it's stale. Then proceed to Step 4. |
| Team config `present`, heartbeat fresh (`liveness: LIKELY ALIVE`) | A lead may still be running. | **Halt.** Tell the owner you detected what looks like a live lead. Ask them to verify nothing is in flight before re-running. If the owner confirms the previous lead is dead, instruct them to run `/team-cleanup <slug>` (which will require `--ignore-heartbeat`) and then re-run this command. |
| Team config `absent` but task_list or tmux still present | Partial cleanup from a previous attempt. | Run `bash ${CLAUDE_PLUGIN_ROOT}/scripts/team-state.sh cleanup <slug> --force`. Proceed. |

After any cleanup, re-run the scan and confirm `team_config_state: absent` before continuing.

### Step 4 — Identify resume point

The next pending phase is the first unchecked box in the checkpoint's `## Phases` section. Open escalations in the checkpoint take precedence — resolve them before resuming.

Read all the artefacts the next phase depends on:
- If next phase is `worktree` or later: design doc (path is in the checkpoint).
- If next phase is `implementation` or later: plan + `plan_approved_at` timestamp.
- If next phase is `finish`: review report.

### Step 5 — Reconstruct context

- `cd` into the worktree path recorded in the checkpoint. If it no longer exists, halt and escalate via the §7 template — the owner needs to restore or rebase the worktree before resume can continue.
- Recreate the team with the same name (`superpower-<slug>`).
- Touch `docs/superpowers/sessions/<slug>.heartbeat` and update it at every phase boundary (same protocol as `/team-feature`).

### Step 6 — Respawn only the teammates needed

For the next phase, spawn the relevant role(s) using the agent definitions shipped with this plugin. Do **not** respawn teammates whose phase is complete unless that phase needs them again later (e.g. reviewer is reused in phase 6).

Hand each respawned teammate:
- the slug
- the relevant artefact paths
- a note that this is a resume; they should pick up at the next pending task

### Step 7 — Re-import the shared task list

If resuming inside phase 4 (implementation):

1. Read the plan.
2. Recreate any `impl:` tasks that were pending or in-progress at checkpoint time. The `TaskCreated` hook enforces the prefix; the `TaskCompleted` hook requires `plan_approved_at` metadata — carry the timestamp forward from the checkpoint.
3. Skip `impl:` tasks that the checkpoint records as `complete` and whose corresponding commits exist on the worktree branch (verify with `git log --oneline -- <task-files>`). If a checkpoint marks a task complete but the commits are missing, halt — that's tampered or corrupted state.

### Step 8 — Append a resume log entry

Append to the checkpoint (atomic write — tmp + rename) and commit:

```markdown
## Resume log
- resumed at: <ISO datetime>
- next phase: <phase name>
- respawned: <comma-separated role list>
- preflight cleanup: <yes|no — what was cleaned>
```

### Step 9 — Resume the phase chain

Continue per the same rules as `/team-feature`:
- four allowed owner touchpoints, nothing else without §7 template
- checkpoint after every phase boundary, atomic writes
- heartbeat touched at every phase boundary
- automatic cleanup after `FINISH_DONE`

## Hard rules

- **Never** restart a completed phase. If a phase is checked in the checkpoint and the corresponding artefact + commits exist, trust it.
- **Never** assume teammates are still alive. They are not. Always respawn from the role definitions.
- **Never** silently change a previously approved design or plan. If the resumed state contradicts them, halt and escalate.
- **Never** skip Step 3 preflight. Stale team configs cause runtime errors and silently re-use the wrong session IDs.
- **Never** force-cleanup state with a fresh heartbeat unless the owner has confirmed in writing the previous lead is dead.
- **Never** skip the resume-log commit. It is the audit trail that proves the resume happened.

If anything in the checkpoint looks tampered with or inconsistent (e.g. plan marked approved but no plan file exists, completed task with missing commits), halt and escalate to the owner with the §7 template. Do not paper over.
