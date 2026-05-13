---
name: validate-hooks
description: Validates plugin hooks (plugin.json hooks field and any hooks/hooks.json) in plugins/** against the Claude Code plugin spec. Use via /validate-hooks command.
license: MIT
metadata:
  author: Steven Hoang
  tags: validation, linting, plugin-authoring, hooks
---

# Validate Hooks

Validate plugin hooks under `plugins/**` against the Claude Code plugin spec (https://code.claude.com/docs/en/hooks, https://code.claude.com/docs/en/plugins-reference#hooks). Scope: `plugins/**` only — local-only `.claude/hooks/` is out of scope.

## Discovery

```bash
/usr/bin/find plugins -name 'hooks.json'
/usr/bin/find plugins -name 'plugin.json' -path '*/.claude-plugin/*'
```

For each `plugin.json`, classify the `hooks` field:

| Form | Action |
|------|--------|
| absent | Use auto-discovery: validate `<plugin_root>/hooks/hooks.json` if it exists. If neither field nor file exist, plugin has no hooks — skip. |
| string path | Resolve relative to plugin root, parse referenced JSON, validate. |
| array of paths | Resolve each, parse, validate each. |
| object (inline config) | Validate inline. |

All four forms are spec-legal. **Do not flag the `hooks` field for being a string, array, or object.**

If both inline `hooks` and `hooks/hooks.json` exist, emit `[WARN]` — duplication invites drift; pick one source of truth.

## Spec Compliance Checks

| Check | Rule |
|-------|------|
| Top-level container | The hooks config is an object with a single `hooks` key whose value is an object keyed by event name. |
| Event name in allowlist | One of the 28 events below. |
| Event value | Array of matcher groups. |
| Matcher group shape | `{ matcher?: string, hooks: [...] }` (matcher optional). |
| Hook entry `type` | One of: `command`, `http`, `mcp_tool`, `prompt`, `agent`. |
| Hook entry shape (command) | `{ type: "command", command: string, args?: array, timeout?: integer, statusMessage?: string, if?: string, once?: boolean }`. |
| Hook entry shape (http) | `{ type: "http", url: string, headers?: object, timeout?: integer, ... }`. |
| Hook entry shape (mcp_tool) | `{ type: "mcp_tool", server: string, tool: string, ... }`. |
| Hook entry shape (prompt) | `{ type: "prompt", prompt: string, model?: string, timeout?: integer, ... }`. |
| Hook entry shape (agent) | `{ type: "agent", agent: string, prompt?: string, timeout?: integer, ... }`. |
| Command path resolves | Resolves relative to plugin root, or uses `${CLAUDE_PROJECT_DIR}` / `${CLAUDE_PLUGIN_ROOT}`. |
| Executable bit | Referenced shell script has `+x`. |
| Regex compiles | Matcher value compiles as a Python `re` pattern (only checked when matcher contains characters outside `[A-Za-z0-9_|]`). |

### Allowed event names (28)

```
SessionStart, Setup, InstructionsLoaded, UserPromptSubmit, UserPromptExpansion,
PreToolUse, PermissionRequest, PermissionDenied, PostToolUse, PostToolUseFailure,
PostToolBatch, Notification, SubagentStart, SubagentStop,
TaskCreated, TaskCompleted, Stop, StopFailure, TeammateIdle,
ConfigChange, CwdChanged, FileChanged, WorktreeCreate, WorktreeRemove,
PreCompact, PostCompact, SessionEnd, Elicitation, ElicitationResult
```

### Events that do NOT support `matcher`

```
UserPromptSubmit, PostToolBatch, Stop, TeammateIdle,
TaskCreated, TaskCompleted, WorktreeCreate, WorktreeRemove, CwdChanged
```

If a matcher group under one of these events sets a `matcher` field, emit `[WARN]` — the field is silently ignored by the loader. Not a `[FAIL]`.

## Best-Practice Checks

| Check | Rule |
|-------|------|
| No absolute user paths | Body of `command` does not contain `/Users/<name>/...` or `/home/<name>/...`. |
| Timeout sane | `timeout` ≤ 60 unless inline comment justifies. |
| Prompt/agent targets exist | `prompt`-type and `agent`-type hooks reference skills, commands, or agents that exist on disk. |
| `${CLAUDE_PLUGIN_ROOT}` quoting | Shell-form commands wrap `${CLAUDE_PLUGIN_ROOT}` in double quotes (path may contain spaces). |

## How to Run

1. Discover candidate files (see Discovery above).
2. For each, parse JSON and apply spec + best-practice checks.
3. Emit report:

   ```
   ## Validation Results

   ### plugins/<plugin>/<file>
   - [PASS] <check description>
   - [WARN] <check description>: <details>
   - [FAIL] <check description>: <details>
   ```

4. Final tally: `Summary: <N> hooks files scanned. <P> pass, <F> fail, <W> warn.`

## References

- Hook event lifecycle: https://code.claude.com/docs/en/hooks
- Plugin hook location + types: https://code.claude.com/docs/en/plugins-reference#hooks
- Resolution evidence: see `docs/superpowers/specs/2026-05-13-plugin-validation-skills-design.md` § Resolution 1
- Sibling skills: `validate-skills`, `validate-agents`, `validate-commands`
