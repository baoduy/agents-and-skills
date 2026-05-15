# agents-and-skills

Personal [Claude Code](https://code.claude.com) plugin marketplace. Hosts agents, skills, and slash commands as installable plugins.

Published on npm as [`@drunkcoding/agents-and-skills`](https://www.npmjs.com/package/@drunkcoding/agents-and-skills).

## Plugins

| Plugin | Description |
|--------|-------------|
| [`tech-graph`](plugins/tech-graph) | 6-step wizard for technical diagrams (SVG + PNG). |
| [`html-effectiveness`](plugins/html-effectiveness) | Conversational agent that generates self-contained interactive HTML reports from 20 templates. |
| [`team-superpower`](plugins/team-superpower) | Shape-adaptive engineering team running the Superpowers skill chain — up to 8 roles (designer, planner, software-architect, security-engineer, backend-developer, frontend-developer, qa-engineer, reviewer); spawns 7 or 8 depending on stack (`full-stack` / `be-only` / `fe-only`) declared in `CLAUDE.md`. Test/build commands, contract publish + sync, security checklist, and CI gate before merge are all driven by the project's `CLAUDE.md` `team-superpower` block. |
| [`plugin-validator`](plugins/plugin-validator) | Orchestrated validator that checks every plugin's skills, agents, commands, and hooks for spec compliance — runs in parallel and proposes batched fixes. |
| [`auto-power`](plugins/auto-power) | Single-command hands-off pipeline that wraps `obra/superpowers`. Auto-answers safe clarifying questions during spec, then runs plan → arch+sec → impl → verify → review → ff-merge with no further touchpoints. Checkpointed and resumable. Escalates on substantive failures. |

## team-superpower v3

The `team-superpower` plugin shipped a v3 amendment in 2026-05. Three additions on top of v2:

1. **Autonomous complexity assessment (phase 0.5).** The lead picks mode (`solo` / `single-agent` / `team`) and size (`minimal` / `standard` / `full`) from launch-message heuristics. No extra owner touchpoint; the 3-touchpoint promise is preserved. Override per feature with `/team-feature --mode=<mode> --size=<size>`; preview with `--explain`.

2. **Dependency-grouped parallel waves (phase 4).** The planner emits a `## Waves` section. Independent tasks within a wave run concurrently across up to **2 BE + 2 FE implementers** at peak. Collisions on shared files hard-fail and force a planner re-plan; cap is 3 retries before owner escalation.

3. **Per-role model and effort configuration.** Each agent file pins `model:` (alias) and `effort:`:
   - **Opus** for orchestration / design / architecture / security / final review (lead + designer + software-architect + security-engineer + reviewer).
   - **Sonnet** for planning / implementation / QA (planner + backend-developer + frontend-developer + qa-engineer).

   For production teams, pin specific versions via env vars:

   ```bash
   export ANTHROPIC_DEFAULT_OPUS_MODEL="claude-opus-4-7"
   export ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-4-6"
   ```

   Agent files use aliases so version bumps are intentional.

A typical full-stack `team-standard` feature runs ~3 Opus sessions (lead, designer, reviewer) and ~5–7 Sonnet sessions (planner, BE×1–2, FE×1–2, QA). See `plugins/team-superpower/docs/superpowers/team-superpower-v3-spec.md` for the full spec and `plugins/team-superpower/assets/SESSION_README.md` for owner-facing operational notes.

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
