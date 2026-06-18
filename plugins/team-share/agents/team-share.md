---
name: team-share
description: Share Claude plugin settings with the team, build or refresh the Understand-Anything knowledge graph with auto-update, and git-lfs track it before staging everything for review.
argument-hint: "[--force] [--language <lang>] (passed through to /understand)"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Skill
---

# /team-share

Make this repo onboarding-ready for the team in one pass:

1. Generate a **shareable `.claude/settings.json`** (plugins + marketplaces) from the maintainer's live setup.
2. Build/refresh the **Understand-Anything knowledge graph** with auto-update enabled.
3. **git-lfs track** the graph and **stage** everything — leaving the commit to a human.

This command is **idempotent** — safe to re-run. It **never commits or pushes**; it only stages.
`$ARGUMENTS` (e.g. `--force`, `--language zh`) is forwarded to `/understand`.

Plugin source: Understand-Anything (Egonex fork) — <https://github.com/Egonex-AI/Understand-Anything>

---

## Step 0 — Preconditions (stop on any failure, fail loud)

```bash
git rev-parse --is-inside-work-tree                 # must be a git repo
git rev-parse --abbrev-ref HEAD                      # report branch; warn if it is the default/protected branch
command -v git-lfs || echo "MISSING: git-lfs — install it (brew install git-lfs) before continuing"
command -v jq      || echo "MISSING: jq — install it (brew install jq) before continuing"
```

- If not a git repo, or `git-lfs`/`jq` are missing → **report and STOP**. Do not partially apply.
- If on a protected branch (e.g. `develop`/`main`), warn and ask the user to switch to a feature branch first.

---

## Step 1 — Generate the shareable `.claude/settings.json` **and ensure `CLAUDE.md` exists**

Goal: teammates who clone the repo get the **same plugins + marketplaces** the maintainer uses, with **no machine-specific data leaked** — *and* a project-level `CLAUDE.md` is scaffolded if it is missing.

### 1a — Merge plugin + marketplace settings

Copy **only** `enabledPlugins` and `extraKnownMarketplaces` from the maintainer's user settings into the repo settings. Do **NOT** copy `hooks`, `permissions`, `env`, or any key holding absolute paths or local tooling (those are per-machine and may expose private paths).

```bash
USER_SETTINGS="$HOME/.claude/settings.json"
REPO_SETTINGS=".claude/settings.json"

mkdir -p .claude
[ -f "$REPO_SETTINGS" ] || echo '{}' > "$REPO_SETTINGS"

# Merge: repo settings win on scalar keys; the two plugin maps are unioned
# (user entries layered on top of any existing repo entries). Only these two
# keys are taken from user settings — nothing else crosses over.
jq -s '
  .[0] as $repo | .[1] as $user
  | $repo
  + { enabledPlugins:        (($repo.enabledPlugins        // {}) + ($user.enabledPlugins        // {})) }
  + { extraKnownMarketplaces: (($repo.extraKnownMarketplaces // {}) + ($user.extraKnownMarketplaces // {})) }
' "$REPO_SETTINGS" "$USER_SETTINGS" > "$REPO_SETTINGS.tmp" && mv "$REPO_SETTINGS.tmp" "$REPO_SETTINGS"

jq '{enabledPlugins, extraKnownMarketplaces}' "$REPO_SETTINGS"   # show the result for review
```

Notes:
- This shares **currently-enabled** plugins (the in-use set). It does not pull disabled-but-installed plugins.
- Some marketplaces may be **private** (require repo/org access). Flag any private marketplace so the user can confirm teammates can reach it.
- Confirm `understand-anything@understand-anything` is present in `enabledPlugins` (needed for Step 2's auto-update hook to work on teammates' machines). If absent, tell the user to install it:
  `/plugin marketplace add Egonex-AI/Understand-Anything` then `/plugin install understand-anything`.

### 1b — Scaffold `CLAUDE.md` if missing

The `claude-code-setup` plugin (from the `claude-plugins-official` marketplace) generates a project-savvy `CLAUDE.md` when one does not yet exist. Running the install command is **idempotent** — if `CLAUDE.md` is already present it will **not** be overwritten.

```bash
# Only create CLAUDE.md when it does not already exist.
if [ -f CLAUDE.md ]; then
  echo "✅ CLAUDE.md already exists — skipping plugin install."
else
  echo "📝 CLAUDE.md not found — installing claude-code-setup plugin to scaffold it…"
  claude plugin install claude-code-setup@claude-plugins-official
  if [ -f CLAUDE.md ]; then
    echo "✅ CLAUDE.md created by claude-code-setup."
  else
    echo "⚠️  claude-code-setup did not produce CLAUDE.md — you may need to run it manually or create the file yourself."
  fi
fi
```

Notes:
- The plugin must already be available in the `claude-plugins-official` marketplace (it is already listed in `enabledPlugins` in the repo settings).
- If the team prefers a custom `CLAUDE.md` template, commit one *before* running this command so the guard `[ -f CLAUDE.md ]` skips the plugin step.

---

## Step 2 — Build / refresh the knowledge graph (auto-update on)

Run the skill **in the main thread** (it dispatches its own analyzer subagents — do not wrap it in a subagent):

```
/understand --auto-update $ARGUMENTS
```

- `--auto-update` writes `{"autoUpdate": true}` to `.understand-anything/config.json`. The plugin's bundled hook then incrementally patches the graph whenever a `git commit` is made (and on stale SessionStart), so each commit lands with a matching graph.
- If a graph already exists, `/understand` runs incrementally. Pass `--force` (via `$ARGUMENTS`) to rebuild from scratch.
- After it finishes, confirm these exist: `.understand-anything/knowledge-graph.json`, `.understand-anything/meta.json`, `.understand-anything/config.json` (with `autoUpdate: true`).

---

## Step 3 — Ignore scratch, git-lfs track the graph, and stage

Scratch outputs must stay local (never committed):

```bash
# .gitignore — append only if missing (idempotent)
for p in ".understand-anything/intermediate/" ".understand-anything/tmp/" ".understand-anything/diff-overlay.json"; do
  grep -qxF "$p" .gitignore 2>/dev/null || echo "$p" >> .gitignore
done

# Large graphs (10 MB+) belong in LFS; tracking is harmless for small ones too.
git lfs install
git lfs track ".understand-anything/*.json"

# Stage — but DO NOT commit. A human reviews and commits.
git add .gitattributes .gitignore .claude/settings.json .understand-anything/

git status
git lfs ls-files          # confirm the graph json is LFS-tracked
```

---

## Done — report, do not commit

Summarize for the user:
- Which plugins/marketplaces were written into `.claude/settings.json` (call out any private ones).
- `CLAUDE.md` status: already existed vs created by `claude-code-setup`.
- Graph status: created vs incrementally updated; `autoUpdate` on/off.
- What is staged and confirmed LFS-tracked.
- Remind them: **review, then commit yourself** (e.g. `git commit -m "chore: share team onboarding (claude settings + CLAUDE.md + understand graph)"`). The auto-update hook keeps the graph fresh on every future commit.
