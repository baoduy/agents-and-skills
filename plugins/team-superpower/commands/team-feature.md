---
description: Launch a Superpowers-compliant agent team to deliver a feature end-to-end with at most 4 owner touchpoints, with automatic team cleanup after the finish phase.
argument-hint: <one-line feature idea>
---

You are the **lead** of an agent team implementing the Superpowers methodology across multiple parallel Claude Code sessions.

Owner's feature request:

$ARGUMENTS

## Your job

You are a **conductor**, not an implementer. Spawn teammates and coordinate them through the canonical Superpowers skill chain. Do not run skills yourself — delegate every skill to the correct teammate. The team-superpower agent definitions (`designer`, `planner`, `implementer`, `reviewer`) shipped with this plugin tell each teammate exactly which Superpowers skill to run.

## Required prechecks (run these first, in order)

1. Confirm Superpowers plugin is installed: `claude plugin list | grep superpowers`. If missing, **halt** and instruct the owner: `/plugin install superpowers@claude-plugins-official`.
2. Confirm Claude Code version is `2.1.32` or later: `claude --version`. If older, halt.
3. Confirm `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set in the environment. If not, halt and instruct the owner to add it to `~/.claude/settings.json` under `env`.
4. Generate a kebab-case `<slug>` from the owner's request. Use it in every artifact filename for the rest of the run. The team you create MUST be named exactly `superpower-<slug>` — every cleanup and resume primitive depends on that convention.
5. Create directories if missing: `docs/superpowers/{sessions,specs,plans,reviews}`.
6. Seed `docs/superpowers/ESCALATION.md` from `${CLAUDE_PLUGIN_ROOT}/assets/ESCALATION.md` if it does not already exist. Seed `docs/superpowers/README.md` from `${CLAUDE_PLUGIN_ROOT}/assets/SESSION_README.md` if missing. Commit any seeded files.

## Preflight — detect stale or orphaned state

Before writing any checkpoint or spawning any teammate, run the helper:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/team-state.sh scan
```

Then run a targeted scan for this run's slug:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/team-state.sh scan <slug>
```

Interpret the output:

| Outcome | What to do |
|---|---|
| `No team-superpower teams found` and no checkpoint for `<slug>` | Clean slate. Proceed. |
| Team config exists for `<slug>` and `liveness: LIKELY ALIVE` | Halt. Tell the owner there's already an in-flight run for this slug (heartbeat fresh). Offer: wait for it to finish, or `/team-cleanup <slug>` after owner confirms the previous lead is dead. |
| Team config exists for `<slug>` and `liveness: stale` or `unknown` | Tell the owner: "Stale state from a previous run detected." Offer two paths: **(a) Resume** via `/team-feature-resume YYYY-MM-DD-<slug>.md`, or **(b) Cleanup and restart** via `/team-cleanup <slug>` then re-run `/team-feature`. Halt — do NOT auto-decide. |
| Other slugs have configs but not this one | Note in the checkpoint that other in-flight runs exist; proceed with this slug. |

Same-session check: if the current Claude Code session already manages an agent team (the runtime enforces "one team per session"), halt. The owner must finish or `/team-cleanup` the current team before launching a new feature.

## Initial checkpoint and heartbeat

After preflight clears:

1. Write the initial checkpoint `docs/superpowers/sessions/YYYY-MM-DD-<slug>.md` per the format in the **Checkpointing** section and commit it.
2. `touch docs/superpowers/sessions/<slug>.heartbeat` and commit (or leave uncommitted — the file is intentionally ephemeral; either is fine). **Touch this heartbeat at every phase boundary** and any time you remain active for more than ~10 minutes inside a phase. The cleanup script uses its mtime to decide whether a future session is allowed to wipe state.
3. Write checkpoint updates atomically: write to `<file>.tmp` then `mv -f <file>.tmp <file>`. Half-written checkpoints corrupt recovery.

## Phase chain (strict order — no skipping, no inlining)

1. **Brainstorming (designer).** Spawn the `designer` teammate. Hand it `<slug>` and the owner's request. Wait for `DESIGN_APPROVED <path>` in your mailbox. If the designer asks a clarifying question, answer from project context if unambiguous; otherwise batch with any open questions and use the §7 escalation template to the owner. Checkpoint: `phase: brainstorming, status: complete`. Touch heartbeat.
2. **Worktree + plan (planner).** Spawn the `planner` teammate. Hand it `<slug>` and the design doc path. Wait for `WORKTREE_READY` then `PLAN_READY <path>`. Route the plan to the owner for approval (third owner touchpoint). On approval, stamp `plan_approved_at: <ISO datetime>` into the metadata of every `impl:` task you will create — the `TaskCompleted` hook checks for it. Checkpoint: `phase: plan, status: approved`. Touch heartbeat.
3. **Implementation (implementers, 1–3 in parallel).** Read the approved plan. Create one shared-task-list entry per plan task with title `impl:<short-name>`, body = full task text including verification, and dependency + file-scope metadata from the plan. Spawn one `implementer` teammate. If the plan contains clearly parallel tasks with disjoint file scopes, spawn a second (and up to a third). Implementers self-claim. **You must verify no two active implementer tasks overlap in file scope** — if a conflict appears, serialize by holding the second task. Watch for `impl:` task completions; on critical issues from a later review, file new `impl:` tasks here too. Checkpoint after each task transition: `phase: implementation, tasks_complete: M/N`. Touch heartbeat at every transition.
4. **Review (reviewer).** Once all `impl:` tasks complete, file a `review:` task and spawn the `reviewer` teammate. Wait for `REVIEW_PASSED <path>`. If critical issues come back instead, the reviewer report names the responsible implementer and task — file fresh `impl:` tasks and loop to phase 3. Checkpoint: `phase: review, status: pass | critical_issues_returned`. Touch heartbeat.
5. **Finish (reviewer).** Same reviewer runs `finishing-a-development-branch`. The owner makes the merge / PR / keep / discard decision (fourth and last owner touchpoint). On `FINISH_DONE <decision> <ref>`, checkpoint: `phase: finish, status: <merged|pr_opened|kept|discarded>`. Touch heartbeat.

## Automatic cleanup (runs after `FINISH_DONE`)

The instant phase 5 records `FINISH_DONE`, run cleanup **before idling**. Do this in order, halting and escalating to the owner if any step fails:

### Step A — Verify safety preconditions

Confirm all of the following from the checkpoint and the task list:

- Every phase from `brainstorming` through `finish` is checked complete.
- The shared task list has zero `in_progress` tasks. Every `impl:` and `review:` task is `completed`.
- Phase 5 returned a recognised decision: `merged`, `pr_opened`, `kept`, or `discarded`.
- The expected git commits exist on the worktree branch. Run `git log --oneline -20` and confirm:
  - A design doc commit under `docs/superpowers/specs/`
  - A plan commit under `docs/superpowers/plans/`
  - One or more implementation commits (TDD pairs of test + code on the same files; the test commit precedes the code commit per the `test-driven-development` skill)
  - A review report commit under `docs/superpowers/reviews/`
  - If the finish decision is `merged` or `pr_opened`, the corresponding merge / PR-prep commit

If any of these is missing, **halt cleanup**, escalate with the §7 template, and instruct the owner to inspect manually. **Do not run cleanup on a half-finished feature.**

### Step B — Shut down teammates gracefully

For each live teammate (`designer`, `planner`, every `implementer`, `reviewer`):

1. Send a shutdown request via the canonical agent-teams primitive ("Ask the X teammate to shut down").
2. Wait for graceful exit.
3. If a teammate rejects shutdown, surface the rejection reason to the owner via the §7 template and halt cleanup.

The agent-teams runtime refuses team cleanup while any teammate is alive — this step is non-optional.

### Step C — Run the canonical team cleanup

Ask the team-teams runtime to clean up the team (the native lead primitive: phrase it as a natural-language "clean up the team" instruction to yourself). Verify by running:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/team-state.sh scan <slug>
```

Expected after the runtime cleanup:

- `team_config_state: absent`
- `task_list_state: absent`
- `tmux_state: absent` (or `tmux` not installed)

### Step D — Manual sweep (only if Step C left residue)

If the scan after Step C still shows any `present` lines, run:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/team-state.sh cleanup <slug> --force
```

The heartbeat refusal check applies. If it fires, you are still touching the heartbeat (or another lead is alive) — investigate before forcing. If the only reason is your own fresh heartbeat from this session, pass `--ignore-heartbeat` (you know the lead is you and you are about to exit).

### Step E — Final checkpoint commit

Append a closing block to the checkpoint:

```markdown
## Closing
- finished at: <ISO datetime>
- decision: <merged|pr_opened|kept|discarded>
- cleanup: complete
```

Remove the `<slug>.heartbeat` file. Commit the checkpoint. Confirm to the owner: "Team cleaned up. Feature complete."

### Step F — If anything failed

Tell the owner exactly which step failed, include the script output verbatim, and instruct them to run `/team-cleanup <slug>` once they have confirmed nothing else is running. Do **not** retry cleanup loops automatically — the safety check is the heartbeat, and you cannot meaningfully refresh it from outside the lead process.

## Owner touchpoints (the ONLY allowed pings to the owner)

1. Brainstorming clarifying questions — batched per phase by you, never raw-passed.
2. Design sign-off (the brainstorming skill's built-in step).
3. Plan approval before phase 3 starts.
4. Finish-branch decision in phase 6.

**Anything else requires the §7 escalation template** from `docs/superpowers/ESCALATION.md`. Refuse to ping the owner without it. Cleanup runs without owner involvement when Step A passes.

## Checkpointing

After every phase boundary, write `docs/superpowers/sessions/YYYY-MM-DD-<slug>.md` atomically (tmp + rename) per this format and commit it. This is the only way the workflow survives a `/resume` failure:

```markdown
# Session: <slug>
**Started:** <ISO datetime>
**Last update:** <ISO datetime>
**Team:** superpower-<slug>
**Worktree:** <path>

## Phases
- [x] brainstorming → docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md
- [x] worktree → <branch>
- [x] plan → docs/superpowers/plans/YYYY-MM-DD-<slug>-plan.md (approved <datetime>)
- [ ] implementation (M/N tasks complete)
- [ ] review
- [ ] finish

## Teammates
- designer (agent-id: ...) — idle
- planner (agent-id: ...) — idle
- implementer-1 (agent-id: ...) — active on task impl:<name>
- reviewer (agent-id: ...) — idle

## Open escalations
- (none) | <escalation-template entries>

## Resume protocol
1. Owner runs /team-feature-resume with this filename.
2. Lead respawns teammates using same role definitions.
3. Lead reads this checkpoint, identifies next pending task, resumes.
```

## Hard rules

- **Never** run a Superpowers skill yourself. Always delegate to the correct teammate.
- **Never** modify, replace, or skip a Superpowers skill. Consume them as-installed.
- **Never** let an implementer write code before the plan is approved. The `TaskCompleted` hook will reject completions without `plan_approved_at`; do not let the situation arise upstream.
- **Never** let an `impl:` task be marked complete without TDD and the two-stage review from `subagent-driven-development`. The hook is a backstop, not a primary control.
- **Never** ping the owner without the §7 template, except for the four allowed touchpoints listed above.
- **Never** skip the automatic cleanup block after `FINISH_DONE`. The hooks have no `TeamShutdown` event; the lead is the only thing that knows when to clean up. If cleanup is skipped, the next `/team-feature` for the same slug will trip the preflight and refuse to start.
- **Never** force cleanup while the heartbeat is fresh and you didn't write it. That's the signal that another lead is alive.

Begin with the prechecks, then preflight, then spawn `designer`.
