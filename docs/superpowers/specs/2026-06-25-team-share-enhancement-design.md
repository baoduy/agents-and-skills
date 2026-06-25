# team-share Enhancement — Interactive Setup Menu

**Date:** 2026-06-25
**Status:** Approved

## Summary

Enhance the `team-share` plugin to present an interactive multi-select menu before any work begins. Users pick which setup actions to run; only those actions execute. Adds CodeGraph as a new first-class setup action alongside the existing Understand-Anything and Claude config flows. The existing monolithic agent is refactored into three independently-invocable skills, with the agent becoming a thin dispatcher.

---

## Goals

- User chooses setup actions before anything runs (no surprises).
- "Default" shortcut (CodeGraph + Claude config) is pre-selected for fast onboarding.
- Each action is independently invocable as a skill (e.g. `/codegraph-setup` standalone).
- All OS platforms supported: macOS, Linux, Windows (Git Bash / PowerShell fallback).
- Everything idempotent — safe to re-run.

## Non-goals

- No commit or push. Staging only (existing behaviour preserved).
- No custom wiki path argument. Default is always `docs/wiki`.
- No changes to `commands/team-share.md`.

---

## File Layout

```
plugins/team-share/
  agents/team-share.md               ← updated: menu + skill dispatch
  skills/
    codegraph-setup/SKILL.md         ← NEW
    understand-setup/SKILL.md        ← NEW
    claude-config/SKILL.md           ← NEW (extracted from existing agent)
  commands/team-share.md             ← unchanged
  .claude-plugin/plugin.json         ← add skills[] array
  README.md                          ← update plugin description + skill list
```

6 files touched (3 new, 3 updated).

---

## Agent Changes (`agents/team-share.md`)

### allowed-tools

Add `AskUserQuestion` to the existing list:

```
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Skill, AskUserQuestion
```

### Step 0 — Interactive menu

Present a `multiSelect: true` question before any work. Four options:

| Option | Maps to skills |
|--------|---------------|
| Default (CodeGraph + Claude config) | `codegraph-setup` + `claude-config` |
| Setup CodeGraph | `codegraph-setup` |
| Setup Understand-Anything | `understand-setup` |
| Setup team Claude config | `claude-config` |

"Default" is shown first and recommended. If nothing is selected, exit cleanly with a message.

### Deduplication

Build a run-list from selected options. If both "Default" and "Setup CodeGraph" are ticked, `codegraph-setup` appears once. Order is always: `codegraph-setup` → `understand-setup` → `claude-config`.

### Dispatch

Call each skill in the run-list via the `Skill` tool in order. The agent does no implementation work itself.

---

## Skill: `codegraph-setup`

**Purpose:** Install the CodeGraph CLI globally, wire it to Claude Code, and initialise the current project.

### Steps

1. **Precondition** — must be inside a git repo (`git rev-parse --is-inside-work-tree`). Stop and report if not.
2. **Already installed?** — `command -v codegraph`. If found, report version and skip install; jump to step 4.
3. **Install CLI (OS-aware)**

   ```bash
   # Detect OS
   if command -v uname >/dev/null 2>&1; then
     _OS=$(uname -s)
   else
     _OS="Windows"
   fi

   case "$_OS" in
     Darwin|Linux)
       curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh
       ;;
     *)
       # Windows: PowerShell may be available in PATH as `pwsh` or `powershell`
       _PS=$(command -v pwsh 2>/dev/null || command -v powershell 2>/dev/null)
       if [ -n "$_PS" ]; then
         "$_PS" -Command "irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex"
       else
         echo "ERROR: cannot detect OS or find PowerShell. Install codegraph manually: https://github.com/colbymchenry/codegraph"
         exit 1
       fi
       ;;
   esac
   ```

4. **Wire to Claude Code** — `codegraph install` (registers the MCP server).
5. **Init project** — `codegraph init` in CWD.
6. **Report** — installed vs skipped, init output.

---

## Skill: `understand-setup`

**Purpose:** Install the Understand-Anything plugin, build the knowledge graph with auto-update, generate the docs/wiki, and stage artefacts.

### Steps

1. **Preconditions** — git repo, `git-lfs`, `jq` present. Stop if any missing.
2. **Warn if on protected branch** — warn and ask user to switch if on `main`/`develop`/`master`.
3. **Install plugin** (idempotent — Claude Code handles re-install gracefully):
   ```
   /plugin marketplace add Egonex-AI/Understand-Anything
   /plugin install understand-anything
   ```
   Confirm `understand-anything@understand-anything` appears in `.claude/settings.json`.
4. **Build knowledge graph**:
   ```
   /understand --auto-update $ARGUMENTS
   ```
   Confirm `.understand-anything/knowledge-graph.json`, `meta.json`, `config.json` (with `autoUpdate: true`) exist after.
5. **Generate wiki**:
   ```bash
   mkdir -p docs/wiki
   ```
   ```
   /understand-knowledge docs/wiki
   ```
   Confirm `docs/wiki/` contains generated files.
6. **Gitignore scratch outputs** (idempotent append):
   ```
   .understand-anything/intermediate/
   .understand-anything/tmp/
   .understand-anything/diff-overlay.json
   ```
7. **git-lfs track + stage**:
   ```bash
   git lfs install
   git lfs track ".understand-anything/*.json"
   git add .gitattributes .gitignore .understand-anything/ docs/wiki/
   ```
8. **Report** — graph created vs incremental; `autoUpdate` status; wiki path; staged files.

---

## Skill: `claude-config`

**Purpose:** Write a shareable `.claude/settings.json`, scaffold `CLAUDE.md` if missing, inject the Understand-Anything code-research section, and stage the result.

### Steps

1. **Preconditions** — git repo, `jq` present.
2. **Warn if on protected branch.**
3. **Merge plugin + marketplace settings** — copy only `enabledPlugins` and `extraKnownMarketplaces` from `~/.claude/settings.json` into `.claude/settings.json`. No hooks, permissions, env, or absolute paths cross over. Flag any private marketplace URLs.
4. **Scaffold `CLAUDE.md`** if missing via `claude-code-setup` plugin install (idempotent guard: `[ -f CLAUDE.md ]`).
5. **Inject Understand-Anything section** into `CLAUDE.md` (idempotent guard on heading marker). Mirror to `AGENTS.md` / `MIRRORS.md` if present.
6. **Stage**:
   ```bash
   git add .claude/settings.json CLAUDE.md
   for f in AGENTS.md MIRRORS.md; do [ -f "$f" ] && git add "$f"; done
   ```
7. **Report** — which plugins/marketplaces merged; `CLAUDE.md` created vs existed; Understand-Anything section added vs already present.

---

## Plugin Manifest (`plugin.json`)

Add a `skills` array:

```json
{
  "name": "team-share",
  ...
  "skills": [
    "skills/codegraph-setup",
    "skills/understand-setup",
    "skills/claude-config"
  ]
}
```

---

## OS Compatibility

| Platform | codegraph install | UA install | claude-config |
|----------|------------------|------------|---------------|
| macOS    | curl + sh        | /plugin    | bash + jq     |
| Linux    | curl + sh        | /plugin    | bash + jq     |
| Windows (Git Bash) | pwsh/powershell fallback | /plugin | bash + jq |

`jq` and `git-lfs` are checked at skill entry. If missing, the skill reports the install command and stops — it does not attempt auto-install of system tools.

---

## Success Criteria

- Running `/team-share` presents the menu before any bash command executes.
- Selecting "Default" runs `codegraph-setup` then `claude-config` only.
- Each skill can also be invoked standalone without the menu.
- Re-running is safe (idempotent): no duplicate appends, no double installs.
- On Windows, codegraph install falls back to PowerShell gracefully.
- `docs/wiki` is the hardcoded wiki output path.
- Nothing is committed or pushed; only staged.
