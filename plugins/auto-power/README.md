# auto-power

Single-command, hands-off pipeline that wraps [`obra/superpowers`](https://github.com/obra/superpowers). Auto-answers safe clarifying questions during the spec phase, then runs plan → arch+sec → impl → verify → review → ff-merge with no further owner touchpoints. Checkpointed and resumable. Escalates only on substantive failures.

## Install

After installing this marketplace:

```
/plugin install auto-power@drunkcoding
```

## Commands

| Command | Purpose |
|---|---|
| `/auto-power <idea>` | Start a fresh pipeline for `<idea>` |
| `/auto-power-resume <slug>` | Resume an interrupted or blocked pipeline |

## Lifecycle

1. **Brainstorming** — `superpowers:brainstorming` runs. Clarifying questions that match a deterministic whitelist (test framework, lint command, naming convention, etc.) are auto-answered from repo signals. Unsafe or ambiguous questions surface to you.
2. **Spec approval** — once the spec doc is written and self-reviewed, you are asked to approve. **This is the only owner touchpoint by design.**
3. **Plan** — `superpowers:writing-plans` produces the implementation plan.
4. **Arch+Sec self-review** — inline checklist; any ❌ escalates immediately.
5. **Worktree** — if you ran `/auto-power` from inside an existing worktree, that worktree is reused (the pipeline does not remove it on finish). If you ran from the main repo, a new worktree is created at `../<repo>-<slug>/`.
6. **Implementation** — `superpowers:subagent-driven-development` (preferred) or `executing-plans`. Mid-impl touchpoints ("continue?", "commit?", "run tests?") are auto-approved. Destructive git operations are never auto-approved — they escalate.
7. **Verify** — `superpowers:verification-before-completion`.
8. **Review** — `superpowers:requesting-code-review` self-review pass.
9. **Finish** — CI gate (polled up to `--ci-wait`), then `git merge --ff-only` to `main`, push, branch delete. If we created the worktree, it is removed.

## Artifacts

The pipeline writes everything next to your existing superpowers artifacts:

- `docs/superpowers/specs/<date>-<slug>-design.md` — spec
- `docs/superpowers/specs/<date>-<slug>-plan.md` — plan
- `docs/superpowers/specs/<slug>-auto-decisions.md` — append-only log of every auto-answer and auto-approve, with category and signal source
- `docs/superpowers/specs/<slug>-checkpoint.json` — pipeline state
- `docs/superpowers/specs/<slug>-ESCALATION.md` — only written when the pipeline halts on a substantive failure

## Escalation handling

If the runtime halts, it writes an escalation file with: phase, signal, retry history, last error logs, suggested fixes, and the exact resume command. Substantive failures (security ❌, architecture ❌, semantic merge conflict, repeated QA failure, persistent CI red, non-ff merge required, missing test suite, missing plan-referenced file) never auto-retry — you decide.

After fixing the underlying issue:

```
/auto-power-resume <slug> --cleared
```

To abandon the work:

```bash
rm docs/superpowers/specs/<slug>-checkpoint.json
git worktree remove <worktree-path>   # only if the pipeline created it
git branch -D <branch>                # only after confirming no work to keep
```

## Flags reference

| Flag | Default | Notes |
|---|---|---|
| `--branch=<name>` | `auto-power/<slug>` | Override branch name |
| `--no-worktree` | off | In-place work on current branch |
| `--worktree` | off | Force new worktree even if already in one |
| `--max-retries=N` | 3 | Override transient-failure retry budget |
| `--ci-wait=MIN` | 30 | Override CI polling timeout |

## What it does NOT do (v1)

- No multi-agent fan-out (single Claude session, serial). Use `team-superpower` if you want parallel teammates.
- No PR mode — finish is always `git merge --ff-only` to `main`.
- No cross-repo orchestration.
- No web UI or TUI; status lives in stdout and the checkpoint file.

## Relationship to other plugins

- `obra/superpowers` — the skill chain `auto-power` drives. Not forked or duplicated.
- `team-superpower` — sibling plugin for multi-agent parallel runs with explicit owner touchpoints. Pick this when you want oversight per phase, not hands-off automation.
