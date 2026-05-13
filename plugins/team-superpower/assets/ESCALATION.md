# Escalation template (team-superpower)

Every owner-facing question and every "I'm blocked" peer message MUST use this exact format. The `TaskCompleted` hook spot-checks for the field labels, and the lead refuses to forward escalations that don't match.

## Template

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
```

All five labels (`Phase`, `Context`, `Options`, `Recommendation`, `Need from you`) MUST appear. Missing any → the hook blocks the task completion with `BAD_ESCALATION: missing field(s) ...`.

## Worked example 1 — peer-to-peer (planner → designer)

```
BLOCKED: Acceptance criterion "fast" on req #4 is not measurable. What does "fast" mean here?
Phase: plan
Context: I am sizing tasks for the search endpoint. Design doc §4 says "results must come back fast." The plan needs a concrete number so the test the implementer writes can fail until the number is hit. I considered defaulting to "p95 < 200ms on a 10k-row fixture" but that's me guessing on the owner's behalf.
Options:
  A. Adopt p95 < 200ms on the 10k-row fixture and proceed — designer can re-open if wrong.
  B. Pause planning; designer amends the design doc with a measurable number; owner re-approves the doc delta.
  C. Drop the criterion from the plan and tag it as a follow-up.
Recommendation: B — "fast" is the kind of vague that costs a rewrite later, and the design doc is the right place to fix it once.
Need from you: choose A/B/C.
```

## Worked example 2 — lead-to-owner (plan-vs-design mismatch surfaced mid-implementation)

```
BLOCKED: backend-developer reports that task impl:be-add-user-endpoint specifies POST /users, but the approved design doc says PUT /users/{id}. Which is canonical?
Phase: implementation
Context: The plan was approved 2026-05-12T09:14Z. Task 4 reads "POST /users → 201 Created with body". Design doc §3 (approved 2026-05-12T08:51Z) reads "idempotent PUT /users/{id}, 200 or 201". Both choices change the test the backend-developer writes in the RED step. We have not yet written code for this task — TDD held the line.
Options:
  A. Owner confirms PUT /users/{id} is correct → planner amends task 4 → owner re-approves the plan delta → backend-developer proceeds.
  B. Owner confirms POST /users is correct → designer amends the design doc → owner re-approves the design delta → backend-developer proceeds.
  C. Owner reopens the design question entirely (the two APIs imply different semantics).
Recommendation: A — the design doc was approved first and the discrepancy reads as a plan-writing slip, not a design change. But this is a load-bearing decision and we won't move without your call.
Need from you: choose A/B/C.
```
