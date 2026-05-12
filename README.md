# agents-and-skills

Personal [Claude Code](https://code.claude.com) plugin marketplace. Hosts agents, skills, and slash commands as installable plugins.

Published on npm as [`@drunkcoding/agents-and-skills`](https://www.npmjs.com/package/@drunkcoding/agents-and-skills).

## Plugins

| Plugin | Description |
|--------|-------------|
| [`tech-graph`](plugins/tech-graph) | 6-step wizard for technical diagrams (SVG + PNG). |

## Install

### Claude Code marketplace

```text
/plugin marketplace add drunkcoding/agents-and-skills
/plugin install <plugin-name>@neptune
```

Only the plugin you install loads; others stay dormant.

### npm / npx

```bash
# Whole marketplace
npm install -g @drunkcoding/agents-and-skills

# Or via npx skills (https://github.com/vercel-labs/skills)
npx skills add @drunkcoding/agents-and-skills
```

## Layout

```
.claude-plugin/marketplace.json       # marketplace manifest (Claude Code)
plugins/<plugin>/                     # one folder per plugin
  .claude-plugin/plugin.json          # plugin manifest
  agents/   commands/   skills/       # plugin contents
package.json                          # npm metadata
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT
