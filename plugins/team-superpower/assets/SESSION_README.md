# Superpowers session workspace

This directory holds the artifacts produced by `/team-feature` runs. The team-superpower plugin seeds it on first use; afterwards, the design / plan / review / checkpoint files for each feature are written by the team and committed.

## Customising for your project

Stack decisions, test/build commands, contract source-of-truth, CI provider, and security posture are all driven by a `team-superpower` fenced block in your repo-root `CLAUDE.md`. The plugin reads it on every run; it **never overwrites it**.

### 1. Write a `team-superpower` block in CLAUDE.md

Copy `plugins/team-superpower/assets/CLAUDE.md.template` to your repo root as `CLAUDE.md` (or paste the `team-superpower` block into your existing CLAUDE.md). The block recognises:

- `backend` — `language`, `framework`, `test_framework`, `build_command`, `test_command`, `format_command`, `migration_tool`, `package_manager`. Set `backend: none` to declare a frontend-only repo.
- `frontend` — `language`, `framework`, `bundler`, `test_framework`, `e2e_framework`, `ui_library`, `package_manager`, `build_command`, `test_command`. Set `frontend: none` to declare a backend-only repo.
- `contracts` — `source_of_truth` (`openapi` / `grpc` / `graphql` / `typescript` / `none`), `openapi_path`, `ts_gen_command`.
- `ci` — `provider`, `workflow_path`, `required_checks`, `poll_timeout_minutes` (default 20).
- `security` — `domain` (`payments` / `healthcare` / `generic` / `internal-only`), `pii`, `public_endpoints`, `data_at_rest`.

Free-form prose around the block (e.g. a `## Conventions` section with project-specific rules) is passed to every teammate as project context.

### 2. Auto-detection fallback

If `CLAUDE.md` is missing or has no `team-superpower` block, the lead runs `scripts/detect-stack.sh` in phase 0 and writes its best guess to `docs/superpowers/stack.detected.md`, then halts and asks you to review the `# CONFIRM:` lines and paste the corrected block into CLAUDE.md. **The plugin will not edit your CLAUDE.md for you.**

### 3. Shape-adaptive team

Once the block (or detection) is parsed, the lead decides the **stack shape**:

| Shape | Teammates spawned |
|-------|-------------------|
| `full-stack`  | designer, planner, software-architect, security-engineer, backend-developer, frontend-developer, qa-engineer, reviewer (8) |
| `be-only`     | designer, planner, software-architect, security-engineer, backend-developer, qa-engineer, reviewer (7) — no `frontend-developer` |
| `fe-only`     | designer, planner, software-architect, security-engineer, frontend-developer, qa-engineer, reviewer (7) — no `backend-developer` |

The shape is written to `docs/superpowers/sessions/<slug>.shape`; the `TaskCreated` hook reads it to reject `impl:fe-*` in BE-only repos and vice-versa.

#### Concurrency model

The numbers above (7 or 8) are the **lifetime** team size, not the parallelism. Roles are phase-gated: only the teammates needed for the current phase are alive at any moment. The maximum concurrency is **2 teammates in parallel**:

| Phase | Concurrent teammates |
|-------|----------------------|
| 1 design        | 1 (designer) |
| 2 plan          | 1 (planner) |
| 3 pre-impl gate | 2 (software-architect + security-engineer, parallel) |
| 4 implementation | 1 (`be-only` or `fe-only`) or 2 (`full-stack`, after `CONTRACT_PUBLISHED`) |
| 5 QA            | 1 (qa-engineer) |
| 6 review        | 1 (reviewer) |
| 7 finish        | 1 (reviewer, hat 2 — reused) |

This matches the Claude Code agent-team best practice of "3–5 teammates in parallel, 5–6 tasks each". The lead caps concurrency at 5 (configurable via `limits.max_concurrent_teammates` in CLAUDE.md) and refuses to start a phase that would exceed it. The planner caps tasks per implementer at 12 (configurable via `limits.max_tasks_per_implementer`) and asks the owner to split the feature if a plan would exceed it.

If the lead detects no mailbox activity or shared-task-list transitions for `limits.phase_stall_minutes` (default 30) within a phase, it pings the active teammate; if the next 30-minute window is also silent, it surfaces a §7 escalation. This is the within-phase stall watchdog — heartbeat-at-phase-boundaries alone doesn't catch silent hangs.

#### Worktree reuse

If you launch `/team-feature` from inside a linked git worktree on a feature branch, the planner reuses that worktree instead of nesting a new one inside it. The signal `WORKTREE_READY <path> <branch> <origin>` carries `origin: reused` and the checkpoint records `**Worktree origin:** reused`.

Detection is automatic — no config needed:

| Where `/team-feature` is launched | Branch                                                    | Behavior |
|---|---|---|
| Linked worktree                   | feature branch (anything not protected)                   | **Reuse** the current worktree. |
| Linked worktree                   | `main`, `master`, `develop`, `dev`, `release/*`, `releases/*` | **Halt.** Switch to a feature branch (`git checkout -b feature/<slug>`) and re-run. |
| Main repo                         | any                                                       | **Create** a fresh worktree via Superpowers `using-git-worktrees`. |

A reused worktree is owned by you, not the team — Step D.5 auto-removal after merge **does not run** when origin is `reused`; the Closing block records `worktree: removal-skipped:reused-existing-worktree` and the worktree stays on disk. Created worktrees are removed after a successful merge as before.

The clean-test-baseline check still runs in both modes. If you reused a worktree with uncommitted changes that break the baseline, the planner halts with a §7 escalation asking you to stash or commit first.

### 4. Contract sync (full-stack only)

When both BE and FE are present and `contracts.source_of_truth != none`, the planner emits `impl:be-contract-publish-<slug>` as the first phase-4 task. The lead does not assign any `impl:fe-*` task until the backend-developer posts `CONTRACT_PUBLISHED`. Every `impl:fe-*` task has `depends_on: [impl:be-contract-publish-<slug>]` in its metadata.

Mid-implementation contract drift uses `impl:contract-update-<topic>`: BE files it (often after FE posts `CONTRACT_DRIFT_DETECTED`), updates the contract, runs `ts_gen_command`, posts `CONTRACT_UPDATED`, and FE resumes after re-pulling the contract hash.

### 5. CI gate before finish

The reviewer pushes the branch in phase 7, then (when `ci.provider != none`) polls the CI provider for `ci.required_checks` up to `ci.poll_timeout_minutes` (default 20). On green, the finish-branch menu surfaces. On red, the merge-failure menu surfaces with an extra "Show CI logs" option. On timeout, a 3-option menu (re-poll / switch to pr_opened / escalate) surfaces. Every CI variant counts as the **same** finish-branch touchpoint — the 3-touchpoint cap holds.

### 6. Project-aware security checklist

`security-engineer` reads the `security` block and the stack info, then expands its checklist accordingly. A `domain: payments` repo gets idempotency / audit-trail / PCI items; a `data_at_rest: sql` repo gets parameterised-query items; a no-FE repo skips XSS items entirely. The output report uses ✅/⚠️/❌ markers — any ❌ blocks phase 4.

### 7. Superpowers version pinning

The lead reads the installed Superpowers version in phase 0 and writes it to the checkpoint frontmatter (`superpowers_version`). On `/team-feature-resume`, the lead checks whether the installed version still matches. If not, you see a 3-option menu (continue anyway / roll back Superpowers / discard this feature). The pin is informational + safety — never a hard block; you can always continue.

## Layout

```
docs/superpowers/
├── ESCALATION.md                          # template — referenced by every teammate
├── README.md                              # this file
├── specs/    YYYY-MM-DD-<slug>-design.md     # written by designer (phase 1)
├── plans/    YYYY-MM-DD-<slug>-plan.md       # written by planner (phase 2)
├── reviews/  YYYY-MM-DD-<slug>-arch.md       # written by software-architect (phase 3)
├── reviews/  YYYY-MM-DD-<slug>-security.md   # written by security-engineer (phase 3)
├── reviews/  YYYY-MM-DD-<slug>-qa.md         # written by qa-engineer (phase 5)
├── reviews/  YYYY-MM-DD-<slug>-review.md     # written by reviewer (phase 6)
└── sessions/ YYYY-MM-DD-<slug>.md            # checkpoint, updated by lead each phase
```

## How to launch

```text
/team-feature <one-line feature idea>
```

The lead handles prechecks, spawns the team, and drives the Superpowers skill chain.

## Owner touchpoints (max 3 per feature)

1. **Design sign-off** (after phase 1). The brainstorming skill's built-in approval step. Designer batches any clarifying questions before this point so they piggy-back the same touchpoint.
2. **Plan approval** (after phase 2). Before the pre-impl arch+security gate runs.
3. **Finish-branch decision** (in phase 7). Merge / PR / keep / discard.

Anything else that reaches you must use the §7 escalation template in `ESCALATION.md`. Refuse questions that don't follow it — that's the contract.

## Reading a checkpoint

`sessions/YYYY-MM-DD-<slug>.md` is the source of truth for in-flight features. Each phase boundary appends or updates:

- The `## Phases` checklist (which phases are done, file paths to the artifacts).
- The `## Teammates` block (role, agent id, current task or `idle`).
- The `## Open escalations` block (anything blocking the owner or a peer).

The lead commits this file after every phase transition. If the lead crashes, your feature lives in this file.

## Recovery — `/team-feature-resume`

If `/resume` drops the team mid-feature (the platform doesn't restore in-process teammates yet), use:

```text
/team-feature-resume <checkpoint-filename>
```

The lead reads the checkpoint, respawns the right teammates, and continues from the next unchecked phase. Completed phases are not redone. A resume-log entry is appended to the checkpoint for the audit trail.

## Cleanup model

The lead is the only thing that knows when a team's work is done. There is no `TeamShutdown` hook event, so cleanup is driven by the slash commands:

- **Automatic**, the happy path: `/team-feature` runs cleanup immediately after `FINISH_DONE`. The lead verifies all phases complete, all expected commits in place, every teammate idle, then invokes the canonical "clean up the team" primitive and confirms with a final scan. A `## Closing` block is appended to the checkpoint.

### Closing-block fields

The auto-cleanup writes a `## Closing` block with these fields:

- `finished at: <ISO datetime>` — when cleanup finished.
- `decision: <merged|pr_opened|kept|discarded>` — the finish-branch decision.
- `cleanup: complete` — confirms all cleanup steps ran (or were intentionally skipped).
- `worktree: <state>` — outcome of Step D.5. One of: `removed`, `already-absent`, `removal-skipped:<reason>`, `removed (after manual fix)`, `force-removed`, `kept-by-owner`, `escalated`.
- `worktree_path: <path>` — present only when the worktree directory still exists on disk (states `kept-by-owner`, `escalated`, or `removal-skipped` where the path exists).
- `merge_retries: K` — present only when K > 0; how many retries the 5-option menu ran before reaching `FINISH_DONE`.
- `dropped_files: [<path>, ...]` — present only when `worktree: force-removed`; the file list snapshot from before the forced removal.

`removal-skipped` reasons: `not-merged-decision` (decision was pr_opened/kept/discarded) | `team-cleanup-incomplete` (Step C/D left platform state present) | `no-worktree-recorded` (checkpoint had no `**Worktree:**` line).
- **Manual**, the orphan path: if a lead crashed and left `~/.claude/teams/superpower-<slug>/` behind, run `/team-cleanup <slug>` from a fresh session. The slash command dry-runs first, prints what would be removed, asks for confirmation, then applies. The heartbeat file (`docs/superpowers/sessions/<slug>.heartbeat`) protects against wiping a live team — if it was touched in the last 10 minutes, cleanup refuses unless you explicitly confirm with `--ignore-heartbeat`.

Project-side artefacts (`specs/`, `plans/`, `reviews/`, and the checkpoint itself) are **always preserved**. Only platform-side state under `~/.claude/teams/superpower-<slug>/` and `~/.claude/tasks/superpower-<slug>/` is removed, plus any matching tmux session.

## Heartbeat protocol

The lead touches `docs/superpowers/sessions/<slug>.heartbeat` at every phase boundary. Future sessions read its mtime to decide whether a previous lead is still alive:

- mtime < 10 minutes → lead is likely alive; cleanup refuses without explicit override.
- mtime ≥ 10 minutes (or file missing) → safe to clean up.

If you ever want to confirm liveness manually:

```bash
bash plugins/team-superpower/scripts/team-state.sh scan <slug>
```

## Troubleshooting

| Symptom | What it usually means | First thing to check |
|---|---|---|
| `BLOCKED_IDLE: N unanswered peer messages` from a teammate | A peer asked the teammate something and they tried to idle without replying | Open the teammate's mailbox, reply or escalate |
| `BAD_PREFIX` on a new task | The lead created a task without the `impl:`/`review:`/`meta:`/`block:` prefix (or used an `impl:` task without one of the v2 sub-prefixes: `be-`, `fe-`, `qa-fix-be-`, `qa-fix-fe-`, `review-fix-be-`, `review-fix-fe-`, `contract-update-`, `be-migration-`, `be-contract-publish-`) | Lead's bug — fix the task title |
| `SHAPE_REJECTED: shape is 'be-only'` (or `fe-only`) | A task was created with a prefix the shape doesn't allow (e.g. `impl:fe-*` in a BE-only repo) | Planner or lead bug — re-check `docs/superpowers/sessions/<slug>.shape` and re-emit |
| `MIGRATION_RACE` on task complete | Two `impl:be-migration-*` tasks were `in_progress` simultaneously | Lead should serialize migrations; backend-developer should idle if another migration is in flight |
| `EMPTY_CONTRACT_PUBLISH` on task complete | A `impl:be-contract-publish-*` task completed but no commit touched a contract file | Backend-developer didn't actually publish; investigate and re-run the task |
| `superpowers_version` mismatch on resume | Superpowers was upgraded between feature start and resume | Pick continue / rollback / discard from the 3-option menu |
| `NO_PLAN_APPROVAL` blocking a task complete | An `impl:` task is missing `metadata.plan_approved_at` | Lead forgot to stamp tasks after owner plan-approval; backfill from the checkpoint timestamp |
| `ARCH_BLOCKED` or `SEC_BLOCKED` from phase 3 | Pre-impl gate rejected the plan; arch/security findings need plan revisions | Planner addresses the report, re-emits the plan, re-runs the gate before phase 4 starts |
| `QA_BLOCKED` from phase 5 | Acceptance criteria or regression coverage missing post-implementation | Lead files `impl:qa-fix-be-` / `impl:qa-fix-fe-` tasks; loop back to phase 4 |
| Backend developer and frontend developer want the same file | Plan didn't capture file-scope metadata for the overlapping tasks, or the task was mis-prefixed | Serialize by holding one; planner should re-route by `impl:be-` / `impl:fe-` prefix and backfill file-scope |
| `bad_escalation: missing field(s) ...` (warn-only in `log.jsonl`) | A teammate posted a blocker without all six template fields (`Phase`, `Context`, `Options`, `Recommendation`, `Need from you`, `Peer attempts`) | Rewrite using the full template in `assets/ESCALATION.md` |
| Lead refuses to ping the owner | The teammate's request to escalate didn't use the §7 template | Same as above |
| Teammate ran a non-Superpowers approximation of a skill | Teammate paraphrased the SKILL.md instead of following it | The agent's system prompt requires the canonical skill — re-spawn and remind it explicitly |
| `REFUSED: heartbeat ... is Ns old` from cleanup | Heartbeat is fresh — cleanup script thinks a lead is alive | Verify nothing's running; if certain the previous lead is dead, run with `--ignore-heartbeat` |
| `/team-feature` halts at preflight | Stale team config left over from a previous run | Run `/team-cleanup <slug>` (or resume via `/team-feature-resume`) |
| `FINISH_BLOCKED <reason>` from the reviewer | The merge step of `finishing-a-development-branch` failed (`conflict` / `non-ff` / `dirty-worktree` / `push-rejected`) | The lead surfaces a 5-option menu (retry / pr_opened / kept / discarded / escalate). Pick one; merge retries cap at 3. |
| `RETRY_PEER: try <role> first` | Lead bounced an escalation because the originator's class isn't `owner-only` and `Peer attempts` is empty | Originator mails the named role with the question, waits one cadence, then refiles citing the attempt. See `assets/ESCALATION.md` § Decision classes |
| `LOG_ASSUMPTION: tactical, log to checkpoint § Assumptions` | Lead bounced a `class=tactical` escalation | Originator logs one line under the session checkpoint's `## Assumptions` and proceeds. No owner touchpoint consumed |
| `git worktree remove` failed during cleanup | Step D.5 hit an uncommitted/untracked file or a locked worktree | Pick from the 4-option menu (show files + retry / force-remove with confirmation / keep / escalate). Force-remove discards uncommitted work — only confirm if you've checked the file list. |
| Auto-cleanup skipped after FINISH_DONE | One of Step A's preconditions failed (missing commits, in-progress tasks, etc.) | Read the lead's halt reason; once resolved, run `/team-cleanup <slug>` |
| Hook log noise | Hooks write tuning data to `.claude/hooks/log.jsonl` | Inspect the file; trim or refine matchers if a hook is over-triggering |

## Emergency bypass

`--dangerously-skip-permissions` will let a single task ship without the hooks firing. **Don't.** The hooks exist because Superpowers gates exist. Use the escalation template to surface the blocker properly.

## Where the methodology lives

The team-superpower plugin is purely the coordination layer. The actual development discipline (TDD, plan format, two-stage review, branch hygiene) is owned by the upstream [obra/superpowers](https://github.com/obra/superpowers) skills. If a skill's behaviour changes, the team picks it up automatically — agents reference skills by name, not by content.

## Session checkpoint § Assumptions

Every non-owner decision (tactical, cross-role with consensus, architectural with sign-off) is logged as one line in the session checkpoint's `## Assumptions` block. The QA and reviewer phases scan this block for contradictions with the design / plan; contradictions surface as QA findings or review comments. Format:

```
- <ISO ts> <role> [class=<tactical|cross-role|architectural>]: <one-line decision> (peer: <role|none>, evidence: <link to mailbox msg | n/a>)
```

The owner sees the assumptions log at every phase boundary as part of the checkpoint commit.
