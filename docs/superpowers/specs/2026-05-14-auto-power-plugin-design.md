# Auto-Power Plugin Design

**Date:** 2026-05-14
**Status:** Draft — pending user review
**Slug:** `auto-power-plugin`

## Goal

Ship a new marketplace plugin `auto-power` that wraps the `obra/superpowers` skill chain into a single-command, hands-off pipeline. After the user approves a spec, the pipeline runs design → plan → arch+sec → impl → verify → review → ff-merge with zero additional touchpoints, escalating only on substantive failures.

`auto-power` reuses `superpowers` skills verbatim — it does not fork or duplicate their content. It adds: clarifying-question auto-answer logic, a gate-failure retry policy, a checkpoint format, mid-impl auto-approve hooks, and an automated finish step.

## Non-Goals

- Multi-agent fan-out (use `team-superpower` for that — `auto-power` is single-session, serial).
- Replacing `superpowers` skills (they are invoked, not rewritten).
- Auto-opening PRs or non-ff merges (out of scope for v1; finish action is ff-merge only).
- Cross-repo orchestration.

## Architecture

### Entry points

- `/auto-power <idea> [--branch=<name>] [--no-worktree | --worktree] [--max-retries=N]`
- `/auto-power-resume <slug-or-checkpoint-path> [--cleared]`

### Execution model

Single Claude session. No subagent fan-out. Pipeline runs serially:

```
brainstorming (auto-answered)
  → user-approval gate         ← ONLY interactive touchpoint
  → writing-plans
  → arch + sec self-review (inline checklist)
  → worktree detection / setup
  → executing-plans OR subagent-driven-development
  → verification-before-completion
  → requesting-code-review (self-review pass)
  → finishing-a-development-branch (ff-merge to main)
```

### Plugin layout

```
plugins/auto-power/
  .claude-plugin/plugin.json
  commands/
    auto-power.md
    auto-power-resume.md
  skills/
    auto-power-runtime/SKILL.md      # driver: auto-answer, retry, checkpoint, auto-approve
  assets/
    CHECKPOINT_SCHEMA.md
    ESCALATION_TEMPLATE.md
  README.md
```

### Marketplace + repo wiring (per CLAUDE.md ship rule)

In one commit:

1. Create `plugins/auto-power/.claude-plugin/plugin.json` (version `0.1.0`).
2. Add `auto-power` row to `.claude-plugin/marketplace.json` `plugins[]`.
3. Add `auto-power` row to top-level `README.md` Plugins table.

## Clarifying-question auto-answer (spec phase)

`auto-power` invokes `superpowers:brainstorming` but intercepts every clarifying question. Each question is classified against a **deterministic category whitelist** before being shown to the user.

### Auto-answer whitelist

| Category | Source of answer |
|---|---|
| Test framework | `package.json` devDependencies, `pyproject.toml`, existing test files |
| Build / lint / format command | `CLAUDE.md` `team-superpower` block; `package.json` scripts; `Makefile` |
| File naming convention | Nearest sibling files in target dir |
| Code style | Existing formatter config (`.prettierrc`, `ruff.toml`, `.editorconfig`) |
| Target directory | Match existing module structure for similar features |
| Language / runtime version | `package.json` engines, `.tool-versions`, `.nvmrc`, `pyproject.toml` |
| Plugin location | `plugins/<name>/` per repo CLAUDE.md |
| Visual companion offer | Always decline (non-interactive run) |

A question matches the whitelist only if the relevant signal is **present and unambiguous**. Missing or conflicting signals fall through to "raise".

### Always raise to user

- Purpose / success criteria when the idea is ambiguous.
- Trade-off choices with no clear repo signal (e.g. "JWT or session cookie?").
- Scope decomposition prompts (multi-subsystem detection).
- The "propose 2-3 approaches" prompt — user picks the architecture.
- Anything not on the whitelist.

### Audit trail

Every auto-answer is logged to `docs/superpowers/specs/<slug>-auto-decisions.md` with: question, category, signal source, answer. User can review post-hoc.

### Sole interactive touchpoint

After brainstorming finishes, `auto-power` writes the spec, runs the standard inline spec self-review, then asks the user to review the spec file. **This is the only owner touchpoint by design.** Approval → pipeline continues hands-off.

## Post-spec pipeline phases

| Phase | Skill invoked | Output artifact | Pass condition |
|---|---|---|---|
| 2. Plan | `superpowers:writing-plans` | `<slug>-plan.md` committed | Plan file exists; every task has file paths + verify steps |
| 3. Arch+Sec self-review | inline checklist in `auto-power-runtime` | review notes appended to plan | Zero ❌ items |
| 4. Worktree (conditional) | `superpowers:using-git-worktrees` | branch + worktree path | See worktree detection below |
| 5. Impl | `superpowers:subagent-driven-development` (preferred) or `superpowers:executing-plans` | per-task commits | All plan tasks DONE; tests pass |
| 6. Verify | `superpowers:verification-before-completion` | report | All checks pass |
| 7. Review | `superpowers:requesting-code-review` (self-review pass) | review log | No blockers |
| 8. Finish | `superpowers:finishing-a-development-branch` | ff-merge to main, branch deleted | Clean ff; CI green |

### Worktree detection (phase 4)

At pipeline start, detect whether the current working directory is inside a worktree (not the main repo) via `git rev-parse --show-toplevel` + `git worktree list`.

- **Already in worktree (user pre-setup, default expectation):** skip creation. Use current branch as work branch. Record path + `worktree_created_by_us: false` in checkpoint. `auto-power` will **not** remove this worktree on finish.
- **In main repo:** invoke `superpowers:using-git-worktrees` to create `../<repo>-<slug>/` with branch `auto-power/<slug>`. Set `worktree_created_by_us: true`. Remove on successful finish.
- **Overrides:** `--no-worktree` forces in-place work on current branch; `--worktree` forces creation even if already inside one.

### Mid-impl auto-approve

`auto-power-runtime` intercepts touchpoints surfaced by `executing-plans` / `subagent-driven-development`:

| Touchpoint | Auto-decision |
|---|---|
| "Continue to next task?" | yes |
| "Code review checkpoint?" | run self-review; treat findings per retry policy |
| "Run tests now?" | yes |
| "Commit this work?" | yes (per-task commit) |
| Force push, branch delete on dirty tree, `git reset --hard`, history rewrite | **never** auto-approve — escalate |
| File deletion outside declared task scope | **never** auto-approve — escalate |

Every auto-approve is logged to `<slug>-auto-decisions.md`.

### CI gate

Before merge, runtime polls CI status (`gh pr checks` or `gh run list --branch <branch>`). Waits up to `limits.ci_wait_minutes` (default 30). Green → ff-merge. Red → retry policy.

### Final merge

```
git checkout main
git pull --ff-only origin main
git merge --ff-only <branch>
git push origin main
git branch -d <branch>
# if we created the worktree, also: git worktree remove <path>
```

Non-ff or conflict → escalate.

## Failure / retry / escalation policy

### Transient (auto-retry, max N = `limits.max_retries`, default 3)

- Test failures with clear stack trace → fix per error message, re-run.
- Lint / format errors → auto-fix, re-run.
- CI flake (timeout, 5xx infra) → re-trigger.
- Simple merge conflicts (whitespace, import order, non-semantic) → auto-resolve, re-run.

Retry counters live in the checkpoint per phase. Counters reset on phase advance.

### Substantive (escalate immediately, no retry)

- `SEC_BLOCKED` (security gate ❌).
- `ARCH_BLOCKED` (architecture gate ❌).
- QA fail still red after `max_retries` fix attempts.
- Semantic merge conflict (overlapping logic edits).
- CI red after `max_retries` retries with the same failure signature.
- `FINISH_BLOCKED`: non-ff, push-rejected, dirty worktree.
- Test suite missing entirely (can't verify the work).
- Plan task references a file that does not exist.

### Escalation procedure

1. Write `docs/superpowers/specs/<slug>-ESCALATION.md` with: phase, failure signal, last N error logs, retry history, suggested fixes, exact resume command.
2. Print one-line summary + escalation file path to stdout.
3. Persist checkpoint with `status: blocked`. Exit non-zero.
4. User reviews escalation, fixes the underlying issue, then runs `/auto-power-resume <slug> --cleared`.

## Checkpoint + resume

### File

`docs/superpowers/specs/<slug>-checkpoint.json` (next to the spec / plan). Plain JSON; user can inspect or edit.

### Schema

```json
{
  "slug": "add-foo-widget",
  "started_at": "2026-05-14T08:30:00Z",
  "updated_at": "2026-05-14T09:12:00Z",
  "status": "running | blocked | done",
  "phase": "spec | plan | arch_sec | worktree | impl | verify | review | finish",
  "branch": "auto-power/add-foo-widget",
  "worktree_path": "/abs/path/to/worktree-or-null",
  "worktree_created_by_us": true,
  "spec_path": "docs/superpowers/specs/2026-05-14-add-foo-widget-design.md",
  "plan_path": "docs/superpowers/specs/2026-05-14-add-foo-widget-plan.md",
  "auto_decisions_path": "docs/superpowers/specs/2026-05-14-add-foo-widget-auto-decisions.md",
  "current_task_id": "task-3",
  "tasks_done": ["task-1", "task-2"],
  "retries": { "impl": 1, "verify": 0, "ci": 0 },
  "last_error": null,
  "finish_mode": "ff-merge",
  "limits": { "max_retries": 3, "ci_wait_minutes": 30, "phase_stall_minutes": 30 }
}
```

### Write triggers

- Every phase transition.
- Every retry counter increment.
- Every task completion.
- Before any escalation write.

### Resume command

`/auto-power-resume <slug-or-checkpoint-path> [--cleared]`

- Loads checkpoint. Verifies branch exists, worktree path valid, no uncommitted churn `auto-power` did not make.
- Re-enters at the recorded `phase` with retry counters preserved.
- `status: done` → no-op + report.
- `status: blocked` → requires `--cleared` flag to confirm the user fixed the underlying issue; otherwise re-prints the escalation summary and exits.

### Hard rules

- Never overwrite the checkpoint without bumping `updated_at`.
- Never resume into a different branch than the one recorded.
- Never advance `phase` without first writing the checkpoint.
- Never remove a worktree that `auto-power` did not create (`worktree_created_by_us: false`).
- Never auto-approve a destructive git operation (see Section 4 list).

## Plugin manifest

`plugins/auto-power/.claude-plugin/plugin.json`:

```json
{
  "name": "auto-power",
  "displayName": "Auto Power",
  "version": "0.1.0",
  "description": "Single-command, hands-off pipeline that wraps obra/superpowers: auto-answers safe clarifying questions during spec, then runs plan → arch+sec → impl → verify → review → ff-merge with no further touchpoints. Checkpointed and resumable; escalates only on substantive failures (security, architecture, repeated QA fail, semantic conflict).",
  "author": { "name": "Steven Hoang" },
  "keywords": [
    "superpowers",
    "automation",
    "pipeline",
    "tdd",
    "auto-merge",
    "checkpoint"
  ]
}
```

## Open questions

None at design time. Implementation plan will surface concrete sub-task questions.

## Out of scope (v1)

- Auto-PR mode (only ff-merge to main shipped).
- Parallel multi-task impl (single-session serial only).
- Configurable per-repo whitelist override (whitelist is built-in for v1).
- Web UI / TUI status board (stdout + checkpoint file only).

## Next step

Hand off to `superpowers:writing-plans` to produce the task-level implementation plan for shipping this plugin.
