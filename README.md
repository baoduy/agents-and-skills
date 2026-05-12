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
