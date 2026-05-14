# Clarification Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut owner-bound escalations from `team-superpower` by gating peer-resolvable questions through a 4-class rubric, a mandatory `Peer attempts` escalation field, a per-role decision rubric, an Assumptions log, and a lead enforcement rule that bounces premature owner escalations.

**Architecture:** All changes are documentation + one hook field. No runtime behavior change beyond the existing warn-only hooks. Source of truth for the 4-class table lives in `assets/ESCALATION.md`; per-role agent files cite the classes; `commands/team-feature.md` adds the lead enforcement rule and Assumptions checkpoint section; `hooks/task-completed.sh` adds `"Peer attempts"` to `required_fields` (warn-only). `assets/SESSION_README.md` and `plugins/team-superpower/README.md` get pointer subsections.

**Tech Stack:** Markdown (agent prompts, command prompts, assets), Bash 3.2+ with `jq` (hook), no test framework — smoke tests via piped JSON stdin and `grep` on the produced `log.jsonl`.

---

## File Structure

Changed files (all under `plugins/team-superpower/`):

- `assets/ESCALATION.md` — template gains `Peer attempts:` field; 3 worked examples updated; 4th worked example added (tactical no-peer).
- `assets/SESSION_README.md` — adds `RETRY_PEER` troubleshooting row + Assumptions reference.
- `hooks/task-completed.sh` — adds `"Peer attempts"` to `required_fields` array.
- `agents/designer.md` — `## Clarification routing` section appended.
- `agents/planner.md` — same.
- `agents/backend-developer.md` — same.
- `agents/frontend-developer.md` — same.
- `agents/qa-engineer.md` — same.
- `agents/reviewer.md` — same.
- `agents/software-architect.md` — same.
- `agents/security-engineer.md` — same.
- `commands/team-feature.md` — adds Hard rule for lead `RETRY_PEER` enforcement + `## Assumptions` section to checkpoint template.
- `README.md` — adds "Clarification routing" subsection.

No new files. No test files (project ships none for team-superpower).

---

### Task 1: ESCALATION.md — add `Peer attempts` field, update worked examples

**Files:**
- Modify: `plugins/team-superpower/assets/ESCALATION.md`

- [ ] **Step 1: Update the canonical template block**

Replace the `## Template` code block (lines 7–17) with:

```
BLOCKED: <one-line question>
Phase: <design | plan | pre_impl_review | implementation | qa | review | finish>
Context: <2-4 sentences — what we tried, what we considered, why we are stuck>
Options:
  A. <option> — <trade-off>
  B. <option> — <trade-off>
  C. <option> — <trade-off>  (optional)
Recommendation: <our pick + one-sentence why>
Need from you: <choose one | yes/no | other>
Peer attempts:
  - <ISO ts> asked <role>: <one-line reply summary or "no reply within cadence">
  - <ISO ts> asked <role>: <one-line reply summary or "no reply within cadence">
  (or, when no peer attempt is required:)
  - class=tactical — no peer attempt; logged as assumption, see checkpoint § Assumptions
  - class=owner-only — no peer attempt because <reason>
```

- [ ] **Step 2: Update the required-fields sentence**

Change line 19 from:

```
All five labels (`Phase`, `Context`, `Options`, `Recommendation`, `Need from you`) MUST appear. Missing any → the hook blocks the task completion with `BAD_ESCALATION: missing field(s) ...`.
```

to:

```
All six labels (`Phase`, `Context`, `Options`, `Recommendation`, `Need from you`, `Peer attempts`) MUST appear. The `TaskCompleted` hook warns (warn-only since 2026-05-14) with `bad_escalation: missing field(s) ...` if any are missing.
```

- [ ] **Step 3: Insert the 4-class decision table**

Insert this section between the updated sentence (now after line 19) and `## Worked example 1`:

```markdown
## Decision classes

| Class           | Examples                                                                                       | Routing                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| tactical        | naming, error wording, log field choice, fixture data, threshold inside a stated range         | Originator decides. Logs to checkpoint § Assumptions. No mailbox, no escalation.                                                                  |
| cross-role      | API contract shape across roles, test placement, error-handling contract                       | Mailbox to the peer role. Consensus on the first round-trip → log + proceed. After 2 round-trips with no consensus → escalate citing the attempts. |
| architectural   | new runtime dependency, persistence-model change, public-interface shape change                | Mailbox to `software-architect` first. Sign-off → log as architectural assumption. Dissent or no-decide → escalate.                              |
| owner-only      | scope change, design-vs-plan contradiction, external policy, security-blocking decision        | Escalate immediately. No peer attempt required. `Peer attempts` field records `class=owner-only — no peer attempt needed because <reason>`.       |

Classification rule of thumb: if the answer changes a test the implementer would write, AND the existing design / plan does not pin it, AND the change does not alter scope / architecture / external policy, the question is tactical or cross-role. Otherwise it is architectural or owner-only.
```

- [ ] **Step 4: Update worked example 1 (planner → designer)**

Append before the closing ` ``` ` of worked example 1 (after the existing `Need from you: choose A/B/C.` line):

```
Peer attempts:
  - 2026-05-12T14:02Z asked designer: "no reply within cadence (30min)"
```

- [ ] **Step 5: Update worked example 2 (lead-to-owner plan-vs-design)**

Append before the closing ` ``` ` of worked example 2:

```
Peer attempts:
  - class=owner-only — no peer attempt because design-vs-plan contradiction requires owner adjudication
```

- [ ] **Step 6: Update worked example 3 (FINISH_BLOCKED option E)**

Append before the closing ` ``` ` of worked example 3:

```
Peer attempts:
  - class=owner-only — no peer attempt because owner explicitly chose escalate over inline retry
```

- [ ] **Step 7: Add worked example 4 (tactical no-peer)**

Append at end of file:

````markdown

## Worked example 4 — tactical, no peer attempt (assumption logged, no escalation)

This is shown for completeness; this entry NEVER reaches the owner mailbox. It is what the originator writes into `## Assumptions` in the session checkpoint. No `BLOCKED:` is filed.

```
2026-05-12T14:08Z backend-developer [class=tactical]: chose error message "user_id required" over "missing user_id" for consistency with existing 422 responses on /v1/users. (peer: none, evidence: n/a)
```

The class=tactical originator does NOT file an escalation. If they file one anyway with `Peer attempts: <empty>`, the lead bounces it with `RETRY_PEER: try <peer role> first` (or `LOG_ASSUMPTION: this is tactical, log it instead`).
````

- [ ] **Step 8: Smoke-check the file parses as markdown**

Run: `python3 -c "import pathlib; t=pathlib.Path('plugins/team-superpower/assets/ESCALATION.md').read_text(); assert 'Peer attempts' in t and 'Worked example 4' in t and 'Decision classes' in t; print('ok')"`
Expected: `ok`

- [ ] **Step 9: Commit**

```bash
git add plugins/team-superpower/assets/ESCALATION.md
git commit -m "feat(team-superpower): add Peer attempts field + 4-class decision table to ESCALATION.md"
```

---

### Task 2: task-completed.sh — add `Peer attempts` to required_fields (warn-only)

**Files:**
- Modify: `plugins/team-superpower/hooks/task-completed.sh:101`

- [ ] **Step 1: Smoke-test BEFORE change (capture baseline)**

Run from repo root:

```bash
mkdir -p /tmp/cr-hook && \
CLAUDE_PROJECT_DIR=/tmp/cr-hook \
  printf '%s' '{"task":{"title":"review:finalize","metadata":{"blocked_questions":["BLOCKED: foo\nPhase: plan\nContext: x\nOptions: A. y\nRecommendation: A\nNeed from you: A/B"]}}}' \
  | bash plugins/team-superpower/hooks/task-completed.sh
tail -n1 /tmp/cr-hook/.claude/hooks/log.jsonl
```

Expected (baseline, BEFORE change): the last log line has NO `bad_escalation` warn — all 5 current fields are present.

- [ ] **Step 2: Modify required_fields array**

Edit `plugins/team-superpower/hooks/task-completed.sh` line 101 from:

```bash
required_fields=("Phase" "Context" "Options" "Recommendation" "Need from you")
```

to:

```bash
required_fields=("Phase" "Context" "Options" "Recommendation" "Need from you" "Peer attempts")
```

- [ ] **Step 3: Smoke-test AFTER change — missing Peer attempts triggers warn**

Run:

```bash
rm /tmp/cr-hook/.claude/hooks/log.jsonl && \
CLAUDE_PROJECT_DIR=/tmp/cr-hook \
  printf '%s' '{"task":{"title":"review:finalize","metadata":{"blocked_questions":["BLOCKED: foo\nPhase: plan\nContext: x\nOptions: A. y\nRecommendation: A\nNeed from you: A/B"]}}}' \
  | bash plugins/team-superpower/hooks/task-completed.sh
echo "exit=$?"
grep -c '"warn":"bad_escalation"' /tmp/cr-hook/.claude/hooks/log.jsonl
grep -c '"missing":"Peer attempts"' /tmp/cr-hook/.claude/hooks/log.jsonl
```

Expected: `exit=0`, both grep counts = `1`.

- [ ] **Step 4: Smoke-test AFTER change — all 6 fields present, no warn**

Run:

```bash
rm /tmp/cr-hook/.claude/hooks/log.jsonl && \
CLAUDE_PROJECT_DIR=/tmp/cr-hook \
  printf '%s' '{"task":{"title":"review:finalize","metadata":{"blocked_questions":["BLOCKED: foo\nPhase: plan\nContext: x\nOptions: A. y\nRecommendation: A\nNeed from you: A/B\nPeer attempts: class=owner-only — no peer because scope change"]}}}' \
  | bash plugins/team-superpower/hooks/task-completed.sh
echo "exit=$?"
grep -c '"warn":"bad_escalation"' /tmp/cr-hook/.claude/hooks/log.jsonl
```

Expected: `exit=0`, grep count = `0`.

- [ ] **Step 5: Bash syntax check**

Run: `bash -n plugins/team-superpower/hooks/task-completed.sh && echo ok`
Expected: `ok`

- [ ] **Step 6: Commit**

```bash
git add plugins/team-superpower/hooks/task-completed.sh
git commit -m "feat(team-superpower): require Peer attempts field on escalations (warn-only)"
```

---

### Task 3: Agent rubrics — designer + planner

**Files:**
- Modify: `plugins/team-superpower/agents/designer.md`
- Modify: `plugins/team-superpower/agents/planner.md`

- [ ] **Step 1: Append rubric to designer.md**

Append at end of `plugins/team-superpower/agents/designer.md`:

```markdown

## Clarification routing

Use the 4-class decision table in `assets/ESCALATION.md` to classify every clarification you face. Your per-role buckets:

- **I decide alone (tactical):** doc structure, prose tightness, example phrasing, internal section ordering, choice of mermaid-vs-table format. Log each as one line in the session checkpoint `## Assumptions` block.
- **I consult planner (cross-role):** whether an acceptance criterion is measurable enough for the plan to size a test; whether a goal can be split into independent design units.
- **I escalate to owner (owner-only):** scope, success criteria, external policy, anything the design doc does not already pin and that changes what "done" looks like.

Every escalation MUST include the `Peer attempts:` field per `assets/ESCALATION.md`. If you classify as `tactical`, do NOT escalate — log to `## Assumptions` instead.
```

- [ ] **Step 2: Append rubric to planner.md**

Append at end of `plugins/team-superpower/agents/planner.md`:

```markdown

## Clarification routing

Use the 4-class decision table in `assets/ESCALATION.md` to classify every clarification you face. Your per-role buckets:

- **I decide alone (tactical):** task ordering, task-size splits, file-scope per task within the design's stated boundaries, naming of internal files, choice between equivalent file structures.
- **I consult designer (cross-role):** ambiguous acceptance criteria; criteria that can't be expressed as a failing test as written.
- **I consult software-architect (cross-role / architectural):** cross-cutting structural concerns the design touches but does not pin; new runtime dependencies surfaced during planning.
- **I escalate to owner (owner-only):** design-vs-plan contradictions, scope outside the design, planning that would exceed the 3-touchpoint cap.

Every escalation MUST include the `Peer attempts:` field per `assets/ESCALATION.md`. If you classify as `tactical`, do NOT escalate — log to `## Assumptions` instead.
```

- [ ] **Step 3: Verify both files end with the new section**

Run:

```bash
tail -n3 plugins/team-superpower/agents/designer.md
echo ---
tail -n3 plugins/team-superpower/agents/planner.md
```

Expected: both tails end with the "log to `## Assumptions` instead." line.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/agents/designer.md plugins/team-superpower/agents/planner.md
git commit -m "feat(team-superpower): clarification routing rubric for designer + planner"
```

---

### Task 4: Agent rubrics — backend-developer + frontend-developer

**Files:**
- Modify: `plugins/team-superpower/agents/backend-developer.md`
- Modify: `plugins/team-superpower/agents/frontend-developer.md`

- [ ] **Step 1: Append rubric to backend-developer.md**

Append at end of `plugins/team-superpower/agents/backend-developer.md`:

```markdown

## Clarification routing

Use the 4-class decision table in `assets/ESCALATION.md` to classify every clarification you face. Your per-role buckets:

- **I decide alone (tactical):** internal naming, error message wording, internal helper shape, log field choice, fixture values, threshold within a stated range, choice between equivalent stdlib idioms.
- **I consult frontend-developer (cross-role):** API contract shape, request/response field naming visible across the stack, error-shape contracts visible to the client, status-code semantics on cross-stack endpoints.
- **I consult planner (cross-role):** ambiguous task acceptance criteria that block writing the failing test.
- **I consult software-architect (architectural):** new runtime dependency, persistence-model change, public-interface shape change.
- **I escalate to owner (owner-only):** contract-breaking changes, scope discoveries that need a new task, security-blocking findings.

Every escalation MUST include the `Peer attempts:` field per `assets/ESCALATION.md`. If you classify as `tactical`, do NOT escalate — log to `## Assumptions` instead.
```

- [ ] **Step 2: Append rubric to frontend-developer.md**

Append at end of `plugins/team-superpower/agents/frontend-developer.md`:

```markdown

## Clarification routing

Use the 4-class decision table in `assets/ESCALATION.md` to classify every clarification you face. Your per-role buckets:

- **I decide alone (tactical):** component naming, internal hook/helper names, CSS class names, test-fixture values, copy phrasing for non-design-pinned strings, choice between equivalent UI primitives within the design system.
- **I consult backend-developer (cross-role):** API request/response shape, error-payload format, status-code semantics, pagination contract.
- **I consult planner (cross-role):** ambiguous task acceptance criteria that block writing the failing test.
- **I consult software-architect (architectural):** new runtime dependency, state-management pattern change, public-component interface change.
- **I escalate to owner (owner-only):** contract-breaking changes, scope discoveries that need a new task, accessibility/policy gaps the design does not address.

Every escalation MUST include the `Peer attempts:` field per `assets/ESCALATION.md`. If you classify as `tactical`, do NOT escalate — log to `## Assumptions` instead.
```

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/agents/backend-developer.md plugins/team-superpower/agents/frontend-developer.md
git commit -m "feat(team-superpower): clarification routing rubric for backend + frontend developers"
```

---

### Task 5: Agent rubrics — qa-engineer + reviewer

**Files:**
- Modify: `plugins/team-superpower/agents/qa-engineer.md`
- Modify: `plugins/team-superpower/agents/reviewer.md`

- [ ] **Step 1: Append rubric to qa-engineer.md**

Append at end of `plugins/team-superpower/agents/qa-engineer.md`:

```markdown

## Clarification routing

Use the 4-class decision table in `assets/ESCALATION.md` to classify every clarification you face. Your per-role buckets:

- **I decide alone (tactical):** test naming, regression-coverage strategy, ordering of QA steps, choice between equivalent assertion idioms.
- **I consult the relevant implementer (cross-role):** reproducer specifics for a suspected bug, environment-setup ambiguity, which fixture matches the failing path.
- **I escalate to owner (owner-only):** missing acceptance criterion in the design, criterion that cannot be tested as written, a regression discovered outside the feature scope.

Additional duty: at every QA pass, **scan the session checkpoint `## Assumptions` block**. Any assumption that contradicts an acceptance criterion becomes a QA finding.

Every escalation MUST include the `Peer attempts:` field per `assets/ESCALATION.md`. If you classify as `tactical`, do NOT escalate — log to `## Assumptions` instead.
```

- [ ] **Step 2: Append rubric to reviewer.md**

Append at end of `plugins/team-superpower/agents/reviewer.md`:

```markdown

## Clarification routing

Use the 4-class decision table in `assets/ESCALATION.md` to classify every clarification you face. Your per-role buckets:

- **I decide alone (tactical):** review-comment phrasing, severity tagging within the existing rubric (critical / major / minor / nit), ordering of findings.
- **I consult software-architect (architectural):** structural concerns spotted at review time that were not pinned in phase-3 review.
- **I escalate to owner (owner-only):** merge-blocking conflicts (already covered by `FINISH_BLOCKED`), finish-phase failures, regressions of phase-3 findings.

Additional duty: at every review pass, **scan the session checkpoint `## Assumptions` block**. Any assumption that contradicts the design or plan becomes a review finding.

Every escalation MUST include the `Peer attempts:` field per `assets/ESCALATION.md`. If you classify as `tactical`, do NOT escalate — log to `## Assumptions` instead.
```

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/agents/qa-engineer.md plugins/team-superpower/agents/reviewer.md
git commit -m "feat(team-superpower): clarification routing rubric for qa + reviewer"
```

---

### Task 6: Agent rubrics — software-architect + security-engineer

**Files:**
- Modify: `plugins/team-superpower/agents/software-architect.md`
- Modify: `plugins/team-superpower/agents/security-engineer.md`

- [ ] **Step 1: Append rubric to software-architect.md**

Append at end of `plugins/team-superpower/agents/software-architect.md`:

```markdown

## Clarification routing

Use the 4-class decision table in `assets/ESCALATION.md` to classify every clarification you face. Your per-role buckets:

- **I decide alone (tactical):** arch-review verdicts within the existing design boundaries, severity classification of architectural findings (Critical / High / Medium / Low).
- **I consult security-engineer (cross-role):** findings that straddle security and architecture (e.g., trust-boundary changes, authn surface changes).
- **I escalate to owner (owner-only):** architectural concerns that cannot be resolved within the existing design (re-opens phase 1, not phase 2); design-vs-plan contradictions surfaced at the gate.

Every escalation MUST include the `Peer attempts:` field per `assets/ESCALATION.md`. If you classify as `tactical`, do NOT escalate — log to `## Assumptions` instead.
```

- [ ] **Step 2: Append rubric to security-engineer.md**

Append at end of `plugins/team-superpower/agents/security-engineer.md`:

```markdown

## Clarification routing

Use the 4-class decision table in `assets/ESCALATION.md` to classify every clarification you face. Your per-role buckets:

- **I decide alone (tactical):** checklist verdicts (✅ / ⚠️ / ❌) within the project-aware checklist; severity classification within the Critical / High / Medium / Low rubric.
- **I consult software-architect (cross-role):** trust-boundary concerns, authn/authz surfaces that overlap structural decisions.
- **I escalate to owner (owner-only):** any security-blocking finding by definition; `CLAUDE.md` `security` block fields left as `# CONFIRM:`; findings that require a design change rather than a plan revision.

Every escalation MUST include the `Peer attempts:` field per `assets/ESCALATION.md`. If you classify as `tactical`, do NOT escalate — log to `## Assumptions` instead.
```

- [ ] **Step 3: Verify all 8 agent files now carry the section**

Run:

```bash
grep -L "## Clarification routing" plugins/team-superpower/agents/*.md
```

Expected: empty output (every file matches).

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/agents/software-architect.md plugins/team-superpower/agents/security-engineer.md
git commit -m "feat(team-superpower): clarification routing rubric for architect + security"
```

---

### Task 7: team-feature.md — add lead `RETRY_PEER` Hard rule + Assumptions checkpoint section

**Files:**
- Modify: `plugins/team-superpower/commands/team-feature.md`

- [ ] **Step 1: Add the new Hard rule under `## Hard rules (v2 additions)`**

Append at the end of the `## Hard rules (v2 additions)` section (after the last bullet, currently the "planner inside linked worktree" rule at line 558), this new bullet:

```markdown
- **Never** forward an owner-bound escalation when the originator's `class` is not `owner-only` AND `Peer attempts` lists fewer than one round-trip with a peer. The lead returns the escalation to the originator with `RETRY_PEER: try <suggested role> first`. Touchpoint count is NOT decremented (this is a routing reject, not an owner touch). The lead also returns it with `LOG_ASSUMPTION: tactical questions log to checkpoint § Assumptions, not the mailbox` when `class=tactical`. The 4-class table is in `assets/ESCALATION.md`; the originator's classification is taken from the escalation's `Peer attempts:` field prefix.
```

- [ ] **Step 2: Add `## Assumptions` to the checkpoint template**

In the `## Checkpointing` section's checkpoint template (the fenced markdown block starting at line 484), insert a new section between `## Open escalations` and `## Resume protocol`. The new section goes BEFORE the `## Resume protocol` heading:

```markdown
## Assumptions
(appended after each phase; one entry per non-owner decision)
- <ISO ts> <role> [class=<tactical|cross-role|architectural>]: <one-line decision> (peer: <role|none>, evidence: <link to mailbox msg | n/a>)
```

The exact insertion point in the file is immediately after the line `- (none) | <escalation-template entries>` and immediately before the line `## Resume protocol`.

- [ ] **Step 3: Verify both edits land**

Run:

```bash
grep -c "RETRY_PEER" plugins/team-superpower/commands/team-feature.md
grep -c "^## Assumptions" plugins/team-superpower/commands/team-feature.md
```

Expected: each ≥ `1`.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/commands/team-feature.md
git commit -m "feat(team-superpower): lead enforces RETRY_PEER + adds Assumptions to checkpoint"
```

---

### Task 8: SESSION_README.md — RETRY_PEER troubleshooting row + Assumptions reference

**Files:**
- Modify: `plugins/team-superpower/assets/SESSION_README.md`

- [ ] **Step 1: Inspect the existing troubleshooting table**

Run: `grep -n "Troubleshoot\|RETRY_PEER\|FINISH_BLOCKED" plugins/team-superpower/assets/SESSION_README.md | head -20`

This locates the troubleshooting section. Identify the table the existing `FINISH_BLOCKED` row lives in (the file shipped this row in the most recent commit). The new row goes immediately after the `FINISH_BLOCKED` row in that same table.

- [ ] **Step 2: Add the RETRY_PEER row**

Insert the following row immediately after the `FINISH_BLOCKED` row in the troubleshooting table:

```
| `RETRY_PEER: try <role> first` | Lead bounced an escalation because the originator's class isn't `owner-only` and `Peer attempts` is empty. Action: originator mails the named role with the question, waits one cadence, then refiles citing the attempt. See `assets/ESCALATION.md` § Decision classes. |
```

If the table column structure differs (the existing row uses different headers), match its column count and order exactly — re-read the surrounding rows before composing.

- [ ] **Step 3: Add the LOG_ASSUMPTION row**

Insert directly after the `RETRY_PEER` row:

```
| `LOG_ASSUMPTION: tactical, log to checkpoint § Assumptions` | Lead bounced a `class=tactical` escalation. Action: originator logs one line under the session checkpoint's `## Assumptions` and proceeds. No owner touchpoint consumed. |
```

- [ ] **Step 4: Add an Assumptions reference subsection**

Append at end of file:

```markdown

## Session checkpoint § Assumptions

Every non-owner decision (tactical, cross-role with consensus, architectural with sign-off) is logged as one line in the session checkpoint's `## Assumptions` block. The QA and reviewer phases scan this block for contradictions with the design / plan; contradictions surface as QA findings or review comments. Format:

```
- <ISO ts> <role> [class=<tactical|cross-role|architectural>]: <one-line decision> (peer: <role|none>, evidence: <link to mailbox msg | n/a>)
```

The owner sees the assumptions log at every phase boundary as part of the checkpoint commit.
```

- [ ] **Step 5: Verify both rows + section present**

Run:

```bash
grep -c "RETRY_PEER" plugins/team-superpower/assets/SESSION_README.md
grep -c "LOG_ASSUMPTION" plugins/team-superpower/assets/SESSION_README.md
grep -c "Session checkpoint § Assumptions" plugins/team-superpower/assets/SESSION_README.md
```

Expected: each = `1`.

- [ ] **Step 6: Commit**

```bash
git add plugins/team-superpower/assets/SESSION_README.md
git commit -m "docs(team-superpower): SESSION_README — RETRY_PEER + LOG_ASSUMPTION rows, Assumptions section"
```

---

### Task 9: README.md — add Clarification routing subsection

**Files:**
- Modify: `plugins/team-superpower/README.md`

- [ ] **Step 1: Locate insertion point**

Run: `grep -n "^## " plugins/team-superpower/README.md`

Identify a sensible H2 to anchor the new subsection — typically just before the existing "Hooks", "Troubleshooting", or "Files" section near the end. The new subsection goes as a peer H2 titled `## Clarification routing`.

- [ ] **Step 2: Append the subsection**

Insert this as an H2 section before the existing `## Hooks` heading (or, if no such heading, immediately before the last existing H2):

```markdown
## Clarification routing

Teammates resolve as many clarifications as possible without involving the owner. Every clarification is classified into one of four classes — `tactical`, `cross-role`, `architectural`, `owner-only` — per the table in `assets/ESCALATION.md` § Decision classes.

- **Tactical** questions (naming, wording, thresholds in range) are decided by the originator and logged in the session checkpoint's `## Assumptions` block. No mailbox, no escalation.
- **Cross-role** questions go to the relevant peer; consensus on first reply → log + proceed; after 2 round-trips with no consensus → escalate citing the attempts.
- **Architectural** questions go to `software-architect`; sign-off → log; dissent → escalate.
- **Owner-only** questions (scope, design-vs-plan contradiction, security-blocking) escalate immediately.

Every escalation carries a `Peer attempts:` field. The `TaskCompleted` hook warns when missing (warn-only). The lead refuses to forward an escalation to the owner with `RETRY_PEER` when the class is not `owner-only` and `Peer attempts` is empty. Per-role rubrics live in each agent file under `agents/<role>.md` § Clarification routing.
```

- [ ] **Step 3: Verify subsection present**

Run: `grep -c "^## Clarification routing" plugins/team-superpower/README.md`
Expected: `1`.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/README.md
git commit -m "docs(team-superpower): README — Clarification routing subsection"
```

---

### Task 10: End-to-end acceptance smoke

**Files:** (read-only verification)

- [ ] **Step 1: Verify all 8 agent rubrics exist**

Run: `grep -L "^## Clarification routing" plugins/team-superpower/agents/*.md`
Expected: empty output.

- [ ] **Step 2: Verify ESCALATION.md is complete**

Run:

```bash
for s in "Peer attempts" "Decision classes" "Worked example 4" "class=owner-only" "class=tactical"; do
  c=$(grep -c "$s" plugins/team-superpower/assets/ESCALATION.md)
  echo "$c $s"
done
```

Expected: each count ≥ `1`.

- [ ] **Step 3: Verify hook enforces 6th field (negative + positive)**

Run both hook smoke tests from Task 2 step 3 and step 4 again. Expected results unchanged.

- [ ] **Step 4: Verify team-feature.md carries the new Hard rule + checkpoint section**

Run:

```bash
grep -c "RETRY_PEER" plugins/team-superpower/commands/team-feature.md
grep -c "LOG_ASSUMPTION" plugins/team-superpower/commands/team-feature.md
grep -c "^## Assumptions" plugins/team-superpower/commands/team-feature.md
```

Expected: each ≥ `1`.

- [ ] **Step 5: Marketplace manifest sanity**

Run:

```bash
python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
```

Expected: `OK`.

- [ ] **Step 6: No commit — acceptance task is verification-only**

If any step failed, return to the corresponding earlier task and fix. Re-run the failing acceptance step.

---

## Self-review

**Spec coverage:**

- 4-class table → Task 1 step 3 (canonical) + cited in every agent rubric (Tasks 3–6).
- Peer attempts field on template → Task 1 step 1.
- Peer attempts in 3 existing examples + 4th example → Task 1 steps 4–7.
- Hook `required_fields` update → Task 2.
- Per-role rubrics for all 8 roles → Tasks 3–6.
- Lead `RETRY_PEER` Hard rule → Task 7 step 1.
- Assumptions checkpoint section → Task 7 step 2.
- SESSION_README RETRY_PEER row + Assumptions reference → Task 8.
- README subsection → Task 9.
- Acceptance checks → Task 10 maps to spec § "Acceptance check (post-implementation)".

**Placeholders:** none. Every step shows concrete code blocks, exact commands, and expected output.

**Type / signal consistency:** `RETRY_PEER` and `LOG_ASSUMPTION` are consistent across Task 7 (command), Task 8 (SESSION_README), Task 9 (README), and Task 10 (acceptance). The `Peer attempts:` field label is consistent between Task 1 (template), Task 2 (hook), and Tasks 3–6 (agent rubrics cite the same name).
