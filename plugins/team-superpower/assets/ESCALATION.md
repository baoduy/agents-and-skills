# Escalation template (team-superpower v5)

v5 replaces v4's peer mailbox + multi-class escalation gauntlet with a single routing point: **team-leader**. Implementers SendMessage team-leader; team-leader routes by `class` per spec §6.4. The only owner-facing path is `RESTART_REQUEST` (team-leader → lead → owner recovery touchpoint).

## Where escalations go in v5

| From                                            | Channel                                | Trigger                                                                                                  |
| ----------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| backend-developer / frontend-developer          | SendMessage **team-leader**            | Any task-level question that is not pure tactical (style/naming).                                        |
| security-engineer (phase A)                     | SendMessage **lead**                   | SEC_BLOCKED finding, or `CLAUDE.md` `security.*: # CONFIRM:` blocks threat-modelling.                    |
| solution-architect / feature-planner (phase A)  | SendMessage **lead**                   | Touchpoint output is owner-facing; lead presents to owner.                                               |
| qc-engineer (phase G)                           | SendMessage **lead**                   | `QC_REWORK_NEEDED <n>` or `QC_PASS <slug>`. Lead re-spawns team-leader for rework dispatch.              |
| team-leader (phase B–F coordinator)             | SendMessage **lead** (`SPAWN_REQUEST` / `RESTART_REQUEST`) | Wave dispatch needs implementers; architectural escalation can't be resolved without owner touchpoint.   |
| main session                                    | Owner touchpoint                       | Touchpoints 1–4 per spec §3.5 plus recovery touchpoints triggered by RESTART_REQUEST or 3+ QC rounds.    |

## Implementer → team-leader template (spec §6.4)

Use this when a backend-developer or frontend-developer can't resolve a question alone.

```
ESCALATE <task-id>
class: tactical | cross-role | architectural
question: <one line>
context: <2-4 sentences — what we tried, what we considered, why we are stuck>
```

team-leader routes by `class`:

- **tactical** (style, naming, local design) → team-leader answers from arch-map + AGENTS.md. SendMessage back to originator.
- **cross-role** (affects another implementer) → team-leader SendMessages the affected peer with the context and a proposed coordination point.
- **architectural** (changes arch-map, requires planner judgment, invalidates wave plan) → team-leader posts `RESTART_REQUEST <reason+task-id>` to lead. Do NOT re-answer. Do NOT downgrade legitimate architectural questions to tactical.

team-leader MAY downgrade an over-eager `class=architectural` to tactical when the question is genuinely style/naming dressed up as architecture. team-leader explains the downgrade in its reply.

## team-leader → lead protocols

### SPAWN_REQUEST (wave dispatch)

```
SPAWN_REQUEST wave=<plan-phase>.<wave>
roles_needed:
  backend-developer: <count>
  frontend-developer: <count>
brief_path: .team-superpower/spawn-briefs/wave-<plan-phase>.<wave>.md
expected_tasks: [<task-id-1>, <task-id-2>, ...]
```

Lead reads the brief, TaskCreates per task block, spawns implementers, replies `SPAWN_DONE wave=<...> agent_ids=<...>`.

### RESTART_REQUEST (architectural unblock)

```
RESTART_REQUEST <reason>
trigger: <task-id | wave-id | qc-issue>
context: <2-4 sentences — what arch decision broke, what implementers reported>
```

Lead:
1. Shuts down all phase B–F teammates (team-leader + active implementers).
2. Presents owner recovery touchpoint with summary of partial commits + reason.
3. On owner approval, re-runs phase A (fresh solution-architect + feature-planner + security-engineer if applicable) with the prior spec/plan/arch-map + partial commits as input.
4. Increments `cycle_restart_count`. Cap is `limits.max_cycle_restarts` (default 2). Third restart triggers owner escalation: "this feature is not tractable, please refactor scope."

## Decision classes (v5 reference)

| Class           | Examples                                                                                       | Routing                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| tactical        | naming, error wording, log field choice, fixture data, threshold inside a stated range         | Originator decides. Logs to commit body `## Assumptions` line. No escalation.                                                                    |
| cross-role      | API contract shape across roles, error-handling contract, ambiguous acceptance criterion       | `ESCALATE class=cross-role` to team-leader. team-leader routes to affected peer.                                                                 |
| architectural   | new runtime dependency, persistence-model change, public-interface shape change, contract drift | `ESCALATE class=architectural` to team-leader. team-leader posts `RESTART_REQUEST` to lead.                                                       |

Classification rule of thumb: if the answer changes a test the implementer would write, AND the existing arch-map / plan does not pin it, AND the change does not alter scope / architecture / external policy, the question is tactical or cross-role. Otherwise it is architectural.

## Worked example 1 — backend-developer tactical (NOT escalated, logged as assumption)

backend-developer chose error message `"user_id required"` over `"missing user_id"` for consistency with existing 422 responses on /v1/users. They log it in the commit body:

```
feat(users): validate user_id on POST /v1/users

Files: src/routes/users.ts, tests/routes/users.test.ts
Wave: 2.1
Test-status: green

## Assumptions
- error string "user_id required" matches existing 422 wording on /v1/users (peer: none, class=tactical)
```

No `ESCALATE` is sent. team-leader's phase-end review will spot-check assumption lines.

## Worked example 2 — cross-role (frontend asks backend via team-leader)

frontend-developer hits an ambiguous request shape on a paginated endpoint.

```
ESCALATE impl:fe-list-orders
class: cross-role
question: Should the paginated /v1/orders response use `nextCursor: string | null` or `nextCursor?: string`?
context: arch-map §4 pins cursor-based pagination but does not pick the null-vs-omitted shape. AGENTS.md has no precedent. backend-developer published the contract last wave; I need to align before I write the RED test for `useOrdersQuery`.
```

team-leader inspects the contract artefact, sees the BE published `nextCursor: string | null`, SendMessages frontend-developer with the decision and a one-line rationale, no further action.

## Worked example 3 — architectural → RESTART_REQUEST

backend-developer discovers mid-implementation that the planned `payments.transactions` table cannot enforce idempotency because the chosen primary key is auto-increment; the arch-map specified idempotency at the application layer but the plan ended up moving it to the DB.

```
ESCALATE impl:be-2.3-add-charge-endpoint
class: architectural
question: Idempotency on POST /v1/charges requires a stable key the client supplies. The plan task uses the DB auto-id, which won't dedupe retries. Should I add an `idempotency_key` column + unique index, or revert idempotency to the app layer as arch-map originally stated?
context: arch-map §3.2 said "app-layer idempotency via redis SETNX." Plan task 2.3 dropped redis and pushed dedup to DB without a key column. Either fix changes the migration and the route handler. I held RED before writing code.
```

team-leader confirms this contradicts arch-map, posts to lead:

```
RESTART_REQUEST arch-vs-plan-mismatch on impl:be-2.3
trigger: impl:be-2.3-add-charge-endpoint
context: Plan dropped redis layer arch-map specified; resulting migration cannot enforce idempotency. Implementer held RED. Two valid fixes (DB column + index, OR restore redis); both change the plan. Needs solution-architect adjudication, not team-leader.
```

Lead shuts down team-leader + implementers, presents owner touchpoint summarising partial commits, runs phase A again on owner approval.

## Hook validation

`task-completed.sh` does NOT gate on the escalation template (escalations are SendMessages, not commits). It DOES validate:

- `Files:`, `Wave:`, `Test-status:` lines on every commit (`INVALID_WAVE_REFERENCE` if missing).
- `Reworks:` line on every commit for an `impl:rework-*` task (`MISSING_REWORK_REFERENCE`).
- Static-check log present and exit=0 (`MISSING_STATIC_CHECKS`).
- No agent-attributed commit touches `docs/superpowers/AGENTS.md` (`AGENT_WROTE_AGENTS_MD`).

The escalation template is policy, not hook-enforced. team-leader bounces ill-formed `ESCALATE` messages with a one-line reformat request.

## v4 → v5 changes (delta reference)

- Removed: 4-class table including `owner-only`. v5 routes owner touchpoints only via `RESTART_REQUEST`.
- Removed: `Peer attempts:` field. v5 implementers do not peer-mailbox; team-leader is the single router.
- Removed: `BLOCKED:` template with `Phase / Context / Options / Recommendation / Need from you / Peer attempts`. Replaced by terse `ESCALATE / class / question / context`.
- Removed: `FINISH_BLOCKED` 5-option menu. v5 finish-branch is a lead-only flow; failures are surfaced as a regular touchpoint to owner.
- Removed: software-architect / planner / reviewer references. Routing collapses to team-leader + lead.
