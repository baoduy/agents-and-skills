---
description: Inspect and clean up team-superpower team state — orphaned configs, task lists, tmux sessions left by a dead lead.
argument-hint: [slug] | --all
---

Inspect and (with owner confirmation) remove orphaned team-superpower state from `~/.claude/teams/superpower-*/` and `~/.claude/tasks/superpower-*/`. Preserves project-side artefacts (`docs/superpowers/{specs,plans,reviews}`) — only platform-side state is removed.

Argument:

$ARGUMENTS

## What "orphaned" means

A team is orphaned when:

- Its team config lives at `~/.claude/teams/superpower-<slug>/` but the lead process is dead, so no Claude Code session can talk to it.
- The agent-teams runtime can't reuse it because the lead-for-a-team is fixed for that team's lifetime (per [docs](https://code.claude.com/docs/en/agent-teams)).
- The canonical "ask the lead to clean up" path is unavailable because there is no lead.

This command is the manual fallback for that case. **If a live lead exists, do not use this command** — message the lead and ask it to "clean up the team" via the native primitive instead.

## Procedure

Run the helper script `${CLAUDE_PLUGIN_ROOT}/scripts/team-state.sh` to do the work. It accepts a subcommand and treats every destructive operation as opt-in (`--force`).

### Step 1 — Decide scope

- If `$ARGUMENTS` is empty: run `bash ${CLAUDE_PLUGIN_ROOT}/scripts/team-state.sh scan` and show the output to the owner. Ask which slug to clean (or `--all`).
- If `$ARGUMENTS` is `--all`: enumerate every slug from the scan and process each in turn.
- Otherwise treat `$ARGUMENTS` as the slug.

### Step 2 — Inspect

For the chosen slug, run `bash ${CLAUDE_PLUGIN_ROOT}/scripts/team-state.sh scan <slug>`. Quote the output verbatim to the owner. Pay attention to the `liveness` line:

| `liveness` | What it means | What to do |
|---|---|---|
| `LIKELY ALIVE` | Heartbeat is < 10min old | **Stop.** Tell the owner the previous lead may still be running. Ask them to verify nothing is in flight before forcing cleanup. |
| `stale` or `unknown` | Heartbeat old or absent | Proceed to step 3. |

### Step 3 — Dry-run

Run `bash ${CLAUDE_PLUGIN_ROOT}/scripts/team-state.sh cleanup <slug>` (no `--force`). Exit code 1 with a "would remove" list is expected. Quote the list to the owner.

If exit code is 4, there is nothing to clean — report and exit.

### Step 4 — Confirm and apply

Ask the owner to confirm the dry-run list. On confirmation, run `bash ${CLAUDE_PLUGIN_ROOT}/scripts/team-state.sh cleanup <slug> --force`.

- Exit code 0: report success and show the appended `## Cleanup` block from the checkpoint.
- Exit code 3 (heartbeat refusal): the owner confirmed nothing is in flight, but the heartbeat is fresh. Re-run with `--force --ignore-heartbeat` only after the owner re-confirms in writing (in the chat) that the previous lead is dead.

### Step 5 — Verify

Re-run `bash ${CLAUDE_PLUGIN_ROOT}/scripts/team-state.sh scan <slug>` and confirm `team_config_state: absent` and `task_list_state: absent`.

## What this command will NOT do

- It will not touch any project-side files except to append a `## Cleanup` block to the checkpoint markdown.
- It will not delete the design doc, plan, or review report — those are the durable record of the work and are kept regardless.
- It will not run when there is a live lead. The heartbeat refusal is the safety check.
- It will not iterate `--all` without per-slug owner confirmation when any slug shows `LIKELY ALIVE`.

## When to use

- After `/resume` left a team config behind that no current session can talk to.
- After a crash or kill of the lead mid-feature.
- Before `/team-feature` if the preflight scan there reports orphaned state.
- Routinely after an in-flight feature is abandoned.
