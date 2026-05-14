# Auto-Power Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `plugins/auto-power/` — a new marketplace plugin that wraps `obra/superpowers` into a single-command, hands-off pipeline (`/auto-power <idea>`) with auto-answered clarifying questions, auto-approved mid-impl touchpoints, checkpoint+resume, retry+escalation policy, and ff-merge finish.

**Architecture:** Single Claude session drives the superpowers skill chain serially. One driver skill (`auto-power-runtime`) encodes the auto-answer whitelist, retry policy, checkpoint schema, auto-approve scope, and escalation procedure. Two slash commands wire the driver into Claude Code: `/auto-power` (start) and `/auto-power-resume` (resume from checkpoint). Plugin ships markdown only — no shell scripts, no hooks, no agents.

**Tech Stack:** Markdown skills + commands, JSON manifest (`plugin.json`), JSON checkpoint files. Validation via existing `plugin-validator` plugin (`/validate-skills`, `/validate-commands`). Smoke test via `/plugin marketplace add file://$(pwd)` + `/plugin install`.

**Spec:** `docs/superpowers/specs/2026-05-14-auto-power-plugin-design.md`

---

## File map

| Path | Responsibility |
|---|---|
| `plugins/auto-power/.claude-plugin/plugin.json` | Plugin manifest (name, version, description, keywords) |
| `plugins/auto-power/README.md` | Plugin-facing docs: commands, flags, lifecycle, escalation behavior |
| `plugins/auto-power/skills/auto-power-runtime/SKILL.md` | Driver: auto-answer whitelist, retry policy, checkpoint, auto-approve, escalation procedure |
| `plugins/auto-power/commands/auto-power.md` | `/auto-power <idea>` entry point — invokes runtime skill |
| `plugins/auto-power/commands/auto-power-resume.md` | `/auto-power-resume <slug>` entry point — reads checkpoint and re-enters phase |
| `plugins/auto-power/assets/CHECKPOINT_SCHEMA.md` | Checkpoint JSON schema reference (linked from skill + commands) |
| `plugins/auto-power/assets/ESCALATION_TEMPLATE.md` | Escalation file template the runtime writes on substantive failure |
| `.claude-plugin/marketplace.json` | Add `auto-power` row to `plugins[]` |
| `README.md` | Add `auto-power` row to Plugins table |

Top-level `package.json` already covers new plugin via `plugins/**` whitelist — no change.

---

## Task 1: Plugin scaffolding + marketplace wiring

**Files:**
- Create: `plugins/auto-power/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json` (append entry to `plugins[]`)
- Modify: `README.md` (append row to Plugins table)

Per `hermippe/CLAUDE.md`: adding a plugin requires all three updates in one commit.

- [ ] **Step 1: Create the plugin manifest**

Write `plugins/auto-power/.claude-plugin/plugin.json`:

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

- [ ] **Step 2: Append auto-power entry to `.claude-plugin/marketplace.json`**

Insert a new object inside the `plugins[]` array (after the last existing entry — currently `plugin-validator`). Preserve existing entries verbatim. New entry:

```json
{
  "name": "auto-power",
  "source": "./plugins/auto-power",
  "description": "Single-command hands-off pipeline wrapping obra/superpowers. Auto-answers safe clarifying questions during spec, then runs plan → arch+sec → impl → verify → review → ff-merge with no further touchpoints. Checkpointed and resumable; escalates only on substantive failures.",
  "version": "0.1.0",
  "category": "workflow",
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

- [ ] **Step 3: Append the row to root `README.md` Plugins table**

In `README.md`, locate the Plugins table (starts at line 9 in the current file). Append a new row after the `plugin-validator` row:

```markdown
| [`auto-power`](plugins/auto-power) | Single-command hands-off pipeline that wraps `obra/superpowers`. Auto-answers safe clarifying questions during spec, then runs plan → arch+sec → impl → verify → review → ff-merge with no further touchpoints. Checkpointed and resumable. Escalates on substantive failures. |
```

- [ ] **Step 4: Verify all three JSON manifests parse**

Run:
```bash
python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
```
Expected: `OK`.

- [ ] **Step 5: Verify README table contains the row**

Run:
```bash
grep -c '\[`auto-power`\](plugins/auto-power)' README.md
```
Expected: `1`.

- [ ] **Step 6: Commit**

```bash
git add plugins/auto-power/.claude-plugin/plugin.json .claude-plugin/marketplace.json README.md
git commit -m "Add auto-power plugin scaffolding and marketplace entry"
```

---

## Task 2: Asset — CHECKPOINT_SCHEMA.md

**Files:**
- Create: `plugins/auto-power/assets/CHECKPOINT_SCHEMA.md`

This file is referenced from the skill and both commands. Document the JSON schema verbatim from the design doc.

- [ ] **Step 1: Write the checkpoint schema asset**

Write `plugins/auto-power/assets/CHECKPOINT_SCHEMA.md`:

````markdown
# Auto-Power Checkpoint Schema

Location: `docs/superpowers/specs/<slug>-checkpoint.json` (next to the spec/plan files for the same `<slug>`).

Format: plain JSON. Users may inspect or edit by hand.

## Schema

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

## Field reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `slug` | string | yes | Kebab-case identifier; appears in every artifact filename |
| `started_at` | ISO-8601 UTC | yes | Set once at pipeline start; never overwritten |
| `updated_at` | ISO-8601 UTC | yes | Bumped on every write |
| `status` | enum | yes | `running` during pipeline, `blocked` after escalation, `done` after successful merge |
| `phase` | enum | yes | One of: `spec`, `plan`, `arch_sec`, `worktree`, `impl`, `verify`, `review`, `finish` |
| `branch` | string | yes | Git branch holding the work |
| `worktree_path` | string \| null | yes | Absolute worktree path; `null` when running in main repo |
| `worktree_created_by_us` | bool | yes | `true` only when the pipeline itself created the worktree. Drives cleanup behavior on finish |
| `spec_path` | string | yes | Relative path to the approved design doc |
| `plan_path` | string \| null | yes | Set after plan phase completes |
| `auto_decisions_path` | string | yes | Append-only log of auto-answers and auto-approves |
| `current_task_id` | string \| null | yes | Plan task currently in flight; null outside `impl` phase |
| `tasks_done` | string[] | yes | Completed plan task IDs |
| `retries` | object | yes | Keys: any of `plan`, `arch_sec`, `impl`, `verify`, `review`, `finish`, `ci`. Counters reset on phase advance |
| `last_error` | object \| null | yes | `{ phase, signal, message, at }` populated on retry or escalation |
| `finish_mode` | enum | yes | Always `ff-merge` in v1 |
| `limits` | object | yes | `max_retries` (default 3), `ci_wait_minutes` (default 30), `phase_stall_minutes` (default 30) |

## Write triggers

The runtime writes the checkpoint:

1. At pipeline start (initial creation).
2. Before every phase transition.
3. After every retry counter increment.
4. After every task completion (`tasks_done` append + `current_task_id` advance).
5. Before any escalation file write.
6. On successful merge (`status: done`).

## Hard rules

- Never overwrite the checkpoint without bumping `updated_at`.
- Never resume into a branch different from the one recorded.
- Never advance `phase` without first writing the checkpoint.
- Never remove a worktree where `worktree_created_by_us: false`.
````

- [ ] **Step 2: Verify the schema field count**

Run:
```bash
grep -c '^| `' plugins/auto-power/assets/CHECKPOINT_SCHEMA.md
```
Expected: `15` (header row excluded; 15 schema fields documented).

- [ ] **Step 3: Commit**

```bash
git add plugins/auto-power/assets/CHECKPOINT_SCHEMA.md
git commit -m "auto-power: add CHECKPOINT_SCHEMA.md asset"
```

---

## Task 3: Asset — ESCALATION_TEMPLATE.md

**Files:**
- Create: `plugins/auto-power/assets/ESCALATION_TEMPLATE.md`

Template the runtime fills in when it writes `docs/superpowers/specs/<slug>-ESCALATION.md` on substantive failure.

- [ ] **Step 1: Write the escalation template**

Write `plugins/auto-power/assets/ESCALATION_TEMPLATE.md`:

````markdown
# Auto-Power Escalation Template

The runtime writes one of these files to `docs/superpowers/specs/<slug>-ESCALATION.md` whenever a substantive failure halts the pipeline. Use the structure below verbatim — replace bracketed placeholders.

```markdown
# Escalation: <slug>

**Halted at:** <ISO-8601 UTC>
**Phase:** <plan | arch_sec | worktree | impl | verify | review | finish>
**Signal:** <SEC_BLOCKED | ARCH_BLOCKED | QA_FAIL_EXHAUSTED | SEMANTIC_CONFLICT | CI_RED_PERSISTENT | FINISH_BLOCKED | TEST_SUITE_MISSING | PLAN_FILE_MISSING | OTHER:<short>>
**Branch:** <branch>
**Worktree:** <path or "in-repo">
**Checkpoint:** docs/superpowers/specs/<slug>-checkpoint.json

## What failed

<One paragraph: the immediate symptom and the gate that caught it.>

## Retry history

| # | Attempt | Outcome |
|---|---|---|
| 1 | <action taken> | <result> |
| 2 | <action taken> | <result> |
| 3 | <action taken> | <result> |

## Last error logs

```
<verbatim last error block; truncate at 2 KB if longer>
```

## Suggested fixes

- <fix 1: concrete, file-level>
- <fix 2>
- <fix 3>

## Resume command

After applying a fix:

```bash
/auto-power-resume <slug> --cleared
```

If you decide to abandon the work:

```bash
# Delete the checkpoint and (if we created it) the worktree:
rm docs/superpowers/specs/<slug>-checkpoint.json
git worktree remove <worktree-path>   # only if worktree_created_by_us=true
git branch -D <branch>                # only after confirming no work to keep
```
```

## Signal reference

| Signal | Origin | Auto-retry? |
|---|---|---|
| `SEC_BLOCKED` | security self-review ❌ | No — escalate immediately |
| `ARCH_BLOCKED` | architecture self-review ❌ | No — escalate immediately |
| `QA_FAIL_EXHAUSTED` | `verification-before-completion` red after `max_retries` | No — escalate after retries used |
| `SEMANTIC_CONFLICT` | merge conflict touching overlapping logic | No |
| `CI_RED_PERSISTENT` | same CI failure signature after `max_retries` | No |
| `FINISH_BLOCKED` | non-ff, push rejected, dirty worktree | No |
| `TEST_SUITE_MISSING` | no test runner detected, can't verify | No |
| `PLAN_FILE_MISSING` | plan task references a non-existent file | No |
````

- [ ] **Step 2: Verify the signal table is present**

Run:
```bash
grep -c '^| `SEC_BLOCKED`' plugins/auto-power/assets/ESCALATION_TEMPLATE.md
```
Expected: `1`.

- [ ] **Step 3: Commit**

```bash
git add plugins/auto-power/assets/ESCALATION_TEMPLATE.md
git commit -m "auto-power: add ESCALATION_TEMPLATE.md asset"
```

---

## Task 4: Skill — auto-power-runtime/SKILL.md

**Files:**
- Create: `plugins/auto-power/skills/auto-power-runtime/SKILL.md`

This is the driver. It encodes every behavioral rule the runtime follows. Keep prose tight — exact instructions, no hedging.

- [ ] **Step 1: Write the skill file**

Write `plugins/auto-power/skills/auto-power-runtime/SKILL.md`:

````markdown
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
````

- [ ] **Step 2: Verify YAML frontmatter parses**

Run:
```bash
python3 -c "import re,sys; t=open('plugins/auto-power/skills/auto-power-runtime/SKILL.md').read(); m=re.match(r'^---\n(.*?)\n---\n', t, re.S); assert m, 'no frontmatter'; assert 'name: auto-power-runtime' in m.group(1); assert 'description:' in m.group(1); print('OK')"
```
Expected: `OK`.

- [ ] **Step 3: Verify all 8 phase headings present**

Run:
```bash
for sec in "§1" "§2" "§3" "§4" "§5" "§6" "§7" "§8"; do
  grep -c "^## $sec" plugins/auto-power/skills/auto-power-runtime/SKILL.md
done
```
Expected: eight lines, each `1`.

- [ ] **Step 4: Validate with plugin-validator skill**

In Claude Code, invoke `/validate-skills` targeting the new skill file. Expected: PASS (no FAILs). WARNs are acceptable if the validator surfaces style-only notes.

- [ ] **Step 5: Commit**

```bash
git add plugins/auto-power/skills/auto-power-runtime/SKILL.md
git commit -m "auto-power: add auto-power-runtime driver skill"
```

---

## Task 5: Command — auto-power.md

**Files:**
- Create: `plugins/auto-power/commands/auto-power.md`

Slash command users invoke as `/auto-power <idea>`. The command body invokes the runtime skill with the parsed arguments.

- [ ] **Step 1: Write the command file**

Write `plugins/auto-power/commands/auto-power.md`:

````markdown
---
description: Run the obra/superpowers chain end-to-end as a single hands-off pipeline. Auto-answers safe clarifying questions during spec, then runs plan → arch+sec → impl → verify → review → ff-merge with no further touchpoints. The only owner touchpoint is spec approval. Checkpointed and resumable.
---

# /auto-power

**Usage:** `/auto-power <idea> [--branch=<name>] [--no-worktree | --worktree] [--max-retries=N] [--ci-wait=MIN]`

**Arguments:**

| Flag | Default | Effect |
|---|---|---|
| `<idea>` (required, positional) | — | One-line description of the feature to build. Same input you would give to `superpowers:brainstorming`. |
| `--branch=<name>` | `auto-power/<slug>` | Override the branch name |
| `--no-worktree` | off | Force in-place work on the current branch (skip worktree creation even if running from the main repo) |
| `--worktree` | off | Force creation of a new worktree even if already inside one |
| `--max-retries=N` | 3 | Override `limits.max_retries` |
| `--ci-wait=MIN` | 30 | Override `limits.ci_wait_minutes` |

## Procedure

1. Parse the arguments above. Slugify `<idea>` (kebab-case, ≤ 40 chars) to derive `<slug>`.
2. Invoke the `auto-power-runtime` skill. Pass: `slug`, `idea`, parsed flags, the absolute path to `plugins/auto-power/assets/CHECKPOINT_SCHEMA.md`, and the path to `plugins/auto-power/assets/ESCALATION_TEMPLATE.md`.
3. Follow the runtime skill exactly. Do not improvise touchpoint decisions — every prompt is either covered by the skill's rules or surfaces an escalation.

## Owner touchpoints

Exactly one by design: spec approval at the end of phase 1. Every other interactive prompt is auto-resolved per the runtime skill's whitelist (`§1`) or auto-approve table (`§5`), or escalates via `§6`.

## Artifacts produced

- `docs/superpowers/specs/<date>-<slug>-design.md`
- `docs/superpowers/specs/<date>-<slug>-plan.md`
- `docs/superpowers/specs/<slug>-auto-decisions.md`
- `docs/superpowers/specs/<slug>-checkpoint.json`
- On failure: `docs/superpowers/specs/<slug>-ESCALATION.md`

## On escalation

If the runtime writes an escalation file, fix the underlying issue and resume:

```
/auto-power-resume <slug> --cleared
```

See `plugins/auto-power/README.md` for the full lifecycle and escalation handling.
````

- [ ] **Step 2: Verify frontmatter has a description**

Run:
```bash
head -3 plugins/auto-power/commands/auto-power.md | grep -c '^description:'
```
Expected: `1`.

- [ ] **Step 3: Validate with plugin-validator**

In Claude Code: invoke `/validate-commands` against the new command. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add plugins/auto-power/commands/auto-power.md
git commit -m "auto-power: add /auto-power command"
```

---

## Task 6: Command — auto-power-resume.md

**Files:**
- Create: `plugins/auto-power/commands/auto-power-resume.md`

Resume entry point. Mirrors the runtime skill's `§8` resume semantics.

- [ ] **Step 1: Write the command file**

Write `plugins/auto-power/commands/auto-power-resume.md`:

````markdown
---
description: Resume an auto-power pipeline from its checkpoint. Re-enters the recorded phase with retry counters preserved. Use --cleared after fixing the issue described in an ESCALATION.md file.
---

# /auto-power-resume

**Usage:** `/auto-power-resume <slug-or-checkpoint-path> [--cleared]`

**Arguments:**

| Flag | Default | Effect |
|---|---|---|
| `<slug-or-checkpoint-path>` (required, positional) | — | Either the slug (resolves to `docs/superpowers/specs/<slug>-checkpoint.json`) or an explicit path |
| `--cleared` | off | Required when the checkpoint `status` is `blocked`. Asserts you have fixed the issue described in the ESCALATION file. Clears `last_error` and resumes from the recorded phase |

## Procedure

1. Resolve the checkpoint path from the positional argument.
2. Invoke the `auto-power-runtime` skill with intent `resume`. The skill executes §8 of its own rules:
   - Verify branch and (if recorded) worktree path exist.
   - Reject if HEAD has uncommitted churn the pipeline did not write.
   - `status: done` ⇒ no-op, print summary, exit.
   - `status: blocked` without `--cleared` ⇒ re-print escalation summary, exit.
   - `status: blocked` with `--cleared` ⇒ clear `last_error`, set `status: running`, re-enter the recorded `phase`.
   - `status: running` ⇒ re-enter the recorded `phase`.
3. Continue the pipeline from that phase until the next escalation or successful finish.

## Hard guarantees

- The resume never changes the recorded `branch`.
- Retry counters survive resume — if `retries.impl` is `2` on a 3-retry budget, only one retry remains.
- The auto-decisions log is appended to, never rewritten.
````

- [ ] **Step 2: Verify the file references §8**

Run:
```bash
grep -c '§8' plugins/auto-power/commands/auto-power-resume.md
```
Expected: at least `1`.

- [ ] **Step 3: Validate with plugin-validator**

In Claude Code: invoke `/validate-commands`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add plugins/auto-power/commands/auto-power-resume.md
git commit -m "auto-power: add /auto-power-resume command"
```

---

## Task 7: Plugin README.md

**Files:**
- Create: `plugins/auto-power/README.md`

User-facing entry point. Covers what the plugin does, both commands, the lifecycle, and how to handle escalations.

- [ ] **Step 1: Write the plugin README**

Write `plugins/auto-power/README.md`:

````markdown
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
````

- [ ] **Step 2: Verify the lifecycle has all nine numbered steps**

Run:
```bash
grep -cE '^[0-9]+\. \*\*' plugins/auto-power/README.md
```
Expected: `9`.

- [ ] **Step 3: Commit**

```bash
git add plugins/auto-power/README.md
git commit -m "auto-power: add plugin README"
```

---

## Task 8: Full plugin validation + smoke install

**Files:**
- (no new files)

Run the full validator suite plus the in-Claude-Code smoke test from `hermippe/CLAUDE.md`.

- [ ] **Step 1: Validate every JSON manifest**

Run:
```bash
python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
```
Expected: `OK`.

- [ ] **Step 2: Run plugin-validator against the new plugin**

In Claude Code:

```
/validate-plugins
```

Expected: the `auto-power` row reports `PASS` across skills, commands, hooks (n/a — no hooks shipped), and agents (n/a — no agents shipped). Any `FAIL` must be fixed before committing.

- [ ] **Step 3: Smoke-install locally**

```
/plugin marketplace add file://$(pwd)
/plugin install auto-power@drunkcoding
/reload-plugins
```

Then verify the slash commands appear:

```
/help auto-power
/help auto-power-resume
```

Expected: both commands listed.

- [ ] **Step 4: Verify the runtime skill resolves**

In Claude Code, invoke the runtime skill directly with a dry-run argument:

```
Use the Skill tool with skill="auto-power:auto-power-runtime" and args="dry-run: print the §1 whitelist categories".
```

Expected: the skill responds with the eight whitelist categories (Test framework, Build/lint/format, File naming, Code style, Target directory, Language/runtime version, Plugin location, Visual companion).

- [ ] **Step 5: Final tree check**

Run:
```bash
find plugins/auto-power -type f | sort
```
Expected (8 files):
```
plugins/auto-power/.claude-plugin/plugin.json
plugins/auto-power/README.md
plugins/auto-power/assets/CHECKPOINT_SCHEMA.md
plugins/auto-power/assets/ESCALATION_TEMPLATE.md
plugins/auto-power/commands/auto-power-resume.md
plugins/auto-power/commands/auto-power.md
plugins/auto-power/skills/auto-power-runtime/SKILL.md
```

(`find` returns 7 paths; the 8th "file" is the directory entry — adjust expected count if your shell sorts differently.)

- [ ] **Step 6: Commit the validation evidence (only if needed)**

If validator output prompts any small fix in earlier files, apply the fix, re-run validation, and commit as:

```bash
git commit -m "auto-power: fix <one-line> per validator"
```

Otherwise no commit is needed for this task — validation is verification only.

---

## Self-review notes

- Every spec requirement (auto-answer whitelist, retry/escalation, checkpoint schema, mid-impl auto-approve, worktree detect-or-create with no-touch-on-pre-existing, ff-merge finish, resume semantics) has a task that ships it. The whitelist and auto-approve scope live in Task 4 (skill); the checkpoint and escalation contracts live in Tasks 2 and 3 (assets); the commands in Tasks 5 and 6 thinly wire the user-facing entry points to the skill; the README in Task 7 explains lifecycle and escalation handling.
- No placeholders. Every task has the exact file content. Every verify step has the exact command and expected output.
- Type consistency: `worktree_created_by_us`, `auto_decisions_path`, `retries.<phase>`, `limits.max_retries`, signals (`SEC_BLOCKED` / `ARCH_BLOCKED` / `QA_FAIL_EXHAUSTED` / `SEMANTIC_CONFLICT` / `CI_RED_PERSISTENT` / `FINISH_BLOCKED` / `TEST_SUITE_MISSING` / `PLAN_FILE_MISSING`), and phase names (`spec` / `plan` / `arch_sec` / `worktree` / `impl` / `verify` / `review` / `finish`) are spelled identically across the schema asset, the runtime skill, the escalation template, and both commands.
- Scope: stays inside `plugins/auto-power/`, plus the two repo-level updates (`marketplace.json`, `README.md`) required by the CLAUDE.md "adding a plugin" rule.
