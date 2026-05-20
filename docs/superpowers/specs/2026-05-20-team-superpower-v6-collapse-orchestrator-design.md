# team-superpower v6 — Collapse Orchestrator into Main Session

**Status:** Draft
**Date:** 2026-05-20
**Authors:** Steven Hoang, Claude (caveman mode)
**Supersedes (partial):** docs/superpowers/team-superpower-v5-spec.md §§ 3, 4, 7, 8.13, 9

## Problem

v5 ships an `orchestrator` agent as a dedicated sub-agent spawned by the main session. It owns: TeamCreate, sole spawning, phase transitions, SPAWN_REQUEST/RESTART_REQUEST handling, QC loop, push, cleanup. The lead command (`/team-feature`) does nothing except spawn the orchestrator and pass through the owner's launch message.

This adds an unnecessary layer:

- 4-level hierarchy in B–F (main → orchestrator → team-leader → impl) when 3 levels suffice.
- Two Opus contexts holding overlapping state (main + orchestrator).
- Extra hop on every owner ↔ team interaction (touchpoints, escalations, restart approval).
- Orphan-orchestrator failure mode (cleanup logic exists in `team-cleanup` to detect dead orchestrator).

## Goal

Collapse the `orchestrator` role into the main session. Main session becomes the sole spawner across all phases. Net: 8 → 7 agent files; hierarchy depth reduces by 1 in every phase.

## Non-Goals

- Changing the team-leader role or its decision-making scope (it stays as B–F internal coordinator).
- Changing teammate-side contracts (architect, planner, security, qc, BE/FE devs keep current frontmatter and prompts).
- Changing the wave-emission system, complexity heuristics, mode dispatch, MAX_ITERATIONS guardrail, or checkpoint v3 fields.
- Renaming the plugin or breaking existing `${slug}` artefact paths.

## Design

### 1. Role inventory (after)

| File | Role | Phase(s) | Model | Status vs v5 |
|---|---|---|---|---|
| `commands/team-feature.md` | **main session** — sole spawner, lifecycle owner, push, cleanup | A–H | Opus (enforced) | rewritten; absorbs orchestrator duties |
| `agents/solution-architect.md` | spec + arch-map | A | Opus | unchanged |
| `agents/feature-planner.md` | plan + wave schedule | A | Sonnet | unchanged |
| `agents/security-engineer.md` | security gate | A (regulated) | Opus / high | unchanged |
| `agents/team-leader.md` | internal coordinator — composes wave briefs, runs phase-end SOLID/DRY review, escalates to main | B–F | Opus | rewired: posts SPAWN_REQUEST to **main** (not orchestrator) |
| `agents/backend-developer.md` | impl | B–F | Sonnet / medium | prose updated where "orchestrator" appears |
| `agents/frontend-developer.md` | impl | B–F | Sonnet / medium | prose updated where "orchestrator" appears |
| `agents/qc-engineer.md` | QC | G | Sonnet | prose updated where "orchestrator" appears |
| `agents/orchestrator.md` | — | — | — | **DELETED** |

### 2. Hierarchy per phase (after)

```
Phase A    main → architect, planner, (security)
Phase B–F  main → team-leader (coordinator, no spawn)
           main → backend × N, frontend × N (per wave)
Phase G    main → qc-engineer
Phase H    main (push + cleanup; no spawn)
```

Concurrent teammate cap: **5** (unchanged). main is not counted.

### 3. Mode dispatch (after)

| Mode | Trigger | Shape |
|---|---|---|
| TEAM | default | as above, full phase chain A→H |
| SINGLE-AGENT | complexity heuristic small | main → 1 impl (BE or FE) → qc (sequential). No architect/planner/security/team-leader. |
| SOLO | complexity heuristic trivial | main → 1 developer (BE or FE). No qc, no planner. |

Net change vs v5:
- Q2: SINGLE-AGENT loses orchestrator hop. main spawns impl + qc directly.
- Q3: SOLO **gains 1 spawned developer**. Previously orchestrator did the work in-session; now main spawns one impl agent and shuts it down. Owner gets implementer's commit history same as larger modes.

### 4. SPAWN_REQUEST contract (after)

team-leader composes wave brief → writes `.team-superpower/spawn-briefs/wave-<p>.<w>.md` → posts `SPAWN_REQUEST wave=<p>.<w>` to mailbox addressed to **main session** (`to: main`). Channel unchanged: `.team-superpower/mailbox/<slug>/` files (per Q4: keep mailbox).

main poll loop:
1. Read mailbox file
2. For each `expected_task`: `TaskCreate` with `impl:` prefix + wave metadata
3. Spawn requested counts (enforce `max_concurrent_teammates`, queue excess)
4. Reply `SPAWN_DONE wave=<p>.<w> agent_ids=[...]`

Concurrency cap (5) enforced by main. Excess spawns queued with `queued: <ids>` reply.

### 5. RESTART_REQUEST contract (after)

team-leader (or any teammate) posts RESTART_REQUEST to main. main:
1. Present to owner for approval (touchpoint).
2. On approval: increment `.team-superpower/restart-count`, shut down all current teammates, re-spawn Phase A trio with existing spec + arch-map + plan + partial commits as input.
3. Phase A re-runs with delta scope; new handover supersedes prior.

### 6. Auto-resume (after)

Main session detects mid-feature resume by checking `.team-superpower/checkpoint.json` on `/team-feature` invocation. Per spec v5 §8.13 logic — moves verbatim into `commands/team-feature.md` body (was in `orchestrator.md`).

### 7. Touchpoints (unchanged count: ≤3)

1. Combined spec + plan approval (end of Phase A) — main holds it directly.
2. RESTART_REQUEST approval (if raised) — main holds it directly.
3. Final summary notification (Phase H) — main posts.

### 8. Files modified

**Deleted:**
- `plugins/team-superpower/agents/orchestrator.md`

**Heavy rewrite:**
- `plugins/team-superpower/commands/team-feature.md` — absorb full lifecycle from orchestrator.md prose
- `plugins/team-superpower/agents/team-leader.md` — retarget mailbox to `main`
- `plugins/team-superpower/.claude-plugin/plugin.json` — drop orchestrator from `agents[]`

**Prose updates** (replace `orchestrator` → `main` / `main session` where it appears as actor):
- `plugins/team-superpower/agents/backend-developer.md`
- `plugins/team-superpower/agents/frontend-developer.md`
- `plugins/team-superpower/agents/qc-engineer.md`
- `plugins/team-superpower/README.md`
- `plugins/team-superpower/assets/SESSION_README.md`
- `plugins/team-superpower/assets/ESCALATION.md`
- `plugins/team-superpower/hooks/teammate-idle.sh` — drop orphan-orchestrator detection branch (main session liveness is owner-visible)

**Tests updated:**
- `tests/team-superpower/v5/spawn-request.test.sh` — assert `to: main` not `to: orchestrator`
- `tests/team-superpower/v5/resume-detect.test.sh` — assert main session resume path, not orchestrator

**Docs updated** (changelog only, not retroactive rewrite of spec):
- `docs/superpowers/team-superpower-v5-spec.md` — add deprecation note pointing to v6 spec
- `docs/superpowers/agent-team-flows-v5.md` — same

**Marketplace + repo manifests:**
- `.claude-plugin/marketplace.json` — bump per-plugin `version`? No (CI rewrites)
- `package.json` — no change (files whitelist already covers)
- Root `README.md` — no row change (plugin still ships)

### 9. Migration / backwards compat

- Existing checkpoints (`.team-superpower/checkpoint.json` from v5 runs) include `orchestrator_agent_id`. On resume, main ignores that field if present (no error).
- Mailbox files addressed `to: orchestrator` from in-flight v5 runs: main reads either `to: main` or `to: orchestrator` for one release cycle, then drops `orchestrator` alias.
- `team-cleanup` command: drop orphan-orchestrator branch; keep orphan-team detection.

### 10. Risk

| Risk | Mitigation |
|---|---|
| main context bloat across long features | team-leader still filters B–F decisions; main only sees briefs + replies, not impl chatter. Touchpoint logs trimmed. |
| Loss of fault isolation (orch crash no longer survivable) | main session is owner-visible; crashes surface immediately. Owner restarts `/team-feature` and resume-detect picks up checkpoint. |
| Q3 solo regression (extra spawn vs in-session) | Acceptable per owner. Net cost: 1 agent spawn + shutdown per trivial feature. Benefit: uniform commit attribution + audit trail. |
| Doc drift between v5 and v6 spec | v5 spec gets deprecation banner pointing here. Active doc = this file. |

### 11. Success criteria

- `orchestrator.md` does not exist in repo
- `validate-agents` passes on all 7 remaining agent files (FAIL set unchanged from current state)
- `/team-feature <idea>` invokes main session that performs TeamCreate, all phase A spawns, B–F dispatch, G qc, H push without spawning an `orchestrator` agent
- All `tests/team-superpower/v5/*.test.sh` pass after assertion rewrites
- `grep -r orchestrator plugins/team-superpower/` returns 0 hits (except possibly in archived changelog notes)

## Open questions

None — Q2/Q3/Q4 resolved per owner answers above.

## Out of scope

- Renaming `team-superpower` → `team-superpower-v6` (stays same plugin name)
- Touching `team-cleanup.md` command beyond removing orphan-orch branch
- New telemetry/logging
