# Clarification Routing — design

Status: approved
Owner: steven
Plugin: `plugins/team-superpower`
Date: 2026-05-14

## Problem

Teammates in `team-superpower` currently surface too many clarification questions directly to the owner. The 3-touchpoint owner cap is being blown by tactical ambiguities (naming, threshold values, wording) that peers could resolve. There is no rule that requires a peer attempt before an owner-bound escalation, and no per-role rubric describing which decisions a teammate may make unilaterally.

Symptom (owner report): "too many escalations — minor questions surface to me instead of being resolved between teammates" (matches answer A on the scoping question).

## Goal

Cut owner-bound escalations to the questions that genuinely need owner judgment, by:

1. Classifying every clarification question into one of four decision classes.
2. Making peer consultation a precondition for owner escalation when the class permits it.
3. Giving each role a short, durable rubric of "decide alone / consult peer / escalate".
4. Logging every non-owner decision as an Assumption so the owner can audit at phase boundaries.

Non-goal: changing the existing 3-touchpoint cap, the escalation template's five-field core, or the `task-completed.sh` hook contract beyond a single new field.

## Decision classes

| Class           | Examples                                                                                       | Routing                                                                                                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tactical        | naming, error message wording, log field choice, fixture data, threshold within a stated range | Originator decides. Logs to checkpoint § Assumptions. No mailbox, no escalation.                                                                                                                                                       |
| cross-role      | API contract shape between FE and BE, test placement, error-handling contract across roles     | Mailbox to the relevant peer role. If a consensus reply lands within the team's normal cadence, log it and proceed. If no consensus after 2 round-trips, escalate to owner with the peer attempts cited.                               |
| architectural   | new runtime dependency, persistence-model change, public-interface shape change                | Mailbox to `software-architect` (review role) first. If architect signs off, log as architectural assumption. If architect dissents or cannot decide, escalate to owner.                                                               |
| owner-only      | scope change, design-vs-plan contradiction, external policy, security-blocking decision        | Escalate immediately. No peer attempt required (peer attempts field records `class=owner-only — no peer attempt needed because <reason>`).                                                                                             |

Classification rule of thumb: if the answer changes a test the implementer would write, AND the existing design / plan does not pin it, AND the change does not alter scope / architecture / external policy, the question is tactical or cross-role. Otherwise it is architectural or owner-only.

## Escalation template change

Append a sixth required field to `assets/ESCALATION.md`:

```
Peer attempts:
  - <ISO ts> asked <role>: <one-line reply summary or "no reply within cadence">
  - <ISO ts> asked <role>: <one-line reply summary or "no reply within cadence">
(or, when no peer attempt is required:)
  - class=tactical — no peer attempt; logged as assumption, see checkpoint § Assumptions
  - class=owner-only — no peer attempt because <reason>
```

The hook (`hooks/task-completed.sh`) gets `Peer attempts` added to its `required_fields` array, so the existing `BAD_ESCALATION: missing field(s)` warn covers it. Hook stays non-blocking (warn-only, per the 2026-05-14 hook softening commit).

## Per-role rubric stub

Each agent file under `plugins/team-superpower/agents/` gets a new `## Clarification routing` section with three buckets: *I decide alone*, *I consult <role(s)>*, *I escalate*. The rubric is tailored per role:

- `designer.md` — decides: doc structure, prose tightness, example phrasing. Consults: planner for measurability of acceptance criteria. Escalates: scope, success criteria, external policy.
- `planner.md` — decides: task ordering, task size split, file scope per task. Consults: designer for ambiguous criteria; architect for cross-cutting structural concerns. Escalates: design-vs-plan contradictions, plan scope outside the design.
- `backend-developer.md` / `frontend-developer.md` — decides: naming, error wording, internal helper shape, log fields, fixture values. Consults: the opposite role for cross-stack contracts; planner for ambiguous task acceptance. Escalates: contract-breaking changes, scope-changing discoveries.
- `qa-engineer.md` — decides: test-naming, regression coverage strategy. Consults: implementer for reproducer specifics. Escalates: missing acceptance criterion, criterion that cannot be tested as written.
- `reviewer.md` — decides: review-comment phrasing, severity tagging. Consults: architect for structural concerns spotted at review time. Escalates: merge-blocking conflict, finish-phase failure (already covered by FINISH_BLOCKED).
- `software-architect.md` — decides: arch-review verdicts. Consults: security-engineer where overlap. Escalates: architectural concerns that cannot be resolved within the existing design.
- `security-engineer.md` — decides: checklist verdicts. Consults: architect for boundary concerns. Escalates: any security-blocking finding (owner-only by definition).

## Lead enforcement

`commands/team-feature.md` gets one new Hard rule:

> Hard rule N: The lead refuses to forward an owner-bound escalation when the originator's `class` is not `owner-only` AND `Peer attempts` lists fewer than one round-trip. The lead returns the escalation to the originator with `RETRY_PEER: try <suggested role> first`. Touchpoint count is NOT decremented (this is a routing reject, not an owner touch).

This is the load-bearing rule: it is what actually keeps tactical questions off the owner's plate. Without it, the rubric is advisory.

## Assumptions log

The session checkpoint markdown (`docs/superpowers/sessions/<slug>.md`) gains a `## Assumptions` section appended after each phase. Format:

```
## Assumptions
- <ISO ts> <role> [class=<tactical|cross-role|architectural>]: <one-line decision> (peer: <role|none>, evidence: <link to mailbox msg | n/a>)
```

The QA and reviewer phases include "scan the Assumptions log" as an explicit step. If an assumption is wrong, it surfaces as a QA finding or review comment — both already have owner-touchpoint paths.

## File-level change list

1. `plugins/team-superpower/assets/ESCALATION.md` — add `Peer attempts:` field to template, update worked examples 1–3 to include it, add a fourth worked example showing a tactical-class no-peer-needed entry.
2. `plugins/team-superpower/hooks/task-completed.sh` — add `"Peer attempts"` to `required_fields` array.
3. `plugins/team-superpower/agents/*.md` (all 8 role files) — append `## Clarification routing` section per the rubric above.
4. `plugins/team-superpower/commands/team-feature.md` — add the new Hard rule for lead enforcement.
5. `plugins/team-superpower/commands/team-feature.md` — add an `## Assumptions` section to the checkpoint template documented in this file.
6. `plugins/team-superpower/assets/SESSION_README.md` — add a troubleshooting row for `RETRY_PEER` and a reference to § Assumptions.
7. `plugins/team-superpower/README.md` — add a short subsection "Clarification routing" pointing to ESCALATION.md and the per-role rubrics.

## Risks and mitigations

- **Risk:** rubric drift between roles — devs and QA disagree on what "tactical" means. **Mitigation:** the rubric is per-role *and* the four-class table in ESCALATION.md is the single source of truth; per-role lists only cite the classes, not redefine them.
- **Risk:** peers stall on cross-role questions (no reply within cadence). **Mitigation:** the cap is 2 round-trips, then escalate. Peer attempts field documents the stall as evidence — owner sees the stuck state, not a guessing teammate.
- **Risk:** assumptions log balloons. **Mitigation:** tactical entries are one line; QA/review treats it as a checklist, not a debate transcript.

## Out of scope

- Changing the 3-touchpoint owner cap.
- Changing the existing five required escalation fields (Phase / Context / Options / Recommendation / Need from you).
- Adding any new hook event or making existing hooks blocking again.
- Auto-classification by the lead. The originator chooses class; lead only checks `class != owner-only → peer attempts ≥ 1`.

## Acceptance check (post-implementation)

- A tactical question from any role results in zero owner touchpoint and one Assumptions entry.
- A cross-role question with consensus on first reply results in zero owner touchpoint and one Assumptions entry citing the peer.
- A cross-role question that stalls after 2 round-trips escalates to owner with both attempts visible in the `Peer attempts` field.
- An owner-only escalation succeeds with `Peer attempts: class=owner-only — no peer attempt because <reason>`.
- An attempted owner-bound escalation with `class=tactical` and `Peer attempts: <empty>` is bounced by the lead with `RETRY_PEER`.
