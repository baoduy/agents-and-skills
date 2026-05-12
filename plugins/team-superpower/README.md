# team-superpower

Coordination layer that runs the [obra/superpowers](https://github.com/obra/superpowers) skill chain across a Claude Code **agent team**. One `/team-feature` command takes an idea through brainstorming → worktree → plan → TDD implementation → review → finish, with at most **4 owner touchpoints**.

This plugin is *not* a fork of Superpowers. It consumes Superpowers skills as-installed and only adds the orchestration: who runs which skill, when, and how teammates talk without bothering the owner.

## What you get

- Two slash commands: `/team-feature` and `/team-feature-resume`.
- Four agent roles, each with a tightly-scoped system prompt mapping it to specific Superpowers skills:
  - `designer` — runs `brainstorming`.
  - `planner` — runs `using-git-worktrees`, then `writing-plans`.
  - `implementer` — runs `subagent-driven-development` + `test-driven-development` per task.
  - `reviewer` — runs `requesting-code-review`, then `finishing-a-development-branch`.
- Three guardrail hooks (registered automatically via `hooks/hooks.json`):
  - `TeammateIdle` — refuses idle while peer mail is unanswered.
  - `TaskCreated` — enforces `impl:`/`review:`/`meta:`/`block:` task title prefixes.
  - `TaskCompleted` — gates `impl:` completions on `plan_approved_at` and validates escalation entries.
- Templates seeded into your project on first use: `docs/superpowers/ESCALATION.md` (escalation template + 2 worked examples) and `docs/superpowers/README.md` (onboarding + troubleshooting).

## Requirements

- Claude Code `2.1.32` or later.
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in your environment (the slash command will halt if absent).
- The Superpowers plugin installed: `/plugin install superpowers@claude-plugins-official`.
- `jq` on `$PATH` (the hooks degrade to log-only when missing, but you want them enforcing).

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

You will be interrupted at most four times:

1. Brainstorming clarifying questions (batched per phase).
2. Design sign-off.
3. Plan approval.
4. Finish-branch decision (merge / PR / keep / discard).

Anything else that reaches you uses the escalation template in `docs/superpowers/ESCALATION.md`. If a teammate pings you without using the template, that's a bug — file it.

## Resume after `/resume` drops the team

```text
/team-feature-resume YYYY-MM-DD-<slug>.md
```

The lead reads the committed checkpoint in `docs/superpowers/sessions/`, respawns the right teammates, and continues from the next unchecked phase. Completed phases are not redone.

## Layout

```
plugins/team-superpower/
├── .claude-plugin/plugin.json
├── README.md
├── agents/
│   ├── designer.md
│   ├── planner.md
│   ├── implementer.md
│   └── reviewer.md
├── commands/
│   ├── team-feature.md
│   └── team-feature-resume.md
├── hooks/
│   ├── hooks.json
│   ├── teammate-idle.sh
│   ├── task-created.sh
│   └── task-completed.sh
└── assets/
    ├── ESCALATION.md      → seeded to docs/superpowers/ESCALATION.md on first run
    └── SESSION_README.md  → seeded to docs/superpowers/README.md on first run
```

## Design

See the project's `docs/superpowers/README.md` after first run for the operating manual. The short version:

- The **lead** is a conductor. It never runs a Superpowers skill itself.
- Teammates run **canonical, unmodified** Superpowers skills. They are forbidden from paraphrasing or replacing them.
- TDD is enforced by `subagent-driven-development` + `test-driven-development` per implementer task. The `TaskCompleted` hook is a backstop, not the primary control.
- All cross-team chatter that needs an owner decision goes through the §7 escalation template. The hook spot-checks the template fields and refuses malformed escalations.
- Every phase boundary writes a checkpoint to `docs/superpowers/sessions/<slug>.md`. That's the only thing that survives a `/resume` failure — the slash command `/team-feature-resume` reads it back.

## Out of scope

- Token-usage metrics per teammate per phase.
- Auto-cleanup slash command (`/team-cleanup`).
- Per-role permission allowlists.
- Frontend/backend specialist implementers (defer until pattern proves out).

## License

MIT.
