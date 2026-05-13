---
name: validate-skills
description: Validates skills in this repo against agentskills.io spec and Claude Code best practices. Use via /validate-skills command.
license: MIT
metadata:
  author: Callstack
  upstream: https://github.com/callstackincubator/agent-skills
  tags: validation, linting, skill-authoring
---

# Validate Skills

Validate all skills in this repo against the agentskills.io spec and Claude Code best practices.

## Validation Checklist

For each skill directory, verify:

### Spec Compliance (agentskills.io)

| Check | Rule |
|-------|------|
| `name` format | 1-64 chars, lowercase alphanumeric + hyphens, no leading/trailing/consecutive hyphens |
| `name` matches directory | Directory name must equal `name` field |
| `description` length | 1-1024 characters, non-empty |
| Optional fields valid | `license`, `metadata`, `compatibility` if present |
| `skills` key in plugin.json | If `plugin.json` declares `skills`, it must be a string directory path (e.g. `"./skills/"`). Array-of-paths form is unverified and likely rejected by the loader — flag as `[WARN]` and recommend either a string path or omitting the key entirely (skills are auto-discovered from `<plugin>/skills/*/SKILL.md`). Reference: `context-mode` plugin uses `"skills": "./skills/"`; Anthropic official plugins omit the key. |

### Best Practices (Claude Code)

| Check | Rule |
|-------|------|
| Description format | Third person, describes what + when to use |
| Body length | Under 500 lines |
| References one-level deep | No nested reference chains |
| Links are markdown | Use `[text](path)` not bare filenames |
| No redundancy | Don't repeat description in body |
| Concise | Only add context Claude doesn't already have |

## How to Run

1. Find all skill directories under `plugins/`:
   ```bash
   fd -t f -g 'SKILL.md' plugins/
   ```
   (Per project memory: scope is `plugins/**` only — skip `.claude/skills/`.)

2. Parse each `plugins/*/.claude-plugin/plugin.json`. If `skills` key is present and not a string path (e.g., array of paths), emit `[WARN]` for that plugin with recommendation to switch to `"./skills/"` or omit.

3. For each `SKILL.md`, read it and check against the rules above.

3. Report issues in this format:
   ```
   ## Validation Results

   ### plugins/<plugin>/skills/<skill>
   - [PASS] name format valid
   - [FAIL] name "example" doesn't match directory "example-skill"
   - [PASS] description length OK (156 chars)
   ```

## References

- [agentskills.io spec](https://agentskills.io/specification)
- [Claude Code best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- Upstream: [callstackincubator/agent-skills](https://github.com/callstackincubator/agent-skills)
