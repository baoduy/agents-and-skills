# Design: Expand team-superpower into a Full-Stack Engineering Team

**Date**: 2026-05-13
**Slug**: improve-engineering-agents
**Status**: Pending owner approval

---

## §1 — Summary

Expand `plugins/team-superpower/` from its current 4 lifecycle roles (designer, planner, implementer, reviewer) into a full-stack engineering team by adding 8 discipline-specific roles drawn from the `agency-agents/engineering/` corpus. All new roles are written in our terse house style (~30–50 lines, no emoji, plain prose, skill-chain references). No new plugin is created. No files are touched outside `plugins/team-superpower/` except three repo-level updates (plugin.json `agents[]`, `marketplace.json` description, `README.md` row).

---

## §2 — Scope of "improve"

The owner chose **Option C (selective adoption)**: pick the disciplines a real full-stack team needs, adapt them to our style, and add them as new files alongside the existing 4. The existing designer / planner / implementer / reviewer files are not modified.

---

## §3 — Role shortlist and justifications

The following 8 roles are added. Each maps to a gap in the current team. Domain-specific roles (Solidity, WeChat, Feishu, embedded firmware, filament-optimization, voice-AI, email-intelligence, rapid-prototyper, data-engineer, ai-data-remediation, autonomous-optimization, cms-developer, mobile-app-builder) are excluded as off-topic for a full-stack software development team.

| Role (filename) | Upstream source | Justification |
|---|---|---|
| `software-architect.md` | engineering-software-architect | Designs system boundaries and ADRs before the planner writes tasks. Fills the gap between design doc and technical implementation decisions. |
| `backend-developer.md` | engineering-backend-architect | Owns server-side feature implementation tasks. Specialises the generic `implementer` for API, database, and service logic. |
| `frontend-developer.md` | engineering-frontend-developer | Owns UI/component implementation tasks. Pairs with backend-developer for full-stack features. |
| `qa-engineer.md` | engineering-code-reviewer + upstream test coverage patterns | Owns test strategy, test plan writing, and QA sign-off. Distinct from `reviewer` (which does code review) — QC owns acceptance criteria verification and regression coverage. |
| `security-engineer.md` | engineering-security-engineer | Performs threat modelling and security review as a late-phase gate before `reviewer` signs off. Especially relevant for agent/plugin work that touches secrets, tokens, and external APIs. |
| `devops-engineer.md` | engineering-devops-automator | Owns CI/CD pipeline, release automation, and infrastructure-as-code tasks. Directly relevant to this repo's own release pipeline. |
| `technical-writer.md` | engineering-technical-writer | Produces SKILL.md, agent role docs, README updates, and plugin documentation. Directly relevant to a plugin marketplace team. |
| `minimal-change-engineer.md` | engineering-minimal-change-engineer | Enforces surgical diff discipline as an implementer variant for bug-fix and refactor tasks. Prevents scope creep in maintenance PRs. |

Roles considered and excluded from shortlist:

- **SRE**: Overlaps substantially with `devops-engineer` for a team this size. Add later when the team has distinct ops concerns.
- **Database Optimizer**: Subsumed by `backend-developer` for typical plugin/agent work. Add as specialisation if the team ships a database-heavy product.
- **Senior Developer** (upstream): Laravel/FluxUI-specific, not generalisable.
- **AI Engineer**: Relevant but highly overlap with existing `implementer` + `software-architect` for Claude Code agent work. The distinctive ML-ops content (TensorFlow, MLflow, Kubeflow) is out of scope for this team. Can be added in a follow-on spec.
- **Codebase Onboarding Engineer**: Useful but not a team member in the workflow — more of a utility role. Can be added as a skill rather than an agent role.
- **Git Workflow Master**: The content belongs in a skill (or the planner's existing responsibilities), not a dedicated team role.

---

## §4 — Role lifecycle fit (workflow integration)

The team-superpower workflow has 6 phases. New roles slot in as follows:

```
Phase 1  Brainstorming    designer
Phase 2  Worktree         planner
Phase 3  Plan             planner → (software-architect consult) → reviewer sanity-check
Phase 4  Implementation   implementer | backend-developer | frontend-developer
                          | minimal-change-engineer
         QA gate          qa-engineer (runs after all impl: tasks complete)
         Security gate    security-engineer (runs concurrently with QA or after)
Phase 5  Code review      reviewer
Phase 6  Finish           reviewer (finish-branch skill)
         Docs             technical-writer (triggered by lead alongside phase 6)
         DevOps           devops-engineer (triggered for infra/CI tasks)
```

### Role behaviours

**software-architect** — An optional phase-3 consultant. The lead may spawn the architect after the design doc is approved and before the plan is written, when the feature involves significant system-boundary decisions. The architect produces an ADR addendum to the design doc (saved to `docs/superpowers/specs/` alongside the design). It does not write tasks or code.

**backend-developer** — A specialised implementer. Claims `impl:be-` prefixed tasks from the shared task list. Follows the same subagent-driven-development + TDD loop as `implementer`. Scoped to server-side files (routes, services, repositories, schemas, migrations).

**frontend-developer** — A specialised implementer. Claims `impl:fe-` prefixed tasks. Scoped to UI components, pages, and client-side state files.

**minimal-change-engineer** — A specialised implementer for `impl:fix-` or `impl:refactor-` prefixed tasks. Its hard constraint is the smallest diff that solves the problem. Uses the same TDD loop but explicitly bans scope expansion.

**qa-engineer** — Runs after all `impl:` tasks complete, before phase-5 review. The lead assigns a `qa:` task. The QA engineer reads the design doc, the plan, and the test suite. Produces a QA report to `docs/superpowers/reviews/YYYY-MM-DD-<slug>-qa.md` covering: acceptance criteria coverage, regression gaps, and edge cases not covered by existing tests. Issues are filed as `impl:qa-fix-` tasks; the lead routes them to the responsible implementer. Posts `QA_PASSED <path>` when clean.

**security-engineer** — Runs concurrently with qa-engineer or immediately after, before phase-5 review. The lead assigns a `sec:` task. The security engineer reads the design doc, the diff, and the CI config. Produces a threat-model and findings report to `docs/superpowers/reviews/YYYY-MM-DD-<slug>-security.md`. Critical findings become `impl:sec-fix-` tasks. Posts `SECURITY_PASSED <path>` when clean.

**technical-writer** — Triggered by the lead alongside phase 6. Reads the approved design doc, the finished code, and the current plugin docs. Produces or updates SKILL.md files, agent role docs, and README sections. Writes docs to the same worktree. Posts `DOCS_DONE <path(s)>` when complete.

**devops-engineer** — Triggered by the lead for tasks tagged `impl:infra-` or `impl:ci-`. May run in parallel with other implementers during phase 4, or as a standalone pass for pipeline-only features. Follows the same TDD-where-applicable loop and posts completion to the lead.

### Spawn rules

The lead spawns discipline roles only when the feature touches that discipline's scope. A pure frontend bug fix spawns only `frontend-developer`; a full-stack feature spawns `backend-developer` + `frontend-developer` + `qa-engineer` + `security-engineer` + `technical-writer`. The lead decides the spawn set from the plan's task prefixes.

### Task prefix convention (new)

The plan produced by `planner` must use these task prefixes so the lead can route tasks to the correct role without reading every task:

| Prefix | Routed to |
|---|---|
| `impl:` (generic) | `implementer` |
| `impl:be-` | `backend-developer` |
| `impl:fe-` | `frontend-developer` |
| `impl:fix-` / `impl:refactor-` | `minimal-change-engineer` |
| `impl:infra-` / `impl:ci-` | `devops-engineer` |
| `qa:` | `qa-engineer` |
| `sec:` | `security-engineer` |
| `arch:` | `software-architect` |
| `docs:` | `technical-writer` |

This convention is added to the `planner.md` responsibilities in the implementation step (see §6).

---

## §5 — Terse role template

All new role files follow this template. Length budget: 35–55 lines including frontmatter.

```markdown
---
name: <role-name>
description: <one sentence covering what the role does and when it is spawned>
tools: <comma-separated tool list>
model: sonnet
---

# <Role Title> — Phase <N> (<Phase Name>)

You are the **<role>** teammate. <One sentence on primary mission.>

## Hard rules

1. <Constraint 1>
2. <Constraint 2>
3. <Constraint 3 — typically: escalate via §7 template for blockers>

## Responsibilities

<Short paragraph or tight bullet list covering core deliverables.>

## Output

Save output to `docs/superpowers/<subfolder>/YYYY-MM-DD-<slug>-<type>.md` and commit.
Post `<SIGNAL> <path>` to the lead's mailbox when done.

## Escalation

Use the §7 template in `docs/superpowers/ESCALATION.md` for any blocker.
Common blockers: <2–3 role-specific examples>.
```

---

## §6 — Files the implementation plan will touch

### New files (8)

All under `plugins/team-superpower/agents/`:

1. `software-architect.md`
2. `backend-developer.md`
3. `frontend-developer.md`
4. `qa-engineer.md`
5. `security-engineer.md`
6. `devops-engineer.md`
7. `technical-writer.md`
8. `minimal-change-engineer.md`

### Modified files (4)

1. `plugins/team-superpower/agents/planner.md` — Add task-prefix convention to phase-3 responsibilities. Existing text is otherwise unchanged.
2. `plugins/team-superpower/.claude-plugin/plugin.json` — Add `agents[]` array listing all 12 agent filenames (4 existing + 8 new).
3. `.claude-plugin/marketplace.json` — Update `team-superpower` entry `description` field to reflect the expanded team scope ("Full-stack engineering team that runs the Superpowers skill chain across designer, planner, implementer, reviewer, and 8 discipline roles — architect, backend, frontend, QA, security, devops, technical-writer, and minimal-change-engineer.").
4. `README.md` — Update the `team-superpower` row in the Plugins table to reflect the expanded description.

### Files not touched

`.claude/`, top-level `agents/`, `scripts/`, any other plugin directory. No new plugin created.

---

## §7 — Out-of-scope decisions deferred

- AI Engineer role — defer to a follow-on spec once the team ships its first AI-feature work.
- SRE role — defer until distinct ops concerns emerge.
- Codebase Onboarding role — consider as a skill, not an agent role.
- Changes to any other plugin.
- Changes to the superpowers skill chain files themselves.

---

## §8 — Spec self-review

1. Placeholder scan: no TBDs or incomplete sections.
2. Internal consistency: task-prefix table in §4 is consistent with the role routing descriptions. `planner.md` modification in §6 is consistent with the new prefix convention introduced in §4.
3. Scope check: 8 new files + 4 modifications. Fits a single implementation plan.
4. Ambiguity check: "software-architect as optional consultant" is explicit — the lead decides whether to spawn it. "qa-engineer runs before reviewer" is explicit in the phase ordering.
