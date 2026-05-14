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

### Step 2.5 — Superpowers version-pin check

Read the checkpoint frontmatter (the YAML block between `---` markers at the top of the file). Extract `superpowers_version`. Read the currently-installed Superpowers version (`claude plugin list --json` → grep for `superpowers`). Compare:

- **Versions match** → proceed.
- **Versions differ** → halt and surface this 3-option menu to the owner:

  > **Superpowers version drifted** since this feature started:
  > - pinned in checkpoint: `<pinned>`
  > - currently installed: `<current>`
  >
  > Skill semantics may have shifted. Pick one:
  > - **A. Continue anyway** — accept the risk; semantics may differ mid-feature.
  > - **B. Roll back Superpowers** — owner runs `/plugin install superpowers@<pinned>` and re-runs `/team-feature-resume`. (Lead halts; cannot install plugins itself.)
  > - **C. Discard this feature** — halt resume; the owner manually cleans state via `/team-cleanup <slug>` and starts fresh.

  This is **not** counted as a touchpoint because it only happens on resume after a rare Superpowers update. On choice A, log `superpowers_pin_overridden: <pinned> → <current>` to the resume-log block; on choice B halt without changes; on choice C halt and instruct the owner to `/team-cleanup`.

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
- If next phase is `plan` or later: design doc (path is in the checkpoint).
- If next phase is `pre_impl_review` or later: plan + `plan_approved_at` timestamp.
- If next phase is `implementation` or later: ARCH + SEC reports (both must be `*_PASSED`).
- If next phase is `qa` or later: implementation commits on the worktree branch.
- If next phase is `review` or later: QA report (`QA_PASSED`).
- If next phase is `finish`: code-review report (`REVIEW_PASSED`).

### Step 4.a — Mid-phase 7 resume (merge_blocked)

If the checkpoint's `## Phases` block shows `- [ ] finish (blocked: <reason>, merge_retries: K/3)`, the previous lead crashed inside phase-7 merge-failure handling. Resume protocol:

1. Read `<reason>` and `K` from the checkpoint line.
2. Re-spawn the reviewer (Hat 2 only; reviewer is reused).
3. Re-present the 5-option menu from `/team-feature` § Phase 7 merge-failure handling, with option A dropped if `K == 3`.
4. The owner's choice is translated and reviewer continues per the same translation table.
5. On the next `FINISH_DONE`, normal auto-cleanup runs (including Step D.5 if decision is `merged`).

Do NOT re-run earlier phases. Their checkpoints stand.

### Step 4.b — Mid-Step-D.5 resume (worktree removal in flight)

If the checkpoint's `## Closing` block exists but is incomplete (has `decision:` and `cleanup: complete` but is missing the `worktree:` line) AND the recorded decision is `merged`, the previous lead crashed inside Step D.5. Resume protocol:

1. Read `**Worktree origin:**` from the checkpoint. If it is `reused`, Step D.5 should never have run — abort the mid-Step-D.5 path: append `worktree: removal-skipped:reused-existing-worktree` to the Closing block, commit, and exit normally. The owner's pre-existing worktree stays on disk. Skip to Step 5 of the resume protocol only if there is still feature work to resume; otherwise the resume terminates here.
2. Verify Step A–D conditions still hold by running `bash ${CLAUDE_PLUGIN_ROOT}/scripts/team-state.sh scan <slug>` — all states must be `absent`. If anything is `present`, halt and instruct the owner to run `/team-cleanup <slug>` before resuming.
3. Re-run Step D.5 from the top: read `**Worktree:**`, `cd` to repo root, check `git worktree list --porcelain`, attempt non-forced remove. The procedure is idempotent — if the worktree was already removed in the prior session it'll be recorded as `already-absent`.
4. On remove failure, re-enter the 4-option remove-failure menu fresh (no carry-over retry count — the prior session's count was not persisted because Step D.5 retries are per-session, not per-run; this is intentional, the owner sees a fresh menu).
5. On completion, write the missing Closing-block fields (`worktree`, `worktree_path` if applicable, `dropped_files` if applicable) and commit.

### Step 5 — Reconstruct context

- `cd` into the worktree path recorded in the checkpoint. If it no longer exists, halt and escalate via the §7 template — the owner needs to restore or rebase the worktree before resume can continue.
- Recreate the team with the same name (`superpower-<slug>`) via the canonical `TeamCreate` tool:
  ```
  TeamCreate({
    team_name:   "superpower-<slug>",
    agent_type:  "team-lead",
    description: "<reuse the description from the previous run if recorded in the checkpoint; otherwise the owner's one-line request>"
  })
  ```
  TeamCreate is idempotent at the directory level — if `~/.claude/teams/superpower-<slug>/config.json` already exists from a partial cleanup, the runtime will refuse to overwrite. In that case, halt and instruct the owner to run `/team-cleanup <slug>` first (the resume protocol Step 3 should have caught this; if it didn't, that's a real bug — escalate).
- Touch `docs/superpowers/sessions/<slug>.heartbeat` and update it at every phase boundary (same protocol as `/team-feature`).

### Step 6 — Re-read the shape marker

Read `docs/superpowers/sessions/<slug>.shape` and `stack_shape` from the checkpoint frontmatter. They must match — if they disagree, halt and escalate (one was hand-edited). The shape determines which implementer to respawn:

- `full-stack` → both `backend-developer` and `frontend-developer` are eligible to respawn.
- `be-only` → only `backend-developer`. NEVER respawn `frontend-developer` for a `be-only` feature.
- `fe-only` → only `frontend-developer`. NEVER respawn `backend-developer`.

If the marker file is missing, re-derive shape from `CLAUDE.md` via `bash ${CLAUDE_PLUGIN_ROOT}/scripts/parse-claudemd.sh shape CLAUDE.md` and write the marker file before continuing.

### Step 6 (cont.) — Respawn only the teammates needed

For the next phase, spawn the relevant role(s) using the canonical `Agent` primitive documented in `/team-feature` § "Create the team (canonical primitive)" — same `subagent_type` / `team_name` / `name` / `prompt` shape, and `team_name` MUST be `superpower-<slug>` so messages route to the existing inboxes under `~/.claude/teams/superpower-<slug>/inboxes/`. Do **not** respawn teammates whose phase is complete unless that phase needs them again later (e.g. reviewer is reused in phase 7 for finish; planner is re-spawned if phase 3 returned `ARCH_BLOCKED` / `SEC_BLOCKED` and the plan needs revision; backend-developer / frontend-developer are re-spawned for `impl:qa-fix-*` or `impl:review-fix-*` tasks). Phase-to-role map:

| Next phase | Spawn |
|---|---|
| `design` | `designer` |
| `plan` | `planner` |
| `pre_impl_review` | `software-architect` + `security-engineer` (parallel) |
| `implementation` | `backend-developer` and/or `frontend-developer`, **filtered by stack_shape** (be-only ⇒ BE only; fe-only ⇒ FE only; full-stack ⇒ both, route by prefix) |
| `qa` | `qa-engineer` |
| `review` | `reviewer` |
| `finish` | `reviewer` |
| `finish (blocked: ...)` | `reviewer` (Hat 2) — same reviewer instance; re-present the 5-option menu, honour the persisted `merge_retries` count |

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
- three allowed owner touchpoints (design sign-off, plan approval, finish-branch decision — `FINISH_BLOCKED` follow-up menus count as the same finish-branch touchpoint continued), nothing else without §7 template
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
- **Never** respawn an implementer for a shape that excludes it (`frontend-developer` in `be-only`, `backend-developer` in `fe-only`). The hooks will reject the implementer's task creations anyway, but spawning is your decision and you do not bypass the shape.
- **Never** silently ignore a `superpowers_version` mismatch. Always surface the 3-option menu at Step 2.5.

If anything in the checkpoint looks tampered with or inconsistent (e.g. plan marked approved but no plan file exists, completed task with missing commits), halt and escalate to the owner with the §7 template. Do not paper over.
