# Agent Team Design Checklist

> A reusable checklist for validating agent-team designs against established best practices.
> Use this when designing new agent team plugins, reviewing existing designs, or evaluating amendments.

**Sources synthesized:**
- [Bruniaux: Agent Teams Workflow](https://raw.githubusercontent.com/FlorianBruniaux/claude-code-ultimate-guide/refs/heads/main/guide/workflows/agent-teams.md)
- [Claude Code: Agent Teams docs](https://code.claude.com/docs/en/agent-teams)
- [obra/superpowers methodology](https://github.com/obra/superpowers)
- [Anthropic: Building a C compiler with agent teams](https://www.anthropic.com/engineering/building-c-compiler)
- ETH Zürich research on LLM-generated context files (cited in Bruniaux §8)

---

## How to use this checklist

For each section, mark each item:
- ✅ **Implemented** — present in the design
- ⚠️ **Partial** — partially addressed, note the gap
- ❌ **Missing** — not addressed
- ⊘ **N/A** — intentionally not applicable, document why

A design doesn't need every item. But for every missing item, the design should have an explicit reason (in §13 Risks or §14 Out-of-scope of the spec). Implicit gaps are the danger.

---

## 1. Architecture fundamentals

### Lead-as-conductor pattern
- [ ] One agent designated as the **lead/conductor**. Owner only talks to the lead.
- [ ] Lead **delegates work** rather than doing it directly (lead is orchestrator, not implementer).
- [ ] Lead has **distinct system prompt** identifying it as the conductor.
- [ ] Lead **never runs the same skills** that teammates run (no parallel duplication).

### Teammate spawning
- [ ] Teammates are **defined as separate agent files** (e.g. `.claude/agents/<role>.md`).
- [ ] Each teammate has a **clear, single-purpose role** (not "do everything").
- [ ] Teammate spawn happens **at known phase boundaries**, not ad-hoc mid-task.
- [ ] Maximum team size respects **Bruniaux's >5 anti-pattern** unless justified by codebase size (50K+ lines).
- [ ] Each teammate has its **own 1M-token context window** (isolated, not shared).

### Peer-to-peer mailbox
- [ ] Teammates **communicate directly** via mailbox, not only through lead synthesis.
- [ ] Mailbox messages have a **defined schema** (message type + payload).
- [ ] Mailbox enables **debate / challenge** between teammates, not just status reporting.
- [ ] Lead can **also message teammates** (top-down) when coordination is needed.

---

## 2. Task decomposition

### Clear boundaries (Bruniaux §8)
- [ ] Tasks are decomposed by **non-overlapping file sets** (BE files / FE files / test files).
- [ ] Each task declares the **specific files it will modify** (`Files:` metadata).
- [ ] **Avoid layered decomposition** (Agent 1: auth, Agent 2: authz, Agent 3: sessions) where files overlap.
- [ ] **Interface-first approach**: contracts (API schemas, TypeScript types) defined before parallel implementation.

### Dependency graph
- [ ] Tasks declare **explicit dependencies** (`Depends on:` metadata).
- [ ] Dependency graph is used to **schedule waves of parallel work**.
- [ ] Tasks within a wave are **provably independent** (collision check before dispatch).
- [ ] Cross-side dependencies (BE contract → FE consume) are **explicit edges**, not implicit timing.

### Task sizing
- [ ] Each task is **2-5 minutes of work** (Superpowers writing-plans skill standard).
- [ ] Plans avoid mega-tasks ("implement the feature") that prevent parallelism.
- [ ] Tasks include **verification steps** (test command, expected output).

---

## 3. Coordination primitives

### Shared task list
- [ ] Tasks live in a **shared list** accessible to all teammates.
- [ ] Each task has a **routable prefix** (`impl:be-*`, `impl:fe-*`, `review:`, etc.) so the lead can dispatch.
- [ ] Tasks claim mechanism prevents **two teammates from working on the same task** (lock files).
- [ ] Task completion is **hook-validated**, not honor-system.

### Hooks for enforcement
- [ ] `TaskCreated` hook validates prefix grammar.
- [ ] `TaskCompleted` hook validates completion criteria (tests pass, files match scope, etc.).
- [ ] `TeammateIdle` hook prevents idling with unanswered peer messages.
- [ ] Hooks log to a file for **retrospective tuning** (which checks fire most often).

### Escalation template
- [ ] A defined **escalation template** with required fields: `what_failed`, `one_change_to_fix`, `class`, options, recommendation.
- [ ] Template is **referenced from every agent's system prompt**.
- [ ] Hooks reject task completion with **malformed escalations**.
- [ ] Escalations are **classified** (tactical / cross-role / architectural / owner-only) to route correctly.

---

## 4. Owner interaction budget

### Touchpoint discipline
- [ ] Total owner touchpoints **enumerated and capped** (typical: 2-4 per feature).
- [ ] Each touchpoint has a **defined trigger and format**.
- [ ] Owner is **never asked open-ended questions** mid-feature — always batched with template.
- [ ] **Notification-only** events (not requiring response) are clearly distinguished from touchpoints.

### Heuristic mode/size selection
- [ ] Lead picks **execution mode** (solo / single-agent / team) from launch text — not owner.
- [ ] Lead picks **team size** (minimal / standard / full) from context — not owner.
- [ ] Owner can **override with flags** but heuristics decide by default.
- [ ] Mode/size decision is **logged with reasoning** so it can be inspected later.

### Mode-specific touchpoint counts
- [ ] Trivial work (solo): 1-2 touchpoints (just plan-and-diff approval).
- [ ] Small work (single-agent): 2-3 touchpoints (spec + plan + optional confirm).
- [ ] Full work (team): 2-4 touchpoints (design + plan + maybe finish-related).

---

## 5. Loop guardrails (Bruniaux §8)

### Iteration caps
- [ ] **MAX_ITERATIONS** per task is defined (Bruniaux default: 8).
- [ ] On hitting cap, agent must produce a **reflection** with `what_failed` + `one_change_to_fix` — not just retry.
- [ ] **Per-task token budget** is defined (typical: 200-300k per task).
- [ ] On hitting 85% of token budget, agent **auto-pauses** and reports — not silent kill.
- [ ] Lead has a **decision matrix** for budget-pause: extend / abort / reassign.

### Stuck-loop escape
- [ ] After N reflection cycles, **kill and reassign** the task to a fresh agent.
- [ ] Stuck-task escalation has a **defined recipient** (planner for spec issues, owner for tooling issues).
- [ ] Hook prevents **bypassing the cap** without proper escalation.

---

## 6. Quality gates

### Per-task verification (recommended in v4+)
- [ ] Each implementer's work is **verified by QA before commit**, not after end-of-feature.
- [ ] QA verification is **lightweight** (~30s): acceptance criteria, lint, format, typecheck, edge cases.
- [ ] QA scope is **bounded** — does NOT cover architecture, security, cross-task consistency.
- [ ] Dev↔QA loop has a **round cap** (typical: 3) before escalation.
- [ ] QA is a **single instance** serving a FIFO queue (or per-side pool if justified by profiling).

### End-of-wave / end-of-feature review
- [ ] A dedicated **reviewer agent** runs at end-of-feature (Bruniaux: "Dedicated Reviewer Teammate").
- [ ] Reviewer is **read-only** on code (write scope limited to review reports).
- [ ] Reviewer's role is **distinct from QA** — if QA does per-task, reviewer does cross-task consistency.
- [ ] Reviewer **does NOT re-run per-task checks** if QA already did them.
- [ ] **Critical issues** from reviewer return as new `impl:` tasks, not interrupts.

### Iterative retrieval (Bruniaux §9)
- [ ] Each implementer gets a **retrieval budget** (typical: 2 cycles).
- [ ] Retrieval requests must be **explicit**: `I need [X] because [Y]`.
- [ ] **Vague requests** are rejected without counting against budget.
- [ ] After budget exhausted, implementer flags assumptions in commit message for reviewer.
- [ ] WHY and WHAT are **both passed** to sub-agents (not just WHAT).

---

## 7. Cost optimization

### Per-role model selection
- [ ] **Generative / gating roles** (designer, architect, security, reviewer) use the strongest model (typical: Opus 4.7).
- [ ] **Transformational roles** (planner, implementers, QA) use a cheaper model (typical: Sonnet 4.6).
- [ ] Lead always uses the **strongest available model** (orchestration is high-leverage).
- [ ] Models are **pinned by frontmatter** in agent files, not relying on inheritance.
- [ ] Environment variables (`ANTHROPIC_DEFAULT_OPUS_MODEL`, etc.) **pin specific versions** for team consistency.

### Per-role effort levels
- [ ] Lead runs **xhigh effort** (orchestration benefits from deep reasoning).
- [ ] Implementers run **medium effort** (TDD work doesn't need xhigh).
- [ ] Gating/review roles run **high effort** (gap-finding benefits from deeper analysis).
- [ ] Effort is **declared in agent body** as a first-turn directive.
- [ ] Mismatch between expected and actual effort is **logged but not blocking** (soft enforcement).

### Lazy spawning
- [ ] Don't spawn teammates **for trivial tasks** — solo mode handles them.
- [ ] Don't spawn the **full team** for small tasks — single-agent mode handles them.
- [ ] Team size **scales progressively** with task complexity.
- [ ] **Idle teammates are killed** between waves to free context (when applicable).

---

## 8. Git workflow

### Worktree management (Bruniaux §8)
- [ ] Each feature runs in **its own git worktree**.
- [ ] Implementers within a wave **share a worktree** (file scopes are disjoint by design).
- [ ] Cross-wave commits accumulate on the **feature branch**.
- [ ] Worktree is **cleaned up after push** unless push failed.

### Per-task commits (recommended in v3+)
- [ ] Each implementer **commits its own task** (preserves authorship, parallel commits).
- [ ] Commit message has a **structured format** with task ID, files, verification status.
- [ ] Commit must **come after** quality verification (QA pass), not before.
- [ ] Hook validates that **every completed task has a corresponding commit**.

### Finish protocol
- [ ] Lead's finish is **fire-and-exit** (no waiting for owner decision).
- [ ] Push attempt is **single** — no automatic retry.
- [ ] On push success: **cleanup team + worktree**, notify owner.
- [ ] On push failure: **cleanup team only**, preserve worktree, notify owner with manual recovery steps.
- [ ] No automatic **PR creation, merge, or CI polling** unless explicitly required.

---

## 9. Compound learning (Bruniaux §8)

### AGENTS.md scaffolding
- [ ] An **`AGENTS.md`** file exists at a known path (typically `docs/superpowers/AGENTS.md`).
- [ ] AGENTS.md is **read by every teammate** at start of first turn.
- [ ] Sections cover **Proven Patterns**, **Pitfalls**, **Style**, **Stale entries**.
- [ ] On first run in a new repo, the plugin **creates AGENTS.md from a template stub** — does not overwrite existing.

### Human-only writes
- [ ] **No agent writes to AGENTS.md directly** (citing ETH Zürich research: LLM-generated context files reduce success ~3%).
- [ ] Reviewer writes **suggestions to a staging file** (`AGENTS.suggestions.md`), not AGENTS.md.
- [ ] Owner **manually promotes** entries from suggestions to AGENTS.md.
- [ ] Hook **blocks any agent-attributed commit** that modifies AGENTS.md.

### Suggestion lifecycle
- [ ] Suggestions file is **overwritten on every feature** (staging, not archive).
- [ ] Each suggestion includes: **type, rule, why, evidence** — owner can scan quickly.
- [ ] Reviewer flags **stale entries** at start of each feature (entries contradicting current design).
- [ ] Owner gets a **one-line prompt in the finish notification** when suggestions exist.

---

## 10. Failure modes

### Recovery and resume
- [ ] **Checkpoint files** survive `/resume` failures.
- [ ] Lead writes checkpoint at **every phase boundary**, atomically (write to .tmp, rename).
- [ ] **Resume command** (`/team-feature-resume <slug>`) respawns teammates from checkpoint state.
- [ ] Checkpoint records **Superpowers version pin** to catch mid-feature skill drift.

### Heartbeat and orphan detection
- [ ] Teammates write **heartbeat timestamps** to a known path.
- [ ] Lead detects **dead teammates** (heartbeat > N minutes stale).
- [ ] **`/team-cleanup` command** kills orphaned teammates and prunes their worktrees.
- [ ] Cleanup has a **dry-run mode** to preview what would be killed.

### Conflict resolution
- [ ] **Within-wave file collisions** trigger hard-fail re-plan (not graceful serialization).
- [ ] Re-plan loop has a **cap** (typical: 3 retries) before owner escalation.
- [ ] Reviewer's critical issues return as **new impl: tasks** for the original implementer (not interrupts).
- [ ] Merge conflicts on shared files have a **single-writer policy** (one role owns each shared file).

---

## 11. Anti-patterns to avoid

These show up in real deployments. Watch for them.

- [ ] **>5 agents** for simple features (Bruniaux: coordination overhead > productivity).
- [ ] **Over-delegation** of decisions that the owner should make (scope, cost, vendor lock-in).
- [ ] **Premature automation** — automating a workflow not mastered manually.
- [ ] **Lead-as-implementer** — lead doing work itself instead of delegating (defeats the team).
- [ ] **Sync-everywhere** — agents waiting for each other on every step (defeats parallelism).
- [ ] **Reviewer with write access** — reviewer fixes issues itself, creates merge conflicts.
- [ ] **Honor-system enforcement** — hoping agents follow rules instead of hook-enforcing them.
- [ ] **Agent-written context files** — AGENTS.md, ADRs, or design docs written by agents without owner approval.
- [ ] **Touchpoint creep** — adding owner prompts "just to be safe" until the owner is overwhelmed.
- [ ] **Vague retrieval requests** — agents asking for "more context" without naming what they need and why.
- [ ] **No iteration cap** — TDD loops grinding forever on a stuck test.
- [ ] **No token cap** — one stuck implementer burning through the feature budget.

---

## 12. Documentation requirements

For the design to be **handed off and used**, these documents are needed:

- [ ] **README.md** — overview, how to launch, owner expectations.
- [ ] **SESSION_README.md** — how to read checkpoint files, recovery procedure, troubleshooting.
- [ ] **ESCALATION.md** — escalation template + 2-3 worked examples (peer-to-peer + owner-facing).
- [ ] **CLAUDE.md.template** — annotated template with all configurable knobs.
- [ ] **AGENTS.md** stub — empty sections ready for owner to populate.
- [ ] **Agent definition files** — one per role, with frontmatter (model, tools) + body (responsibilities, behaviors).
- [ ] **Hook scripts** — `task-created.sh`, `task-completed.sh`, `teammate-idle.sh` with documented exit codes.
- [ ] **Slash commands** — `team-feature`, `team-feature-resume`, `team-cleanup` with documented arguments.
- [ ] **Spec document(s)** — design rationale, decision encoding, success criteria, risks.

---

## 13. Pre-implementation sanity checks

Run through these before handing the spec to Claude Code:

- [ ] Every **owner touchpoint** is enumerated; can you count them on one hand?
- [ ] Every **mailbox message type** has a defined schema and a defined handler?
- [ ] Every **hook** exits with a documented stderr message on each rejection?
- [ ] Every **agent body** has model + effort + tools + responsibilities + system-prompt content?
- [ ] Every **phase boundary** has a checkpoint write?
- [ ] Every **escalation path** terminates at either resolution or owner ping (no infinite loops)?
- [ ] Every **cost-saving variant** (cheaper model, smaller team) is **opt-in via config**, not default?
- [ ] Every **anti-pattern** in §11 has been considered and either avoided or explicitly accepted?

---

## 14. Validation against Bruniaux best-practice items

This is the canonical list from Bruniaux §8 — verify each is addressed.

| Bruniaux item | Status |
|---|---|
| Task decomposition with clear boundaries | ☐ |
| Interface-first contracts | ☐ |
| Fan-out / fan-in coordination | ☐ |
| AGENTS.md for compound learning (human-written only) | ☐ |
| Git worktree management (1 per feature) | ☐ |
| Cost optimization: lazy spawning, context pruning | ☐ |
| Cost optimization: hard token budgets per agent | ☐ |
| Quality assurance: validation checklist at end | ☐ |
| Loop guardrails: MAX_ITERATIONS with reflection | ☐ |
| Loop guardrails: kill-and-reassign criteria | ☐ |
| Dedicated reviewer teammate (read-only) | ☐ |
| Reviewer-to-builder ratio (1 per 3-4) | ☐ |
| Iterative retrieval for sub-agents (Bruniaux §9) | ☐ |
| WHY/WHAT separation in sub-agent briefs | ☐ |
| Explicit retrieval requests ("I need X because Y") | ☐ |

---

## 15. Validation against Claude Code platform constraints

Per [Claude Code agent-teams docs](https://code.claude.com/docs/en/agent-teams):

| Platform constraint | Design respects it? |
|---|---|
| Teammates cannot spawn their own teams (nesting depth 1) | ☐ |
| `/resume` does not restore in-process teammates → need checkpoints | ☐ |
| All teammates inherit lead's permission mode at spawn | ☐ |
| One team per session | ☐ |
| Model pinning works via agent frontmatter | ☐ |
| Mailbox is the only peer-to-peer channel | ☐ |
| Shared task list is the work-claiming mechanism | ☐ |
| TeammateIdle, TaskCreated, TaskCompleted hooks are the enforcement primitives | ☐ |

---

## 16. Validation against Superpowers methodology

Per [obra/superpowers](https://github.com/obra/superpowers):

| Superpowers skill | Used as-is? |
|---|---|
| `brainstorming` for design phase | ☐ |
| `using-git-worktrees` for phase 2 | ☐ |
| `writing-plans` for phase 3 | ☐ |
| `subagent-driven-development` for implementation | ☐ |
| `test-driven-development` enforced on every task | ☐ |
| `requesting-code-review` for end-of-wave review | ☐ |
| `finishing-a-development-branch` — used or replaced? | ☐ |
| TDD: RED → GREEN → REFACTOR enforced | ☐ |
| 2-5 minute task sizing in plans | ☐ |
| Two-stage review inside subagent-driven-development | ☐ |

If any skill is replaced or modified, document why in §13 of the spec.

---

## 17. Final review questions

Before shipping the design:

1. **Can a new developer read just the README and run the system?** If not, the docs need work.
2. **Can the spec be handed to Claude Code as-is for implementation?** If you'd need to clarify mid-implementation, the spec has gaps.
3. **What's the cheapest viable configuration?** Can you ship a `minimal` variant that proves the architecture before adding bells and whistles?
4. **What's the failure mode if Anthropic ships a breaking change?** Is there a version pin? A graceful degradation path?
5. **Who reviews the work after the team ships?** The reviewer? CI? The owner? Be explicit.
6. **What's measurable?** Token spend per feature, touchpoint count, time to ship, success rate. Without these, you can't tune the system.

---

**End of checklist.** Save this file alongside the spec; revisit on every major version bump.
