# Agent Team — Flow by Work Type (v5)

Three modes the orchestrator picks **automatically** from your launch message.
Owner touchpoints are marked 👤.

**v5 touchpoint policy:**
- 🔴 Bug fix (solo): **1 touchpoint** — combined diff approval
- 🟡 Small enhancement (single-agent): **1 touchpoint** — combined spec + plan approval
- 🟢 Full feature (team): **2 touchpoints** — spec sign-off, then plan approval

---

## 🔴 Bug Fix — Solo Mode (1 touchpoint)

> Trigger: `fix typo`, `rename`, `bump version`, `one line`, `single file`

```
👤 Owner: /team-feature fix <description>
         │
         ▼
    ┌─────────────────────┐
    │   ORCHESTRATOR      │  reads CLAUDE.md + AGENTS.md
    │   (Opus/xhigh)      │  reads affected file(s)
    │   No teams spawned  │
    └──────────┬──────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │  Orch drafts COMBINED briefing:  │
    │    (a) bug statement             │
    │    (b) proposed diff (preview)   │
    │    (c) verification step         │
    └──────────────┬───────────────────┘
                   │
   👤 Combined approval  ◄── Touchpoint 1 (the only one)
                   │ Approved
                   ▼
    ┌──────────────────────────────┐
    │  Orch applies the fix        │
    │  Runs test_command           │
    │  git commit                  │
    │  git push -u origin          │
    │  Cleanup + notify owner      │
    └──────────────────────────────┘
```

**Teams spawned:** None
**Owner touchpoints:** 1 (was 1-2 in v4)
**No analytics phase, no dev team, no QC, no leader review**

---

## 🟡 Small Enhancement — Single-Agent Mode (1 touchpoint)

> Trigger: `add endpoint`, `add field`, `new component`, single-side signal,
> no discovery language

```
👤 Owner: /team-feature add <description>
         │
         ▼
    ┌─────────────────────┐
    │   ORCHESTRATOR      │  reads CLAUDE.md + AGENTS.md
    │   (Opus/xhigh)      │
    └──────────┬──────────┘
               │
               ▼
    ┌──────────────────────────────────────┐
    │  Orch drafts COMBINED briefing:      │
    │    (a) one-paragraph spec            │
    │        (problem + acceptance         │
    │        criteria)                     │
    │    (b) one-task plan                 │
    │        (Files + verification step)   │
    │    (c) optional risk note            │
    └──────────────┬───────────────────────┘
                   │
   👤 Combined spec + plan approval  ◄── Touchpoint 1 (the only one)
                   │ Approved
                   ▼
    ┌──────────────────────────────────────────────┐
    │  Spawn 1 IMPLEMENTER (Sonnet/medium)         │
    │  (NO leader, NO architect, NO QA-at-task)    │
    │                                              │
    │   1. RED → GREEN → REFACTOR                  │
    │   2. Token budget (pause at 85%)             │
    │   3. Retrieval cycles if unclear (max 2)     │
    │   4. Run lint + format + typecheck locally   │
    │      (must exit 0 to commit)                 │
    │   5. git commit                              │
    └──────────────┬───────────────────────────────┘
                   │
                   ▼
    ┌──────────────────────────────────────────────┐
    │  Spawn QC-ENGINEER once (Sonnet/high)        │
    │                                              │
    │   Verify against the approved spec:          │
    │     ✓ Acceptance criteria satisfied          │
    │     ✓ Integration test green                 │
    │     ✓ No unresolved flagged-assumptions      │
    │                                              │
    │   Pass → continue to finish                  │
    │   Issues → rework + re-impl + re-QC (max 3)  │
    │   After 3 failed rounds → recovery prompt    │
    │     (recovery only, NOT a normal touchpoint) │
    └──────────────┬───────────────────────────────┘
                   │ QC pass
                   ▼
    ┌──────────────────────────────┐
    │  Orch: git push -u origin    │
    │  Cleanup + notify owner      │
    └──────────────────────────────┘
```

**Teams spawned:** 1 implementer + 1 QC (sequential, not concurrent)
**Owner touchpoints:** 1 (was 2 in v4 — spec and plan are fused)
**Why fused:** the spec for a small enhancement is short enough that drafting a one-task plan alongside it costs nothing; the owner reads both at once.

---

## 🟢 Feature — Team Mode (2 touchpoints, three teams over the lifetime)

> Trigger: `feature`, `design`, `refactor`, `migrate`, multi-side signals,
> message > 200 chars, regulated domain keywords

Two touchpoints are deliberate here: the spec must be locked before planning starts, because a flawed spec poisons the plan.

### Phase A — Analytics team forms, owner approves spec, then plan

```
👤 Owner: /team-feature <feature description>
         │
         ▼
    ┌─────────────────────┐
    │   ORCHESTRATOR      │  reads CLAUDE.md + AGENTS.md
    │   (Opus/xhigh)      │  picks team size
    └──────────┬──────────┘
               │ spawn ANALYTICS TEAM
               ▼
    ┌──────────────────────────────────────────────────┐
    │           ANALYTICS TEAM                          │
    │                                                   │
    │  • solution-architect (Opus/high)                │
    │  • feature-planner    (Sonnet/high)              │
    └──────────────────────┬───────────────────────────┘
                           │
                           ▼
    ┌──────────────────────────────────────────────────┐
    │ Architect drafts spec with owner                  │
    │ Planner participates as "feasibility voice"       │
    │   → docs/superpowers/specs/...-spec.md            │
    └──────────────────────┬───────────────────────────┘
                           │
       👤 Spec sign-off  ◄── Touchpoint 1
                           │ Approved
                           ▼
    ┌──────────────────────────────────────────────────┐
    │ Architect writes architecture map:                │
    │   • Affected modules + new abstractions           │
    │   • SOLID principles relevant to this feature     │
    │   • DRY hotspots (existing utilities)             │
    │   • Domain boundaries                             │
    │   • ADRs referenced                               │
    │   → docs/superpowers/specs/...-arch-map.md        │
    │                                                   │
    │ Planner consumes spec + arch-map                  │
    │ Emits detailed plan grouped by plan-phases:       │
    │   ## Plan-phase 1: data model                     │
    │   ## Plan-phase 2: API                            │
    │   ## Plan-phase 3: UI                             │
    │ Each with Files + Depends on + Waves              │
    │   → docs/superpowers/plans/...-plan.md            │
    └──────────────────────┬───────────────────────────┘
                           │
       👤 Detailed plan + phases approval  ◄── Touchpoint 2
                           │ Approved
                           ▼
    ┌──────────────────────────────────────────────────┐
    │  HANDOVER artifact written                        │
    │    spec + arch-map + plan + architect's standby   │
    │                                                   │
    │  Orchestrator signals:                            │
    │    • planner   → DISBAND (clean exit)             │
    │    • architect → ENTER_STANDBY                    │
    │       (alive, mailbox-reachable, idle)            │
    └──────────────────────────────────────────────────┘
```

### Phases B–F — Development team runs each plan-phase

```
                   │ from handover
                   ▼
    ┌──────────────────────────────────────────────────┐
    │           DEVELOPMENT TEAM                        │
    │                                                   │
    │  • team-leader (Opus/high)                       │
    │  • backend-developer × N (Sonnet/medium)         │
    │  • frontend-developer × N (Sonnet/medium)        │
    │    (up to 3 each per wave; total cap 6)          │
    └──────────────────────┬───────────────────────────┘
                           │
                           ▼
    ┌──────────────────────────────────────────────────┐
    │  Repeat for each plan-phase 1..M:                 │
    │                                                   │
    │  ┌─────────────────────────────────────────────┐ │
    │  │  Wave dispatch:                              │ │
    │  │    • Collision check                          │ │
    │  │    • Spawn up to 3 BE + 3 FE                  │ │
    │  │                                               │ │
    │  │  Each implementer:                            │ │
    │  │    1. TDD: RED → GREEN → REFACTOR             │ │
    │  │    2. Token budget (pause @ 85%)              │ │
    │  │    3. Retrieval (max 2 cycles)                │ │
    │  │    4. Arch question? ARCH_QUESTION_NEEDED ────┼──► architect-standby
    │  │    5. lint + format + typecheck local         │ │
    │  │    6. git commit                              │ │
    │  │                                               │ │
    │  │  After all waves in this phase:               │ │
    │  │    team-leader phase-end review:              │ │
    │  │      • Read arch-map                          │ │
    │  │      • SOLID/DRY/domain violations            │ │
    │  │      • Create impl:rework-* for each issue    │ │
    │  │      • Wait for rework, then PHASE_COMPLETE   │ │
    │  └─────────────────────────────────────────────┘ │
    │                                                   │
    │  All plan-phases complete → PLAN_COMPLETE         │
    └──────────────────────┬───────────────────────────┘
                           │
                           ▼
    ┌──────────────────────────────────────────────────┐
    │  Orchestrator signals:                            │
    │    • dev team → DISBAND                           │
    │    • architect → still STANDBY (for QC reroutes)  │
    └──────────────────────────────────────────────────┘
```

### Phase G — QC team runs ONCE

```
                           │
                           ▼
    ┌──────────────────────────────────────────────────┐
    │           QC TEAM (single instance, once)         │
    │  • qc-engineer (Sonnet/high)                     │
    │                                                   │
    │  Reads: spec + plan + all commits                 │
    │                                                   │
    │  Checks:                                          │
    │    1. Acceptance criteria walkthrough             │
    │    2. Integration probe (full test suite)         │
    │    3. Static-check sweep (drift catch)            │
    │    4. Cross-implementer consistency               │
    │    5. Flagged-assumptions validation              │
    │                                                   │
    │  Output: qc-report.md                             │
    │                                                   │
    │  Issues → impl:rework-qc-* tasks                  │
    │    Orch re-spawns dev team to fix                 │
    │    QC re-runs (max 3 rounds total)                │
    │    After 3 failed rounds → recovery escalation    │
    │       (NOT a normal touchpoint)                   │
    └──────────────────────┬───────────────────────────┘
                           │ QC pass
                           ▼
```

### Phase H — Orchestrator pushes, cleans up, notifies

```
    ┌──────────────────────────────────────────────────┐
    │  Orchestrator:                                    │
    │    qc → DISBAND                                   │
    │    architect → DISBAND                            │
    │                                                   │
    │    git push -u origin                             │
    │    ✅ Success: cleanup everything                 │
    │    ⚠️ Push failed: cleanup teams, keep worktree   │
    │                                                   │
    │    Notify owner (single message, no decision)     │
    │    Mention AGENTS.md suggestions if any           │
    └──────────────────────────────────────────────────┘
```

---

## Summary table

| | 🔴 Bug Fix | 🟡 Small Enhancement | 🟢 Full Feature |
|---|---|---|---|
| **Mode** | solo | single-agent | team |
| **Touchpoints** | **1** | **1** | **2** |
| **Touchpoint content** | combined diff approval | combined spec + plan approval | spec sign-off, then plan approval (sequential) |
| **Analytics team (architect + planner)** | ✗ | ✗ | ✅ phase A |
| **Dev team (leader + impls)** | ✗ | 1 impl only | ✅ phases B-F |
| **QC team (qc-engineer)** | ✗ | ✅ once | ✅ once |
| **Architecture map** | ✗ | ✗ | ✅ |
| **Handover artifact** | ✗ | ✗ | ✅ |
| **Architect standby** | n/a | n/a | ✅ phases B-F |
| **Phase-end SOLID/DRY review** | ✗ | ✗ | ✅ per phase |
| **Static-check self-enforcement** | ✗ | ✅ | ✅ |
| **Token budget (per task)** | ✗ | ✅ | ✅ |
| **Retrieval budget (per task)** | ✗ | ✅ | ✅ |
| **AGENTS.md read** | ✗ | ✅ | ✅ |
| **AGENTS.md suggestions written by** | n/a | qc-engineer | qc-engineer |
| **Automatic finish (push + cleanup)** | ✅ | ✅ | ✅ |
| **Wave dispatch** | ✗ | ✗ | ✅ |
| **Max parallel implementers** | 1 (orch) | 1 | 3 BE + 3 FE per wave |

---

## v5 touchpoint policy in one paragraph

For trivial work (bug fixes, small enhancements) the orchestrator combines everything the owner needs to approve into **one briefing**: what's changing, why, how, and what verifies it. The owner reads once and answers once. For full features, the **spec** and the **detailed plan + phases** are two genuinely separate decisions — a flawed spec poisons the plan, so the spec must be locked before planning starts. Two touchpoints, presented sequentially. All other interactions (push notifications, QC pass/fail, AGENTS.md hints) are informational and require no response.

---

## What's different from v4

| Aspect | v4 | v5 |
|---|---|---|
| Solo touchpoints | 1-2 | **1** (collapsed) |
| Single-agent touchpoints | 2 | **1** (spec + plan fused) |
| Team touchpoints | 2 | 2 (unchanged) |
| Conductor role | single "lead" | **orchestrator** (meta only) + **team-leader** (dev team) |
| Architect | persists in dev team | **disbands → standby** between phase A and B |
| Planner | persists in dev team | **fully disbanded** after handover |
| QA verification | per-task FIFO queue | **none at task time** — static checks self-enforced |
| Quality gate | every commit | **per phase-end (leader)** + **end-of-plan (QC)** |
| SOLID/DRY enforcement | ad-hoc (reviewer at end) | **explicit phase-end review against arch map** |
| Reviewer role | dedicated reviewer agent | **role removed** — split between team-leader and qc-engineer |
| Designer role | dedicated designer agent | **role removed** — folded into solution-architect |

---

## Mode-decision ladder (unchanged from v3/v4)

```
Launch message
     │
     ▼
 RUNG 1 — solo?
   "fix typo", "rename", "bump", "one line", "single file"
                              ──► YES → 🔴 Solo (1 touchpoint)
                              NO ▼
 RUNG 2 — single-agent?
   "add endpoint" / "new component" / "fix bug"
   AND single-side (BE-only OR FE-only)
   AND no discovery language
                              ──► YES → 🟡 Single-agent (1 touchpoint)
                              NO ▼
 RUNG 3 — team (default)
   Multi-side, "design", "architecture", "feature",
   multiple verbs, >200 chars, "team"
                              ──► 🟢 Team (2 touchpoints)
                              + size: full (regulated) / minimal (PoC) / standard

Override: /team-feature --mode=solo --size=full <idea>
Preview:  /team-feature --explain <idea>
```

---

*Diagrams reflect team-superpower v5 — two-team orchestration with persistent architect, phase-end leader review, end-of-plan QC, and the new 1/1/2 touchpoint policy.*
