# Tech-Graph Plugin — Design Spec

**Date:** 2026-05-12
**Status:** Approved
**Owner:** steven.hoang@transwap.com
**Repo:** `neptune` (agents-and-skills marketplace)

## 1. Goal

Convert this repo into a Claude Code **plugin marketplace** and ship its first plugin, `tech-graph`: a step-by-step wizard subagent that walks a user through purpose, diagram type, style, format, and complexity before generating a technical diagram (SVG + PNG) by delegating to the upstream `fireworks-tech-graph` skill (https://github.com/yizhiyanhua-ai/fireworks-tech-graph).

The draw.io MCP server (https://mcp.draw.io/mcp) is **not** bundled. Manual install is documented in the plugin README only.

## 2. Constraints & Decisions

| Decision | Value | Source |
|----------|-------|--------|
| Agent role | Pre-flight wizard wrapper → delegates rendering to upstream Python scripts | Q1 = A |
| Wizard depth | 6 steps: purpose → type → style → format → density → confirm | Q2 = C |
| Repo shape | Marketplace listing N plugins under `plugins/<name>/` | Q3a = B |
| Upstream clone method | `git subtree --squash` (preserves easy future sync) | Q3b = Y |
| Entrypoint | Both subagent (`agents/tech-graph.md`) and slash command (`commands/tech-graph.md`) | Q4 = D |
| Python deps | Documented in README; subagent fails fast with exact install cmd | Q5 = A |
| draw.io MCP | Not bundled; manual setup documented in README | Q6 = C |

## 3. Repo Layout

```
neptune/
├── .claude-plugin/
│   └── marketplace.json
├── plugins/
│   └── tech-graph/
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── agents/
│       │   └── tech-graph.md
│       ├── commands/
│       │   └── tech-graph.md
│       ├── scripts/
│       │   └── check-deps.sh
│       ├── skills/
│       │   └── tech-graph/                  # git subtree of upstream
│       │       ├── SKILL.md
│       │       ├── scripts/
│       │       ├── templates/
│       │       ├── references/
│       │       ├── fixtures/
│       │       └── assets/
│       └── README.md
├── docs/superpowers/specs/
│   └── 2026-05-12-tech-graph-plugin-design.md
├── CONTRIBUTING.md
└── README.md
```

Subtree prefix: `plugins/tech-graph/skills/tech-graph`.
Subtree remote: `https://github.com/yizhiyanhua-ai/fireworks-tech-graph` branch `main`, `--squash`.

## 4. Wizard Flow (6 steps)

Subagent prompts one step at a time. Each step is multiple-choice with a default marked `★`. State accumulates as JSON `{purpose, type, style, format, density, topic, filename, outdir}`.

| # | Step | Options (default ★) |
|---|------|---------------------|
| 1 | Purpose / audience | exec-summary, engineering-review ★, docs, blog, debug-thinking |
| 2 | Diagram type | architecture ★, flowchart, sequence, UML-class, ER, agent-loop, concept-map |
| 3 | Style | upstream 7 styles; subagent recommends based on (purpose, type) |
| 4 | Format | SVG ★, PNG, both |
| 5 | Complexity / density | minimal, standard ★, detailed |
| 6 | Confirm | summary → yes / edit step N / cancel |

After confirm:

1. Verify renderer dep (`cairosvg` | `rsvg-convert` | `puppeteer`). Fail fast with exact install cmd if none.
2. Generate SVG content using upstream `templates/` + style reference + density hint.
3. Run `skills/tech-graph/scripts/generate-from-template.py` (or direct write) → then `generate-diagram.sh` to validate + export PNG.
4. Report output path; optionally invoke `snip open` for visual review.

Re-entry: user may say "redo step N", "change style", or "cancel" at any point. State preserved.

## 5. Subagent + Slash Command Contracts

### `commands/tech-graph.md`

```yaml
---
description: Step-by-step wizard for generating technical diagrams (SVG/PNG).
argument-hint: [optional one-line topic]
---
```

Body instructs main thread to dispatch the `tech-graph` subagent via the Agent tool, passing `$ARGUMENTS` as initial topic seed (still asks all 6 steps).

### `agents/tech-graph.md`

```yaml
---
name: tech-graph
description: Step-by-step wizard for generating technical diagrams (architecture, flowchart, sequence, UML, ER, agent-loop, concept-map) as SVG/PNG via fireworks-tech-graph skill.
tools: Read, Write, Edit, Bash, Glob, Grep
model: sonnet
---
```

System prompt sections:

1. **Role** — wizard, walk user through 6 steps, never skip unless user explicitly says "use defaults".
2. **Step protocol** — one question per message, multiple-choice, show default with `★`.
3. **State tracking** — maintain JSON state in working memory across turns.
4. **Reference loading** — defer reads of upstream `SKILL.md`, `references/`, `templates/` until step 6.
5. **Render protocol** — dep check → SVG author → template script → validate + PNG → report path.
6. **Failure handling** — quote exact error, give exact install cmd, halt; do not write partial SVG.
7. **Re-entry** — accept "redo step N", "change style", "cancel".

### Output convention

- Default outdir: `./diagrams/` (created if absent).
- Filename: `<topic-slug>-<type>-<style>.svg` (e.g. `auth-flow-architecture-style1.svg`).
- Collision: suffix `-2`, `-3`, …

### Tool scope

`Bash` for scripts, `Read/Write/Edit` for SVG authoring, `Glob/Grep` for template discovery. No network, no MCP.

## 6. Install, Subtree Sync, Deps

### User install

1. `/plugin marketplace add <user>/neptune`
2. `/plugin install tech-graph@neptune`
3. First `/tech-graph` run auto-invokes `scripts/check-deps.sh`. Missing-dep output includes exact install cmd.

### Required deps (one of)

- Recommended: `pip install cairosvg` (Python ≥ 3.8)
- Alt 1: `brew install librsvg` (macOS) / `apt install librsvg2-bin` (Linux)
- Alt 2: `npm install -g puppeteer` (heavy; last resort)

`check-deps.sh` probes in order, picks first available, writes selection to `plugins/tech-graph/skills/tech-graph/.renderer` so subsequent runs skip probing.

### Subtree initial pull (maintainer)

```bash
git subtree add \
  --prefix=plugins/tech-graph/skills/tech-graph \
  https://github.com/yizhiyanhua-ai/fireworks-tech-graph.git main --squash
```

### Subtree future sync

```bash
git subtree pull \
  --prefix=plugins/tech-graph/skills/tech-graph \
  https://github.com/yizhiyanhua-ai/fireworks-tech-graph.git main --squash
```

Documented in `CONTRIBUTING.md`.

### Upstream SKILL.md

Kept verbatim inside the subtree (do not edit — preserves clean subtree diff). Subagent layer wraps it and reads it at step 6.

### draw.io MCP (manual, not bundled)

Document this snippet in `plugins/tech-graph/README.md` for users who want it:

```json
{
  "mcpServers": {
    "drawio": { "type": "http", "url": "https://mcp.draw.io/mcp" }
  }
}
```

Subagent has no dependency on this MCP.

## 7. Manifests

### `.claude-plugin/marketplace.json` (repo root)

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

### `plugins/tech-graph/.claude-plugin/plugin.json`

```json
{
  "name": "tech-graph",
  "version": "0.1.0",
  "description": "Step-by-step wizard for generating technical diagrams as SVG+PNG.",
  "author": { "name": "steven" },
  "keywords": ["diagram", "svg", "architecture", "uml", "flowchart", "sequence", "er"]
}
```

Plugin auto-discovers `agents/`, `commands/`, `skills/` by convention — no explicit listing needed.

## 8. Testing Strategy

1. **Manifest validation** — `claude plugin validate` (or `--debug` load) confirms JSON schemas pass.
2. **Subtree integrity** — `plugins/tech-graph/skills/tech-graph/SKILL.md` exists after `git subtree add`.
3. **Dep-probe smoke** — `check-deps.sh` on clean macOS and clean Linux container; missing deps produce exact install cmd.
4. **Wizard smoke** — `/tech-graph "test auth flow"` → accept defaults → assert `./diagrams/test-auth-flow-architecture-style1.svg` exists, is valid XML, and a PNG sibling exists.
5. **Re-entry** — mid-wizard "redo step 3" preserves state; only style is re-asked.
6. **Failure mode** — with no renderer installed, wizard halts at the dep check with the exact install cmd and writes no SVG.

## 9. Success Criteria

- User runs `/plugin install tech-graph@neptune` and `/tech-graph` is available immediately.
- 6-step wizard completes in under 2 minutes for a typical user.
- Generated SVG passes `validate-svg.sh`.
- PNG export succeeds, or the wizard fails fast with the exact install cmd.
- Future plugins can be added under `plugins/<new-name>/` and registered in `marketplace.json` without touching `tech-graph`.

## 10. Out of Scope

- Bundling the draw.io MCP server.
- Reimplementing the upstream renderer in Node or other languages.
- Editing upstream `SKILL.md` content (must stay verbatim inside the subtree).
- Auto-installing Python or system packages on the user's machine.
- Building a second plugin in this iteration.
