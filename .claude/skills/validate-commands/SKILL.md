---
name: validate-commands
description: Validates plugin slash commands (any .md file under plugins/**/commands/) against the Claude Code slash-command spec. Use via /validate-commands command.
license: MIT
metadata:
  author: Steven Hoang
  tags: validation, linting, plugin-authoring, commands
---

# Validate Commands

Validate plugin slash commands under `plugins/**/commands/*.md` against the Claude Code slash-command spec. Scope: `plugins/**` only.

## Discovery

```bash
find plugins -path '*/commands/*.md'
```

## Spec Compliance Checks

| Check | Rule |
|-------|------|
| Frontmatter optional | If present, must parse |
| `description` length | 1-1024 chars when present |
| `allowed-tools` optional | Comma-separated string; each name appears in the valid-tool list below |
| `argument-hint` optional | Plain string |
| `model` optional | One of `sonnet`, `opus`, `haiku`, `inherit` |
| Filename → command | Filename minus `.md` is lowercase alphanumeric + hyphens; produces `/<filename>` |
| Body non-empty | At least one non-blank line after frontmatter |
| Manifest reference | If plugin.json `commands` array lists this file, the path must resolve |

### Valid tool names (Claude Code ≥ 2.1.139)

`Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `NotebookEdit`, `Task`, `Agent`, `Skill`, `AskUserQuestion`, `EnterWorktree`, `ExitWorktree`, `EnterPlanMode`, `ExitPlanMode`, `TodoWrite`, `TodoRead`, `TaskCreate`, `TaskUpdate`, `WebFetch`, `WebSearch`, plus any name with the `mcp__<server>__<tool>` prefix (treat unknown `mcp__*` names as `[WARN]`, not `[FAIL]`, because MCP names are dynamic).

Refresh this list when a new Claude Code major version ships. Source: docs.claude.com slash-commands page and `~/.claude/cache/changelog.md`.

## Best-Practice Checks

| Check | Rule |
|-------|------|
| `argument-hint` when needed | If body contains `$ARGUMENTS` or `$1`/`$2` etc., frontmatter must set `argument-hint` |
| Expected output documented | Body describes what the command produces (heuristic: contains `## Output`, `## Result`, or the words "produces" / "writes") |
| No broken skill refs | Body references to other skills via `superpowers:` or `Skill(...)` resolve to skills installed in this repo (best-effort) |

## How to Run

1. Discover all command files.
2. Parse YAML frontmatter if present.
3. Apply spec + best-practice tables.
4. Emit report:

   ```
   ## Validation Results

   ### plugins/<plugin>/commands/<name>.md
   - [PASS] <check>
   - [FAIL] <check>: <details>
   ```

5. Final tally: `Summary: <N> command files scanned. <P> pass, <F> fail.`

## References

- [Claude Code slash-command docs](https://docs.claude.com/en/docs/claude-code/slash-commands)
- Tool-list provenance: see `docs/superpowers/specs/2026-05-13-plugin-validation-skills-design.md` § Resolution 2
- Sibling skills: `validate-skills`, `validate-hooks`, `validate-agents`
