# codegraph-setup Enhancement Design

**Date:** 2026-06-25  
**Scope:** `plugins/team-share/skills/codegraph-setup/SKILL.md`

## Goal

Use project-local MCP installation and auto-detect the AI tool rather than assuming Claude Code.

## Changes

### 1. Frontmatter `description:`

Change from:
> Install the CodeGraph CLI, wire it to Claude Code via MCP (codegraph install), and initialise the current project (codegraph init). Works on macOS, Linux, and Windows (Git Bash / PowerShell). Idempotent — skips install if codegraph is already in PATH.

Change to:
> Install the CodeGraph CLI, wire it to the local project via MCP (codegraph install --target=auto --location=local), and initialise the current project (codegraph init). Works on macOS, Linux, and Windows (Git Bash / PowerShell). Idempotent — skips install if codegraph is already in PATH.

### 2. Step 3 — command and prose

Command: `codegraph install` → `codegraph install --target=auto --location=local`

Prose: "Register the CodeGraph MCP server with Claude Code" → "Register the CodeGraph MCP server for this project (auto-detects AI tool; config written to project-local settings)."

## Why

- `--target=auto` makes the skill AI-tool-agnostic (works with Cursor, Windsurf, etc., not just Claude Code).
- `--location=local` writes MCP config to the project's `.claude/settings.json` instead of the user's global config — better for team repos where the wiring should travel with the code.
