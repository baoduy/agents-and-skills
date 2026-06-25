# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

Personal Claude Code **plugin marketplace** (`drunkcoding`) published as the npm package `@drunkcoding/agents-and-skills`. Each plugin lives under `plugins/<name>/` and ships its own agents, commands, skills, scripts, and assets.

## Layout

- `.claude-plugin/marketplace.json` — marketplace manifest. Lists every plugin under `plugins/`. Single source of truth for what ships.
- `plugins/<name>/.claude-plugin/plugin.json` — per-plugin manifest (`name`, `version`, `description`). Do NOT add a `skills` key — skills, agents, and commands are auto-discovered by convention from their respective subdirectories.
- `plugins/<name>/{agents,commands,skills,scripts,assets,templates,...}/` — plugin contents. Auto-discovered by convention unless the plugin manifest explicitly lists them.
- `package.json` — npm metadata for `@drunkcoding/agents-and-skills`. `files` whitelist publishes **only** `plugins/**`, `.claude-plugin/marketplace.json`, `README.md`, `LICENSE`. Versions are auto-rewritten by `.github/workflows/npm-publish.yaml` (via `paulhatch/semantic-version`) — the workflow updates the root `package.json` version plus every `plugins/*/.claude-plugin/plugin.json` and the per-plugin `version` inside `marketplace.json` on push to `main`.
- `.npmignore` — excludes `.git`, `.claude/`, `docs/`, internal markdown (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`). The `files` whitelist in `package.json` takes precedence.
- `AGENTS.md` — symlink to `CLAUDE.md` for non-Claude agent runtimes. Edit `CLAUDE.md` only.
- `plugins/tech-graph/skills/tech-graph/` — vendored from upstream `fireworks-tech-graph` via `git subtree --squash`. **Never edit files inside this path directly** — direct edits conflict on next sync. Pull upstream with `git subtree pull --prefix=plugins/tech-graph/skills/tech-graph https://github.com/yizhiyanhua-ai/fireworks-tech-graph.git main --squash`.

## Working in this repo

- **Ship rule: only the `plugins/` folder is shipped.** Nothing outside `plugins/` (e.g. top-level `agents/`, `scripts/`, `.claude/skills/`) reaches npm or marketplace consumers — the `files` whitelist in `package.json` and the plugin list in `marketplace.json` both enforce this. Do not add plugin content outside `plugins/<name>/`.
- **Implementation edit rule: feature work edits files inside `plugins/<name>/` only.** Do NOT modify `.claude/`, `.agents/`, or any other top-level directory while implementing a plugin feature. Design / plan / review docs may live under `docs/superpowers/`; repo-level config (`CLAUDE.md`, `package.json`, `marketplace.json`, `README.md`) may only change when the feature explicitly requires it (e.g. adding/renaming a plugin per the rule below). All agent / skill / hook / command source code stays under `plugins/<name>/`.
- **When adding, removing, or renaming a plugin, update ALL of the following together in one commit:**
  1. `plugins/<name>/.claude-plugin/plugin.json` — create/update/delete the per-plugin manifest.
  2. `.claude-plugin/marketplace.json` — add/remove/rename the matching entry in `plugins[]` (`name`, `source`, `description`, `version`, `category`, `keywords`).
  3. `README.md` — add/remove the row in the Plugins table.
  4. `package.json` — no change needed (`files: ["plugins/**", ...]` already covers any new plugin); only touch if a new top-level file needs shipping, which should be rare.
- Edits to a single plugin (skill prose, agent prompt, script tweak) only touch files inside that plugin's directory — no manifest churn needed.
- Plugin and root `version` fields stay at `0.1.0` in source; CI rewrites them on release. Do not bump versions by hand unless cutting a manual release.
- Tests live at the **repo-root `tests/<plugin>/`** tree (not inside `plugins/`, so they are not packaged for npm). Run Node tests with `node --test tests/<plugin>/*.test.js` and bash tests with `bash tests/<plugin>/<file>.test.sh`. Run `npm publish --access public` only when explicitly asked.
- After manifest edits, validate before committing:
  ```bash
  python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
  ```
  For a full smoke test inside Claude Code: `/plugin marketplace add file://$(pwd)` then `/plugin install <name>@drunkcoding`.
- **When adding or editing a `SKILL.md` under `plugins/<name>/skills/<skill>/`, run the `validate-skills` skill against it** before committing. Committed at `.claude/skills/validate-skills/` (vendored from `callstackincubator/agent-skills`, MIT). Already adapted to scan `plugins/` + `.claude/skills/` — invoke via `/validate-skills` in Claude Code.
- **After completing any plugin implementation, run the `plugin-validator` agent against the plugin** before marking work done. Invoke via the `plugin-validator:plugin-validator` agent type or `/plugin-validator` command. It validates skills, agents, commands, and hooks and proposes fixes for any `[FAIL]` items. A "skill is invalid" error at runtime is a sign this step was skipped.
- House style: minimal diff, no scope creep, preserve existing prose unless the task requires changes. Think before coding; surgical edits only.

## Plugin Workflow

### Create a plugin

1. Create `plugins/<name>/` with `.claude-plugin/plugin.json` (`name`, `version: "0.1.0"`, `description`).
2. Add entry to `.claude-plugin/marketplace.json` → `plugins[]`.
3. Build plugin content inside `plugins/<name>/` (agents, skills, commands, scripts, etc.).
4. If any `SKILL.md` was added — run `/validate-skills` and fix all `[FAIL]` items.
5. Run `plugin-validator` agent — fix all `[FAIL]` items before continuing.
6. Update `README.md` — add row to the Plugins table.
7. Validate manifests:
   ```bash
   python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
   ```
8. Commit all files in one commit.

### Edit a plugin

1. Edit files inside `plugins/<name>/` only — no manifest or README changes unless renaming.
2. If any `SKILL.md` was added or changed — run `/validate-skills` and fix all `[FAIL]` items.
3. Run `plugin-validator` agent — fix all `[FAIL]` items before marking work done.
4. Commit.

### Delete a plugin

1. Remove `plugins/<name>/` directory.
2. Remove the entry from `.claude-plugin/marketplace.json`.
3. Remove the row from `README.md`.
4. Validate manifests (same command as Create step 7).
5. Commit all removals in one commit.

## Agent team best practices (when designing or editing team plugins)

These rules apply when working on `plugins/team-superpower/` (or any future plugin that orchestrates a Claude Code agent team). They reflect the official Claude Code "Creating Agent Teams" guidance and what we've learned shipping `team-superpower`.

1. **Team size.** Aim for **3–5 teammates** working in parallel at any one time, with **5–6 tasks per teammate**. Lifetime role count may legitimately be larger (`team-superpower` defines 8 roles) provided phase-gated spawning keeps **concurrent** teammates ≤ 5. Document the concurrency model in the plugin README when the lifetime role count exceeds 5.
2. **Distinct, non-overlapping roles.** Each teammate gets a clear write-scope and a clear read-scope. If two roles can write to the same file, merge them or add a sequencing gate. Cross-cutting concerns (security, architecture) review but never write.
3. **Task sizing.** Tasks must be **2–5 minutes** of work with exact file paths, complete code references, and explicit verification steps. Sub-2-minute tasks should be merged; tasks crossing 5 minutes should be split. **If one teammate would receive more than ~12 tasks, surface a "split the feature" escalation rather than continuing** — the docs' 5–6 target is the load-bearing number.
4. **Avoid file conflicts.** Every plan task must declare the files it will touch. The lead serializes any two tasks that overlap in file scope. Implementers running in parallel must own disjoint directories or have an explicit publish/consume gate (e.g. contracts).
5. **Spawn context.** A teammate inherits project context (CLAUDE.md, MCP servers, skills) but **NOT** the lead's conversation. Every spawn prompt must explicitly hand over: the slug, the role's relevant artefact paths, the stack shape (where applicable), open escalations, and whether this is a fresh spawn or a resume. Use a spawn-prompt template — do not improvise prompts per teammate.
6. **Start with research/review.** When introducing a new agent-team workflow, pilot it on read-only or review-style tasks before letting it write production code. `team-superpower`'s phase chain (design → plan → arch+sec → impl → QA → review) reflects this — research and review precede every write.
7. **Monitor and steer.** The lead must heartbeat at every phase boundary AND detect within-phase stalls (no mailbox activity or task transitions for `limits.phase_stall_minutes`, default 30 → ping the teammate and, if still silent, escalate via §7). Passive mailbox-only waiting is a bug.
8. **Lead never implements.** The lead is a conductor. It must not run Superpowers (or any feature-writing) skills itself, must not edit feature code, and must not start its own work in parallel with teammates. Wait for the relevant PASSED signal before advancing.

When adding new roles or new commands to a team plugin, write the change against this checklist and call out which item drove the design.
