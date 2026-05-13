# plugin-validator

Orchestrated validator for Claude Code plugins. Validates skills, agents, commands, and hooks across every plugin under `plugins/**`. Runs sub-validators in parallel and proposes batched fixes.

## Install

```text
/plugin marketplace add baoduy/agents-and-skills
/plugin install plugin-validator@drunkcoding
```

## Usage

Run the full validator across all plugins:

```text
/validate-plugins
```

Or invoke individual sub-validators directly:

| Invocation | What it checks |
|------------|----------------|
| `/validate-skills` | `SKILL.md` frontmatter and body in all plugins |
| `/validate-agents` | Agent `.md` files in all plugins |
| `/validate-commands` | Slash-command `.md` files in all plugins |
| `/validate-hooks` | `plugin.json` hooks fields and `hooks.json` in all plugins |

## What it produces

- A per-plugin report section with `[PASS]` / `[FAIL]` / `[WARN]` per check.
- A summary table: `| Plugin | Skills | Hooks | Agents | Commands | Status |`.
- A batched `## Proposed Fixes` block — choose `Apply all`, `Choose per-item`, or `Skip all`.

## Scope

Scans `plugins/**` only. Local `.claude/` artifacts and vendored paths (e.g. `plugins/tech-graph/skills/tech-graph/`) are excluded.
