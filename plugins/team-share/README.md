# team-share

Onboard your team with an interactive setup menu. Run `/team-share` and choose which actions to execute — only selected actions run.

## What it does

The `team-share` agent presents a multi-select menu with four options:

| Option | What runs |
|--------|-----------|
| **Default (CodeGraph + Claude config)** *(Recommended)* | `codegraph-setup` + `claude-config` |
| Setup CodeGraph | `codegraph-setup` |
| Setup Understand-Anything | `understand-setup` |
| Setup team Claude config | `claude-config` |

## Skills (independently invocable)

Each action is also available as a standalone skill:

### `/codegraph-setup`

Installs the [CodeGraph](https://github.com/colbymchenry/codegraph) CLI, wires it to Claude Code via MCP (`codegraph install`), and initialises the current project (`codegraph init`). Works on macOS, Linux, and Windows.

### `/understand-setup`

Installs the [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) plugin, builds the knowledge graph with `--auto-update`, generates `docs/wiki`, git-lfs tracks the graph, and stages all artefacts.

### `/claude-config`

Merges `enabledPlugins` and `extraKnownMarketplaces` from the maintainer's user settings into `.claude/settings.json`, scaffolds `CLAUDE.md` when missing, injects the Understand-Anything code-research section, and stages the result.

## Usage

```text
/team-share [--force] [--language <lang>]
```

Arguments are forwarded to `/understand` when `understand-setup` is selected.

## Notes

- `codegraph-setup` requires internet access to download the CLI.
- `understand-setup` requires `git-lfs` and `jq` to be installed.
- `claude-config` requires `jq` to be installed.
- All skills stage files but never commit or push — a human reviews and commits.
- All skills are idempotent — safe to re-run.
