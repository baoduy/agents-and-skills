# tech-graph

Step-by-step wizard for generating technical diagrams (architecture, flowchart, sequence, UML-class, ER, agent-loop, concept-map) as SVG + PNG. Delegates rendering to the upstream [`fireworks-tech-graph`](https://github.com/yizhiyanhua-ai/fireworks-tech-graph) skill (vendored here under `skills/tech-graph/`).

## Install

From inside Claude Code:

```text
/plugin marketplace add <user>/agents-and-skills
/plugin install tech-graph@drunkcoding
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
