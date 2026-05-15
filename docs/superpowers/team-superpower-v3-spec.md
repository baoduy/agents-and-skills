# Spec: team-superpower v3 Amendment

**Owner:** Steven
**Date:** 2026-05-12
**Status:** Ready for implementation
**Target:** [baoduy/agents-and-skills `plugins/team-superpower`](https://github.com/baoduy/agents-and-skills/tree/dev/plugins/team-superpower) (the `dev` branch v2)
**Builds on:** v2 (CLAUDE.md-driven, shape-adaptive, Sonnet-pinned teammates, 4-class clarification routing)

---

## 1. Goal

Add three capabilities to the existing v2 plugin:

1. **Autonomous complexity assessment** in phase 0. The lead picks an execution mode (`solo` / `single-agent` / `team`) and a team size (`minimal` / `standard` / `full`) from launch-message heuristics alone — no extra owner touchpoint. The 3-touchpoint budget is preserved (still: design / plan / finish).

2. **Dependency-grouped parallel waves** in phase 4. The planner emits a wave schedule. Independent tasks within a wave run concurrently across up to **2 BE + 2 FE implementers** at peak. Subsequent waves wait for the previous wave to fully complete. If two tasks in the same wave collide on a shared file, the wave **hard-fails** and the planner re-plans.

3. **Per-role model and effort configuration**. Each agent role gets an explicit model pin and effort guidance matched to its workload — Opus 4.7 for orchestration / design / architecture / security / final review, Sonnet 4.6 for planning / implementation / QA. The team-superpower plugin currently runs all teammates on Sonnet; v3 routes the high-leverage generative and gating roles to Opus 4.7 while keeping mechanical implementation roles on Sonnet 4.6. Cost stays in the same order of magnitude as today's plugin; output quality goes up on the roles where it matters most.

Everything else from v2 stays — CLAUDE.md schema, shape-adaptive spawn, four-class clarification routing, the gate phases, CI gate, version pinning.

## 2. Non-goals

- Not adding an owner touchpoint for complexity assessment. Heuristics decide; owner can override post-hoc with flags but never approves up-front.
- Not changing the four-class clarification routing or the escalation template.
- Not changing the 3-touchpoint promise.
- Not implementing per-implementer worktrees. Wave-based serialization is the collision strategy.
- Not implementing speculative parallelism (running tasks whose dependencies *might* be satisfied). Strict wave boundaries only.
- Not auto-scaling beyond 2 BE + 2 FE. Higher concurrency is a future amendment.

## 3. Success criteria

1. `/team-feature add login page` (multi-touchpoint feature, full-stack) on a typical project picks `mode=team, size=standard, shape=full-stack`. No owner touchpoint added.
2. `/team-feature fix typo in error message` picks `mode=solo`. The lead does the work itself; no team spawned. Owner sees the diff and approves.
3. `/team-feature add /healthcheck endpoint that returns 200 OK` on a BE-only repo picks `mode=single-agent, shape=be-only`. One backend-developer spawned (no PM/architect/security/QA gates), full TDD enforced, owner sees the result. The 3 touchpoints are still: spec sign-off, plan approval, finish-branch.
4. `/team-feature` with `--mode=team --size=full` overrides heuristics. Owner can also force `--mode=solo` or `--size=minimal`.
5. The planner emits a `waves:` array in the plan. Each wave's tasks have explicit `depends_on:` lists referencing prior-wave task IDs.
6. During phase 4 with a full-stack feature that has independent BE and FE work, the lead spawns 2 backend-developer instances + 2 frontend-developer instances in wave 1 if the plan supports it. Each instance claims one task from its side's wave-1 queue.
7. If two BE tasks in the same wave both modify `src/services/auth.cs`, the wave halts on collision detection, the planner is invoked to re-plan that wave, and the dependency graph gets a new edge between the two tasks.
8. Sequential dependencies (B depends on A) are respected: wave 2 does not start until all wave 1 tasks complete.
9. The complete feature still ships through 3 owner touchpoints. No accidental mid-feature pings introduced by parallelism.
10. Every agent definition file has an explicit `model:` pin in frontmatter (no implicit inheritance). The lead can list every teammate's model with one command and verify the pinned configuration matches §11 of this spec.
11. A typical full-stack standard-size feature runs ~3 sessions on Opus 4.7 (lead, designer, reviewer) and ~5-7 sessions on Sonnet 4.6 (planner, BE/FE implementers, QA). Verified via Anthropic usage dashboard after a dry-run feature.

## 4. Complexity assessment

### 4.1 The three modes

| Mode | What it does | When to use |
|---|---|---|
| **solo** | The lead does the work itself in its own session. No teammates spawned. Owner sees a single diff and approves. | Trivial changes: typo fixes, single-line config edits, one-line README updates, version bumps. |
| **single-agent** | The lead spawns exactly one implementer (matching the shape — backend-developer or frontend-developer) and goes straight to phase 4. No designer, no planner, no gates, no QA, no reviewer. The lead writes a minimal plan inline and approves it itself. | Small, well-scoped changes: one new endpoint, one bug fix in a known file, one new component. |
| **team** | The full v2 flow: designer → planner → arch+security gates → BE/FE implementation → QA → review → finish. Three sub-sizes within. | Anything non-trivial, anything cross-cutting, anything with multi-file impact, anything that needs design discussion. **Default.** |

### 4.2 The three team sizes (only relevant when mode=team)

| Size | Roles spawned (full-stack) | Roles spawned (BE-only / FE-only) |
|---|---|---|
| **minimal** | designer, planner, BE, FE, reviewer (5) | designer, planner, implementer, reviewer (4) |
| **standard** | + qa-engineer (6) | + qa-engineer (5) |
| **full** | + software-architect, security-engineer (8) | + software-architect, security-engineer (7) |

`standard` is the default. `full` is required for regulated-domain features (`CLAUDE.md`'s `security.domain: payments | healthcare`). `minimal` is for low-stakes internal changes.

### 4.3 The heuristic ladder

In phase 0, after stack detection and Superpowers version pinning, before spawning any teammate, the lead runs a heuristic ladder against the owner's launch message. Each rung's signals are evaluated; the first rung whose signal matches wins. The order encodes a soft preference for under-spawning vs over-spawning.

#### Rung 1 — solo

Triggers on **any** of:

- **Trivial keywords**: `fix typo`, `typo in`, `rename`, `rename variable`, `update copy`, `update text`, `change wording`, `bump version`, `update readme`, `comment out`, `add comment`, `remove unused`, `format`, `prettify`, `lint fix`
- **Tiny scope phrases**: `one line`, `single line`, `one file`, `just change`, `quick fix`, `tiny`, `trivial`
- **File-count cap**: launch message explicitly names exactly one file path (e.g. `"fix bug in src/utils/format.ts line 42"`)

Example matches:
- `fix typo in welcome message` → solo
- `bump axios from 1.6.0 to 1.7.0` → solo
- `rename variable userId to memberId in src/auth/session.ts` → solo

#### Rung 2 — single-agent

Triggers on **all** of (after rung 1 didn't match):

- **Small-scope keywords**: `add endpoint`, `add /` (path-like), `new component`, `add field`, `add column`, `add validation`, `fix bug`, `fix error`, `add test`, `add migration`
- **Single-side signal**: launch text indicates only BE work (mentions API/endpoint/database/service but no UI/component/page/form) OR only FE work (mentions component/page/form/UI but no endpoint/API/DB). The detector reuses `scripts/detect-stack.sh` keyword tables.
- **No discovery language**: the message does NOT contain `design`, `architecture`, `system`, `flow`, `epic`, `feature`, `refactor`, `migrate to`, `replace with`, `rewrite`

Example matches:
- `add /healthcheck endpoint that returns 200 OK` → single-agent (BE)
- `add a Cancel button to the order details page` → single-agent (FE)
- `add an idempotency_key column to the payments table` → single-agent (BE)

#### Rung 3 — team

Default. Triggers on **any** of (after rungs 1 and 2 didn't match):

- **Multi-side signal**: both BE keywords and FE keywords present
- **Discovery language**: `design`, `architecture`, `system`, `flow`, `feature`, `epic`, `refactor`, `migrate`, `replace`, `rewrite`, `redesign`, `overhaul`
- **Multiple verbs**: more than one main verb in the launch message (`add X and update Y`, `replace A then wire up B`)
- **Length**: launch message > 200 characters (proxy for actual complexity)
- **Explicit team request**: launch contains `team`, `agents`, `full feature`

Example matches:
- `add login page with email and password, hook up to /auth/login endpoint, redirect on success` → team
- `refactor the payments module to use the new gateway interface` → team
- `migrate user notifications from email-only to email + push, with preference UI` → team

If rung 3 fires, the lead then picks a team size:

| Signal | Size |
|---|---|
| `CLAUDE.md`'s `security.domain` is `payments` or `healthcare` | `full` |
| Launch text mentions `compliance`, `audit`, `regulatory`, `pii`, `pci`, `gdpr`, `hipaa` | `full` |
| Launch text mentions `prototype`, `spike`, `internal-only`, `experiment`, `poc` | `minimal` |
| Default | `standard` |

### 4.4 Owner override flags

`/team-feature` accepts these flags:

- `--mode=<solo|single-agent|team>` — force the mode, skip the ladder
- `--size=<minimal|standard|full>` — force the size (only with `--mode=team`, ignored otherwise)
- `--explain` — show the heuristic decision and stop, do not spawn. Owner can re-run without `--explain` to proceed, or with overrides.

Examples:
- `/team-feature --mode=team --size=full add /healthcheck` — owner forces full team for what would otherwise be single-agent
- `/team-feature --mode=solo update copy in welcome banner` — owner forces solo
- `/team-feature --explain redesign the checkout flow` — see what mode/size the lead would pick

### 4.5 The mode/size record

The lead writes its decision to the checkpoint at the very start, before any phase work:

```yaml
---
slug: <slug>
started: <iso>
superpowers_version: 5.0.7
plugin_version: 3.0.0
claude_code_version: 2.1.32
stack_shape: full-stack | be-only | fe-only
mode: solo | single-agent | team
size: minimal | standard | full   # only if mode=team
mode_reasoning: |
  Rung 2 matched. Single-side signal: BE only (endpoint keyword,
  no UI keywords). No discovery language. Picking single-agent.
overrides_applied: []              # if owner used flags, list them here
---
```

`mode_reasoning` is mandatory and helps debugging when the lead picks an unexpected mode.

### 4.6 Touchpoints by mode

| Mode | Touchpoints | What the owner sees |
|---|---|---|
| **solo** | 2 | 1. Plan-and-diff review (lead presents the proposed change before applying). 2. Finish decision (commit / discard). |
| **single-agent** | 3 | 1. Inline spec sign-off (lead writes a one-paragraph spec, asks "ok to proceed?"). 2. Plan approval (one-task plan, usually 5 lines). 3. Finish decision. |
| **team** | 3 | Standard v2 flow: design / plan / finish. |

Note: solo has 2 touchpoints, not 3. The plan and spec are fused — there's nothing meaningful to design or plan for a typo fix.

## 5. Dependency-grouped parallel waves

### 5.1 The plan format change

The planner currently emits a flat list of `impl:be-*` and `impl:fe-*` tasks. v3 extends this: every `impl:` task now carries a `depends_on:` list, and the plan emits a derived `waves:` schedule.

Plan structure (v3):

```yaml
---
slug: add-user-preferences
plan_version: 3
shape: full-stack
total_tasks: 8
---

# Plan: add-user-preferences

## Tasks

### impl:be-add-preferences-table
**Files:** db/migrations/2026-05-12-add-preferences-table.sql
**Depends on:** []
**Verification:** dotnet ef database update; verify table exists
**Estimated minutes:** 3

[task body...]

### impl:be-preferences-repository
**Files:** src/Data/Repositories/PreferencesRepository.cs
**Depends on:** [impl:be-add-preferences-table]
**Verification:** dotnet test --filter PreferencesRepositoryTests
**Estimated minutes:** 5

[task body...]

### impl:be-preferences-api
**Files:** src/Controllers/PreferencesController.cs
**Depends on:** [impl:be-preferences-repository]
**Verification:** dotnet test --filter PreferencesControllerTests
**Estimated minutes:** 5

[task body...]

### impl:be-contract-publish-add-user-preferences
**Files:** contracts/openapi.yaml
**Depends on:** [impl:be-preferences-api]
**Verification:** swagger-cli validate
**Estimated minutes:** 2

[task body...]

### impl:fe-preferences-form
**Files:** src/components/Preferences/PreferencesForm.tsx
**Depends on:** [impl:be-contract-publish-add-user-preferences]
**Verification:** pnpm test PreferencesForm
**Estimated minutes:** 5

[task body...]

### impl:fe-preferences-page
**Files:** src/pages/SettingsPreferences.tsx
**Depends on:** [impl:fe-preferences-form]
**Verification:** pnpm test SettingsPreferences
**Estimated minutes:** 4

[task body...]

### impl:be-add-audit-log-entries
**Files:** src/Audit/PreferenceChangeAuditor.cs
**Depends on:** [impl:be-preferences-repository]
**Verification:** dotnet test --filter PreferenceAuditTests
**Estimated minutes:** 4

[task body...]

### impl:fe-add-changelog-entry
**Files:** CHANGELOG.md
**Depends on:** []
**Verification:** manual visual check
**Estimated minutes:** 1

[task body...]

## Waves

### Wave 1 (parallel)
- impl:be-add-preferences-table
- impl:fe-add-changelog-entry

### Wave 2 (parallel)
- impl:be-preferences-repository

### Wave 3 (parallel)
- impl:be-preferences-api
- impl:be-add-audit-log-entries

### Wave 4 (sequential)
- impl:be-contract-publish-add-user-preferences

### Wave 5 (parallel)
- impl:fe-preferences-form

### Wave 6 (parallel)
- impl:fe-preferences-page
```

Every task has a `Files:` field (list of file paths it will touch — used for collision detection) and a `Depends on:` field. The planner derives waves by topological sort: wave N contains all tasks whose dependencies are entirely in waves 1..N-1.

### 5.2 The wave dispatcher (lead behavior in phase 4)

After the plan is approved, the lead:

1. Reads the `Waves` section. For each wave, creates one shared-task-list entry per task with metadata: `wave: N`, `depends_on: [...]`, `files: [...]`, `plan_approved_at: <ts>`.
2. For wave 1: spawn implementer instances per side based on shape and mode/size. Spawn count rules in §5.3.
3. Each spawned implementer self-claims one task from the wave's queue matching its side (BE implementer claims `impl:be-*`, FE implementer claims `impl:fe-*`). If no matching task left, the implementer idles and waits for the wave to complete.
4. When the **entire** wave completes (every task `done`, every implementer idle), the lead advances to wave N+1.
5. Between waves, lead checkpoints: `phase: implementation, wave: N/M, tasks_complete: X/Y`.
6. Repeat until last wave.

### 5.3 Spawn count rules

For each wave, the lead spawns implementers based on:

- Count of `impl:be-*` tasks in this wave → `be_count`
- Count of `impl:fe-*` tasks in this wave → `fe_count`
- Max parallel per side: **2** (hard cap)

Spawn:
- `min(be_count, 2)` backend-developer instances
- `min(fe_count, 2)` frontend-developer instances

Spawned instances persist across waves (don't re-spawn each wave) up to the running max. If wave 1 needs 1 BE and wave 2 needs 2 BE, the lead spawns the second BE between waves. If wave 3 needs only 1 BE, the second BE idles for that wave but stays alive.

Idle implementers between waves do not violate the `TeammateIdle` hook because the hook checks unanswered peer mail, not work activity.

**Why 2 per side and not configurable.** Empirical: 2 is the sweet spot where parallelism gains outweigh coordination overhead. Beyond 2, the lead spends more time juggling task claims than the implementers save. Configurable max is filed as out-of-scope for future v3.x.

### 5.4 Collision detection (hard-fail policy)

Before dispatching a wave, the lead does a collision check:

```
For each pair of tasks (T_i, T_j) in the wave:
  If T_i.files ∩ T_j.files ≠ ∅:
    COLLISION DETECTED
```

Files are compared as **normalized paths** (lowercase, slashes normalized, no leading `./`). Wildcards in `files:` are expanded against the worktree filesystem before comparison.

On collision:

1. Lead halts the wave immediately. Does NOT dispatch any task in the wave.
2. Lead posts to planner's mailbox: `WAVE_COLLISION wave=N tasks=[T_i, T_j] shared_files=[...]`. Includes the specific overlap.
3. Planner re-runs the dependency analysis: must add an edge `T_j depends_on T_i` (or vice versa, planner's call) so they're in different waves. Planner commits the updated plan.
4. Lead reads the updated plan, re-derives waves, re-runs collision check.
5. After 3 failed re-plan attempts on the same wave, the lead escalates to owner with §7 template: this is a planner bug worth surfacing.

This is intentionally strict. Graceful serialization would mask planner bugs and let dependency-graph errors compound. Hard-failing forces the planner to get the graph right.

### 5.5 Wave-completion gating

A wave is complete when:

- Every task in the wave has status `done` in the shared task list
- Every task's `TaskCompleted` hook returned 0 (validates TDD, plan approval, etc.)
- No implementer has unanswered peer mail relevant to this wave

If any task fails (test never goes green, two-stage review rejects, MAX_ITERATIONS — see §6 — exceeded), the wave is halted. The failing task escalates per the four-class clarification routing. Other tasks in the same wave continue if already in-flight, but no new task is claimed until the failure is resolved.

After the failed task resolves: wave resumes from where it stopped, NOT from the start.

### 5.6 Cross-wave dependencies between BE and FE

The contract-publish flow from v2 stays. In v3 it shows up as a dependency edge: every FE task depends on `impl:be-contract-publish-<slug>`, which itself depends on whichever BE tasks define the contract. The wave scheduler enforces this naturally — FE tasks land in a wave after the contract is published.

If the planner forgets the contract-publish dependency, the collision check won't catch it (different files), but FE will get garbage types. Mitigation: the `TaskCompleted` hook for `impl:fe-*` tasks verifies the contract file's git hash matches the most recent `impl:be-contract-publish-*` commit. If not, the FE task is rejected. This was already a v2 hook check; we keep it.

## 6. MAX_ITERATIONS (added for completeness)

Bruniaux's guide recommends this and v2 still didn't have it. Folding into v3 because parallel waves make stuck tasks more expensive (a stuck task blocks wave completion, blocks subsequent waves, blocks the whole feature).

- Every `impl:` task carries an `iteration_count:` field, incremented by the implementer on every RED→GREEN cycle on the same test name.
- After **8** iterations on a single failing test, the implementer halts and posts a §7 escalation with mandatory fields:
  - `what_failed:` — specific failure message from the last attempt
  - `one_change_to_fix:` — the single most likely fix
  - `iteration_count: 8`
  - `class: tactical | cross-role | architectural | owner-only` per the v2 routing
- `task-completed.sh` rejects completion if `iteration_count > 8` without an attached `reflection:` block.
- After escalation resolves, `iteration_count` resets to 0 if the resolution changed the test specification; otherwise it persists.

Default 8. Configurable per project in `CLAUDE.md`:

```yaml
limits:
  max_iterations_per_task: 8
```

## 7. File-by-file changes

### 7.1 `commands/team-feature.md` (modify)

Add to lead's prompt, after preflight and before spawning:

```markdown
## Phase 0.5 — Complexity assessment

After stack detection, before spawning teammates:

1. Read the owner's launch message.
2. If `--mode=` flag present, use it directly. Skip the ladder.
3. Otherwise run the heuristic ladder from spec §4.3:
   a. Check rung 1 (solo): trivial keywords, tiny-scope phrases, single-file paths. If any match → mode=solo.
   b. Check rung 2 (single-agent): small-scope keywords AND single-side signal AND no discovery language. If all match → mode=single-agent.
   c. Otherwise → mode=team. Pick size per §4.3 size signals.
4. Write the decision to checkpoint frontmatter (mode, size, mode_reasoning, overrides_applied).
5. If `--explain` flag, stop here and report the decision.

## Mode-specific execution

- **solo**: Do not spawn any teammates. Lead does the work in its own session.
  Present plan-and-diff to owner; on approval, apply; on confirmation, commit.
  Skip phases 1-6. Run a minimal finish-branch step (no CI gate for solo; the
  change is too small to justify it).
- **single-agent**: Spawn ONE implementer matching shape (backend-developer if
  BE-only signal, frontend-developer if FE-only signal). Skip designer, planner,
  arch, security, QA, reviewer. Write inline spec, get owner sign-off (touchpoint 1).
  Write inline single-task plan, get owner approval (touchpoint 2). Dispatch the
  implementer. On completion, run a minimal review (lead reviews the diff itself
  in 1-shot), then finish-branch (touchpoint 3, with CI gate).
- **team**: Run the full v2 flow with the chosen size. Spawn only the roles for
  that size per §4.2.
```

### 7.2 `commands/team-feature.md` — Phase 4 wave dispatcher (modify)

Replace the existing phase-4 spawn logic with:

```markdown
## Phase 4 — Implementation (wave-based)

After plan approval, parse the plan's `## Waves` section. For each wave N:

1. Collision check: for every pair of tasks in this wave, verify their `Files:` lists are disjoint. If any overlap, halt and request a re-plan from planner. Cap re-plans at 3; escalate after.

2. Create shared-task-list entries for all tasks in this wave with metadata:
   wave: N, depends_on: [...], files: [...], plan_approved_at: <ts>.

3. Determine spawn counts: be_count = min(impl:be-* tasks in this wave, 2);
   fe_count = min(impl:fe-* tasks in this wave, 2). Spawn missing
   implementer instances if the live count is below the target.

4. Implementers self-claim from this wave's queue, matching their side prefix.

5. Wait for wave completion: every task `done`, every TaskCompleted hook returned 0,
   no unanswered wave-relevant peer mail.

6. Checkpoint: `phase: implementation, wave: N/M, tasks_complete: X/Y` at every
   task transition, atomically.

7. Proceed to wave N+1.

If a task fails (test won't go green, two-stage review rejects, iteration_count > 8
with no reflection): halt the wave on that task. Other in-flight tasks continue.
No new task claims until failure resolves. After resolution: resume the wave,
do not restart.

If the lead is approaching a wave boundary and any implementer instance has been
idle for the entire previous wave, the lead may shut down that instance to free
context. The lead spawns fresh implementers in subsequent waves as needed.
```

### 7.3 `agents/planner.md` (modify)

Body additions:

- Every `impl:` task MUST have a `Files:` field (list of file paths or globs) and a `Depends on:` field (list of task IDs in this plan, or `[]`).
- After listing tasks, emit a `## Waves` section. Derive it by topological sort: wave 1 = tasks with no dependencies; wave N = tasks whose dependencies are all in waves 1..N-1.
- Within a wave, list tasks in alphabetical order (deterministic for diff review).
- Each wave can have at most **2 `impl:be-*` and 2 `impl:fe-*` tasks running concurrently**. If a wave has more than 2 of a side, that's fine — the lead serializes them within the wave but they don't need their own wave.
- Before submitting, run a collision check yourself: for every pair of tasks in the same wave, verify their `Files:` are disjoint. If any overlap, you must add a dependency edge between them so they end up in different waves.
- The contract-publish task (full-stack only) must be its own task; all `impl:fe-*` tasks `depends_on` it.
- Migration tasks (`impl:be-migration-*`) must be in their own wave (no other BE work in the same wave). The lead enforces this; you set it up correctly upfront.
- When the lead pings you with `WAVE_COLLISION`, immediately re-derive dependencies for the affected tasks and re-emit the plan. Do not push back; the collision is real.

### 7.4 `agents/backend-developer.md` / `agents/frontend-developer.md` (modify)

Body additions:

- At task claim, read the task's `wave:` metadata. Log it so the lead can track which implementer instance is on which wave's task.
- After RED, GREEN, REFACTOR, before marking complete: increment `iteration_count:`. If you've had to retry the same test 8 times, halt. Post a §7 escalation with the §6 mandatory fields. Do NOT mark the task complete with `iteration_count > 8`.
- If you claim a task and notice another implementer of the same side is also working on a task in the same wave that touches one of your files (collision the planner missed), halt and post `WAVE_COLLISION` to lead. Lead will re-plan.
- Between waves, you may be idle. That's fine. Stay alive; check the shared task list periodically for new claims.

### 7.5 `hooks/task-created.sh` (modify)

- Recognize the same prefixes as v2 plus `impl:be-contract-publish-*` (already in v2).
- For solo-mode features, the task list is empty — the hook should still pass on creation of `meta:` and `review:` tasks but reject `impl:*` (solo means no implementer tasks).
- Read `mode:` from the checkpoint frontmatter (lead writes it in phase 0). If `mode=solo` and an `impl:` task is created, exit 2 with `INVALID_FOR_SOLO_MODE`.

### 7.6 `hooks/task-completed.sh` (modify)

Additional checks:

1. For `impl:` tasks: verify `wave:` metadata is present. Exit 2 `MISSING_WAVE_METADATA` if absent.
2. For `impl:` tasks: verify `iteration_count` ≤ `limits.max_iterations_per_task` from `CLAUDE.md` (default 8) OR an attached `reflection:` block exists. Exit 2 `ITERATION_CAP_EXCEEDED` if neither.
3. For `impl:be-migration-*` tasks: existing v2 check (no other migration task `in_progress`) stays.
4. For `impl:fe-*` tasks: existing v2 check (contract hash matches latest `impl:be-contract-publish-*` commit) stays.

### 7.7 `assets/CLAUDE.md.template` (modify)

Add a `limits` section to the template:

```yaml
limits:
  max_iterations_per_task: 8        # MAX_ITERATIONS guardrail (default 8)
  # max_parallel_implementers: 2    # reserved for future v3.x, currently fixed at 2
```

Add note in the template's commentary: the lead picks mode and size from launch-message heuristics by default. Use `--mode=` and `--size=` flags on `/team-feature` to override per-feature.

### 7.8 `scripts/detect-stack.sh` (modify)

Add new function `detect_side_from_text <launch_message>`: scans the launch message for BE-only / FE-only / mixed signals using the existing keyword tables. Returns `be-only`, `fe-only`, `mixed`, or `none`. Used by the heuristic ladder in §4.3 rung 2.

### 7.9 `scripts/assess-complexity.sh` (new)

Standalone script. Inputs: launch message (positional arg), repo root, parsed CLAUDE.md. Output: a YAML block to stdout:

```yaml
mode: solo | single-agent | team
size: minimal | standard | full         # only when mode=team
shape: full-stack | be-only | fe-only
mode_reasoning: |
  <human-readable trace of which rung matched and why>
```

Exit codes:
- 0: confident decision
- 1: ambiguous (mode could be single-agent or team; defaults to team and notes ambiguity in reasoning)

Called by `commands/team-feature.md` lead prompt in phase 0.5. Owner-supplied flags override.

### 7.10 `agents/designer.md`, `qa-engineer.md`, `software-architect.md`, `security-engineer.md`, `reviewer.md` (modify frontmatter + body)

Each file gets its `model:` pin updated per §11.1, and a one-line directive added to the body to set effort on first turn:

- `agents/designer.md`: `model: opus` in frontmatter; body adds: *"At the start of your first turn, run `/effort high` to set reasoning effort. Report `effort_set: high` in your first checkpoint message."*
- `agents/software-architect.md`: `model: opus`; same directive (`high`).
- `agents/security-engineer.md`: `model: opus`; same directive (`high`).
- `agents/reviewer.md`: `model: opus`; same directive (`high`).
- `agents/qa-engineer.md`: `model: sonnet`; same directive (`high`).

The internal behavior of these roles is otherwise unchanged from v2.

### 7.11 `agents/planner.md`, `agents/backend-developer.md`, `agents/frontend-developer.md` (frontmatter update)

In addition to the §7.3 and §7.4 body changes already specified for v3, these files also update their `model:` pin and add the effort-setting directive:

- `agents/planner.md`: `model: sonnet`; body adds: *"At the start of your first turn, run `/effort high`. Report `effort_set: high` in your first checkpoint message."*
- `agents/backend-developer.md`: `model: sonnet`; body adds: *"At the start of your first turn (each new task you claim), run `/effort medium`. Report `effort_set: medium` in your task-start log entry."*
- `agents/frontend-developer.md`: `model: sonnet`; same directive (`medium`).

The backend and frontend implementer directives fire per-task because each task is a fresh subagent dispatched by subagent-driven-development.

### 7.12 `README.md` (modify)

Add a `## v3 — autonomous sizing + parallel waves + per-role models` section explaining:
- Lead picks mode (solo/single-agent/team) and size (minimal/standard/full) from heuristics; owner can override with `--mode` and `--size` flags.
- Phase 4 runs in dependency-grouped waves; up to 2 BE + 2 FE implementers concurrent per wave; planner-emitted dependency graph drives the schedule.
- Three-touchpoint promise preserved for all modes (solo is actually 2).
- Per-role model configuration: Opus 4.7 for orchestration / design / architecture / security / review; Sonnet 4.6 for planning / implementation / QA. Effort levels per §11.
- Required environment variables for production teams (`ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`).

### 7.13 `assets/SESSION_README.md` (modify)

Document:
- Mode determination: how to read `mode_reasoning` in the checkpoint, when to use `--explain`, when to override.
- Wave schedule: how to read the plan's `## Waves` section, what `Files:` and `Depends on:` mean, what happens on collision.
- Iteration cap: what to do when escalation says `iteration_count: 8 exceeded`.
- Model fallback: what the `effort_set:` and `model_actual:` heartbeat fields mean, and what to do if a teammate reports a model different from its pin.

### 7.14 `commands/team-feature.md` — preflight model attestation (modify)

In the existing v2 preflight section, after the lead self-attests its own model is Opus, add:

- When spawning each teammate, capture the teammate's first heartbeat message and parse the `model_actual:` and `effort_set:` self-report fields.
- If `model_actual` differs from the teammate's frontmatter `model:` pin, log to checkpoint and surface a one-question touchpoint to owner: *"Teammate `<role>` is running `<actual>` instead of pinned `<expected>` (likely a usage-threshold fallback). Continue or abort?"*
- If `effort_set` is missing or differs from the recommended level in §11.1, log a warning to the checkpoint but do not surface to owner — soft enforcement only.

## 8. Implementation order

Strict order. Each step depends on the previous.

1. **MAX_ITERATIONS hook addition** — simplest change, lowest risk. Modify `task-completed.sh` to check `iteration_count` per §7.6 item 2. Update `backend-developer.md` and `frontend-developer.md` to increment and halt. Test with a fixture that intentionally fails the same test 9 times.
2. **Complexity assessment script** — write `scripts/assess-complexity.sh` per §7.9. Unit-test against ~15 launch messages covering all three rungs and edge cases (trivial, single-side, multi-side, discovery-language, regulated-domain).
3. **Mode dispatch in lead** — modify `commands/team-feature.md` per §7.1. Add the three mode-specific execution paths. Test by running `/team-feature fix typo in welcome.md` (expect solo), `/team-feature add /healthcheck endpoint` (expect single-agent on BE-only fixture), `/team-feature add login page with backend` (expect team).
4. **Override flags** — wire `--mode`, `--size`, `--explain` into the slash command argument parsing. Test each override on each fixture.
5. **Plan format upgrade** — modify `planner.md` per §7.3 to emit `Files:`, `Depends on:`, `## Waves`. Run on a known plan and inspect the structure manually. Verify the topological sort puts tasks in the right waves.
6. **Hook updates for waves** — modify `task-created.sh` and `task-completed.sh` per §7.5–7.6 to recognize wave metadata, enforce solo-mode constraints, verify wave presence.
7. **Wave dispatcher in lead** — modify `commands/team-feature.md` phase 4 per §7.2. Run a full-stack feature with intentionally parallelizable tasks; verify the lead spawns 2 BE instances in wave 1 if 2 BE tasks are present.
8. **Collision detection + hard-fail re-plan loop** — implement the collision check in §5.4. Inject a deliberately bad plan (two BE tasks in wave 1 touching the same file) and verify the lead halts, pings planner, planner re-plans, lead retries. Cap at 3 re-plans; verify escalation fires on the 4th.
9. **Implementer instance lifecycle across waves** — verify implementers persist between waves, idle gracefully, get new claims in subsequent waves. Verify the `TeammateIdle` hook does not fire on between-wave idle.
10. **Model and effort configuration** — update every agent file in `agents/` per §7.10 and §7.11: set the `model:` pin in frontmatter (Opus for designer/architect/security/reviewer; Sonnet for planner/BE/FE/QA), add the `/effort` first-turn directive, add the `effort_set` and `model_actual` heartbeat fields. Update `commands/team-feature.md` preflight per §7.14 to attest teammate models on spawn. Document required env vars (`ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`). Smoke test: spawn a teammate, capture its heartbeat, verify the model attestation field is present and correct.
11. **Docs + template updates** — `README.md`, `SESSION_README.md`, `CLAUDE.md.template` per §7.12, §7.13, §7.7. Include the model-config section in README per §7.12.
12. **End-to-end smoke tests**:
    - Solo: `/team-feature fix typo in error message` → 2 touchpoints, no team, single commit.
    - Single-agent BE-only: `/team-feature add /healthcheck` on a BE-only fixture → 3 touchpoints, one implementer (Sonnet), no gates, finish-branch with CI gate.
    - Team standard full-stack: `/team-feature add user preferences with toggle UI` → 3 touchpoints, 6 teammates, multi-wave plan, parallel BE+FE in at least one wave. Verify model attribution in Anthropic usage dashboard matches §11.3 matrix (~3 Opus sessions, ~5-7 Sonnet sessions).
    - Team full payments-domain: `/team-feature add idempotency key to payment endpoints` with `security.domain: payments` in CLAUDE.md → 8 teammates, full gate phases, all phases complete. Verify architect and security-engineer ran on Opus.
    - Override: `/team-feature --mode=team --size=minimal trivial-looking change` → 5 teammates spawned despite trivial heuristic match.
    - Model fallback simulation: artificially induce a fallback (or mock it) and verify the lead surfaces the one-question touchpoint about a mismatched `model_actual`.

## 9. Acceptance criteria

- [ ] `scripts/assess-complexity.sh` returns the correct mode for each of ~15 test launch messages with rationales in `mode_reasoning`.
- [ ] `/team-feature --explain <anything>` prints the heuristic decision and does not spawn.
- [ ] Solo mode handles a typo fix in 2 touchpoints, end-to-end, no team spawn.
- [ ] Single-agent mode handles a single endpoint addition in 3 touchpoints, with exactly one implementer spawned.
- [ ] Team mode runs the full v2 flow at the size the heuristic picked.
- [ ] `--mode` and `--size` flags override the heuristic and are logged in `overrides_applied:`.
- [ ] Plan format includes `Files:`, `Depends on:`, and a `## Waves` section. Topological order is correct.
- [ ] In a wave with 2 BE tasks touching disjoint files, the lead spawns 2 backend-developer instances and they work concurrently.
- [ ] In a wave with 2 BE tasks touching the same file, the wave halts; planner is pinged with `WAVE_COLLISION`; planner re-plans; lead retries; collision resolves.
- [ ] After 3 failed re-plans on the same wave, an owner escalation fires per the §7 template.
- [ ] FE tasks never start before their `impl:be-contract-publish-*` dependency completes, verified by both the wave scheduler and the contract-hash hook.
- [ ] An implementer that retries the same test 8 times posts an escalation with `what_failed:` and `one_change_to_fix:`; `task-completed.sh` rejects completion without these.
- [ ] Implementer instances persist idle across waves without firing `TeammateIdle`.
- [ ] Three-touchpoint promise holds for team mode regardless of wave count.
- [ ] Checkpoint contains `mode`, `size`, `mode_reasoning`, `overrides_applied` at session start, updated with `wave: N/M` during phase 4.
- [ ] Every agent file in `agents/` has an explicit `model:` pin in frontmatter (no inheritance). Designer, software-architect, security-engineer, reviewer are pinned to `opus`. Planner, backend-developer, frontend-developer, qa-engineer are pinned to `sonnet`.
- [ ] Every agent body contains a `/effort` first-turn directive matching §11.1 (designer/architect/security/reviewer/planner/qa = `high`; backend/frontend = `medium`).
- [ ] Teammate first heartbeat reports `model_actual:` and `effort_set:` fields. Lead captures these and logs to checkpoint.
- [ ] Mismatch between `model_actual` and frontmatter pin surfaces a single owner touchpoint (not counted against the 3-touchpoint budget).
- [ ] Anthropic usage dashboard after a `team-standard` dry-run feature shows approximately 3 Opus sessions and 5-7 Sonnet sessions per §11.3.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Heuristic picks wrong mode and owner doesn't notice until midway | `mode_reasoning` in checkpoint is visible; `--explain` lets owner preview; override flags exist. Tradeoff: zero touchpoint cost vs occasional miscalibration. |
| Solo mode skips quality gates entirely (no test, no review) | Solo is intentionally for changes too small to merit gates. The plan-and-diff touchpoint is the gate. If owner finds solo undershooting, they can re-run with `--mode=single-agent` or `--mode=team`. |
| Single-agent mode produces low-quality output (no architect, no security review) | Single-agent is for low-stakes work where over-process is the bigger risk. Regulated-domain CLAUDE.md (`security.domain: payments`) forces `team/full` even when launch text looks small. |
| Planner under-specifies `Files:` and a hidden collision slips through | Two backstops: (a) collision check at wave dispatch catches declared overlaps; (b) implementers detect undeclared overlaps mid-task and post `WAVE_COLLISION` to lead. |
| Hard-fail re-plan loop never converges (planner can't fix the graph) | Cap at 3 re-plans then owner escalation. Escalation surfaces the specific tasks that keep colliding so owner can spot the structural issue. |
| 2-parallel cap is wrong for some projects (too low for large refactors, too high for small repos) | Filed as out-of-scope. Bruniaux's data suggests 2 is right for most teams; bumping to 3+ adds coordination overhead faster than parallelism gains. Revisit after real-world usage data. |
| Implementers go stale between waves (token consumption, context drift) | Lead shuts down implementers that idle for a full wave; spawns fresh in subsequent waves. Implementers carry no cross-task state — every task is independent. |
| Iteration cap of 8 is wrong for some test environments (flaky tests, slow integration) | Configurable per project in `CLAUDE.md`'s `limits.max_iterations_per_task`. Default 8 per Bruniaux's recommendation. |
| Anthropic ships a new model and silently changes alias resolution mid-feature | Pin both `ANTHROPIC_DEFAULT_OPUS_MODEL` and `ANTHROPIC_DEFAULT_SONNET_MODEL` to specific version IDs in shell profile per §11.4. Agent files use aliases so version bumps are intentional. |
| Usage-threshold fallback drops a teammate from Opus to Sonnet mid-feature | Teammate first heartbeat reports `model_actual:`. Lead surfaces a single touchpoint on mismatch (not counted in 3-touchpoint budget). Owner decides continue/abort. |
| Teammate ignores `/effort` directive and runs at session-inherited level | Each teammate self-reports `effort_set:` in first heartbeat. Lead logs mismatches to checkpoint as warnings (informational). Soft enforcement only — escalating would add a touchpoint for marginal quality gain. |
| Owner forgets to set `/effort xhigh` on lead session before launching | Lead's preflight checks its own effort and warns once: *"Effort is `<current>`. Recommended for orchestration: `xhigh`. Set with `/effort xhigh` and re-run, or continue with current."* Not a hard block. |
| Solo mode is abused for what should be reviewed | The plan-and-diff touchpoint shows the full proposed change; if the owner skims it they're choosing to skip review. That's a process problem, not a tool problem. |

## 11. Model and effort configuration

Each role gets an explicit model pin in its agent definition's frontmatter. Effort is set per-session by the owner (lead session) and inherited by teammates at spawn, with optional in-prompt overrides for specific teammate sessions.

### 11.1 Recommended model and effort per role

| Role | Model | Effort | Why |
|---|---|---|---|
| **Lead** (conductor, not an agent file — set per owner session) | `claude-opus-4-7` | `xhigh` | Long-horizon orchestration across 6+ phases, wave dispatch, escalation synthesis, instruction-following on a 200+ line system prompt. The single role where Opus 4.7's agentic-coding and strict-instruction gains pay off most. |
| **Designer** | `claude-opus-4-7` | `high` | Brainstorming requires probing for missing constraints and generating 2-3 genuinely different approaches with sharp trade-offs. Sonnet drafts merge approaches into mush; Opus produces sharper alternatives. One session per feature — high leverage, low recurring cost. |
| **Software-architect** | `claude-opus-4-7` | `high` | ADR-grade reasoning, cross-cutting decisions, contract design. Output cascades to every implementer downstream. Spawned only in `team-full` size, so cost is contained. |
| **Security-engineer** | `claude-opus-4-7` | `high` | Threat modeling needs to find what isn't there. Sonnet tends to enumerate generic OWASP items; Opus catches domain-specific risks (idempotency on payment endpoints, audit-trail gaps, PII flow leaks). Wrong role to under-spec for regulated domains. Spawned only in `team-full`. |
| **Planner** | `claude-sonnet-4-6` | `high` | Plan format is structured — fill in `Files:`, `Depends on:`, decompose to 2-5 minute tasks, derive waves. Mechanical once the design is good. Sonnet 4.6 excels here at 40% the cost of Opus. |
| **Backend-developer** (×1-2 per wave) | `claude-sonnet-4-6` | `medium` | Sonnet 4.6 is at 79.6% SWE-bench — within 1.2 points of Opus 4.6 — at 40% the cost. With up to 2 instances running in parallel, savings compound. `medium` effort is right for RED-GREEN-REFACTOR on well-specified tasks; `high` adds latency without measurably better code. |
| **Frontend-developer** (×1-2 per wave) | `claude-sonnet-4-6` | `medium` | Same reasoning. Component work is well within Sonnet's range. |
| **QA-engineer** | `claude-sonnet-4-6` | `high` | Reads diffs, validates against acceptance criteria, identifies gaps. Read-heavy work where Sonnet is consensus-best. `high` because gap-finding rewards deeper analysis than pure code-writing. |
| **Reviewer** | `claude-opus-4-7` | `high` | Last gate before merge. False negatives cost more than the model premium. Cross-agent consistency check + CI gate decisions + merge-failure menu navigation all benefit from Opus's instruction-following. |

**Rule of thumb:** Opus for *generative* and *gating* roles (designer, architect, security, reviewer) and for orchestration (lead). Sonnet for *transformational* roles where the design is settled and the work is structured (planner, BE/FE, QA).

**Order-of-magnitude per feature cost** (typical full-stack `team-standard` size):
- 3 Opus sessions: lead + designer + reviewer
- 5-7 Sonnet sessions: planner + 1-2 BE + 1-2 FE + QA
- Range: ~$8-15 per feature on the standard pricing tier, versus ~$25-40 if everyone ran Opus.

### 11.2 Effort levels

Effort is a session-level command (`/effort low | medium | high | xhigh`), not a frontmatter field. Each Claude Code session sets its own effort. The propagation pattern is:

- **Lead session**: owner sets `/effort xhigh` before running `/team-feature`. The lead inherits this for its orchestration work.
- **Teammates at spawn**: inherit the lead's effort at spawn time. Each teammate then optionally overrides via `/effort` in its own first message.
- **Per-teammate override directive**: each agent body includes a directive: *"At the start of your first turn, run `/effort <level>` to set your reasoning effort to the recommended level for your role."* — with `<level>` from the table above. The teammate sets its own effort; subsequent turns inherit.

This is a soft enforcement — a misbehaving teammate could skip the `/effort` call. Mitigation: each teammate's first checkpoint message includes its current effort level as a self-report field (`effort_set: high`). The lead can grep for missing or incorrect effort attestations and ping the teammate to correct.

### 11.3 Mode-specific model assignment

The mode/size decision from §4 maps to a model-spawn matrix:

| Mode + Size | Lead | Designer | Architect | Security | Planner | BE/FE | QA | Reviewer |
|---|---|---|---|---|---|---|---|---|
| **solo** | Opus 4.7 / xhigh | — | — | — | — | — | — | — |
| **single-agent** | Opus 4.7 / xhigh | — | — | — | (inline) | Sonnet 4.6 / medium | — | — |
| **team-minimal** | Opus 4.7 / xhigh | Opus 4.7 / high | — | — | Sonnet 4.6 / high | Sonnet 4.6 / medium | — | Opus 4.7 / high |
| **team-standard** | Opus 4.7 / xhigh | Opus 4.7 / high | — | — | Sonnet 4.6 / high | Sonnet 4.6 / medium | Sonnet 4.6 / high | Opus 4.7 / high |
| **team-full** | Opus 4.7 / xhigh | Opus 4.7 / high | Opus 4.7 / high | Opus 4.7 / high | Sonnet 4.6 / high | Sonnet 4.6 / medium | Sonnet 4.6 / high | Opus 4.7 / high |

Solo mode is the lead doing the work directly — no model switch needed.

### 11.4 Pinning vs aliases

For TranSwap and any team running this in production, **pin specific model versions** in environment variables to prevent silent upgrades:

```bash
# In .envrc, ~/.zshrc, or shell profile
export ANTHROPIC_DEFAULT_OPUS_MODEL="claude-opus-4-7"
export ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-4-6"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="claude-haiku-4-5-20251001"
```

Agent definition files use the aliases (`model: opus` / `model: sonnet`) so they remain version-agnostic. The pinning happens at the env-var layer for team consistency.

Alternatively, pin in the agent file itself with the full ID:

```yaml
model: claude-sonnet-4-6
```

This is more explicit but requires updating each agent file when the team intentionally moves to a new model version. Choose one approach and stick to it — mixing pin styles across files is a debugging trap.

### 11.5 Cost-saving variants

If budget pressure forces tighter optimization, levers in priority order:

1. **Drop reviewer to Sonnet 4.6 / high.** Saves ~$2-3 per feature. Acceptable when there's human PR review downstream. Not recommended for un-reviewed merges or regulated-domain features.

2. **Drop architect to Sonnet 4.6 / high for non-regulated domains** (when `CLAUDE.md`'s `security.domain` is not `payments | healthcare`). Architect is only spawned in `team-full`; this trims that mode's cost when the full team was spawned for size reasons rather than regulation.

3. **Use Haiku 4.5 for any future classification or routing sidekick** (not a current role). At 73.3% SWE-bench and 5x cheaper than Opus, Haiku handles file-reads, prefix-routing, and quick metadata extraction well.

**Levers NOT to pull:**

- **Do not drop designer to Sonnet.** Bad design produces bad plans which produce bad code. The cost saving (~$1 per feature) is dwarfed by the rework cost of a weak spec.
- **Do not drop security-engineer to Sonnet** in regulated domains. Missing a domain-specific risk in a payments feature can ship a real bug.
- **Do not drop the lead to Sonnet.** The lead does long-horizon orchestration with a heavy system prompt — Opus's instruction-following matters disproportionately here, and there is only one lead session per feature.

### 11.6 Sanity checks

Two self-attestations the plugin should enforce:

1. **Preflight (existing v2 behavior):** lead verifies its own model is Opus 4.7 (or 4.6 fallback) before spawning teammates. If lead is on Sonnet, halt and tell the owner to switch with `/model opus` before re-running.

2. **Teammate spawn (new in v3):** when the lead spawns each teammate, it captures the teammate's reported model in the first checkpoint heartbeat. If a teammate reports a different model than its frontmatter pins (rare — usually means a fallback fired because of usage thresholds), the lead logs a warning to the checkpoint and pings the owner once: *"Teammate `<role>` is running `<actual-model>` instead of the pinned `<expected-model>`. Continue or abort?"*

This is a recovery touchpoint, not counted against the 3-touchpoint budget — it only fires on model fallback.

## 12. Out-of-scope (future work)

- Configurable max parallel implementers (>2). Currently hard-coded.
- Per-implementer worktrees. Wave-based serialization is the v3 collision strategy.
- Speculative parallelism (running tasks before all dependencies confirmed). Strict waves only.
- Cross-feature parallelism (multiple `/team-feature` invocations running simultaneously). Single feature per session.
- Auto-discovery of task dependencies from code analysis (currently the planner declares them manually).
- Re-running heuristic mid-feature if scope creeps. Mode is fixed at phase 0.
- Mode/size telemetry (which heuristic rungs hit how often, where overrides happen). Useful for tuning but not load-bearing.

---

**End of v3 amendment.** v1 and v2 features remain. Implementer treats §7 as the change list, §8 as the order, §9 as the test plan. Hand to Claude Code with: *"Implement this v3 amendment on top of the existing v2 plugin at plugins/team-superpower/. Follow §8 order. Test against §9."*
