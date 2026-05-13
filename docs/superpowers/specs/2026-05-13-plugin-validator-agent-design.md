# Plugin Validator Agent — Design

**Date:** 2026-05-13
**Status:** Draft for review
**Author:** Steven Hoang (via Claude)

## Motivation

Four validation skills (`validate-skills`, `validate-hooks`, `validate-agents`, `validate-commands`) cover plugin assets but each is invoked individually and only against one asset type. For a multi-plugin repo, the author must invoke 4 × N commands and manually aggregate results. A single orchestrator agent that fans out across plugins and asset types would compress the workflow to one command.

## Goals

- Provide a single entry point (`/validate-plugins`) that validates every plugin under `plugins/**`.
- Run all four `validate-*` skills against each plugin.
- Aggregate results into a per-plugin section with a top-level summary table.
- Offer interactive fixes for each `[FAIL]` finding after the report is shown.
- Run validations in parallel per-plugin to reduce wall time.

## Non-Goals

- Replacing the four `validate-*` skills. They remain individually invokable.
- Validating anything outside `plugins/**`. `.claude/skills/`, `.claude/agents/`, `.claude/commands/` are out of scope.
- Auto-fixing without user confirmation. All fixes require explicit user `y`.
- Publishing the agent or slash command via the marketplace. They are local tooling.

## Approach

Two files, both local-only:

```
.claude/agents/plugin-validator.md       — agent definition
.claude/commands/validate-plugins.md     — slash command wrapper
```

Slash command body dispatches the agent. Agent body orchestrates parallel sub-dispatch.

### Parallel dispatch model

```
main thread (depth 0)
    ↓ /validate-plugins
plugin-validator agent (depth 1)
    ↓ spawns N subagents in parallel
plugin-N-validator subagent (depth 2)  — one per plugin
    ↓ invokes 4 Skill calls sequentially
    [validate-skills, validate-hooks, validate-agents, validate-commands]
```

Each depth-2 subagent validates one plugin and returns its aggregated report. Depth-2 subagents do not spawn further agents (per org-level depth cap of 2).

Trade-off: 4 sequential Skill calls per plugin instead of 4 parallel. Acceptable because Skill calls run inside the same conversation; parallelism at the plugin level captures the wall-time win.

## Files & Responsibilities

### `.claude/agents/plugin-validator.md`

**Frontmatter:**
```yaml
---
name: plugin-validator
description: Use when the user wants to validate every plugin under plugins/** at once. Spawns one subagent per plugin in parallel, each running validate-skills, validate-hooks, validate-agents, and validate-commands against its assigned plugin. Aggregates results into a per-plugin section plus a top-level summary table, then offers interactive fixes for each FAIL.
tools: Read, Glob, Grep, Bash, Agent, Edit, Write, AskUserQuestion
model: sonnet
---
```

**Body sections:**

1. **Discovery** — `find plugins -maxdepth 2 -name plugin.json -path '*/.claude-plugin/*'` to enumerate plugin roots.
2. **Parallel dispatch** — for each plugin, dispatch a depth-2 subagent with a self-contained prompt naming the four skills and the plugin path. All dispatches in a single message with multiple `Agent` tool blocks.
3. **Aggregation** — collect each subagent's report. Each subagent returns a fixed-shape markdown block.
4. **Top-level summary table** — one row per plugin, four columns + status:
   ```
   | Plugin | Skills | Hooks | Agents | Commands | Status |
   ```
5. **Interactive fix phase** — for each `[FAIL]` across all plugins, use `AskUserQuestion` to propose a fix and ask whether to apply. Apply via `Edit` on `y`. Skip on `n`. `skip-all` short-circuits the loop.

### `.claude/agents/plugin-per-plugin-validator.md` (sub-agent)

Optional separate file to keep the per-plugin subagent prompt out of the orchestrator body. Alternatively, the orchestrator can use `general-purpose` subagents with a templated prompt. Plan task: decide based on prompt size.

**If separate:**
```yaml
---
name: plugin-per-plugin-validator
description: Validates one plugin (specified in dispatch prompt) by sequentially invoking validate-skills, validate-hooks, validate-agents, and validate-commands. Returns a markdown block with sections for each skill and a per-plugin tally. Spawned only by plugin-validator.
tools: Read, Glob, Grep, Bash, Skill
model: sonnet
---
```

Returns:
```markdown
### plugins/<name>
#### validate-skills    → PASS|FAIL (<n> checks, <f> failed)
<inline FAIL details>
#### validate-hooks     → PASS|FAIL
<inline FAIL details>
#### validate-agents    → PASS|FAIL
<inline FAIL details>
#### validate-commands  → PASS|FAIL
<inline FAIL details>
```

### `.claude/commands/validate-plugins.md`

**Frontmatter:**
```yaml
---
description: Validate every plugin under plugins/** via the plugin-validator agent.
---
```

**Body:** dispatches `plugin-validator` agent and surfaces its output. Minimal — no logic of its own.

## Scope & Exclusions

- **In scope:** Every `plugins/<name>/` directory containing `.claude-plugin/plugin.json`.
- **Vendored subtree exception:** `plugins/tech-graph/skills/tech-graph/` is vendored from upstream (per `CLAUDE.md`). Still validate, but mark proposed fixes as `not-applied (vendored)` and never edit.
- **Out of scope:** Anything outside `plugins/`.

## Report Format

```markdown
## Plugin Validation Report

### plugins/<name-1>
#### validate-skills    → PASS|FAIL
...

### plugins/<name-2>
...

## Summary

| Plugin | Skills | Hooks | Agents | Commands | Status |
|--------|--------|-------|--------|----------|--------|
| name-1 | PASS   | FAIL  | PASS   | PASS     | FAIL   |
| name-2 | PASS   | PASS  | PASS   | PASS     | PASS   |

## Fixes

<interactive prompts per FAIL>
```

## Open Questions (Resolve in Plan)

1. **Sub-agent file: one or two?** Should the per-plugin worker be its own file (`plugin-per-plugin-validator.md`) or inlined into the orchestrator's prompt as a `general-purpose` dispatch template? Plan task: decide based on prompt size and reuse value.
2. **Interactive fix mechanism.** `AskUserQuestion` supports up to 4 options per prompt. If a single plugin has more than 4 FAILs, batch via "next 4" or use sequential single-question prompts? Plan task: implement sequential per-FAIL prompt with `y/n/skip-all` as a 3-option question.
3. **Report truncation.** If a sub-skill produces a huge report (>200 lines), should the orchestrator inline it or summarize? Plan task: cap at 50 lines per sub-skill section; collapse rest under "... <N> more lines, run /validate-<skill> directly for full output".

## Risks

- **Depth-2 subagents cannot spawn further** — depth cap is enforced. If a sub-skill ever evolves to dispatch its own agents, the design breaks. Mitigation: skills are prose checklists; they do not dispatch agents.
- **Skill output drift** — if validate-* skills change their report shape, the aggregator parser breaks. Mitigation: aggregator parses by section header (`### plugins/...`), not by exact line shape.
- **Parallel skill registration** — multiple subagents loading the same Skill simultaneously is untested in Claude Code. Plan task: smoke-test with 3 plugins; if races appear, fall back to sequential per-plugin dispatch.
- **1Password SSH agent unavailable** during commit (observed on prior task). Out of band — affects only the commit step, not the design.

## Out of Scope (Future Work)

- CI integration via pre-commit hook or GitHub Action.
- HTML report rendering (could feed output into `html-effectiveness` plugin's report builder).
- Auto-fix mode that skips the per-FAIL confirmation.
- Cross-plugin checks (e.g. duplicate skill names across plugins).

## Resolutions

Resolved 2026-05-13 as part of Task 0 of the implementation plan.

### 0.1 — Sub-agent file count (Outcome A or B)

**Decision: Outcome A — inline dispatch. No separate `plugin-per-plugin-validator.md` file.**

Justification: the full per-plugin worker prompt was drafted and counted at approximately 50 lines (YAML frontmatter 6 lines, role/input/instructions 15 lines, report-shape spec 12 lines, skill pointers 5 lines, constraints 4 lines, blank separators 8 lines). This is below the 60-line threshold, so the added file maintenance cost of Outcome B is not warranted. The orchestrator will dispatch `general-purpose` subagents with a self-contained templated prompt inlined at dispatch time.

### 0.2 — Interactive fix prompt shape

**Decision: 3-option `AskUserQuestion` per FAIL, iterated sequentially.**

Exact option strings the orchestrator must use verbatim:

- Option 1: `Apply fix`
- Option 2: `Skip`
- Option 3: `Skip all remaining`

One question per FAIL finding. If the user selects `Skip all remaining`, the orchestrator exits the fix loop immediately without prompting for any further FAILs.

### 0.3 — Report truncation cap

**Decision: 50-line cap per sub-skill section.**

After 50 lines of output from any single validate-* skill invocation, the orchestrator collapses the remainder with the exact string:

```
... <N> more lines, run /validate-<skill> directly for full output
```

where `<N>` is the count of remaining lines and `<skill>` is the relevant skill name (e.g. `validate-skills`, `validate-hooks`, `validate-agents`, or `validate-commands`).
