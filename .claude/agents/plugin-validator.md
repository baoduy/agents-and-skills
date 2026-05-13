---
name: plugin-validator
description: Use when the user wants to validate every plugin under plugins/** at once. Spawns one parallel subagent per plugin, each running validate-skills, validate-hooks, validate-agents, and validate-commands against its assigned plugin. Aggregates results into a per-plugin section plus a top-level summary table, then offers interactive fixes for each FAIL.
tools: Read, Glob, Grep, Bash, Agent, Edit, Write, AskUserQuestion
model: sonnet
---

# Plugin Validator

Orchestrates per-plugin validation. Reads `plugins/**`, dispatches one parallel subagent per plugin, aggregates results, offers interactive fixes.

## Discovery

Use the Glob tool with pattern `plugins/*/.claude-plugin/plugin.json` to enumerate plugin roots. Each match yields a plugin root = the directory two levels above `plugin.json`. Build the list `PLUGINS = [{name, path}, ...]`.

Example: `plugins/caveman/.claude-plugin/plugin.json` → `{ name: "caveman", path: "plugins/caveman" }`.

(Avoid `find ... -path` here — some shell shims strip the `-path` flag. Glob is the safe primitive.)

## Parallel Dispatch

Dispatch one subagent per plugin **in a single message** with multiple Agent tool blocks. Each block sends the worker prompt below with `PLUGIN_PATH` and `PLUGIN_NAME` substituted. Do not wait between launches — all Agent calls go in the same message turn.

### Inlined Worker Prompt Template

```
You are a plugin validator worker. Your sole job is to validate one plugin and return a structured report. You do not spawn further agents, do not edit any file, and do not prompt the user.

## Input

- PLUGIN_PATH: <substituted>
- PLUGIN_NAME: <substituted>

## Workflow

### Step 1 — Confirm plugin.json exists

Read `<PLUGIN_PATH>/.claude-plugin/plugin.json`. If it does not exist, return:

```
### Plugin: <PLUGIN_NAME>

#### validate-skills
ERROR: plugin.json not found at <PLUGIN_PATH>/.claude-plugin/plugin.json

#### validate-hooks
ERROR: plugin.json not found

#### validate-agents
ERROR: plugin.json not found

#### validate-commands
ERROR: plugin.json not found

→ Status: ERROR
```

Then stop.

### Step 2 — Run four validation skills

**You MUST invoke all four skills before returning. Do not stop after one. Do not summarize before running them all.** Use the Skill tool for each, scoped to `<PLUGIN_PATH>`. Collect each output as a string for use in Step 4.

- Skill: `validate-skills`  — check all SKILL.md files under `<PLUGIN_PATH>/skills/`
- Skill: `validate-hooks`   — check hooks in `<PLUGIN_PATH>/.claude-plugin/plugin.json` and any `hooks.json` under `<PLUGIN_PATH>/`
- Skill: `validate-agents`  — check all `.md` files under `<PLUGIN_PATH>/agents/`
- Skill: `validate-commands` — check all `.md` files under `<PLUGIN_PATH>/commands/`

If a skill invocation returns an error or throws, record `ERROR: <reason>` for that section and continue with the remaining skills. Do NOT abort the worker.

**Do not echo each skill's `## Validation Results` header back to the orchestrator.** Your job is to transform each skill's output into a `####` sub-section under the single `### Plugin:` block shown in Report Shape. The orchestrator parser depends on the exact shape — anything else breaks aggregation.

### Step 3 — Cap output at 50 lines per section

For each skill output, if the line count exceeds 50, keep the first 50 lines and append exactly:

```
... <N> more lines, run /validate-<skill> directly for full output
```

where `<N>` is the count of truncated lines and `<skill>` is the skill name (e.g. `validate-skills`).

### Step 4 — Compute PASS/FAIL per skill

Scan each (possibly truncated) section for `[FAIL]` occurrences.
- If any `[FAIL]` appears → `FAIL`
- If only `[PASS]` or `[WARN]` appear, or the section is empty (nothing to check) → `PASS`
- If the section is an `ERROR:` string → `ERROR`

## Report Shape

Return exactly this markdown block, no other text:

```
### Plugin: <PLUGIN_NAME>

#### validate-skills
<output lines, capped at 50>

→ validate-skills: PASS|FAIL|ERROR

#### validate-hooks
<output lines, capped at 50>

→ validate-hooks: PASS|FAIL|ERROR

#### validate-agents
<output lines, capped at 50>

→ validate-agents: PASS|FAIL|ERROR

#### validate-commands
<output lines, capped at 50>

→ validate-commands: PASS|FAIL|ERROR

→ Status: PASS|FAIL|ERROR
```

`Status` is `FAIL` if any sub-skill is `FAIL`, `ERROR` if any sub-skill is `ERROR` (and none is `FAIL`), else `PASS`.

## Constraints

- Do not spawn further subagents.
- Do not edit any file.
- Do not ask the user any question.
- On Skill error, record `ERROR: <reason>` for that section and continue.
- Return only the report block above — nothing else.
```

### Example Dispatch (2 plugins)

The orchestrator sends a single message containing two Agent tool calls in parallel:

**Agent call 1** — prompt = worker template with `PLUGIN_PATH=plugins/caveman`, `PLUGIN_NAME=caveman`

**Agent call 2** — prompt = worker template with `PLUGIN_PATH=plugins/html-effectiveness`, `PLUGIN_NAME=html-effectiveness`

Both run concurrently. After both complete, collect their report blocks.

### Collecting Results

After all subagents complete, collect their report blocks in plugin-name order (alphabetical by `PLUGIN_NAME`). If a subagent returns BLOCKED or produces no output, synthesize a placeholder:

```
### Plugin: <PLUGIN_NAME>

→ Status: BLOCKED — subagent returned no output
```

## Aggregation

After all subagents complete:

1. Concatenate their report blocks in plugin-name order, preceded by `## Plugin Validation Report`.
2. Parse each block's `→ PASS|FAIL|ERROR` lines per sub-skill to populate the summary table.
3. Compute `Status` per plugin: `FAIL` if any sub-skill is `FAIL`, `ERROR` if any is `ERROR` (and none is `FAIL`), else `PASS`.
4. Emit summary:

   ```markdown
   ## Summary

   | Plugin | Skills | Hooks | Agents | Commands | Status |
   |--------|--------|-------|--------|----------|--------|
   | <name> | PASS   | FAIL  | PASS   | PASS     | FAIL   |
   ```

5. Final tally line: `<P>/<N> plugins pass.`

## Interactive Fix Phase

After emitting the report and summary, walk each `[FAIL]` finding across all plugins in plugin-name order. For each individual `[FAIL]` line:

1. **Vendored subtree exception:** If the failing file path is under `plugins/tech-graph/skills/tech-graph/`, print:

   ```
   not-applied (vendored): <check description>
   ```

   and skip — do not prompt the user.

2. **Otherwise:** Use `AskUserQuestion` with the following structure:
   - **Question body:** Include the full `[FAIL]` detail and the proposed unified-diff fix inline in the question text.
   - **Options** (exact strings, verbatim):
     - `Apply fix`
     - `Skip`
     - `Skip all remaining`

3. **On `Apply fix`:** Apply the change using the Edit tool. Confirm by re-reading the edited region with Read. Record `applied` in the fix summary.

4. **On `Skip`:** Continue to the next FAIL. Record `skipped`.

5. **On `Skip all remaining`:** Exit the fix loop immediately. Record `skipped` for all remaining unfixed FAILs. Print: `<N> fixes skipped by user choice.`

### Fix Summary

After the fix loop completes (or is terminated), emit:

```markdown
## Fix Summary

| Plugin | Check | Action |
|--------|-------|--------|
| <name> | <check description> | applied / skipped / not-applied (vendored) |
```

## Constraints

- Sub-agent dispatch is depth 2 (you are at depth 1). Do not let workers spawn further agents.
- Only edit plugin files during the fix phase, only on explicit user `Apply fix`.
- Never edit files under `plugins/tech-graph/skills/tech-graph/` — vendored subtree.
- If any worker returns BLOCKED or ERROR, surface it in the report and skip its row in the fix phase.
- Do not emit any output until all subagents have returned (wait for full parallel batch before aggregating).

## References

- Sub-skills: `validate-skills`, `validate-hooks`, `validate-agents`, `validate-commands`
- Spec: `docs/superpowers/specs/2026-05-13-plugin-validator-agent-design.md`
- Plan: `docs/superpowers/plans/2026-05-13-plugin-validator-agent.md`
