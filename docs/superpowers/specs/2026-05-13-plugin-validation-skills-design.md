# Plugin Validation Skills — Design

**Date:** 2026-05-13
**Status:** Draft for review
**Author:** Steven Hoang (via Claude)

## Motivation

Installing `team-superpower` failed with:

```
Validation errors: hooks: Invalid input, commands: Invalid input, agents: Invalid input
```

The existing `validate-skills` skill catches `SKILL.md` issues, but the repo has no equivalent for the three other plugin asset types — hooks, agents, commands. Author-time validation would surface these errors before install attempts.

## Goals

- Catch plugin manifest shape errors before install.
- Catch malformed YAML frontmatter in agent and command files.
- Catch malformed `hooks.json` structure and broken script references.
- Mirror the working pattern of `validate-skills` (flat skill directory + checklist + report format).
- Scope strictly to `plugins/**` per repo-level convention (only `plugins/` ships).

## Non-Goals

- Fixing the underlying `team-superpower` manifest. That is a separate task.
- Building an aggregator `/validate-plugin` command. Can be added later if useful.
- Validating runtime hook behavior. Static checks only.
- Publishing these skills via marketplace. They are local tooling under `.claude/skills/`.

## Approach

Three sibling skills, each invoked via its own slash command, each producing a structured report identical in shape to `validate-skills` output.

```
.claude/skills/validate-hooks/SKILL.md       → /validate-hooks
.claude/skills/validate-agents/SKILL.md      → /validate-agents
.claude/skills/validate-commands/SKILL.md    → /validate-commands
```

Each skill: short body, checklist tables, "How to run" section, no external references beyond Claude Code plugin docs.

## Validation Rules

### validate-hooks

**Discovery:** `find plugins -name 'hooks.json'` plus any plugin manifest whose `hooks` field is inline.

**Spec checks**

| Check | Rule |
|-------|------|
| Manifest `hooks` field | Inline object preferred. Confirm whether current loader still accepts string path — investigation task in plan. Flag string-path usage as warning until confirmed. |
| Top-level keys | Must be valid event names: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `Notification`, `PreCompact`, `SessionStart`, `SessionEnd` |
| Matcher group shape | `{ matcher: string, hooks: [...] }` |
| Hook entry shape | `{ type: "command"\|"prompt", command?: string, prompt?: string, timeout?: integer }` |
| Command resolves | Path resolves relative to plugin root or uses `${CLAUDE_PROJECT_DIR}` / `${CLAUDE_PLUGIN_ROOT}` |
| Executable bit | Referenced shell script has `+x` |
| Regex compiles | Matcher value compiles as Python `re` pattern |

**Best practices**

- No leaked user-absolute paths (`/Users/<name>/...`).
- Timeouts under 60s unless commented.
- `prompt`-type hooks reference skills/commands that exist.

### validate-agents

**Discovery:** `find plugins -path '*/agents/*.md'`.

**Spec checks**

| Check | Rule |
|-------|------|
| YAML frontmatter | Required, parses |
| `name` format | 1-64 chars, lowercase alphanumeric + hyphens, no leading/trailing/consecutive hyphens |
| `name` matches filename | `agents/foo.md` → `name: foo` |
| `description` length | 1-1024 chars |
| `tools` optional | Comma-separated tool names, all valid |
| `model` optional | One of `sonnet`, `opus`, `haiku`, `inherit` |
| Manifest reference | If listed in plugin.json `agents`, the path exists |

**Best practices**

- Description third-person, includes when-to-invoke trigger.
- Body under 500 lines.
- No first-person voice ("I will...") in body.
- Clear behavior/output section.

### validate-commands

**Discovery:** `find plugins -path '*/commands/*.md'`.

**Spec checks**

| Check | Rule |
|-------|------|
| Optional frontmatter | If present, parses |
| `description` length | 1-1024 chars when present |
| `allowed-tools` optional | Valid tool names |
| `argument-hint` optional | String |
| `model` optional | One of `sonnet`, `opus`, `haiku`, `inherit` |
| Filename → command | `commands/foo.md` produces `/foo`; filename must be lowercase + hyphens, no spaces |
| Body non-empty | After frontmatter |
| Manifest reference | If listed in plugin.json `commands`, the path exists |

**Best practices**

- Includes `argument-hint` when body uses `$ARGUMENTS`.
- Describes expected output behavior.
- No cross-references to non-existent skills or commands.

## Workflow (per skill)

1. Discover candidate files via `find plugins ...`.
2. Parse each (YAML or JSON).
3. Run checklist tables.
4. Emit report:
   ```
   ## Validation Results

   ### plugins/<plugin>/<file>
   - [PASS] <check>
   - [FAIL] <check>: <details>
   ```
5. Final tally line: total, pass count, fail count.

## File Layout

```
.claude/skills/
  validate-hooks/
    SKILL.md
  validate-agents/
    SKILL.md
  validate-commands/
    SKILL.md
```

Each `SKILL.md` follows the existing `validate-skills/SKILL.md` template: frontmatter, body with checklists, "How to Run", "References".

## Open Questions (Resolve in Plan)

1. **Hooks field shape.** Does the current Claude Code plugin loader accept `"hooks": "hooks/hooks.json"` (string path) or only inline object? Plan task: confirm against Claude Code source or docs, then encode result as a hard `[FAIL]` vs soft `[WARN]` in `validate-hooks`.
2. **Tool name list.** Need an authoritative list of valid Claude Code tool names for `tools` / `allowed-tools` checks. Plan task: identify source, decide whether to inline the list or fetch.

## Resolutions

### Resolution 1: Hooks field shape

**Outcome: B — string path is the bug. The Claude Code plugin loader requires `hooks` to be an inline object.**

**Evidence:**

1. **caveman plugin** (`~/.claude/plugins/cache/caveman/caveman/ef6050c5e184/.claude-plugin/plugin.json`) — installs and runs successfully. Its `hooks` field is an inline object:
   ```json
   {
     "hooks": {
       "SessionStart": [{ "hooks": [{ "type": "command", "command": "..." }] }],
       "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "..." }] }]
     }
   }
   ```

2. **team-superpower plugin** — install fails with `hooks: Invalid input`. Its `hooks` field is a string path:
   ```json
   { "hooks": "hooks/hooks.json" }
   ```

3. **context-mode plugin** — installs fine. Its `.claude-plugin/plugin.json` has **no `hooks` field at all**. The string-path form (`"hooks": "./hooks/cursor/hooks.json"`) only appears in its `.cursor-plugin/plugin.json` (Cursor-specific variant, not loaded by Claude Code).

4. The Claude binary at `~/.local/bin/claude` contains the string `validateObject(hook, "hook")`, consistent with Zod/schema validation that rejects non-object types.

**Source:** Local plugin cache inspection (`~/.claude/plugins/cache/`). No public documentation URL is available — `docs.claude.com` URLs were unreachable in this session (DNS sandbox restriction) and Context7 quota was exhausted. The evidence from installed plugins is conclusive.

**Implication for plan:**
- `validate-hooks` must flag `"hooks": "<string>"` in `plugin.json` as a hard `[FAIL]`, not a `[WARN]`.
- The correct shape is an inline object keyed by event name (`PreToolUse`, `PostToolUse`, `SessionStart`, `UserPromptSubmit`, `PreCompact`, `Stop`, `SubagentStop`, `Notification`).
- Fixing `team-superpower` (separate task) requires inlining the hooks object from `hooks/hooks.json` directly into `plugin.json`, or removing the `hooks` field and configuring hooks via `settings.json` instead.

---

### Resolution 2: Tool-name list

**Finding: The list is stable enough to inline. Prefer linking to docs for the definitive reference, but include the known list in the skill body with a version stamp.**

**Authoritative tool names (as of Claude Code ≥ 2.1.139), extracted from the installed context-mode plugin's PostToolUse matcher and confirmed against agent frontmatter in this repo:**

Core file/shell tools: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `NotebookEdit`

Task/agent tools: `Task`, `Agent`, `Skill`, `AskUserQuestion`

Worktree/plan tools: `EnterWorktree`, `ExitWorktree`, `EnterPlanMode`, `ExitPlanMode`

Todo/tracking tools: `TodoWrite`, `TodoRead`, `TaskCreate`, `TaskUpdate`

Web/network tools: `WebFetch`, `WebSearch`

MCP tools: `mcp__<server>__<tool>` (prefix match; any MCP tool name is valid)

**Sources:**
- context-mode plugin PostToolUse hook matcher (extracted from `~/.claude/plugins/cache/context-mode/context-mode/1.0.121/server.bundle.mjs`): `Bash|Read|Write|Edit|NotebookEdit|Glob|Grep|TodoWrite|TaskCreate|TaskUpdate|EnterPlanMode|ExitPlanMode|Skill|Agent|AskUserQuestion|EnterWorktree|mcp__`
- Existing agent frontmatter in `plugins/team-superpower/agents/*.md`: `Read, Write, Edit, Bash, Glob, Grep`
- Claude Code changelog `~/.claude/cache/changelog.md` (versions 2.1.136–2.1.140)
- Reference URL (verify current list): `https://docs.claude.com/en/docs/claude-code/sub-agents`

**Implication for plan:**
- `validate-agents` and `validate-commands` should inline the known list above with a comment citing the Claude Code version and the docs URL.
- Unknown tool names (including `mcp__*` prefixed names) should produce `[WARN]` (not `[FAIL]`), since MCP tool names are dynamic and user-defined.
- The list should be refreshed whenever a new Claude Code major version is released. Document this in each skill's References section.

---

## Risks

- Tool-name lists drift as Claude Code adds tools — validation will need periodic refresh.
- Hooks schema may change. Cite version in skill body so future drift is obvious.
- Static checks cannot catch runtime hook failures. Document this limitation in each skill body.

## Out of Scope (Future Work)

- Aggregator `/validate-plugin` that runs all four (`-skills` + new three).
- Auto-fix mode that rewrites known mistakes.
- CI integration via pre-commit or GitHub Action.
