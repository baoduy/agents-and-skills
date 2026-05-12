# team-superpower

Coordination layer that runs the [obra/superpowers](https://github.com/obra/superpowers) skill chain across a Claude Code **agent team**. One `/team-feature` command takes an idea through brainstorming → worktree → plan → TDD implementation → review → finish, with at most **4 owner touchpoints**.

This plugin is *not* a fork of Superpowers. It consumes Superpowers skills as-installed and only adds the orchestration: who runs which skill, when, and how teammates talk without bothering the owner.

## What you get

- Three slash commands: `/team-feature`, `/team-feature-resume`, `/team-cleanup`.
- Four agent roles, each with a tightly-scoped system prompt mapping it to specific Superpowers skills:
  - `designer` — runs `brainstorming`.
  - `planner` — runs `using-git-worktrees`, then `writing-plans`.
  - `implementer` — runs `subagent-driven-development` + `test-driven-development` per task.
  - `reviewer` — runs `requesting-code-review`, then `finishing-a-development-branch`.
- Three guardrail hooks (registered automatically via `hooks/hooks.json`):
  - `TeammateIdle` — refuses idle while peer mail is unanswered.
  - `TaskCreated` — enforces `impl:`/`review:`/`meta:`/`block:` task title prefixes.
  - `TaskCompleted` — gates `impl:` completions on `plan_approved_at` and validates escalation entries.
- `scripts/team-state.sh` — the inspection + cleanup helper. Called by the slash commands; also runnable directly.
- Robustness primitives baked into the workflow:
  - **Preflight scan** in `/team-feature` and `/team-feature-resume` — detects orphaned team config, stale task lists, and in-flight runs before doing anything destructive.
  - **Heartbeat file** at `docs/superpowers/sessions/<slug>.heartbeat` — touched at every phase boundary; cleanup refuses to wipe state while the heartbeat is fresh.
  - **Atomic checkpoint writes** (tmp + rename) — half-written checkpoints can't corrupt recovery.
  - **Automatic cleanup after `FINISH_DONE`** — the lead verifies all phases complete, all commits in place, teammates idle, then runs the canonical "clean up the team" primitive followed by a verification scan. No manual `rm -rf` required.
  - **`/team-cleanup [slug]`** for the case where a previous lead crashed and the canonical cleanup path is no longer available.
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

The lead reads the committed checkpoint in `docs/superpowers/sessions/`, scans `~/.claude/teams/superpower-<slug>/` for orphaned platform state, runs cleanup if the heartbeat indicates the previous lead is dead, then respawns the right teammates and continues from the next unchecked phase. Completed phases are not redone.

## Clean up after a crashed lead

```text
/team-cleanup <slug>
/team-cleanup --all
```

Use this when a previous lead died (terminal closed, `/resume` lost the team, OS killed the process) and left `~/.claude/teams/superpower-<slug>/` behind. Project-side artefacts under `docs/superpowers/{specs,plans,reviews}` are preserved; only platform-side state is removed.

The slash command dry-runs first, prints what would be removed, and asks for confirmation. The heartbeat file at `docs/superpowers/sessions/<slug>.heartbeat` is checked — if it was touched in the last 10 minutes, cleanup refuses unless the owner explicitly confirms with `--ignore-heartbeat` that the previous lead is dead.

The helper script is also runnable directly:

```bash
bash plugins/team-superpower/scripts/team-state.sh scan          # list all teams
bash plugins/team-superpower/scripts/team-state.sh scan <slug>   # inspect one
bash plugins/team-superpower/scripts/team-state.sh cleanup <slug>          # dry-run
bash plugins/team-superpower/scripts/team-state.sh cleanup <slug> --force  # apply
```

## Automatic cleanup after the feature ships

`/team-feature` runs cleanup automatically the instant the reviewer reports `FINISH_DONE` (merge / PR / keep / discard). Before wiping anything, the lead verifies:

- every phase from brainstorming through finish is complete in the checkpoint
- the shared task list has zero in-progress tasks
- the expected commits exist on the worktree (design, plan, TDD pairs of test + code, review report, and any merge / PR-prep commit per the finish decision)
- all teammates are idle and shut down

Only then does it invoke the canonical "clean up the team" primitive, verify with a scan that `~/.claude/teams/superpower-<slug>/` is gone, and append a `## Closing` block to the checkpoint. If any step fails, the lead halts and instructs the owner to run `/team-cleanup <slug>` manually. **No `rm -rf` runs on a half-finished feature.**

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
│   ├── team-feature-resume.md
│   └── team-cleanup.md
├── hooks/
│   ├── hooks.json
│   ├── teammate-idle.sh
│   ├── task-created.sh
│   └── task-completed.sh
├── scripts/
│   └── team-state.sh      → inspection + cleanup helper, called by the slash commands
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
- Per-role permission allowlists.
- Frontend/backend specialist implementers (defer until pattern proves out).

## License

MIT.
