# agents-and-skills

Personal collection of [Claude Code](https://code.claude.com) skills and agents.

Published as [`@drunkcoding/agents-and-skills`](https://www.npmjs.com/package/@drunkcoding/agents-and-skills) and installable via [`npx skills`](https://github.com/vercel-labs/skills).

## Install

```bash
# All skills in the package
npx skills add @drunkcoding/agents-and-skills

# Or from GitHub directly
npx skills add drunkcoding/agents-and-skills

# Single skill
npx skills add @drunkcoding/agents-and-skills/gitnexus-impact-analysis

# Scoped to a specific agent
npx skills add @drunkcoding/agents-and-skills -a claude-code
```

## Included skills

GitNexus toolkit — code intelligence via the GitNexus MCP server:

| Skill | Use for |
|------|---------|
| `gitnexus-exploring` | "How does X work?", trace execution flows |
| `gitnexus-impact-analysis` | "What breaks if I change X?" |
| `gitnexus-debugging` | "Why is X failing?", trace errors |
| `gitnexus-refactoring` | Rename / extract / split / move safely |
| `gitnexus-guide` | GitNexus tools, resources, schema reference |
| `gitnexus-cli` | `gitnexus analyze`, status, clean, wiki commands |

## Layout

```
.claude/skills/gitnexus/<skill>/SKILL.md  # skill definitions
.claude-plugin/plugin.json                # plugin manifest
Karpathy-CLAUDE.md                        # behavioral baseline guidelines
CLAUDE.md / AGENTS.md                     # repo guidance for coding agents
package.json                              # npm metadata
```

## Publish

```bash
npm publish --access public
```

## License

MIT
