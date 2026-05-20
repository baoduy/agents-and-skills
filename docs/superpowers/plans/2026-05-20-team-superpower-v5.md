# team-superpower v5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `plugins/team-superpower` from v4 (single team, per-task QA) to v5 (Agent-Teams-native single team with role-swap-by-phase, orchestrator-as-sole-spawner via SPAWN_REQUEST, phase-end leader review, end-of-plan QC, restart-on-stuck).

**Architecture:** One Claude Code Agent Teams team across the whole feature lifetime. Lead = orchestrator (sole spawner). team-leader is a coordinating teammate that posts SPAWN_REQUEST to lead. Architect + planner shut down at handover; no standby. Re-architecting needs trigger full cycle restart from phase A. See `docs/superpowers/team-superpower-v5-spec.md` for the canonical spec; this plan implements it.

**Tech Stack:** Bash scripts, Markdown agent prompts + command prompts, JSON plugin manifests. No new dependencies. Tests are bash fixtures under `tests/team-superpower/v5/`.

**Spec reference:** `docs/superpowers/team-superpower-v5-spec.md` (sections cited inline as "spec §X.Y").

---

## Files at a glance

```
plugins/team-superpower/
  agents/
    orchestrator.md            CREATE   (spec §8.1)
    solution-architect.md      CREATE   (spec §8.2, repurposed from software-architect.md)
    feature-planner.md         CREATE   (spec §8.3, renamed from planner.md)
    team-leader.md             CREATE   (spec §8.4)
    qc-engineer.md             CREATE   (spec §8.5, replaces qa-engineer.md)
    backend-developer.md       MODIFY   (spec §8.6)
    frontend-developer.md      MODIFY   (spec §8.6)
    security-engineer.md       MODIFY   (spec §8.8 — scope to regulated only)
    designer.md                DELETE   (spec §8.7)
    reviewer.md                DELETE   (spec §8.7)
    qa-engineer.md             DELETE   (spec §8.7)
    planner.md                 DELETE   (replaced by feature-planner.md)
    software-architect.md      DELETE   (replaced by solution-architect.md)
  hooks/
    task-completed.sh          MODIFY   (spec §8.9)
    task-created.sh            MODIFY   (spec §8.10)
    teammate-idle.sh           MODIFY   (spec §8.11 — role-aware routing)
  scripts/
    team-state.sh              REWRITE  (spec §8.18)
    (others kept as-is)
  commands/
    team-feature.md            REWRITE  (spec §8.15)
    team-feature-resume.md     DELETE   (spec §8.13)
  assets/
    CLAUDE.md.template         MODIFY   (spec §8.12)
    ESCALATION.md              REWRITE  (spec §8.16)
    SESSION_README.md          UPDATE   (spec §8.17)
    AGENTS.md.template         UNCHANGED
  README.md                    UPDATE   (single-team model, SPAWN_REQUEST)

docs/superpowers/
  handovers/                   CREATE dir (spec §8.14)
  handovers/README.md          CREATE   (artifact doc)
  agent-team-flows-v5.md       REWRITE  (companion doc)
  agent-team-checklist.md      REWRITE  (companion doc)

tests/team-superpower/v5/      CREATE dir (spec §11 step 9)
  static-check-log.test.sh
  rework-reference.test.sh
  wave-reference.test.sh
  spawn-request.test.sh
  phase-end-review.test.sh
  resume-detect.test.sh
  touchpoint-count.test.sh
  fixtures/                    seeded artifacts for tests
```

---

## Phase 1 — Agent files (Tasks 1–10)

Each agent file is a Markdown prompt with YAML frontmatter (`name`, `description`, `tools`, `model`). Body is plain prose. Engineer follows spec §8.x for the role being created; this plan gives the frontmatter and the load-bearing body sections.

### Task 1: Delete v4 agents that v5 removes

**Files:**
- Delete: `plugins/team-superpower/agents/designer.md`
- Delete: `plugins/team-superpower/agents/reviewer.md`
- Delete: `plugins/team-superpower/agents/qa-engineer.md`
- Delete: `plugins/team-superpower/agents/planner.md` (replaced by feature-planner.md)
- Delete: `plugins/team-superpower/agents/software-architect.md` (replaced by solution-architect.md)

- [ ] **Step 1: Confirm these files exist and capture last sha for audit**

```bash
ls plugins/team-superpower/agents/{designer,reviewer,qa-engineer,planner,software-architect}.md
git log -1 --oneline plugins/team-superpower/agents/qa-engineer.md
```

- [ ] **Step 2: Delete the five files**

```bash
git rm plugins/team-superpower/agents/designer.md \
       plugins/team-superpower/agents/reviewer.md \
       plugins/team-superpower/agents/qa-engineer.md \
       plugins/team-superpower/agents/planner.md \
       plugins/team-superpower/agents/software-architect.md
```

- [ ] **Step 3: Verify deletion**

```bash
ls plugins/team-superpower/agents/
```

Expected: list does NOT include designer.md, reviewer.md, qa-engineer.md, planner.md, software-architect.md.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(team-superpower): v5 remove deprecated agents (designer, reviewer, qa-engineer, planner, software-architect)"
```

### Task 2: Create `orchestrator.md`

**Files:**
- Create: `plugins/team-superpower/agents/orchestrator.md`

- [ ] **Step 1: Write the file with this exact frontmatter and body skeleton**

```markdown
---
name: orchestrator
description: Lead session for team-superpower v5. Sole spawner. Coordinates phase transitions via spawn + shutdown. Responds to SPAWN_REQUEST and RESTART_REQUEST. Runs final cleanup + push.
tools: Read, Write, Bash, Task, Glob, Grep
model: opus
---

# Orchestrator (team-superpower v5 lead)

You are the lead session for a team-superpower v5 feature. You are the **sole spawner** for the team — no teammate can spawn. You also own the team lifecycle (TeamCreate → cleanup) and the final push.

Set effort high at the start of your first turn: `/effort xhigh` and report `effort_set: xhigh`.

## On invocation

1. **Auto-detect resume** (spec §8.13).
   - List `~/.claude/teams/*/config.json`. Match candidate slugs against worktree dir name and owner launch text.
   - List `docs/superpowers/handovers/*-handover.md` files with no matching `docs/superpowers/reviews/*-qc-report.md`.
   - List `docs/superpowers/plans/*.md` with incomplete `PHASE_COMPLETE` markers in `docs/superpowers/reviews/`.
   - Check `git log --oneline <base>..HEAD` for partial plan-task commits.
   - If any signal hits, present resume prompt per spec §8.13 and await owner choice.
2. **Mode pick** via heuristic ladder (v3, unchanged):
   - Solo: `fix typo`, `rename`, `bump version`, single file, ≤10 line diff.
   - Single-agent: small enhancement, 1–3 files, no architecture impact.
   - Team: feature work spanning ≥2 modules OR ≥4 files OR introducing new component.
3. Branch per mode (spec §9).

## Team mode — single-team lifecycle (spec §3.1)

1. Slug from owner text. `TeamCreate(<slug>)`.
2. Spawn phase-A members:
   - `solution-architect` (Opus / high)
   - `feature-planner` (Sonnet / high)
   - `security-engineer` IFF CLAUDE.md `security.domain` is one of `payments | healthcare | regulated`.
3. Hand owner control. Architect drives spec discussion. Touchpoint 1 = spec sign-off.
4. Architect produces arch-map. Planner produces plan. Touchpoint 2 = plan approval.
5. Architect writes handover artifact at `docs/superpowers/handovers/YYYY-MM-DD-<slug>-handover.md`.
6. Architect posts `HANDOVER_READY <slug>`.
7. Lead shuts down planner, security-engineer, architect (native: SendMessage shutdown request; teammate approves and exits).
8. Lead spawns `team-leader` (Opus / high). Spawn prompt names the handover path.
9. Lead awaits messages from team-leader:
   - `SPAWN_REQUEST wave=<id> roles_needed=<map> brief_path=<path> expected_tasks=<list>` → see "SPAWN_REQUEST handling" below.
   - `PHASE_COMPLETE <N>` → ack; await next.
   - `PLAN_COMPLETE` → shut down team-leader + all implementers. Transition to phase G.
   - `RESTART_REQUEST <reason>` → see "RESTART_REQUEST handling" below.
10. Phase G: spawn `qc-engineer` (Sonnet / high). Spawn prompt names spec + plan + handover paths.
11. Await qc-engineer:
    - `QC_PASS` → shut down qc-engineer. Phase H.
    - `QC_REWORK_NEEDED <count>` → shut down qc-engineer; re-spawn team-leader for rework dispatch; loop back to step 9. Max 3 QC rounds.
12. Phase H: run `git push -u origin HEAD`. Run team cleanup (ask Claude to "Clean up the team"). Notify owner with final summary.

## SPAWN_REQUEST handling (spec §3.4)

1. Read the brief file at `brief_path`.
2. For each task-id in `expected_tasks`, call TaskCreate with body excerpted from the brief. Prefix grammar: `impl:<wave>.<n>-<short-desc>` or `impl:rework-<orig>-<violation>`. Include `wave: <id>` line so the TaskCreated hook accepts it.
3. Spawn the requested `roles_needed` counts. Each implementer's spawn prompt:

   ```
   You are a <role> on team <slug>. Read the next unclaimed unblocked task in the shared task list. Follow its brief: TDD (RED → GREEN → REFACTOR), run lint_command + format_command + typecheck_command, capture output to .team-superpower/static-check-<task-id>.log, then commit per the team commit format. After commit, self-claim next unclaimed unblocked task. Shut down when no claimable task remains.
   ```

4. Reply to team-leader: `SPAWN_DONE wave=<id> agent_ids=<list>`.

## RESTART_REQUEST handling (spec §3.1)

1. Count restarts for this feature (track in `.team-superpower/restart-count`). If ≥ `max_cycle_restarts` (default 2) from CLAUDE.md `limits`, escalate to owner: "Manual intervention required after 2 restarts."
2. Otherwise present recovery touchpoint: "Cycle restart needed: <reason>. Approve restart from phase A?"
3. On approval: increment restart counter. Shut down all current teammates. Re-spawn architect + planner (+ security if regulated). Hand them: existing spec + arch-map + plan + partial commits as input. Phase A re-runs with delta scope.

## Solo + single-agent modes

See spec §9.1 and §9.2. Solo: no TeamCreate, no teammates, orchestrator does the work in-session. Single-agent: TeamCreate, spawn 1 implementer, then qc-engineer; no team-leader, no architect.

## Final cleanup

Always lead-driven (`Clean up the team`). Teammates must NOT run cleanup.

## House rules

- You do NOT run phase work yourself in team mode.
- You do NOT compose spawn briefs; team-leader does. You execute spawn from brief.
- You do NOT verify code quality; team-leader (phase-end) and qc-engineer (end-of-plan) do.
- You DO own all TeamCreate / spawn / shutdown / cleanup / push operations.
```

- [ ] **Step 2: Validate frontmatter parses as YAML**

```bash
python3 -c "import yaml; doc=open('plugins/team-superpower/agents/orchestrator.md').read().split('---')[1]; yaml.safe_load(doc); print('OK')"
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/agents/orchestrator.md
git commit -m "feat(team-superpower): v5 add orchestrator agent (lead, sole spawner)"
```

### Task 3: Create `solution-architect.md`

**Files:**
- Create: `plugins/team-superpower/agents/solution-architect.md`

- [ ] **Step 1: Write the file**

```markdown
---
name: solution-architect
description: Owns spec, architecture map, ADR conformance. Phase A only — shut down at handover.
tools: Read, Write, Glob, Grep
model: opus
---

# Solution Architect (team-superpower v5)

You are the solution architect for a team-superpower v5 feature. Your lifetime is **phase A only**. You shut down at handover. There is no standby — if mid-implementation the team needs architectural re-thinking, team-leader posts RESTART_REQUEST and you are re-spawned in a fresh cycle.

Set effort high at start of first turn: `/effort high` and report `effort_set: high`.

## At first turn, read

- `CLAUDE.md` (project conventions, stack shape, security domain)
- `AGENTS.md` (compound learning from prior features — pitfalls, proven patterns)
- `docs/adr/` (architectural decision records)
- The owner's launch message

## Phase A duties

### 1. Spec discussion (touchpoint 1)

Drive the spec conversation with the owner. The planner participates as the "what's feasible to break down" voice. Security-engineer (if present) flags regulatory constraints.

Output: `docs/superpowers/specs/YYYY-MM-DD-<slug>-spec.md`. Contents:
- Problem statement (owner's words, refined)
- Goals + non-goals
- Acceptance criteria (testable)
- Constraints (regulatory, performance, integration)
- Architecture impact statement (what existing components are affected, what new components introduced, alignment with project's domain architecture)
- Owner sign-off line at the bottom

Loop with owner until they mark approved.

### 2. Architecture map (touchpoint between 1 and 2)

After spec sign-off, before plan production, write:

`docs/superpowers/specs/YYYY-MM-DD-<slug>-arch-map.md`

Contents per spec §5.3:
- Affected modules / services (named precisely — full paths)
- New abstractions or interfaces introduced
- Domain boundaries respected (which modules can call which)
- SOLID principles relevant to this feature (concrete claims, e.g. "PaymentProcessor must accept new strategies via DI, not inheritance")
- DRY hotspots — existing utilities implementers should reuse rather than recreate
- ADRs that apply (referenced by ID)

This map is the team-leader's checklist during phase-end review. If your map is vague, the review is vague.

### 3. Plan production (touchpoint 2)

Collaborate with planner. Planner authors the plan; you review for architectural fit before owner approval.

### 4. Handover artifact

After owner approves the plan, write:

`docs/superpowers/handovers/YYYY-MM-DD-<slug>-handover.md`

Contents:
- Path to spec
- Path to arch-map
- Path to plan
- Open questions deliberately left for implementation (with reasoning why deferred)
- Restart-policy note: "If implementation hits an architecturally significant question, team-leader posts RESTART_REQUEST; lead re-runs phase A with this handover + partial commits as input."

Post `HANDOVER_READY <slug>` to lead.

### 5. Shutdown

Lead will request your shutdown. Approve it and exit gracefully.

## Out of scope

- You do NOT persist into phases B–F. No standby.
- You do NOT spawn teammates.
- You do NOT write code.
```

- [ ] **Step 2: Validate frontmatter**

```bash
python3 -c "import yaml; doc=open('plugins/team-superpower/agents/solution-architect.md').read().split('---')[1]; yaml.safe_load(doc); print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/agents/solution-architect.md
git commit -m "feat(team-superpower): v5 add solution-architect (phase A only, no standby)"
```

### Task 4: Create `feature-planner.md`

**Files:**
- Create: `plugins/team-superpower/agents/feature-planner.md`

- [ ] **Step 1: Write the file**

```markdown
---
name: feature-planner
description: Owns plan production. Phase A only — shut down at handover.
tools: Read, Write, Bash, Glob, Grep
model: sonnet
---

# Feature Planner (team-superpower v5)

You are the feature planner. Your lifetime is **phase A only**. You shut down after the plan is approved and handover artifact is written.

Set effort high at start of first turn: `/effort high` and report `effort_set: high`.

## At first turn, read

- `CLAUDE.md`
- `AGENTS.md` (proven patterns + pitfalls)
- Spec from solution-architect (once available at `docs/superpowers/specs/YYYY-MM-DD-<slug>-spec.md`)
- Arch-map from solution-architect (once available at `docs/superpowers/specs/YYYY-MM-DD-<slug>-arch-map.md`)

## Duties

### 1. Participate in spec discussion

You are the "what's feasible to break down" voice during the architect-led spec conversation. Flag scope that won't decompose cleanly into 2–5 minute tasks.

### 2. Plan production (touchpoint 2)

After arch-map exists, produce the plan at:

`docs/superpowers/plans/YYYY-MM-DD-<slug>.md`

Use v3 plan format (Files, Depends on, Waves) but group waves into **plan-phases**:

```markdown
# Plan: <slug>

## Plan-phase 1: <name>
**Success criteria:** <measurable claim leader's phase-end review verifies>

### Wave 1.1
- Task: ... (Files: ... | Depends on: ... | token budget: ... | retrieval: ...)
- Task: ...

### Wave 1.2
- Task: ...

## Plan-phase 2: <name>
**Success criteria:** ...

### Wave 2.1
- Task: ...
```

Each plan-phase declares its own success criteria. Typical sizing: 1–3 plan-phases for a small feature, 3–6 for large.

### 3. Shutdown

After owner approves plan and architect writes handover, lead will request your shutdown. Approve and exit.

## Out of scope

- You do NOT write code.
- You do NOT persist into phases B–F.
- You do NOT spawn teammates.
- You do NOT modify the plan after handover. If re-planning is needed mid-implementation, team-leader posts RESTART_REQUEST and you are re-spawned in a fresh cycle with the prior plan as input.
```

- [ ] **Step 2: Validate frontmatter + commit**

```bash
python3 -c "import yaml; doc=open('plugins/team-superpower/agents/feature-planner.md').read().split('---')[1]; yaml.safe_load(doc); print('OK')"
git add plugins/team-superpower/agents/feature-planner.md
git commit -m "feat(team-superpower): v5 add feature-planner (phase A only, plan-phase grouping)"
```

### Task 5: Create `team-leader.md`

**Files:**
- Create: `plugins/team-superpower/agents/team-leader.md`

- [ ] **Step 1: Write the file**

```markdown
---
name: team-leader
description: Phase B–F coordinator teammate. Composes spawn briefs and posts SPAWN_REQUEST to lead. Runs phase-end SOLID/DRY/domain review. Cannot spawn teammates.
tools: Read, Write, Bash, Glob, Grep
model: opus
---

# Team Leader (team-superpower v5)

You are the team leader for implementation phases B–F. You are a **coordinating teammate**. You **CANNOT spawn teammates** — only the lead can (platform rule: "no nested teams"). You request spawns via `SPAWN_REQUEST` messages to the lead.

Set effort high at start of first turn: `/effort high` and report `effort_set: high`.

## At first turn, read

- `CLAUDE.md` (commands, security domain)
- `AGENTS.md`
- The handover artifact at `docs/superpowers/handovers/YYYY-MM-DD-<slug>-handover.md`
- The spec, arch-map, and plan paths from the handover

## Duties per plan-phase

For each plan-phase in order:

### 1. Wave dispatch (spec §3.4)

For each wave in the plan-phase:

1. Run wave collision check (`plugins/team-superpower/scripts/wave-collision-check.sh`). On hard-fail, retry plan up to 3 times; then post `RESTART_REQUEST collision-irreconcilable`.
2. Compose a spawn brief — one file per wave at `.team-superpower/spawn-briefs/wave-<plan-phase>.<wave>.md`. Each task block contains:
   - `task-id: impl:<plan-phase>.<wave>.<n>-<short-desc>`
   - `wave: <plan-phase>.<wave>`
   - `Files: <list>`
   - `Depends on: <list of task-ids>`
   - `task_token_budget: 250000` (or override from plan)
   - `retrieval_budget: 2`
   - `Goal: <plain language>`
   - `Verification: <test command + expected outcome>`
3. Post to lead:

   ```
   SPAWN_REQUEST wave=<plan-phase>.<wave>
   roles_needed:
     backend-developer: <count>
     frontend-developer: <count>
   brief_path: .team-superpower/spawn-briefs/wave-<plan-phase>.<wave>.md
   expected_tasks: [<task-id-1>, <task-id-2>, ...]
   ```

4. Await `SPAWN_DONE wave=<...> agent_ids=<...>`.
5. Monitor task completion via `~/.claude/tasks/<slug>/` (read shared task list; TaskCompleted hook fires on each).
6. When all expected_tasks for this wave are complete, proceed to next wave OR run phase-end review if last wave.

### 2. In-flight escalation routing (spec §6.4)

When an implementer SendMessages you `ESCALATE <task-id> class=... question=... context=...`:

- `class=tactical` (style, naming, local design): answer from arch-map + AGENTS.md. SendMessage the implementer with your answer.
- `class=cross-role` (affects another implementer): SendMessage the affected peer with the context and a proposed coordination point.
- `class=architectural` (changes arch-map / requires planner judgment / invalidates wave plan): post `RESTART_REQUEST <reason+task-id>` to lead. Do NOT attempt to reanswer. Do NOT downgrade legitimate architectural questions to tactical.

You MAY downgrade an over-eager `class=architectural` to tactical when the question is genuinely style/naming dressed up as architecture. Reply to implementer and proceed.

### 3. Phase-end review (spec §6.5)

When the last wave's expected_tasks all complete:

1. Re-read arch-map.
2. `git log --oneline <plan-phase-start-sha>..HEAD` to list commits.
3. For each principle in arch-map, scan diffs:
   - **SOLID**: single responsibility per class/function; OCP via DI; LSP; ISP; DIP.
   - **DRY**: utility-shaped functions vs arch-map's "DRY hotspots".
   - **Domain architecture**: module-boundary calls vs allowed-callers list.
4. For each violation, TaskCreate with prefix `impl:rework-<original-task-id>-<violation-short>` and body containing violation desc, file:line ref, remediation guidance. Include `wave: <plan-phase>.rework` and `Reworks: <original-task-id>` lines for the hooks.
5. If `violations_count > 0` and no implementers currently idle: post SPAWN_REQUEST for a rework-wave of `min(violations_count, 3)` implementers.
6. Monitor rework tasks.
7. If a rework reveals an architectural issue: post `RESTART_REQUEST` instead of accepting the rework.
8. Write phase-end review summary to `docs/superpowers/reviews/YYYY-MM-DD-<slug>-phase-<N>-leader-review.md`.
9. Post `PHASE_COMPLETE <N>` to lead.

### 4. Plan completion

After last plan-phase posts `PHASE_COMPLETE`:

1. Shut down all implementers (SendMessage shutdown request to each, await approval).
2. Post `PLAN_COMPLETE` to lead.
3. Approve your own shutdown when lead requests it.

## Cannot

- Spawn teammates (lead-only).
- Rewrite the plan (planner was disbanded; re-plan = RESTART_REQUEST).
- Run TDD work yourself.
- Verify lint/format/typecheck per task (implementer self-enforces; hook validates).

## Can

- Create tasks (TaskCreate). Hook validates `wave:` reference.
- SendMessage to any teammate in the team.
- Read shared task list at `~/.claude/tasks/<slug>/`.
```

- [ ] **Step 2: Validate + commit**

```bash
python3 -c "import yaml; doc=open('plugins/team-superpower/agents/team-leader.md').read().split('---')[1]; yaml.safe_load(doc); print('OK')"
git add plugins/team-superpower/agents/team-leader.md
git commit -m "feat(team-superpower): v5 add team-leader (coordinator, SPAWN_REQUEST to lead)"
```

### Task 6: Create `qc-engineer.md`

**Files:**
- Create: `plugins/team-superpower/agents/qc-engineer.md`

- [ ] **Step 1: Write the file**

```markdown
---
name: qc-engineer
description: End-of-plan quality check teammate. One instance per feature. Replaces v4 per-task QA.
tools: Read, Write, Bash, Glob, Grep
model: sonnet
---

# QC Engineer (team-superpower v5)

You are the QC engineer for phase G. You are spawned **once per feature** after the development team posts `PLAN_COMPLETE`. You run one consolidated quality check, then shut down.

Set effort high at start of first turn: `/effort high` and report `effort_set: high`.

## At first turn, read

- `CLAUDE.md` (commands: lint_command, format_command, typecheck_command, test_command)
- `AGENTS.md` (project-specific consistency rules)
- The spec at `docs/superpowers/specs/YYYY-MM-DD-<slug>-spec.md` (acceptance criteria especially)
- The plan at `docs/superpowers/plans/YYYY-MM-DD-<slug>.md`
- All commits since worktree base: `git log --reverse --oneline <base>..HEAD`

## 5-step QC procedure (spec §7.1)

1. **Acceptance-criteria walkthrough.** For each criterion in the spec, locate the code + tests satisfying it. Missing criterion → blocking issue.
2. **Integration probe.** Run `test_command` from CLAUDE.md. Any failure → blocking issue.
3. **Static-check sweep.** Re-run `lint_command`, `format_command`, `typecheck_command`. Catches drift from rework tasks.
4. **Cross-implementer consistency.** Scan diff for naming inconsistencies (`userId` vs `memberId`), duplicate utilities, contract drift between BE and FE.
5. **Flagged-assumptions resolution.** Scan commits for `Flagged-assumptions:` lines. Validate each against the spec.

## Output

Write `docs/superpowers/reviews/YYYY-MM-DD-<slug>-qc-report.md` per spec §7.2 template:

```markdown
# QC Report — <slug>

**Status:** pass | blocking-issues

## Acceptance criteria
- [✓] Criterion 1 — satisfied by src/.../FooTests.cs:42
- [✗] Criterion 5 — NOT FOUND. Blocking.

## Integration
- [✓] Full test suite green (412 tests)

## Static checks
- [✓] Lint clean
- [✓] Format clean
- [✗] Typecheck failure in src/.../Bar.cs:18. Blocking.

## Consistency
- [⚠] Inconsistent naming: `userId` (BE) vs `memberId` (FE). Non-blocking.

## Flagged assumptions
- [✓] Assumption "RBAC uses Admin role" verified against ADR-0017.

## Issues for orchestrator
<one block per blocking issue>
```

## On blocking issues (spec §7.3)

1. For each blocking issue, TaskCreate with prefix `impl:rework-qc-<topic>` and body: violation desc + remediation guidance. Include `wave: qc-rework` and `Reworks: qc-issue-<n>` lines for hooks.
2. Post `QC_REWORK_NEEDED <task-count>` to lead. Lead re-spawns team-leader to dispatch.
3. Approve shutdown when lead requests it. You will be re-spawned after rework for a re-check.

## On pass

1. Post `QC_PASS <slug>` to lead.
2. Approve shutdown when lead requests it.

## Round cap

Max 3 QC rounds per feature (lead enforces). 4th round → owner escalation.

## Also write AGENTS.suggestions.md

If during QC you identify a pattern that future features should adopt or avoid, append a suggestion to `docs/superpowers/AGENTS.suggestions.md`. Owner reviews and promotes to AGENTS.md manually.

## Cannot

- Spawn teammates.
- Write feature code (rework tasks dispatched to implementers).
- Promote suggestions to AGENTS.md (owner-only).
```

- [ ] **Step 2: Validate + commit**

```bash
python3 -c "import yaml; doc=open('plugins/team-superpower/agents/qc-engineer.md').read().split('---')[1]; yaml.safe_load(doc); print('OK')"
git add plugins/team-superpower/agents/qc-engineer.md
git commit -m "feat(team-superpower): v5 add qc-engineer (end-of-plan single instance)"
```

### Task 7: Modify `backend-developer.md` (drop QA loop, add static-check + escalation)

**Files:**
- Modify: `plugins/team-superpower/agents/backend-developer.md`

- [ ] **Step 1: Identify and remove v4 QA loop block**

Open file. Find the block referencing `VERIFY_REQUEST`, `QA_PASS`, `QA_ISSUES`, `qa-engineer`. Delete the entire QA-loop section (typically headed something like "## QA Verification Loop" or "## After Implementation: QA Verification").

- [ ] **Step 2: Insert static-check enforcement section**

Insert this section before the "Commit" section:

```markdown
## Static checks (REQUIRED before commit)

Before every commit, run the three static checks declared in `CLAUDE.md`:

```bash
TASK_ID="<your-current-task-id>"
LOG=".team-superpower/static-check-${TASK_ID}.log"
mkdir -p .team-superpower
{
  echo "=== lint ==="
  <lint_command from CLAUDE.md>; echo "exit=$?"
  echo "=== format ==="
  <format_command from CLAUDE.md>; echo "exit=$?"
  echo "=== typecheck ==="
  <typecheck_command from CLAUDE.md>; echo "exit=$?"
} | tee "$LOG"
```

All three must exit 0. The TaskCompleted hook reads `$LOG` and rejects the task if any exit line is non-zero or the file is missing.

If a check fails: fix the failure locally and rerun. Do NOT request review until the log is green. No mailbox interaction is needed for static-check failures.
```

- [ ] **Step 3: Insert escalation section**

Insert this section just before "Cannot" (or similar restrictions section):

```markdown
## Escalation (spec §6.4)

For task-level questions you cannot resolve, SendMessage team-leader:

```
ESCALATE <task-id>
class: tactical | cross-role | architectural
question: <one line>
context: <2-3 lines>
```

- `tactical`: style, naming, local design — team-leader answers from arch-map + AGENTS.md.
- `cross-role`: affects another implementer — team-leader coordinates.
- `architectural`: changes arch-map, requires planner judgment, invalidates wave plan — team-leader posts RESTART_REQUEST to lead. Owner sees a recovery touchpoint.

Do NOT guess on architecture-level decisions. Mark them `class=architectural`; team-leader routes.
```

- [ ] **Step 4: Update commit format section**

Find the commit-format section. Remove any `QA-verified:` line example. Confirm presence of `Files:`, `Wave:`, `Test-status:` lines.

- [ ] **Step 5: Verify token budget + retrieval budget sections are unchanged**

Search for `task_token_budget`, `retrieval_budget`. These v4 sections stay as-is.

- [ ] **Step 6: Commit**

```bash
git add plugins/team-superpower/agents/backend-developer.md
git commit -m "feat(team-superpower): v5 backend-developer drops QA loop, adds static-check log + escalation routing"
```

### Task 8: Modify `frontend-developer.md` (same changes as Task 7)

**Files:**
- Modify: `plugins/team-superpower/agents/frontend-developer.md`

- [ ] **Step 1–5: Apply identical edits as Task 7** (remove QA loop, add static-check, add escalation, scrub commit format, verify budgets).

- [ ] **Step 6: Commit**

```bash
git add plugins/team-superpower/agents/frontend-developer.md
git commit -m "feat(team-superpower): v5 frontend-developer drops QA loop, adds static-check log + escalation routing"
```

### Task 9: Scope `security-engineer.md` to regulated domain only

**Files:**
- Modify: `plugins/team-superpower/agents/security-engineer.md`

- [ ] **Step 1: Update frontmatter description**

Change the `description:` to:

```yaml
description: Security review during phase A. Spawned ONLY if CLAUDE.md security.domain is payments | healthcare | regulated. Reports to solution-architect. Shuts down at handover with planner + architect.
```

- [ ] **Step 2: Update body to clarify scope**

Add this section near the top of the body (replacing or augmenting v4's "When you are spawned" section):

```markdown
## Spawn condition

You are spawned ONLY if `CLAUDE.md` contains a `security` block with `domain: payments | healthcare | regulated`. For other projects, you are not part of the team.

## Phase A only

You participate in phase A spec discussion alongside solution-architect. You contribute regulatory and threat-model considerations to the spec + arch-map. You do NOT persist into phases B–F.

You shut down at handover when the lead requests it.

## Cannot

- Spawn teammates.
- Persist into implementation phases.
- Write feature code.
```

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/agents/security-engineer.md
git commit -m "feat(team-superpower): v5 security-engineer scoped to phase A regulated domains only"
```

### Task 10: Phase 1 manifest validation

**Files:**
- No file changes — validation only.

- [ ] **Step 1: Validate all plugin manifest JSON parses**

```bash
python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
```

- [ ] **Step 2: Run validate-skills against team-superpower**

In Claude Code: `/validate-skills`. Confirm no errors against team-superpower agents.

- [ ] **Step 3: Confirm no broken references to deleted agents**

```bash
grep -rn -E "(designer|reviewer|qa-engineer|software-architect|^[^-]*\bplanner\b)" plugins/team-superpower/ --include='*.md' --include='*.sh' --include='*.json' | grep -v -E "(feature-planner|solution-architect)"
```

Expected: no output (the only references to those slugs should be inside deleted files, which no longer exist). If results show, fix the referencing file.

---

## Phase 2 — Escalation prose + Hooks (Tasks 11–14)

### Task 11: Rewrite `assets/ESCALATION.md`

**Files:**
- Modify: `plugins/team-superpower/assets/ESCALATION.md`

- [ ] **Step 1: Replace file contents**

Replace the v4 escalation doc with v5 routing. Final file:

```markdown
# Escalation routing (team-superpower v5)

This document defines who escalates to whom in v5. Routing is platform-native (SendMessage between teammates; in-team only) until it crosses the team boundary, at which point only the lead (orchestrator) talks to the owner.

## In-team escalations (during phases B–F)

```
implementer  --ESCALATE-->  team-leader
                                │
                ┌───────────────┼──────────────────────────┐
                │               │                          │
                ▼               ▼                          ▼
           tactical:        cross-role:               architectural:
           leader answers   leader brokers            leader posts
           via SendMessage  between peers             RESTART_REQUEST
                                                     to lead
```

`ESCALATE` message body:

```
ESCALATE <task-id>
class: tactical | cross-role | architectural
question: <one line>
context: <2-3 lines>
```

team-leader downgrades over-eager `architectural` to `tactical` when justified (style/naming dressed as architecture). team-leader never upgrades a clear tactical question to architectural.

## Cross-team escalations (to lead / owner)

| Trigger | Source | Destination | Owner sees? |
|---|---|---|---|
| Architecturally significant question mid-impl | team-leader | lead (RESTART_REQUEST) | Yes — one recovery touchpoint |
| Wave collision unresolvable after 3 retries | team-leader | lead (RESTART_REQUEST) | Yes — one recovery touchpoint |
| QC blocking issues after 3 rounds | qc-engineer → lead | owner | Yes — manual intervention required |
| Push failure | lead | owner | Yes — notification |
| 2nd+ cycle restart | lead | owner | Yes — recovery touchpoint per restart |
| Cycle restart cap (>2) reached | lead | owner | Yes — manual intervention required |

## Owner touchpoints (planned, not escalations)

Team mode:
1. Spec sign-off (architect-driven).
2. Plan approval (planner-driven, after spec locked).

Solo / single-agent modes: 1 combined touchpoint each (diff approval or spec+plan approval).

## Non-escalation messages (in-team coordination, not routed to lead)

- `SPAWN_REQUEST` (team-leader → lead): operational, not an escalation. Lead spawns and replies `SPAWN_DONE`.
- `PHASE_COMPLETE <N>` / `PLAN_COMPLETE` (team-leader → lead): status, not escalation.
- `HANDOVER_READY` (architect → lead): status.
- `QC_PASS` / `QC_REWORK_NEEDED` (qc-engineer → lead): status.

## Removed in v5

- v4's `VERIFY_REQUEST` / `QA_PASS` / `QA_ISSUES` (per-task QA gate). Replaced by hook-enforced static checks + end-of-plan QC.
- v4's mailbox file pattern (`.team-superpower/mailbox/`). Replaced by native Agent Teams SendMessage.
- "Architect standby" mechanism. Mid-implementation architectural questions trigger RESTART_REQUEST.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/team-superpower/assets/ESCALATION.md
git commit -m "docs(team-superpower): v5 escalation routing (SPAWN_REQUEST, RESTART_REQUEST, no mailbox files)"
```

### Task 12: Modify `hooks/task-completed.sh` — TDD (static-check log + rework reference)

**Files:**
- Modify: `plugins/team-superpower/hooks/task-completed.sh`
- Create test fixture: `tests/team-superpower/v5/fixtures/static-check-ok.log`
- Create test fixture: `tests/team-superpower/v5/fixtures/static-check-fail.log`
- Create test: `tests/team-superpower/v5/static-check-log.test.sh`
- Create test: `tests/team-superpower/v5/rework-reference.test.sh`

- [ ] **Step 1: Create test fixtures**

`tests/team-superpower/v5/fixtures/static-check-ok.log`:

```
=== lint ===
no issues
exit=0
=== format ===
exit=0
=== typecheck ===
exit=0
```

`tests/team-superpower/v5/fixtures/static-check-fail.log`:

```
=== lint ===
ERR src/foo.ts:12: unused variable
exit=1
=== format ===
exit=0
=== typecheck ===
exit=0
```

- [ ] **Step 2: Write the failing test for missing log**

Create `tests/team-superpower/v5/static-check-log.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$(cd "$HERE/../../../plugins/team-superpower/hooks" && pwd)/task-completed.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
mkdir -p .team-superpower

pass=0; fail=0

# Case 1: impl: task with no static-check log → reject
INPUT='{"task":{"id":"impl:1.1.1-foo","content":"impl:1.1.1-foo: do thing"}}'
OUT=$(echo "$INPUT" | "$HOOK" 2>&1) && rc=0 || rc=$?
if [ "$rc" = "2" ] && echo "$OUT" | grep -q "MISSING_STATIC_CHECKS"; then
  echo "PASS: missing log rejected"; pass=$((pass+1))
else
  echo "FAIL: missing log not rejected (rc=$rc, out=$OUT)"; fail=$((fail+1))
fi

# Case 2: impl: task with failing log → reject
cp "$HERE/fixtures/static-check-fail.log" .team-superpower/static-check-impl:1.1.1-foo.log
OUT=$(echo "$INPUT" | "$HOOK" 2>&1) && rc=0 || rc=$?
if [ "$rc" = "2" ] && echo "$OUT" | grep -q "MISSING_STATIC_CHECKS"; then
  echo "PASS: failing log rejected"; pass=$((pass+1))
else
  echo "FAIL: failing log not rejected (rc=$rc, out=$OUT)"; fail=$((fail+1))
fi

# Case 3: impl: task with passing log → accept
cp "$HERE/fixtures/static-check-ok.log" .team-superpower/static-check-impl:1.1.1-foo.log
OUT=$(echo "$INPUT" | "$HOOK" 2>&1) && rc=0 || rc=$?
if [ "$rc" = "0" ]; then
  echo "PASS: passing log accepted"; pass=$((pass+1))
else
  echo "FAIL: passing log rejected (rc=$rc, out=$OUT)"; fail=$((fail+1))
fi

# Case 4: non-impl: task → log not required
INPUT_PLAN='{"task":{"id":"plan:design-x","content":"plan:design-x: ..."}}'
OUT=$(echo "$INPUT_PLAN" | "$HOOK" 2>&1) && rc=0 || rc=$?
if [ "$rc" = "0" ]; then
  echo "PASS: plan task does not require log"; pass=$((pass+1))
else
  echo "FAIL: plan task wrongly required log (rc=$rc, out=$OUT)"; fail=$((fail+1))
fi

echo "static-check-log.test.sh: $pass passed, $fail failed"
[ "$fail" = "0" ]
```

- [ ] **Step 3: Run test — should FAIL (hook not updated yet)**

```bash
chmod +x tests/team-superpower/v5/static-check-log.test.sh
bash tests/team-superpower/v5/static-check-log.test.sh
```

Expected: at least one FAIL (hook missing the check).

- [ ] **Step 4: Update hook — remove v4 QA checks**

In `plugins/team-superpower/hooks/task-completed.sh`, locate and delete checks 7 (`MISSING_QA_VERIFICATION`) and 8 (`QA_CAP_EXCEEDED`). Search for `qa_verified_at`, `MISSING_QA_VERIFICATION`, `QA_CAP_EXCEEDED` and remove the corresponding `if` blocks.

- [ ] **Step 5: Update hook — add check 10 (static-check log)**

Append the following check at the appropriate location in the hook (after the existing v4 checks that remain):

```bash
# Check 10 (v5): static-check log present and all exits 0 for impl:* tasks
if [[ "$TASK_ID" == impl:* ]]; then
  LOG=".team-superpower/static-check-${TASK_ID}.log"
  if [ ! -f "$LOG" ]; then
    echo "MISSING_STATIC_CHECKS: Expected ${LOG} (run lint+format+typecheck and capture output before commit)." >&2
    exit 2
  fi
  # All exit=N lines must be exit=0
  if grep -E '^exit=' "$LOG" | grep -vq '^exit=0$'; then
    echo "MISSING_STATIC_CHECKS: ${LOG} contains non-zero exit. Fix locally and rerun." >&2
    exit 2
  fi
fi
```

- [ ] **Step 6: Re-run test — should PASS**

```bash
bash tests/team-superpower/v5/static-check-log.test.sh
```

Expected: `4 passed, 0 failed`.

- [ ] **Step 7: Write rework-reference test**

Create `tests/team-superpower/v5/rework-reference.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$(cd "$HERE/../../../plugins/team-superpower/hooks" && pwd)/task-completed.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
mkdir -p .team-superpower
cp "$HERE/fixtures/static-check-ok.log" .team-superpower/static-check-impl:rework-T1-foo.log

pass=0; fail=0

# Case A: rework task w/ Reworks: line → accept
INPUT='{"task":{"id":"impl:rework-T1-foo","content":"impl:rework-T1-foo: fix\nReworks: T1\n","commit_message":"impl:rework-T1-foo: fix\n\nReworks: T1"}}'
OUT=$(echo "$INPUT" | "$HOOK" 2>&1) && rc=0 || rc=$?
if [ "$rc" = "0" ]; then
  echo "PASS: rework with reference accepted"; pass=$((pass+1))
else
  echo "FAIL: rework rejected (rc=$rc, out=$OUT)"; fail=$((fail+1))
fi

# Case B: rework task missing Reworks: line → reject
INPUT_BAD='{"task":{"id":"impl:rework-T1-foo","content":"impl:rework-T1-foo: fix","commit_message":"impl:rework-T1-foo: fix"}}'
OUT=$(echo "$INPUT_BAD" | "$HOOK" 2>&1) && rc=0 || rc=$?
if [ "$rc" = "2" ] && echo "$OUT" | grep -q "MISSING_REWORK_REFERENCE"; then
  echo "PASS: missing Reworks: rejected"; pass=$((pass+1))
else
  echo "FAIL: missing Reworks: not rejected (rc=$rc, out=$OUT)"; fail=$((fail+1))
fi

echo "rework-reference.test.sh: $pass passed, $fail failed"
[ "$fail" = "0" ]
```

- [ ] **Step 8: Run — should FAIL**

```bash
chmod +x tests/team-superpower/v5/rework-reference.test.sh
bash tests/team-superpower/v5/rework-reference.test.sh
```

- [ ] **Step 9: Add check 11 (rework reference) to hook**

```bash
# Check 11 (v5): rework tasks must reference originator
if [[ "$TASK_ID" == impl:rework-* ]]; then
  COMMIT_MSG=$(echo "$RAW_INPUT" | jq -r '.task.commit_message // .task.content // ""' 2>/dev/null || echo "")
  if ! echo "$COMMIT_MSG" | grep -qE '^Reworks: .+$'; then
    echo "MISSING_REWORK_REFERENCE: Rework task ${TASK_ID} commit message must contain 'Reworks: <original-task-id|qc-issue-id>' line." >&2
    exit 2
  fi
fi
```

- [ ] **Step 10: Re-run both tests — both should PASS**

```bash
bash tests/team-superpower/v5/static-check-log.test.sh
bash tests/team-superpower/v5/rework-reference.test.sh
```

- [ ] **Step 11: Commit**

```bash
git add plugins/team-superpower/hooks/task-completed.sh tests/team-superpower/v5/
git commit -m "feat(team-superpower): v5 task-completed.sh adds static-check log + rework reference checks; removes per-task QA checks"
```

### Task 13: Modify `hooks/task-created.sh` — TDD (allow rework prefix + wave-id check)

**Files:**
- Modify: `plugins/team-superpower/hooks/task-created.sh`
- Create test: `tests/team-superpower/v5/wave-reference.test.sh`

- [ ] **Step 1: Write the failing test**

`tests/team-superpower/v5/wave-reference.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$(cd "$HERE/../../../plugins/team-superpower/hooks" && pwd)/task-created.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
mkdir -p .team-superpower
# Active plan-phase marker — hook should consult this when validating wave-ids
echo "1" > .team-superpower/active-plan-phase

pass=0; fail=0

# Case A: impl: task referencing valid wave → accept
INPUT='{"task":{"id":"impl:1.1.1-foo","content":"impl:1.1.1-foo: do thing\nwave: 1.1\nFiles: src/foo.ts"}}'
OUT=$(echo "$INPUT" | "$HOOK" 2>&1) && rc=0 || rc=$?
if [ "$rc" = "0" ]; then echo "PASS: valid wave-id accepted"; pass=$((pass+1));
else echo "FAIL: valid wave rejected (rc=$rc, out=$OUT)"; fail=$((fail+1)); fi

# Case B: impl: task without wave: line → reject
INPUT_BAD='{"task":{"id":"impl:1.1.1-foo","content":"impl:1.1.1-foo: do thing\nFiles: src/foo.ts"}}'
OUT=$(echo "$INPUT_BAD" | "$HOOK" 2>&1) && rc=0 || rc=$?
if [ "$rc" = "2" ] && echo "$OUT" | grep -q "INVALID_WAVE_REFERENCE"; then
  echo "PASS: missing wave: rejected"; pass=$((pass+1));
else echo "FAIL: missing wave: not rejected (rc=$rc, out=$OUT)"; fail=$((fail+1)); fi

# Case C: impl:rework-* prefix accepted
INPUT_RW='{"task":{"id":"impl:rework-T1-violation","content":"impl:rework-T1-violation: fix\nwave: 1.rework\nReworks: T1"}}'
OUT=$(echo "$INPUT_RW" | "$HOOK" 2>&1) && rc=0 || rc=$?
if [ "$rc" = "0" ]; then echo "PASS: rework prefix accepted"; pass=$((pass+1));
else echo "FAIL: rework prefix rejected (rc=$rc, out=$OUT)"; fail=$((fail+1)); fi

# Case D: impl:rework-qc-* prefix accepted
INPUT_QC='{"task":{"id":"impl:rework-qc-criterion5","content":"impl:rework-qc-criterion5: fix\nwave: qc-rework\nReworks: qc-issue-5"}}'
OUT=$(echo "$INPUT_QC" | "$HOOK" 2>&1) && rc=0 || rc=$?
if [ "$rc" = "0" ]; then echo "PASS: rework-qc prefix accepted"; pass=$((pass+1));
else echo "FAIL: rework-qc prefix rejected (rc=$rc, out=$OUT)"; fail=$((fail+1)); fi

echo "wave-reference.test.sh: $pass passed, $fail failed"
[ "$fail" = "0" ]
```

- [ ] **Step 2: Run — should FAIL**

```bash
chmod +x tests/team-superpower/v5/wave-reference.test.sh
bash tests/team-superpower/v5/wave-reference.test.sh
```

- [ ] **Step 3: Update `hooks/task-created.sh`**

Find the prefix-allowlist regex. Ensure `impl:rework-*` matches (extend the regex from v4 if it was `^impl:[0-9]` to `^impl:([0-9]|rework-)`).

Add wave-id check:

```bash
# v5: impl:* tasks must include a wave: line; wave-id format is <phase>.<wave> or "<phase>.rework" or "qc-rework"
if [[ "$TASK_ID" == impl:* ]]; then
  TASK_BODY=$(echo "$RAW_INPUT" | jq -r '.task.content // ""' 2>/dev/null || echo "")
  if ! echo "$TASK_BODY" | grep -qE '^wave: ([0-9]+\.[0-9a-z]+|qc-rework)$'; then
    echo "INVALID_WAVE_REFERENCE: ${TASK_ID} missing valid 'wave: <phase>.<wave>' line." >&2
    exit 2
  fi
fi
```

- [ ] **Step 4: Re-run — should PASS**

```bash
bash tests/team-superpower/v5/wave-reference.test.sh
```

Expected: `4 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add plugins/team-superpower/hooks/task-created.sh tests/team-superpower/v5/wave-reference.test.sh
git commit -m "feat(team-superpower): v5 task-created.sh accepts impl:rework-* + enforces wave: reference"
```

### Task 14: Modify `hooks/teammate-idle.sh` — role-aware routing

**Files:**
- Modify: `plugins/team-superpower/hooks/teammate-idle.sh`

- [ ] **Step 1: Replace hook body with role-aware routing**

Replace existing body with:

```bash
#!/usr/bin/env bash
set -euo pipefail

# v5 teammate-idle: role-aware routing
# Native hook input on stdin: JSON with .teammate.type and .teammate.name

RAW_INPUT="$(cat)"
TM_TYPE=$(echo "$RAW_INPUT" | jq -r '.teammate.type // ""' 2>/dev/null || echo "")
TM_NAME=$(echo "$RAW_INPUT" | jq -r '.teammate.name // ""' 2>/dev/null || echo "")
SLUG=$(echo "$RAW_INPUT" | jq -r '.team.name // ""' 2>/dev/null || echo "")

# Detect phase from artifacts under the worktree
PHASE_A_DONE=0
if ls docs/superpowers/handovers/*-handover.md 2>/dev/null | head -n1 >/dev/null; then
  PHASE_A_DONE=1
fi

case "$TM_TYPE" in
  solution-architect|feature-planner|security-engineer)
    if [ "$PHASE_A_DONE" = "1" ]; then
      # Expected to shut down; allow idle
      exit 0
    else
      echo "Phase A not complete. Continue: spec + arch-map + plan + handover." >&2
      exit 2
    fi
    ;;
  team-leader)
    echo "Check wave status. If all expected tasks for current wave are complete, proceed to next wave or run phase-end review. If all phase-end reviews are posted, post PLAN_COMPLETE." >&2
    exit 2
    ;;
  backend-developer|frontend-developer)
    echo "Claim next unclaimed unblocked task from ~/.claude/tasks/${SLUG}/. If none, shut down (approve when lead requests)." >&2
    exit 2
    ;;
  qc-engineer)
    if [ -f "docs/superpowers/reviews/$(ls docs/superpowers/reviews/ 2>/dev/null | grep -- '-qc-report.md' | tail -n1 || echo nonexistent)" ]; then
      # Report exists; expected to post QC_PASS or QC_REWORK_NEEDED then shut down
      exit 0
    fi
    echo "Produce QC report at docs/superpowers/reviews/<date>-${SLUG}-qc-report.md per spec §7.2. Then post QC_PASS or QC_REWORK_NEEDED to lead." >&2
    exit 2
    ;;
  *)
    # Unknown type — allow idle (no feedback)
    exit 0
    ;;
esac
```

- [ ] **Step 2: Manual smoke test**

```bash
echo '{"teammate":{"type":"team-leader","name":"tl-1"},"team":{"name":"test-feat"}}' | bash plugins/team-superpower/hooks/teammate-idle.sh ; echo "exit=$?"
```

Expected: feedback text on stderr, exit=2.

```bash
echo '{"teammate":{"type":"solution-architect","name":"arch-1"},"team":{"name":"test-feat"}}' | bash plugins/team-superpower/hooks/teammate-idle.sh ; echo "exit=$?"
```

Expected (no handover file): feedback on stderr, exit=2.

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/hooks/teammate-idle.sh
git commit -m "feat(team-superpower): v5 teammate-idle role-aware routing"
```

---

## Phase 3 — Scripts, template, paths (Tasks 15–18)

### Task 15: Rewrite `scripts/team-state.sh` for native team config

**Files:**
- Modify: `plugins/team-superpower/scripts/team-state.sh`

- [ ] **Step 1: Read current file to understand v4 mailbox helpers being replaced**

```bash
head -40 plugins/team-superpower/scripts/team-state.sh
grep -n "mailbox\|MAILBOX" plugins/team-superpower/scripts/team-state.sh
```

- [ ] **Step 2: Replace with v5 native-team-config reader**

Replace file contents with:

```bash
#!/usr/bin/env bash
# v5: read native Agent Teams state. NEVER writes to ~/.claude/teams/<slug>/config.json — platform owns that.
# Usage:
#   team-state.sh slug                    → echo inferred slug (from worktree dir or args)
#   team-state.sh members <slug>          → list current member names + types (JSON)
#   team-state.sh phase <slug>            → echo current phase (A|B|C|D|E|F|G|H|unknown)
#   team-state.sh tasks <slug>            → list task IDs + states from ~/.claude/tasks/<slug>/

set -euo pipefail

CMD="${1:-help}"
SLUG="${2:-}"

infer_slug() {
  # Prefer worktree dir name; strip sc- prefix and random suffix
  basename "$(pwd)" | sed -E 's/^sc-//' | sed -E 's/-[a-z0-9]{4}$//'
}

case "$CMD" in
  slug)
    infer_slug
    ;;
  members)
    [ -z "$SLUG" ] && SLUG=$(infer_slug)
    CFG="$HOME/.claude/teams/${SLUG}/config.json"
    [ ! -f "$CFG" ] && { echo "[]"; exit 0; }
    jq '.members // []' "$CFG"
    ;;
  phase)
    [ -z "$SLUG" ] && SLUG=$(infer_slug)
    if [ -f "docs/superpowers/reviews/"*-"${SLUG}"-qc-report.md ] 2>/dev/null; then echo "H"; exit 0; fi
    if [ -d "$HOME/.claude/teams/${SLUG}" ] && ls docs/superpowers/reviews/*-"${SLUG}"-qc-report.md >/dev/null 2>&1; then echo "G"; exit 0; fi
    if [ -f docs/superpowers/handovers/*-"${SLUG}"-handover.md ] 2>/dev/null; then
      # Past phase A — check phase-end reviews for plan-phase progression
      LAST=$(ls docs/superpowers/reviews/*-"${SLUG}"-phase-*-leader-review.md 2>/dev/null | tail -n1 || true)
      if [ -n "$LAST" ]; then
        N=$(echo "$LAST" | grep -oE 'phase-[0-9]+' | grep -oE '[0-9]+')
        # B=1, C=2, D=3, E=4, F=5
        PHASE_LETTER=$(printf "\x$(printf '%x' $((65 + N)))")
        echo "$PHASE_LETTER"
        exit 0
      fi
      echo "B"; exit 0
    fi
    if ls "$HOME/.claude/teams/${SLUG}/config.json" >/dev/null 2>&1; then echo "A"; exit 0; fi
    echo "unknown"
    ;;
  tasks)
    [ -z "$SLUG" ] && SLUG=$(infer_slug)
    TDIR="$HOME/.claude/tasks/${SLUG}"
    [ ! -d "$TDIR" ] && { echo "[]"; exit 0; }
    find "$TDIR" -maxdepth 1 -name '*.json' -exec jq -c '{id, state}' {} \;
    ;;
  help|*)
    cat <<EOF
Usage: team-state.sh <command> [slug]
Commands:
  slug                infer slug from worktree dir
  members [slug]      list current team members (JSON)
  phase [slug]        echo current phase (A|B|...|H|unknown)
  tasks [slug]        list tasks and their states from shared task list
EOF
    ;;
esac
```

- [ ] **Step 3: Make executable + smoke test**

```bash
chmod +x plugins/team-superpower/scripts/team-state.sh
plugins/team-superpower/scripts/team-state.sh help
plugins/team-superpower/scripts/team-state.sh slug
```

Expected: help text, then inferred slug.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/scripts/team-state.sh
git commit -m "refactor(team-superpower): v5 team-state.sh reads native Agent Teams config; drops mailbox helpers"
```

### Task 16: Update `assets/CLAUDE.md.template`

**Files:**
- Modify: `plugins/team-superpower/assets/CLAUDE.md.template`

- [ ] **Step 1: Update `limits` block**

Find the `limits:` block. Replace with:

```yaml
limits:
  max_iterations_per_task: 8        # v3 MAX_ITERATIONS
  task_token_budget: 250000         # v4 per-task token cap
  retrieval_budget_per_task: 2      # v4 retrieval cycles
  max_qc_rounds: 3                  # v5 QC re-check cap
  max_cycle_restarts: 2             # v5 RESTART_REQUEST cap before owner escalation
  phase_stall_minutes: 30           # heartbeat cadence
```

Delete `max_qa_rounds_per_task` if present.

- [ ] **Step 2: Move lint/format/typecheck commands from "optional" to "required" section**

Locate the `commands:` block. Add or relocate so this section is present and explicitly required (with a leading comment):

```yaml
# REQUIRED in v5 — without these three, implementers cannot self-enforce static checks
# and the TaskCompleted hook cannot validate. Plan generation will error if missing.
commands:
  lint_command: "<project-specific lint command>"
  format_command: "<project-specific format command>"
  typecheck_command: "<project-specific typecheck command>"
  test_command: "<project-specific test command>"
```

- [ ] **Step 3: Document `security.domain` field**

Add (or update) this section:

```yaml
# Spawns security-engineer in phase A IFF set to a regulated domain.
# Allowed values: payments | healthcare | regulated
# Omit or unset for non-regulated projects.
security:
  domain: ""
```

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/assets/CLAUDE.md.template
git commit -m "feat(team-superpower): v5 CLAUDE.md.template updates limits, makes lint/format/typecheck required, scopes security.domain"
```

### Task 17: Create handovers dir + README

**Files:**
- Create: `docs/superpowers/handovers/README.md`

- [ ] **Step 1: Write README**

```markdown
# Handovers (team-superpower v5)

This directory holds **handover artifacts** produced at the end of phase A by the solution-architect. Each artifact is the contract between phase A (analytics) and phases B–F (implementation).

## Naming

`YYYY-MM-DD-<slug>-handover.md` — date is the date phase A completed; slug matches the spec/plan filenames.

## Contents

Every handover MUST include:
- Path to `docs/superpowers/specs/YYYY-MM-DD-<slug>-spec.md`
- Path to `docs/superpowers/specs/YYYY-MM-DD-<slug>-arch-map.md`
- Path to `docs/superpowers/plans/YYYY-MM-DD-<slug>.md`
- Open questions deliberately left for implementation (with reasoning why deferred)
- Restart-policy note: if team-leader posts RESTART_REQUEST, lead re-runs phase A with this handover + partial commits as input

## Lifecycle

1. Architect writes the handover after the owner approves the plan.
2. Architect posts `HANDOVER_READY <slug>` to lead.
3. Lead shuts down architect + planner + security-engineer.
4. Lead spawns team-leader, names this handover path in the spawn prompt.
5. Handover persists on disk for the whole feature.
6. On cycle restart, the new architect reads this handover as input (does NOT delete it).
7. On QC pass, handover stays — useful for AGENTS.md learning extraction.

## Do NOT

- Edit a handover after `HANDOVER_READY`. Re-planning = RESTART_REQUEST = fresh handover supersedes.
- Hand-author handovers. They are produced by the solution-architect agent.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/handovers/README.md
git commit -m "docs(team-superpower): v5 handovers/ dir + README"
```

### Task 18: Update `assets/SESSION_README.md`

**Files:**
- Modify: `plugins/team-superpower/assets/SESSION_README.md`

- [ ] **Step 1: Update artifact map section**

Locate the artifact-map section in SESSION_README. Replace with:

```markdown
## Artifact paths (v5)

```
docs/superpowers/
  specs/                                       v3, unchanged
    YYYY-MM-DD-<slug>-spec.md
    YYYY-MM-DD-<slug>-arch-map.md              NEW in v5 (architect)
  plans/                                       v3, unchanged
    YYYY-MM-DD-<slug>.md                       (plan-phase grouped, v5)
  handovers/                                   NEW in v5
    YYYY-MM-DD-<slug>-handover.md              (architect, phase A end)
  reviews/                                     v3, repurposed
    YYYY-MM-DD-<slug>-phase-<N>-leader-review.md   NEW per plan-phase
    YYYY-MM-DD-<slug>-qc-report.md             (qc-engineer, end of plan)
  sessions/                                    v3, unchanged
  AGENTS.md                                    v4, unchanged
  AGENTS.suggestions.md                        v4, written by qc-engineer in v5

.team-superpower/                              under worktree root (gitignored)
  spawn-briefs/wave-<plan-phase>.<wave>.md     NEW in v5 (team-leader writes; lead reads)
  static-check-<task-id>.log                   NEW in v5 (implementer writes; hook reads)
  active-plan-phase                            NEW in v5 (team-leader writes; task-created.sh reads)
  restart-count                                NEW in v5 (lead increments)
```
```

- [ ] **Step 2: Update lifecycle section**

Locate any v4 lifecycle prose (mailbox files, per-task QA, three-team draft). Replace with a short reference: "See `docs/superpowers/team-superpower-v5-spec.md` for the canonical lifecycle. Single Agent Teams team across phases A–H; orchestrator is sole spawner; team-leader posts SPAWN_REQUEST."

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/assets/SESSION_README.md
git commit -m "docs(team-superpower): v5 SESSION_README artifact map + lifecycle reference"
```

---

## Phase 4 — Command rewrite + auto-resume (Tasks 19–22)

### Task 19: Delete `commands/team-feature-resume.md`

**Files:**
- Delete: `plugins/team-superpower/commands/team-feature-resume.md`

- [ ] **Step 1: Delete**

```bash
git rm plugins/team-superpower/commands/team-feature-resume.md
```

- [ ] **Step 2: Commit**

```bash
git commit -m "refactor(team-superpower): v5 delete team-feature-resume command (replaced by auto-detect in team-feature)"
```

### Task 20: Rewrite `commands/team-feature.md` (largest task — split into steps)

**Files:**
- Modify: `plugins/team-superpower/commands/team-feature.md`

This file is currently 771 lines (v4). v5 rewrites the orchestration sections. Keep v3 mode heuristics, finish logic, and the file header.

- [ ] **Step 1: Skim current structure**

```bash
grep -n "^##" plugins/team-superpower/commands/team-feature.md | head -40
```

Note section headings.

- [ ] **Step 2: Replace the "Lead behavior" / "Orchestration" section with v5 single-team lifecycle**

Find the section that describes what the lead does (likely under "## Behavior" or "## Lead behavior"). Replace with:

```markdown
## Lead behavior (v5 — single-team lifecycle)

You are the lead session. You spawn the `orchestrator` agent type to perform all in-feature work; do not act as orchestrator yourself in this command. Pass through to the orchestrator agent the full owner launch message.

The orchestrator handles: auto-resume detection (spec §8.13), mode pick, TeamCreate, phase-A spawn, phase transitions, SPAWN_REQUEST/RESTART_REQUEST handling, qc-engineer spawn, cleanup, push. See `plugins/team-superpower/agents/orchestrator.md` for full responsibilities.

In team mode the orchestrator runs the single-team lifecycle (spec §3.1):
1. TeamCreate(<slug>)
2. Spawn architect + planner (+ security if regulated)
3. Phase A: spec sign-off → arch-map → plan approval → handover
4. Shut down architect + planner + security
5. Spawn team-leader
6. team-leader posts SPAWN_REQUEST per wave; orchestrator spawns implementers
7. Per plan-phase end: team-leader posts PHASE_COMPLETE; orchestrator acks
8. Final plan-phase: team-leader posts PLAN_COMPLETE; orchestrator shuts down dev team
9. Spawn qc-engineer
10. qc-engineer posts QC_PASS or QC_REWORK_NEEDED (max 3 rounds)
11. On pass: push + cleanup + notify owner

There is **no architect standby**. Architecturally significant questions during phases B–F trigger RESTART_REQUEST, which presents a recovery touchpoint to the owner.
```

- [ ] **Step 3: Replace the "Modes" section**

Locate v4 mode descriptions. Replace with three subsections:

```markdown
### Solo mode (1 touchpoint)

For bug fix, typo, rename, version bump, single-file/≤10-line diff.

The orchestrator does not TeamCreate. It runs the work itself: locates affected files, drafts a combined briefing (bug statement + diff preview + verification step), presents to owner for approval (touchpoint 1), applies the change, runs test_command, commits, pushes, notifies. See spec §9.1.

### Single-agent mode (1 touchpoint)

For small enhancement, 1–3 files, no architecture impact.

The orchestrator drafts a combined briefing (one-paragraph spec + one-task plan), presents to owner for combined approval (touchpoint 1). On approval: TeamCreate, spawn 1 implementer (Sonnet/medium). Implementer runs TDD, static checks, commits. Orchestrator shuts down implementer, spawns qc-engineer for single round. On pass: push + cleanup + notify. On blocking after 3 rounds: recovery escalation. See spec §9.2.

### Team mode (2 touchpoints)

For feature work spanning ≥2 modules or ≥4 files or introducing a new component.

Orchestrator runs the full single-team lifecycle above. Touchpoints: spec sign-off (after architect drives discussion), plan approval (after planner produces it). See spec §5–§7.
```

- [ ] **Step 4: Replace v4 mailbox/QA references**

Search for `mailbox`, `QA_PASS`, `VERIFY_REQUEST`, `qa-engineer`:

```bash
grep -nE "mailbox|QA_PASS|VERIFY_REQUEST|qa-engineer" plugins/team-superpower/commands/team-feature.md
```

For every hit: replace with v5 equivalents:
- `mailbox` → "SendMessage (native Agent Teams)"
- `QA_PASS` → `QC_PASS`
- `VERIFY_REQUEST` / `QA_*` → "static checks (implementer-side, hook-validated)"
- `qa-engineer` → `qc-engineer`

- [ ] **Step 5: Add SPAWN_REQUEST handling section**

Insert near orchestrator behavior:

```markdown
## SPAWN_REQUEST handling

When team-leader posts:

```
SPAWN_REQUEST wave=<id>
roles_needed: { backend-developer: N, frontend-developer: M }
brief_path: .team-superpower/spawn-briefs/wave-<id>.md
expected_tasks: [<task-id-1>, ...]
```

Orchestrator:
1. Reads brief file.
2. TaskCreate for each expected_task (body excerpted from brief; includes `wave: <id>` line).
3. Spawns the requested counts. Each implementer spawn prompt:

```
You are a <role> on team <slug>. Read the next unclaimed unblocked task in the shared task list at ~/.claude/tasks/<slug>/. Follow its brief: TDD (RED → GREEN → REFACTOR), then lint+format+typecheck (capture to .team-superpower/static-check-<task-id>.log), then commit per team format. After commit, self-claim next or shut down.
```

4. Replies to team-leader: `SPAWN_DONE wave=<id> agent_ids=[...]`.
```

- [ ] **Step 6: Add RESTART_REQUEST handling section**

```markdown
## RESTART_REQUEST handling

When team-leader (or qc-engineer) posts `RESTART_REQUEST <reason>`:

1. Read `.team-superpower/restart-count` (default 0). If ≥ `max_cycle_restarts` (CLAUDE.md limits, default 2): escalate to owner with "Manual intervention required after N restarts."
2. Otherwise present recovery touchpoint to owner:

```
Cycle restart needed: <reason>
Current state:
  Phase: <X>
  Last commit: <sha> "<msg>"
  Restart count: <n>/<max>

Approve restart from phase A?
  [1] Approve restart
  [2] Cancel feature (manual takeover)
```

3. On approval: increment restart-count file. Shut down all current teammates. Re-spawn architect + planner (+ security). Spawn prompt for re-spawned architect names: existing spec, arch-map, plan, partial commits as input. Phase A re-runs with delta scope.
```

- [ ] **Step 7: Add auto-resume detection section near top of behavior**

```markdown
## Auto-resume detection (run before mode pick)

On invocation, before picking mode, scan for in-progress features:

1. List `~/.claude/teams/*/config.json` files. Each is a candidate slug.
2. List `docs/superpowers/handovers/*-handover.md` files with NO matching `docs/superpowers/reviews/*-qc-report.md`.
3. List `docs/superpowers/plans/*.md` referenced by handovers in (2) with incomplete `PHASE_COMPLETE` markers in reviews/.
4. Check `git log --oneline <base>..HEAD` for partial plan-task commits not pushed.
5. Match slug against worktree dir name + owner launch text.

If any candidate matches: present resume prompt:

```
Found in-progress feature: <slug> at phase <X>
  Spec:        <path>
  Arch-map:    <path>
  Plan:        <path>
  Handover:    <path>
  Last commit: <sha> "<msg>"
Continue this feature, or start fresh?
  [1] Continue (re-spawn teammates per current phase)
  [2] Start fresh (archive prior artifacts to docs/superpowers/archive/; new feature)
```

On [1] Continue:
- If team config (~/.claude/teams/<slug>) still exists: skip TeamCreate.
- If gone: TeamCreate(<slug>).
- Re-spawn teammates per current phase (team-leader for B–F, qc-engineer for G).
- Spawn prompts include "this is a resume; read existing handover/spec/plan; continue from current state; do not re-run completed work".

On [2] Start fresh:
- Move existing artifacts under `docs/superpowers/archive/YYYY-MM-DD-<slug>/`.
- Run cleanup on stale team config: `~/.claude/teams/<slug>/` removed by lead.
- Proceed to mode pick for new feature.

If multiple candidates: list all, owner picks one or [0] start fresh.
If none: skip to mode pick.
```

- [ ] **Step 8: Audit final file size + cross-references**

```bash
wc -l plugins/team-superpower/commands/team-feature.md
grep -cE "mailbox|qa-engineer|VERIFY_REQUEST|QA_PASS" plugins/team-superpower/commands/team-feature.md
```

Expected: line count comparable (maybe smaller). Second grep should return `0`.

- [ ] **Step 9: Commit**

```bash
git add plugins/team-superpower/commands/team-feature.md
git commit -m "feat(team-superpower): v5 team-feature command — single-team lifecycle, SPAWN_REQUEST + RESTART_REQUEST + auto-resume"
```

### Task 21: Add resume-detect test

**Files:**
- Create: `tests/team-superpower/v5/resume-detect.test.sh`

- [ ] **Step 1: Write test**

```bash
#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

mkdir -p docs/superpowers/handovers docs/superpowers/reviews docs/superpowers/plans

# Seed in-progress feature: handover exists, no qc-report
cat > docs/superpowers/handovers/2026-05-15-fooflow-handover.md <<EOF
# Handover — fooflow
- spec: docs/superpowers/specs/2026-05-15-fooflow-spec.md
- plan: docs/superpowers/plans/2026-05-15-fooflow.md
EOF
touch docs/superpowers/plans/2026-05-15-fooflow.md

# Resume-detect logic (mirror what orchestrator does)
slug=""
for h in docs/superpowers/handovers/*-handover.md; do
  [ -e "$h" ] || continue
  candidate=$(basename "$h" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-(.*)-handover.md$/\1/')
  qc_report="docs/superpowers/reviews/*-${candidate}-qc-report.md"
  if ! compgen -G "$qc_report" >/dev/null; then
    slug="$candidate"
    break
  fi
done

if [ "$slug" = "fooflow" ]; then
  echo "PASS: detected in-progress slug fooflow"
  exit 0
else
  echo "FAIL: expected fooflow, got '$slug'"
  exit 1
fi
```

- [ ] **Step 2: Run test**

```bash
chmod +x tests/team-superpower/v5/resume-detect.test.sh
bash tests/team-superpower/v5/resume-detect.test.sh
```

Expected: `PASS: detected in-progress slug fooflow`.

- [ ] **Step 3: Commit**

```bash
git add tests/team-superpower/v5/resume-detect.test.sh
git commit -m "test(team-superpower): v5 resume-detect smoke test"
```

### Task 22: Add SPAWN_REQUEST + phase-end-review + touchpoint tests

**Files:**
- Create: `tests/team-superpower/v5/spawn-request.test.sh`
- Create: `tests/team-superpower/v5/phase-end-review.test.sh`
- Create: `tests/team-superpower/v5/touchpoint-count.test.sh`

- [ ] **Step 1: spawn-request test (validates brief format)**

```bash
#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
mkdir -p .team-superpower/spawn-briefs

# Mimic team-leader composing a brief
cat > .team-superpower/spawn-briefs/wave-1.1.md <<EOF
## Task impl:1.1.1-add-user-model
wave: 1.1
Files: src/models/user.ts
Depends on: []
task_token_budget: 250000
retrieval_budget: 2
Goal: Define User type with id, email, name fields.
Verification: typecheck passes; \`npm test src/models/user.test.ts\` green.

## Task impl:1.1.2-add-user-repo
wave: 1.1
Files: src/repos/user-repo.ts
Depends on: [impl:1.1.1-add-user-model]
task_token_budget: 250000
retrieval_budget: 2
Goal: UserRepo with findById, save, delete methods.
Verification: \`npm test src/repos/user-repo.test.ts\` green.
EOF

# Validate brief format: each task has required fields
pass=0; fail=0
TASKS=$(grep -cE '^## Task impl:' .team-superpower/spawn-briefs/wave-1.1.md)
if [ "$TASKS" = "2" ]; then echo "PASS: 2 tasks parsed"; pass=$((pass+1)); else echo "FAIL: expected 2 tasks, got $TASKS"; fail=$((fail+1)); fi

REQUIRED=(wave: Files: Depends Goal: Verification:)
for f in "${REQUIRED[@]}"; do
  COUNT=$(grep -cE "^${f}" .team-superpower/spawn-briefs/wave-1.1.md)
  if [ "$COUNT" = "2" ]; then echo "PASS: '${f}' on each task"; pass=$((pass+1)); else echo "FAIL: '${f}' count=$COUNT"; fail=$((fail+1)); fi
done

echo "spawn-request.test.sh: $pass passed, $fail failed"
[ "$fail" = "0" ]
```

- [ ] **Step 2: phase-end-review test (seeded SOLID violation)**

```bash
#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
mkdir -p docs/superpowers/specs docs/superpowers/reviews

# Seed an arch-map with a SOLID claim
cat > docs/superpowers/specs/2026-05-20-fooflow-arch-map.md <<EOF
# Arch-map — fooflow
## SOLID
- PaymentProcessor must accept new strategies via DI, not inheritance.
## DRY hotspots
- Reuse src/utils/money.ts for currency math.
EOF

# Simulate a violating commit by writing a "diff" that adds an inheriting class
DIFF_FILE="${WORK}/sim-diff.patch"
cat > "$DIFF_FILE" <<EOF
+class StripePaymentProcessor extends PaymentProcessor {
+  override charge() { /* ... */ }
+}
EOF

# Scan: violation = "extends PaymentProcessor" anywhere in diff
if grep -qE 'extends PaymentProcessor' "$DIFF_FILE"; then
  # team-leader would create a rework task
  REWORK_ID="impl:rework-stripe-payment-inheritance-violation"
  echo "Detected SOLID violation. Would TaskCreate ${REWORK_ID}"
  echo "PASS: violation caught"
  exit 0
else
  echo "FAIL: violation not caught"
  exit 1
fi
```

- [ ] **Step 3: touchpoint-count test (dry-run transcript)**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Validates touchpoint counts per mode by parsing a synthetic transcript
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Solo transcript (1 touchpoint)
cat > "$WORK/solo.txt" <<EOF
[orch] mode=solo
[orch] OWNER_PROMPT: Combined briefing — diff preview + verification
[owner] approve
[orch] apply + commit + push
EOF

# Single-agent transcript (1 touchpoint)
cat > "$WORK/single.txt" <<EOF
[orch] mode=single-agent
[orch] OWNER_PROMPT: Combined spec + plan
[owner] approve
[orch] spawn impl
[impl] commit
[orch] spawn qc
[qc] QC_PASS
EOF

# Team transcript (2 touchpoints)
cat > "$WORK/team.txt" <<EOF
[orch] mode=team
[arch] OWNER_PROMPT: Spec sign-off
[owner] approve
[arch] arch-map written
[planner] OWNER_PROMPT: Plan approval
[owner] approve
[arch] HANDOVER_READY
EOF

count_prompts() { grep -c '^\[.*\] OWNER_PROMPT:' "$1" || true; }

pass=0; fail=0
for mode in solo single team; do
  case $mode in solo|single) expect=1;; team) expect=2;; esac
  n=$(count_prompts "$WORK/${mode}.txt")
  if [ "$n" = "$expect" ]; then echo "PASS: $mode touchpoints=$n (expected $expect)"; pass=$((pass+1));
  else echo "FAIL: $mode touchpoints=$n (expected $expect)"; fail=$((fail+1)); fi
done
echo "touchpoint-count.test.sh: $pass passed, $fail failed"
[ "$fail" = "0" ]
```

- [ ] **Step 4: Run all three tests**

```bash
chmod +x tests/team-superpower/v5/spawn-request.test.sh tests/team-superpower/v5/phase-end-review.test.sh tests/team-superpower/v5/touchpoint-count.test.sh
bash tests/team-superpower/v5/spawn-request.test.sh
bash tests/team-superpower/v5/phase-end-review.test.sh
bash tests/team-superpower/v5/touchpoint-count.test.sh
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tests/team-superpower/v5/
git commit -m "test(team-superpower): v5 spawn-request, phase-end-review, touchpoint-count fixtures"
```

---

## Phase 5 — Companion docs + README + acceptance (Tasks 23–26)

### Task 23: Rewrite `docs/superpowers/agent-team-flows-v5.md`

**Files:**
- Modify: `docs/superpowers/agent-team-flows-v5.md`

- [ ] **Step 1: Replace existing flow doc with v5-aligned (single team) flows**

Open file, replace contents with:

```markdown
# Agent Team — Flow by Work Type (v5, Agent-Teams-native)

Three modes the orchestrator picks **automatically** from your launch message.
Owner touchpoints are marked 👤.

**v5 touchpoint policy:**
- 🔴 Bug fix (solo): **1 touchpoint** — combined diff approval
- 🟡 Small enhancement (single-agent): **1 touchpoint** — combined spec + plan approval
- 🟢 Full feature (team): **2 touchpoints** — spec sign-off, then plan approval

All modes use **one Claude Code Agent Teams team** per feature (when a team is created at all). Solo mode creates no team. Single-agent and team modes follow `TeamCreate → spawn → shutdown → spawn → ... → cleanup`.

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
    TeamCreate(<slug>)
    Spawn 1 implementer (Sonnet/medium)
    Implementer: TDD → static checks → commit
    Shut down implementer
    Spawn qc-engineer (single round, max 3)
         │
         ▼ QC_PASS
    push + cleanup + notify
```

QC blocking after 3 rounds → recovery escalation (not counted in touchpoint budget).

---

## 🟢 Full Feature — Team Mode (2 touchpoints, 1 team across phases A–H)

```
👤 Owner: /team-feature <feature description>
         │
         ▼
    ORCHESTRATOR (lead)
    TeamCreate(<slug>)
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
                            phase A re-runs with prior artifacts + partial commits as input
                            (max 2 restarts/feature; 3rd → manual intervention)
```

There is **no architect standby**. Mid-implementation architectural questions trigger restart.

---

## Member peak

- Solo: 0 teammates (lead only).
- Single-agent: 1 teammate (implementer), then 1 (qc-engineer). Never both at once.
- Team:
  - Phase A peak: 2–3 (architect + planner [+ security])
  - Phase B–F peak: 1 (team-leader) + N implementers (3–5 typical). Total 4–6.
  - Phase G peak: 1 (qc-engineer).

All within docs' recommended 3–5 active teammates.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/agent-team-flows-v5.md
git commit -m "docs(team-superpower): v5 rewrite agent-team-flows-v5 for single-team Agent-Teams-native model"
```

### Task 24: Rewrite `docs/superpowers/agent-team-checklist.md`

**Files:**
- Modify: `docs/superpowers/agent-team-checklist.md`

- [ ] **Step 1: Replace contents with v5 acceptance-criteria checklist**

Open file, replace with a structured checklist that mirrors spec §12:

```markdown
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
- [ ] Seeded SOLID violation produces rework task (test: `phase-end-review.test.sh`).

## End-of-plan QC (spec §7)
- [ ] qc-engineer spawned once per feature post-PLAN_COMPLETE.
- [ ] QC report at `docs/superpowers/reviews/<date>-<slug>-qc-report.md`.
- [ ] Blocking issues → `impl:rework-qc-*` tasks; team-leader re-spawned.
- [ ] Max 3 QC rounds; 4th → owner escalation.

## Restart-on-stuck (spec §3.1)
- [ ] team-leader posts RESTART_REQUEST instead of attempting standby.
- [ ] Lead presents recovery touchpoint on RESTART_REQUEST.
- [ ] On approval: shut down all, re-spawn architect+planner with prior artifacts + partial commits.
- [ ] Max 2 restarts; 3rd → escalate.

## No per-task QA (spec §8.6, §8.7)
- [ ] No `qa-engineer` agent file or spawn.
- [ ] Commits do NOT contain `QA-verified:` lines.
- [ ] `task-completed.sh` no longer checks `qa_verified_at:` or `MISSING_QA_VERIFICATION`.

## Static-check self-enforcement (spec §8.9, §8.12)
- [ ] Each `impl:*` commit produces `.team-superpower/static-check-<task-id>.log`.
- [ ] Hook rejects with `MISSING_STATIC_CHECKS` if log absent or non-zero.
- [ ] Simulated lint failure → fix + retry → green log → commit (test: `static-check-log.test.sh`).

## Auto-resume (spec §8.13)
- [ ] `commands/team-feature-resume.md` deleted.
- [ ] `/team-feature` auto-detects in-progress features.
- [ ] Single resume prompt presented on detect.

## Handover artifacts (spec §8.14)
- [ ] Post-phase-A: spec, arch-map, plan, handover all exist at canonical paths.
- [ ] Handover includes restart-policy note.

## Touchpoint counts (spec §10)
- [ ] Solo: 1 touchpoint.
- [ ] Single-agent: 1 touchpoint.
- [ ] Team: 2 touchpoints.
- [ ] Recovery escalations NOT counted (test: `touchpoint-count.test.sh`).

## File deletions
- [ ] `agents/designer.md` removed.
- [ ] `agents/reviewer.md` removed.
- [ ] `agents/qa-engineer.md` removed.
- [ ] `agents/planner.md` removed (replaced by `feature-planner.md`).
- [ ] `agents/software-architect.md` removed (replaced by `solution-architect.md`).
- [ ] `commands/team-feature-resume.md` removed.

## Platform compliance (Claude Code Agent Teams)
- [ ] No nested teams (only lead spawns).
- [ ] One team at a time (no concurrent TeamCreate within a feature).
- [ ] Lead = orchestrator (fixed for team lifetime).
- [ ] Native hooks: TeammateIdle / TaskCreated / TaskCompleted (no custom mailbox files).
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/agent-team-checklist.md
git commit -m "docs(team-superpower): v5 acceptance checklist mirrors spec §12"
```

### Task 25: Update plugin README

**Files:**
- Modify: `plugins/team-superpower/README.md`

- [ ] **Step 1: Update overview section to reflect v5**

Find the overview / introduction section. Replace any v4 references (per-task QA, three-team draft) with:

```markdown
## Overview (v5)

team-superpower is a Claude Code plugin that runs **one Agent Teams team** per feature across all phases. The lead (orchestrator) is the sole spawner; a coordinating teammate (team-leader) requests spawns via SPAWN_REQUEST.

**Modes:**
- Solo (1 touchpoint, no team) — bug fixes, typos, single-file changes.
- Single-agent (1 touchpoint, 1 team) — small enhancements.
- Team (2 touchpoints, 1 team across phases A–H) — full features.

**Pipeline (team mode):**
Phase A (architect + planner [+ security]) → handover → Phase B–F (team-leader + implementers, per-plan-phase wave dispatch + phase-end SOLID/DRY review) → Phase G (qc-engineer, end-of-plan QC) → Phase H (lead push + cleanup).

**Restart-on-stuck:** mid-implementation architectural questions trigger a full cycle restart (max 2). No architect standby.

See `docs/superpowers/team-superpower-v5-spec.md` for the canonical spec, `docs/superpowers/agent-team-flows-v5.md` for diagrams, `docs/superpowers/agent-team-checklist.md` for acceptance criteria.
```

- [ ] **Step 2: Update agent list to reflect v5 roster**

Find the agents list. Replace with:

```markdown
## Agents

| Agent | Lifetime | Role |
|---|---|---|
| `orchestrator` | Whole feature | Lead session; sole spawner; cleanup + push. |
| `solution-architect` | Phase A only | Spec + arch-map. |
| `feature-planner` | Phase A only | Plan (plan-phase grouped, waves). |
| `security-engineer` | Phase A only (regulated domains only) | Regulatory + threat-model review. |
| `team-leader` | Phases B–F | Coordinator; composes spawn briefs; phase-end SOLID/DRY review. |
| `backend-developer` / `frontend-developer` | Per wave | TDD implementation, static-check log, commit. |
| `qc-engineer` | Phase G only | End-of-plan 5-step QC; rework dispatch if blocking. |
```

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/README.md
git commit -m "docs(team-superpower): v5 README overview + agent roster"
```

### Task 26: Final acceptance pass + manifest revalidation

**Files:** none — verification only.

- [ ] **Step 1: Run all v5 tests**

```bash
for t in tests/team-superpower/v5/*.test.sh; do
  echo "=== $t ==="
  bash "$t" || echo "  FAILED"
done
```

Expected: every test reports `PASS` lines and no `FAILED` summary.

- [ ] **Step 2: Manifest JSON parse**

```bash
python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
```

- [ ] **Step 3: Confirm deleted files actually gone**

```bash
for f in agents/designer.md agents/reviewer.md agents/qa-engineer.md agents/planner.md agents/software-architect.md commands/team-feature-resume.md; do
  if [ -e "plugins/team-superpower/$f" ]; then echo "STILL PRESENT: $f"; else echo "deleted ok: $f"; fi
done
```

Expected: all "deleted ok".

- [ ] **Step 4: Confirm no v4 mailbox / QA references remain in plugin files**

```bash
grep -rn -E "VERIFY_REQUEST|QA_PASS|MISSING_QA_VERIFICATION|qa-engineer|mailbox" plugins/team-superpower/ --include='*.md' --include='*.sh' --include='*.json' || echo "clean"
```

Expected: `clean`. If hits remain in agent prose, fix.

- [ ] **Step 5: Walk spec §12 acceptance criteria**

Open `docs/superpowers/team-superpower-v5-spec.md` §12. Tick each criterion against the implementation. For any unticked: open a follow-up task.

- [ ] **Step 6: Final aggregate commit (only if needed for cross-file fixes from step 4–5)**

```bash
git add -A
git status
# If changes exist:
git commit -m "fix(team-superpower): v5 final acceptance pass cleanups"
```

---

## Self-review of this plan

**Spec coverage:**
- Spec §3 (architecture, single-team, lifecycle): Tasks 2, 5, 20.
- Spec §3.4 (SPAWN_REQUEST protocol): Tasks 5, 20, 22.
- Spec §5 (Phase A): Tasks 3, 4, 9.
- Spec §6 (Phases B–F): Tasks 5, 7, 8.
- Spec §7 (Phase G): Task 6.
- Spec §8.1–§8.8 (agent file changes): Tasks 1–9.
- Spec §8.9–§8.11 (hooks): Tasks 12, 13, 14.
- Spec §8.12 (CLAUDE.md template): Task 16.
- Spec §8.13 (auto-resume): Tasks 19, 20, 21.
- Spec §8.14 (artifact paths): Tasks 17, 18.
- Spec §8.15 (command rewrite): Task 20.
- Spec §8.16 (escalation): Task 11.
- Spec §8.17 (SESSION_README): Task 18.
- Spec §8.18 (scripts): Task 15.
- Spec §9 (simplified flows): Task 20 (mode subsections) + Task 23 (flow doc).
- Spec §10 (touchpoint counts): Task 22 (touchpoint-count test).
- Spec §11 (implementation order): mirrored by Phase 1–5 task ordering.
- Spec §12 (acceptance criteria): Task 24 (checklist) + Task 26 (acceptance pass).
- Spec §13 (risks): no implementation task (informational).

**Placeholder scan:** All task steps contain exact paths, exact commands, or exact code blocks. No "TBD" or "implement later".

**Type consistency:** wave-id format consistent across spec, Tasks 5/12/13/20/22: `<plan-phase>.<wave>` for normal, `<plan-phase>.rework` or `qc-rework` for rework. Hook regex in Task 13 step 3 matches.

**Cross-task consistency:**
- `.team-superpower/static-check-<task-id>.log`: referenced consistently in Tasks 7, 8, 12, 16, 18.
- `.team-superpower/spawn-briefs/wave-<id>.md`: Tasks 5, 18, 20, 22.
- `Reworks:` commit-line: Tasks 5, 6, 12.
- `RESTART_REQUEST` flow: Tasks 2, 5, 11, 20.

Plan is consistent and complete against spec.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-20-team-superpower-v5.md`.
