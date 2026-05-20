# team-superpower v6 — Implementation Plan: Collapse Orchestrator

**Spec:** `docs/superpowers/specs/2026-05-20-team-superpower-v6-collapse-orchestrator-design.md`
**Date:** 2026-05-20
**Estimated total effort:** ~3 hours focused work; recommended to execute in a fresh session (not the brainstorm session).

## Execution strategy

Two-wave dispatch — wave 1 reshapes the command + agent contracts; wave 2 propagates prose + tests. Each task lists exact file paths and acceptance.

The plan is structured for either manual execution by a single implementer OR dispatch via `/team-feature` itself (dogfooding) once Task 1 lands.

---

## Wave 1 — Core lifecycle migration

### Task 1 — Rewrite `commands/team-feature.md` to absorb orchestrator role

**Files:**
- `plugins/team-superpower/commands/team-feature.md` (write)
- `plugins/team-superpower/agents/orchestrator.md` (read, then delete in Task 7)

**Steps:**
1. Open both files side-by-side.
2. In `team-feature.md`, replace the section starting "You spawn the `orchestrator` agent type to perform all in-feature work" with the full lifecycle body from `orchestrator.md` (Phase A trio spawn, touchpoints, RESTART_REQUEST flow, mode dispatch, auto-resume detection, Phase G qc loop, Phase H push + cleanup).
3. Rewrite every `orchestrator` → `main session` actor reference.
4. Keep the Opus-required preamble and `--explain` flag handling.
5. Preserve checkpoint v3 fields, MAX_ITERATIONS guard, complexity heuristic invocation.

**Acceptance:**
- `grep -c orchestrator plugins/team-superpower/commands/team-feature.md` returns 0.
- Lifecycle from owner launch → Phase H complete is described entirely in this file (no "spawn orchestrator" instruction).
- Auto-resume detection logic (spec §8.13) present in the command body.

---

### Task 2 — Rewrite `agents/team-leader.md` mailbox target

**Files:**
- `plugins/team-superpower/agents/team-leader.md` (edit)

**Steps:**
1. Find every `SPAWN_REQUEST` / `RESTART_REQUEST` / `ESCALATION` posting instruction.
2. Replace mailbox `to: orchestrator` → `to: main`.
3. Replace prose "post to orchestrator" → "post to main session".
4. Keep team-leader scope identical otherwise (briefs, SOLID/DRY review, no spawn).

**Acceptance:**
- `grep -c orchestrator plugins/team-superpower/agents/team-leader.md` returns 0.
- Brief composition + phase-end review duties unchanged in substance.

---

### Task 3 — Drop orchestrator from `plugin.json`

**Files:**
- `plugins/team-superpower/.claude-plugin/plugin.json` (edit)

**Steps:**
1. If `agents` array exists and lists `orchestrator`, remove the entry.
2. If `agents` is not declared, no change needed (auto-discovery picks up files; deletion in Task 7 will remove it).

**Acceptance:**
- JSON parses (validate via `python3 -c "import json; json.load(open('plugins/team-superpower/.claude-plugin/plugin.json'))"`).
- No `orchestrator` string present.

---

## Wave 2 — Prose + tests + cleanup

### Task 4 — Prose updates in remaining agent files

**Files:**
- `plugins/team-superpower/agents/backend-developer.md`
- `plugins/team-superpower/agents/frontend-developer.md`
- `plugins/team-superpower/agents/qc-engineer.md`

**Steps:**
1. In each file, replace `orchestrator` → `main session` where it refers to the lifecycle owner / spawner.
2. Keep references that are about other plugins (`Skill(orchestrating-research)` etc, if any) — none in team-superpower.

**Acceptance:**
- `grep -c orchestrator plugins/team-superpower/agents/{backend,frontend,qc}-*.md` returns 0 in each.
- No frontmatter changes (model, tools, effort unchanged).

---

### Task 5 — Prose updates in README + assets

**Files:**
- `plugins/team-superpower/README.md`
- `plugins/team-superpower/assets/SESSION_README.md`
- `plugins/team-superpower/assets/ESCALATION.md`

**Steps:** Same as Task 4 — replace actor references; keep historical/architectural mentions only if framed as v5 deprecation.

**Acceptance:** `grep -c orchestrator plugins/team-superpower/{README.md,assets/*.md}` returns 0.

---

### Task 6 — Update `hooks/teammate-idle.sh`

**Files:**
- `plugins/team-superpower/hooks/teammate-idle.sh` (edit)

**Steps:**
1. Find orphan-orchestrator detection branch.
2. Delete that branch (main session liveness is owner-visible; no orphan-main case).
3. Keep orphan-teammate detection for other roles.

**Acceptance:**
- `bash -n plugins/team-superpower/hooks/teammate-idle.sh` parses.
- Existing tests for orphan-teammate detection (other roles) still pass.

---

### Task 7 — Delete `agents/orchestrator.md`

**Files:**
- `plugins/team-superpower/agents/orchestrator.md` (delete via `git rm`)

**Steps:**
1. `git rm plugins/team-superpower/agents/orchestrator.md`
2. Sanity check: `ls plugins/team-superpower/agents/` shows 7 files.

**Acceptance:** File absent; `grep -r orchestrator plugins/team-superpower/` returns 0 (or only archived changelog notes).

---

### Task 8 — Update tests

**Files:**
- `tests/team-superpower/v5/spawn-request.test.sh`
- `tests/team-superpower/v5/resume-detect.test.sh`

**Steps:**
1. `spawn-request.test.sh`: change assertion `to: orchestrator` → `to: main`.
2. `resume-detect.test.sh`: assert main session resume path; remove any orchestrator-spawn assertion.
3. If new behavior (Q3 solo spawns 1 dev), add a SOLO-mode test that verifies main spawns exactly 1 implementer.

**Acceptance:**
- `bash tests/team-superpower/v5/spawn-request.test.sh` exits 0.
- `bash tests/team-superpower/v5/resume-detect.test.sh` exits 0.
- New SOLO test (if added) exits 0.

---

### Task 9 — Add deprecation banner to v5 spec + flows doc

**Files:**
- `docs/superpowers/team-superpower-v5-spec.md` (edit)
- `docs/superpowers/agent-team-flows-v5.md` (edit)

**Steps:** Prepend a single-paragraph deprecation banner pointing to the v6 spec. Do not retroactively rewrite v5 content.

**Acceptance:** Banner present at top of each file, links resolve.

---

### Task 10 — Validate + commit + push

**Steps:**
1. Run validate-agents skill on `plugins/team-superpower/`. Expect PASS for all 7 agents.
2. Run validate-commands skill. Expect PASS.
3. Run validate-hooks skill. Expect PASS.
4. `python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"` → prints `OK`.
5. `git add` only files in `plugins/team-superpower/`, `tests/team-superpower/`, `docs/superpowers/`.
6. Commit message: `feat(team-superpower): collapse orchestrator into main session (v6)` with co-author trailer.
7. Do not push automatically — wait for owner confirmation.

**Acceptance:** Working tree clean after commit; all validators green; CI doesn't fail on the next push.

---

## Task dependency graph

```
Task 1 ─┬─► Task 4 ─┐
        ├─► Task 5 ─┤
Task 2 ─┘           ├─► Task 7 ─► Task 10
                    │
Task 3 ─────────────┤
Task 6 ─────────────┤
Task 8 ─────────────┤
Task 9 ─────────────┘
```

Tasks 1–3 are pre-requisites for Task 7 (delete). Task 10 is the final gate.

## Out of scope (deferred)

- Renaming the plugin or moving paths.
- Bumping `version` in plugin.json or marketplace.json (CI handles).
- Touching `team-cleanup.md` beyond what Task 6 needs.

## Rollback

`git revert <commit-sha>` restores `orchestrator.md` and reverts all prose changes. No data migration needed (checkpoints are forward-compatible per spec §9).
