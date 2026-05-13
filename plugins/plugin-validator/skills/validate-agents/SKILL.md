---
name: validate-agents
description: Validates plugin agents (any .md file under plugins/**/agents/) against the Claude Code subagent spec. Use via /validate-agents command.
license: MIT
metadata:
  author: Steven Hoang
  tags: validation, linting, plugin-authoring, agents
---

# Validate Agents

Validate plugin agents under `plugins/**/agents/*.md` against the Claude Code subagent spec. Scope: `plugins/**` only.

## Discovery

```bash
find plugins -path '*/agents/*.md'
find plugins -path '*/.claude-plugin/plugin.json'
```

For each `plugin.json`, parse and check whether the `agents` key is present (any shape). Emit one `[FAIL]` per plugin that declares it. Then validate every agent `.md` file as below.

## Spec Compliance Checks

| Check | Rule |
|-------|------|
| YAML frontmatter | Present and parses |
| `name` format | 1-64 chars, lowercase alphanumeric + hyphens; no leading/trailing/consecutive hyphens |
| `name` matches filename | `agents/foo.md` → `name: foo` |
| `description` length | 1-1024 chars, non-empty |
| `tools` optional | Comma-separated string; each name appears in the valid-tool list below |
| `model` optional | One of `sonnet`, `opus`, `haiku`, `inherit` |
| No `agents` key in plugin.json | The plugin loader rejects any `agents` field with `agents: Invalid input`. Agent files are auto-discovered from `<plugin>/agents/*.md`. If `plugin.json` declares an `agents` array (or any other shape), flag as `[FAIL]` and recommend deleting the key. Confirmed against `anthropics/claude-code` official plugins (`pr-review-toolkit`, `frontend-design`, `commit-commands`, `hookify`) — none declare `agents`. |

### Valid tool names (Claude Code ≥ 2.1.139)

`Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `NotebookEdit`, `Task`, `Agent`, `Skill`, `AskUserQuestion`, `EnterWorktree`, `ExitWorktree`, `EnterPlanMode`, `ExitPlanMode`, `TodoWrite`, `TodoRead`, `TaskCreate`, `TaskUpdate`, `WebFetch`, `WebSearch`, plus any name with the `mcp__<server>__<tool>` prefix (treat unknown `mcp__*` names as `[WARN]`, not `[FAIL]`, because MCP names are dynamic).

Refresh this list when a new Claude Code major version ships. Source: docs.claude.com sub-agents page and `~/.claude/cache/changelog.md`.

## Best-Practice Checks

| Check | Rule |
|-------|------|
| Third-person description | Description does not begin with "I " or use "I will" / "I'll" |
| When-to-invoke trigger | Description states when to invoke (heuristic: contains "Use when", "When the user", or "Trigger") |
| Body length | Body (post-frontmatter) under 500 lines |
| No first-person body | Body does not contain "I will" / "I'll" as a leading clause |
| Behavior section | Body has at least one of: `## Output`, `## Behavior`, `## Workflow`, `## How to Run` |

## How to Run

1. Discover all agent files.
2. Parse YAML frontmatter (use Python `yaml.safe_load`).
3. Apply spec + best-practice tables.
4. Emit report:

   ```
   ## Validation Results

   ### plugins/<plugin>/agents/<name>.md
   - [PASS] <check>
   - [FAIL] <check>: <details>
   ```

5. Final tally: `Summary: <N> agent files scanned. <P> pass, <F> fail.`

## References

- [Claude Code subagent docs](https://docs.claude.com/en/docs/claude-code/sub-agents)
- Tool-list provenance: see `docs/superpowers/specs/2026-05-13-plugin-validation-skills-design.md` § Resolution 2
- Sibling skills: `validate-skills`, `validate-hooks`, `validate-commands`
