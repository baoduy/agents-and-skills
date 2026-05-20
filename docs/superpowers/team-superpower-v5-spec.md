# Spec: team-superpower v5 (Agent-Teams-native)

> **DEPRECATED (2026-05-20).** Superseded by the v6 single-session lifecycle, which collapses the `orchestrator` teammate into the `/team-feature` main session. See `docs/superpowers/specs/2026-05-20-team-superpower-v6-collapse-orchestrator-design.md` for current behaviour. Historical reference only — do not implement against this document.


**Owner:** Steven
**Date:** 2026-05-12 (amended 2026-05-20 for Claude Code Agent Teams platform fit)
**Status:** Ready for implementation
**Target:** [baoduy/agents-and-skills `plugins/team-superpower`](https://github.com/baoduy/agents-and-skills/tree/dev/plugins/team-superpower)
**Builds on:** v4 (per-task QA loop, token budgets, retrieval budgets, AGENTS.md)
**Platform:** [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) — native team primitives (TeamCreate, SendMessage, shared task list, TeammateIdle / TaskCreated / TaskCompleted hooks)

---

## 1. What v5 changes (vs v4)

Four shifts:

1. **One team, role-swapped by phase.** Platform constraint "one team at a time, no nested teams" means the prior three-team draft is not buildable. v5 uses a single Agent Teams team across the whole feature lifetime. Membership changes by spawn + native shutdown as phases advance. Concurrent teammates stay at 3–6 (within docs' recommended size).

2. **Orchestrator is the only spawner.** The lead session that creates the team is the sole spawner for its lifetime (platform: "Lead is fixed", "Only the lead can manage the team"). The `team-leader` role is a coordinating **teammate**, not a sub-orchestrator. When implementers are needed for a wave, team-leader sends a `SPAWN_REQUEST` to the lead; lead spawns. This is the single biggest deviation from v4's "lead does everything" pattern.

3. **Phase-end principle enforcement by team-leader.** A coordinating teammate that runs one consolidated SOLID / DRY / domain-architecture review at the **end of each plan-phase** (not per-task). Cheap, batched, late-feedback.

4. **End-of-plan QC, no per-task QA.** v4's per-task QA loop is removed. Implementers commit after self-enforced static checks + two-stage review. A single `qc-engineer` teammate runs once at the end.

**Restart-on-stuck:** if mid-implementation the team needs re-planning, re-architecting, or hits an architecturally-significant question that requires planner judgment, the team **restarts the full cycle from phase A** (re-spawn architect + planner, re-do spec/plan deltas). This replaces the discarded "architect standby" mechanism — simpler, no idle Opus session, owner sees a single recovery touchpoint.

Capabilities preserved from v4: token budgets per implementer task, iterative retrieval budgets, AGENTS.md for compound learning. Unchanged.

## 2. Why these shifts

**Why one team?** Two reasons. (a) Platform: lead can only manage one team at a time. (b) Coordination cost: spinning up/down separate teams per phase doubles cleanup overhead and breaks the shared task list (each TeamCreate creates a new task store at `~/.claude/tasks/{slug}/`). Single team with role-swap is both compliant and cheaper.

**Why orchestrator-as-sole-spawner?** Platform forbids nested teams. team-leader cannot spawn. But team-leader still owns wave composition and phase-end review — that's the coordination thinking. Splitting "decide what to spawn" (leader) from "execute the spawn" (orchestrator) costs one extra IPC round-trip per wave (cheap, local) and stays within platform rules.

**Why phase-end leader review?** v4's per-task QA was a serialization gate; the wave dispatch parallelism was wasted at verification. Moving SOLID/DRY enforcement to phase boundaries lets implementers commit freely during a phase; team-leader runs one batch review at phase end. Issues found later, but bulk-amortized.

**Why end-of-plan QC?** By the time QC runs, team-leader has already enforced principles per-phase, static checks run per-commit (hook-enforced), and two-stage review caught the obvious mistakes. What's left for QC: acceptance-criteria walkthrough, integration probe, cross-implementer consistency — all things that need a whole-plan view, not a per-task one.

**Why restart-on-stuck instead of architect standby?** Standby was an attempt to make mid-implementation re-planning cheap. But (a) it doesn't fit the platform (architect would have to be an idle teammate, never claiming work — manageable but adds hook complexity); (b) restart is conceptually cleaner — when a feature needs re-architecting mid-flight, it usually needs a re-thought spec too. A fresh phase-A cycle with the prior spec and partial implementation as input is the honest path. Cost: one recovery touchpoint to the owner before restart.

**What this costs.** Per-task lint/format/typecheck failures surface late, at commit time (caught by `TaskCompleted` hook). Architecturally-significant questions mid-implementation trigger a cycle restart, which is more expensive than the discarded standby ARCH_QUESTION mechanism — but those questions should be rare if phase-A architecture map is good. The dedicated per-task QA agent is gone.

## 3. The new architecture

```
                            👤 Owner
                              │
                              ▼
                  ┌────────────────────────┐
                  │      ORCHESTRATOR        │
                  │   (lead = team creator,  │
                  │    sole spawner /        │
                  │    cleanup authority)    │
                  │     Opus 4.7 / xhigh     │
                  └────────────┬─────────────┘
                               │
                               ▼
                   ╔═══════════════════════════╗
                   ║   ONE TEAM (whole feature)║
                   ║   ~/.claude/teams/<slug>/  ║
                   ╠═══════════════════════════╣
                   ║ Phase A members:           ║
                   ║   solution-architect       ║
                   ║   feature-planner          ║
                   ║   [security-engineer]?     ║
                   ╟───────────────────────────╢
                   ║ Phase B–F members:         ║
                   ║   team-leader              ║
                   ║   backend-developer × N    ║
                   ║   frontend-developer × N   ║
                   ╟───────────────────────────╢
                   ║ Phase G members:           ║
                   ║   qc-engineer              ║
                   ╚═══════════════════════════╝
```

Lead is the orchestrator session for the whole feature. Membership turns over by native spawn + shutdown between phases. No "second team" is ever created.

### 3.1 Single-team lifecycle

| t | Action | Team membership after |
|---|---|---|
| 0 | Lead invokes TeamCreate(`<slug>`). Spawns `solution-architect` + `feature-planner` (+ `security-engineer` if regulated). | architect, planner, [security] |
| 1 | Phase A done (spec + arch-map + plan + handover artifact). Lead shuts down planner. Lead shuts down architect. Lead shuts down security-engineer. | (empty) |
| 2 | Phase B start. Lead spawns team-leader. | team-leader |
| 3 | team-leader posts SPAWN_REQUEST. Lead spawns implementers per wave. | team-leader, impl × N |
| 4 | Each plan-phase end: team-leader runs phase-end review (rework dispatched as new tasks in same team). On `PHASE_COMPLETE` for last phase, team-leader shuts down all implementers, then itself. | (empty) |
| 5 | Phase G start. Lead spawns qc-engineer. | qc-engineer |
| 6 | QC_PASS. Lead shuts down qc-engineer. Lead runs cleanup (removes `~/.claude/teams/<slug>/`). | — |
| 7 | Phase H finish: push + notify owner. | — |

**On stuck (any phase):** team-leader (or qc-engineer) posts `RESTART_REQUEST <reason>` to lead. Lead presents recovery touchpoint to owner: "Cycle restart needed: <reason>. Approve?". On approval: lead shuts down all current teammates, re-spawns architect + planner, hands them the prior spec + arch-map + plan + partial commits as input. Phase A re-runs with delta scope; new handover artifact supersedes prior. Phase B re-enters from scratch (already-committed code is treated as starting state, not redone). Max 2 restarts per feature; 3rd → escalate to owner with "manual intervention required".

### 3.2 Orchestrator (lead) responsibilities

**Does:**
- Picks mode (solo / single-agent / team) from launch text (v3 heuristic ladder, unchanged).
- For team mode: TeamCreate, spawns phase-A members, awaits handover, manages phase transitions by spawn + shutdown.
- Responds to `SPAWN_REQUEST` from team-leader by spawning the requested implementers.
- Responds to `RESTART_REQUEST` by presenting recovery touchpoint and re-running phase A on approval.
- Final cleanup + push + notification.

**Does not:**
- Run any phase work itself (in team mode).
- Compose spawn briefs — team-leader composes; lead executes.
- Verify code quality (defers to team-leader phase-end review + qc-engineer).

### 3.3 Team-leader (teammate) responsibilities

| Responsibility | When |
|---|---|
| Read handover artifact (spec + arch-map + plan) on first turn | Phase B start |
| For each plan-phase: read its wave list, compose spawn brief per wave, write to `.team-superpower/spawn-briefs/wave-<id>.md`, post `SPAWN_REQUEST` to lead | Per wave |
| Monitor task progress via shared task list (`~/.claude/tasks/<slug>/`) | During waves |
| Route in-team escalations: tactical → answer; cross-role → SendMessage between implementers; architecturally significant → post `RESTART_REQUEST` to lead | During waves |
| Phase-end SOLID / DRY / domain review against arch-map; create `impl:rework-*` tasks for violations | After last wave of each plan-phase |
| Post `PHASE_COMPLETE <N>` to lead after rework completes | Per plan-phase |
| Post `PLAN_COMPLETE` to lead after final plan-phase | Once |
| On final completion: shut down all implementers, then ask lead for own shutdown | End of phase F |

**Does NOT:** spawn teammates (platform forbids); run TDD work; rewrite the plan.

### 3.4 SPAWN_REQUEST protocol (new in v5)

The native solution to "team-leader needs implementers, but cannot spawn".

**Composition (team-leader side):**

1. team-leader reads next wave from current plan-phase.
2. For each task in wave: compose a self-contained task brief (task-id, Files:, Depends on:, token budget, retrieval budget, plain-language goal, verification step).
3. Write briefs to `.team-superpower/spawn-briefs/wave-<plan-phase>.<wave>.md` (one file per wave; all task briefs inside).
4. Compose a SPAWN_REQUEST message:

```
SPAWN_REQUEST wave=<plan-phase>.<wave>
roles_needed:
  backend-developer: <count>
  frontend-developer: <count>
brief_path: .team-superpower/spawn-briefs/wave-<plan-phase>.<wave>.md
expected_tasks: [<task-id-1>, <task-id-2>, ...]
```

5. SendMessage to lead.

**Execution (lead side):**

1. Lead receives SPAWN_REQUEST.
2. Lead reads the brief file.
3. Lead creates one task per `expected_tasks` in the shared task list (using TaskCreate). Task body includes the per-task brief excerpted from the brief file. `TaskCreated` hook validates prefix grammar + wave-id reference.
4. Lead spawns `count` instances of each role. Each implementer's spawn prompt is short — just "you are a `<role>` on team `<slug>`; read the next unclaimed task in the shared task list and follow its brief; on completion run lint/format/typecheck, commit, then claim the next unclaimed task or shut down if none".
5. Lead replies to team-leader: `SPAWN_DONE wave=<...> agent_ids=[...]`.

**Why a file for briefs, not inline?** Spawn prompts are bounded; brief content (Files:, depends, budgets, plain goal) can be large. Inline messaging would bloat the lead↔leader message history. File is read once per spawn, then implementers self-claim from the task list.

**Hook gate:** `TaskCreated` hook checks that any `impl:*` task references a wave-id from the current plan-phase. Rogue creation (e.g., implementer trying to spawn its own task) is rejected.

### 3.5 Comparison to discarded models

| Property | v5 (this spec) | v5-draft (three teams) | v4 (single team, lead = leader) |
|---|---|---|---|
| Teams over lifetime | 1 | 3 | 1 |
| Lead spawns implementers? | yes (via SPAWN_REQUEST from leader) | no (dev team's leader spawned) | yes |
| Architect available mid-impl? | no (cycle restart instead) | yes (standby) | yes (always alive) |
| Platform-compliant? | ✅ | ❌ (no nested teams, one team only) | ✅ |
| Re-plan cost | full cycle restart | architect-deferred re-plan | leader-decided re-plan |
| Concurrent teammate peak | 3–6 | 3–6 | 8+ |

## 4. Phase model

Same A–H as v5-draft. Single team across all phases.

```
Phase A — Analytics & Planning
  Members: architect + planner (+ security if regulated)
  Output: spec, arch-map, plan, handover artifact
  Touchpoints: 2 (spec sign-off, plan approval)
  End: architect + planner + security shut down

Phase B..F — Implementation (one per plan-phase from plan)
  Members: team-leader + implementers
  Output: PHASE_COMPLETE <N> per plan-phase
  Touchpoints: 0 (recovery only on RESTART_REQUEST)

Phase G — QC
  Members: qc-engineer
  Output: QC_REPORT (pass / blocking-issues)
  Touchpoints: 0 (blocking issues become impl:rework tasks)

Phase H — Finish
  Members: (empty — orchestrator only)
  Output: pushed branch + owner notification
  Touchpoints: 0 (notification only)
```

**Plan-phases vs spec-phases.** The plan written by the planner in phase A breaks the work into plan-phases (typically 1–3 for a small feature, 3–6 for a large one). Each plan-phase becomes phase B / C / D / etc. in execution. A plan-phase is itself broken into waves of tasks per v3.

Example: planner emits a 3-plan-phase plan (data model → API → UI). Execution then runs:
- Phase A (analytics) → handover
- Phase B (plan-phase 1: data model) → leader review → `PHASE_COMPLETE 1`
- Phase C (plan-phase 2: API) → leader review → `PHASE_COMPLETE 2`
- Phase D (plan-phase 3: UI) → leader review → `PHASE_COMPLETE 3`
- Phase G (QC across all plan-phases)
- Phase H (finish)

### 4.1 Touchpoint counts

| Mode | Touchpoints | Notes |
|---|---|---|
| solo | **1** | Combined diff approval. |
| single-agent | **1** | Combined spec + plan approval. |
| team | **2** | Spec sign-off, then plan approval (sequential, spec locked before planner runs). |

Recovery touchpoints (RESTART_REQUEST approval, QC blocking after 3 rounds, push failure) are not counted in the budget.

## 5. Phase A — Analytics & Planning in detail

### 5.1 Spawning

Lead invokes TeamCreate(`<slug>`). Then spawns:
- `solution-architect` (Opus 4.7 / high)
- `feature-planner` (Sonnet 4.6 / high)
- `security-engineer` (Sonnet 4.6 / medium) — **only** if CLAUDE.md declares `security.domain: payments | healthcare | regulated`.

All teammates load CLAUDE.md + AGENTS.md at first turn. All have access to `docs/adr/` and prior session checkpoints if owner explicitly continues from one.

### 5.2 Spec discussion (touchpoint 1)

Architect drives spec conversation with owner. Planner participates as "what's feasible to break down" voice. Security-engineer (if present) flags regulatory constraints.

Output: `docs/superpowers/specs/YYYY-MM-DD-<slug>-spec.md`. Contents: problem statement, goals + non-goals, acceptance criteria, constraints, architecture impact statement, owner sign-off line.

**Owner touchpoint 1:** owner reviews spec, approves or revises. Architect refines until approved.

### 5.3 Architecture map

After spec sign-off, **before** planning, architect produces:

`docs/superpowers/specs/YYYY-MM-DD-<slug>-arch-map.md`

Contents:
- Affected modules / services (named precisely — `src/Services/Payments`, not "the payments thing")
- New abstractions or interfaces introduced
- Domain boundaries respected (which modules can call which)
- SOLID principles relevant to this feature (concrete: "PaymentProcessor must accept new strategies via DI, not inheritance")
- DRY hotspots — existing utilities implementers should reuse
- ADRs that apply (referenced by ID)

This map becomes the **team-leader's checklist** during phase-end review. Without this artifact, leader has nothing concrete to enforce.

### 5.4 Plan production (touchpoint 2)

Planner consumes spec + arch-map. Emits plan in v3 format (Files, Depends on, Waves) grouped by **plan-phases**, each with its own success criteria.

**Owner touchpoint 2:** owner reviews plan, approves or revises.

### 5.5 Handover protocol

Once owner approves the plan, analytics team produces:

`docs/superpowers/handovers/YYYY-MM-DD-<slug>-handover.md`

Contents:
- Path to spec
- Path to arch-map
- Path to plan
- Open questions deliberately left for implementation (with reasoning)
- Restart-policy note: "If implementation hits an architecturally significant question, team-leader posts RESTART_REQUEST; lead re-runs phase A with this handover + partial commits as input."

Architect posts `HANDOVER_READY <slug>` to lead. Lead then:
1. Shuts down architect (native: lead requests shutdown, architect approves and exits).
2. Shuts down planner.
3. Shuts down security-engineer (if present).
4. Spawns team-leader (entering phase B).

No standby. No idle teammates carrying forward.

## 6. Phases B–F — Implementation in detail

### 6.1 Team-leader spawning

Lead spawns:
- `team-leader` (Opus 4.7 / high)

Spawn prompt: `"You are team-leader for feature <slug>. Read the handover at docs/superpowers/handovers/YYYY-MM-DD-<slug>-handover.md. Process plan-phases in order. For each plan-phase, compose spawn briefs per wave and post SPAWN_REQUEST. After all waves of a plan-phase complete, run phase-end review per spec §6.5. Post PHASE_COMPLETE <N> after rework. Post PLAN_COMPLETE after final plan-phase."`

### 6.2 Within a plan-phase

Team-leader follows v3 wave dispatch logic, but as a coordinator only:
- Read plan-phase's `## Waves` section.
- Collision check per wave (hard-fail re-plan if needed; max 3 retries before RESTART_REQUEST).
- Compose spawn brief for wave (per §3.4).
- Post SPAWN_REQUEST(roles_needed, brief_path, expected_tasks).
- Wait for SPAWN_DONE from lead.
- Monitor task list via TaskCompleted hook callbacks (or polling) until wave's expected_tasks all completed.
- Proceed to next wave OR run phase-end review if last wave.

### 6.3 Implementer task flow

```
Implementer claims task from shared list (file-locked)
        │
        ▼
Read task brief (per-task block from spawn brief file):
  • task_token_budget (default 250k, v4)
  • retrieval_budget (2 cycles, v4)
  • Files: (declared scope)
  • Depends on: (predecessor task IDs)
        │
        ▼
RED → write failing test (v3 TDD discipline)
        │
        ▼
GREEN → minimal implementation
        │
        ▼
REFACTOR → clean up
        │
        ▼
Run lint_command, format_command, typecheck_command (from CLAUDE.md)
   ► MUST pass before commit. Implementer self-enforces.
   ► Output captured to .team-superpower/static-check-<task-id>.log
   ► TaskCompleted hook verifies log presence + exit-0 lines.
        │
        ▼
Two-stage review (inside subagent-driven-development pattern)
        │
        ▼
git commit per §6.5 of v3 format
   ► Commit message: "<task-id>: <desc>"
   ► Includes Files:, Wave:, Test-status: lines
   ► NO QA-verified line (removed in v5)
        │
        ▼
TaskCompleted hook fires → validates → marks task done
        │
        ▼
Self-claim next unclaimed unblocked task OR shut down if none
```

**Differences from v4:** no VERIFY_REQUEST to QA, no waiting for QA_PASS. Implementer self-enforces static checks. Token budget + retrieval budget unchanged.

### 6.4 In-flight escalations

When an implementer encounters something it cannot resolve at task level:

```
ESCALATE <task-id>
class: tactical | cross-role | architectural
question: <one-line>
context: <2–3 lines>
```

SendMessage to team-leader.

Team-leader routing:
- **Tactical** (style, naming, local design): leader answers from arch-map + AGENTS.md. Replies via SendMessage. Implementer continues.
- **Cross-role** (affects another implementer): leader SendMessages the affected peer (native team-internal communication). Both implementers proceed once aligned.
- **Architectural** (changes the arch-map, requires planner judgment, or invalidates a wave plan): leader posts `RESTART_REQUEST <reason+task-id>` to lead. Lead presents recovery touchpoint to owner per §3.1.

**No "architectural standby" — architecturally significant questions trigger cycle restart.** This is the intended behavior. If too many restarts happen on a feature, the phase-A architecture map was insufficient — a signal to invest more time in phase A next iteration.

### 6.5 Phase-end review by team-leader

When the last wave of a plan-phase completes (all expected_tasks marked done), team-leader runs a consolidated SOLID / DRY / domain-architecture review against the arch-map.

Procedure:
1. Read arch-map.
2. List all commits made during this plan-phase: `git log --oneline <phase-start-sha>..HEAD`.
3. For each principle in arch-map, scan the diff:
   - **SOLID**: single responsibility per class/function; OCP via DI not inheritance; LSP not violated by new subtypes; ISP — no fat interfaces; DIP — high-level modules depend on abstractions.
   - **DRY**: locate utility-shaped functions in diff; check against arch-map's "DRY hotspots". Flag duplicates.
   - **Domain architecture**: verify module-boundary calls match arch-map's allowed-callers list.
4. For each violation: create new `impl:rework-<original-task-id>-<violation-short>` task in shared task list. Brief includes the violation description, file:line ref, and remediation guidance. (Leader CAN create tasks — only spawning is forbidden. TaskCreate is allowed for any teammate; hook validates prefix.)
5. Post SPAWN_REQUEST for a rework-wave if no implementers are currently idle. Rework-wave size is `min(violations_count, 3)`.
6. Monitor rework tasks via task list.
7. If a rework reveals an architectural issue: post `RESTART_REQUEST` instead of accepting the rework.
8. After all rework tasks complete (and any rework-of-rework), write phase-end review summary to `docs/superpowers/reviews/YYYY-MM-DD-<slug>-phase-<N>-leader-review.md`. Post `PHASE_COMPLETE <N>` to lead.

**Phase-end review is NOT a touchpoint** — leader handles it internally.

### 6.6 Token cost of phase-end review

Leader runs Opus, so this matters. Estimated per plan-phase:
- Read arch-map: ~5–10k tokens (loaded once at phase B start, re-read at phase-end if context drift)
- Scan diffs for violations: ~20–40k tokens depending on plan-phase size
- Rework task creation + SPAWN_REQUEST: ~5k tokens
- Write phase-end review summary: ~3k tokens

~30–55k tokens per phase-end review. For a 3-phase plan that's ~100–165k total. Significantly cheaper than v4's per-task QA.

## 7. Phase G — QC in detail

After team-leader posts `PLAN_COMPLETE`, lead shuts down team-leader + any remaining implementers. Then spawns:
- `qc-engineer` (Sonnet 4.6 / high)

One QC instance, runs once for entire feature. No FIFO queue, no per-task verification.

### 7.1 QC scope

QC reads:
- Spec (acceptance criteria specifically)
- Plan (to understand what was supposed to ship)
- All commits since worktree was created: `git log --reverse --oneline <base>..HEAD`

QC performs:
1. **Acceptance-criteria walkthrough**: for each criterion in spec, locate code + tests satisfying it. Missing criterion → blocking.
2. **Integration probe**: run full test suite (`test_command`). Any failure → blocking.
3. **Static-check sweep**: re-run `lint_command`, `format_command`, `typecheck_command`. Mostly caught at commit time by hook, but QC re-runs to catch drift from rework tasks.
4. **Cross-implementer consistency**: scan diff for naming inconsistencies (`userId` vs `memberId`), duplicate utilities under different names, contract drift between BE and FE.
5. **Flagged-assumptions resolution**: scan commits for `Flagged-assumptions:` lines (v4 retrieval). Validate each against spec.

### 7.2 QC output

`docs/superpowers/reviews/YYYY-MM-DD-<slug>-qc-report.md`:

```markdown
# QC Report — <slug>

**Status:** pass | blocking-issues

## Acceptance criteria
- [✓] Criterion 1 — satisfied by src/.../FooTests.cs:42
- [✗] Criterion 5 — NOT FOUND in implementation. Blocking.

## Integration
- [✓] Full test suite green (412 tests)

## Static checks
- [✓] Lint clean
- [✓] Format clean
- [✗] Typecheck failure in src/.../Bar.cs:18. Blocking.

## Consistency
- [⚠] Inconsistent naming: `userId` (BE) vs `memberId` (FE) for the same concept. Non-blocking but flagged.

## Flagged assumptions
- [✓] Assumption "RBAC uses Admin role" — verified against ADR-0017.

## Issues for orchestrator
<one block per blocking issue>
```

### 7.3 QC issue handling

**Pass case:** QC posts `QC_PASS` to lead. Lead proceeds to phase H.

**Blocking issues:** QC creates `impl:rework-qc-<topic>` tasks in shared task list. QC then posts `QC_REWORK_NEEDED <task-count>` to lead. Lead:
1. Shuts down qc-engineer.
2. Re-spawns team-leader.
3. team-leader spawns SPAWN_REQUEST for the rework tasks.
4. Implementers process rework.
5. team-leader runs a mini phase-end review on rework commits.
6. team-leader posts `PHASE_COMPLETE QC_REWORK` to lead.
7. Lead shuts down team-leader + implementers, re-spawns qc-engineer for re-check.

Cap: 3 QC rounds. After 3 with no pass, lead escalates to owner: "QC blocked 3 times. Manual intervention required."

**Non-blocking issues** (consistency warnings, style nits): logged in QC report; do not block phase H. Owner sees them in final notification.

## 8. File-by-file changes from v4

### 8.1 `agents/orchestrator.md` (NEW)

Frontmatter:
```yaml
---
name: orchestrator
description: Lead session for team-superpower v5. Sole spawner. Coordinates phase transitions via spawn + shutdown. Responds to SPAWN_REQUEST and RESTART_REQUEST. Runs final cleanup + push.
tools: Read, Write, Bash, Task, Glob, Grep
model: opus
---
```

Body covers:
- v3 mode/size heuristics (unchanged).
- v3 simplified finish (unchanged).
- Team mode: TeamCreate, spawn phase-A members per §5.1, await `HANDOVER_READY`, run phase-B transition per §3.1.
- SPAWN_REQUEST handling per §3.4 execution side.
- RESTART_REQUEST handling per §3.1.
- Auto-detect resume on launch per §8.13.

### 8.2 `agents/solution-architect.md` (REPURPOSED from v4 `software-architect.md`)

Frontmatter:
```yaml
---
name: solution-architect
description: Owns spec architecture map, ADR conformance. Phase A only — shut down at handover.
tools: Read, Write, Glob, Grep
model: opus
---
```

Body covers:
- `/effort high` at first turn.
- Phase A: collaborate with owner on spec; produce arch-map per §5.3; collaborate with planner on plan.
- Post `HANDOVER_READY` after plan approval. Await shutdown request from lead. Approve shutdown.
- Reads `docs/adr/` + AGENTS.md at first turn.

**No standby section.** Architect's lifetime ends at phase A.

### 8.3 `agents/feature-planner.md` (RENAMED from v4 `planner.md`)

Frontmatter:
```yaml
---
name: feature-planner
description: Owns plan production. Phase A only — shut down at handover.
tools: Read, Write, Bash, Glob, Grep
model: sonnet
---
```

Body covers:
- `/effort high` at first turn.
- Consume spec + arch-map; produce plan in v3 format grouped into plan-phases per §5.4.
- Each plan-phase declares its own success criteria.
- After plan approval: await shutdown from lead. Approve shutdown.
- Reads AGENTS.md for proven patterns before producing plan.

### 8.4 `agents/team-leader.md` (NEW)

Frontmatter:
```yaml
---
name: team-leader
description: Phase B–F coordinator teammate. Composes spawn briefs and posts SPAWN_REQUEST to lead. Runs phase-end SOLID/DRY/domain review. Cannot spawn teammates.
tools: Read, Write, Bash, Glob, Grep
model: opus
---
```

Body covers:
- `/effort high` at first turn.
- Read handover at start. Process plan-phases in order.
- Per wave: collision check, compose spawn brief to `.team-superpower/spawn-briefs/wave-<id>.md`, post SPAWN_REQUEST per §3.4, await SPAWN_DONE, monitor task progress.
- Routing per §6.4: tactical / cross-role / architectural (architectural → RESTART_REQUEST).
- Phase-end review per §6.5.
- Post PHASE_COMPLETE then PLAN_COMPLETE; shut down implementers, then approve own shutdown.
- Reads AGENTS.md at start.

**Body must include:** "You CANNOT spawn teammates. To get implementers, compose a brief and post SPAWN_REQUEST to lead. Lead spawns. You can create tasks (TaskCreate) — only spawning is forbidden."

### 8.5 `agents/qc-engineer.md` (NEW, replaces v4 `qa-engineer.md`)

Frontmatter:
```yaml
---
name: qc-engineer
description: End-of-plan quality check teammate. One instance per feature. Replaces v4 per-task QA.
tools: Read, Write, Bash, Glob, Grep
model: sonnet
---
```

Body covers:
- `/effort high` at first turn.
- Read spec + plan + all commits.
- 5-step QC per §7.1.
- Produce report per §7.2.
- On blocking issues: create `impl:rework-qc-*` tasks; post `QC_REWORK_NEEDED` to lead.
- On pass: post `QC_PASS` to lead; approve shutdown.
- Reads AGENTS.md for project-specific consistency rules.

### 8.6 `agents/backend-developer.md` / `agents/frontend-developer.md` (MODIFY v4)

**Remove:** v4 QA loop (`VERIFY_REQUEST → QA_PASS / QA_ISSUES` block).

**Add:**
- Before commit: run `lint_command`, `format_command`, `typecheck_command` from CLAUDE.md. All MUST exit 0. Capture stdout to `.team-superpower/static-check-<task-id>.log`.
- If a check fails: fix locally, rerun. No mailbox interaction.
- After all checks green AND two-stage review passes: `git commit` per v3 §6.5.
- After commit: TaskCompleted hook validates → marks done → self-claim next unclaimed unblocked task or shut down if none.

**Keep:** v4 token budget (§5), iterative retrieval (§6), MAX_ITERATIONS guardrail.

**Add escalation:**
- For task-level questions you cannot resolve: SendMessage team-leader with `ESCALATE <task-id> class=<tactical|cross-role|architectural> question=<...> context=<...>` per §6.4.
- Do NOT guess on architecture-level decisions. Mark them `class=architectural`; team-leader will route.

### 8.7 v4 agents removed

- `agents/designer.md` — DELETE. Spec discussion is now owned by solution-architect.
- `agents/reviewer.md` — DELETE. Quality role split: team-leader (phase-end SOLID/DRY) + qc-engineer (end-of-plan QC).
- `agents/qa-engineer.md` — DELETE. Replaced by qc-engineer (single instance, end-of-plan).

### 8.8 `agents/security-engineer.md` (KEEP, scoped)

Stays. Now spawned only if `security.domain: payments | healthcare | regulated` is set in CLAUDE.md. Reports to solution-architect during phase A (not team-leader). Shut down at handover with planner + architect.

### 8.9 `hooks/task-completed.sh` (MODIFY)

**Remove:** v4 checks 7 (`MISSING_QA_VERIFICATION`) + 8 (`QA_CAP_EXCEEDED`).

**Keep:** v4 checks 9 (`RETRIEVAL_BUDGET_EXCEEDED`), trivial-claim, premature-assumption checks.

**Add:**

10. **For `impl:*` tasks**: verify `.team-superpower/static-check-<task-id>.log` exists AND contains exit-0 lines for `lint_command`, `format_command`, `typecheck_command`. Exit 2 `MISSING_STATIC_CHECKS` if absent or non-zero.
11. **For `impl:rework-*` tasks**: same as `impl:*` plus verify commit message references the originating issue (`Reworks: <original-task-id|qc-issue-id>`). Exit 2 `MISSING_REWORK_REFERENCE` if missing.

### 8.10 `hooks/task-created.sh` (MODIFY)

**Add** allowed prefixes: `impl:rework-*` (leader-created and qc-created).

**Add** wave-id check: for `impl:*` tasks, validate task body references a wave-id from the current active plan-phase. Exit 2 `INVALID_WAVE_REFERENCE` otherwise. (Prevents rogue self-spawn by implementers.)

### 8.11 `hooks/teammate-idle.sh` (MODIFY)

Role-aware routing. Read teammate's agent type from team config (`~/.claude/teams/<slug>/config.json`, `members[].type`):

| Type | Action |
|---|---|
| `solution-architect` | Exit 0 if phase A complete (shutdown expected). Exit 2 with "complete phase A: spec + arch-map + plan" otherwise. |
| `feature-planner` | Same as architect. |
| `security-engineer` | Same. |
| `team-leader` | Exit 2 with "check wave status; if all complete, run phase-end review; if all reviews complete, post PLAN_COMPLETE". |
| `backend-developer` / `frontend-developer` | Exit 2 with "claim next unclaimed unblocked task or shut down if none". |
| `qc-engineer` | Exit 2 with "produce QC report if not yet written; otherwise post QC_PASS or QC_REWORK_NEEDED". |
| `orchestrator` | n/a (lead, not teammate). |

### 8.12 `assets/CLAUDE.md.template` (UPDATE)

`limits` block:

```yaml
limits:
  max_iterations_per_task: 8        # v3 MAX_ITERATIONS
  task_token_budget: 250000         # v4 per-task token cap
  retrieval_budget_per_task: 2      # v4 retrieval cycles
  max_qc_rounds: 3                  # v5 QC re-check cap
  max_cycle_restarts: 2             # v5 RESTART_REQUEST cap before owner escalation
  # max_qa_rounds_per_task         # REMOVED in v5
```

`commands` block (now required, not optional):
- `lint_command`
- `format_command`
- `typecheck_command`

Without these three, v5 implementers cannot self-enforce and the TaskCompleted hook cannot validate.

### 8.13 Resume — auto-detect (replaces `commands/team-feature-resume.md`)

DELETE `commands/team-feature-resume.md`.

Auto-detect on `/team-feature` invocation, before mode selection. Lead checks:

1. `~/.claude/teams/<inferred-slug>/config.json` exists? (Team state from a prior run.)
2. `docs/superpowers/handovers/*-handover.md` files with no matching `*-qc-report.md`?
3. `docs/superpowers/plans/*.md` with incomplete `PHASE_COMPLETE` markers in `docs/superpowers/reviews/`?
4. Worktree has uncommitted or unpushed plan-task commits (git log diverged from base)?
5. claude-mem timeline has prior session checkpoint for inferred slug?

Slug inference: from worktree dir name, from owner's launch text, or by listing handover files newest-first.

If any signal hits → present resume prompt:

```
Found in-progress feature: <slug> at phase <X>
  Spec:     <path>
  Plan:     <path>
  Last commit: <sha> "<msg>"
Continue this feature, or start fresh?
  [1] Continue (re-spawn teammates per current phase)
  [2] Start fresh (archive prior artifacts; new feature)
```

Owner picks. On Continue:
- Lead re-runs TeamCreate (if config gone) or reuses existing team config (if present).
- Lead reads handover (if past phase A).
- Lead re-spawns teammates appropriate for current phase (team-leader for B–F, qc-engineer for G).
- All teammates get spawn prompts that include "this is a resume; read the existing handover/spec/plan; continue from current state".

This replaces the dedicated resume command. Owner experience: one entry point (`/team-feature`).

### 8.14 New artifact paths

```
docs/superpowers/
  specs/                                       # v3, unchanged
    YYYY-MM-DD-<slug>-spec.md
    YYYY-MM-DD-<slug>-arch-map.md              # NEW in v5
  plans/                                       # v3, unchanged
  handovers/                                   # NEW in v5
    YYYY-MM-DD-<slug>-handover.md
  reviews/                                     # v3, repurposed
    YYYY-MM-DD-<slug>-phase-<N>-leader-review.md  # NEW per plan-phase
    YYYY-MM-DD-<slug>-qc-report.md             # replaces v4 -review.md
  sessions/                                    # v3, unchanged
  AGENTS.md                                    # v4, unchanged
  AGENTS.suggestions.md                        # v4, now written by qc-engineer

.team-superpower/                              # under worktree root (gitignored)
  spawn-briefs/                                # NEW in v5
    wave-<plan-phase>.<wave>.md
  static-check-<task-id>.log                   # NEW in v5
```

### 8.15 `commands/team-feature.md` (MAJOR REWRITE)

Lead prompt now:
- Spawns `orchestrator` agent type at start.
- Orchestrator runs v3 heuristic ladder to pick mode.
- For team mode: orchestrator runs §3.1 single-team lifecycle.
- For single-agent mode: orchestrator spawns 1 implementer + 1 qc-engineer (no team-leader, no architect — orchestrator handles the combined spec+plan briefing itself).
- For solo mode: orchestrator does the work itself (no teammates).

The mode-specific block is rewritten to reflect the single-team / role-swap model.

### 8.16 `assets/ESCALATION.md` (REWRITE)

v5 routing:
- Implementer → team-leader (in-team via SendMessage).
- team-leader → orchestrator (RESTART_REQUEST or SPAWN_REQUEST).
- orchestrator → owner (recovery touchpoints only).

Drop v4's QA-specific escalation paths. Drop "mailbox file" references.

### 8.17 `assets/SESSION_README.md` (UPDATE)

Update artifact map to include new paths (§8.14). Document single-team model. Document SPAWN_REQUEST protocol.

### 8.18 `scripts/` (AUDIT)

| Script | v5 status |
|---|---|
| `assess-complexity.sh` | Keep — used by orchestrator mode pick. |
| `detect-stack.sh` | Keep — CLAUDE.md parsing. |
| `parse-claudemd.sh` | Keep. |
| `team-state.sh` | **Rewrite** for v5 native team config (`~/.claude/teams/<slug>/config.json`). Drop v4 mailbox helpers. |
| `wave-collision-check.sh` | Keep — v3 wave dispatch logic, used by team-leader. |

## 9. Simplified flows for bug fix and small enhancement

Two-team architecture is intentionally heavy. Solo and single-agent modes use stripped-down flows.

### 9.1 Solo (bug fix) — 1 touchpoint

```
👤 Owner: /team-feature fix <description>
        │
        ▼
   ORCHESTRATOR (Opus/xhigh)
   • Heuristic → solo mode
   • Reads CLAUDE.md + AGENTS.md
   • Locates affected file(s)
   • Drafts COMBINED briefing:
       (a) one-sentence bug statement
       (b) proposed change (diff preview)
       (c) verification step (test command)
        │
👤 Combined approval ◄── Touchpoint 1
        │ Approved
        ▼
   Orchestrator applies the change
   Runs test_command
   git commit (solo: <slug> - <desc>)
   git push -u origin
   Cleanup + notify owner
```

No TeamCreate, no teammates. Orchestrator runs single-session.

**Total touchpoints: 1.**

### 9.2 Single-agent (small enhancement) — 1 touchpoint

```
👤 Owner: /team-feature add <small enhancement>
        │
        ▼
   ORCHESTRATOR (Opus/xhigh)
   • Heuristic → single-agent mode
   • Reads CLAUDE.md + AGENTS.md
   • Drafts COMBINED briefing:
       (a) one-paragraph spec (problem + acceptance criteria)
       (b) one-task plan (Files: + verification: + estimated time)
       (c) optional risk note
        │
👤 Combined spec + plan approval ◄── Touchpoint 1
        │ Approved
        ▼
   TeamCreate(<slug>)
   Spawn 1 implementer (Sonnet/medium)
   • TDD: RED → GREEN → REFACTOR
   • Token budget, retrieval, lint/format/typecheck
   • git commit
        │
        ▼
   Shut down implementer
   Spawn qc-engineer (single round)
   • Pass → push + cleanup + notify
   • Issues → rework task, re-spawn implementer, re-run QC (max 3 rounds)
   • Issues after 3 QC rounds → ONE recovery escalation to owner
        │
        ▼
   Cleanup team, git push -u origin, notify
```

**Total touchpoints: 1** (plus optional recovery escalation only if QC blocks 3 times).

### 9.3 Full team (feature) — 2 touchpoints (per §5)

Two genuinely sequential gates: spec sign-off, then plan approval. See §4 phase model + §5–§7.

## 10. Touchpoint inventory

| Mode | Touchpoints | Content | Initiator |
|---|---|---|---|
| solo | **1** | Combined: bug + diff + verification | Orchestrator |
| single-agent | **1** | Combined: spec paragraph + one-task plan | Orchestrator |
| team | **2** | (1) Spec sign-off (architect-driven). (2) Plan approval (planner-driven, after spec locked). | Analytics teammates via orchestrator |

Recovery escalations (RESTART_REQUEST approval, QC blocked 3 rounds, push failure, model fallback) are notifications or single recovery questions — NOT counted in the touchpoint budget.

## 11. Implementation order

Strict order. Each step independent enough to validate before next.

1. **Agent files** — write `orchestrator.md`, `solution-architect.md`, `feature-planner.md`, `team-leader.md`, `qc-engineer.md`. Delete `designer.md`, `reviewer.md`, `qa-engineer.md`. Rename `planner.md` → `feature-planner.md`. Repurpose `software-architect.md` → `solution-architect.md`. Modify `backend-developer.md` + `frontend-developer.md` per §8.6. Keep `security-engineer.md` scoped per §8.8.
2. **Escalation prose** — rewrite `assets/ESCALATION.md` per §8.16.
3. **Hook updates** — modify `task-completed.sh` per §8.9, `task-created.sh` per §8.10, `teammate-idle.sh` per §8.11.
4. **CLAUDE.md template** — update per §8.12.
5. **Scripts audit** — rewrite `team-state.sh` per §8.18; keep others.
6. **Artifact paths + SESSION_README** — create `docs/superpowers/handovers/`, update README per §8.14 / §8.17.
7. **Command rewrite** — `commands/team-feature.md` per §8.15 (three modes + single-team lifecycle + SPAWN_REQUEST handling + auto-resume per §8.13). Delete `commands/team-feature-resume.md`.
8. **Companion docs** — rewrite `docs/superpowers/agent-team-flows-v5.md` and `docs/superpowers/agent-team-checklist.md` to match final implementation.
9. **Tests** — bash fixtures under `tests/team-superpower/v5/`:
   - `static-check-log.test.sh` — hook rejects missing / non-zero log.
   - `rework-reference.test.sh` — hook rejects missing `Reworks:` line.
   - `wave-reference.test.sh` — hook rejects `impl:*` tasks without valid wave-id.
   - `spawn-request.test.sh` — team-leader composes brief, posts SPAWN_REQUEST, lead spawns (mocked via fixture).
   - `phase-end-review.test.sh` — seeded SOLID violation → leader creates `impl:rework-*`.
   - `resume-detect.test.sh` — seeded artifacts → command offers resume prompt.
   - `touchpoint-count.test.sh` — dry-run transcripts assert 1/1/2 for solo/single/team.
10. **End-to-end smoke** —
    - Solo: typo fix → 1 touchpoint, no TeamCreate, push success.
    - Single-agent: add `/healthcheck` endpoint → 1 touchpoint, 1 implementer + 1 QC.
    - Team: full-stack feature → 2 touchpoints, single-team lifecycle, all phase transitions verified.

## 12. Acceptance criteria

All v3 + v4 criteria still apply (those not explicitly removed), plus:

**Single-team model:**
- [ ] In team mode, exactly one Agent Teams team is created per feature (one TeamCreate, one cleanup).
- [ ] Team membership changes across phases as documented in §3.1 (architect+planner+[security] at start; team-leader+implementers in B–F; qc-engineer in G).
- [ ] No two phase-A teammates remain alive after phase A ends.
- [ ] Architect is NOT alive during phases B–F (replaces v5-draft's standby).

**SPAWN_REQUEST protocol:**
- [ ] team-leader does NOT call TeamCreate or spawn teammates directly.
- [ ] For each wave, team-leader writes a spawn brief to `.team-superpower/spawn-briefs/wave-<id>.md` and posts SPAWN_REQUEST to lead.
- [ ] Lead reads brief, creates tasks via TaskCreate, spawns implementers, replies SPAWN_DONE.
- [ ] `TaskCreated` hook rejects `impl:*` tasks without a valid wave-id reference.

**Phase-end leader review:**
- [ ] At end of each plan-phase, team-leader produces a review log at `docs/superpowers/reviews/YYYY-MM-DD-<slug>-phase-<N>-leader-review.md`.
- [ ] Leader creates `impl:rework-*` tasks for each violation found.
- [ ] Leader posts `PHASE_COMPLETE <N>` only after rework completes.
- [ ] A simulated SOLID violation is caught and produces a rework task.

**End-of-plan QC:**
- [ ] qc-engineer is spawned once per feature, after `PLAN_COMPLETE`.
- [ ] QC produces report at `docs/superpowers/reviews/YYYY-MM-DD-<slug>-qc-report.md`.
- [ ] QC blocking issues create `impl:rework-qc-*` tasks; team-leader is re-spawned to dispatch them.
- [ ] QC re-runs after rework; max 3 QC rounds; 4th round triggers owner escalation.

**Restart-on-stuck:**
- [ ] team-leader posts `RESTART_REQUEST` instead of attempting standby ARCH_QUESTION.
- [ ] Lead presents recovery touchpoint to owner on RESTART_REQUEST.
- [ ] On approval, lead shuts down all current teammates, re-spawns phase-A members with handover + partial commits as input.
- [ ] Max 2 cycle restarts per feature; 3rd → escalate.

**No per-task QA:**
- [ ] No `qa-engineer` is spawned in v5.
- [ ] Implementer commits do NOT contain `QA-verified:` lines.
- [ ] `task-completed.sh` does NOT check `qa_verified_at:` metadata or `MISSING_QA_VERIFICATION`.

**Static-check self-enforcement:**
- [ ] Each implementer task produces `.team-superpower/static-check-<task-id>.log` with exit-0 lines for lint/format/typecheck.
- [ ] `task-completed.sh` rejects with `MISSING_STATIC_CHECKS` if log absent or non-zero.
- [ ] A simulated lint failure pre-commit causes implementer to fix and retry; commit eventually succeeds with green log.

**Auto-resume:**
- [ ] No `team-feature-resume.md` command exists.
- [ ] `/team-feature` auto-detects in-progress features per §8.13 and presents one resume prompt.

**Handover artifacts:**
- [ ] After phase A: spec, arch-map, plan, handover artifact all exist at §8.14 paths.
- [ ] Handover includes restart-policy note.

**Touchpoint counts:**
- [ ] Solo mode uses exactly **1** owner touchpoint (combined diff approval). Verified by dry-run transcript.
- [ ] Single-agent mode uses exactly **1** owner touchpoint (combined spec + plan approval). Verified by dry-run transcript.
- [ ] Team mode uses exactly **2** owner touchpoints (spec sign-off, then plan approval). Verified by dry-run transcript.
- [ ] Recovery escalations are NOT counted in the touchpoint budget.

## 13. Risks specific to v5

| Risk | Mitigation |
|---|---|
| Late detection of lint/format/typecheck regressions (QC runs once at end vs v4 per-task) | Static checks enforced at commit time by hook §8.9. Late-detection remaining risk: principle violations (SOLID/DRY), caught per-phase by team-leader. |
| RESTART_REQUEST cost (full cycle re-run) is high vs discarded standby | Trade accepted. Restart-on-stuck is simpler and platform-clean. Owner sees a recovery touchpoint; can decline. Investing more time in phase-A arch-map reduces restart frequency. |
| team-leader becomes bottleneck on phase-end review | Phase-end review is batched, not per-task. Even a 50k-token review is small vs wave implementation cost. If review takes too long, the plan-phase was too large (planner sizing problem). |
| SPAWN_REQUEST round-trip adds latency | Local IPC. Cost is on the order of tens of seconds per wave (lead reads brief, creates N tasks, spawns N teammates). Acceptable vs 5–10 min wave run. |
| Implementer escalates to architectural class unnecessarily, triggering restart | team-leader's routing classifies first. `class=architectural` must be justified; leader can downgrade to `tactical` and reply directly. Implementers that over-escalate get coaching feedback. |
| Lead has many roles (mode pick, spawn, route, cleanup, push) — single point of failure | Same as v4 lead role; well-tested. The diet is actually lighter than v4 because team-leader handles all coordination thinking. |
| Phase-end review misses subtle violations | Arch-map is the leader's checklist. If the map is vague, the review is vague. Architect quality on the map directly determines leader quality. |
| Implementers commit code that violates SOLID, only learns at phase end | Trade accepted. Cost of catching 1–2 waves later is bounded; per-task review (v4) was unbounded. |
| Auto-resume picks the wrong feature when multiple in-progress | Prompt presents all candidates if more than one; owner chooses. Slug inference falls back to "ask owner". |
| `~/.claude/teams/<slug>/config.json` is platform-managed; v5 hooks/scripts must not edit it | Documented in agent prompts and `team-state.sh`. Read-only access only. Hooks rely on the platform's own state writes. |
| Token cost of orchestrator-as-sole-spawner | One extra round-trip per wave for SPAWN_REQUEST. Negligible vs implementation cost. |

## 14. Out of scope for v5

- Architect standby across phases (replaced by RESTART_REQUEST).
- Multiple Agent Teams teams per feature (platform forbids; not pursued).
- Pluggable principle checkers (custom SOLID definitions per project). Arch-map is plain text; leader interprets.
- Per-implementer leader review (rejected in favor of phase-end batching).
- QC parallelism (single qc-engineer by design).
- Auto-promoting QC suggestions to AGENTS.md (still owner-only per v4 §7).
- Visual architecture diagrams from architect (arch-map is markdown text; diagrams out of scope).
- Cross-feature architect persistence (each feature spawns a fresh architect).

---

**End of v5 spec.** Implement per §11 order. Validate against §12 acceptance after each step.
