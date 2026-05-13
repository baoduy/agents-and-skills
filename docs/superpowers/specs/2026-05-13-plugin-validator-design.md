# Design: plugin-validator Plugin (Phase 1)

**Date:** 2026-05-13
**Slug:** plugin-validator
**Status:** APPROVED
**Author:** Designer agent (team-superpower run)

---

## §1 Goal & Scope

**Goal:** Package the four validate-* skills, the `plugin-validator` orchestrator agent, and the `validate-plugins` slash command into a proper plugin at `plugins/plugin-validator/` so they are shipped via npm and installable by any `@drunkcoding/agents-and-skills` consumer. Today these six artifacts live under `.claude/` and are available only in this repo's local Claude Code session.

**Non-goals:**

- No new validation logic is added. This is a packaging operation only.
- No changes to what the validators check, how they report, or how they propose fixes.
- No changes to any other existing plugin.
- The four skills under `.claude/skills/gitnexus/` are explicitly out of scope — they stay where they are.
- No `npm publish` step — CI rewrites versions on push to `main`; the planner does not bump versions or publish manually.

---

## §2 Plugin Directory Layout

```
plugins/plugin-validator/
  .claude-plugin/
    plugin.json                         ← manifest (name, version, description, author, keywords only)
  skills/
    validate-skills/
      SKILL.md                          ← moved from .claude/skills/validate-skills/SKILL.md
    validate-agents/
      SKILL.md                          ← moved from .claude/skills/validate-agents/SKILL.md
    validate-commands/
      SKILL.md                          ← moved from .claude/skills/validate-commands/SKILL.md
    validate-hooks/
      SKILL.md                          ← moved from .claude/skills/validate-hooks/SKILL.md
  agents/
    plugin-validator.md                 ← moved from .claude/agents/plugin-validator.md
  commands/
    validate-plugins.md                 ← moved from .claude/commands/validate-plugins.md
  README.md                             ← brief plugin README (install + usage)
```

No `hooks/`, `scripts/`, or `assets/` subdirectories — this plugin is pure skills, agent, and command.

---

## §3 Source-of-Truth Decision

**Decision: Move (cut from `.claude/` into the plugin; delete originals).** No copies, no symlinks, no pointer stubs.

Rationale:

- Single source of truth eliminates drift risk between `.claude/` and `plugins/plugin-validator/`.
- Aligns with the repo "Ship rule: only `plugins/` is shipped" in `CLAUDE.md`.
- The repo can self-validate by installing the plugin locally via `/plugin marketplace add file://$(pwd)` then `/plugin install plugin-validator@drunkcoding` — the same path as any consumer.
- The four validator skills' discovery scopes are already `plugins/**`; they continue to work unchanged after the move.

**Per-file decisions:**

| File | Action | Notes |
|------|--------|-------|
| `.claude/skills/validate-skills/SKILL.md` | Move to `plugins/plugin-validator/skills/validate-skills/SKILL.md` | Discovery section uses `plugins/`; no edits needed. Upstream Callstack attribution in frontmatter (`author: Callstack`, `upstream: https://github.com/callstackincubator/agent-skills`) must be preserved verbatim. |
| `.claude/skills/validate-agents/SKILL.md` | Move to `plugins/plugin-validator/skills/validate-agents/SKILL.md` | Discovery scopes to `plugins/**`; no edits needed. |
| `.claude/skills/validate-commands/SKILL.md` | Move to `plugins/plugin-validator/skills/validate-commands/SKILL.md` | Discovery scopes to `plugins/**`; no edits needed. |
| `.claude/skills/validate-hooks/SKILL.md` | Move to `plugins/plugin-validator/skills/validate-hooks/SKILL.md` | Discovery scopes to `plugins/**`; no edits needed. |
| `.claude/agents/plugin-validator.md` | Move to `plugins/plugin-validator/agents/plugin-validator.md` | `References` block points to `docs/superpowers/specs/...` paths which remain valid — those docs do not move. |
| `.claude/commands/validate-plugins.md` | Move to `plugins/plugin-validator/commands/validate-plugins.md` | Five-line body; no internal path references to update. |

**Out of scope (do not touch):**

- `.claude/skills/gitnexus/` — four gitnexus skills stay where they are.
- Any other file under `.claude/`.

**Discovery scope after the move:** The four skills scan `plugins/**`, which will now include `plugins/plugin-validator/` itself. This is correct: the plugin is spec-compliant and self-validates on every run. No scope changes are needed in any SKILL.md.

**Six-file move list is complete and confirmed.** `find .claude/commands` returns only `validate-plugins.md`. The invocations `/validate-skills`, `/validate-agents`, `/validate-commands`, and `/validate-hooks` are direct skill invocations, not slash-command files — no per-skill command files exist in `.claude/commands/`. The planner does not need to re-audit.

---

## §4 Manifest Shape

`plugins/plugin-validator/.claude-plugin/plugin.json`:

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

**Fields deliberately omitted:**

- No `skills` key — auto-discovered from `skills/*/SKILL.md`.
- No `agents` key — rejected by the plugin loader (`agents: Invalid input`); auto-discovered from `agents/*.md`.
- No `commands` key — rejected by the plugin loader (`commands: Invalid input`); auto-discovered from `commands/*.md`.
- No `hooks` key — this plugin has no runtime hooks.

This follows the `html-effectiveness` pattern (minimal manifest). The `team-superpower` manifest adds `hooks` only because it needs runtime hook scripts; `plugin-validator` does not.

---

## §5 Marketplace and README Updates

**`.claude-plugin/marketplace.json`** — add one entry to the `plugins[]` array:

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

**`README.md`** — add one row to the Plugins table:

```markdown
| [`plugin-validator`](plugins/plugin-validator) | Orchestrated validator that checks every plugin's skills, agents, commands, and hooks for spec compliance — runs in parallel and proposes batched fixes. |
```

Both updates must land in the same commit as the file moves and the new `plugin.json` (see §8, risk 1).

---

## §6 Compatibility and Self-Validation

After the move, running `/validate-plugins` (or the `plugin-validator` agent) enumerates `plugins/plugin-validator/` alongside all other plugins. The artifacts inside the plugin must themselves pass validation:

| Artifact | Compliance status |
|----------|------------------|
| `validate-skills/SKILL.md` | Valid frontmatter, `name` matches directory, description within 1024 chars, body under 500 lines. Compliant. |
| `validate-agents/SKILL.md` | Valid frontmatter, `name` matches directory, description within 1024 chars, body under 500 lines. Compliant. |
| `validate-commands/SKILL.md` | Valid frontmatter, `name` matches directory, description within 1024 chars, body under 500 lines. Compliant. |
| `validate-hooks/SKILL.md` | Valid frontmatter, `name` matches directory, description within 1024 chars, body under 500 lines. Compliant. |
| `agents/plugin-validator.md` | `name: plugin-validator` matches filename, `tools` list uses only valid Claude Code tool names, `model: sonnet`, body has `## Discovery` / `## Parallel Dispatch` / `## Aggregation` / `## Constraints` sections. Compliant. |
| `commands/validate-plugins.md` | No `commands` key in manifest, body non-empty, no `$ARGUMENTS` so `argument-hint` not required. Compliant. |
| `.claude-plugin/plugin.json` | No `agents`, `commands`, or array-form `skills` keys. Compliant with loader rules (memory S1276). |

No false positives expected. The plugin validates itself cleanly on first run.

---

## §7 Self-Test and Smoke Check

After the planner implements the move, the verifier runs the following checks in order:

```bash
# 1. JSON validity — all manifests parse
python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"

# 2. File presence — all six moved files exist at new paths
ls plugins/plugin-validator/skills/validate-skills/SKILL.md
ls plugins/plugin-validator/skills/validate-agents/SKILL.md
ls plugins/plugin-validator/skills/validate-commands/SKILL.md
ls plugins/plugin-validator/skills/validate-hooks/SKILL.md
ls plugins/plugin-validator/agents/plugin-validator.md
ls plugins/plugin-validator/commands/validate-plugins.md

# 3. Originals removed from .claude/
test ! -e .claude/skills/validate-skills/SKILL.md && echo "OK: validate-skills removed"
test ! -e .claude/skills/validate-agents/SKILL.md && echo "OK: validate-agents removed"
test ! -e .claude/skills/validate-commands/SKILL.md && echo "OK: validate-commands removed"
test ! -e .claude/skills/validate-hooks/SKILL.md && echo "OK: validate-hooks removed"
test ! -e .claude/agents/plugin-validator.md && echo "OK: agent removed"
test ! -e .claude/commands/validate-plugins.md && echo "OK: command removed"

# 4. Local install smoke test (in Claude Code session)
# /plugin marketplace add file://$(pwd)
# /plugin install plugin-validator@drunkcoding
# /validate-plugins   ← must produce per-plugin report + summary table with no loader errors
```

The smoke test passes when `/validate-plugins` produces a full per-plugin report and summary table, and the `plugin-validator` plugin row in the summary shows `PASS` across all four sub-skills.

---

## §8 Open Questions and Risks for the Planner

**Risk 1 — Atomic commit strategy (recommendation: single commit).**
The planner must land the file moves, the `.claude/` deletions, the new `plugin.json`, the `marketplace.json` entry, and the `README.md` row in one atomic commit. A two-commit approach (add then delete) leaves the repo in a state where both copies coexist and the validators could report duplicate results mid-flight. Single commit eliminates this window.

**Risk 2 — `validate-skills` upstream attribution.**
`validate-skills/SKILL.md` carries Callstack upstream attribution (`author: Callstack`, `upstream: https://github.com/callstackincubator/agent-skills`, `license: MIT`) in its YAML frontmatter. The planner must copy the file byte-for-byte; do not strip or rewrite the frontmatter.

**Risk 3 — Six-file move list is final (no re-audit needed).**
Confirmed by the lead: `find .claude/commands` returns only `validate-plugins.md`. The invocations `/validate-skills`, `/validate-agents`, `/validate-commands`, and `/validate-hooks` are direct skill invocations, not slash-command `.md` files. The six files listed in §3 are the complete set. The planner does not need to re-audit `.claude/commands/`.

**Risk 4 — `.claude/skills/gitnexus/` is out of scope.**
The four gitnexus skills under `.claude/skills/gitnexus/` are local infrastructure, not part of this plugin. The planner must not touch them.

**Risk 5 — `validate-agents` sibling-skill reference.**
`validate-agents/SKILL.md` has a `References` block pointing to `docs/superpowers/specs/2026-05-13-plugin-validation-skills-design.md`. That doc exists and does not move. No link updates required.
