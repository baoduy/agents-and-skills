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
