# agents-and-skills

Personal [Claude Code](https://code.claude.com) plugin marketplace. Hosts agents, skills, and slash commands as installable plugins.

Published on npm as [`@drunkcoding/agents-and-skills`](https://www.npmjs.com/package/@drunkcoding/agents-and-skills).

## Plugins

| Plugin | Description |
|--------|-------------|
| [`multica-tool`](plugins/multica-tool) | Export, import, and sync a Multica workspace — settings, skills, agents, squads, projects, autopilots, labels, properties, and the MCP roster — between workspaces. |
| [`team-superpower`](plugins/team-superpower) | Shape-adaptive engineering team running the Superpowers skill chain — up to 8 roles, spawning 7 or 8 depending on the stack declared in `CLAUDE.md`. |
| [`plugin-validator`](plugins/plugin-validator) | Orchestrated validator that checks every plugin's skills, agents, commands, and hooks for spec compliance — runs in parallel and proposes batched fixes. |
| [`auto-power`](plugins/auto-power) | Single-command hands-off pipeline wrapping `obra/superpowers`: spec → plan → arch+sec → impl → verify → review → ff-merge, checkpointed and resumable. |

## Install

### Claude Code marketplace

Add the marketplace once:

```text
/plugin marketplace add baoduy/agents-and-skills
```

Then install any plugin individually:

```text
/plugin install plugin-validator@drunkcoding
/plugin install multica-tool@drunkcoding --scope local
```

Reload after install:

```text
/reload-plugins
```

Only the plugin you install loads; others stay dormant.

Install into a project's `.claude/` instead of your user profile with `--scope project`. Manage what you have with `/plugin list`, `/plugin uninstall <name>`, and `/plugin marketplace update`.

### npm / npx

```bash
# Use the GitHub shorthand (owner/repo) — `npx skills` does not resolve npm scopes.
npx skills add baoduy/agents-and-skills
```

## Using `multica-tool`

Migrates [Multica](https://multica.st24.live) workspace configuration between workspaces, driving the `multica` CLI. Three slash commands, each backed by a skill that walks you through the steps; the same scripts can be run directly.

**Requires** the `multica` CLI on `PATH` and an authenticated session (`multica login`). Every command aborts up front if `multica auth status` fails.

### Commands

| Command | What it does |
|---|---|
| `/export` | Writes a workspace (or one named resource) to a local bundle directory. |
| `/import` | Reads a bundle into a target workspace, mapping source runtimes to target ones. |
| `/sync` | Export + import in one step, for a single resource between two workspaces. |

### Export

The default is a **whole-workspace** export at `--level workspace` — everything portable:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-export.mjs" \
  --out export/<workspace-name> \
  [--level skill|agent|squad|workspace] \
  [--workspace <source-workspace-name>]
```

Levels are cumulative — each one bundles its own tier plus every tier below it:

| `--level` | Adds |
|---|---|
| `skill` | every workspace skill |
| `agent` | every agent (and prunes skills no agent references) |
| `squad` | every squad, with its leader and members |
| `workspace` *(default)* | projects, autopilots, issue labels, custom properties, the MCP roster |

Workspace **settings** (name, logo, description, context, issue prefix) travel at *every* level — they are the workspace's identity, not a tier of its contents. `--level project` is still accepted as the old name for `workspace`.

Export one named resource instead of a whole workspace:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-export.mjs" \
  --scope skill|agent|squad|project|autopilot --id <id> --out <dir>
```

`--scope` and `--level` are mutually exclusive.

#### What never travels

- **Repositories** — the workspace repo registry is checkout/machine state managed by `multica repo`, not configuration.
- **Members** — accounts, not configuration. They are referenced by name where an autopilot subscribes them, never created.
- **Issues** — live work, not configuration.

#### Bundle layout

One flat folder per object type, with every resource's prose externalized to a sibling `.md` so a bundle is reviewable and diffable:

```
<dir>/
  manifest.json
  workspace/workspace.json, workspace.description.md, workspace.context.md, workspace.avatar.<ext>
  skills/<slug>/SKILL.md, config.json, <skill files…>
  agents/<slug>.json, <slug>.md, <slug>.description.md, <slug>.avatar.<ext>
  squads/<slug>.json, <slug>.md, <slug>.description.md
  projects/<slug>.json, <slug>.description.md
  autopilots/<slug>.json, <slug>.description.md
  labels/labels.json
  properties/properties.json
  mcp/servers.json
```

#### Secrets

An agent's `mcp_config` and `custom_env` are written to the bundle **in plaintext** when readable. Treat an export directory as sensitive: don't commit it to a public repo, and delete it once the import is done. The export report names every affected agent. Webhook trigger secrets and workspace MCP server configs are never readable via the CLI and so never travel.

### Import

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-import.mjs" \
  --dir <bundle-dir> \
  --workspace <target-workspace-name> \
  [--include workspace,agents,squads,projects,autopilots,labels,properties] \
  [--runtime-map <srcId=dstId,...>] \
  [--dry-run]
```

**Always `--dry-run` first.** The pre-flight reports what would be written and every known incompatibility without touching the destination.

`--include` defaults to `agents,squads` (skills follow agents). Everything else is opt-in, because each one reaches beyond the agents being migrated:

- `workspace` overwrites the destination's **own** name, description, context, and issue prefix. It can **rename the workspace** — which is how `--workspace` addresses it, so a re-run needs the new name — and changing the issue prefix renumbers every issue key.
- `labels` and `properties` are **workspace-wide** in Multica; importing them changes the issue taxonomy for every project in the destination, not just the one being migrated.

Imports are **idempotent** and matched by name (or title): an existing resource is updated in place rather than duplicated, and an agent archived at the destination is restored and reused rather than failing on the held name.

Runtimes auto-map when exactly one runtime at the destination shares the source's provider (`claude`, `opencode`, …). Otherwise the import aborts **before any write** and asks for `--runtime-map`.

#### Known platform gaps

Some fields are captured for the record but cannot be restored, because the `multica` CLI exposes no setter. Each is reported by name rather than dropped silently:

| Not restorable | Why |
|---|---|
| Workspace logo | `workspace update` takes name/description/context/issue-prefix only |
| Agent emoji avatar | `agent avatar` accepts image uploads only |
| Agent disabled runtime skills | `agent skills` manages workspace skill assignments only |
| Workspace MCP server configs | `workspace mcp list` never returns a server's entry JSON |
| Label descriptions | `label create`/`update` have no `--description` |
| Project priority | `project create`/`update` have no `--priority` |
| Autopilot priority | Never returned on read, and `--priority` was dropped from the CLI |

Autopilots always land **paused**, whatever their state at the source, and webhook triggers are reissued with a fresh URL.

### Sync

One resource, source to destination, export and import in a single step:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-sync.mjs" \
  <skill|agent|squad|project|autopilot> <name> from <src-ws> <dest-ws> \
  [--runtime-map <srcId=dstId,...>]
```

Resources are resolved by name (by **title** for projects and autopilots). Dependencies come along: a squad brings its leader and members, a project brings its lead agent.

### Background runs

A large migration can be handed to a subagent so it runs in its own context and returns just the final JSON report — `multica-tool:export`, `multica-tool:import`, `multica-tool:sync`.

## `team-superpower`

Shape-adaptive engineering team with autonomous complexity assessment (mode `solo`/`single-agent`/`team`, size `minimal`/`standard`/`full`), dependency-grouped parallel waves capped at 2 BE + 2 FE implementers, and per-role model pinning — Opus for orchestration, design, architecture, security, and final review; Sonnet for planning, implementation, and QA.

Pin exact versions for production teams:

```bash
export ANTHROPIC_DEFAULT_OPUS_MODEL="claude-opus-4-7"
export ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-4-6"
```

Agent files use aliases so version bumps stay intentional. Full spec: `plugins/team-superpower/docs/superpowers/team-superpower-v3-spec.md`. Owner-facing operational notes: `plugins/team-superpower/assets/SESSION_README.md`.

## Layout

```
.claude-plugin/marketplace.json       # marketplace manifest (Claude Code)
plugins/<plugin>/                     # one folder per plugin
  .claude-plugin/plugin.json          # plugin manifest
  agents/   commands/   skills/       # plugin contents
tests/<plugin>/                       # tests (not packaged for npm)
package.json                          # npm metadata
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT
