---
name: auto-power-runtime
description: Use when running /auto-power or /auto-power-resume. Drives the obra/superpowers skill chain as a single-session, hands-off pipeline with auto-answered clarifying questions, auto-approved mid-impl touchpoints, checkpoint-based resume, retry+escalation policy, and ff-merge finish.
---

# auto-power-runtime

You are the driver for the `/auto-power` and `/auto-power-resume` commands. You invoke `obra/superpowers` skills in order and apply the policies in this file at each touchpoint. You never improvise — every decision is either a deterministic rule below or an explicit escalation to the user.

**Reference assets** (read once at start):
- `assets/CHECKPOINT_SCHEMA.md` — checkpoint format and write triggers
- `assets/ESCALATION_TEMPLATE.md` — escalation file structure and signal reference

## Pipeline

Phases run serially. Write the checkpoint before advancing.

1. `spec` — invoke `superpowers:brainstorming` with the auto-answer interceptor (see §1).
2. `plan` — invoke `superpowers:writing-plans`.
3. `arch_sec` — run the inline architecture + security self-review checklist (see §3).
4. `worktree` — detect or create per §4.
5. `impl` — invoke `superpowers:subagent-driven-development` (preferred) or `superpowers:executing-plans`; intercept touchpoints per §5.
6. `verify` — invoke `superpowers:verification-before-completion`.
7. `review` — invoke `superpowers:requesting-code-review` (self-review pass).
8. `finish` — invoke `superpowers:finishing-a-development-branch`; ff-merge per §7.

The **only** interactive owner touchpoint is the spec approval gate at the end of phase 1. Every other Claude-Code-side prompt is auto-resolved or escalated.

## §1. Clarifying-question auto-answer

While phase 1 runs, intercept every clarifying question the brainstorming skill asks. Classify it against the whitelist below. Auto-answer only if the question matches a category **and** the repo signal is present **and** unambiguous. Otherwise forward verbatim to the user.

### Whitelist

| Category | Signal source |
|---|---|
| Test framework | `package.json` devDependencies (`jest`, `vitest`, `mocha`, `node:test`); `pyproject.toml`; existing test files under `tests/`, `__tests__/`, `*_test.py` |
| Build / lint / format command | `CLAUDE.md` `team-superpower` block; `package.json` `scripts`; `Makefile`; `pyproject.toml` `[tool.*]` |
| File naming convention | Nearest sibling files in target dir (kebab vs snake vs camel by majority vote) |
| Code style | `.prettierrc*`, `ruff.toml`, `pyproject.toml [tool.ruff]`, `.editorconfig`, `eslint.config.*` |
| Target directory | Module structure of the nearest comparable feature |
| Language / runtime version | `package.json` `engines`, `.tool-versions`, `.nvmrc`, `pyproject.toml` `requires-python` |
| Plugin location convention | `plugins/<name>/` (per repo CLAUDE.md) |
| Visual companion offer | Always decline (run is non-interactive after spec approval) |

### Always raise

- Purpose / success criteria when the idea is ambiguous.
- Trade-off choices with no clear repo signal.
- Multi-subsystem scope decomposition prompts.
- The "propose 2-3 approaches" prompt — user picks.
- Anything not on the whitelist.

### Audit log

For every auto-answered question, append a row to `docs/superpowers/specs/<slug>-auto-decisions.md`:

```markdown
| <UTC time> | spec | <question verbatim> | <category> | <signal source> | <answer> |
```

Create the file with this header on first write:

```markdown
# Auto-power auto-decisions — <slug>

| When (UTC) | Phase | Question | Category | Signal | Answer |
|---|---|---|---|---|---|
```

### Spec approval gate

After brainstorming finishes and the spec doc is written + self-reviewed, surface the standard message:

> "Spec written and committed to `<path>`. Please review it and let me know if you want to make any changes before I continue with the rest of the pipeline."

Wait for the user's reply. Revise on request, otherwise advance to phase 2. **This is the only owner touchpoint by design.**

## §2. Checkpoint

Create the checkpoint at pipeline start. See `assets/CHECKPOINT_SCHEMA.md` for the schema and write triggers. Hard rules:

- Always bump `updated_at` on every write.
- Never advance `phase` without writing first.
- On every retry, increment `retries.<phase>` and write.
- On phase advance, reset that phase's retry counter to 0.
- On successful merge, set `status: done` and write a final time.

## §3. Arch + sec self-review (phase 3)

Run this inline against the plan from phase 2. Treat each as ✅ / ⚠️ / ❌. Any ❌ ⇒ escalate with signal `ARCH_BLOCKED` or `SEC_BLOCKED`.

### Architecture checklist

- Single-responsibility per file? Any file expected > ~300 lines?
- Module boundaries match plan task scope?
- New code touches files only inside scopes declared by plan tasks?
- Dependencies on external services declared?
- Failure modes documented (timeouts, partial writes, retries)?
- Backward compatibility considered if modifying public interfaces?

### Security checklist (project-aware — skip items that don't apply)

- Input validation on user-supplied data?
- No secrets / tokens committed?
- SQL strings parameterized (if any SQL)?
- HTML output escaped (if rendering HTML)?
- AuthN/AuthZ enforced on new endpoints (if any endpoints)?
- File I/O paths sanitized (no `../` traversal)?
- Shell exec uses argv form, not string concat (if any shell-out)?

Append the result table to the plan file under a `## Auto-power arch+sec review` heading.

## §4. Worktree detection (phase 4)

```
top=$(git rev-parse --show-toplevel)
main_top=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
```

- `$top == $main_top` ⇒ running in main repo. Invoke `superpowers:using-git-worktrees` to create `../<repo>-<slug>/` on branch `auto-power/<slug>`. Set `worktree_path` and `worktree_created_by_us: true`.
- `$top != $main_top` ⇒ already in a worktree. Skip creation. Use the current branch. Set `worktree_path = $top` and `worktree_created_by_us: false`.
- Flag overrides: `--no-worktree` forces in-place work on the current branch; `--worktree` forces creation even if already inside one.

## §5. Mid-impl auto-approve (phase 5)

When `superpowers:subagent-driven-development` or `superpowers:executing-plans` surfaces a touchpoint, decide per the table below. Log every auto-decision to the auto-decisions file:

```markdown
| <UTC time> | impl | <touchpoint> | auto-approve | <reason> |
```

| Touchpoint | Auto-decision |
|---|---|
| "Continue to next task?" | yes |
| "Code review checkpoint?" | run self-review pass; treat findings per §6 |
| "Run tests now?" | yes |
| "Commit this work?" | yes (per-task commit) |
| Force push | escalate (`FINISH_BLOCKED` / refuse) |
| Branch delete on dirty tree | escalate |
| `git reset --hard` | escalate |
| Any history rewrite (`rebase -i`, `commit --amend` to pushed history) | escalate |
| File deletion outside declared task scope | escalate |

## §6. Retry + escalation policy

### Transient (auto-retry, up to `limits.max_retries`, default 3)

- Test failures with a clear stack trace ⇒ apply fix indicated by the error, re-run.
- Lint / format errors ⇒ auto-fix, re-run.
- CI flake (timeout, 5xx) ⇒ re-trigger.
- Simple merge conflicts (whitespace, import order, non-semantic) ⇒ auto-resolve, re-run.

Increment `retries.<phase>` on every retry. Write the checkpoint.

### Substantive (escalate, no retry)

| Trigger | Signal |
|---|---|
| Security self-review ❌ | `SEC_BLOCKED` |
| Architecture self-review ❌ | `ARCH_BLOCKED` |
| QA fail still red after `max_retries` | `QA_FAIL_EXHAUSTED` |
| Semantic merge conflict | `SEMANTIC_CONFLICT` |
| CI red after `max_retries` same signature | `CI_RED_PERSISTENT` |
| Non-ff merge required | `FINISH_BLOCKED` |
| Push rejected | `FINISH_BLOCKED` |
| Dirty worktree at finish | `FINISH_BLOCKED` |
| Test suite missing | `TEST_SUITE_MISSING` |
| Plan task references missing file | `PLAN_FILE_MISSING` |

### Escalation procedure

1. Set `status: blocked`, `last_error`, and write checkpoint.
2. Render `assets/ESCALATION_TEMPLATE.md` into `docs/superpowers/specs/<slug>-ESCALATION.md` with the fields filled in.
3. Print one line to stdout: `BLOCKED <signal>: see docs/superpowers/specs/<slug>-ESCALATION.md`.
4. Exit. The pipeline does not continue without `/auto-power-resume <slug> --cleared`.

## §7. Finish (phase 8)

Pre-merge: poll CI for the branch up to `limits.ci_wait_minutes` (default 30) using `gh pr checks <branch>` or `gh run list --branch <branch> --limit 1 --json status,conclusion`. Green ⇒ merge. Red ⇒ retry policy.

Merge sequence:

```bash
git checkout main
git pull --ff-only origin main
git merge --ff-only <branch>
git push origin main
git branch -d <branch>
```

If `worktree_created_by_us == true`:

```bash
git worktree remove <worktree-path>
```

Never remove a worktree where `worktree_created_by_us == false`.

Any failure in the above ⇒ `FINISH_BLOCKED`.

On success: set `status: done`, write checkpoint a final time, print:

```
DONE <slug>: merged to main, branch <branch> deleted[, worktree <path> removed]
```

## §8. Resume semantics

When invoked via `/auto-power-resume`:

1. Load `docs/superpowers/specs/<slug>-checkpoint.json` (or the explicit path argument).
2. Verify the recorded `branch` exists and (if `worktree_path` set) the path exists.
3. Reject if HEAD has uncommitted churn outside files the pipeline itself wrote.
4. `status: done` ⇒ no-op, print summary, exit.
5. `status: blocked` and `--cleared` flag absent ⇒ re-print the escalation summary, exit.
6. `status: blocked` and `--cleared` flag present ⇒ clear `last_error`, set `status: running`, re-enter the recorded `phase` with retry counters preserved.
7. `status: running` (e.g. session was killed) ⇒ re-enter the recorded `phase` with retry counters preserved.

Never resume into a different branch than the one recorded in the checkpoint.
