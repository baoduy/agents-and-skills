# Plugin Validation Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three sibling skills (`validate-hooks`, `validate-agents`, `validate-commands`) under `.claude/skills/` that mirror the existing `validate-skills` pattern and catch malformed plugin assets in `plugins/**` before install.

**Architecture:** Each skill is a single `SKILL.md` file containing frontmatter + checklist tables + "How to run" instructions. The skill body IS the implementation — Claude reads it and performs the validation. No runtime code is shipped. Smoke testing means running `/validate-<x>` against the live `plugins/` tree and confirming it flags the known-broken `team-superpower` plugin while passing the known-clean `html-effectiveness` plugin.

**Tech Stack:** Markdown + YAML frontmatter. No build step, no test framework, no dependencies. The validate-skills skill at `.claude/skills/validate-skills/SKILL.md` is the canonical template.

---

## File Structure

**Files to create:**
- `.claude/skills/validate-hooks/SKILL.md` — checklist + workflow for hooks validation
- `.claude/skills/validate-agents/SKILL.md` — checklist + workflow for agents validation
- `.claude/skills/validate-commands/SKILL.md` — checklist + workflow for commands validation

**Files to read for reference (do not modify):**
- `.claude/skills/validate-skills/SKILL.md` — template to mirror
- `plugins/team-superpower/.claude-plugin/plugin.json` — known-broken fixture
- `plugins/team-superpower/hooks/hooks.json` — concrete hook JSON to spot-check rules against
- `plugins/html-effectiveness/.claude-plugin/plugin.json` — known-clean reference
- `plugins/html-effectiveness/agents/report-builder.md` — known-clean agent
- `plugins/html-effectiveness/commands/html-report.md` — known-clean command

**Files NOT touched:**
- `plugins/team-superpower/**` — fixing that plugin is out of scope; validators only flag, they do not auto-fix.

---

## Task 0: Resolve Open Questions

The spec lists two open questions that must be resolved before writing rule tables. Resolution lives in the plan, not the skill bodies.

**Files:**
- Read: Claude Code plugin documentation via Context7 or web; `plugins/team-superpower/hooks/hooks.json` for example shape.

- [ ] **Step 0.1: Resolve hooks field shape**

Fetch the current Claude Code plugin spec for the `hooks` field. Use Context7:

```
mcp__claude_ai_Context7__resolve-library-id with libraryName: "claude code plugins"
mcp__claude_ai_Context7__query-docs with the resolved id and topic: "plugin manifest hooks field schema"
```

If Context7 has no entry, fall back to:

```
WebFetch https://docs.claude.com/en/docs/claude-code/plugins.md
```

Record one of two outcomes in this plan as inline note:
- **Outcome A:** Loader accepts string path → rule for `validate-hooks` is "string path acceptable; verify file exists and parses as JSON"
- **Outcome B:** Loader requires inline object → rule is "string path is `[FAIL]`; manifest must inline the hooks object"

Update Task 1 below to match outcome before starting Task 1.

- [ ] **Step 0.2: Identify authoritative tool name list**

Find the canonical list of valid tool names (`Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`, etc.) used in `tools` / `allowed-tools` frontmatter.

```
WebFetch https://docs.claude.com/en/docs/claude-code/sub-agents.md
WebFetch https://docs.claude.com/en/docs/claude-code/slash-commands.md
```

Inline the resulting list into Task 2 and Task 3 rule tables. If the list is unstable, the skill body should state "valid tool names per current Claude Code docs" and link the URL rather than enumerate.

- [ ] **Step 0.3: Commit investigation notes**

Append resolutions to the spec file (not the plan — spec is the source of truth):

```bash
git add docs/superpowers/specs/2026-05-13-plugin-validation-skills-design.md
git commit -m "docs(superpowers): resolve open questions in plugin-validation spec"
```

---

## Task 1: validate-hooks Skill

**Files:**
- Create: `.claude/skills/validate-hooks/SKILL.md`
- Reference: `.claude/skills/validate-skills/SKILL.md` (template), `plugins/team-superpower/hooks/hooks.json`, `plugins/team-superpower/.claude-plugin/plugin.json`

- [ ] **Step 1.1: Write SKILL.md frontmatter**

Create `.claude/skills/validate-hooks/SKILL.md` starting with this exact frontmatter:

```yaml
---
name: validate-hooks
description: Validates plugin hooks (plugin.json hooks field and any referenced hooks.json) in plugins/** against the Claude Code plugin spec. Use via /validate-hooks command.
license: MIT
metadata:
  author: Steven Hoang
  tags: validation, linting, plugin-authoring, hooks
---
```

- [ ] **Step 1.2: Write body — title + intro**

Append to the same file:

```markdown
# Validate Hooks

Validate plugin hooks under `plugins/**` against the Claude Code plugin spec. Scope: `plugins/**` only — local-only `.claude/skills/` and `.claude/hooks/` are out of scope.

## Discovery

```bash
find plugins -name 'hooks.json'
find plugins -name 'plugin.json' -path '*/.claude-plugin/*'
```

Parse each `plugin.json`; if its `hooks` field is an inline object, validate inline. If it is a string path, resolve and load the JSON file at that path.
```

- [ ] **Step 1.3: Write body — spec checklist**

Append the spec rules table. Replace `<OUTCOME>` below with the resolution from Task 0.1.

```markdown
## Spec Compliance Checks

| Check | Rule |
|-------|------|
| `hooks` field shape | <OUTCOME from Task 0.1> |
| Top-level event keys | One of: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `Notification`, `PreCompact`, `SessionStart`, `SessionEnd` |
| Event value | Array of matcher groups |
| Matcher group shape | `{ matcher: string, hooks: [...] }` |
| Hook entry shape | `{ type: "command"\|"prompt", command?: string, prompt?: string, timeout?: integer }` |
| Command path resolves | Resolves relative to plugin root, or uses `${CLAUDE_PROJECT_DIR}` / `${CLAUDE_PLUGIN_ROOT}` |
| Executable bit | Referenced shell script has `+x` |
| Regex compiles | Matcher value compiles as a Python `re` pattern |
```

- [ ] **Step 1.4: Write body — best-practice checklist**

Append:

```markdown
## Best-Practice Checks

| Check | Rule |
|-------|------|
| No absolute user paths | Body of command does not contain `/Users/<name>/...` or `/home/<name>/...` |
| Timeout sane | `timeout` ≤ 60 unless inline comment justifies |
| Prompt-type targets exist | `prompt`-type hooks reference skills or commands that exist on disk |
```

- [ ] **Step 1.5: Write body — How to Run**

Append:

```markdown
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
- Sibling skills: `validate-skills`, `validate-agents`, `validate-commands`
```

- [ ] **Step 1.6: Smoke test — failure path**

Invoke the skill (after registering it via `/plugin marketplace add file://$(pwd)` then reload) by running `/validate-hooks` in Claude Code. Expected output must include at least one `[FAIL]` for `plugins/team-superpower/.claude-plugin/plugin.json` (because its `hooks` field is a string path and/or other shape violation per Task 0.1 outcome).

Document the observed output as a fenced block in this plan's "Smoke Test Log" section at the bottom. If output lacks the expected fail, edit the SKILL.md to tighten rules and re-run.

- [ ] **Step 1.7: Smoke test — pass path**

Run `/validate-hooks` again with focus on `plugins/html-effectiveness` (no `hooks` field). Expected: skill notes "no hooks declared" and skips cleanly — no false positives.

- [ ] **Step 1.8: Commit**

```bash
git add .claude/skills/validate-hooks/SKILL.md docs/superpowers/plans/2026-05-13-plugin-validation-skills.md
git commit -m "feat(skills): add validate-hooks skill for plugin authoring"
```

---

## Task 2: validate-agents Skill

**Files:**
- Create: `.claude/skills/validate-agents/SKILL.md`
- Reference: `.claude/skills/validate-skills/SKILL.md`, `plugins/team-superpower/agents/*.md`, `plugins/html-effectiveness/agents/report-builder.md`

- [ ] **Step 2.1: Write SKILL.md frontmatter**

Create `.claude/skills/validate-agents/SKILL.md`:

```yaml
---
name: validate-agents
description: Validates plugin agents (any .md file under plugins/**/agents/) against the Claude Code subagent spec. Use via /validate-agents command.
license: MIT
metadata:
  author: Steven Hoang
  tags: validation, linting, plugin-authoring, agents
---
```

- [ ] **Step 2.2: Write body — intro + discovery**

Append:

```markdown
# Validate Agents

Validate plugin agents under `plugins/**/agents/*.md` against the Claude Code subagent spec. Scope: `plugins/**` only.

## Discovery

```bash
find plugins -path '*/agents/*.md'
```
```

- [ ] **Step 2.3: Write body — spec checklist**

Append. Replace `<TOOL_LIST_SOURCE>` with the resolution from Task 0.2.

```markdown
## Spec Compliance Checks

| Check | Rule |
|-------|------|
| YAML frontmatter | Present and parses |
| `name` format | 1-64 chars, lowercase alphanumeric + hyphens; no leading/trailing/consecutive hyphens |
| `name` matches filename | `agents/foo.md` → `name: foo` |
| `description` length | 1-1024 chars, non-empty |
| `tools` optional | Comma-separated string; each name appears in <TOOL_LIST_SOURCE> |
| `model` optional | One of `sonnet`, `opus`, `haiku`, `inherit` |
| Manifest reference | If plugin.json `agents` array lists this file, the path must resolve |
```

- [ ] **Step 2.4: Write body — best-practice checklist**

Append:

```markdown
## Best-Practice Checks

| Check | Rule |
|-------|------|
| Third-person description | Description does not begin with "I " or use "I will" / "I'll" |
| When-to-invoke trigger | Description states when to invoke (heuristic: contains "Use when", "When the user", or "Trigger") |
| Body length | Body (post-frontmatter) under 500 lines |
| No first-person body | Body does not contain "I will" / "I'll" as a leading clause |
| Behavior section | Body has at least one of: `## Output`, `## Behavior`, `## Workflow`, `## How to Run` |
```

- [ ] **Step 2.5: Write body — How to Run + References**

Append:

```markdown
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

- [Claude Code subagent docs](https://docs.claude.com/en/docs/claude-code/sub-agents.md)
- Sibling skills: `validate-skills`, `validate-hooks`, `validate-commands`
```

- [ ] **Step 2.6: Smoke test — failure path**

Run `/validate-agents`. Expected: at least one `[FAIL]` on a `plugins/team-superpower/agents/*.md` file (per the install-time validation error).

If team-superpower agent files are actually structurally clean (the error may have been manifest-level), the failure path test should still exercise a deliberately-broken fixture. In that case, create `plugins/team-superpower/agents/_test-broken.md.fixture` (note the `.fixture` extension — outside discovery glob) and instead inline-document expected behavior in the smoke log.

- [ ] **Step 2.7: Smoke test — pass path**

Run `/validate-agents` and confirm `plugins/html-effectiveness/agents/report-builder.md` reports all `[PASS]`.

- [ ] **Step 2.8: Commit**

```bash
git add .claude/skills/validate-agents/SKILL.md
git commit -m "feat(skills): add validate-agents skill for plugin authoring"
```

---

## Task 3: validate-commands Skill

**Files:**
- Create: `.claude/skills/validate-commands/SKILL.md`
- Reference: `.claude/skills/validate-skills/SKILL.md`, `plugins/team-superpower/commands/*.md`, `plugins/html-effectiveness/commands/html-report.md`

- [ ] **Step 3.1: Write SKILL.md frontmatter**

Create `.claude/skills/validate-commands/SKILL.md`:

```yaml
---
name: validate-commands
description: Validates plugin slash commands (any .md file under plugins/**/commands/) against the Claude Code slash-command spec. Use via /validate-commands command.
license: MIT
metadata:
  author: Steven Hoang
  tags: validation, linting, plugin-authoring, commands
---
```

- [ ] **Step 3.2: Write body — intro + discovery**

Append:

```markdown
# Validate Commands

Validate plugin slash commands under `plugins/**/commands/*.md` against the Claude Code slash-command spec. Scope: `plugins/**` only.

## Discovery

```bash
find plugins -path '*/commands/*.md'
```
```

- [ ] **Step 3.3: Write body — spec checklist**

Append. Reuse `<TOOL_LIST_SOURCE>` from Task 0.2.

```markdown
## Spec Compliance Checks

| Check | Rule |
|-------|------|
| Frontmatter optional | If present, must parse |
| `description` length | 1-1024 chars when present |
| `allowed-tools` optional | Comma-separated string; each name appears in <TOOL_LIST_SOURCE> |
| `argument-hint` optional | Plain string |
| `model` optional | One of `sonnet`, `opus`, `haiku`, `inherit` |
| Filename → command | Filename minus `.md` is lowercase alphanumeric + hyphens; produces `/<filename>` |
| Body non-empty | At least one non-blank line after frontmatter |
| Manifest reference | If plugin.json `commands` array lists this file, the path must resolve |
```

- [ ] **Step 3.4: Write body — best-practice checklist**

Append:

```markdown
## Best-Practice Checks

| Check | Rule |
|-------|------|
| `argument-hint` when needed | If body contains `$ARGUMENTS` or `$1`/`$2` etc., frontmatter must set `argument-hint` |
| Expected output documented | Body describes what the command produces (heuristic: contains `## Output`, `## Result`, or "produces" / "writes") |
| No broken skill refs | Body references to other skills via `superpowers:` or `Skill(...)` resolve to skills installed in this repo (best-effort) |
```

- [ ] **Step 3.5: Write body — How to Run + References**

Append:

```markdown
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

- [Claude Code slash-command docs](https://docs.claude.com/en/docs/claude-code/slash-commands.md)
- Sibling skills: `validate-skills`, `validate-hooks`, `validate-agents`
```

- [ ] **Step 3.6: Smoke test — failure path**

Run `/validate-commands`. Expected: at least one `[FAIL]` on a `plugins/team-superpower/commands/*.md` file related to the install error. If all team-superpower commands are clean (error may have been manifest-shape only), document that in the smoke log and proceed — the failure surface is captured by validate-hooks already.

- [ ] **Step 3.7: Smoke test — pass path**

Run `/validate-commands` and confirm `plugins/html-effectiveness/commands/html-report.md` reports all `[PASS]`.

- [ ] **Step 3.8: Commit**

```bash
git add .claude/skills/validate-commands/SKILL.md
git commit -m "feat(skills): add validate-commands skill for plugin authoring"
```

---

## Task 4: Wire up slash-command discovery

The three new skills need to be invokable. Claude Code auto-discovers `.claude/skills/*/SKILL.md` — no marketplace registration needed for local use. Verify discovery worked.

**Files:**
- Read-only verification of `.claude/skills/`.

- [ ] **Step 4.1: List local skills**

```bash
ls .claude/skills/
```

Expected output contains: `validate-skills`, `validate-hooks`, `validate-agents`, `validate-commands`, plus any pre-existing entries.

- [ ] **Step 4.2: Verify invocation**

In a Claude Code session, type `/validate-hooks`. Expected: skill body is loaded and the workflow runs. Repeat for `/validate-agents` and `/validate-commands`.

If a skill is not discoverable, check that `SKILL.md` has a complete frontmatter block and `name:` matches the directory name (per `validate-skills` rules).

- [ ] **Step 4.3: No commit needed** — Task 4 is verification only.

---

## Smoke Test Log

(Populate during Task 1.6, 1.7, 2.6, 2.7, 3.6, 3.7. Each entry: command run, observed output excerpt, action taken if mismatch.)

```
Task 1.6: <fill in>
Task 1.7: <fill in>
Task 2.6: <fill in>
Task 2.7: <fill in>
Task 3.6: <fill in>
Task 3.7: <fill in>
```

---

## Self-Review

**Spec coverage**

- Skills location → Task 1.1, 2.1, 3.1 ✓
- Discovery commands → Task 1.2, 2.2, 3.2 ✓
- Spec checklists per skill → Task 1.3, 2.3, 3.3 ✓
- Best-practice checklists per skill → Task 1.4, 2.4, 3.4 ✓
- Report format → Task 1.5, 2.5, 3.5 ✓
- Open question 1 (hooks field shape) → Task 0.1 ✓
- Open question 2 (tool name list) → Task 0.2 ✓
- Scope: `plugins/**` only → declared at top of each SKILL.md ✓
- Risks (tool list drift, hooks schema change, static-only) → addressed via reference URLs in skill bodies ✓
- Non-goals (fixing team-superpower, aggregator, runtime checks, marketplace publish) → preserved; no task fixes team-superpower ✓

**Placeholder scan**

- `<OUTCOME from Task 0.1>` and `<TOOL_LIST_SOURCE>` are intentional substitutions, resolved by Task 0 before downstream tasks begin. Not placeholders in the bad sense — they are inputs from a prerequisite task.
- Smoke Test Log section uses `<fill in>` as a placeholder by design (runtime data).

**Type/name consistency**

- Skill names: `validate-hooks`, `validate-agents`, `validate-commands` — used consistently across plan, frontmatter `name:`, directory names, and `/validate-*` commands ✓
- Report header shape `### plugins/<plugin>/<path>` — consistent across all three skills ✓
- Tally line shape `Summary: <N> ... scanned. <P> pass, <F> fail.` — consistent ✓

No issues found.
