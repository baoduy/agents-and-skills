---
name: team-share
description: Share Claude plugin settings with the team, build or refresh the Understand-Anything knowledge graph, initialize the docs wiki, and git-lfs track it before staging everything for review.
argument-hint: "[--force] [--language <lang>] (forwarded to understand-setup → /understand)"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Skill, AskUserQuestion
---

# /team-share

Make this repo onboarding-ready for the team in one pass. Choose which setup actions to run.

## Step 0 — Interactive menu

Before any work begins, use AskUserQuestion with `multiSelect: true` and these four options:

| Label | Description |
|-------|-------------|
| Default (CodeGraph + Claude config) *(Recommended)* | Install CodeGraph CLI + init project, then share .claude/settings.json and scaffold CLAUDE.md. Best starting point for most repos. |
| Setup CodeGraph | Install the CodeGraph CLI, wire it to Claude Code MCP, and run codegraph init in this project. |
| Setup Understand-Anything | Install the Understand-Anything plugin, build the knowledge graph with auto-update, and generate docs/wiki. |
| Setup team Claude config | Merge enabledPlugins + marketplaces into .claude/settings.json, scaffold CLAUDE.md, and stage. |

If the user selects nothing, print `"Nothing selected — exiting."` and stop immediately.

## Step 1 — Build run-list

From the selected options, assemble a deduplicated run-list. Mapping:

- "Default (CodeGraph + Claude config)" → `codegraph-setup`, `claude-config`
- "Setup CodeGraph" → `codegraph-setup`
- "Setup Understand-Anything" → `understand-setup`
- "Setup team Claude config" → `claude-config`

Deduplication: if a skill appears more than once (e.g. "Default" + "Setup CodeGraph" both selected), keep it once. Final order is always: `codegraph-setup` → `understand-setup` → `claude-config`.

## Step 2 — Dispatch

Invoke each skill in the run-list in order using the Skill tool:

- `codegraph-setup`  → `team-share:codegraph-setup` (no arguments)
- `understand-setup` → `team-share:understand-setup` with `$ARGUMENTS` forwarded
- `claude-config`    → `team-share:claude-config` (no arguments)

The agent does no implementation work itself — all logic lives in the skills.

## Done — summary

After all selected skills complete, print a summary:

- Which actions ran (in order).
- Any failures or warnings reported by individual skills.
- Reminder: **review staged changes, then commit yourself** — for example:
  `git commit -m "chore: team onboarding setup (codegraph + claude config)"`
