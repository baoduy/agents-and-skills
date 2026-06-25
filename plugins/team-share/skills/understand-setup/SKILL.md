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
