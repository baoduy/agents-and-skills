# agents-and-skills

Personal [Claude Code](https://code.claude.com) plugin marketplace. Hosts agents, skills, and slash commands as installable plugins.

Published on npm as [`@drunkcoding/agents-and-skills`](https://www.npmjs.com/package/@drunkcoding/agents-and-skills).

## Plugins

| Plugin | Description |
|--------|-------------|
| [`tech-graph`](plugins/tech-graph) | 6-step wizard for technical diagrams (SVG + PNG). |
| [`html-effectiveness`](plugins/html-effectiveness) | Conversational agent that generates self-contained interactive HTML reports from 20 templates. |

## Install

### Claude Code marketplace

Add the marketplace once:

```text
/plugin marketplace add baoduy/agents-and-skills
```

Then install any plugin individually:

```text
/plugin install tech-graph@drunkcoding
/plugin install html-effectiveness@drunkcoding --scope local
```

Reload after install:

```text
/reload-plugins
```

Only the plugin you install loads; others stay dormant.

#### Project-scoped install

Install into a project's `.claude/` instead of your user profile:

```text
/plugin install tech-graph@drunkcoding --scope project
```

#### Manage installed plugins

```text
/plugin list                 # see installed plugins
/plugin uninstall <name>     # remove
/plugin marketplace update   # pull latest manifest
```

### npm / npx

```bash
# Whole marketplace
npm install -g @drunkcoding/agents-and-skills

# Or via npx skills (https://github.com/vercel-labs/skills)
# Use the GitHub shorthand (owner/repo) — `npx skills` does not resolve npm scopes.
npx skills add baoduy/agents-and-skills
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
