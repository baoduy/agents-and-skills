# Design — Worktree cleanup on successful merge

**Date:** 2026-05-13
**Plugin:** `plugins/team-superpower`
**Slug:** `worktree-cleanup-on-merge`

## Problem

`/team-feature` runs an automatic 6-step cleanup (Steps A–F) the instant phase 7 posts `FINISH_DONE`. Cleanup wipes **platform-side** state only — the agent-team config under `~/.claude/teams/superpower-<slug>/`, the shared task list, the tmux session. It does **not** touch the git worktree the planner created in phase 2.

After a successful `merged` finish, the feature branch is already in the trunk; the worktree directory is dead weight on disk. Owners currently have to remember to run `git worktree remove <path>` by hand. Worse, when the finishing-a-development-branch skill can't merge (conflict, non-ff, dirty worktree, push rejected), the workflow drops into ad-hoc escalation with no structured options.

## Goal

Extend the existing auto-cleanup so that:

1. Worktree removal is automatic when — and only when — the feature was actually merged AND platform cleanup verified clean.
2. Merge-step failures surface a deterministic 5-option menu instead of free-form escalation.
3. Worktree-removal failures surface a deterministic 4-option menu with a force-remove escape hatch behind explicit confirmation.

The lead remains the only orchestrator. No new files, no new commands.

## Non-goals

- Automatic branch deletion. Branches survive worktree removal so the owner can backport / inspect history.
- Automatic `git worktree prune`. The cleanup runs only on the slug the lead owns.
- New helper scripts. All logic lives in `team-feature.md` and `team-feature-resume.md`.
- Changes to `scripts/team-state.sh`. It stays platform-only.
- Removing worktrees on `pr_opened` / `kept` / `discarded` decisions. PR follow-ups need the local copy; `kept` is explicit owner choice; `discarded` may still hold artefacts the owner wants to inspect.

## Trigger conditions for worktree removal

ALL of the following must be true. Any miss → skip removal, record the reason.

1. `FINISH_DONE merged <ref>` posted by the reviewer.
2. Step A precondition check passed (all phases complete, expected commits present, all teammates idle).
3. Step B teammate shutdown clean.
4. Step C team cleanup ran. The post-cleanup scan shows `team_config_state: absent`, `task_list_state: absent`, `tmux_state: absent`. (Or Step D manual sweep brought it to that state.)
5. Checkpoint has a non-empty `**Worktree:**` field.

## Phase-7 merge-failure handling

### New mailbox signal: `FINISH_BLOCKED <reason>`

Reviewer (Hat 2, phase 7) posts this when the finishing-a-development-branch skill's merge step fails for the `merged` decision. `<reason>` is one of:

- `conflict` — `git merge` raised conflict markers
- `non-ff` — non-fast-forward, remote diverged
- `dirty-worktree` — uncommitted changes blocked the merge
- `push-rejected` — merge succeeded locally but push to remote was rejected
- `other:<short-string>` — any other failure mode; lead carries the git stderr verbatim

`FINISH_DONE <decision> <ref>` is unchanged. It still posts on the success path of every decision (`merged` post-merge, `pr_opened` post-push, `kept` after the owner picks keep, `discarded` after branch deletion).

### Lead behaviour on `FINISH_BLOCKED`

1. Stash `<reason>` and the verbatim git output from the reviewer's mailbox message.
2. Update checkpoint: `phase: finish, status: merge_blocked, reason: <reason>, retry_attempts: K/3` where K is the count of prior retry attempts in this run.
3. Touch heartbeat.
4. Present the 5-option menu to the owner. This is the existing finish-branch touchpoint continued; it does NOT exceed the 3-touchpoint cap.
5. Translate the owner's choice and re-engage the reviewer per the table below.

### 5-option merge-failure menu

| Choice | Action | Re-spawn reviewer? | Expected next signal |
|---|---|---|---|
| **A — Retry merge** | Owner has resolved conflicts externally or upstream has stabilised. Lead instructs reviewer to re-run the merge step. Increments `retry_attempts`. | No, reuse same reviewer | `FINISH_DONE merged <ref>` or `FINISH_BLOCKED <reason>` |
| **B — Switch to pr_opened** | Reviewer re-runs `finishing-a-development-branch` with `decision=pr_opened`. | No | `FINISH_DONE pr_opened <ref>` |
| **C — Switch to kept** | Reviewer posts `FINISH_DONE kept <branch>` directly. | No | `FINISH_DONE kept <ref>` |
| **D — Switch to discarded** | Reviewer runs the discard path of finishing-a-development-branch. | No | `FINISH_DONE discarded <ref>` |
| **E — Escalate via §7** | Lead posts the §7 template to the owner with the verbatim git stderr. Halts until the owner responds. | No | Owner directs manually |

### Retry cap

`retry_attempts` is bounded at 3. After the 3rd `FINISH_BLOCKED`, option A is removed from the menu; the owner must pick B / C / D / E. The counter persists across `/resume` via the checkpoint.

## Auto-cleanup — new Step D.5 (worktree removal)

Inserted between Step D (manual platform-state sweep) and Step E (final checkpoint commit). Runs only after Step C / D have verified all platform state absent.

### Step D.5 procedure

1. Check trigger conditions (the five listed above). Any miss → record `worktree: removal-skipped:<reason>` in the Closing block, skip to Step E.
2. Read the worktree path from the checkpoint's `**Worktree:**` line.
3. `cd` to the repo root (the **main** worktree, not the feature worktree). `git worktree remove` refuses when `cwd` is inside the target.
4. Run `git worktree list --porcelain`. If the worktree path is not listed, record `worktree: already-absent` and skip to Step E.
5. Touch heartbeat.
6. Run `git worktree remove <path>` (non-forced).
7. Success → record `worktree: removed`. Touch heartbeat. Proceed to Step E.
8. Non-zero exit → enter the 4-option remove-failure menu.

### 4-option remove-failure menu

| Choice | Action | Closing-block record |
|---|---|---|
| **A — Show files + retry** | Run `git -C <path> status --short` and `git -C <path> diff --stat`. Surface output to owner. Then retry `git worktree remove <path>`. Cap 3 retries per Step D.5. | On retry success: `worktree: removed (after manual fix)`. On still-failing after 3rd retry: option A drops, force B/C/D. |
| **B — Force remove** | Lead prompts: "This discards uncommitted work in `<path>`. Confirm force-remove? (y/N)". On `y`: `git worktree remove --force <path>`. List files that were dropped (from the pre-remove `status --short` snapshot). | `worktree: force-removed`, `dropped_files: [...]` |
| **C — Keep worktree** | Lead logs the path. Tells owner: "Worktree retained at `<path>`. Remove manually with `git worktree remove <path>` once handled." | `worktree: kept-by-owner`, `worktree_path: <path>` |
| **D — Escalate via §7** | Halt Step D.5. Lead posts §7 template with the stderr from the failed remove. | `worktree: escalated`, `worktree_path: <path>` |

### Branch handling

`git worktree remove` does not delete the branch. After `merged`, the branch is already in the trunk; deleting it stays an explicit owner step outside this flow. The Closing block does not auto-delete the branch.

## Checkpoint format updates

### Mid-phase 7 (FINISH_BLOCKED state)

```markdown
## Phases
- [x] design → docs/superpowers/specs/...
- [x] plan → docs/superpowers/plans/...
- [x] pre_impl_review → docs/superpowers/reviews/...
- [x] implementation (N/N tasks complete)
- [x] qa → docs/superpowers/reviews/...
- [x] review → docs/superpowers/reviews/...
- [ ] finish (blocked: <reason>, retry-attempts: K/3)
```

The `finish` row stays unchecked until `FINISH_DONE` posts. `/team-feature-resume` reads this row to know it must respawn the reviewer and re-present the 5-option menu.

### Closing block (after Step E completes)

```markdown
## Closing
- finished at: <ISO datetime>
- decision: <merged|pr_opened|kept|discarded>
- cleanup: complete
- worktree: <removed | already-absent | removal-skipped:<reason> | removed (after manual fix) | force-removed | kept-by-owner | escalated>
- worktree_path: <path>            # only when state ∈ {kept-by-owner, escalated, removal-skipped (with worktree on disk)}
- merge_retries: K                 # only when K > 0
- dropped_files: [<path>, ...]     # only when state == force-removed
```

`removal-skipped` reasons: `not-merged-decision` | `team-cleanup-incomplete` | `no-worktree-recorded`.

## File changes

| File | Scope |
|---|---|
| `plugins/team-superpower/commands/team-feature.md` | Add `FINISH_BLOCKED` handling + 5-option menu in phase 7. Insert Step D.5 with the 4-option menu. Update checkpoint format example. Update Hard rules: merge-retry cap, worktree-removal trigger. |
| `plugins/team-superpower/commands/team-feature-resume.md` | Resume case for `finish (blocked: ...)`: re-read reason, present 5-option menu, honour `retry_attempts`. Resume case for partial Step D.5 (re-enter the 4-option menu). |
| `plugins/team-superpower/agents/reviewer.md` | Document `FINISH_BLOCKED <reason>` signal in Hat 2. Document the `<reason>` enum. Document retry-on-A behaviour (lead may ask for re-merge up to 3 times). |
| `plugins/team-superpower/assets/SESSION_README.md` | Add troubleshooting rows for `FINISH_BLOCKED conflict`, `worktree remove failed`. Document the Closing-block additions. |
| `plugins/team-superpower/assets/ESCALATION.md` | 3rd worked example: a `FINISH_BLOCKED` escalation (option E). No change to the phase enum. |
| `plugins/team-superpower/README.md` | Update the "Automatic cleanup after the feature ships" section: worktree removal on `merged`, the two failure menus, the retry cap. |

## Out of scope

- Branch deletion automation.
- `git worktree prune`.
- Helper scripts.
- Changes to `scripts/team-state.sh`, `plugin.json`, `marketplace.json`, or the root `README.md`.

## Acceptance criteria

1. `team-feature.md` documents both menus with exact option text and translation tables.
2. `team-feature-resume.md` handles the two new resume states (`finish (blocked: ...)`, mid-Step-D.5).
3. `reviewer.md` documents `FINISH_BLOCKED <reason>` and the `<reason>` enum.
4. After `FINISH_DONE merged`, a fresh integration scenario shows the worktree directory gone, the branch still present, and the Closing block populated with `worktree: removed`.
5. After a deliberately conflicting merge, the lead surfaces the 5-option menu, accepts each option in turn, and reaches a `FINISH_DONE <new-decision>` that the rest of cleanup honours.
6. After a `merged` decision where `git worktree remove` fails (e.g. owner pre-seeded an untracked file), the lead surfaces the 4-option menu, B succeeds with confirmation, and the Closing block records `force-removed` plus the dropped-files list.
