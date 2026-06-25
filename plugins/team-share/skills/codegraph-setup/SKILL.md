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
