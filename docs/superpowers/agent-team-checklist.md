# v5 Agent Team — Acceptance Checklist

Use this checklist to verify v5 implementation. Each item maps to spec §12.

## Single-team model (spec §3.1)
- [ ] Exactly one TeamCreate per feature (team mode).
- [ ] Membership matches phase: A → architect+planner[+security]; B–F → team-leader + impls; G → qc-engineer.
- [ ] No phase-A teammates alive after phase A end.
- [ ] Architect NOT alive during phases B–F (no standby).

## SPAWN_REQUEST protocol (spec §3.4)
- [ ] team-leader does NOT TeamCreate or spawn teammates.
- [ ] team-leader writes brief to `.team-superpower/spawn-briefs/wave-<id>.md` per wave.
- [ ] team-leader posts SPAWN_REQUEST to lead.
- [ ] Lead TaskCreates each expected_task and spawns implementers.
- [ ] TaskCreated hook rejects `impl:*` without valid `wave:` reference.

## Phase-end leader review (spec §6.5)
- [ ] team-leader produces phase review log at `docs/superpowers/reviews/<date>-<slug>-phase-<N>-leader-review.md`.
- [ ] Violations become `impl:rework-*` tasks.
- [ ] PHASE_COMPLETE only after rework done.
- [ ] Seeded SOLID violation produces rework task (test: `tests/team-superpower/v5/phase-end-review.test.sh`).

## End-of-plan QC (spec §7)
- [ ] qc-engineer spawned once per feature post-PLAN_COMPLETE.
- [ ] QC report at `docs/superpowers/reviews/<date>-<slug>-qc-report.md`.
- [ ] Blocking issues → `impl:rework-qc-*` tasks; team-leader re-spawned.
- [ ] Max 3 QC rounds; 4th → owner escalation.

## Restart-on-stuck (spec §3.1)
- [ ] team-leader posts RESTART_REQUEST instead of attempting standby.
- [ ] Lead presents recovery touchpoint on RESTART_REQUEST.
- [ ] On approval: shut down all, re-spawn architect+planner with prior artefacts + partial commits.
- [ ] Max 2 restarts; 3rd → escalate.

## No per-task QA (spec §8.6, §8.7)
- [ ] No `qa-engineer` agent file or spawn.
- [ ] Commits do NOT contain `QA-verified:` lines.
- [ ] `task-completed.sh` no longer checks `qa_verified_at:` or `MISSING_QA_VERIFICATION`.

## Static-check self-enforcement (spec §8.9, §8.12)
- [ ] Each `impl:*` commit produces `.team-superpower/static-check-<task-id>.log`.
- [ ] Hook rejects with `MISSING_STATIC_CHECKS` if log absent or non-zero.
- [ ] Simulated lint failure → fix + retry → green log → commit.

## Auto-resume (spec §8.13)
- [ ] `commands/team-feature-resume.md` deleted.
- [ ] `/team-feature` auto-detects in-progress features (test: `tests/team-superpower/v5/resume-detect.test.sh`).
- [ ] Single resume prompt presented on detect.

## Handover artefacts (spec §8.14)
- [ ] Post-phase-A: spec, arch-map, plan, handover all exist at canonical paths.
- [ ] `docs/superpowers/handovers/README.md` documents the artefact contract.
- [ ] Handover includes restart-policy note.

## Touchpoint counts (spec §10)
- [ ] Solo: 1 touchpoint.
- [ ] Single-agent: 1 touchpoint.
- [ ] Team: 2 phase-A touchpoints + 1 phase-H finish-branch touchpoint = 3 total.
- [ ] Recovery touchpoints (RESTART_REQUEST, model fallback, CI timeout) NOT counted (test: `tests/team-superpower/v5/touchpoint-count.test.sh`).

## File deletions
- [ ] `plugins/team-superpower/agents/designer.md` removed.
- [ ] `plugins/team-superpower/agents/reviewer.md` removed.
- [ ] `plugins/team-superpower/agents/qa-engineer.md` removed.
- [ ] `plugins/team-superpower/agents/planner.md` removed (replaced by `feature-planner.md`).
- [ ] `plugins/team-superpower/agents/software-architect.md` removed (replaced by `solution-architect.md`).
- [ ] `plugins/team-superpower/commands/team-feature-resume.md` removed.

## Hooks (spec §8.9–§8.11)
- [ ] `task-completed.sh`: MISSING_STATIC_CHECKS + MISSING_REWORK_REFERENCE present; v4 QA checks removed.
- [ ] `task-created.sh`: accepts `impl:rework-*`; enforces v5 wave shape (`<phase>.<wave>` | `<phase>.rework` | `qc-rework`).
- [ ] `teammate-idle.sh`: role-aware idle routing (orchestrator | team-leader | qc-engineer | phase-A | impls).

## Platform compliance (Claude Code Agent Teams)
- [ ] No nested teams (only lead spawns).
- [ ] One team at a time (no concurrent TeamCreate within a feature).
- [ ] Lead = orchestrator (fixed for team lifetime).
- [ ] Native hooks: TeammateIdle / TaskCreated / TaskCompleted (no custom mailbox files).

## Documentation
- [ ] `plugins/team-superpower/README.md` overview matches v5.
- [ ] `plugins/team-superpower/assets/SESSION_README.md` documents single-team lifecycle.
- [ ] `plugins/team-superpower/assets/ESCALATION.md` lists three classes (tactical/cross-role/architectural).
- [ ] `docs/superpowers/agent-team-flows-v5.md` reflects single-team flow.
- [ ] `docs/superpowers/team-superpower-v5-spec.md` is the canonical spec.
