# team-superpower

Coordination layer that runs the [obra/superpowers](https://github.com/obra/superpowers)
skill chain on top of **Claude Code Agent Teams**. One `/team-feature` command
takes an idea through analysis → planning → implementation → end-of-plan QC →
finish, with at most **3 owner touchpoints**.

This plugin is *not* a fork of Superpowers. It consumes Superpowers skills
as-installed and adds the orchestration: who runs which skill, when, and how
teammates talk without bothering the owner.

## Overview (v5)

team-superpower runs **one Agent Teams team** per feature across all phases.
The lead (orchestrator) is the sole spawner; a coordinating teammate
(team-leader) requests spawns via `SPAWN_REQUEST`.

**Modes:**

- **Solo** (1 touchpoint, no team) — bug fixes, typos, single-file changes.
- **Single-agent** (1 touchpoint, 1 team) — small enhancements.
- **Team** (2 phase-A touchpoints + 1 phase-H finish touchpoint, 1 team
  across phases A–H) — full features.

**Pipeline (team mode):**
Phase A (solution-architect + feature-planner [+ security-engineer]) →
handover → Phases B–F (team-leader + implementers, per-plan-phase wave
dispatch + phase-end SOLID/DRY review) → Phase G (qc-engineer, end-of-plan
QC, max 3 rounds) → Phase H (lead push + finish-branch decision + cleanup).

**Restart-on-stuck:** mid-implementation architectural questions trigger a
full cycle restart (max 2). No architect standby — phase-A roles shut down
at handover.

See `docs/superpowers/team-superpower-v5-spec.md` for the canonical spec,
`docs/superpowers/agent-team-flows-v5.md` for diagrams, and
`docs/superpowers/agent-team-checklist.md` for acceptance criteria.

## Project-aware via CLAUDE.md

The plugin reads a `team-superpower` YAML block from your repo-root `CLAUDE.md`
to drive every stack decision: BE-only repos do not spawn a frontend
teammate, FE-only repos do not spawn a backend teammate, full-stack repos
get both plus a contract-publish gate. Test/build/lint/typecheck/format
commands come from `CLAUDE.md` — no hard-coded toolchain. The
security-engineer is only spawned when `security.domain ∈
{payments, healthcare}` or `security.pii: yes`. See
`assets/CLAUDE.md.template` for the schema.

## What you get

- Two slash commands: `/team-feature` and `/team-cleanup`. There is **no
  separate resume command in v5** — `/team-feature` auto-detects in-progress
  features.
- **Eight agent roles**, each with a tightly-scoped system prompt:

## Agents

| Agent | Lifetime | Role |
|---|---|---|
| `orchestrator` | Whole feature | Lead session; sole spawner; SPAWN_REQUEST + RESTART_REQUEST handler; cleanup + push. |
| `solution-architect` | Phase A only | Spec + arch-map. |
| `feature-planner` | Phase A only | Plan (plan-phase grouped, waves). |
| `security-engineer` | Phase A only (regulated domains only) | Regulatory + threat-model review. |
| `team-leader` | Phases B–F | Coordinator; composes spawn briefs; runs phase-end SOLID/DRY/domain review. |
| `backend-developer` / `frontend-developer` | Per wave | TDD implementation, static-check log capture, commit. |
| `qc-engineer` | Phase G only | End-of-plan 5-step QC; rework dispatch if blocking. |

- **Three guardrail hooks** (registered automatically via `hooks/hooks.json`):
  - `TeammateIdle` — role-aware idle routing (refuses idle when the role's
    outstanding obligation is open).
  - `TaskCreated` — enforces `impl:` / `review:` / `meta:` / `block:` task
    title prefixes, v5 wave shape, and shape-marker scope.
  - `TaskCompleted` — gates `impl:` completions on the static-check log
    (`.team-superpower/static-check-<task-id>.log`) and rework-reference
    (`Reworks: <orig-id>` for `impl:rework-*`).
- `scripts/team-state.sh` — inspection + cleanup helper; new `members <slug>`
  subcommand lists role / id / status per teammate.
- Robustness primitives baked into the workflow:
  - **Preflight scan** in `/team-feature` — detects orphaned team config and
    in-flight runs before doing anything destructive.
  - **Auto-resume** in `/team-feature` — detects in-progress handovers
    without a matching qc-report and offers to continue.
  - **Phase-end leader review** — team-leader scans every plan-phase's diff
    against the arch-map for SOLID/DRY/domain violations and dispatches
    `impl:rework-*` tasks.
  - **End-of-plan QC** — qc-engineer runs once after `PLAN_COMPLETE`; up to 3
    rework rounds.
  - **Heartbeat file** at `docs/superpowers/sessions/<slug>.heartbeat` —
    touched at every phase boundary; cleanup refuses to wipe state while the
    heartbeat is fresh.
  - **Automatic cleanup after `FINISH_DONE`** — the lead verifies all phases
    complete, all commits in place, teammates idle, then runs the canonical
    "clean up the team" primitive followed by a verification scan.
  - **`/team-cleanup [slug]`** for the case where a previous lead crashed.
- Templates seeded into your project on first use:
  `docs/superpowers/ESCALATION.md` (template + three worked examples),
  `docs/superpowers/README.md` (onboarding + troubleshooting), and
  `docs/superpowers/handovers/README.md` (handover artefact contract).

## Phase chain at a glance

| Phase | Role(s) | Output | Gate? |
|---|---|---|---|
| A — Analysis | `solution-architect` + `feature-planner` [+ `security-engineer`] | Spec, arch-map, plan, handover | Spec sign-off + plan approval (2 touchpoints) |
| B–F — Implementation (one per plan-phase) | `team-leader` + `backend-developer` / `frontend-developer` | TDD commits per wave + phase-end leader review | `PHASE_COMPLETE` per plan-phase |
| G — End-of-plan QC | `qc-engineer` | `<date>-<slug>-qc-report.md` | `QC_PASS` (max 3 rework rounds) |
| H — Finish | `orchestrator` | Push + merge/PR/keep/discard | Owner decision (finish touchpoint) |

## Requirements

- Claude Code `2.1.32` or later.
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in your environment (the slash
  command halts if absent).
- The Superpowers plugin installed:
  `/plugin install superpowers@claude-plugins-official`.
- `jq` on `$PATH` (hooks degrade to log-only when missing, but you want them
  enforcing).
- **Run the lead session on Opus.** Teammates are pinned via their agent
  frontmatter, so they always spawn on their pinned model. The lead carries
  the cross-phase reasoning load (gate decisions, SPAWN_REQUEST handling,
  RESTART_REQUEST approval, FINISH_BLOCKED recovery), so Opus is the right
  tier. The command performs a self-attestation check at preflight and halts
  if the lead reports it is running on Sonnet/Haiku.

## Install

```text
/plugin marketplace add baoduy/agents-and-skills
/plugin install team-superpower@drunkcoding
```

Then make sure the agent-teams env flag is set in `~/.claude/settings.json`:

```json
{
  "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" },
  "teammateMode": "in-process"
}
```

## Use

```text
/team-feature add a /healthcheck endpoint that returns 200 OK
```

You will be interrupted at most three times in team mode:

1. Spec sign-off (mid phase A).
2. Plan approval (end phase A).
3. Finish-branch decision — merge / PR / keep / discard (phase H).

Anything else that reaches you uses the escalation template in
`docs/superpowers/ESCALATION.md`. If a teammate pings you without using the
template, that's a bug — file it.

## Task prefix routing

The planner assigns every `impl:` task one of these sub-prefixes; the lead
routes by prefix:

| Prefix | Routed to | Scope |
|---|---|---|
| `impl:be-*` | `backend-developer` | Server-side code, APIs, data, schemas, infra |
| `impl:be-migration-*` | `backend-developer` | Schema migrations (serialised by hook) |
| `impl:be-contract-publish-*` | `backend-developer` | Publishes contract; gates FE tasks |
| `impl:fe-*` | `frontend-developer` | UI components, pages, client-side state, styles |
| `impl:contract-update-*` | `backend-developer` | Contract drift fix (scope-neutral) |
| `impl:rework-*` | inherits originating task's role | Phase-end leader review or QC rework |

Wave metadata must be one of: `<plan-phase>.<wave>` (e.g. `1.1`),
`<plan-phase>.rework`, or `qc-rework`.

## Resume after `/resume` drops the team

Re-run `/team-feature` from the same worktree. The lead detects:

1. Existing `~/.claude/teams/superpower-<slug>/` directory.
2. In-progress feature artefacts (handover without matching qc-report).
3. Partial commits ahead of the base branch.

…and presents a single resume prompt. On continue, completed phases are not
redone.

## Clean up after a crashed lead

```text
/team-cleanup <slug>
/team-cleanup --all
```

Use this when a previous lead died (terminal closed, `/resume` lost the team,
OS killed the process) and left `~/.claude/teams/superpower-<slug>/` behind.
Project-side artefacts under `docs/superpowers/{specs,plans,handovers,reviews}`
are preserved; only platform-side state plus per-feature scratch
(`.team-superpower/spawn-briefs/`, `.team-superpower/static-check-*.log`) is
removed.

The slash command dry-runs first, prints what would be removed, and asks for
confirmation. The heartbeat file at
`docs/superpowers/sessions/<slug>.heartbeat` is checked — if it was touched
in the last 10 minutes, cleanup refuses unless the owner explicitly confirms
with `--ignore-heartbeat` that the previous lead is dead.

The helper script is also runnable directly:

```bash
bash plugins/team-superpower/scripts/team-state.sh scan          # list all teams
bash plugins/team-superpower/scripts/team-state.sh scan <slug>   # inspect one
bash plugins/team-superpower/scripts/team-state.sh members <slug>     # list role/id/status
bash plugins/team-superpower/scripts/team-state.sh cleanup <slug>          # dry-run
bash plugins/team-superpower/scripts/team-state.sh cleanup <slug> --force  # apply
```

## Layout

```
plugins/team-superpower/
├── .claude-plugin/plugin.json
├── README.md
├── agents/
│   ├── orchestrator.md
│   ├── solution-architect.md
│   ├── feature-planner.md
│   ├── security-engineer.md
│   ├── team-leader.md
│   ├── backend-developer.md
│   ├── frontend-developer.md
│   └── qc-engineer.md
├── commands/
│   ├── team-feature.md          # v5 single-team lifecycle + auto-resume
│   └── team-cleanup.md
├── hooks/
│   ├── hooks.json
│   ├── teammate-idle.sh         # role-aware idle routing
│   ├── task-created.sh          # impl:/review:/meta:/block: + v5 wave shape
│   └── task-completed.sh        # static-check log + rework reference gate
├── scripts/
│   ├── team-state.sh            # inspection + cleanup helper + members subcommand
│   ├── detect-stack.sh
│   └── parse-claudemd.sh
└── assets/
    ├── ESCALATION.md            # seeded to docs/superpowers/ESCALATION.md on first run
    ├── SESSION_README.md        # seeded to docs/superpowers/README.md on first run
    └── CLAUDE.md.template       # copy to repo root if no CLAUDE.md exists
```

## Clarification routing

Teammates resolve as many clarifications as possible without involving the
owner. Every clarification is classified into one of three classes —
`tactical`, `cross-role`, `architectural` — per `assets/ESCALATION.md`.

- **Tactical** (naming, wording, thresholds in range) — decided by the
  originator and logged in the checkpoint's `## Assumptions` block. No
  SendMessage, no escalation.
- **Cross-role** — to the relevant peer via SendMessage; consensus on first
  reply → log + proceed; no consensus → escalate citing attempts.
- **Architectural** — implementers send `ESCALATE class=architectural` to
  team-leader. If team-leader cannot resolve from arch-map, team-leader posts
  `RESTART_REQUEST` to the orchestrator (recovery touchpoint, not counted
  against the 3-budget).

Per-role rubrics live in each agent file under `agents/<role>.md`.

## Design

- The **lead** is a conductor. It never runs a Superpowers skill itself.
- Teammates run **canonical, unmodified** Superpowers skills. They are
  forbidden from paraphrasing or replacing them.
- TDD is enforced by `subagent-driven-development` +
  `test-driven-development` per implementer task. Static checks (lint +
  format + typecheck) are captured to a log and gated by the `TaskCompleted`
  hook.
- **Phase-end leader review** + **end-of-plan QC** keep architectural drift
  in check without a per-task QA loop.
- All cross-team chatter that needs an owner decision goes through the §7
  escalation template.
- Every phase boundary writes a checkpoint to
  `docs/superpowers/sessions/<slug>.md`.

## Out of scope

- Token-usage metrics per teammate per phase.
- Per-role permission allowlists.
- Standalone devops, technical-writer, or minimal-change-engineer roles —
  infra/CI folds into `backend-developer`; documentation lands in PR
  descriptions and inline; minimal-change patterns are scoped per task by
  the planner.

## License

MIT.
