# Tech-Graph Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the `neptune` repo into a Claude Code plugin marketplace and ship its first plugin, `tech-graph`: a 6-step wizard (subagent + slash command) that delegates SVG/PNG rendering to the upstream `fireworks-tech-graph` skill pulled in via `git subtree`.

**Architecture:** Marketplace at repo root (`.claude-plugin/marketplace.json`) registers a single plugin under `plugins/tech-graph/`. The plugin exposes (a) a slash command `/tech-graph` that dispatches a subagent, (b) a subagent `tech-graph` that walks the user through 6 multiple-choice steps and accumulates state in JSON, and (c) the upstream skill at `plugins/tech-graph/skills/tech-graph/` (git subtree, kept verbatim). A `check-deps.sh` script probes for renderers in order (`cairosvg` → `rsvg-convert` → `puppeteer`) and fails fast with the exact install command when none is found.

**Tech Stack:** Markdown (plugin manifests + agent/command frontmatter), Bash (dep probe), Python 3.8+ (upstream rendering), `cairosvg` / `rsvg-convert` / `puppeteer` (renderer alternatives), `git subtree --squash`.

---

## File Structure

```
neptune/
├── .claude-plugin/
│   └── marketplace.json                # NEW — top-level marketplace listing
├── plugins/
│   └── tech-graph/
│       ├── .claude-plugin/
│       │   └── plugin.json             # NEW — plugin manifest
│       ├── agents/
│       │   └── tech-graph.md           # NEW — wizard subagent
│       ├── commands/
│       │   └── tech-graph.md           # NEW — slash command
│       ├── scripts/
│       │   └── check-deps.sh           # NEW — renderer probe
│       ├── skills/
│       │   └── tech-graph/             # NEW — git subtree of upstream (verbatim)
│       └── README.md                   # NEW — install + deps + draw.io MCP doc
├── docs/superpowers/
│   ├── specs/2026-05-12-tech-graph-plugin-design.md   # (exists)
│   └── plans/2026-05-12-tech-graph-plugin.md          # THIS FILE
├── CONTRIBUTING.md                     # NEW — subtree sync workflow
└── README.md                           # MODIFY — add marketplace install instructions
```

**Responsibility map:**

- `marketplace.json` — only lists plugins, never holds plugin internals.
- `plugin.json` — name/version/description for the tech-graph plugin only.
- `agents/tech-graph.md` — wizard behavior (system prompt + 6-step protocol).
- `commands/tech-graph.md` — thin slash entrypoint that dispatches the subagent with optional `$ARGUMENTS`.
- `scripts/check-deps.sh` — pure bash probe; no rendering logic.
- `skills/tech-graph/` — untouched upstream subtree; never edited directly.
- `README.md` (plugin) — user-facing deps + draw.io MCP snippet.
- `CONTRIBUTING.md` (repo root) — maintainer-facing subtree pull/push workflow.

---

## Task 1: Bootstrap marketplace + plugin manifests

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `plugins/tech-graph/.claude-plugin/plugin.json`

- [ ] **Step 1: Create marketplace manifest**

Write `.claude-plugin/marketplace.json`:

```json
{
  "name": "neptune",
  "owner": { "name": "steven", "email": "steven.hoang@transwap.com" },
  "metadata": { "description": "Personal agents and skills marketplace" },
  "plugins": [
    {
      "name": "tech-graph",
      "source": "./plugins/tech-graph",
      "description": "6-step wizard for technical diagrams (SVG/PNG) via fireworks-tech-graph",
      "version": "0.1.0",
      "category": "diagram",
      "keywords": ["diagram", "svg", "architecture", "uml", "flowchart"]
    }
  ]
}
```

- [ ] **Step 2: Create plugin manifest**

Write `plugins/tech-graph/.claude-plugin/plugin.json`:

```json
{
  "name": "tech-graph",
  "version": "0.1.0",
  "description": "Step-by-step wizard for generating technical diagrams as SVG+PNG.",
  "author": { "name": "steven" },
  "keywords": ["diagram", "svg", "architecture", "uml", "flowchart", "sequence", "er"]
}
```

- [ ] **Step 3: Verify both files parse as valid JSON**

Run: `python3 -c "import json; json.load(open('.claude-plugin/marketplace.json')); json.load(open('plugins/tech-graph/.claude-plugin/plugin.json')); print('OK')"`
Expected stdout: `OK`

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/marketplace.json plugins/tech-graph/.claude-plugin/plugin.json
git commit -m "feat(tech-graph): scaffold marketplace and plugin manifests"
```

---

## Task 2: Pull upstream skill via git subtree

**Files:**
- Create (via subtree): `plugins/tech-graph/skills/tech-graph/` (entire upstream repo content)

- [ ] **Step 1: Ensure working tree is clean before subtree pull**

Run: `git status --porcelain`
Expected: empty output. If not empty, commit or stash first.

- [ ] **Step 2: Add the upstream as a squashed subtree**

Run:
```bash
git subtree add \
  --prefix=plugins/tech-graph/skills/tech-graph \
  https://github.com/yizhiyanhua-ai/fireworks-tech-graph.git main --squash
```

Expected: two new commits — `Squashed 'plugins/tech-graph/skills/tech-graph/' content from commit <sha>` and `Merge commit '<sha>' as 'plugins/tech-graph/skills/tech-graph'`.

- [ ] **Step 3: Verify upstream files landed**

Run: `ls plugins/tech-graph/skills/tech-graph/SKILL.md plugins/tech-graph/skills/tech-graph/scripts plugins/tech-graph/skills/tech-graph/templates`
Expected: all three paths exist (no `ls: cannot access` errors).

- [ ] **Step 4: Verify upstream `SKILL.md` is verbatim (size matches GitHub)**

Run: `wc -c plugins/tech-graph/skills/tech-graph/SKILL.md`
Expected: 26205 bytes (matches `gh api repos/yizhiyanhua-ai/fireworks-tech-graph/contents/SKILL.md --jq .size`).

No commit step — `git subtree add` commits automatically.

---

## Task 3: Renderer probe script

**Files:**
- Create: `plugins/tech-graph/scripts/check-deps.sh`

- [ ] **Step 1: Write the probe script**

Write `plugins/tech-graph/scripts/check-deps.sh`:

```bash
#!/usr/bin/env bash
# check-deps.sh — probe SVG→PNG renderers for tech-graph plugin.
# Probes in order: cairosvg (python) → rsvg-convert (system) → puppeteer (node).
# Writes the first available choice to skills/tech-graph/.renderer.
# Exits 0 on success, 1 if none found (prints exact install cmd).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RENDERER_FILE="$PLUGIN_DIR/skills/tech-graph/.renderer"

probe_cairosvg() {
  python3 -c "import cairosvg" >/dev/null 2>&1
}

probe_rsvg() {
  command -v rsvg-convert >/dev/null 2>&1
}

probe_puppeteer() {
  node -e "require('puppeteer')" >/dev/null 2>&1
}

if probe_cairosvg; then
  echo "cairosvg" > "$RENDERER_FILE"
  echo "Renderer: cairosvg (python) — selected"
  exit 0
fi

if probe_rsvg; then
  echo "rsvg-convert" > "$RENDERER_FILE"
  echo "Renderer: rsvg-convert — selected"
  exit 0
fi

if probe_puppeteer; then
  echo "puppeteer" > "$RENDERER_FILE"
  echo "Renderer: puppeteer (node) — selected"
  exit 0
fi

cat <<'EOF' >&2
ERROR: No SVG→PNG renderer found on this system.

Install ONE of the following (cairosvg is recommended):

  1) pip install cairosvg            # requires Python >= 3.8
  2) brew install librsvg            # macOS
     apt-get install librsvg2-bin    # Debian/Ubuntu
  3) npm install -g puppeteer        # heavy; last resort

After install, re-run: bash plugins/tech-graph/scripts/check-deps.sh
EOF
exit 1
```

- [ ] **Step 2: Make script executable**

Run: `chmod +x plugins/tech-graph/scripts/check-deps.sh`

- [ ] **Step 3: Smoke-test the script in current environment**

Run: `bash plugins/tech-graph/scripts/check-deps.sh; echo "exit=$?"`
Expected (one of):
- `Renderer: <name> — selected` and `exit=0` (renderer present), OR
- The multiline `ERROR:` block on stderr and `exit=1` (no renderer present).

Either outcome is acceptable — both prove the script works. If exit=0, verify `plugins/tech-graph/skills/tech-graph/.renderer` was written:

Run: `cat plugins/tech-graph/skills/tech-graph/.renderer`
Expected: one of `cairosvg`, `rsvg-convert`, `puppeteer`.

- [ ] **Step 4: Commit**

```bash
git add plugins/tech-graph/scripts/check-deps.sh
git commit -m "feat(tech-graph): add renderer probe script"
```

---

## Task 4: Slash command entrypoint

**Files:**
- Create: `plugins/tech-graph/commands/tech-graph.md`

- [ ] **Step 1: Write the slash command file**

Write `plugins/tech-graph/commands/tech-graph.md`:

```markdown
---
description: Step-by-step wizard for generating technical diagrams (SVG/PNG).
argument-hint: [optional one-line topic]
---

Dispatch the `tech-graph` subagent using the Agent tool. Pass `$ARGUMENTS` (which may be empty) as the initial topic seed in the subagent prompt.

Subagent dispatch prompt template:

> Run the tech-graph wizard. Initial topic seed: `$ARGUMENTS`.
> Walk the user through all 6 steps even when a seed is provided. Use multiple-choice options with the marked default (★). Maintain wizard state as JSON in your working memory across turns. Do not skip steps unless the user explicitly says "use defaults".

Do not perform any rendering or file generation in the main thread — the subagent owns the full wizard and the render call.
```

- [ ] **Step 2: Verify file exists and frontmatter parses**

Run: `head -5 plugins/tech-graph/commands/tech-graph.md`
Expected: first line `---`, then `description:`, `argument-hint:`, `---`, blank line.

- [ ] **Step 3: Commit**

```bash
git add plugins/tech-graph/commands/tech-graph.md
git commit -m "feat(tech-graph): add /tech-graph slash command"
```

---

## Task 5: Wizard subagent

**Files:**
- Create: `plugins/tech-graph/agents/tech-graph.md`

- [ ] **Step 1: Write the subagent file**

Write `plugins/tech-graph/agents/tech-graph.md`:

```markdown
---
name: tech-graph
description: Step-by-step wizard for generating technical diagrams (architecture, flowchart, sequence, UML, ER, agent-loop, concept-map) as SVG/PNG via the fireworks-tech-graph skill.
tools: Read, Write, Edit, Bash, Glob, Grep
model: sonnet
---

# Tech-Graph Wizard

You are a diagram wizard. Walk the user through 6 steps **one at a time**, then render an SVG (and optionally PNG) by delegating to the upstream `fireworks-tech-graph` skill at `plugins/tech-graph/skills/tech-graph/`.

## Hard Rules

1. **One question per message.** Always multiple-choice. Mark the default with `★`.
2. Never skip a step unless the user explicitly says "use defaults".
3. Maintain wizard state in your working memory as JSON:
   ```json
   { "topic": "", "purpose": "", "type": "", "style": "", "format": "", "density": "", "filename": "", "outdir": "./diagrams" }
   ```
4. Defer reading the upstream `SKILL.md`, `references/`, `templates/` until step 6 (confirmation). At step 6, Read them, then author SVG content.
5. **Fail fast on missing renderer.** Before authoring SVG, run `bash plugins/tech-graph/scripts/check-deps.sh`. If exit != 0, quote the script's stderr verbatim to the user and halt. Do not write any SVG.
6. Never edit anything under `plugins/tech-graph/skills/tech-graph/` — that path is a git subtree and must stay verbatim.

## The 6 Steps

### Step 1 — Purpose / audience
Ask: "What is this diagram for?"
Options:
- (a) exec-summary
- (b) engineering-review ★
- (c) docs
- (d) blog
- (e) debug-thinking

### Step 2 — Diagram type
Ask: "What type of diagram?"
Options:
- (a) architecture ★
- (b) flowchart
- (c) sequence
- (d) UML-class
- (e) ER
- (f) agent-loop
- (g) concept-map

### Step 3 — Style
Read `plugins/tech-graph/skills/tech-graph/references/` for the 7 upstream style references. Recommend one based on `(purpose, type)` and present all 7 with the recommendation marked `★`.

### Step 4 — Format
Ask: "Output format?"
Options:
- (a) SVG ★
- (b) PNG
- (c) both

### Step 5 — Complexity / density
Ask: "How dense should it be?"
Options:
- (a) minimal
- (b) standard ★
- (c) detailed

### Step 6 — Confirm
Show the user the full state summary, plus the resolved `filename` and `outdir`. Filename pattern: `<topic-slug>-<type>-<style>.svg`. If the file exists, append `-2`, `-3`, …
Options: (a) yes — render, (b) edit step N, (c) cancel.

## Render Protocol (after step 6 = yes)

1. `bash plugins/tech-graph/scripts/check-deps.sh` — abort on failure (rule 5).
2. Read upstream `SKILL.md` and the template files for the chosen `type`/`style`.
3. Author the SVG content following the upstream style reference and density hint, then either:
   - Write SVG directly to `<outdir>/<filename>`, OR
   - Use `python3 plugins/tech-graph/skills/tech-graph/scripts/generate-from-template.py <type> <out.svg> '<json>'` when a template applies.
4. Validate + export PNG (when format=PNG or both):
   `bash plugins/tech-graph/skills/tech-graph/scripts/generate-diagram.sh -t <type> -s <style> -o <out.svg>`
5. Report the absolute path of every file written. Suggest the user run `snip open <path>` for visual review.

## Re-entry

Accept these at any point:
- "redo step N" — return to step N keeping all other state.
- "change style" — return to step 3.
- "cancel" — discard state and stop.

## Failure Handling

- Missing renderer → quote the `check-deps.sh` stderr verbatim, halt.
- Upstream script non-zero exit → quote the script's stderr verbatim, halt; do not write a partial SVG.
- Invalid SVG (validation failure) → quote validator output, halt, do not export PNG.
```

- [ ] **Step 2: Verify file exists and frontmatter is well-formed**

Run: `head -8 plugins/tech-graph/agents/tech-graph.md`
Expected: starts with `---`, contains `name: tech-graph`, `tools: Read, Write, Edit, Bash, Glob, Grep`, `model: sonnet`, closes `---`.

- [ ] **Step 3: Commit**

```bash
git add plugins/tech-graph/agents/tech-graph.md
git commit -m "feat(tech-graph): add wizard subagent"
```

---

## Task 6: Plugin README

**Files:**
- Create: `plugins/tech-graph/README.md`

- [ ] **Step 1: Write the plugin README**

Write `plugins/tech-graph/README.md`:

````markdown
# tech-graph

Step-by-step wizard for generating technical diagrams (architecture, flowchart, sequence, UML-class, ER, agent-loop, concept-map) as SVG + PNG. Delegates rendering to the upstream [`fireworks-tech-graph`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph) skill (vendored here under `skills/tech-graph/`).

## Install

From inside Claude Code:

```text
/plugin marketplace add <user>/neptune
/plugin install tech-graph@neptune
```

Then run `/tech-graph` (or `/tech-graph "auth flow"` to seed a topic).

## Renderer Dependency

The plugin needs ONE of these on your system (cairosvg recommended):

| Renderer | Install |
|----------|---------|
| `cairosvg` | `pip install cairosvg` (Python ≥ 3.8) |
| `rsvg-convert` | macOS: `brew install librsvg` / Debian: `apt-get install librsvg2-bin` |
| `puppeteer` | `npm install -g puppeteer` (heavy; last resort) |

Probe + auto-select:

```bash
bash plugins/tech-graph/scripts/check-deps.sh
```

The script writes the selected renderer name to `skills/tech-graph/.renderer` and skips re-probing on later runs.

## Wizard Steps

1. Purpose — exec-summary / engineering-review ★ / docs / blog / debug-thinking
2. Type — architecture ★ / flowchart / sequence / UML-class / ER / agent-loop / concept-map
3. Style — one of 7 (recommended ★ based on purpose × type)
4. Format — SVG ★ / PNG / both
5. Density — minimal / standard ★ / detailed
6. Confirm — render or edit a previous step

Mid-wizard you may say: `redo step 3`, `change style`, or `cancel`.

## Output

- Default outdir: `./diagrams/`
- Filename: `<topic-slug>-<type>-<style>.svg` (collisions → `-2`, `-3`, …)

## Optional — draw.io MCP

This plugin does **not** bundle draw.io's MCP server. If you want it available alongside, add this to `~/.claude/settings.json` or your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "drawio": { "type": "http", "url": "https://mcp.draw.io/mcp" }
  }
}
```

The `tech-graph` subagent does **not** depend on this MCP — it is purely opt-in.

## Upstream Sync

See `../../CONTRIBUTING.md` at the repo root for the `git subtree pull` workflow.
````

- [ ] **Step 2: Commit**

```bash
git add plugins/tech-graph/README.md
git commit -m "docs(tech-graph): add plugin README with install and deps"
```

---

## Task 7: Repo-root contributing guide

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Write the contributing guide**

Write `CONTRIBUTING.md`:

````markdown
# Contributing — neptune marketplace

## Adding a new plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json`.
2. Add it to `.claude-plugin/marketplace.json` under `plugins[]`.
3. Add `agents/`, `commands/`, `skills/`, `scripts/`, `README.md` under `plugins/<name>/` as needed. Plugins auto-discover `agents/`, `commands/`, `skills/` — no explicit listing required in `plugin.json`.

## Maintaining the `tech-graph` upstream subtree

The upstream skill is vendored under `plugins/tech-graph/skills/tech-graph/` via `git subtree --squash`. Never edit files inside that path directly — your changes will conflict on next sync.

### Pulling upstream updates

```bash
git subtree pull \
  --prefix=plugins/tech-graph/skills/tech-graph \
  https://github.com/yizhiyanhua-ai/fireworks-tech-graph.git main --squash
```

### Pushing local changes back (rare)

```bash
git subtree push \
  --prefix=plugins/tech-graph/skills/tech-graph \
  <your-fork-url> <branch-name>
```

## Local validation

Before committing manifest changes:

```bash
python3 -c "import json; json.load(open('.claude-plugin/marketplace.json')); json.load(open('plugins/tech-graph/.claude-plugin/plugin.json')); print('OK')"
```

Then in Claude Code:

```text
/plugin marketplace add file://$(pwd)
/plugin install tech-graph@neptune
```
````

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add CONTRIBUTING with subtree sync workflow"
```

---

## Task 8: Update repo-root README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the placeholder README**

Replace the entire contents of `README.md` with:

```markdown
# neptune

Personal Claude Code plugin marketplace. Hosts agents, skills, and slash commands as installable plugins.

## Plugins

| Plugin | Description |
|--------|-------------|
| [`tech-graph`](plugins/tech-graph) | 6-step wizard for technical diagrams (SVG + PNG) via the `fireworks-tech-graph` skill. |

## Install (any plugin)

```text
/plugin marketplace add <user>/neptune
/plugin install <plugin-name>@neptune
```

Only the plugin you install is loaded; others stay dormant until you install them.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: replace placeholder README with marketplace overview"
```

---

## Task 9: End-to-end manifest validation

**Files:** (no new files; verification only)

- [ ] **Step 1: Validate both JSON manifests**

Run: `python3 -c "import json; m=json.load(open('.claude-plugin/marketplace.json')); p=json.load(open('plugins/tech-graph/.claude-plugin/plugin.json')); assert m['plugins'][0]['name']==p['name']=='tech-graph'; print('OK')"`
Expected stdout: `OK`

- [ ] **Step 2: Verify all plugin entry-point files exist**

Run:
```bash
ls plugins/tech-graph/.claude-plugin/plugin.json \
   plugins/tech-graph/agents/tech-graph.md \
   plugins/tech-graph/commands/tech-graph.md \
   plugins/tech-graph/scripts/check-deps.sh \
   plugins/tech-graph/skills/tech-graph/SKILL.md \
   plugins/tech-graph/README.md
```
Expected: all six paths exist, no `ls: cannot access` errors.

- [ ] **Step 3: Verify subagent frontmatter is parseable YAML**

Run: `python3 -c "import re,sys; t=open('plugins/tech-graph/agents/tech-graph.md').read(); m=re.match(r'---\n(.*?)\n---', t, re.S); assert m, 'no frontmatter'; import yaml; d=yaml.safe_load(m.group(1)); assert d['name']=='tech-graph' and 'Bash' in d['tools']; print('OK')"`
Expected stdout: `OK`

(If `yaml` not installed: `pip install pyyaml` then re-run.)

- [ ] **Step 4: Verify check-deps.sh runs cleanly (either success or expected failure)**

Run: `bash plugins/tech-graph/scripts/check-deps.sh; echo "exit=$?"`
Expected: exit code is either 0 (renderer found, message printed) or 1 (no renderer + ERROR block on stderr). Any other exit code is a failure.

- [ ] **Step 5: Verify git working tree is clean**

Run: `git status --porcelain`
Expected: empty output.

- [ ] **Step 6: No commit needed (verification only)**

If any check fails, fix the offending file and re-run from Step 1.

---

## Self-Review Notes (filled in during plan writing)

**Spec coverage check:**
- Repo layout (§3 of spec) → Tasks 1, 2, 4, 5, 6, 7, 8.
- Wizard flow (§4) → Task 5.
- Subagent + slash contracts (§5) → Tasks 4, 5.
- Install / subtree / deps (§6) → Tasks 2, 3, 6, 7.
- Manifests (§7) → Task 1.
- Testing (§8) → Task 9 (manifest validation, file existence, subagent frontmatter, dep-probe smoke). Wizard smoke + re-entry + failure-mode tests are runtime checks that require an installed Claude Code session and are documented in `CONTRIBUTING.md` rather than scripted here.
- Success criteria (§9) → covered by Task 9 + manual `/tech-graph` invocation after install.
- Out of scope (§10) → respected: no draw.io MCP bundle, no upstream edits, no auto-install of system packages.

**Placeholder scan:** none ("TBD" / "TODO" / "fill in" absent).

**Type / name consistency:**
- `tech-graph` used as plugin name, agent name, command name, source dir name — consistent everywhere.
- `check-deps.sh` referenced from agent and README under the same path.
- `.renderer` file path consistent between `check-deps.sh` and README.
- Filename pattern `<topic-slug>-<type>-<style>.svg` consistent between spec, agent, README.
