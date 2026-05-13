---
name: validate-hooks
description: Validates plugin hooks (plugin.json hooks field and any referenced hooks.json) in plugins/** against the Claude Code plugin spec. Use via /validate-hooks command.
license: MIT
metadata:
  author: Steven Hoang
  tags: validation, linting, plugin-authoring, hooks
---

# Validate Hooks

Validate plugin hooks under `plugins/**` against the Claude Code plugin spec. Scope: `plugins/**` only — local-only `.claude/skills/` and `.claude/hooks/` are out of scope.

## Discovery

```bash
find plugins -name 'hooks.json'
find plugins -name 'plugin.json' -path '*/.claude-plugin/*'
```

Parse each `plugin.json`. If its `hooks` field is an inline object, validate inline. If its `hooks` field is a string path, that is a hard `[FAIL]` (see Spec Compliance below) — but still attempt to resolve and parse the referenced file for additional checks.

## Spec Compliance Checks

| Check | Rule |
|-------|------|
| `hooks` field shape | Must be an inline object. String-path form (`"hooks": "<path>"`) is rejected by the Claude Code plugin loader with `hooks: Invalid input`. Flag as `[FAIL]`. |
| Top-level event keys | One of: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `Notification`, `PreCompact`, `SessionStart`, `SessionEnd` |
| Event value | Array of matcher groups |
| Matcher group shape | `{ matcher: string, hooks: [...] }` |
| Hook entry shape | `{ type: "command"\|"prompt", command?: string, prompt?: string, timeout?: integer }` |
| Command path resolves | Resolves relative to plugin root, or uses `${CLAUDE_PROJECT_DIR}` / `${CLAUDE_PLUGIN_ROOT}` |
| Executable bit | Referenced shell script has `+x` |
| Regex compiles | Matcher value compiles as a Python `re` pattern |

## Best-Practice Checks

| Check | Rule |
|-------|------|
| No absolute user paths | Body of command does not contain `/Users/<name>/...` or `/home/<name>/...` |
| Timeout sane | `timeout` ≤ 60 unless inline comment justifies |
| Prompt-type targets exist | `prompt`-type hooks reference skills or commands that exist on disk |

## How to Run

1. Discover candidate files (see Discovery above).
2. For each, parse JSON and apply spec + best-practice checks.
3. Emit report:

   ```
   ## Validation Results

   ### plugins/<plugin>/<file>
   - [PASS] <check description>
   - [FAIL] <check description>: <details>
   ```

4. Final tally: `Summary: <N> hooks files scanned. <P> pass, <F> fail.`

## References

- [Claude Code plugin docs](https://docs.claude.com/en/docs/claude-code/plugins.md)
- Resolution evidence: see `docs/superpowers/specs/2026-05-13-plugin-validation-skills-design.md` § Resolution 1
- Sibling skills: `validate-skills`, `validate-agents`, `validate-commands`
