# Agent Team — Flow by Work Type (v5, Agent-Teams-native)

> **DEPRECATED (2026-05-20).** Superseded by the v6 single-session lifecycle, which collapses the `orchestrator` teammate into the `/team-feature` main session. See `docs/superpowers/specs/2026-05-20-team-superpower-v6-collapse-orchestrator-design.md`. Historical reference only.

Three modes the main session picks **automatically** from your launch message.
Owner touchpoints are marked 👤.

**v5 touchpoint policy:**
- 🔴 Bug fix (solo): **1 touchpoint** — combined diff approval
- 🟡 Small enhancement (single-agent): **1 touchpoint** — combined spec + plan approval
- 🟢 Full feature (team): **2 touchpoints** — spec sign-off, then plan approval (the phase-H finish-branch menu is the third in team mode)

All modes use **one Claude Code Agent Teams team** per feature (when a team is
created at all). Solo mode creates no team. Single-agent and team modes follow
`TeamCreate → spawn → shutdown → spawn → ... → cleanup`.

---

## 🔴 Bug Fix — Solo Mode (1 touchpoint, no team)

```
👤 Owner: /team-feature fix <description>
         │
         ▼
    ORCHESTRATOR (Opus/xhigh)
    reads CLAUDE.md + AGENTS.md + affected file(s)
    drafts COMBINED briefing: bug statement + diff preview + verification
         │
👤 Combined approval ◄── Touchpoint 1 (only one)
         │ approve
         ▼
    Orch applies fix → runs test_command → commits → pushes → notifies
```

No TeamCreate, no teammates.

---

## 🟡 Small Enhancement — Single-Agent Mode (1 touchpoint, 1 team)

```
👤 Owner: /team-feature add <small enhancement>
         │
         ▼
    ORCHESTRATOR (Opus/xhigh)
    drafts COMBINED briefing: one-paragraph spec + one-task plan
         │
👤 Combined spec + plan approval ◄── Touchpoint 1
         │ approve
         ▼
    TeamCreate(superpower-<slug>)
    Spawn 1 implementer (Sonnet/medium)
    Implementer: TDD → static checks → commit
    Shut down implementer
    Spawn qc-engineer (single round, max 3)
         │
         ▼ QC_PASS
    push + cleanup + notify
```

QC blocking after 3 rounds → recovery escalation (not counted in touchpoint
budget).

---

## 🟢 Full Feature — Team Mode (2 touchpoints, 1 team across phases A–H)

```
👤 Owner: /team-feature <feature description>
         │
         ▼
    ORCHESTRATOR (lead)
    TeamCreate(superpower-<slug>)
    Spawn: solution-architect (Opus/high)
           feature-planner (Sonnet/high)
           [security-engineer] if regulated
         │
         ▼ Phase A
    Architect drives spec discussion
👤 Spec sign-off ◄── Touchpoint 1
    Architect writes arch-map
    Planner writes plan (plan-phases + waves)
👤 Plan approval ◄── Touchpoint 2
    Architect writes handover
    Architect → HANDOVER_READY
         │
         ▼
    Lead shuts down architect + planner + security
    Lead spawns team-leader (Opus/high)
         │
         ▼ Phases B–F (one per plan-phase)
    team-leader composes spawn-brief → SPAWN_REQUEST → lead
    lead reads brief → TaskCreate(s) → spawn impls → SPAWN_DONE
    impls: TDD → static checks → commit (self-claim next or shut down)
    After wave done: team-leader checks next wave OR runs phase-end review
    Phase-end review: scan diff vs arch-map (SOLID/DRY/domain)
                      violations → impl:rework-* tasks → re-dispatch
                      PHASE_COMPLETE <N> → lead
    Repeat per plan-phase.
    PLAN_COMPLETE → lead
         │
         ▼ Phase G
    Lead shuts down team-leader + remaining impls
    Lead spawns qc-engineer (Sonnet/high)
    qc-engineer: 5-step QC
         ├── QC_PASS → phase H
         └── QC_REWORK_NEEDED → re-spawn team-leader for rework dispatch
                                 (max 3 QC rounds)
         │
         ▼ Phase H
👤 Finish-branch decision ◄── Touchpoint 3 (merge / PR / keep / discarded)
    Lead: push + team cleanup + owner notification
```

## Restart-on-stuck (any phase)

If team-leader (or qc-engineer) posts `RESTART_REQUEST <reason>`:

```
team-leader → RESTART_REQUEST → orchestrator
                                     │
                                     ▼
                            👤 Recovery touchpoint
                                "Cycle restart needed: <reason>. Approve?"
                                     │
                                     ▼ approve
                            shut down all teammates
                            re-spawn architect + planner (+ security)
                            phase A re-runs with prior artefacts + partial commits as input
                            (max 2 restarts/feature; 3rd → manual intervention)
```

There is **no architect standby**. Mid-implementation architectural questions
trigger restart.

---

## Member peak

- Solo: 0 teammates (lead only).
- Single-agent: 1 teammate (implementer), then 1 (qc-engineer). Never both at once.
- Team:
  - Phase A peak: 2–3 (architect + planner [+ security])
  - Phases B–F peak: 1 (team-leader) + N implementers (3–5 typical). Total 4–6.
  - Phase G peak: 1 (qc-engineer).

All within docs' recommended 3–5 active teammates.
