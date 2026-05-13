# team-superpower

Coordination layer that runs the [obra/superpowers](https://github.com/obra/superpowers) skill chain across a Claude Code **agent team**. One `/team-feature` command takes an idea through design → plan → architecture + security gate → BE/FE implementation → QA gate → code review → finish, with at most **3 owner touchpoints**.

This plugin is *not* a fork of Superpowers. It consumes Superpowers skills as-installed and adds the orchestration: who runs which skill, when, and how teammates talk without bothering the owner.

## What you get

- Three slash commands: `/team-feature`, `/team-feature-resume`, `/team-cleanup`.
- **Eight agent roles**, each with a tightly-scoped system prompt mapping it to specific Superpowers skills or gate behaviour:
  - `designer` — runs `brainstorming` (phase 1).
  - `planner` — runs `using-git-worktrees` then `writing-plans` (phase 2). Routes implementation by `impl:be-` / `impl:fe-` prefix.
  - `software-architect` — phase-3 pre-impl architecture gate. Reviews design + plan. Posts `ARCH_PASSED` / `ARCH_BLOCKED`.
  - `security-engineer` — phase-3 pre-impl security gate, parallel with `software-architect`. Threat-models design + plan. Posts `SEC_PASSED` / `SEC_BLOCKED`.
  - `backend-developer` — phase-4 implementer for `impl:be-` tasks (server, data, infra, CI). Runs `subagent-driven-development` + `test-driven-development` per task.
  - `frontend-developer` — phase-4 implementer for `impl:fe-` tasks. Same skill chain.
  - `qa-engineer` — phase-5 post-impl QA gate. Verifies acceptance criteria + regression coverage. Posts `QA_PASSED` / `QA_BLOCKED`.
  - `reviewer` — phase-6 runs `requesting-code-review`; phase-7 runs `finishing-a-development-branch`.
- Three guardrail hooks (registered automatically via `hooks/hooks.json`):
  - `TeammateIdle` — refuses idle while peer mail is unanswered.
  - `TaskCreated` — enforces `impl:` / `review:` / `meta:` / `block:` task title prefixes.
  - `TaskCompleted` — gates `impl:` completions on `plan_approved_at` and validates escalation entries.
- `scripts/team-state.sh` — inspection + cleanup helper. Called by the slash commands; also runnable directly.
- Robustness primitives baked into the workflow:
  - **Preflight scan** in `/team-feature` and `/team-feature-resume` — detects orphaned team config, stale task lists, and in-flight runs before doing anything destructive.
  - **Two gate phases** (pre-impl arch+security, post-impl QA) — block forward progress until findings resolve, so the reviewer at phase 6 sees clean code-quality issues only, not architectural or security regressions.
  - **Heartbeat file** at `docs/superpowers/sessions/<slug>.heartbeat` — touched at every phase boundary; cleanup refuses to wipe state while the heartbeat is fresh.
  - **Atomic checkpoint writes** (tmp + rename) — half-written checkpoints can't corrupt recovery.
  - **Automatic cleanup after `FINISH_DONE`** — the lead verifies all phases complete, all commits in place, teammates idle, then runs the canonical "clean up the team" primitive followed by a verification scan. No manual `rm -rf` required.
  - **`/team-cleanup [slug]`** for the case where a previous lead crashed and the canonical cleanup path is no longer available.
- Templates seeded into your project on first use: `docs/superpowers/ESCALATION.md` (escalation template + 2 worked examples) and `docs/superpowers/README.md` (onboarding + troubleshooting).

## Phase chain at a glance

| Phase | Role(s) | Output | Gate? |
|---|---|---|---|
| 1 Design | `designer` | Design doc → `docs/superpowers/specs/` | Owner approval |
| 2 Plan | `planner` | Worktree + plan with `impl:be-` / `impl:fe-` tasks → `docs/superpowers/plans/` | Owner approval |
| 3 Pre-impl review (parallel) | `software-architect` + `security-engineer` | ARCH + SEC reports → `docs/superpowers/reviews/` | Both must post PASSED |
| 4 Implementation (parallel) | `backend-developer` + `frontend-developer` | TDD commits on feature branch | All `impl:` tasks complete |
| 5 QA | `qa-engineer` | QA report → `docs/superpowers/reviews/` | `QA_PASSED` |
| 6 Code review | `reviewer` | Review report → `docs/superpowers/reviews/` | `REVIEW_PASSED` |
| 7 Finish | `reviewer` | Merge / PR / keep / discard | Owner decision |

## Requirements

- Claude Code `2.1.32` or later.
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in your environment (the slash command halts if absent).
- The Superpowers plugin installed: `/plugin install superpowers@claude-plugins-official`.
- `jq` on `$PATH` (the hooks degrade to log-only when missing, but you want them enforcing).

## Install

```text
/plugin marketplace add baoduy/agents-and-skills
/plugin install team-superpower@drunkcoding
```

Then make sure the agent-teams env flag is set in `~/.claude/settings.json`:

```json
{
  "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" },
  "teammateMode": "in-process"
}
```

## Use

```text
/team-feature add a /healthcheck endpoint that returns 200 OK
```

You will be interrupted at most three times:

1. Design sign-off (after phase 1).
2. Plan approval (after phase 2).
3. Finish-branch decision — merge / PR / keep / discard (in phase 7).

Anything else that reaches you uses the escalation template in `docs/superpowers/ESCALATION.md`. If a teammate pings you without using the template, that's a bug — file it.

## Task prefix routing

The planner assigns every `impl:` task one of two sub-prefixes; the lead routes by prefix:

| Prefix | Routed to | Scope |
|---|---|---|
| `impl:be-` | `backend-developer` | Server-side code, APIs, data, schemas, migrations, infra / CI scripts, Docker, IaC |
| `impl:fe-` | `frontend-developer` | UI components, pages, client-side state, styles, browser assets |

Defect-fix tasks filed mid-flight inherit the routing prefix:

| Prefix | Filed by | Routed to |
|---|---|---|
| `impl:qa-fix-be-` / `impl:qa-fix-fe-` | `qa-engineer` (phase 5) | matching BE / FE implementer |
| `impl:review-fix-be-` / `impl:review-fix-fe-` | `reviewer` (phase 6) | matching BE / FE implementer |

## Resume after `/resume` drops the team

```text
/team-feature-resume YYYY-MM-DD-<slug>.md
```

The lead reads the committed checkpoint in `docs/superpowers/sessions/`, scans `~/.claude/teams/superpower-<slug>/` for orphaned platform state, runs cleanup if the heartbeat indicates the previous lead is dead, then respawns the right teammates and continues from the next unchecked phase. Completed phases are not redone.

## Clean up after a crashed lead

```text
/team-cleanup <slug>
/team-cleanup --all
```

Use this when a previous lead died (terminal closed, `/resume` lost the team, OS killed the process) and left `~/.claude/teams/superpower-<slug>/` behind. Project-side artefacts under `docs/superpowers/{specs,plans,reviews}` are preserved; only platform-side state is removed.

The slash command dry-runs first, prints what would be removed, and asks for confirmation. The heartbeat file at `docs/superpowers/sessions/<slug>.heartbeat` is checked — if it was touched in the last 10 minutes, cleanup refuses unless the owner explicitly confirms with `--ignore-heartbeat` that the previous lead is dead.

The helper script is also runnable directly:

```bash
bash plugins/team-superpower/scripts/team-state.sh scan          # list all teams
bash plugins/team-superpower/scripts/team-state.sh scan <slug>   # inspect one
bash plugins/team-superpower/scripts/team-state.sh cleanup <slug>          # dry-run
bash plugins/team-superpower/scripts/team-state.sh cleanup <slug> --force  # apply
```

## Automatic cleanup after the feature ships

`/team-feature` runs cleanup automatically the instant the reviewer reports `FINISH_DONE` (merge / PR / keep / discard). Before wiping anything, the lead verifies:

- every phase from design through finish is complete in the checkpoint
- the shared task list has zero in-progress tasks
- the expected commits exist on the worktree (design, plan, ARCH+SEC reports, TDD pairs of test + code, QA report, code-review report, and any merge / PR-prep commit per the finish decision)
- all teammates are idle and shut down

Only then does it invoke the canonical "clean up the team" primitive, verify with a scan that `~/.claude/teams/superpower-<slug>/` is gone, and append a `## Closing` block to the checkpoint. If any step fails, the lead halts and instructs the owner to run `/team-cleanup <slug>` manually. **No `rm -rf` runs on a half-finished feature.**

## Layout

```
plugins/team-superpower/
├── .claude-plugin/plugin.json
├── README.md
├── agents/
│   ├── designer.md
│   ├── planner.md
│   ├── software-architect.md
│   ├── security-engineer.md
│   ├── backend-developer.md
│   ├── frontend-developer.md
│   ├── qa-engineer.md
│   └── reviewer.md
├── commands/
│   ├── team-feature.md
│   ├── team-feature-resume.md
│   └── team-cleanup.md
├── hooks/
│   ├── hooks.json
│   ├── teammate-idle.sh
│   ├── task-created.sh
│   └── task-completed.sh
├── scripts/
│   └── team-state.sh      → inspection + cleanup helper, called by the slash commands
└── assets/
    ├── ESCALATION.md      → seeded to docs/superpowers/ESCALATION.md on first run
    └── SESSION_README.md  → seeded to docs/superpowers/README.md on first run
```

## Design

See the project's `docs/superpowers/README.md` after first run for the operating manual. The short version:

- The **lead** is a conductor. It never runs a Superpowers skill itself.
- Teammates run **canonical, unmodified** Superpowers skills. They are forbidden from paraphrasing or replacing them.
- TDD is enforced by `subagent-driven-development` + `test-driven-development` per implementer task. The `TaskCompleted` hook is a backstop, not the primary control.
- **Two gate phases** keep the reviewer's job small. Architecture and security issues are caught at phase 3 (pre-impl) so implementers don't waste cycles on plans that fail review. QA defects are caught at phase 5 (post-impl) so the reviewer at phase 6 only deals with code-quality findings.
- All cross-team chatter that needs an owner decision goes through the §7 escalation template. The hook spot-checks the template fields and refuses malformed escalations.
- Every phase boundary writes a checkpoint to `docs/superpowers/sessions/<slug>.md`. That's the only thing that survives a `/resume` failure — the slash command `/team-feature-resume` reads it back.

## Out of scope

- Token-usage metrics per teammate per phase.
- Per-role permission allowlists.
- Standalone devops, technical-writer, or minimal-change-engineer roles — infra/CI folds into `backend-developer`; documentation lands in PR descriptions and inline; minimal-change patterns are scoped per task by the planner.

## License

MIT.
