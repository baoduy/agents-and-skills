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
