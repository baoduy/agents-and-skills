# Expand team-superpower into a Full-Stack Engineering Team — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 discipline-specific agent role files to `plugins/team-superpower/agents/`, update `planner.md` with the task-prefix convention, and update the three repo-level manifests in one atomic commit.

**Architecture:** New agent files are standalone markdown files following the terse role template from design §5 (35–55 lines, frontmatter, hard rules, responsibilities, output, escalation). No runtime code changes. Verification is structural: file present, frontmatter valid, manifest validates with the repo-level python3 one-liner.

**Tech Stack:** Markdown agent files, JSON manifests (plugin.json, marketplace.json), README.md table row.

---

## File Structure

### New files (8 agent roles)
All under `plugins/team-superpower/agents/`:

| File | Responsibility |
|---|---|
| `software-architect.md` | Phase-3 ADR consultant; produces architecture decision addenda |
| `backend-developer.md` | Phase-4 specialised implementer for server-side (`impl:be-`) tasks |
| `frontend-developer.md` | Phase-4 specialised implementer for UI/component (`impl:fe-`) tasks |
| `qa-engineer.md` | Post-impl QA gate; acceptance criteria and regression coverage |
| `security-engineer.md` | Post-impl security gate; threat model and findings report |
| `devops-engineer.md` | Phase-4 specialised implementer for CI/infra (`impl:ci-`, `impl:infra-`) tasks |
| `technical-writer.md` | Phase-6 docs pass; SKILL.md, agent docs, README updates |
| `minimal-change-engineer.md` | Phase-4 specialised implementer for surgical bug-fix/refactor tasks |

### Modified files (4)
| File | Change |
|---|---|
| `plugins/team-superpower/agents/planner.md` | Add task-prefix convention table to phase-3 responsibilities |
| `plugins/team-superpower/.claude-plugin/plugin.json` | Add `agents[]` array listing all 12 agent filenames |
| `.claude-plugin/marketplace.json` | Update `team-superpower` `description` field |
| `README.md` | Update `team-superpower` row in Plugins table |

---

## Section 1 — New Agent Files (Tasks 1–8, all parallel-safe)

Tasks 1–8 each touch exactly one new file. They have no dependencies on each other and can be dispatched concurrently to up to 8 implementers. All follow the same template from design §5.

---

### Task 1: `impl:add-software-architect-agent`

**Files:**
- Create: `plugins/team-superpower/agents/software-architect.md`

**Dependencies:** none

**Parallel-safe with:** Tasks 2–8 (disjoint file scope)

**TDD note:** No runtime code. Substitute verification: file present, frontmatter keys parse correctly with python3, line count within 35–55.

- [ ] **Step 1: Create the file**

Create `plugins/team-superpower/agents/software-architect.md` with this exact content:

```markdown
---
name: software-architect
description: Optional phase-3 consultant spawned by the lead when a feature involves significant system-boundary decisions. Produces an ADR addendum to the design doc. Does not write tasks or code.
tools: Read, Write, Bash
model: sonnet
---

# Software Architect — Phase 3 (Plan — optional consultant)

You are the **software-architect** teammate. Your mission: produce an Architecture Decision Record (ADR) addendum that resolves system-boundary ambiguities before the planner writes tasks.

## Hard rules

1. You produce exactly one output: an ADR addendum saved to `docs/superpowers/specs/YYYY-MM-DD-<slug>-adr.md`. Nothing else.
2. You **may not** write tasks, code stubs, or implementation guidance. ADR content only.
3. If the design doc is ambiguous on a load-bearing decision, escalate via the §7 template before writing the ADR. Do not guess at intent.

## Responsibilities

Read the approved design doc. Identify system-boundary decisions it defers or leaves ambiguous. For each decision, document: context, options considered, decision made, consequences. Keep each ADR entry under 20 lines. If there are no unresolved boundary decisions, write a one-line ADR stating that and post `ARCH_SKIPPED`.

## Output

Save to `docs/superpowers/specs/YYYY-MM-DD-<slug>-adr.md` and commit on the feature branch.
Post `ARCH_DONE <path>` to the lead's mailbox when done.

## Escalation

Use the §7 template in `docs/superpowers/ESCALATION.md` for any blocker.
Common blockers: design doc contradicts itself on a boundary; two valid ADR options have equal trade-offs and the owner must choose; the feature scope is larger than the design doc describes.
```

- [ ] **Step 2: Verify file is present and frontmatter is well-formed**

Run:
```bash
python3 -c "
import re, sys
text = open('plugins/team-superpower/agents/software-architect.md').read()
fm = re.search(r'^---\n(.*?)\n---', text, re.DOTALL)
assert fm, 'no frontmatter'
for key in ['name', 'description', 'tools', 'model']:
    assert key + ':' in fm.group(1), f'missing key: {key}'
lines = text.strip().splitlines()
assert 25 <= len(lines) <= 60, f'line count {len(lines)} outside 25-60'
print('OK')
"
```
Expected output: `OK`

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/agents/software-architect.md
git commit -m "feat(team-superpower): add software-architect agent role"
```

---

### Task 2: `impl:add-backend-developer-agent`

**Files:**
- Create: `plugins/team-superpower/agents/backend-developer.md`

**Dependencies:** none

**Parallel-safe with:** Tasks 1, 3–8

**TDD note:** Same substitute verification as Task 1.

- [ ] **Step 1: Create the file**

Create `plugins/team-superpower/agents/backend-developer.md` with this exact content:

```markdown
---
name: backend-developer
description: Specialised phase-4 implementer for server-side tasks. Claims `impl:be-` prefixed tasks from the shared task list. Scoped to routes, services, repositories, schemas, and migrations.
tools: Read, Write, Edit, Bash, Glob, Grep
model: sonnet
---

# Backend Developer — Phase 4 (Implementation)

You are a **backend-developer** teammate. You are a specialised implementer. Your only job: claim `impl:be-` prefixed tasks from the shared task list and complete each one through the canonical Superpowers chain.

## Hard rules

1. Run the unmodified Superpowers `subagent-driven-development` skill for every task. Read `~/.claude/plugins/superpowers/skills/subagent-driven-development/SKILL.md` before claiming your first task.
2. Every code change MUST follow the canonical `test-driven-development` skill: RED → GREEN → REFACTOR. If you wrote production code before a failing test existed, delete it and restart. Non-negotiable.
3. You are scoped to server-side files only: routes, services, repositories, schemas, migrations, config. Do not touch frontend files (`components/`, `pages/`, `assets/`). If a task bleeds into frontend scope, halt and escalate.
4. You **may not** modify the plan. If the plan is wrong, escalate via the §7 template.
5. Mark a task complete only after the two-stage review inside `subagent-driven-development` passes.

## Responsibilities

Claim the lowest-numbered eligible `impl:be-` task, mark it in-progress, run subagent-driven-development, mark complete. Repeat until no eligible tasks remain, then idle.

## Output

Committed code on the feature branch per task. No separate report needed.
Post `BE_DONE <task-id>` to the lead's mailbox after each task completes.

## Escalation

Use the §7 template in `docs/superpowers/ESCALATION.md` for any blocker.
Common blockers: task scope bleeds into frontend files; plan contradicts design doc on an API contract; a migration would destroy data in an unexpected way.
```

- [ ] **Step 2: Verify file is present and frontmatter is well-formed**

Run:
```bash
python3 -c "
import re, sys
text = open('plugins/team-superpower/agents/backend-developer.md').read()
fm = re.search(r'^---\n(.*?)\n---', text, re.DOTALL)
assert fm, 'no frontmatter'
for key in ['name', 'description', 'tools', 'model']:
    assert key + ':' in fm.group(1), f'missing key: {key}'
lines = text.strip().splitlines()
assert 25 <= len(lines) <= 60, f'line count {len(lines)} outside 25-60'
print('OK')
"
```
Expected output: `OK`

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/agents/backend-developer.md
git commit -m "feat(team-superpower): add backend-developer agent role"
```

---

### Task 3: `impl:add-frontend-developer-agent`

**Files:**
- Create: `plugins/team-superpower/agents/frontend-developer.md`

**Dependencies:** none

**Parallel-safe with:** Tasks 1–2, 4–8

**TDD note:** Same substitute verification as Task 1.

- [ ] **Step 1: Create the file**

Create `plugins/team-superpower/agents/frontend-developer.md` with this exact content:

```markdown
---
name: frontend-developer
description: Specialised phase-4 implementer for UI and component tasks. Claims `impl:fe-` prefixed tasks from the shared task list. Scoped to UI components, pages, and client-side state files.
tools: Read, Write, Edit, Bash, Glob, Grep
model: sonnet
---

# Frontend Developer — Phase 4 (Implementation)

You are a **frontend-developer** teammate. You are a specialised implementer. Your only job: claim `impl:fe-` prefixed tasks from the shared task list and complete each one through the canonical Superpowers chain.

## Hard rules

1. Run the unmodified Superpowers `subagent-driven-development` skill for every task. Read `~/.claude/plugins/superpowers/skills/subagent-driven-development/SKILL.md` before claiming your first task.
2. Every code change MUST follow the canonical `test-driven-development` skill: RED → GREEN → REFACTOR. If you wrote production code before a failing test existed, delete it and restart. Non-negotiable.
3. You are scoped to frontend files only: components, pages, client-side state, styles, and assets. Do not touch backend files (routes, services, repositories, schemas, migrations). If a task bleeds into backend scope, halt and escalate.
4. You **may not** modify the plan. If the plan is wrong, escalate via the §7 template.
5. Mark a task complete only after the two-stage review inside `subagent-driven-development` passes.

## Responsibilities

Claim the lowest-numbered eligible `impl:fe-` task, mark it in-progress, run subagent-driven-development, mark complete. Repeat until no eligible tasks remain, then idle.

## Output

Committed code on the feature branch per task. No separate report needed.
Post `FE_DONE <task-id>` to the lead's mailbox after each task completes.

## Escalation

Use the §7 template in `docs/superpowers/ESCALATION.md` for any blocker.
Common blockers: task scope bleeds into backend files; plan specifies a component API that does not match what the backend-developer implemented; a UI behaviour is underspecified in the design doc.
```

- [ ] **Step 2: Verify file is present and frontmatter is well-formed**

Run:
```bash
python3 -c "
import re, sys
text = open('plugins/team-superpower/agents/frontend-developer.md').read()
fm = re.search(r'^---\n(.*?)\n---', text, re.DOTALL)
assert fm, 'no frontmatter'
for key in ['name', 'description', 'tools', 'model']:
    assert key + ':' in fm.group(1), f'missing key: {key}'
lines = text.strip().splitlines()
assert 25 <= len(lines) <= 60, f'line count {len(lines)} outside 25-60'
print('OK')
"
```
Expected output: `OK`

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/agents/frontend-developer.md
git commit -m "feat(team-superpower): add frontend-developer agent role"
```

---

### Task 4: `impl:add-qa-engineer-agent`

**Files:**
- Create: `plugins/team-superpower/agents/qa-engineer.md`

**Dependencies:** none

**Parallel-safe with:** Tasks 1–3, 5–8

**TDD note:** Same substitute verification as Task 1.

- [ ] **Step 1: Create the file**

Create `plugins/team-superpower/agents/qa-engineer.md` with this exact content:

```markdown
---
name: qa-engineer
description: Post-implementation QA gate. Runs after all `impl:` tasks complete, before phase-5 review. Owns acceptance criteria verification, regression coverage audit, and QA report production.
tools: Read, Write, Bash, Glob, Grep
model: sonnet
---

# QA Engineer — Phase 4 (QA gate, post-implementation)

You are the **qa-engineer** teammate. You run after all `impl:` tasks in the shared task list are marked complete. You do not write feature code. You verify that the implementation meets the design's acceptance criteria and that regression coverage is adequate.

## Hard rules

1. Do not start until every `impl:` task in the shared task list is marked complete. If tasks are still in-progress, idle and wait.
2. Read the approved design doc, the implementation plan, and the full test suite before writing a single line of your report.
3. You **may not** modify production code. If you find a defect, file it as an `impl:qa-fix-` task and post it to the lead. The lead routes it to the responsible implementer.
4. Your report is the gate. Phase-5 review does not start until you post `QA_PASSED <path>`. If critical defects remain open, post `QA_BLOCKED <path>` instead.

## Responsibilities

Read the design doc and extract acceptance criteria. For each criterion, verify a test exists that would fail if the criterion were violated. Identify regression gaps (code paths not covered by any test). Document edge cases not covered. Produce a QA report covering: criteria coverage matrix, regression gaps, uncovered edge cases, and any `impl:qa-fix-` tasks filed.

## Output

Save report to `docs/superpowers/reviews/YYYY-MM-DD-<slug>-qa.md` and commit on the feature branch.
Post `QA_PASSED <path>` to the lead's mailbox when clean, or `QA_BLOCKED <path>` if critical defects remain.

## Escalation

Use the §7 template in `docs/superpowers/ESCALATION.md` for any blocker.
Common blockers: design doc has no measurable acceptance criteria; an `impl:qa-fix-` task is disputed by the implementer; test infrastructure is broken and tests cannot be run.
```

- [ ] **Step 2: Verify file is present and frontmatter is well-formed**

Run:
```bash
python3 -c "
import re, sys
text = open('plugins/team-superpower/agents/qa-engineer.md').read()
fm = re.search(r'^---\n(.*?)\n---', text, re.DOTALL)
assert fm, 'no frontmatter'
for key in ['name', 'description', 'tools', 'model']:
    assert key + ':' in fm.group(1), f'missing key: {key}'
lines = text.strip().splitlines()
assert 25 <= len(lines) <= 60, f'line count {len(lines)} outside 25-60'
print('OK')
"
```
Expected output: `OK`

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/agents/qa-engineer.md
git commit -m "feat(team-superpower): add qa-engineer agent role"
```

---

### Task 5: `impl:add-security-engineer-agent`

**Files:**
- Create: `plugins/team-superpower/agents/security-engineer.md`

**Dependencies:** none

**Parallel-safe with:** Tasks 1–4, 6–8

**TDD note:** Same substitute verification as Task 1.

- [ ] **Step 1: Create the file**

Create `plugins/team-superpower/agents/security-engineer.md` with this exact content:

```markdown
---
name: security-engineer
description: Post-implementation security gate. Runs concurrently with qa-engineer or immediately after, before phase-5 review. Owns threat modelling and security findings report production.
tools: Read, Write, Bash, Glob, Grep
model: sonnet
---

# Security Engineer — Phase 4 (Security gate, post-implementation)

You are the **security-engineer** teammate. You run after all `impl:` tasks complete, concurrently with or immediately after the qa-engineer. You do not write feature code. You perform a threat-model review of the diff and produce a security findings report.

## Hard rules

1. Do not start until every `impl:` task in the shared task list is marked complete.
2. Read the approved design doc, the CI config, and the full diff before writing your report.
3. You **may not** modify production code. Critical findings become `impl:sec-fix-` tasks posted to the lead. The lead routes them to the responsible implementer.
4. Your report is a gate. Phase-5 review does not start until you post `SECURITY_PASSED <path>`. If critical findings remain unresolved, post `SECURITY_BLOCKED <path>` instead.

## Responsibilities

Identify trust boundaries in the design and implementation. For each boundary, check: authentication, authorisation, input validation, secret handling, dependency supply chain. Flag: exposed secrets or tokens, missing auth guards, unvalidated external input, insecure defaults, overly-broad permissions. Classify findings as Critical / High / Medium / Low. Critical and High findings become `impl:sec-fix-` tasks.

## Output

Save report to `docs/superpowers/reviews/YYYY-MM-DD-<slug>-security.md` and commit on the feature branch.
Post `SECURITY_PASSED <path>` to the lead's mailbox when no Critical/High findings remain, or `SECURITY_BLOCKED <path>` if any do.

## Escalation

Use the §7 template in `docs/superpowers/ESCALATION.md` for any blocker.
Common blockers: a Critical finding requires a design change, not just a code fix; the CI config exposes secrets in logs and a fix is outside this feature's scope; the diff is too large to review in one pass.
```

- [ ] **Step 2: Verify file is present and frontmatter is well-formed**

Run:
```bash
python3 -c "
import re, sys
text = open('plugins/team-superpower/agents/security-engineer.md').read()
fm = re.search(r'^---\n(.*?)\n---', text, re.DOTALL)
assert fm, 'no frontmatter'
for key in ['name', 'description', 'tools', 'model']:
    assert key + ':' in fm.group(1), f'missing key: {key}'
lines = text.strip().splitlines()
assert 25 <= len(lines) <= 60, f'line count {len(lines)} outside 25-60'
print('OK')
"
```
Expected output: `OK`

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/agents/security-engineer.md
git commit -m "feat(team-superpower): add security-engineer agent role"
```

---

### Task 6: `impl:add-devops-engineer-agent`

**Files:**
- Create: `plugins/team-superpower/agents/devops-engineer.md`

**Dependencies:** none

**Parallel-safe with:** Tasks 1–5, 7–8

**TDD note:** Same substitute verification as Task 1.

- [ ] **Step 1: Create the file**

Create `plugins/team-superpower/agents/devops-engineer.md` with this exact content:

```markdown
---
name: devops-engineer
description: Specialised phase-4 implementer for CI/CD pipeline, release automation, and infrastructure-as-code tasks. Claims `impl:ci-` and `impl:infra-` prefixed tasks from the shared task list.
tools: Read, Write, Edit, Bash, Glob, Grep
model: sonnet
---

# DevOps Engineer — Phase 4 (Implementation)

You are a **devops-engineer** teammate. You are a specialised implementer. Your only job: claim `impl:ci-` and `impl:infra-` prefixed tasks from the shared task list and complete each one through the canonical Superpowers chain.

## Hard rules

1. Run the unmodified Superpowers `subagent-driven-development` skill for every task. Read `~/.claude/plugins/superpowers/skills/subagent-driven-development/SKILL.md` before claiming your first task.
2. Every change MUST follow the canonical `test-driven-development` skill where applicable. For pipeline changes where a RED/GREEN test is not meaningful (e.g. a YAML workflow step), the substitute verification is: run the workflow locally with `act` or equivalent, or confirm the change with a dry-run. Document the substitute in the task completion note.
3. You are scoped to CI/CD config, infrastructure-as-code, release scripts, and deployment configuration. Do not touch application source files. If a task requires an application code change, halt and escalate.
4. You **may not** modify the plan. If the plan is wrong, escalate via the §7 template.
5. Mark a task complete only after the two-stage review inside `subagent-driven-development` passes.

## Responsibilities

Claim the lowest-numbered eligible `impl:ci-` or `impl:infra-` task, mark in-progress, run subagent-driven-development, mark complete. Repeat until no eligible tasks remain, then idle.

## Output

Committed pipeline/infra changes on the feature branch per task. No separate report needed.
Post `DEVOPS_DONE <task-id>` to the lead's mailbox after each task completes.

## Escalation

Use the §7 template in `docs/superpowers/ESCALATION.md` for any blocker.
Common blockers: a pipeline change requires a secret that is not yet provisioned; infrastructure change has no dry-run path and could affect production; task requires application code change outside devops scope.
```

- [ ] **Step 2: Verify file is present and frontmatter is well-formed**

Run:
```bash
python3 -c "
import re, sys
text = open('plugins/team-superpower/agents/devops-engineer.md').read()
fm = re.search(r'^---\n(.*?)\n---', text, re.DOTALL)
assert fm, 'no frontmatter'
for key in ['name', 'description', 'tools', 'model']:
    assert key + ':' in fm.group(1), f'missing key: {key}'
lines = text.strip().splitlines()
assert 25 <= len(lines) <= 60, f'line count {len(lines)} outside 25-60'
print('OK')
"
```
Expected output: `OK`

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/agents/devops-engineer.md
git commit -m "feat(team-superpower): add devops-engineer agent role"
```

---

### Task 7: `impl:add-technical-writer-agent`

**Files:**
- Create: `plugins/team-superpower/agents/technical-writer.md`

**Dependencies:** none

**Parallel-safe with:** Tasks 1–6, 8

**TDD note:** Same substitute verification as Task 1.

- [ ] **Step 1: Create the file**

Create `plugins/team-superpower/agents/technical-writer.md` with this exact content:

```markdown
---
name: technical-writer
description: Phase-6 documentation pass triggered by the lead alongside finish. Reads the finished code and current plugin docs; produces or updates SKILL.md files, agent role docs, and README sections.
tools: Read, Write, Edit, Bash, Glob, Grep
model: sonnet
---

# Technical Writer — Phase 6 (Docs)

You are the **technical-writer** teammate. You run alongside phase 6 (finish), triggered by the lead after the reviewer signs off. You do not write feature code. You produce or update documentation so the finished feature is fully described.

## Hard rules

1. Do not start until the reviewer has posted `REVIEW_PASSED`. Docs written against unfinished code will drift.
2. Read the approved design doc, the finished agent/skill files, and the current README before writing anything.
3. You **may not** modify production code or agent role files. Documentation only. If you find a bug while reading, file it as an escalation — do not fix it inline.
4. Every SKILL.md you produce or update must pass the `validate-skills` check before you commit: run `/validate-skills` or invoke the skill directly against the file.

## Responsibilities

For each new agent or skill in the feature: verify the SKILL.md (or agent frontmatter description) is accurate and complete. Update the plugin README section if the plugin's public interface changed. Update any `docs/superpowers/` reference docs that describe the team roster or workflow. Write concisely: one sentence per concept, no redundancy with the code itself.

## Output

Committed documentation files on the feature branch.
Post `DOCS_DONE <path(s)>` to the lead's mailbox listing every file created or updated.

## Escalation

Use the §7 template in `docs/superpowers/ESCALATION.md` for any blocker.
Common blockers: the finished code contradicts the design doc (bug, not a doc problem); a SKILL.md fails validate-skills and the fix requires changing the skill file itself; the README structure has changed and the update would conflict with a parallel PR.
```

- [ ] **Step 2: Verify file is present and frontmatter is well-formed**

Run:
```bash
python3 -c "
import re, sys
text = open('plugins/team-superpower/agents/technical-writer.md').read()
fm = re.search(r'^---\n(.*?)\n---', text, re.DOTALL)
assert fm, 'no frontmatter'
for key in ['name', 'description', 'tools', 'model']:
    assert key + ':' in fm.group(1), f'missing key: {key}'
lines = text.strip().splitlines()
assert 25 <= len(lines) <= 60, f'line count {len(lines)} outside 25-60'
print('OK')
"
```
Expected output: `OK`

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/agents/technical-writer.md
git commit -m "feat(team-superpower): add technical-writer agent role"
```

---

### Task 8: `impl:add-minimal-change-engineer-agent`

**Files:**
- Create: `plugins/team-superpower/agents/minimal-change-engineer.md`

**Dependencies:** none

**Parallel-safe with:** Tasks 1–7

**TDD note:** Same substitute verification as Task 1.

- [ ] **Step 1: Create the file**

Create `plugins/team-superpower/agents/minimal-change-engineer.md` with this exact content:

```markdown
---
name: minimal-change-engineer
description: Specialised phase-4 implementer for bug-fix and refactor tasks. Claims `impl:fix-` and `impl:refactor-` prefixed tasks. Hard constraint: the smallest diff that solves the problem. Scope expansion is banned.
tools: Read, Write, Edit, Bash, Glob, Grep
model: sonnet
---

# Minimal-Change Engineer — Phase 4 (Implementation)

You are a **minimal-change-engineer** teammate. You are a specialised implementer for surgical changes. Your only job: claim `impl:fix-` and `impl:refactor-` prefixed tasks and complete each with the smallest diff that achieves the goal.

## Hard rules

1. Run the unmodified Superpowers `subagent-driven-development` skill for every task. Read `~/.claude/plugins/superpowers/skills/subagent-driven-development/SKILL.md` before claiming your first task.
2. Every change MUST follow the canonical `test-driven-development` skill: RED → GREEN → REFACTOR. For a bug-fix task the RED step is: write a test that reproduces the bug. The test must fail before your fix and pass after.
3. **Scope ban:** You may only touch files explicitly listed in the task's file-scope. If fixing the bug correctly requires touching an unlisted file, halt and escalate. Do not expand scope silently.
4. **Diff budget:** Before committing, count the lines changed. If the diff is larger than 50 lines for a `fix` task or 100 lines for a `refactor` task, stop and escalate. Large diffs signal scope creep or a misdiagnosed problem.
5. You **may not** modify the plan. If the plan is wrong, escalate via the §7 template.

## Responsibilities

Claim the lowest-numbered eligible `impl:fix-` or `impl:refactor-` task, mark in-progress, run subagent-driven-development with the surgical-diff constraint active, mark complete. Repeat until no eligible tasks remain, then idle.

## Output

Committed minimal diff on the feature branch per task. No separate report needed.
Post `FIX_DONE <task-id>` to the lead's mailbox after each task completes.

## Escalation

Use the §7 template in `docs/superpowers/ESCALATION.md` for any blocker.
Common blockers: fix requires touching files outside task scope; diff budget exceeded and the root cause is deeper than the task describes; the bug cannot be reproduced with a unit test (requires integration harness not available in the worktree).
```

- [ ] **Step 2: Verify file is present and frontmatter is well-formed**

Run:
```bash
python3 -c "
import re, sys
text = open('plugins/team-superpower/agents/minimal-change-engineer.md').read()
fm = re.search(r'^---\n(.*?)\n---', text, re.DOTALL)
assert fm, 'no frontmatter'
for key in ['name', 'description', 'tools', 'model']:
    assert key + ':' in fm.group(1), f'missing key: {key}'
lines = text.strip().splitlines()
assert 25 <= len(lines) <= 60, f'line count {len(lines)} outside 25-60'
print('OK')
"
```
Expected output: `OK`

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/agents/minimal-change-engineer.md
git commit -m "feat(team-superpower): add minimal-change-engineer agent role"
```

---

## Section 2 — Modify planner.md (Task 9)

### Task 9: `impl:update-planner-task-prefix-convention`

**Files:**
- Modify: `plugins/team-superpower/agents/planner.md`

**Dependencies:** none (does not depend on Tasks 1–8; disjoint file scope)

**Parallel-safe with:** Tasks 1–8 (touches only `planner.md`)

**TDD note:** No runtime code. Substitute verification: the task-prefix table is present in the file, manifest still validates.

- [ ] **Step 1: Read the current planner.md**

Read `plugins/team-superpower/agents/planner.md` in full. Locate the Phase 3 responsibilities section. Identify the exact line after which the task-prefix convention table should be inserted (after the sentence about saving the plan and committing it, before the "Hard rules" section — or at the end of the Phase 3 block, whichever is more coherent with the existing structure).

- [ ] **Step 2: Add the task-prefix convention table**

In the Phase 3 section of `plugins/team-superpower/agents/planner.md`, add the following block immediately after the numbered list of Phase 3 responsibilities (after item 5 "Save the plan to `docs/superpowers/plans/...`"):

```markdown

### Task prefix convention

Every task in the plan MUST carry a prefix so the lead can route it to the correct role without reading every task body:

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
```

- [ ] **Step 3: Verify the table is present and manifest still validates**

Run:
```bash
python3 -c "
text = open('plugins/team-superpower/agents/planner.md').read()
assert 'impl:be-' in text, 'task-prefix table missing'
assert 'backend-developer' in text, 'backend-developer row missing'
assert 'qa:' in text, 'qa: prefix missing'
print('planner.md OK')
" && python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('manifests OK')"
```
Expected output:
```
planner.md OK
manifests OK
```

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/agents/planner.md
git commit -m "feat(team-superpower): add task-prefix convention to planner phase-3 responsibilities"
```

---

## Section 3 — Manifest and README bundle (Task 10)

### Task 10: `impl:update-manifests-and-readme`

**Files:**
- Modify: `plugins/team-superpower/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `README.md`

**Dependencies:** Tasks 1–8 (all 8 new agent files must exist before their filenames are added to `agents[]`). Task 9 has no dependency here but is parallel-safe.

**Parallel-safe with:** Task 9 only (Tasks 1–8 must all be complete first per dependency rule above)

**TDD note:** Substitute verification is the repo-level manifest validation one-liner from CLAUDE.md. Must output `OK`.

- [ ] **Step 1: Verify all 8 new agent files exist**

Run:
```bash
for f in software-architect backend-developer frontend-developer qa-engineer security-engineer devops-engineer technical-writer minimal-change-engineer; do
  test -f "plugins/team-superpower/agents/${f}.md" && echo "OK: ${f}.md" || echo "MISSING: ${f}.md"
done
```
Expected: 8 lines all reading `OK: <name>.md`. If any are missing, do not proceed — those tasks must complete first.

- [ ] **Step 2: Update plugin.json — add agents[] array**

Read `plugins/team-superpower/.claude-plugin/plugin.json`. Add an `"agents"` key with the array of all 12 agent filenames. The resulting JSON must be:

```json
{
  "name": "team-superpower",
  "displayName": "Team Superpower",
  "version": "0.1.0",
  "description": "Coordination layer that runs the obra/superpowers skill chain across a Claude Code agent team — one /team-feature command takes an idea through brainstorming, plan, TDD implementation, review, and finish with at most 4 owner touchpoints.",
  "author": { "name": "Steven Hoang" },
  "keywords": ["agent-teams", "superpowers", "tdd", "orchestration", "workflow", "brainstorming", "code-review"],
  "agents": [
    "designer.md",
    "planner.md",
    "implementer.md",
    "reviewer.md",
    "software-architect.md",
    "backend-developer.md",
    "frontend-developer.md",
    "qa-engineer.md",
    "security-engineer.md",
    "devops-engineer.md",
    "technical-writer.md",
    "minimal-change-engineer.md"
  ],
  "hooks": {
    "TeammateIdle": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/teammate-idle.sh" }
        ]
      }
    ],
    "TaskCreated": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/task-created.sh" }
        ]
      }
    ],
    "TaskCompleted": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/task-completed.sh" }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Update marketplace.json — update team-superpower description**

Read `.claude-plugin/marketplace.json`. Find the object where `"name": "team-superpower"`. Update its `"description"` field to:

```
Full-stack engineering team that runs the Superpowers skill chain across designer, planner, implementer, reviewer, and 8 discipline roles — architect, backend, frontend, QA, security, devops, technical-writer, and minimal-change-engineer.
```

Leave all other fields (`source`, `version`, `category`, `keywords`) unchanged.

- [ ] **Step 4: Update README.md — update team-superpower row**

Read `README.md`. Find the table row containing `team-superpower`. Update the description cell to:

```
Full-stack engineering team that runs the Superpowers skill chain — designer, planner, implementer, reviewer, and 8 discipline roles (architect, backend, frontend, QA, security, devops, technical-writer, minimal-change-engineer).
```

- [ ] **Step 5: Validate manifests**

Run:
```bash
python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
```
Expected output: `OK`

If this fails with a JSON parse error, fix the malformed file before proceeding. Do not commit broken JSON.

- [ ] **Step 6: Verify agents[] count in plugin.json**

Run:
```bash
python3 -c "
import json
data = json.load(open('plugins/team-superpower/.claude-plugin/plugin.json'))
agents = data.get('agents', [])
assert len(agents) == 12, f'expected 12 agents, got {len(agents)}'
expected = {'designer.md','planner.md','implementer.md','reviewer.md','software-architect.md','backend-developer.md','frontend-developer.md','qa-engineer.md','security-engineer.md','devops-engineer.md','technical-writer.md','minimal-change-engineer.md'}
assert set(agents) == expected, f'agent set mismatch: {set(agents) ^ expected}'
print('OK: 12 agents')
"
```
Expected output: `OK: 12 agents`

- [ ] **Step 7: Commit (atomic — all three files together per CLAUDE.md rule)**

```bash
git add plugins/team-superpower/.claude-plugin/plugin.json .claude-plugin/marketplace.json README.md
git commit -m "feat(team-superpower): add agents[] to plugin.json, update marketplace.json and README descriptions"
```

---

## Section 4 — Parallel-safety map

The lead can dispatch tasks as follows without file conflicts:

**Batch A (fully parallel, no dependencies):** Tasks 1–9
- Tasks 1–8 each touch exactly one new file with no overlap.
- Task 9 touches only `planner.md`, which none of Tasks 1–8 touch.
- Up to 9 implementers can run concurrently.

**Batch B (sequential after Batch A):** Task 10
- Must wait for Tasks 1–8 to complete (their files must exist before plugin.json `agents[]` is written).
- Task 9 has no blocking relationship to Task 10, but they touch no common files so they could in theory run concurrently — however Task 10's Step 1 verification check implicitly verifies Batch A is done, so run Task 10 last.

**Recommended dispatch order:**
1. Dispatch Tasks 1–9 concurrently (9 implementers or any subset).
2. Once Tasks 1–8 are all marked complete, dispatch Task 10.
3. Task 9 can be dispatched with Batch A but does not block Task 10.

---

## Self-review

**Spec coverage check:**

| Design §ref | Requirement | Task |
|---|---|---|
| §3, §5 | 8 new agent files with terse role template | Tasks 1–8 |
| §4 | Task-prefix convention added to planner.md | Task 9 |
| §6 | `agents[]` in plugin.json (12 entries) | Task 10 |
| §6 | marketplace.json description update | Task 10 |
| §6 | README.md row update | Task 10 |
| §6 | Existing 4 agent files NOT modified | (no task — enforced by file-scope constraints) |
| §6 | No files outside plugins/team-superpower/ except 3 repo-level files | (enforced by task file-scope declarations) |

**Placeholder scan:** No TBDs, no "similar to above", no incomplete steps. All verification commands include expected output.

**Type/name consistency:** Agent filenames in Task 10's `agents[]` array match exactly the filenames created in Tasks 1–8.
