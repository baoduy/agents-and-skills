# team-share Enhancement — Interactive Setup Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the `team-share` plugin into three independently-invocable skills (codegraph-setup, understand-setup, claude-config) and update the agent to present a multi-select menu that dispatches to only the chosen skills.

**Architecture:** The existing monolithic agent is split into three focused SKILL.md files; the agent becomes a thin menu + dispatcher using `AskUserQuestion` and the `Skill` tool. No shared scripts — each skill is self-contained.

**Tech Stack:** Markdown agent/skill instruction files, bash, jq, git-lfs, Claude Code plugin system.

## Global Constraints

- All edits stay inside `plugins/team-share/` only — no changes to `.claude/`, `.agents/`, or other top-level dirs.
- Skills live at `plugins/team-share/skills/<name>/SKILL.md`.
- Every new SKILL.md must pass `/validate-skills` before its task is committed.
- Plugin manifest JSON must pass `python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"` before any manifest-touching commit.
- Nothing commits or pushes in any skill — staging only.
- Wiki output path is hardcoded as `docs/wiki` — no custom path argument.
- OS support: macOS (Darwin), Linux, Windows (Git Bash with pwsh/powershell fallback).
- All steps idempotent — safe to re-run.

---

### Task 1: Create `skills/claude-config/SKILL.md`

Extract the existing agent's Step 1 (settings.json + CLAUDE.md + staging) into a standalone skill.

**Files:**
- Create: `plugins/team-share/skills/claude-config/SKILL.md`

**Interfaces:**
- Produces: a skill invocable as `team-share:claude-config` that writes `.claude/settings.json`, scaffolds `CLAUDE.md`, injects the Understand-Anything section, and stages the result.

- [ ] **Step 1: Create the skill file**

Create `plugins/team-share/skills/claude-config/SKILL.md` with this exact content:

```markdown
---
name: claude-config
description: Write a shareable .claude/settings.json from the maintainer's enabled plugins and marketplaces, scaffold CLAUDE.md when missing, inject the Understand-Anything code-research section, and stage the result. Idempotent — safe to re-run.
allowed-tools: Bash, Read, Write, Edit
---

# claude-config

Set up repo-level Claude Code configuration for teammates.

## Preconditions (stop on any failure)

```bash
git rev-parse --is-inside-work-tree || { echo "ERROR: not a git repo"; exit 1; }
command -v jq || echo "MISSING: jq — install it (brew install jq / apt install jq / choco install jq) before continuing"
```

If not a git repo or `jq` is missing → report and STOP. Do not partially apply.

Check current branch and warn if on a protected branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
case "$BRANCH" in
  main|master|develop|dev)
    echo "⚠️  You are on branch '$BRANCH'. Consider switching to a feature branch before continuing."
    ;;
esac
```

## Step 1 — Merge plugin + marketplace settings

Copy only `enabledPlugins` and `extraKnownMarketplaces` from the maintainer's user settings into the repo settings. Do NOT copy `hooks`, `permissions`, `env`, or any key with absolute paths.

```bash
USER_SETTINGS="$HOME/.claude/settings.json"
REPO_SETTINGS=".claude/settings.json"

mkdir -p .claude
[ -f "$REPO_SETTINGS" ] || echo '{}' > "$REPO_SETTINGS"

jq -s '
  .[0] as $repo | .[1] as $user
  | $repo
  + { enabledPlugins:         (($repo.enabledPlugins         // {}) + ($user.enabledPlugins         // {})) }
  + { extraKnownMarketplaces: (($repo.extraKnownMarketplaces // {}) + ($user.extraKnownMarketplaces // {})) }
' "$REPO_SETTINGS" "$USER_SETTINGS" > "$REPO_SETTINGS.tmp" && mv "$REPO_SETTINGS.tmp" "$REPO_SETTINGS"

jq '{enabledPlugins, extraKnownMarketplaces}' "$REPO_SETTINGS"
```

Inspect the result: flag any marketplace URL that looks private (contains org names, auth tokens, or is not a well-known public registry).

## Step 2 — Scaffold CLAUDE.md if missing

```bash
if [ -f CLAUDE.md ]; then
  echo "✅ CLAUDE.md already exists — skipping."
else
  echo "📝 CLAUDE.md not found — installing claude-code-setup plugin to scaffold it…"
  claude plugin install claude-code-setup@claude-plugins-official
  if [ -f CLAUDE.md ]; then
    echo "✅ CLAUDE.md created by claude-code-setup."
  else
    echo "⚠️  claude-code-setup did not produce CLAUDE.md — create it manually or commit a template first."
  fi
fi
```

## Step 3 — Inject Understand-Anything section into CLAUDE.md

Append only when the section marker is absent (idempotent guard):

```bash
if grep -qF '## Code research with Understand-Anything' CLAUDE.md 2>/dev/null; then
  echo "✅ Understand-Anything section already in CLAUDE.md — skipping."
else
  cat >> CLAUDE.md << 'UASECTION'

## Code research with Understand-Anything

This project uses the [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) plugin to maintain an interactive knowledge graph of the codebase. **Always prefer these commands over raw file-by-file exploration when doing code research:**

| Goal | Command |
|------|---------|
| Explore the full codebase graph | `/understand` |
| Ask a free-form question about the code | `/understand-chat <question>` |
| Deep-dive into a specific file or function | `/understand-explain <path/symbol>` |
| See impact of your current changes before committing | `/understand-diff` |
| Open the interactive visual dashboard | `/understand-dashboard` |
| Extract business-domain knowledge (domains, flows, steps) | `/understand-domain` |
| Generate an onboarding guide for new teammates | `/understand-onboard` |
| Generate or refresh wiki knowledge under `docs/wiki` | `/understand-knowledge docs/wiki` |

The knowledge graph lives in `.understand-anything/knowledge-graph.json` and is kept up-to-date automatically on every commit (auto-update is enabled). Re-run `/understand` after large refactors to force a rebuild, and `/understand-knowledge docs/wiki` to refresh the wiki.
UASECTION
  echo "✅ Understand-Anything section appended to CLAUDE.md."
fi
```

Mirror to AGENTS.md / MIRRORS.md if they exist:

```bash
for f in AGENTS.md MIRRORS.md; do
  if [ -f "$f" ] && ! grep -qF '## Code research with Understand-Anything' "$f" 2>/dev/null; then
    cat >> "$f" << 'UASECTION'

## Code research with Understand-Anything

This project uses the [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) plugin to maintain an interactive knowledge graph of the codebase. **Always prefer these commands over raw file-by-file exploration when doing code research:**

| Goal | Command |
|------|---------|
| Explore the full codebase graph | `/understand` |
| Ask a free-form question about the code | `/understand-chat <question>` |
| Deep-dive into a specific file or function | `/understand-explain <path/symbol>` |
| See impact of your current changes before committing | `/understand-diff` |
| Open the interactive visual dashboard | `/understand-dashboard` |
| Extract business-domain knowledge (domains, flows, steps) | `/understand-domain` |
| Generate an onboarding guide for new teammates | `/understand-onboard` |
| Generate or refresh wiki knowledge under `docs/wiki` | `/understand-knowledge docs/wiki` |

The knowledge graph lives in `.understand-anything/knowledge-graph.json` and is kept up-to-date automatically on every commit (auto-update is enabled). Re-run `/understand` after large refactors to force a rebuild, and `/understand-knowledge docs/wiki` to refresh the wiki.
UASECTION
    echo "✅ Section also appended to $f."
  fi
done
```

## Step 4 — Stage

```bash
git add .claude/settings.json CLAUDE.md
for f in AGENTS.md MIRRORS.md; do [ -f "$f" ] && git add "$f"; done
git status
```

## Done — report

- Which plugins/marketplaces were written to `.claude/settings.json` (flag any private ones).
- `CLAUDE.md` status: already existed vs created; Understand-Anything section added vs already present.
- `AGENTS.md` / `MIRRORS.md` status (if applicable).
- Files staged. Remind: **review then commit yourself.**
```

- [ ] **Step 2: Validate the skill**

```bash
cd /path/to/repo
```

Run the validate-skills skill:
```
/validate-skills
```
Expected: skill `claude-config` passes all checks. Fix any reported issues before proceeding.

- [ ] **Step 3: Commit**

```bash
git add plugins/team-share/skills/claude-config/SKILL.md
git commit -m "feat(team-share): add claude-config skill (extracted from agent)"
```

---

### Task 2: Create `skills/understand-setup/SKILL.md`

Extract the existing agent's Steps 2–4 (Understand-Anything install + graph build + wiki + git-lfs) into a standalone skill.

**Files:**
- Create: `plugins/team-share/skills/understand-setup/SKILL.md`

**Interfaces:**
- Produces: a skill invocable as `team-share:understand-setup` that installs the plugin, builds the graph with `--auto-update`, generates `docs/wiki`, and stages artefacts.
- Accepts: `$ARGUMENTS` forwarded to `/understand` (e.g. `--force`, `--language zh`).

- [ ] **Step 1: Create the skill file**

Create `plugins/team-share/skills/understand-setup/SKILL.md` with this exact content:

```markdown
---
name: understand-setup
description: Install the Understand-Anything plugin, build the knowledge graph with auto-update enabled, generate docs/wiki, git-lfs track the graph, and stage all artefacts. Idempotent — safe to re-run.
argument-hint: "[--force] [--language <lang>] (passed through to /understand)"
allowed-tools: Bash, Read, Write, Edit, Skill
---

# understand-setup

Install Understand-Anything and build the knowledge graph for this repo.

## Preconditions (stop on any failure)

```bash
git rev-parse --is-inside-work-tree || { echo "ERROR: not a git repo"; exit 1; }
command -v git-lfs || echo "MISSING: git-lfs — install it (brew install git-lfs / apt install git-lfs) before continuing"
command -v jq      || echo "MISSING: jq — install it (brew install jq / apt install jq / choco install jq) before continuing"
```

If not a git repo, or `git-lfs`/`jq` are missing → report and STOP. Do not partially apply.

Check current branch and warn if on a protected branch:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
case "$BRANCH" in
  main|master|develop|dev)
    echo "⚠️  You are on branch '$BRANCH'. Consider switching to a feature branch first."
    ;;
esac
```

## Step 1 — Install the plugin

Install via the Claude Code plugin system (idempotent):

```
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
```

After install, confirm `understand-anything@understand-anything` appears in `.claude/settings.json`:

```bash
jq '.enabledPlugins["understand-anything@understand-anything"]' .claude/settings.json 2>/dev/null || echo "⚠️  understand-anything not found in .claude/settings.json — teammates may need to install manually."
```

## Step 2 — Build / refresh the knowledge graph

Run the skill **in the main thread** (it dispatches its own analyzer subagents — do not wrap it in a subagent):

```
/understand --auto-update $ARGUMENTS
```

- `--auto-update` writes `{"autoUpdate": true}` to `.understand-anything/config.json`.
- If a graph already exists, `/understand` runs incrementally. Pass `--force` (via `$ARGUMENTS`) to rebuild from scratch.

After it finishes, confirm these files exist:

```bash
test -f .understand-anything/knowledge-graph.json && echo "✅ knowledge-graph.json" || echo "❌ knowledge-graph.json missing"
test -f .understand-anything/meta.json            && echo "✅ meta.json"            || echo "❌ meta.json missing"
jq '.autoUpdate' .understand-anything/config.json 2>/dev/null | grep -q true && echo "✅ autoUpdate: true" || echo "❌ autoUpdate not set"
```

## Step 3 — Initialize the docs wiki

```bash
mkdir -p docs/wiki
```

Run wiki generation in the main thread:

```
/understand-knowledge docs/wiki
```

After it finishes, confirm `docs/wiki/` contains generated files:

```bash
ls docs/wiki/ | head -5 || echo "❌ docs/wiki is empty or missing"
```

## Step 4 — Ignore scratch outputs, git-lfs track, and stage

Append scratch paths to .gitignore (idempotent):

```bash
for p in ".understand-anything/intermediate/" ".understand-anything/tmp/" ".understand-anything/diff-overlay.json"; do
  grep -qxF "$p" .gitignore 2>/dev/null || echo "$p" >> .gitignore
done
```

Track large graph files with git-lfs (harmless for small graphs):

```bash
git lfs install
git lfs track ".understand-anything/*.json"
```

Stage all artefacts:

```bash
git add .gitattributes .gitignore .understand-anything/ docs/wiki/
git status
git lfs ls-files
```

## Done — report

- Graph status: created vs incrementally updated; `autoUpdate` on/off.
- Wiki status: `docs/wiki/` created vs already existed; generation successful vs failed.
- Staged files; LFS-tracked files confirmed.
- Remind: **review then commit yourself.**
```

- [ ] **Step 2: Validate the skill**

Run the validate-skills skill:
```
/validate-skills
```
Expected: skill `understand-setup` passes all checks.

- [ ] **Step 3: Commit**

```bash
git add plugins/team-share/skills/understand-setup/SKILL.md
git commit -m "feat(team-share): add understand-setup skill (extracted from agent)"
```

---

### Task 3: Create `skills/codegraph-setup/SKILL.md`

New skill: install the CodeGraph CLI (OS-aware), wire it to Claude Code, and init the project.

**Files:**
- Create: `plugins/team-share/skills/codegraph-setup/SKILL.md`

**Interfaces:**
- Produces: a skill invocable as `team-share:codegraph-setup` that installs codegraph globally, runs `codegraph install`, and runs `codegraph init` in CWD.

- [ ] **Step 1: Create the skill file**

Create `plugins/team-share/skills/codegraph-setup/SKILL.md` with this exact content:

```markdown
---
name: codegraph-setup
description: Install the CodeGraph CLI, wire it to Claude Code via MCP (codegraph install), and initialise the current project (codegraph init). Works on macOS, Linux, and Windows (Git Bash / PowerShell). Idempotent — skips install if codegraph is already in PATH.
allowed-tools: Bash
---

# codegraph-setup

Install CodeGraph and initialise it for this project.

## Precondition

Must be inside a git repo:

```bash
git rev-parse --is-inside-work-tree || { echo "ERROR: not a git repo — run this from your project root"; exit 1; }
```

## Step 1 — Check if already installed

```bash
if command -v codegraph >/dev/null 2>&1; then
  echo "✅ codegraph already installed: $(codegraph --version 2>/dev/null || echo 'version unknown')"
  echo "Skipping install — proceeding to wire and init."
  SKIP_INSTALL=1
else
  SKIP_INSTALL=0
fi
```

## Step 2 — Install CLI (OS-aware, skipped if already present)

```bash
if [ "$SKIP_INSTALL" = "0" ]; then
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
      _PS=$(command -v pwsh 2>/dev/null || command -v powershell 2>/dev/null)
      if [ -n "$_PS" ]; then
        "$_PS" -Command "irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex"
      else
        echo "ERROR: cannot detect OS or find PowerShell."
        echo "Install manually: https://github.com/colbymchenry/codegraph#installation"
        exit 1
      fi
      ;;
  esac

  command -v codegraph >/dev/null 2>&1 || { echo "ERROR: codegraph install failed — not found in PATH after install"; exit 1; }
  echo "✅ codegraph installed: $(codegraph --version 2>/dev/null || echo 'version unknown')"
fi
```

Note: on Windows with Git Bash, `uname -s` returns `MINGW64_NT-*` or similar, which falls through to the `*)` case and attempts PowerShell. This is correct behaviour.

## Step 3 — Wire to Claude Code

Register the CodeGraph MCP server with Claude Code:

```bash
codegraph install
```

This makes CodeGraph's context tools available inside Claude Code sessions.

## Step 4 — Initialise the project

Build the code knowledge graph for this repo:

```bash
codegraph init
```

This creates a local SQLite index of symbols, dependencies, and cross-file relationships.

## Done — report

- Install: new install vs already present (version).
- Wire: `codegraph install` output.
- Init: `codegraph init` output, any errors.
```

- [ ] **Step 2: Validate the skill**

Run the validate-skills skill:
```
/validate-skills
```
Expected: skill `codegraph-setup` passes all checks.

- [ ] **Step 3: Commit**

```bash
git add plugins/team-share/skills/codegraph-setup/SKILL.md
git commit -m "feat(team-share): add codegraph-setup skill"
```

---

### Task 4: Update `agents/team-share.md` with menu + dispatch

Replace the existing monolithic agent body with: a multi-select menu, run-list builder with dedup, and skill dispatcher. The agent does zero implementation work itself.

**Files:**
- Modify: `plugins/team-share/agents/team-share.md`

**Interfaces:**
- Consumes: `team-share:codegraph-setup`, `team-share:understand-setup`, `team-share:claude-config` (all defined in Tasks 1–3)
- Produces: the `/team-share` command entry point with interactive menu

- [ ] **Step 1: Replace the agent file**

Overwrite `plugins/team-share/agents/team-share.md` with:

```markdown
---
name: team-share
description: Share Claude plugin settings with the team, build or refresh the Understand-Anything knowledge graph, initialize the docs wiki, and git-lfs track it before staging everything for review.
argument-hint: "[--force] [--language <lang>] (forwarded to understand-setup → /understand)"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Skill, AskUserQuestion
---

# /team-share

Make this repo onboarding-ready for the team in one pass. Choose which setup actions to run.

## Step 0 — Interactive menu

Before any work begins, use AskUserQuestion with `multiSelect: true` and these four options:

| Label | Description |
|-------|-------------|
| Default (CodeGraph + Claude config) *(Recommended)* | Install CodeGraph CLI + init project, then share .claude/settings.json and scaffold CLAUDE.md. Best starting point for most repos. |
| Setup CodeGraph | Install the CodeGraph CLI, wire it to Claude Code MCP, and run codegraph init in this project. |
| Setup Understand-Anything | Install the Understand-Anything plugin, build the knowledge graph with auto-update, and generate docs/wiki. |
| Setup team Claude config | Merge enabledPlugins + marketplaces into .claude/settings.json, scaffold CLAUDE.md, and stage. |

If the user selects nothing, print `"Nothing selected — exiting."` and stop immediately.

## Step 1 — Build run-list

From the selected options, assemble a deduplicated run-list. Mapping:

- "Default (CodeGraph + Claude config)" → `codegraph-setup`, `claude-config`
- "Setup CodeGraph" → `codegraph-setup`
- "Setup Understand-Anything" → `understand-setup`
- "Setup team Claude config" → `claude-config`

Deduplication: if a skill appears more than once (e.g. "Default" + "Setup CodeGraph" both selected), keep it once. Final order is always: `codegraph-setup` → `understand-setup` → `claude-config`.

## Step 2 — Dispatch

Invoke each skill in the run-list in order using the Skill tool:

- `codegraph-setup`  → `team-share:codegraph-setup` (no arguments)
- `understand-setup` → `team-share:understand-setup` with `$ARGUMENTS` forwarded
- `claude-config`    → `team-share:claude-config` (no arguments)

The agent does no implementation work itself — all logic lives in the skills.

## Done — summary

After all selected skills complete, print a summary:

- Which actions ran (in order).
- Any failures or warnings reported by individual skills.
- Reminder: **review staged changes, then commit yourself** — for example:
  `git commit -m "chore: team onboarding setup (codegraph + claude config)"`
```

- [ ] **Step 2: Verify the file was written correctly**

```bash
head -10 plugins/team-share/agents/team-share.md
```
Expected output starts with:
```
---
name: team-share
```
And the `allowed-tools` line must include `AskUserQuestion`.

```bash
grep 'AskUserQuestion' plugins/team-share/agents/team-share.md
```
Expected: `allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Skill, AskUserQuestion`

- [ ] **Step 3: Commit**

```bash
git add plugins/team-share/agents/team-share.md
git commit -m "feat(team-share): replace agent with interactive menu + skill dispatcher"
```

---

### Task 5: Update plugin manifest and README

Register the three new skills in `plugin.json` and update the README with the skill list.

**Files:**
- Modify: `plugins/team-share/.claude-plugin/plugin.json`
- Modify: `plugins/team-share/README.md`

**Interfaces:**
- Consumes: skill names `codegraph-setup`, `understand-setup`, `claude-config` from Tasks 1–3.

- [ ] **Step 1: Update `plugin.json`**

Overwrite `plugins/team-share/.claude-plugin/plugin.json` with:

```json
{
  "name": "team-share",
  "displayName": "Team Share",
  "version": "0.0.28",
  "description": "Onboard your team with an interactive setup menu: install CodeGraph, build the Understand-Anything knowledge graph, and share Claude Code settings — run any combination, all idempotent.",
  "author": {
    "name": "Steven Hoang"
  },
  "keywords": [
    "onboarding",
    "team",
    "claude",
    "settings",
    "codegraph",
    "understand-anything",
    "git-lfs"
  ],
  "skills": [
    "skills/codegraph-setup",
    "skills/understand-setup",
    "skills/claude-config"
  ]
}
```

- [ ] **Step 2: Validate the JSON**

```bash
python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Update `README.md`**

Overwrite `plugins/team-share/README.md` with:

```markdown
# team-share

Onboard your team with an interactive setup menu. Run `/team-share` and choose which actions to execute — only selected actions run.

## What it does

The `team-share` agent presents a multi-select menu with four options:

| Option | What runs |
|--------|-----------|
| **Default (CodeGraph + Claude config)** *(Recommended)* | `codegraph-setup` + `claude-config` |
| Setup CodeGraph | `codegraph-setup` |
| Setup Understand-Anything | `understand-setup` |
| Setup team Claude config | `claude-config` |

## Skills (independently invocable)

Each action is also available as a standalone skill:

### `/codegraph-setup`

Installs the [CodeGraph](https://github.com/colbymchenry/codegraph) CLI, wires it to Claude Code via MCP (`codegraph install`), and initialises the current project (`codegraph init`). Works on macOS, Linux, and Windows.

### `/understand-setup`

Installs the [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) plugin, builds the knowledge graph with `--auto-update`, generates `docs/wiki`, git-lfs tracks the graph, and stages all artefacts.

### `/claude-config`

Merges `enabledPlugins` and `extraKnownMarketplaces` from the maintainer's user settings into `.claude/settings.json`, scaffolds `CLAUDE.md` when missing, injects the Understand-Anything code-research section, and stages the result.

## Usage

```text
/team-share [--force] [--language <lang>]
```

Arguments are forwarded to `/understand` when `understand-setup` is selected.

## Notes

- `codegraph-setup` requires internet access to download the CLI.
- `understand-setup` requires `git-lfs` and `jq` to be installed.
- `claude-config` requires `jq` to be installed.
- All skills stage files but never commit or push — a human reviews and commits.
- All skills are idempotent — safe to re-run.
```

- [ ] **Step 4: Commit**

```bash
git add plugins/team-share/.claude-plugin/plugin.json plugins/team-share/README.md
git commit -m "feat(team-share): register skills in manifest, update README"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Interactive multi-select menu before any work → Task 4 Step 0
- ✅ "Default" option (CodeGraph + Claude config) → Task 4 Step 1
- ✅ Deduplication of run-list → Task 4 Step 1
- ✅ `codegraph-setup` skill with OS-aware install → Task 3
- ✅ `understand-setup` skill (plugin install + graph + wiki + git-lfs) → Task 2
- ✅ `claude-config` skill (settings.json + CLAUDE.md + staging) → Task 1
- ✅ `docs/wiki` hardcoded as wiki path → Task 2 Step 3
- ✅ All skills independently invocable → Tasks 1–3 (each named `team-share:<name>`)
- ✅ Plugin manifest updated with `skills[]` → Task 5 Step 1
- ✅ README updated → Task 5 Step 3
- ✅ validate-skills run per SKILL.md → Tasks 1–3 Step 2 each
- ✅ OS support (macOS/Linux/Windows) → Task 3 Step 2 (codegraph only needs it)
- ✅ Idempotent guards on all operations → all three skills
- ✅ No commit/push in any skill → all three skills

**No placeholders found.** All steps contain complete file content or exact commands.

**Type/name consistency:** Skill names `team-share:codegraph-setup`, `team-share:understand-setup`, `team-share:claude-config` used consistently across Task 4 dispatch and Tasks 1–3 definitions.
