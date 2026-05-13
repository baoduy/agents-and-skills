# Plugin Validator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the four validate-* skills, the `plugin-validator` orchestrator agent, and the `validate-plugins` slash command into a proper plugin at `plugins/plugin-validator/`, updating all manifests and README, so they ship via npm and are installable by any `@drunkcoding/agents-and-skills` consumer.

**Architecture:** Single atomic commit on branch `superpower-plugin-validator` — all six files moved from `.claude/` into `plugins/plugin-validator/` via `git mv` (preserves history), the new `plugin.json` created, `marketplace.json` updated, root `README.md` updated, and a plugin-level `README.md` added. No feature logic changes of any kind.

**Tech Stack:** Git (worktree, mv), JSON manifests, Markdown.

---

## Commit Strategy

All `impl:` tasks produce file changes that land in **one atomic commit** (design §8.1). The implementation sequence builds up staged changes across tasks 1–6; task 7 runs the smoke check pre-commit; task 8 stages everything and commits. No intermediate commits between tasks 1–8. This eliminates the window where both `.claude/` originals and `plugins/plugin-validator/` copies coexist from the validator's perspective.

## File Scope Map

| File | Task | Operation |
|------|------|-----------|
| `plugins/plugin-validator/.claude-plugin/plugin.json` | Task 1 | Create |
| `plugins/plugin-validator/skills/validate-skills/SKILL.md` | Task 2 | `git mv` from `.claude/skills/validate-skills/SKILL.md` |
| `plugins/plugin-validator/skills/validate-agents/SKILL.md` | Task 3 | `git mv` from `.claude/skills/validate-agents/SKILL.md` |
| `plugins/plugin-validator/skills/validate-commands/SKILL.md` | Task 4 | `git mv` from `.claude/skills/validate-commands/SKILL.md` |
| `plugins/plugin-validator/skills/validate-hooks/SKILL.md` | Task 5 | `git mv` from `.claude/skills/validate-hooks/SKILL.md` |
| `plugins/plugin-validator/agents/plugin-validator.md` | Task 6a | `git mv` from `.claude/agents/plugin-validator.md` |
| `plugins/plugin-validator/commands/validate-plugins.md` | Task 6b | `git mv` from `.claude/commands/validate-plugins.md` |
| `.claude-plugin/marketplace.json` | Task 6c | Modify (add entry) |
| `README.md` | Task 6d | Modify (add table row) |
| `plugins/plugin-validator/README.md` | Task 6e | Create |
| *(all above)* | Task 7 | Smoke check (no file changes) |
| *(all above)* | Task 8 | Stage + commit |

Tasks 1–6 all touch disjoint files and may be run in any order, but must all complete before task 7. Task 7 must complete before task 8.

---

## Task 1: Create plugin manifest

**Dependencies:** none
**Files touched:** Create `plugins/plugin-validator/.claude-plugin/plugin.json`
**Overlaps with:** nothing — unique file

- [ ] **Step 1: Create the directory tree**

  ```bash
  mkdir -p /path/to/worktree/plugins/plugin-validator/.claude-plugin
  mkdir -p /path/to/worktree/plugins/plugin-validator/skills
  mkdir -p /path/to/worktree/plugins/plugin-validator/agents
  mkdir -p /path/to/worktree/plugins/plugin-validator/commands
  ```

  Where `/path/to/worktree` = `.worktrees/superpower-plugin-validator` from repo root.
  Use the Write tool with an absolute path — do not use Bash echo/cat for file creation.

- [ ] **Step 2: Write `plugins/plugin-validator/.claude-plugin/plugin.json`**

  Exact content (verbatim — do not add or remove any keys):

  ```json
  {
    "name": "plugin-validator",
    "displayName": "Plugin Validator",
    "version": "0.1.0",
    "description": "Orchestrated validator for Claude Code plugins — validates skills, agents, commands, and hooks across every plugin under plugins/**.",
    "author": { "name": "Steven Hoang" },
    "keywords": ["validation", "linting", "plugin-authoring", "skills", "agents", "commands", "hooks"]
  }
  ```

  Rules:
  - No `skills` key (auto-discovered from `skills/*/SKILL.md`).
  - No `agents` key (rejected by loader — `agents: Invalid input`).
  - No `commands` key (rejected by loader — `commands: Invalid input`).
  - No `hooks` key (plugin has no runtime hooks).

- [ ] **Step 3: Verify the file parses**

  ```bash
  python3 -c "import json; json.load(open('plugins/plugin-validator/.claude-plugin/plugin.json')); print('OK')"
  ```

  Expected output: `OK`

**Verification:** `python3 -c "import json; json.load(open('plugins/plugin-validator/.claude-plugin/plugin.json')); print('OK')"` prints `OK`.

---

## Task 2: Move validate-skills SKILL.md

**Dependencies:** Task 1 (directory must exist)
**Files touched:** Move `.claude/skills/validate-skills/SKILL.md` → `plugins/plugin-validator/skills/validate-skills/SKILL.md`
**Overlaps with:** Tasks 3–5 are independent (different skill dirs)

**Edge case — upstream attribution:** `validate-skills/SKILL.md` carries Callstack attribution in YAML frontmatter (`author: Callstack`, `upstream: https://github.com/callstackincubator/agent-skills`, `license: MIT`). `git mv` preserves the file byte-for-byte. Do NOT rewrite, strip, or reorder any frontmatter fields.

- [ ] **Step 1: Create target directory and move file**

  ```bash
  mkdir -p plugins/plugin-validator/skills/validate-skills
  git mv .claude/skills/validate-skills/SKILL.md \
         plugins/plugin-validator/skills/validate-skills/SKILL.md
  ```

  Run from the worktree root (`.worktrees/superpower-plugin-validator`).

- [ ] **Step 2: Verify the move and attribution preservation**

  ```bash
  # New path exists
  ls plugins/plugin-validator/skills/validate-skills/SKILL.md

  # Upstream attribution intact (must show all three lines)
  grep -n "author:\|upstream:\|license:" plugins/plugin-validator/skills/validate-skills/SKILL.md
  ```

  Expected grep output (order may vary; all three must be present):
  ```
  6:  author: Callstack
  7:  upstream: https://github.com/callstackincubator/agent-skills
  5:license: MIT
  ```

  (Exact line numbers may differ — the important thing is all three values are present verbatim.)

- [ ] **Step 3: Verify git tracks the rename (not add+delete)**

  ```bash
  git status
  ```

  Expected: the file shows as `renamed: .claude/skills/validate-skills/SKILL.md -> plugins/plugin-validator/skills/validate-skills/SKILL.md` in staged changes.

**Verification:** File present at new path, `git status` shows rename (not deletion + addition), Callstack attribution intact.

---

## Task 3: Move validate-agents SKILL.md

**Dependencies:** Task 1 (directory must exist)
**Files touched:** Move `.claude/skills/validate-agents/SKILL.md` → `plugins/plugin-validator/skills/validate-agents/SKILL.md`
**Overlaps with:** Tasks 2, 4, 5 are independent (different skill dirs)

**Edge case:** The References block in this file points to `docs/superpowers/specs/2026-05-13-plugin-validation-skills-design.md`. That doc does not move. No link updates required — verify the reference remains intact after the move.

- [ ] **Step 1: Create target directory and move file**

  ```bash
  mkdir -p plugins/plugin-validator/skills/validate-agents
  git mv .claude/skills/validate-agents/SKILL.md \
         plugins/plugin-validator/skills/validate-agents/SKILL.md
  ```

- [ ] **Step 2: Verify move and reference preservation**

  ```bash
  ls plugins/plugin-validator/skills/validate-agents/SKILL.md

  # Confirm docs reference is intact
  grep "docs/superpowers/specs" plugins/plugin-validator/skills/validate-agents/SKILL.md
  ```

  Expected grep output:
  ```
  - Tool-list provenance: see `docs/superpowers/specs/2026-05-13-plugin-validation-skills-design.md` § Resolution 2
  ```

- [ ] **Step 3: Confirm git tracks rename**

  ```bash
  git status
  ```

  Expected: rename from `.claude/skills/validate-agents/SKILL.md` to `plugins/plugin-validator/skills/validate-agents/SKILL.md` in staged changes.

**Verification:** File at new path, `git status` shows rename, docs reference intact.

---

## Task 4: Move validate-commands SKILL.md

**Dependencies:** Task 1 (directory must exist)
**Files touched:** Move `.claude/skills/validate-commands/SKILL.md` → `plugins/plugin-validator/skills/validate-commands/SKILL.md`
**Overlaps with:** Tasks 2, 3, 5 are independent

- [ ] **Step 1: Create target directory and move file**

  ```bash
  mkdir -p plugins/plugin-validator/skills/validate-commands
  git mv .claude/skills/validate-commands/SKILL.md \
         plugins/plugin-validator/skills/validate-commands/SKILL.md
  ```

- [ ] **Step 2: Verify move**

  ```bash
  ls plugins/plugin-validator/skills/validate-commands/SKILL.md
  git status
  ```

  Expected: file at new path, `git status` shows rename.

**Verification:** File at new path, `git status` shows rename.

---

## Task 5: Move validate-hooks SKILL.md

**Dependencies:** Task 1 (directory must exist)
**Files touched:** Move `.claude/skills/validate-hooks/SKILL.md` → `plugins/plugin-validator/skills/validate-hooks/SKILL.md`
**Overlaps with:** Tasks 2, 3, 4 are independent

- [ ] **Step 1: Create target directory and move file**

  ```bash
  mkdir -p plugins/plugin-validator/skills/validate-hooks
  git mv .claude/skills/validate-hooks/SKILL.md \
         plugins/plugin-validator/skills/validate-hooks/SKILL.md
  ```

- [ ] **Step 2: Verify move**

  ```bash
  ls plugins/plugin-validator/skills/validate-hooks/SKILL.md
  git status
  ```

  Expected: file at new path, `git status` shows rename.

**Verification:** File at new path, `git status` shows rename.

---

## Task 6: Move agent + command, update manifests, write plugin README

**Dependencies:** Tasks 1–5 must all complete first (directories exist, skills moved)
**Files touched:** 5 files modified/created (listed below). These are all independent of each other within this task — they touch distinct files and can be done in any sub-order.
**Overlaps with:** None — all prior tasks are complete before this one starts.

### Task 6a: Move plugin-validator agent

**Files touched:** Move `.claude/agents/plugin-validator.md` → `plugins/plugin-validator/agents/plugin-validator.md`

**Edge case:** The `References` block in `plugin-validator.md` includes `Spec: docs/superpowers/specs/2026-05-13-plugin-validator-agent-design.md` and `Plan: docs/superpowers/plans/2026-05-13-plugin-validator-agent.md`. Those paths do not move. No content edits needed.

- [ ] **Step 1: Move the agent file**

  ```bash
  git mv .claude/agents/plugin-validator.md \
         plugins/plugin-validator/agents/plugin-validator.md
  ```

- [ ] **Step 2: Verify**

  ```bash
  ls plugins/plugin-validator/agents/plugin-validator.md
  # Confirm References block unchanged
  grep "docs/superpowers" plugins/plugin-validator/agents/plugin-validator.md
  ```

  Expected grep output: two lines containing `docs/superpowers/specs/...` and `docs/superpowers/plans/...`.

### Task 6b: Move validate-plugins command

**Files touched:** Move `.claude/commands/validate-plugins.md` → `plugins/plugin-validator/commands/validate-plugins.md`

- [ ] **Step 1: Move the command file**

  ```bash
  git mv .claude/commands/validate-plugins.md \
         plugins/plugin-validator/commands/validate-plugins.md
  ```

- [ ] **Step 2: Verify**

  ```bash
  ls plugins/plugin-validator/commands/validate-plugins.md
  git status
  ```

  Expected: rename staged.

### Task 6c: Add entry to marketplace.json

**Files touched:** Modify `.claude-plugin/marketplace.json`

Read the file first (required before Edit). Then append the new entry as the last element in the `plugins[]` array.

- [ ] **Step 1: Add the new plugin entry**

  Edit `.claude-plugin/marketplace.json`. The `plugins` array currently ends with the `team-superpower` entry. Add the following as the fourth element (after `team-superpower`, before the closing `]`):

  ```json
    {
      "name": "plugin-validator",
      "source": "./plugins/plugin-validator",
      "description": "Orchestrated validator for Claude Code plugins — validates skills, agents, commands, and hooks across every plugin under plugins/**.",
      "version": "0.1.0",
      "category": "tooling",
      "keywords": ["validation", "linting", "plugin-authoring", "skills", "agents", "commands", "hooks"]
    }
  ```

  Resulting `plugins` array (4 entries total):

  ```json
  "plugins": [
    {
      "name": "tech-graph",
      ...
    },
    {
      "name": "html-effectiveness",
      ...
    },
    {
      "name": "team-superpower",
      ...
    },
    {
      "name": "plugin-validator",
      "source": "./plugins/plugin-validator",
      "description": "Orchestrated validator for Claude Code plugins — validates skills, agents, commands, and hooks across every plugin under plugins/**.",
      "version": "0.1.0",
      "category": "tooling",
      "keywords": ["validation", "linting", "plugin-authoring", "skills", "agents", "commands", "hooks"]
    }
  ]
  ```

- [ ] **Step 2: Verify JSON parses**

  ```bash
  python3 -c "import json; d = json.load(open('.claude-plugin/marketplace.json')); print(len(d['plugins']), 'plugins')"
  ```

  Expected: `4 plugins`

### Task 6d: Add row to root README.md

**Files touched:** Modify `README.md`

Read the file first. The Plugins table currently has 3 rows (tech-graph, html-effectiveness, team-superpower). Add the fourth row immediately after the `team-superpower` row.

- [ ] **Step 1: Add plugin-validator row to Plugins table**

  The new row to insert after `| [\`team-superpower\`](plugins/team-superpower) | ... |`:

  ```markdown
  | [`plugin-validator`](plugins/plugin-validator) | Orchestrated validator that checks every plugin's skills, agents, commands, and hooks for spec compliance — runs in parallel and proposes batched fixes. |
  ```

- [ ] **Step 2: Verify row is present**

  ```bash
  grep "plugin-validator" README.md
  ```

  Expected: one line containing `plugin-validator` linking to `plugins/plugin-validator`.

### Task 6e: Write plugin README

**Files touched:** Create `plugins/plugin-validator/README.md`

- [ ] **Step 1: Write `plugins/plugin-validator/README.md`**

  Exact content:

  ```markdown
  # plugin-validator

  Orchestrated validator for Claude Code plugins. Validates skills, agents, commands, and hooks across every plugin under `plugins/**`. Runs sub-validators in parallel and proposes batched fixes.

  ## Install

  ```text
  /plugin marketplace add baoduy/agents-and-skills
  /plugin install plugin-validator@drunkcoding
  ```

  ## Usage

  Run the full validator across all plugins:

  ```text
  /validate-plugins
  ```

  Or invoke individual sub-validators directly:

  | Invocation | What it checks |
  |------------|----------------|
  | `/validate-skills` | `SKILL.md` frontmatter and body in all plugins |
  | `/validate-agents` | Agent `.md` files in all plugins |
  | `/validate-commands` | Slash-command `.md` files in all plugins |
  | `/validate-hooks` | `plugin.json` hooks fields and `hooks.json` in all plugins |

  ## What it produces

  - A per-plugin report section with `[PASS]` / `[FAIL]` / `[WARN]` per check.
  - A summary table: `| Plugin | Skills | Hooks | Agents | Commands | Status |`.
  - A batched `## Proposed Fixes` block — choose `Apply all`, `Choose per-item`, or `Skip all`.

  ## Scope

  Scans `plugins/**` only. Local `.claude/` artifacts and vendored paths (e.g. `plugins/tech-graph/skills/tech-graph/`) are excluded.
  ```

- [ ] **Step 2: Verify file exists**

  ```bash
  ls plugins/plugin-validator/README.md
  ```

**Verification (whole Task 6):** All 5 sub-tasks complete — agent and command at new paths, marketplace.json has 4 plugins, README.md has plugin-validator row, plugin README exists.

---

## Task 7: Smoke check (pre-commit verification)

**Dependencies:** Tasks 1–6 all complete
**Files touched:** none (read-only checks)

This task runs all checks from design §7. Every check must pass before the commit in Task 8.

- [ ] **Step 1: JSON validity**

  ```bash
  python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
  ```

  Expected: `OK`

- [ ] **Step 2: All six moved files present at new paths**

  ```bash
  ls plugins/plugin-validator/skills/validate-skills/SKILL.md && echo "validate-skills OK"
  ls plugins/plugin-validator/skills/validate-agents/SKILL.md && echo "validate-agents OK"
  ls plugins/plugin-validator/skills/validate-commands/SKILL.md && echo "validate-commands OK"
  ls plugins/plugin-validator/skills/validate-hooks/SKILL.md && echo "validate-hooks OK"
  ls plugins/plugin-validator/agents/plugin-validator.md && echo "agent OK"
  ls plugins/plugin-validator/commands/validate-plugins.md && echo "command OK"
  ```

  Expected: all six echo lines print.

- [ ] **Step 3: Originals absent from .claude/**

  ```bash
  test ! -e .claude/skills/validate-skills/SKILL.md && echo "OK: validate-skills removed"
  test ! -e .claude/skills/validate-agents/SKILL.md && echo "OK: validate-agents removed"
  test ! -e .claude/skills/validate-commands/SKILL.md && echo "OK: validate-commands removed"
  test ! -e .claude/skills/validate-hooks/SKILL.md && echo "OK: validate-hooks removed"
  test ! -e .claude/agents/plugin-validator.md && echo "OK: agent removed"
  test ! -e .claude/commands/validate-plugins.md && echo "OK: command removed"
  ```

  Expected: all six echo lines print.

- [ ] **Step 4: Callstack attribution intact in validate-skills**

  ```bash
  grep "author: Callstack" plugins/plugin-validator/skills/validate-skills/SKILL.md && echo "attribution OK"
  grep "upstream: https://github.com/callstackincubator/agent-skills" plugins/plugin-validator/skills/validate-skills/SKILL.md && echo "upstream OK"
  ```

  Expected: both echo lines print.

- [ ] **Step 5: marketplace.json has plugin-validator entry**

  ```bash
  python3 -c "import json; d=json.load(open('.claude-plugin/marketplace.json')); names=[p['name'] for p in d['plugins']]; assert 'plugin-validator' in names, 'MISSING'; print('plugin-validator present')"
  ```

  Expected: `plugin-validator present`

- [ ] **Step 6: README.md contains plugin-validator row**

  ```bash
  grep "plugin-validator" README.md | grep "plugins/plugin-validator"
  ```

  Expected: one matching line.

- [ ] **Step 7: plugin.json has no forbidden keys**

  ```bash
  python3 -c "
  import json
  d = json.load(open('plugins/plugin-validator/.claude-plugin/plugin.json'))
  forbidden = {'skills', 'agents', 'commands', 'hooks'}
  found = forbidden & set(d.keys())
  assert not found, f'FORBIDDEN KEYS PRESENT: {found}'
  print('No forbidden keys — OK')
  "
  ```

  Expected: `No forbidden keys — OK`

**If any check fails:** Do not proceed to Task 8. Fix the failing check inline, then re-run the full Task 7 sequence before continuing.

**Verification:** All seven steps print their expected output with no errors.

---

## Task 8: Stage all changes and commit atomically

**Dependencies:** Task 7 smoke check fully green
**Files touched:** all files from Tasks 1–6 (staged in one commit)

This is the single atomic commit covering all moves, the new plugin.json, manifest update, README update, and plugin README.

- [ ] **Step 1: Stage all changes**

  Stage by explicit file paths to avoid accidentally including unrelated files:

  ```bash
  git add plugins/plugin-validator/.claude-plugin/plugin.json
  git add plugins/plugin-validator/skills/validate-skills/SKILL.md
  git add plugins/plugin-validator/skills/validate-agents/SKILL.md
  git add plugins/plugin-validator/skills/validate-commands/SKILL.md
  git add plugins/plugin-validator/skills/validate-hooks/SKILL.md
  git add plugins/plugin-validator/agents/plugin-validator.md
  git add plugins/plugin-validator/commands/validate-plugins.md
  git add plugins/plugin-validator/README.md
  git add .claude-plugin/marketplace.json
  git add README.md
  ```

  The `git mv` operations in Tasks 2–6b already stage the deletions from `.claude/`; those are automatically included.

- [ ] **Step 2: Verify staged diff before committing**

  ```bash
  git status
  ```

  Expected staged changes (all 10 new/modified paths plus 6 deletions from `.claude/`):
  - 6 renames: `.claude/skills/validate-*/SKILL.md` → `plugins/plugin-validator/skills/validate-*/SKILL.md`
  - 2 renames: `.claude/agents/plugin-validator.md` → `plugins/plugin-validator/agents/plugin-validator.md`, `.claude/commands/validate-plugins.md` → `plugins/plugin-validator/commands/validate-plugins.md`
  - 2 new files: `plugins/plugin-validator/.claude-plugin/plugin.json`, `plugins/plugin-validator/README.md`
  - 2 modified: `.claude-plugin/marketplace.json`, `README.md`

  There must be no unexpected staged files. If `git status` shows anything extra, unstage it with `git restore --staged <file>` before committing.

- [ ] **Step 3: Commit**

  ```bash
  git commit -m "$(cat <<'EOF'
  feat(plugin-validator): package validate-* skills, agent, and command as installable plugin

  Moves .claude/skills/validate-{skills,agents,commands,hooks}/SKILL.md,
  .claude/agents/plugin-validator.md, and .claude/commands/validate-plugins.md
  into plugins/plugin-validator/. Adds plugin.json manifest, marketplace.json
  entry, root README row, and plugin README. Follows design §8.1 single atomic
  commit strategy.

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **Step 4: Verify commit landed**

  ```bash
  git log --oneline -3
  git show --stat HEAD
  ```

  Expected: the new commit is at HEAD, `git show --stat` lists all 10 target paths plus the 6 deletions from `.claude/`.

- [ ] **Step 5: Final post-commit JSON baseline**

  ```bash
  python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
  ```

  Expected: `OK`

**Verification:** `git show --stat HEAD` shows exactly the expected 18 file changes (6 renames + 2 more renames + 2 new + 2 modified), and final JSON baseline prints `OK`.

---

## Out of Scope

The following are explicitly excluded from this plan:

- `.claude/skills/gitnexus/` — four gitnexus skills stay under `.claude/` (design §4, §8 Risk 4).
- npm publishing — CI handles version bumps and publish on push to `main`.
- Version bumps — `0.1.0` stays in source; CI rewrites on release.
- Any changes to validation logic inside the SKILL.md files.
- The in-Claude-Code local install smoke test (`/plugin marketplace add file://$(pwd)` + `/plugin install plugin-validator@drunkcoding`) — this is a post-commit manual verification step that requires an active Claude Code session with the worktree open, not an automated check.

---

## Self-Review Against Design Doc

| Design requirement | Covered by |
|--------------------|-----------|
| §2 directory layout | Tasks 1–6e create all dirs and files |
| §3 Move (cut) decision — no copies | `git mv` in Tasks 2–6b removes originals |
| §3 validate-skills Callstack attribution preserved verbatim | Task 2 + Task 7 step 4 |
| §3 no edits to discovery scopes in any SKILL.md | No SKILL.md content changes in any task |
| §4 manifest shape — exact JSON, no forbidden keys | Task 1 + Task 7 step 7 |
| §5 marketplace.json entry | Task 6c |
| §5 README.md row | Task 6d |
| §7 smoke checks | Task 7 steps 1–7 |
| §8.1 single atomic commit | Task 8 |
| §8 Risk 3 — six-file list is final | Tasks 2–6b cover exactly 6 files; no re-audit |
| §8 Risk 4 — gitnexus stays untouched | Out of scope section |
