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
Peer attempts:
  - <ISO ts> asked <role>: <one-line reply summary or "no reply within cadence">
  - <ISO ts> asked <role>: <one-line reply summary or "no reply within cadence">
  (or, when no peer attempt is required:)
  - class=tactical — no peer attempt; logged as assumption, see checkpoint § Assumptions
  - class=owner-only — no peer attempt because <reason>
```

All six labels (`Phase`, `Context`, `Options`, `Recommendation`, `Need from you`, `Peer attempts`) MUST appear. The `TaskCompleted` hook warns (warn-only since 2026-05-14) with `bad_escalation: missing field(s) ...` if any are missing.

## Decision classes

| Class           | Examples                                                                                       | Routing                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| tactical        | naming, error wording, log field choice, fixture data, threshold inside a stated range         | Originator decides. Logs to checkpoint § Assumptions. No mailbox, no escalation.                                                                  |
| cross-role      | API contract shape across roles, test placement, error-handling contract                       | Mailbox to the peer role. Consensus on the first round-trip → log + proceed. After 2 round-trips with no consensus → escalate citing the attempts. |
| architectural   | new runtime dependency, persistence-model change, public-interface shape change                | Mailbox to `software-architect` first. Sign-off → log as architectural assumption. Dissent or no-decide → escalate.                              |
| owner-only      | scope change, design-vs-plan contradiction, external policy, security-blocking decision        | Escalate immediately. No peer attempt required. `Peer attempts` field records `class=owner-only — no peer attempt needed because <reason>`.       |

Classification rule of thumb: if the answer changes a test the implementer would write, AND the existing design / plan does not pin it, AND the change does not alter scope / architecture / external policy, the question is tactical or cross-role. Otherwise it is architectural or owner-only.

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
Peer attempts:
  - 2026-05-12T14:02Z asked designer: "no reply within cadence (30min)"
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
Peer attempts:
  - class=owner-only — no peer attempt because design-vs-plan contradiction requires owner adjudication
```

## Worked example 3 — lead-to-owner (`FINISH_BLOCKED` option E)

```
BLOCKED: Merge of feature/user-search into main failed: push rejected because origin/main advanced. Owner picked option E (escalate) from the 5-option menu rather than retrying inline.
Phase: finish
Context: Reviewer attempted `git push` after a clean local merge. Push was rejected: "Updates were rejected because the remote contains work that you do not have locally." The remote moved between phase 6 and phase 7. The lead's 5-option menu was presented; owner chose E because they want to coordinate the rebase manually rather than have the team retry blind.
Options:
  A. Owner rebases the feature branch locally onto origin/main, signals "ready to retry"; lead instructs reviewer to retry merge (counts as 1/3 retries).
  B. Owner pulls latest origin/main into trunk first, then signals; lead retries.
  C. Owner switches the decision to pr_opened and merges via GitHub UI.
Recommendation: A — the conflict surface is small and a clean rebase plus retry is the cheapest path. We won't move until you say which.
Need from you: choose A/B/C.
Peer attempts:
  - class=owner-only — no peer attempt because owner explicitly chose escalate over inline retry
```

## Worked example 4 — tactical, no peer attempt (assumption logged, no escalation)

This is shown for completeness; this entry NEVER reaches the owner mailbox. It is what the originator writes into `## Assumptions` in the session checkpoint. No `BLOCKED:` is filed.

```
2026-05-12T14:08Z backend-developer [class=tactical]: chose error message "user_id required" over "missing user_id" for consistency with existing 422 responses on /v1/users. (peer: none, evidence: n/a)
```

The class=tactical originator does NOT file an escalation. If they file one anyway with `Peer attempts: <empty>`, the lead bounces it with `RETRY_PEER: try <peer role> first` (or `LOG_ASSUMPTION: this is tactical, log it instead`).
