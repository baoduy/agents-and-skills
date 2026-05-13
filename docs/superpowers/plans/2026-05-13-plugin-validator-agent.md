# Plugin Validator Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local-only `plugin-validator` agent and `/validate-plugins` slash command that fan out one parallel subagent per plugin, each running the four `validate-*` skills, then aggregate results with an interactive fix phase.

**Architecture:** Two markdown files under `.claude/` — one agent definition and one slash command wrapper. The agent body is the implementation; Claude reads it and orchestrates `Agent` tool dispatches at depth 2 (one per plugin). Per-plugin subagents run the four `Skill` calls sequentially and return a fixed-shape report block. The orchestrator aggregates, prints a summary table, then walks each `[FAIL]` with `AskUserQuestion` prompts.

**Tech Stack:** Markdown + YAML frontmatter. Claude Code `Agent` and `Skill` tools. No build step, no runtime code.

---

## File Structure

**Files to create:**
- `.claude/agents/plugin-validator.md` — orchestrator agent
- `.claude/commands/validate-plugins.md` — slash command wrapper

**Files conditionally created (resolved in Task 0):**
- `.claude/agents/plugin-per-plugin-validator.md` — only if Task 0.1 decides on a dedicated worker agent rather than inlined `general-purpose` dispatch.

**Files to read for reference (do not modify):**
- `.claude/skills/validate-skills/SKILL.md`
- `.claude/skills/validate-hooks/SKILL.md`
- `.claude/skills/validate-agents/SKILL.md`
- `.claude/skills/validate-commands/SKILL.md`
- `plugins/html-effectiveness/agents/report-builder.md` — example agent shape
- `plugins/team-superpower/agents/designer.md` — second example agent shape
- `plugins/html-effectiveness/commands/html-report.md` — example slash command

**Files NOT touched:**
- `plugins/**` — agent only reads + reports. Fix phase edits plugin files only on explicit user `y`, never by the plan.

---

## Task 0: Resolve Open Questions

The spec lists three open questions that affect file count and prompt design. Resolve before writing the agent body.

**Files:** Read `.claude/agents/` siblings if any exist, plus the four `validate-*` SKILL.md files. Append resolutions to the spec.

- [ ] **Step 0.1: Decide sub-agent file count**

Read all four `.claude/skills/validate-*/SKILL.md` files and measure the prompt size needed for a per-plugin worker (instruction list + report-shape spec + 4 Skill invocation pointers). Two outcomes:

- **Outcome A — Inline dispatch.** Orchestrator dispatches `general-purpose` subagents with a templated prompt. No separate agent file. Pro: single file. Con: orchestrator prompt grows.
- **Outcome B — Dedicated worker agent.** Create `.claude/agents/plugin-per-plugin-validator.md`. Orchestrator dispatches by `subagent_type`. Pro: orchestrator stays small, worker prompt is reusable. Con: two files to maintain.

Decide based on whether the per-plugin prompt exceeds 60 lines. Record the decision inline at the bottom of `docs/superpowers/specs/2026-05-13-plugin-validator-agent-design.md` under a new `## Resolutions` section.

- [ ] **Step 0.2: Pin interactive fix prompt shape**

`AskUserQuestion` supports up to 4 options. Decide the per-FAIL prompt shape. Default: 3-option question — `Apply fix`, `Skip`, `Skip all remaining`. Record this exact wording in the spec resolution.

- [ ] **Step 0.3: Pin report truncation cap**

Decide the per-sub-skill section cap. Default: 50 lines. After 50 lines, collapse with `... <N> more lines, run /validate-<skill> directly for full output`. Record in spec resolution.

- [ ] **Step 0.4: Commit resolutions**

```bash
git add docs/superpowers/specs/2026-05-13-plugin-validator-agent-design.md
git commit -m "docs(superpowers): resolve open questions in plugin-validator spec"
```

---

## Task 1: Per-plugin Worker Prompt (or Agent File)

Implement the worker per Task 0.1 outcome.

**If Outcome A (inline dispatch):** No new file. Skip to Task 2; the orchestrator inlines the worker prompt as a string literal.

**If Outcome B (dedicated agent file):**

**Files:**
- Create: `.claude/agents/plugin-per-plugin-validator.md`
- Reference: `plugins/html-effectiveness/agents/report-builder.md` for frontmatter shape

- [ ] **Step 1.1: Write frontmatter**

```yaml
---
name: plugin-per-plugin-validator
description: Use when the plugin-validator orchestrator dispatches a per-plugin validation worker. Sequentially runs the four validate-* skills against the assigned plugin and returns a fixed-shape markdown block. Not intended for direct invocation by humans.
tools: Read, Glob, Grep, Bash, Skill
model: sonnet
---
```

- [ ] **Step 1.2: Write body**

```markdown
# Plugin Per-Plugin Validator

You validate a single plugin. The orchestrator (plugin-validator agent) passes the plugin's path in its dispatch prompt.

## Input

The orchestrator's prompt includes:
- `PLUGIN_PATH` — absolute path to a plugin root (e.g. `/Users/.../plugins/html-effectiveness`)
- `PLUGIN_NAME` — basename of that path

## Workflow

1. Confirm `PLUGIN_PATH/.claude-plugin/plugin.json` exists. If not, return `BLOCKED` with reason "not a plugin root".
2. For each of the four skills below, invoke via the Skill tool with the plugin path scoped:
   - `validate-skills`
   - `validate-hooks`
   - `validate-agents`
   - `validate-commands`
3. Each skill produces a report block. Extract the per-section content under your plugin's header. Cap each section at 50 lines; append `... <N> more lines, run /validate-<skill> directly for full output` if truncated.
4. Compute pass/fail per skill: `PASS` if zero `[FAIL]` lines, else `FAIL`.
5. Return one markdown block (no other text):

```
### plugins/<PLUGIN_NAME>
#### validate-skills    → <PASS|FAIL> (<n_checks> checks, <n_fails> failed)
<inline FAIL details, max 50 lines>
#### validate-hooks     → <PASS|FAIL> (<n_checks>, <n_fails>)
<inline FAIL details>
#### validate-agents    → <PASS|FAIL> (<n_checks>, <n_fails>)
<inline FAIL details>
#### validate-commands  → <PASS|FAIL> (<n_checks>, <n_fails>)
<inline FAIL details>
```

## Constraints

- Do not spawn further subagents (depth-2 cap).
- Do not edit any plugin files.
- Do not prompt the user.
- If a Skill call fails, record `<skill> → ERROR: <reason>` in the block and continue with the remaining skills.
```

- [ ] **Step 1.3: Smoke test**

In a Claude Code session, dispatch this agent manually via `Agent(subagent_type='plugin-per-plugin-validator', prompt='PLUGIN_PATH=/Users/steven/_CODE/GIT/agents-and-skills/plugins/html-effectiveness, PLUGIN_NAME=html-effectiveness')`. Expected: returns one markdown block with four `####` sub-sections. Record output in plan smoke log under `Task 1.3 trace`.

- [ ] **Step 1.4: Commit**

```bash
git add .claude/agents/plugin-per-plugin-validator.md
git commit -m "feat(agents): add plugin-per-plugin-validator worker for plugin-validator"
```

---

## Task 2: Orchestrator Agent

**Files:**
- Create: `.claude/agents/plugin-validator.md`

- [ ] **Step 2.1: Write frontmatter**

```yaml
---
name: plugin-validator
description: Use when the user wants to validate every plugin under plugins/** at once. Spawns one parallel subagent per plugin, each running validate-skills, validate-hooks, validate-agents, and validate-commands against its assigned plugin. Aggregates results into a per-plugin section plus a top-level summary table, then offers interactive fixes for each FAIL.
tools: Read, Glob, Grep, Bash, Agent, Edit, Write, AskUserQuestion
model: sonnet
---
```

- [ ] **Step 2.2: Write body — discovery section**

Append to the same file:

```markdown
# Plugin Validator

Orchestrates per-plugin validation. Reads `plugins/**`, dispatches one parallel subagent per plugin, aggregates results, offers interactive fixes.

## Discovery

```bash
find plugins -maxdepth 3 -name 'plugin.json' -path '*/.claude-plugin/*'
```

Each result yields a plugin root = the directory two levels above `plugin.json`. Build the list `PLUGINS = [{name, path}, ...]`.
```

- [ ] **Step 2.3: Write body — parallel dispatch section**

Append. Replace `<DISPATCH_BLOCK>` with the per-outcome dispatch shape from Task 0.1:

- **Outcome A** dispatch line: `Agent(subagent_type='general-purpose', prompt=<inlined-worker-prompt-string-with-PLUGIN_PATH-substituted>)`
- **Outcome B** dispatch line: `Agent(subagent_type='plugin-per-plugin-validator', prompt='PLUGIN_PATH=<path>, PLUGIN_NAME=<name>')`

```markdown
## Parallel Dispatch

Dispatch one subagent per plugin **in a single message** with multiple Agent tool blocks. This runs them in parallel. Example for two plugins:

<DISPATCH_BLOCK>

Wait for all subagents to complete. Each returns a markdown block. Collect them in plugin-name order for stable output.
```

- [ ] **Step 2.4: Write body — aggregation section**

Append:

```markdown
## Aggregation

After all subagents complete:

1. Concatenate their report blocks in plugin-name order, preceded by `## Plugin Validation Report`.
2. Parse each block's `→ PASS|FAIL` lines per sub-skill to populate the summary table.
3. Compute `Status` per plugin: `FAIL` if any sub-skill is `FAIL`, else `PASS`.
4. Emit summary:

   ```markdown
   ## Summary

   | Plugin | Skills | Hooks | Agents | Commands | Status |
   |--------|--------|-------|--------|----------|--------|
   | <name> | PASS   | FAIL  | PASS   | PASS     | FAIL   |
   ```

5. Final tally line: `<P>/<N> plugins pass.`
```

- [ ] **Step 2.5: Write body — interactive fix section**

Append. Replace `<FIX_PROMPT_WORDING>` with the Task 0.2 resolution (default: `Apply fix` / `Skip` / `Skip all remaining`):

```markdown
## Interactive Fix Phase

After the report and summary, walk each `[FAIL]` in plugin-name order. For each:

1. If the plugin lives under `plugins/tech-graph/skills/tech-graph/` or any path marked vendored in `CLAUDE.md`, print `not-applied (vendored)` and skip — do not prompt.
2. Otherwise, use AskUserQuestion with the question `Apply this fix?` and the options: <FIX_PROMPT_WORDING>.
3. Include the proposed fix as a unified-diff fenced block in the question's question text or the option labels (whichever the UI supports — labels are limited to short text, so put the diff in the question text).
4. On `Apply fix`: edit the file via the Edit tool. Confirm by re-reading the edited region.
5. On `Skip`: continue to next FAIL.
6. On `Skip all remaining`: terminate the loop and report `<N> fixes skipped by user choice`.

When the loop ends, emit a final `## Fix Summary` table:

| Plugin | Check | Action |
|--------|-------|--------|
| <name> | <check> | applied / skipped / not-applied (vendored) |
```

- [ ] **Step 2.6: Write body — constraints section**

Append:

```markdown
## Constraints

- Sub-agent dispatch is depth 2 (you are at depth 1). Do not let workers spawn further agents.
- Only edit plugin files during the fix phase, only on explicit user `Apply fix`.
- Never edit files under `plugins/tech-graph/skills/tech-graph/` — vendored subtree.
- If any worker returns BLOCKED or ERROR, surface it in the report and skip its row in the fix phase.

## References

- Sub-skills: `validate-skills`, `validate-hooks`, `validate-agents`, `validate-commands`
- Spec: `docs/superpowers/specs/2026-05-13-plugin-validator-agent-design.md`
- Plan: `docs/superpowers/plans/2026-05-13-plugin-validator-agent.md`
```

- [ ] **Step 2.7: Commit**

```bash
git add .claude/agents/plugin-validator.md
git commit -m "feat(agents): add plugin-validator orchestrator agent"
```

---

## Task 3: Slash Command Wrapper

**Files:**
- Create: `.claude/commands/validate-plugins.md`

- [ ] **Step 3.1: Write frontmatter**

```yaml
---
description: Validate every plugin under plugins/** via the plugin-validator agent.
---
```

- [ ] **Step 3.2: Write body**

Append:

```markdown
Dispatch the `plugin-validator` agent. Surface its full report (per-plugin sections + summary table) to the user. Then forward the interactive fix prompts to the user one at a time, applying edits on `Apply fix` and updating the fix-summary table at the end.

Do not perform any validation logic yourself — defer entirely to the agent.
```

- [ ] **Step 3.3: Commit**

```bash
git add .claude/commands/validate-plugins.md
git commit -m "feat(commands): add /validate-plugins slash command"
```

---

## Task 4: End-to-end Smoke Test

**Files:** No new files. Verification only.

- [ ] **Step 4.1: Verify discovery**

```bash
ls .claude/agents/ .claude/commands/
```

Expected output contains: `plugin-validator.md`, `validate-plugins.md`, plus (if Outcome B from Task 0.1) `plugin-per-plugin-validator.md`.

- [ ] **Step 4.2: Invoke /validate-plugins**

In a Claude Code session, type `/validate-plugins`. Expected:

1. Discovery emits 3 plugins: `html-effectiveness`, `team-superpower`, `tech-graph`.
2. 3 parallel `Agent` tool calls dispatched in one message.
3. 3 markdown blocks returned, each with 4 sub-skill sub-sections.
4. Aggregate report printed with summary table.
5. Fix phase walks each FAIL with `Apply fix` / `Skip` / `Skip all remaining` prompts.

Record the observed report (top-line summary table + first three FAIL prompts) in the plan's "Smoke Test Log" section at the bottom.

- [ ] **Step 4.3: Verify fix-phase guardrails**

When the fix loop reaches a FAIL inside `plugins/tech-graph/skills/tech-graph/`, expected output: `not-applied (vendored)` with no prompt.

If a FAIL is offered in the prompt and user selects `Skip all remaining`, expected: loop terminates immediately and final fix-summary table reports the remaining FAILs as `skipped`.

- [ ] **Step 4.4: No commit needed** — verification only.

---

## Smoke Test Log

```
Task 1.3 trace:
  N/A — Task 0.1 resolved to Outcome A (inline dispatch). No separate
  plugin-per-plugin-validator.md file exists. Worker prompt is inlined in
  the orchestrator body under "Inlined Worker Prompt Template".

Task 4.1 file presence:
  $ ls .claude/agents/ .claude/commands/
  plugin-validator.md   (agents)
  validate-plugins.md   (commands)
  Both present.

Task 4.2 discovery cmd:
  $ find plugins -maxdepth 3 -name 'plugin.json' -path '*/.claude-plugin/*'
  plugins/tech-graph/.claude-plugin/plugin.json
  plugins/html-effectiveness/.claude-plugin/plugin.json
  plugins/team-superpower/.claude-plugin/plugin.json
  → 3 plugins, as expected.

  Note: the local RTK shell shim strips the `-path` flag from bash `find`.
  Agent body now uses the Glob tool (`plugins/*/.claude-plugin/plugin.json`)
  instead of `find`, which sidesteps the shim. Bash fallback documented in
  agent body for clarity.

Task 4.2 worker smoke (single plugin, dispatched via general-purpose
because the new plugin-validator agent is not yet in the live registry):
  Target: plugins/html-effectiveness
  Result: worker ran validate-skills but did NOT run the other three skills
  and returned the skill's own report header (`**Validation Results**`)
  instead of the prescribed `### Plugin: html-effectiveness` block.
  Action taken: tightened worker prompt in agent body (Step 2 now states
  "You MUST invoke all four skills before returning" plus an explicit
  "do not echo the skill's own header" instruction). Full end-to-end test
  with the production orchestrator pending a session reload that
  registers the plugin-validator agent name.

Task 4.3 vendored handling:
  Encoded in agent body (Interactive Fix Phase, step 1, lines 174–180).
  Live trigger pending Task 4.2 full e2e.

Task 4.3 skip-all behavior:
  Encoded in agent body (Interactive Fix Phase, step 5, line 193).
  Live trigger pending Task 4.2 full e2e.
```

---

## Self-Review

**Spec coverage**

- Two-file local-only design (`.claude/agents/` + `.claude/commands/`) → Tasks 2 + 3 ✓
- Optional third file resolved in Task 0.1 → Task 1 conditional on outcome ✓
- Parallel dispatch model (depth 1 → depth 2, no further) → Task 2.3 + 2.6 constraint ✓
- Per-plugin report shape (4 sub-skill sub-sections + tally) → Task 1.2 (or inline in 2.3 per Outcome A) ✓
- Top-level summary table → Task 2.4 ✓
- Interactive fix phase with `AskUserQuestion` → Task 2.5 ✓
- Vendored subtree exception (`plugins/tech-graph/skills/tech-graph/`) → Task 2.5 + 4.3 ✓
- Open Question 1 (sub-agent file count) → Task 0.1 ✓
- Open Question 2 (interactive fix mechanism) → Task 0.2 ✓
- Open Question 3 (report truncation cap) → Task 0.3 ✓
- Risks (depth cap, skill output drift, parallel skill registration, signing) → addressed via Task 2.6 constraints + Task 4 smoke test ✓
- Non-goals (no replacing sub-skills, no auto-fix without consent, no marketplace publish) → preserved; no task adds those ✓

**Placeholder scan**

- `<DISPATCH_BLOCK>`, `<FIX_PROMPT_WORDING>`, `<fill in>` are intentional substitutions resolved by prerequisite tasks. Not bad-style placeholders.
- No "TBD", "TODO", "fill in details", "handle edge cases" appear in any step body.

**Type/name consistency**

- Agent names: `plugin-validator` and `plugin-per-plugin-validator` — used consistently in frontmatter `name:`, dispatch prompts, and file paths.
- Slash command: `/validate-plugins` — matches filename `validate-plugins.md` (drop `.md`, prefix with `/`).
- Report header shape: `### plugins/<name>` then `#### <skill-name> → PASS|FAIL` — consistent across Task 1.2 (worker) and Task 2.4 (orchestrator parses by this shape).
- Tally line shape: `<P>/<N> plugins pass.` and `<P> pass, <F> fail.` — single canonical form used in summary.

No issues found.
