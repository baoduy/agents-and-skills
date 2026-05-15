# Spec: team-superpower v4 Amendment (delta from v3)

**Owner:** Steven
**Date:** 2026-05-12
**Status:** Ready for implementation
**Target:** [baoduy/agents-and-skills `plugins/team-superpower`](https://github.com/baoduy/agents-and-skills/tree/dev/plugins/team-superpower)
**Builds on:** v3 (autonomous mode/size, parallel waves, per-role models, simplified finish, per-task commits)

---

## 1. What v4 adds

Four capabilities layered on top of v3, all addressing best-practice gaps identified in the Bruniaux agent-teams guide:

1. **Per-task QA verification loop.** Before an implementer commits its task, the work goes through a lightweight verification round with the `qa-engineer` teammate (acceptance criteria, lint/format/typecheck clean, edge-case probe). A single QA instance serves a FIFO queue across all implementers in the feature. Up to 3 dev↔QA rounds per task; on the 4th cycle, the implementer escalates per §7 cross-role template. *(Addresses: shifts QA-left into each task instead of saving issues for end-of-feature rework.)*

2. **Per-implementer token budget.** Each implementer agent is given a hard token cap in its task brief (default 250k per task). On hitting 85% of the cap without a commit, the implementer auto-pauses and reports status to the lead. *(Addresses: Bruniaux §8 Cost Optimization — *"Frontend agent: stay under 180k tokens total. Auto-pause and report status at 85% of your budget."*)*

3. **Iterative retrieval budget for implementers.** Each implementer may request up to 2 additional context cycles during a task — naming specific files or symbols with explicit justification (`"I need [X] because [Y]"`) — before producing output. After 2 cycles the implementer produces best-effort output with flagged assumptions. *(Addresses: Bruniaux §9 Iterative Retrieval — prevents the failure mode where an implementer makes plausible-but-wrong assumptions on under-specified tasks.)*

4. **AGENTS.md scaffolding for compound learning.** A new `docs/superpowers/AGENTS.md` file accumulates cross-feature learnings (proven patterns, pitfalls, project-specific gotchas). The reviewer agent, at end of feature, writes candidate lessons to a separate `docs/superpowers/AGENTS.suggestions.md` staging file; the owner approves and promotes them to AGENTS.md manually. **Agents never write AGENTS.md directly** — ETH Zürich research (Gloaguen et al., 2026, cited in Bruniaux §8) confirms LLM-generated context files reduce task success by ~3%. Every line is human-approved.

As a consequence of capability 1, the end-of-wave reviewer is **narrowed in scope** to cross-task consistency only — naming drift, duplicated utilities, contract mismatches between BE and FE that slipped both the contract-publish flow and per-task QA. Reviewer does NOT re-run per-task checks (lint, format, typecheck, criteria) because QA already did.

Nothing else changes. v3's mode dispatch, wave dispatcher, model pinning, per-task commits, and simplified finish all stay exactly as specified.

## 2. Decisions encoded

The QA-loop design was chosen from three options each on three axes; the three best-practice items added per Bruniaux's guide also have explicit decisions. Rationale matters because alternatives all look reasonable on paper.

### 2.1 QA loop design

| Decision | v4 choice | Why this over alternatives |
|---|---|---|
| QA scaling | **Single QA, FIFO queue** | One QA brain across all tasks catches patterns of issues; mailbox protocol stays simple; QA is ~30s per task, so 6 sequential checks cost ~3 minutes — much less than implementer work itself. Pool of 3 QAs would 3x token spend with diminishing returns. |
| QA scope per task | **Lightweight (~30s)**: acceptance criteria + lint + format + typecheck + edge-case probe | Heavier checks (integration smoke, cross-task consistency) live at end-of-wave reviewer. Per-task pass must be fast enough that it doesn't dominate task time. |
| Round cap | **3 rounds** | Matches the existing MAX_ITERATIONS pattern (cap + reflection-on-cap-hit). Three rounds is enough for routine issues (typo, missing case) without being a license for endless ping-pong. |

### 2.2 Token budget design

| Decision | v4 choice | Why this over alternatives |
|---|---|---|
| Budget scope | **Per-task, not per-feature** | Per-feature caps require lead to track cumulative spend across all teammates and force tradeoffs the lead can't make well. Per-task caps are self-contained: each implementer owns its own number. |
| Default cap | **250k tokens per `impl:` task** | Empirical: a typical 2-5 minute TDD task spans 50-150k tokens. 250k leaves headroom for difficult tasks without normalizing waste. |
| Enforcement | **Soft (self-report at 85%)** + lead intervention | Hard kill is too brittle (implementer mid-test-fix gets terminated). Self-report lets the lead decide whether to extend, escalate, or kill. |
| Override | **Configurable in `CLAUDE.md`** under `limits.task_token_budget` | Different projects, different baselines. .NET projects with EF Core migrations run heavier than pure Node CRUD. |

### 2.3 Iterative retrieval design

| Decision | v4 choice | Why this over alternatives |
|---|---|---|
| Cycles allowed | **2 extra cycles** (3 total counting the initial brief) | Bruniaux §9 default; matches Affaan Mustafa's empirical guidance. More cycles compound latency without measurable quality gain. |
| Request format | **Explicit `I need [X] because [Y]`** | Bruniaux §9 specifically warns against `"I might need more context"` — forces the implementer to commit to a specific information need or proceed. |
| What triggers it | **Implementer self-initiates** when uncertain | Lead-initiated retrieval would require the lead to know what the implementer doesn't know — impossible in practice. |
| Failure mode at cap | **Best-effort output with flagged assumptions** | Better than blocking the wave; flagged assumptions surface to reviewer at end-of-wave. |

### 2.4 AGENTS.md design

| Decision | v4 choice | Why this over alternatives |
|---|---|---|
| Who writes AGENTS.md | **Human owner only** | ETH Zürich research: LLM-written context files reduce success ~3%. Auto-writing is actively harmful, not neutral. |
| Suggestion pipeline | **Reviewer writes to `AGENTS.suggestions.md`** | Reviewer is the one role with the cross-task view to identify recurring patterns. Suggestions are explicit candidates, not commitments. |
| Promotion trigger | **Owner manual review** between features | Surfaces during the finish notification as a one-line prompt; owner promotes on their own time. |
| Maintenance | **Reviewer flags stale entries** at start of each feature | Stale instructions are harmful (Bruniaux §8). Reviewer reads AGENTS.md at phase 0 and flags entries that contradict the current feature's design. |

## 3. Success criteria

In addition to all v3 success criteria:

**QA loop:**
1. A single `qa-engineer` instance is spawned per feature (regardless of wave size or implementer count) and serves a FIFO queue of `VERIFY_REQUEST` messages.
2. Every committed `impl:` task has `qa_verified_at:` metadata AND a `QA-verified: round=N` line in its commit message (N ≤ 3). Verified by `git log --grep="QA-verified:" --oneline` showing one per task.
3. A simulated stuck dev↔QA loop (implementer's diff keeps failing QA's checklist) escalates after 3 rounds with `qa_rounds: 3`, `what_failed:`, `one_change_to_fix:` in a §7 cross-role escalation.
4. End-of-wave reviewer does NOT re-run per-task checks (lint, format, typecheck, acceptance criteria). Reviewer's report only includes cross-task consistency findings.

**Token budget:**
5. Each implementer's task brief includes a `task_token_budget: <N>` line (default 250k, configurable in `CLAUDE.md`'s `limits.task_token_budget`).
6. At 85% of budget, implementer auto-pauses and posts `BUDGET_85_REACHED <task-id> tokens=<actual>/<cap>` to the lead's mailbox. Implementer does NOT continue work until lead responds with `BUDGET_EXTEND` or `BUDGET_ABORT`.
7. A simulated runaway implementer (deliberately consuming tokens with no commit) triggers the budget pause at 85% and the lead receives the notification.

**Iterative retrieval:**
8. Each implementer's task brief includes a `retrieval_budget: 2` line (Bruniaux §9 default).
9. An implementer with an under-specified task may post up to 2 `RETRIEVAL_REQUEST <task-id> need=<files-or-symbols> because=<reason>` messages to the lead's mailbox before producing output. The lead supplies the requested context (file contents, symbol definitions, related ADRs).
10. After 2 retrieval cycles, the implementer produces best-effort output and includes a `Flagged-assumptions: <list>` line in the commit message body for the reviewer to inspect.
11. The implementer is REJECTED by `task-completed.sh` if `retrieval_requests > 2` (cannot bypass the cap).

**AGENTS.md:**
12. On first run in a new repo, the plugin creates `docs/superpowers/AGENTS.md` from a template stub if the file doesn't exist. Existing AGENTS.md is never overwritten.
13. The reviewer reads `docs/superpowers/AGENTS.md` at start of phase 5 and applies its rules to the cross-task consistency check.
14. At end of feature, the reviewer writes 0-5 candidate lessons to `docs/superpowers/AGENTS.suggestions.md` (overwrites previous suggestions; this is a staging file, not an archive).
15. The owner's finish notification includes a one-line prompt: *"📝 Reviewer suggested N lessons for AGENTS.md — see docs/superpowers/AGENTS.suggestions.md"* when N > 0. The owner promotes manually; the plugin never auto-promotes.
16. **No agent ever writes to `docs/superpowers/AGENTS.md` directly.** Verified by inspecting `git log -- docs/superpowers/AGENTS.md` for commits — only owner-attributed commits should appear.

## 4. The dev↔QA loop

### 4.1 Why this exists

Subagent-driven-development's internal two-stage review covers spec compliance and code quality from the *implementer's own perspective*. That's necessary but not sufficient — an implementer can pass its own review and still miss:

- **Acceptance-criteria gaps** the implementer interpreted differently than the plan intended
- **Lint, format, or typecheck failures** the test suite doesn't catch (test suite often passes despite warnings)
- **Edge cases** the implementer didn't think to test (negative paths, boundary inputs, empty/null cases)

QA is a fresh pair of eyes with a different lens: *"does this actually do what the plan said it should, and is it clean enough to merge?"*

### 4.2 The protocol

```
┌─────────────────────────────────────────────────────────────┐
│  Implementer finishes RED→GREEN→REFACTOR + two-stage review │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
       ┌──────────────────────────────────┐
       │  Implementer posts to QA mailbox │
       │   VERIFY_REQUEST <task-id>       │
       │   round: N                        │
       └──────────────┬───────────────────┘
                      │
                      ▼
       ┌──────────────────────────────────┐
       │   qa-engineer claims from queue  │
       │   Runs the §4.3 checklist        │
       └──────────────┬───────────────────┘
                      │
                ┌─────┴─────┐
                ▼           ▼
        ┌──────────┐  ┌─────────────────────┐
        │ QA_PASS  │  │  QA_ISSUES <list>   │
        └────┬─────┘  └──────────┬──────────┘
             │                   │
             │                   ▼
             │     ┌───────────────────────┐
             │     │ Implementer fixes,    │
             │     │ re-runs tests,        │
             │     │ posts VERIFY_REQUEST  │
             │     │ round: N+1            │
             │     └──────────┬────────────┘
             │                │
             │     ┌──────────▼──────────┐
             │     │  round ≤ 3?         │
             │     └──────────┬──────────┘
             │           Yes  │  No
             │     ◄──────────┘  │
             │                   ▼
             │     ┌──────────────────────────────┐
             │     │ Escalate with §7 template:   │
             │     │   what_failed:               │
             │     │   one_change_to_fix:         │
             │     │   qa_rounds: 3               │
             │     │   class: cross-role          │
             │     └──────────────────────────────┘
             ▼
       ┌──────────────────────────────────┐
       │ Implementer git commit per §6.5  │
       │ Marks task complete              │
       └──────────────────────────────────┘
```

### 4.3 What QA verifies per task

Target time: **~30 seconds per task**. Heavier checks live in the end-of-wave reviewer.

1. **Acceptance criteria match**: read the task's plan entry, verify each criterion is satisfied by either a test or a code change. Missing criteria → issue.
2. **Static checks clean**: run the project's `lint_command` and `typecheck_command` from `CLAUDE.md` (auto-detected if absent: `eslint`, `tsc --noEmit`, `dotnet build` with warnings as errors, `ruff check`, `cargo clippy -- -D warnings`, etc.). Any failure → issue. Warnings about new code only; existing warnings on untouched lines are not the implementer's problem.
3. **Format clean**: run `format_command --check` (no-write). Any drift → issue.
4. **Edge-case probe**: review the test file and ask: *what obvious edge case isn't covered?* QA names up to 3 missing cases (empty input, null, boundary value, error path, concurrent access — whichever apply). If QA finds no obvious gap, no issue.
5. **No console noise**: test run output must not contain new `console.error`, `console.warn`, `Trace.WriteLine`, `print(` debug calls, or unhandled-promise warnings. Existing noise on untouched code is fine.

QA does NOT verify:
- Architecture decisions (that's `software-architect`'s job in the gate phase)
- Security posture (that's `security-engineer`'s job)
- Cross-task consistency (that's `reviewer`'s job at end of wave)
- Performance (out of scope unless the plan specifies perf criteria)
- Code style preferences beyond format-clean (no bikeshedding)

### 4.4 The round-by-round flow

**Round 1 (every task):**
1. Implementer finishes RED-GREEN-REFACTOR and the two-stage review.
2. Implementer posts `VERIFY_REQUEST <task-id> round=1` to `qa-engineer` mailbox. Payload: task ID, list of uncommitted file paths, output of `test_command`, output of `lint_command`.
3. QA claims the next request from its FIFO queue. Runs the §4.3 checklist.
4. QA responds with either `QA_PASS <task-id> round=1` or `QA_ISSUES <task-id> round=1 issues=[{type, location, message}, …]`.
5. On `QA_PASS`: implementer proceeds to §6.5 commit step.
6. On `QA_ISSUES`: implementer fixes (may include adding tests for edge cases QA flagged), re-runs `test_command`, posts `VERIFY_REQUEST round=2`.

**Round 2-3:** same as round 1 with incremented round number. QA may close issues across rounds — if round 1 had 3 issues and round 2 fixed 2 of them, respond with `QA_ISSUES round=2 issues=[<remaining 1>]`, not all 3 again.

**After round 3 with no PASS:**
1. Implementer halts. Posts §7 cross-role escalation with:
   - `what_failed:` — summary of the QA issues that kept recurring
   - `one_change_to_fix:` — implementer's best guess at the underlying confusion
   - `qa_rounds: 3`
   - `class: cross-role`
2. Lead receives the escalation. Two resolution paths:
   - **Spec ambiguity**: if QA and implementer are arguing about what the task should do, lead pings planner to clarify the task definition. Once clarified, the task gets a fresh `qa_rounds: 0` and re-enters the loop.
   - **Tooling failure**: if `lint_command` or `typecheck_command` is broken (false positives), lead surfaces a single owner touchpoint asking to fix or override. Recovery-only, not counted in the standard touchpoint budget.

### 4.5 Trivial tasks

For genuinely trivial tasks (≤20 lines diff, no new files):
- Implementer may post `VERIFY_REQUEST <task-id> round=1 trivial=true`.
- QA runs an abbreviated check: lint + format + typecheck only. Skips acceptance-criteria and edge-case probes.
- Target time: ~5 seconds.

The implementer cannot self-classify as trivial for tasks adding new files or with diffs >20 lines; the `task-completed.sh` hook rejects that combination and forces the full checklist.

## 5. Per-implementer token budget

Each `impl:` task carries a hard token budget specified in the task brief. The implementer self-monitors and auto-pauses at 85% of the cap, reporting status to the lead rather than continuing toward exhaustion. This prevents one stuck implementer from burning through the entire feature's budget.

### 5.1 Default and configuration

Default cap: **250k tokens per `impl:` task**. Overridable in `CLAUDE.md`:

```yaml
limits:
  task_token_budget: 250000          # v4 per-task token cap
  # different overrides per task type (future)
```

Empirically, a 2-5 minute TDD task typically spans 50-150k tokens. 250k leaves headroom for difficult tasks without normalizing waste. Projects with heavier task baselines (large .NET solutions with extensive build steps, monorepos with cross-package navigation) can raise to 400k.

### 5.2 The pause-and-report protocol

```
Implementer claims task at token-count T0.
At every turn boundary, implementer compares (current - T0) against the budget.

If usage > 85% of budget AND no commit yet:
  ┌────────────────────────────────────────────────────┐
  │ STOP all work. Do not start a new tool call.       │
  │ Post to lead's mailbox:                             │
  │   BUDGET_85_REACHED <task-id>                       │
  │   tokens_used: <N>                                  │
  │   budget: <cap>                                     │
  │   current_state: <RED|GREEN|REFACTOR|QA-loop>       │
  │   blocker: <one-line — what's eating tokens>        │
  └──────────────────────┬─────────────────────────────┘
                         │
              Lead responds with ONE of:
                         │
        ┌────────────────┼─────────────────────┐
        ▼                ▼                     ▼
  BUDGET_EXTEND     BUDGET_ABORT          BUDGET_REASSIGN
  +<additional>     (kill task,           (kill task,
  tokens            no commit,            unclaim,
                    escalate to           let another
                    planner)              implementer try)
```

The lead's decision matrix:
- **Extend** if the implementer's `current_state` indicates close to completion (e.g. `QA-loop round=2`, `REFACTOR`).
- **Abort + escalate to planner** if the implementer's `blocker` is "task scope is larger than estimated" — the plan was wrong, planner needs to split the task.
- **Reassign** if the implementer's context appears polluted (lots of dead-end exploration) — a fresh implementer with the same task brief often succeeds.

### 5.3 Trade-offs

**Soft enforcement vs hard kill.** A hard kill at exactly the budget would be brittle (implementer mid-test-fix gets terminated mid-edit). Soft enforcement lets the lead intervene with judgment. The 85% threshold leaves room for one or two more careful turns of work even if the lead is slow to respond.

**Per-task vs per-feature.** Per-feature caps would require the lead to track cumulative spend across all teammates and force tradeoffs ("kill which task to save which other task?"). Per-task caps are self-contained — each implementer owns its own number, the lead intervenes per-task, simple to reason about.

## 6. Iterative retrieval for implementers

When an implementer lacks context to complete its task accurately, the default failure mode is: it makes plausible-but-wrong assumptions, produces output that looks reasonable, and breaks downstream. Per Bruniaux §9 (citing Affaan Mustafa's *Everything Claude Code*), giving the implementer an explicit retrieval budget — N cycles to request more context with explicit justification — measurably reduces this failure mode.

### 6.1 The retrieval budget

Each implementer task brief includes:

```yaml
retrieval_budget: 2
```

Meaning: the implementer may request additional context up to 2 times during the task, before producing output. Total context-loading cycles: initial brief + 2 follow-ups = 3.

### 6.2 The request format

Bruniaux §9 specifically warns against vague requests like *"I might need more context."* The retrieval request MUST follow:

```
RETRIEVAL_REQUEST <task-id>
cycle: <1|2>
need: <comma-separated files, symbols, or ADR IDs>
because: <one-sentence justification — what specifically is unclear and why this context resolves it>
```

Example:

```
RETRIEVAL_REQUEST impl:be-preferences-api
cycle: 1
need: src/Auth/AuthorizationPolicy.cs, docs/adr/0017-rbac-roles.md
because: The plan says endpoint requires "admin or owner" authorization but doesn't specify which RBAC policy enforces this. I need the policy definition and the ADR to choose the correct [Authorize] attribute.
```

Vague requests are rejected by the lead and don't count against the budget. The lead responds with the requested files inline or with a `RETRIEVAL_DENIED <reason>` message if the request is outside scope.

### 6.3 Failure mode at cap

After 2 retrieval cycles with no resolution, the implementer produces best-effort output and includes a `Flagged-assumptions:` line in the commit message body:

```
impl:be-preferences-api: Add PreferencesController with CRUD

[task body]

Flagged-assumptions:
  - Assumed [Authorize(Roles = "Admin,Owner")] is correct — could not locate the
    intended RBAC policy. Reviewer should verify.

QA-verified: round=1
Files: src/Controllers/PreferencesController.cs
Wave: 3
```

The reviewer at end-of-wave specifically scans for `Flagged-assumptions:` lines and validates each one against the design doc and ADRs. Flagged assumptions are not a failure — they're an acknowledgment that the implementer made a choice without full information, and the reviewer's cross-task view often resolves them.

### 6.4 What this changes for implementer behavior

Without iterative retrieval, an implementer faced with ambiguity has two bad options: ask the user (which we explicitly don't want — touchpoints are limited) or guess (which produces wrong code). The retrieval budget gives a third option: ask the lead for more context, bounded.

The implementer's agent body needs explicit guidance to *use* this budget rather than guess. The directive (§8.2 of this spec) is:

> When you encounter ambiguity, prefer requesting context over guessing. State explicitly: *"I need [X] because [Y]"* — not *"I might need more context."* You have 2 retrieval cycles; use them.

## 7. AGENTS.md for compound learning

Agent teams benefit from a shared context file that accumulates cross-feature learnings — patterns that worked, pitfalls to avoid, codebase-specific gotchas. Per Bruniaux §8, this file is called `AGENTS.md` (analogous to `CLAUDE.md` but scoped to agentic workflows).

**Critical rule: never let agents write `AGENTS.md` directly.** ETH Zürich research (Gloaguen et al., 2026, cited in Bruniaux §8) confirms that LLM-generated context files reduce task success by ~3% and increase inference costs by 20%+, while developer-written files improve success by ~4%. The mechanism: agents generate generic, bloated content that creates cognitive overhead for every subsequent agent reading it.

### 7.1 File layout

```
docs/superpowers/
  AGENTS.md                  # Human-curated. Read by all teammates.
  AGENTS.suggestions.md      # Reviewer-written staging file. Read by owner only.
```

`AGENTS.md` is committed and version-controlled. Every line is human-approved.

`AGENTS.suggestions.md` is also committed (so the owner can review at their convenience) but is a *staging* file — its contents are replaced on each feature's reviewer run, not appended. Its purpose is to give the owner concrete candidate lessons to copy-paste into AGENTS.md.

### 7.2 AGENTS.md structure (template)

```markdown
# Agent Team Learnings — <project-name>

This file accumulates lessons from completed features. Every line is approved by
the project owner. Agents READ this file at the start of each feature; agents
NEVER WRITE to this file directly. Suggestions from the reviewer arrive in
AGENTS.suggestions.md for owner review.

## Proven Patterns
<!-- Patterns that worked well in this codebase. -->
- (empty on first run)

## Pitfalls
<!-- Things that broke in past features. Avoid them. -->
- (empty on first run)

## Style
<!-- Project-specific style and convention rules beyond what CLAUDE.md captures. -->
- (empty on first run)

## Stale entries to remove
<!-- Reviewer flags entries here at start of feature if they contradict current design. -->
- (empty on first run)
```

The plugin creates this template on first run if `docs/superpowers/AGENTS.md` does not exist. Existing files are never overwritten.

### 7.3 How agents use AGENTS.md

- **Reviewer at start of phase 5**: reads `AGENTS.md`, applies its rules to the cross-task consistency check. Specifically, the reviewer's report flags any code that violates a documented pattern or pitfall.
- **Reviewer at end of phase 5 (before posting `REVIEW_PASSED`)**: identifies up to 5 candidate lessons from this feature and writes them to `docs/superpowers/AGENTS.suggestions.md`. Each candidate includes: type (Pattern / Pitfall / Style), one-sentence rule, one-sentence rationale, one-line evidence from this feature.
- **Other teammates**: read `AGENTS.md` at the start of their first turn. Do NOT propose AGENTS.md changes from any non-reviewer role — only the reviewer has the cross-task view to suggest patterns.

### 7.4 The suggestion format

Reviewer writes `AGENTS.suggestions.md` with this exact structure (so the owner can scan quickly and copy-paste approved entries into AGENTS.md):

```markdown
# AGENTS.md Suggestions — feature: <slug>
Generated by reviewer at end of feature.

Promote any of these to docs/superpowers/AGENTS.md by copy-paste. This staging
file is overwritten on every feature's reviewer run.

---

## Candidate 1
**Type:** Pattern
**Rule:** Always inject `ICurrentUserContext` rather than reading `HttpContext.User` directly.
**Why:** Three controllers in this feature initially used `HttpContext.User` and broke when unit-tested. Switching to injection made tests trivial.
**Evidence:** src/Controllers/PreferencesController.cs:42 (original) vs commit abc1234 (fixed).

## Candidate 2
**Type:** Pitfall
**Rule:** Do not call `Database.EnsureCreated()` in Program.cs when EF migrations are present — it conflicts with the migration pipeline.
**Why:** This pattern was attempted in BE wave 1; QA caught it. Caused silent data loss in dev DBs.
**Evidence:** impl:be-preferences-migration, QA round 1 issue.

---
```

### 7.5 Owner promotion workflow

At end of feature, the finish notification (§6.7.3 of v3) gets a new line when suggestions exist:

```
✅ Feature shipped to remote

Branch: feature/<slug>
Pushed: 8 commits, 12 files changed
Remote: https://github.com/...

📝 Reviewer suggested 2 lessons for AGENTS.md — see docs/superpowers/AGENTS.suggestions.md

Open the link to review and merge.
```

The owner reviews `AGENTS.suggestions.md` on their own time, copy-pastes approved entries into `AGENTS.md`, commits manually. The plugin never auto-promotes.

### 7.6 Staleness management

At start of phase 5 (reviewer claims its first task), the reviewer reads `AGENTS.md` and the current feature's design doc. If any AGENTS.md entry contradicts the current design (e.g., AGENTS.md says "never use library X" but the current design adopts X intentionally), the reviewer notes this in the *Stale entries to remove* section of `AGENTS.suggestions.md`.

The owner decides whether to remove the stale entry (current design supersedes it) or amend the design (AGENTS.md rule was right, design is wrong).

### 7.7 What this is NOT

- **Not auto-tuning.** Agents cannot adjust AGENTS.md without human approval. Stale entries surface as *suggestions*, not edits.
- **Not a project README.** AGENTS.md is for agent-team-specific learnings. Project-wide info still lives in `README.md` and `CLAUDE.md`.
- **Not an alternative to `CLAUDE.md`.** `CLAUDE.md` is project config (stack, build commands, security domain). `AGENTS.md` is accumulated agent-team learning (patterns, pitfalls). Both exist.

## 8. File-by-file changes from v3

### 8.1 `agents/qa-engineer.md` (significantly expand body)

Frontmatter unchanged from v3 (`model: sonnet`).

Body additions (replace v3's "validates acceptance criteria" stub with the full protocol):

- You are a **single instance** serving a FIFO queue of `VERIFY_REQUEST` messages from all implementers in the feature.
- For each request, run the §4.3 checklist against the implementer's uncommitted diff (target ~30s per task; ~5s for `trivial=true` tasks).
- Respond with either:
  - `QA_PASS <task-id> round=N`
  - `QA_ISSUES <task-id> round=N issues=[{type: <criterion|lint|format|typecheck|edge-case|console-noise>, location: <file:line>, message: <one-line>}, …]`
- Do NOT propose specific code fixes — that's the implementer's job. Just identify the issues precisely.
- Stay neutral on architecture and security topics — defer to `software-architect` / `security-engineer`.
- You may close issues across rounds: if round 1 had 3 issues and round 2 fixed 2, respond with `QA_ISSUES round=2 issues=[<remaining 1>]`.
- At the start of your first turn, run `/effort high` and report `effort_set: high` in your first heartbeat. (v3 directive — unchanged.)

### 8.2 `agents/backend-developer.md` / `agents/frontend-developer.md` (modify)

Insert four bullets between v3's "two-stage review" step and v3's "per-task commit (§6.5)" step:

- **Per-task QA verification (§4 of v4)**: after the two-stage review passes and BEFORE committing, post `VERIFY_REQUEST <task-id> round=N` to `qa-engineer` mailbox. Payload: task ID, list of uncommitted file paths, test_command output, lint_command output. Wait for `QA_PASS <task-id>` or `QA_ISSUES <task-id> issues=[…]`. On issues: fix, re-run tests, repost `VERIFY_REQUEST` with incremented round. Cap at **3 rounds**. On round 4, halt and post a §7 cross-role escalation with `qa_rounds: 3`, `what_failed:`, `one_change_to_fix:`. Do NOT commit without `QA_PASS`.
- For trivial tasks (≤20 lines diff, no new files), you may set `trivial=true` in `VERIFY_REQUEST`. The hook rejects `trivial=true` for diffs >20 lines or new-file additions.

Also add these bullets to the body (in the section that runs **before** the work begins, near the top of the agent's responsibilities):

- **Token budget (§5 of v4)**: your task brief includes a `task_token_budget: <N>` line. At every turn boundary, check your cumulative token usage on this task. If usage exceeds **85% of the budget** AND you have not yet committed, STOP all work. Do not start a new tool call. Post `BUDGET_85_REACHED <task-id> tokens=<used>/<cap> current_state=<RED|GREEN|REFACTOR|QA-loop> blocker=<one-line>` to the lead's mailbox. Wait for `BUDGET_EXTEND`, `BUDGET_ABORT`, or `BUDGET_REASSIGN` before continuing. Never silently exceed budget.

- **Iterative retrieval (§6 of v4)**: your task brief includes a `retrieval_budget: 2` line. When you encounter ambiguity, **prefer requesting context over guessing**. State explicitly: *"I need [X] because [Y]"* — not *"I might need more context."* Post `RETRIEVAL_REQUEST <task-id> cycle=<1|2> need=<files-or-symbols> because=<reason>` to the lead's mailbox. The lead will respond with the requested context inline or `RETRIEVAL_DENIED <reason>`. You have **2 cycles total**. After 2 cycles, produce best-effort output and add a `Flagged-assumptions: <list>` line to your commit message for the reviewer to inspect. Vague requests do not count against the budget — they are rejected and you must rephrase.

Then modify v3's per-task commit step:
- After receiving `QA_PASS`, run `git add` and `git commit` per §6.5.1 v3 format. Add a `QA-verified: round=<N>` line to the commit message body for audit. If you used your retrieval budget without full resolution, also add a `Flagged-assumptions: <list>` line.

### 8.3 `agents/reviewer.md` (narrow scope + AGENTS.md responsibilities)

Frontmatter unchanged from v3 (`model: opus`).

Body update — narrow the scope AND add AGENTS.md handling:

**Cross-task consistency only (v4 narrowing):**

- Since `qa-engineer` now runs per-task verification (§4 of v4), your job at end-of-wave / end-of-feature is **cross-task consistency only**:
  - Naming drift across implementers (e.g. one BE used `userId`, another used `memberId` for the same concept)
  - Duplicated utilities under different names (two implementers introduced their own deep-merge function)
  - Contract mismatches between BE and FE that slipped both the contract-publish flow and per-task QA
  - Unused symbols, dead code introduced by the feature
  - Architectural drift from ADRs produced by `software-architect`
  - **Flagged-assumptions follow-up**: scan all commits for `Flagged-assumptions:` lines (from §6 retrieval budget). For each, validate the assumption against the design doc and ADRs. Report any unsafe assumptions as critical findings.
- You do NOT re-run per-task checks (acceptance criteria, lint, format, typecheck). Those are QA's job and have already been done.
- After review passes (or critical consistency issues are returned to implementers as new `impl:` tasks), post `REVIEW_PASSED` to lead and idle.
- All other v3 behaviors (no `finishing-a-development-branch`, no CI polling, no merge menu) stay.

**AGENTS.md responsibilities (v4 §7):**

- **At start of phase 5** (before any other review work): read `docs/superpowers/AGENTS.md` if it exists. Apply its documented patterns and pitfalls to your consistency check. Specifically, flag any code that violates a documented pattern or repeats a documented pitfall.
- **Staleness check**: read the current feature's design doc. If any `AGENTS.md` entry contradicts the current design (e.g., AGENTS.md says "never use library X" but the design adopts X intentionally), note this in the *Stale entries to remove* section of your suggestions file.
- **At end of phase 5** (after consistency review, before posting `REVIEW_PASSED`): write 0-5 candidate lessons to `docs/superpowers/AGENTS.suggestions.md` per the §7.4 format. This file is **overwritten** on each feature, not appended.
- **You may NEVER write to `docs/superpowers/AGENTS.md` directly.** Only the owner promotes entries from suggestions to AGENTS.md.
- Candidate selection: prioritize lessons that (a) caused friction in this feature, (b) are generalizable beyond this feature, (c) are not already in AGENTS.md. Skip generic LLM advice ("write clean code"). Be concrete and project-specific.

**All other teammates** (designer, planner, architect, security, implementers, QA) — body addition:

- At start of your first turn, read `docs/superpowers/AGENTS.md` if it exists. Apply documented patterns and avoid documented pitfalls. Do NOT propose AGENTS.md changes — only the reviewer has the cross-task view to suggest patterns.

### 8.4 `hooks/task-completed.sh` (add three checks)

In addition to v3's existing 6 checks, add:

7. **For `impl:` tasks**: verify the task carries a `qa_verified_at: <iso-timestamp>` metadata field AND the commit message body contains a `QA-verified: round=<N>` line (with N ≤ 3). Exit 2 `MISSING_QA_VERIFICATION` if either is missing.
8. **For `impl:` tasks with `qa_rounds: 3` and no `QA_PASS` recorded**: verify a §7 cross-role escalation is attached with `what_failed:` and `one_change_to_fix:` fields. Exit 2 `QA_CAP_EXCEEDED` if not. Implementer cannot bypass QA by claiming the cap was hit without escalating.
9. **For `impl:` tasks: verify `retrieval_requests` count ≤ 2** in task metadata. Exit 2 `RETRIEVAL_BUDGET_EXCEEDED` listing the count if greater. Implementer cannot exceed the retrieval cap silently.

Also add pre-checks:
- If a task's `VERIFY_REQUEST` payload had `trivial=true`, the diff must be ≤20 lines AND contain no new-file additions. Exit 2 `INVALID_TRIVIAL_CLAIM` listing the violation. This runs before check 7.
- If the commit message body contains a `Flagged-assumptions:` line, verify `retrieval_requests == 2` in metadata (the implementer cannot claim flagged assumptions without having exhausted the retrieval budget — otherwise they should have requested more context). Exit 2 `PREMATURE_ASSUMPTION_FLAG` if not.

### 8.5 `assets/CLAUDE.md.template` (add limits and document commands)

In the `limits` block (already added in v3, extended in v4):

```yaml
limits:
  max_iterations_per_task: 8        # v3 MAX_ITERATIONS guardrail
  max_qa_rounds_per_task: 3         # v4 dev↔QA loop cap (§4)
  task_token_budget: 250000         # v4 per-task token cap (§5)
  retrieval_budget_per_task: 2      # v4 implementer retrieval cycles (§6)
  # max_parallel_implementers: 3    # reserved for future
```

In the `backend` and `frontend` blocks, document that `lint_command` and `typecheck_command` are first-class config used by QA:

```yaml
backend:
  ...
  lint_command: dotnet build /p:TreatWarningsAsErrors=true
  typecheck_command: dotnet build --no-incremental
  format_command: dotnet format --verify-no-changes

frontend:
  ...
  lint_command: pnpm eslint .
  typecheck_command: pnpm tsc --noEmit
  format_command: pnpm prettier --check .
```

Auto-detection from project markers (`.eslintrc*`, `tsconfig.json`, `Directory.Build.props`, etc.) is the fallback when these are not specified.

### 8.6 README + SESSION_README

Add a section: *"v4 — per-task QA loop, token budgets, retrieval budgets, AGENTS.md"*. Cover:

- **QA loop**: protocol summary, single-QA queue trade-off (serializes verification within a wave but gains pattern-catching across the feature), what changes for implementers (one extra mailbox round before commit), what changes for the reviewer (scope narrowed to cross-task consistency).
- **Token budgets**: 250k default per `impl:` task, auto-pause at 85%, owner-facing override via `CLAUDE.md`'s `limits.task_token_budget`.
- **Retrieval budgets**: 2 cycles per task, explicit `I need [X] because [Y]` format, `Flagged-assumptions:` annotation on commits when budget exhausted.
- **AGENTS.md**: human-curated only, reviewer writes suggestions to staging file, owner promotes manually. Critical: agents never write AGENTS.md directly.

### 8.7 `commands/team-feature.md` — lead mailbox handlers (v4 additions)

The lead's prompt needs new handlers for v4 message types. Append to the lead's mailbox-processing section:

**Handler: `BUDGET_85_REACHED <task-id> tokens=<used>/<cap> current_state=<...> blocker=<...>`**

Decision matrix:
- If `current_state` is `QA-loop round=2` or `REFACTOR` → respond `BUDGET_EXTEND <task-id> additional=50000` (close to completion, worth extending).
- If `blocker` mentions "task scope larger than estimated" → respond `BUDGET_ABORT <task-id>` and post `TASK_OVERSCOPED <task-id>` to planner for re-decomposition.
- If `current_state` is `RED` or `GREEN` and `tokens > 200k` (mostly exploration with no clear completion path) → respond `BUDGET_REASSIGN <task-id>` (kill, unclaim, let a fresh implementer try).
- Otherwise respond `BUDGET_EXTEND additional=50000` and log a warning to checkpoint for retrospective tuning.

**Handler: `RETRIEVAL_REQUEST <task-id> cycle=<N> need=<...> because=<...>`**

Steps:
1. Validate the `because` clause is specific (not "I might need more context"). If vague, respond `RETRIEVAL_DENIED <task-id> reason="be specific — what exactly and why?"`. Vague rejections do NOT count against the budget.
2. Validate `cycle ≤ 2`. If exceeded, respond `RETRIEVAL_DENIED <task-id> reason="budget exhausted, produce best-effort with Flagged-assumptions"`.
3. Locate the requested files / symbols / ADR contents. Read them with `Read` tool.
4. Respond with `RETRIEVAL_RESPONSE <task-id> cycle=<N> content=<file contents inline>`.
5. Increment the task's `retrieval_requests` metadata counter.

**Handler: AGENTS.md staleness flag from reviewer**

At end of phase 5, if reviewer's suggestions file contains entries in the "Stale entries to remove" section, include them in the final status notification alongside the candidate-lessons prompt:

```
📝 Reviewer suggested 2 lessons for AGENTS.md and flagged 1 stale entry — see docs/superpowers/AGENTS.suggestions.md
```

### 8.8 AGENTS.md scaffolding (new in v4)

On first run in a new repo, the lead checks for `docs/superpowers/AGENTS.md`. If absent, create from this template:

```markdown
# Agent Team Learnings — <project-name>

This file accumulates lessons from completed features. Every line is approved by
the project owner. Agents READ this file at the start of each feature; agents
NEVER WRITE to this file directly. Suggestions from the reviewer arrive in
AGENTS.suggestions.md for owner review.

## Proven Patterns
<!-- Patterns that worked well in this codebase. -->
- (empty on first run)

## Pitfalls
<!-- Things that broke in past features. Avoid them. -->
- (empty on first run)

## Style
<!-- Project-specific style and convention rules beyond what CLAUDE.md captures. -->
- (empty on first run)

## Stale entries to remove
<!-- Reviewer flags entries here at start of feature if they contradict current design. -->
- (empty on first run)
```

Commit the new file. Existing AGENTS.md files are **never** overwritten — only the template stub creation is automatic.

**Hook protection**: a new pre-commit hook check (added to `task-completed.sh`) rejects any commit by a non-owner that modifies `docs/superpowers/AGENTS.md`:

```bash
# In task-completed.sh, additional check:
if git diff --cached --name-only | grep -q "docs/superpowers/AGENTS.md"; then
    # Verify the committer is not a teammate agent
    committer=$(git config user.email)
    if [[ "$committer" == *"teammate"* ]] || [[ "$committer" == *"agent"* ]]; then
        echo "AGENT_WROTE_AGENTS_MD: agents cannot modify AGENTS.md directly" >&2
        exit 2
    fi
fi
```

Implementers, planner, designer, architect, security-engineer, qa-engineer, reviewer — all are blocked from modifying `docs/superpowers/AGENTS.md`. The reviewer can only write to `docs/superpowers/AGENTS.suggestions.md`.

No changes to `commands/team-feature-resume.md`, planner.md, designer.md, architect.md, security-engineer.md, hooks/task-created.sh, scripts/, or other v3 files beyond what's listed above.

## 9. Implementation order

Order the v4 work as four sequential steps, all inserted after v3 step 2 and before v3 step 4. Each step is independent enough to ship and validate before the next:

**Step v4.A — Per-task QA verification loop:**

3a. Update `qa-engineer.md` per §8.1 with the FIFO queue protocol and §4.3 checklist. Update `backend-developer.md` and `frontend-developer.md` per §8.2 to insert the VERIFY_REQUEST step between the two-stage review and the commit. Update `task-completed.sh` per §8.4 to validate `qa_verified_at:` and `QA-verified: round=N` lines, plus enforce `trivial=true` constraints. Update `reviewer.md` per §8.3 to narrow scope to cross-task consistency only. Update `CLAUDE.md.template` per §8.5 with `max_qa_rounds_per_task`. Test three paths:
   - (a) **Clean diff** → QA_PASS round 1 → commit with `QA-verified: round=1` line
   - (b) **Two issues round 1, fixed round 2, QA_PASS** → commit with `QA-verified: round=2` line
   - (c) **Stuck loop** (injected static-check failure) → QA returns issues on rounds 1, 2, 3; round 4 implementer escalates via §7 cross-role template; `task-completed.sh` rejects completion with `QA_CAP_EXCEEDED` until escalation resolves

**Step v4.B — Per-implementer token budget:**

3b. Update `backend-developer.md` and `frontend-developer.md` per §8.2 with the budget self-monitoring and `BUDGET_85_REACHED` posting. Update `commands/team-feature.md` per §8.7 with the budget-decision matrix. Update `CLAUDE.md.template` per §8.5 with `task_token_budget`. Test:
   - (a) **Normal task** completes under budget → no `BUDGET_85_REACHED` posted
   - (b) **Approaching-budget task** crosses 85% threshold → `BUDGET_85_REACHED` posted, lead responds `BUDGET_EXTEND` → task completes
   - (c) **Runaway task** (deliberately consuming tokens with no progress) → `BUDGET_85_REACHED` posted, lead responds `BUDGET_REASSIGN` → fresh implementer claims and completes

**Step v4.C — Iterative retrieval for implementers:**

3c. Update `backend-developer.md` and `frontend-developer.md` per §8.2 with retrieval-request directives. Update `commands/team-feature.md` per §8.7 with `RETRIEVAL_REQUEST` handler and vague-request rejection. Update `task-completed.sh` per §8.4 with checks 9 and the premature-assumption check. Update `reviewer.md` per §8.3 to scan for `Flagged-assumptions:` in commits. Update `CLAUDE.md.template` per §8.5 with `retrieval_budget_per_task`. Test:
   - (a) **Clear task** → no retrieval requests, normal completion
   - (b) **Ambiguous task** → 1 retrieval request with specific `because`, lead provides context, task completes without flagged assumptions
   - (c) **Vague request** ("I might need more context") → lead rejects with `RETRIEVAL_DENIED`, does not count against budget
   - (d) **Budget exhausted** → 2 retrieval requests used, implementer produces output with `Flagged-assumptions:` line, hook accepts only because `retrieval_requests == 2`
   - (e) **Premature assumption flag** (Flagged-assumptions: without exhausting budget) → `task-completed.sh` rejects with `PREMATURE_ASSUMPTION_FLAG`

**Step v4.D — AGENTS.md scaffolding:**

3d. Add AGENTS.md template scaffolding to lead's phase-0 logic per §8.8. Update `reviewer.md` per §8.3 with AGENTS.md read at phase-5 start, suggestions write at phase-5 end, and the staleness check. Update other agent bodies (planner, designer, architect, security-engineer, backend-developer, frontend-developer, qa-engineer) with the "read AGENTS.md at start, never write" directive per §8.3 last bullet. Update `task-completed.sh` per §8.8 with the `AGENT_WROTE_AGENTS_MD` block. Test:
   - (a) **Fresh repo** → `docs/superpowers/AGENTS.md` template created on first feature
   - (b) **Repo with existing AGENTS.md** → file not overwritten, reviewer reads it and applies rules
   - (c) **Reviewer end-of-feature** → `docs/superpowers/AGENTS.suggestions.md` written with 2-3 candidate lessons in the §7.4 format
   - (d) **Owner manually promotes** an entry by copy-paste + commit → AGENTS.md update lands in next feature's reviewer read
   - (e) **Agent attempts to write AGENTS.md** (manually injected, simulating a misbehaving prompt) → `task-completed.sh` rejects with `AGENT_WROTE_AGENTS_MD`

## 10. Acceptance criteria

All v3 acceptance criteria still apply, plus:

**QA loop:**
- [ ] A single `qa-engineer` instance is spawned per feature, regardless of wave size or implementer count.
- [ ] Every committed `impl:` task has `qa_verified_at:` metadata AND a `QA-verified: round=N` line in the commit message body (N ≤ 3). Verified by `git log --grep="QA-verified:" --oneline` showing one entry per task.
- [ ] `task-completed.sh` rejects an `impl:` task missing the QA verification metadata (`MISSING_QA_VERIFICATION`).
- [ ] `task-completed.sh` rejects an `impl:` task with `qa_rounds: 3` and no resolution escalation (`QA_CAP_EXCEEDED`).
- [ ] `task-completed.sh` rejects a `trivial=true` claim for a diff >20 lines or that adds new files (`INVALID_TRIVIAL_CLAIM`).
- [ ] A simulated stuck dev↔QA loop escalates on round 4 with the §7 cross-role template; after escalation resolves, the task gets `qa_rounds: 0` and re-enters the loop.
- [ ] End-of-wave reviewer's report includes only cross-task consistency findings — no per-task lint, format, typecheck, or criteria items.
- [ ] Parallel BE + FE implementers in the same wave correctly queue their `VERIFY_REQUEST` messages; QA processes FIFO; no implementer is starved.

**Token budget:**
- [ ] Each implementer task brief includes a `task_token_budget: <N>` line (default 250k from `CLAUDE.md`'s `limits.task_token_budget`).
- [ ] Implementer auto-pauses at 85% of budget and posts `BUDGET_85_REACHED` with current state and blocker.
- [ ] Lead's `BUDGET_EXTEND`, `BUDGET_ABORT`, `BUDGET_REASSIGN` responses are tested for each appropriate scenario.
- [ ] A simulated runaway implementer (deliberately consuming tokens with no commit) triggers the budget pause at 85% and the lead receives the notification.

**Iterative retrieval:**
- [ ] Each implementer task brief includes a `retrieval_budget: 2` line.
- [ ] Implementer can post up to 2 `RETRIEVAL_REQUEST` messages with explicit `because` clauses.
- [ ] Lead rejects vague requests ("I might need more context") with `RETRIEVAL_DENIED` — these do NOT count against the budget.
- [ ] After 2 cycles, implementer produces output with `Flagged-assumptions:` commit message line.
- [ ] `task-completed.sh` rejects with `RETRIEVAL_BUDGET_EXCEEDED` if `retrieval_requests > 2`.
- [ ] `task-completed.sh` rejects with `PREMATURE_ASSUMPTION_FLAG` if a commit has `Flagged-assumptions:` but `retrieval_requests < 2`.
- [ ] Reviewer scans every commit for `Flagged-assumptions:` lines and validates each one in the consistency check.

**AGENTS.md:**
- [ ] On first run in a new repo, the plugin creates `docs/superpowers/AGENTS.md` from the template stub. Existing AGENTS.md is never overwritten.
- [ ] The reviewer reads `docs/superpowers/AGENTS.md` at start of phase 5 and applies its rules to the consistency check.
- [ ] At end of feature, reviewer writes 0-5 candidate lessons to `docs/superpowers/AGENTS.suggestions.md` in the §7.4 format. File is overwritten (staging, not archive).
- [ ] Owner's finish notification includes `📝 Reviewer suggested N lessons...` line when N > 0.
- [ ] No agent ever writes to `docs/superpowers/AGENTS.md`. Verified by `task-completed.sh` rejection (`AGENT_WROTE_AGENTS_MD`) on any agent-attributed commit modifying that file.
- [ ] Reviewer's staleness check (entries contradicting current design) lands in the "Stale entries to remove" section of suggestions.

## 11. Risks specific to v4

| Risk | Mitigation |
|---|---|
| Single QA serializes the wave, killing parallelism gains for highly parallel waves | Acknowledged trade-off. Per-task QA is ~30s; even 6 sequential checks across a wave cost ~3 minutes wall-clock — much less than the implementer work itself. If profiling shows QA is the bottleneck, future v4.x can introduce a per-side QA (1 BE-QA + 1 FE-QA) without rewriting the loop. |
| QA over-flags trivial issues (style nits, opinion) and creates noise that doesn't catch real bugs | QA agent body in §8.1 explicitly bounds the checklist: no bikeshedding, no architecture opinions, no security opinions. If real-world tuning shows QA over-flagging, tighten the agent prompt; do not relax the round cap. |
| QA misses real issues that show up in end-of-wave review | Reviewer's narrowed scope (cross-task consistency) still catches things QA can't see per-task. Plus: QA's failure mode is documented in `docs/superpowers/reviews/<slug>-review.md` for retrospective tuning. |
| Implementer and QA disagree on what "acceptance criteria" means for an ambiguous plan entry | After 3 rounds, escalation fires with `class: cross-role`. Lead pings planner to clarify the criterion. Planner amends the plan task with sharper criteria; task gets a fresh `qa_rounds: 0` and re-enters the loop. |
| QA queue starves under sustained load (large feature with many small tasks) | FIFO queue prevents starvation by construction. Worst case is wait time, not loss. Implementers idle while waiting for QA — same as the existing between-wave idle pattern, doesn't trigger `TeammateIdle`. |
| Implementer falsely claims `trivial=true` to skip the full checklist | Hook (`task-completed.sh`) verifies diff size and new-files count against `trivial=true` declaration. Rejects with explicit reason. Mechanical enforcement. |
| Reviewer over-reports per-task issues anyway | Reviewer agent body explicitly states the narrowed scope. README and SESSION_README also call this out. If the reviewer still reports per-task issues, those are downgraded to informational in the report — they don't block finish. |
| 250k token default budget is wrong for some projects (huge .NET solutions, large monorepos) | Configurable via `limits.task_token_budget` in `CLAUDE.md`. Lead's `BUDGET_EXTEND` decision matrix provides a safety net when the cap is hit mid-task. |
| Implementer never reports `BUDGET_85_REACHED` and silently exceeds budget | Soft enforcement: if a task completes with usage > cap, `task-completed.sh` logs a warning to the checkpoint but does not block (the work is done). Repeated warnings prompt the owner to raise the project's `task_token_budget`. |
| Lead's `BUDGET_REASSIGN` strands a half-finished task (the fresh implementer doesn't see the previous attempt) | The first implementer's session ends; its uncommitted changes are discarded (worktree was the only place they lived). Fresh implementer starts clean from the task brief. Trade-off: occasional rework vs. context pollution. |
| Implementers abuse retrieval as a way to ask the user via the lead | Retrieval is *agent-to-context*, not *agent-to-user*. Lead's response comes from project files / ADRs / design doc — not from owner intervention. If the lead can't find the requested context, it responds `RETRIEVAL_DENIED reason="not available in project"` and the implementer falls back to best-effort + flagged assumptions. |
| Vague retrieval requests bleed through ("I might need more context to be safe") | Lead enforces specificity via the rejection-with-no-budget-count rule. If the implementer keeps producing vague requests, the lead can post a single-line correction (`be specific: name files and reason`) — not a touchpoint, just a mailbox message. |
| AGENTS.md grows unbounded and starts to dominate every agent's context | Reviewer's staleness check at phase-5-start flags entries that no longer apply. Owner is expected to prune AGENTS.md periodically (good hygiene, not enforced). If AGENTS.md exceeds ~500 lines, the plugin can surface a one-line warning in the finish notification. |
| Owner ignores AGENTS.suggestions.md and the file becomes stale noise | Suggestions file is **overwritten** on every feature, so it never accumulates. Worst case: the owner never promotes anything, AGENTS.md stays empty, and no harm is done — agents just run without compound learning. |
| A malicious or buggy agent writes to AGENTS.md by bypassing the hook (e.g., via Bash) | `task-completed.sh` checks `git diff --cached` for AGENTS.md modifications by non-owner committers. If somehow the hook is bypassed (the task is marked complete with no actual hook run), the committed change is visible in `git log` and the owner can revert. Defense in depth: hook + audit log. |

## 12. What's out of scope for v4

- Per-side QA (one BE-QA, one FE-QA). Filed for future v4.x if profiling shows queue serialization is the actual bottleneck.
- Integration smoke tests during per-task QA (FE testing against live BE, etc.). Stays at end-of-wave reviewer.
- Cross-task consistency at per-task QA. By definition, QA can't see other tasks until they're committed; consistency stays with the end-of-wave reviewer.
- Auto-fix mode where QA proposes patches. QA only identifies issues; fixing is the implementer's job.
- Per-issue severity grading (critical/major/minor). All QA issues are blocking; no soft-warn level. Simplicity over expressiveness in v4.
- Per-feature token caps (cumulative across all teammates). Per-task caps are simpler and sufficient.
- Per-role token caps (different budgets for designer vs implementer). Roles other than implementer have predictable cost; only implementers have runaway risk.
- Auto-promotion of AGENTS.suggestions.md entries to AGENTS.md. Bruniaux is explicit: ETH Zürich research shows LLM-written context files reduce success — manual owner approval is non-negotiable.
- Multiple AGENTS.md files (per-module, per-package). Single root file only; if a project needs scoped learnings, that's a future v4.x.

---

**End of v4 amendment.** Hand to Claude Code with: *"Implement v4 on top of the existing v3 plugin. Follow §9 for the four sub-steps (v4.A through v4.D). Test against §10 acceptance criteria."*
