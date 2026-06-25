# codegraph-setup Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the codegraph-setup skill to install MCP config project-locally and auto-detect the AI tool.

**Architecture:** Single-file edit — two spots in `plugins/team-share/skills/codegraph-setup/SKILL.md`. No new files.

**Tech Stack:** Bash, codegraph CLI.

## Global Constraints

- Edit only files inside `plugins/team-share/` — no manifest or README changes.
- Do not add `skills[]` to `plugin.json` (auto-discovered).
- Run `/validate-skills` and `plugin-validator` agent after the edit before committing.

---

### Task 1: Update SKILL.md — frontmatter + Step 3

**Files:**
- Modify: `plugins/team-share/skills/codegraph-setup/SKILL.md`

**Interfaces:**
- Consumes: nothing
- Produces: updated SKILL.md with new `description:` and new Step 3 command

- [ ] **Step 1: Edit the frontmatter `description:`**

In `plugins/team-share/skills/codegraph-setup/SKILL.md`, change line 3 from:

```
description: Install the CodeGraph CLI, wire it to Claude Code via MCP (codegraph install), and initialise the current project (codegraph init). Works on macOS, Linux, and Windows (Git Bash / PowerShell). Idempotent — skips install if codegraph is already in PATH.
```

to:

```
description: Install the CodeGraph CLI, wire it to the local project via MCP (codegraph install --target=auto --location=local), and initialise the current project (codegraph init). Works on macOS, Linux, and Windows (Git Bash / PowerShell). Idempotent — skips install if codegraph is already in PATH.
```

- [ ] **Step 2: Edit Step 3 prose**

Change the paragraph under `## Step 3 — Wire to Claude Code` from:

```
Register the CodeGraph MCP server with Claude Code:
```

to:

```
Register the CodeGraph MCP server for this project (auto-detects AI tool; config written to project-local settings):
```

- [ ] **Step 3: Edit Step 3 command**

Change the code block from:

```bash
codegraph install
```

to:

```bash
codegraph install --target=auto --location=local
```

- [ ] **Step 4: Verify the file looks correct**

Run:
```bash
grep -n "codegraph install" plugins/team-share/skills/codegraph-setup/SKILL.md
```

Expected output (two hits — description and command block):
```
3:description: Install the CodeGraph CLI, wire it to the local project via MCP (codegraph install --target=auto --location=local)...
62:codegraph install --target=auto --location=local
```

- [ ] **Step 5: Run validate-skills**

In Claude Code, run:
```
/validate-skills
```

Expected: `[PASS]` for `codegraph-setup`. Fix any `[FAIL]` items before continuing.

- [ ] **Step 6: Run plugin-validator**

In Claude Code, run the `plugin-validator:plugin-validator` agent against `plugins/team-share/`. Fix any `[FAIL]` items before continuing.

- [ ] **Step 7: Commit**

```bash
git add plugins/team-share/skills/codegraph-setup/SKILL.md
git commit -m "feat(team-share): use --target=auto --location=local for codegraph install"
```
