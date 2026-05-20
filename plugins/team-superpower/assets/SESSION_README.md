# Superpowers session workspace

This directory holds the artefacts produced by `/team-feature` runs. The
team-superpower plugin seeds it on first use; afterwards the spec / plan /
handover / review / checkpoint files for each feature are written by the team
and committed.

## v5 at a glance

- **One team per feature.** A single `TeamCreate superpower-<slug>` runs the
  whole lifecycle. Membership rolls forward by spawn + shutdown across phases
  A–H — no nested teams, no concurrent teams.
- **Lead is the sole spawner.** `team-leader` composes wave briefs and posts
  `SPAWN_REQUEST` to lead; lead reads the brief, files tasks, spawns
  implementers, replies `SPAWN_DONE`. The same channel carries
  `RESTART_REQUEST` when the team is architecturally stuck.
- **No per-task QA loop.** Implementers run lint + typecheck + format before
  every commit; the output is captured to
  `.team-superpower/static-check-<task-id>.log` and the `TaskCompleted` hook
  rejects any completion without an `exit=0` line.
- **Phase-end review.** team-leader runs a consolidated SOLID/DRY/domain pass
  at the end of every plan-phase and emits `impl:rework-*` tasks where needed.
- **End-of-plan QC.** Lead spawns one `qc-engineer` after `PLAN_COMPLETE`. Up
  to 3 rework rounds (`limits.max_qc_rounds`), then owner escalation.
- **Restart on stuck.** Up to 2 `RESTART_REQUEST` cycles
  (`limits.max_cycle_restarts`); a third escalates to the owner as "feature
  not tractable".

## Customising for your project

Stack decisions, test/build commands, contract source-of-truth, CI provider,
and security posture are all driven by a `team-superpower` fenced block in your
repo-root `CLAUDE.md`. The plugin reads it on every run; it **never
overwrites it**.

### 1. Write a `team-superpower` block in CLAUDE.md

Copy `plugins/team-superpower/assets/CLAUDE.md.template` to your repo root as
`CLAUDE.md` (or paste the `team-superpower` block into your existing CLAUDE.md).
The block recognises:

- `backend` — `language`, `framework`, `test_framework`, `build_command`,
  `test_command`, `format_command`, `lint_command`, `typecheck_command`,
  `migration_tool`, `package_manager`. Set `backend: none` to declare a
  frontend-only repo.
- `frontend` — `language`, `framework`, `bundler`, `test_framework`,
  `e2e_framework`, `ui_library`, `package_manager`, `build_command`,
  `test_command`, `lint_command`, `typecheck_command`, `format_command`. Set
  `frontend: none` to declare a backend-only repo.
- `contracts` — `source_of_truth` (`openapi` / `grpc` / `graphql` /
  `typescript` / `none`), `openapi_path`, `ts_gen_command`.
- `ci` — `provider`, `workflow_path`, `required_checks`,
  `poll_timeout_minutes` (default 20). Used by team-leader at the
  finish-branch decision (phase H).
- `security` — `domain` (`payments` / `healthcare` / `generic` /
  `internal-only`), `pii`, `public_endpoints`, `data_at_rest`. Drives whether
  `security-engineer` is spawned in phase A.
- `limits` — `phase_stall_minutes`, `max_tasks_per_implementer`,
  `max_concurrent_teammates`, `max_iterations_per_task`, `task_token_budget`,
  `retrieval_budget_per_task`, `max_qc_rounds`, `max_cycle_restarts`.

Free-form prose around the block (e.g. a `## Conventions` section with
project-specific rules) is passed to every teammate as project context.

### 2. Auto-detection fallback

If `CLAUDE.md` is missing or has no `team-superpower` block, the lead runs
`scripts/detect-stack.sh` in phase 0 and writes its best guess to
`docs/superpowers/stack.detected.md`, then halts and asks you to review the
`# CONFIRM:` lines and paste the corrected block into CLAUDE.md. **The plugin
will not edit your CLAUDE.md for you.**

### 3. Shape-adaptive team

Once the block (or detection) is parsed, the lead decides the **stack shape**:

| Shape | Phase-A roles | Implementation roles |
|-------|---------------|----------------------|
| `full-stack`  | solution-architect, feature-planner, (security-engineer) | backend-developer, frontend-developer |
| `be-only`     | solution-architect, feature-planner, (security-engineer) | backend-developer |
| `fe-only`     | solution-architect, feature-planner, (security-engineer) | frontend-developer |

`security-engineer` is added only when `security.domain ∈
{payments, healthcare}` OR `security.pii: yes`. Otherwise solution-architect
runs a lightweight security pass alone.

The shape is written to `docs/superpowers/sessions/<slug>.shape`; the
`TaskCreated` hook reads it to reject `impl:fe-*` in BE-only repos and
vice-versa.

#### Concurrency model

Phase-gated. The roles listed above are the **lifetime** team size, not the
parallelism. Roles alive at any moment:

| Phase | Concurrent teammates |
|-------|----------------------|
| A — analytics            | solution-architect + feature-planner (+ security-engineer when in scope) |
| B–F — implementation     | team-leader + 1–N implementers (capped by `limits.max_concurrent_teammates`, default 5) |
| G — end-of-plan QC       | team-leader + qc-engineer |
| H — finish               | team-leader (drives CI gate + finish-branch decision) |

Phase-A members shut down at `HANDOVER_READY`. No standby. If the team hits an
architectural blocker mid-implementation, team-leader posts `RESTART_REQUEST`
and lead re-runs phase A with the handover + partial commits as input.

#### Within-phase stall watchdog

If lead detects no mailbox activity or shared-task-list transitions for
`limits.phase_stall_minutes` (default 30) within a phase, it pings the active
teammate; if the next 30-minute window is also silent, it surfaces a §7
escalation.

#### Worktree reuse

If you launch `/team-feature` from inside a linked git worktree on a feature
branch, the planner reuses that worktree instead of nesting a new one. The
signal `WORKTREE_READY <path> <branch> <origin>` carries `origin: reused` and
the checkpoint records `**Worktree origin:** reused`.

| Where `/team-feature` is launched | Branch | Behavior |
|---|---|---|
| Linked worktree | feature branch | **Reuse** the current worktree. |
| Linked worktree | `main`, `master`, `develop`, `dev`, `release/*`, `releases/*` | **Halt.** Switch to a feature branch and re-run. |
| Main repo | any | **Create** a fresh worktree via Superpowers `using-git-worktrees`. |

A reused worktree is owned by you, not the team — auto-removal after merge
**does not run** when origin is `reused`.

### 4. Contract sync (full-stack only)

When both BE and FE are present and `contracts.source_of_truth != none`, the
planner emits `impl:be-contract-publish-<slug>` as the first phase-B task. The
lead does not assign any `impl:fe-*` task until the backend-developer posts
`CONTRACT_PUBLISHED`. Every `impl:fe-*` task has
`depends_on: [impl:be-contract-publish-<slug>]` in its metadata.

Mid-implementation contract drift uses `impl:contract-update-<topic>`.

### 5. CI gate before finish (phase H)

team-leader pushes the branch in phase H, then (when `ci.provider != none`)
polls the CI provider for `ci.required_checks` up to `ci.poll_timeout_minutes`
(default 20). On green the finish-branch menu surfaces. On red the
merge-failure menu surfaces with an extra "Show CI logs" option. On timeout a
3-option menu (re-poll / switch to `pr_opened` / escalate) surfaces.

### 6. Project-aware security checklist

`security-engineer` reads the `security` block and the stack info, then
expands its checklist accordingly. A `domain: payments` repo gets idempotency
/ audit-trail / PCI items; a `data_at_rest: sql` repo gets parameterised-query
items; a no-FE repo skips XSS items entirely. The output report uses ✅/⚠️/❌
markers — any ❌ blocks phase B.

### 7. Iteration cap (MAX_ITERATIONS)

Every `impl:` task carries an `iteration_count:`. If an implementer retries
the same failing test 8 times it halts and posts a §7 escalation with
`what_failed:`, `one_change_to_fix:`, and `class:`. The `task-completed` hook
rejects completions where `iteration_count > 8` unless a `reflection:` block
is attached.

Configure per project in CLAUDE.md `limits.max_iterations_per_task` (default
8). Lower for slow-feedback environments; never raise above 12.

## Layout

```
docs/superpowers/
├── ESCALATION.md                          # template — referenced by every teammate
├── README.md                              # this file
├── specs/      YYYY-MM-DD-<slug>-spec.md      # owner+architect, phase A
├── plans/      YYYY-MM-DD-<slug>-plan.md      # feature-planner, phase A
├── handovers/  YYYY-MM-DD-<slug>-handover.md  # solution-architect, end of phase A
├── reviews/    YYYY-MM-DD-<slug>-security.md  # security-engineer, phase A (if spawned)
├── reviews/    YYYY-MM-DD-<slug>-qc.md        # qc-engineer, phase G
├── sessions/   YYYY-MM-DD-<slug>.md           # checkpoint, updated by lead each phase
└── sessions/   <slug>.shape                   # stack shape marker (be-only|fe-only|full-stack)
```

Per-feature scratch (lives next to the worktree):

```
.team-superpower/
├── spawn-briefs/    wave-<plan-phase>.<wave>.md   # team-leader, one per wave
└── static-check-<task-id>.log                     # implementer, one per impl: task
```

## How to launch

```text
/team-feature <one-line feature idea>
```

The lead handles prechecks, spawns the analytics team for phase A, drives the
hand-off to team-leader, and supervises through phase H.

To resume an in-flight feature drop back into the same worktree and re-run
`/team-feature` — the lead detects the existing `~/.claude/teams/superpower-<slug>/`
directory and continues from the checkpoint. **There is no separate resume
command in v5.**

## Owner touchpoints (max 3 per feature)

1. **Spec sign-off** (mid phase A). Solution-architect batches all clarifying
   questions before this point.
2. **Plan approval** (end phase A). Before handover to team-leader.
3. **Finish-branch decision** (in phase H). Merge / PR / keep / discard.

Recovery touchpoints (`RESTART_REQUEST`, model fallback, CI timeout) are
**not** counted against the 3-touchpoint budget. Anything else that reaches
you must use the §7 escalation template in `ESCALATION.md`.

## Reading a checkpoint

`sessions/YYYY-MM-DD-<slug>.md` is the source of truth for in-flight features.
Each phase boundary appends or updates:

- `## Phases` — checklist, file paths to the artefacts.
- `## Teammates` — role, agent id, current task or `idle`.
- `## Open escalations` — anything blocking the owner or a peer.
- `## Assumptions` — one line per non-owner decision (tactical, cross-role,
  architectural).
- `## Cycle history` — append a row on every `RESTART_REQUEST`.

The lead commits this file after every phase transition. If the lead crashes,
your feature lives in this file.

## Recovery — auto-resume

If `/resume` drops the team mid-feature, re-run `/team-feature <slug>` from
the same worktree. The lead:

1. Reads `~/.claude/teams/superpower-<slug>/config.json` to know which roles
   were alive.
2. Reads `docs/superpowers/sessions/<slug>.md` to know which phase is current.
3. If past phase A, reads `docs/superpowers/handovers/<date>-<slug>-handover.md`.
4. Re-spawns the right teammates (skipping completed phases). A
   `Resume: <ISO ts>` line is appended to the checkpoint for the audit trail.

Completed phases are never redone. Partial commits are kept.

## Cleanup model

The lead is the only thing that knows when a team's work is done. There is no
`TeamShutdown` hook event, so cleanup is driven by the slash commands:

- **Automatic**, the happy path: `/team-feature` runs cleanup immediately
  after `FINISH_DONE`. The lead verifies all phases complete, all expected
  commits in place, every teammate idle, then invokes the canonical "clean up
  the team" primitive and confirms with a final scan. A `## Closing` block is
  appended to the checkpoint.

### Closing-block fields

- `finished at: <ISO datetime>`
- `decision: <merged|pr_opened|kept|discarded>`
- `cleanup: complete`
- `cycle_restart_count: <N>` — how many `RESTART_REQUEST` cycles ran.
- `qc_rounds: <N>` — end-of-plan QC rounds consumed.
- `worktree: <state>` — `removed` | `already-absent` | `removal-skipped:<reason>` | `kept-by-owner` | `escalated`.

- **Manual**, the orphan path: if a lead crashed and left
  `~/.claude/teams/superpower-<slug>/` behind, run `/team-cleanup <slug>` from
  a fresh session. The slash command dry-runs first, prints what would be
  removed, asks for confirmation, then applies. The heartbeat file
  (`docs/superpowers/sessions/<slug>.heartbeat`) protects against wiping a
  live team.

Project-side artefacts (`specs/`, `plans/`, `handovers/`, `reviews/`, and the
checkpoint itself) are **always preserved**. Only platform-side state under
`~/.claude/teams/superpower-<slug>/` and `~/.claude/tasks/superpower-<slug>/`
plus the per-feature scratch under `.team-superpower/` is removed.

## Heartbeat protocol

The lead touches `docs/superpowers/sessions/<slug>.heartbeat` at every phase
boundary. Future sessions read its mtime to decide whether a previous lead is
still alive:

- mtime < 10 minutes → lead is likely alive; cleanup refuses without explicit
  override.
- mtime ≥ 10 minutes (or file missing) → safe to clean up.

```bash
bash plugins/team-superpower/scripts/team-state.sh scan <slug>
bash plugins/team-superpower/scripts/team-state.sh members <slug>
```

## Troubleshooting

| Symptom | What it usually means | First thing to check |
|---|---|---|
| `BLOCKED_IDLE_implementer_owes_team-leader_reply` | Implementer tried to idle with an unanswered message from team-leader | Open the implementer's mailbox, reply or escalate |
| `BLOCKED_IDLE_team-leader_awaiting_lead_on_spawn_or_restart` | team-leader sent SPAWN_REQUEST or RESTART_REQUEST and lead hasn't replied | Look at lead's mailbox; if dropped, re-post |
| `BLOCKED_IDLE_team-leader_owes_implementer_escalate_reply` | An implementer sent ESCALATE that team-leader hasn't routed | Route it (tactical/cross-role/architectural) or escalate to owner |
| `BLOCKED_IDLE_qc-engineer_awaiting_lead_ack` | qc-engineer posted QC_REWORK_NEEDED and lead hasn't replied | Lead acknowledges, files `impl:rework-*` via team-leader |
| `BLOCKED_IDLE_phaseA_awaiting_owner_signoff` | analytics team sent HANDOVER_READY / SEC_PASSED / SEC_BLOCKED with no reply | Owner reviews and replies |
| `BLOCKED_IDLE_orchestrator_unhandled_team-leader_request` | team-leader sent something the lead hasn't acted on | Lead acts (spawn / restart / route) |
| `bad_prefix` on a new task | Lead created a task without the `impl:`/`review:`/`meta:`/`block:` prefix | Lead's bug — fix the task title |
| `bad_subprefix` on `impl:*` | Missing `be-` / `fe-` / `rework-` / `contract-update-` sub-prefix | Re-emit with correct prefix |
| `INVALID_WAVE_REFERENCE` on a new task | Wave metadata missing or not in `<plan-phase>.<wave>` / `<plan-phase>.rework` / `qc-rework` shape | Fix the wave metadata before re-creating |
| `MISSING_STATIC_CHECKS` on task complete | `.team-superpower/static-check-<task-id>.log` missing or has a non-zero `exit=` line | Implementer re-runs lint/typecheck/format, captures log, re-commits |
| `MISSING_REWORK_REFERENCE` on task complete | `impl:rework-*` commit body missing `Reworks: <orig-id>` line | Implementer amends the commit body and re-completes |
| `MIGRATION_RACE` on task complete | Two migration tasks were `in_progress` simultaneously | Lead should serialize migrations |
| `EMPTY_CONTRACT_PUBLISH` on task complete | A contract-publish task completed but no commit touched a contract file | Backend-developer didn't actually publish; investigate and re-run |
| `ARCH_BLOCKED` or `SEC_BLOCKED` from phase A | Pre-impl gate rejected the plan | Planner addresses the report, re-emits, re-runs the gate |
| Hook log noise | Hooks write tuning data to `.claude/hooks/log.jsonl` | Inspect; trim or refine matchers |

## Emergency bypass

`--dangerously-skip-permissions` will let a single task ship without the hooks
firing. **Don't.** The hooks exist because Superpowers gates exist. Use the
escalation template to surface the blocker properly.

## Where the methodology lives

The team-superpower plugin is purely the coordination layer. The actual
development discipline (TDD, plan format, two-stage review, branch hygiene) is
owned by the upstream [obra/superpowers](https://github.com/obra/superpowers)
skills. If a skill's behaviour changes, the team picks it up automatically —
agents reference skills by name, not by content.

## Session checkpoint § Assumptions

Every non-owner decision (tactical, cross-role with consensus, architectural
with sign-off) is logged as one line in the session checkpoint's
`## Assumptions` block. The qc-engineer scans this block at end-of-plan for
contradictions with the spec / plan; contradictions surface as QC findings.
Format:

```
- <ISO ts> <role> [class=<tactical|cross-role|architectural>]: <one-line decision> (peer: <role|none>, evidence: <link to mailbox msg | n/a>)
```

The owner sees the assumptions log at every phase boundary as part of the
checkpoint commit.
