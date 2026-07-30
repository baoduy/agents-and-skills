---
name: export
description: Use when the user wants to export Multica skills, agents, or squads to a local folder for backup, version control, or cross-workspace migration.
allowed-tools: Bash, Read
---

# export

Export a Multica resource (skill, agent, or squad) to a local bundle directory.

## Step 1 — Verify authentication

Run the export script; it calls `multica auth status` internally and exits with an error message if unauthenticated:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-export.mjs" --help 2>&1 || true
```

If `multica login` is required, surface that message verbatim and stop.

## Step 2 — Determine scope and resource ID

If the user named a specific resource and type (`skill`, `agent`, or `squad`), use those directly.

Otherwise, list available resources for the chosen type and present a pick list:

```bash
multica <type> list --output json
```

Ask the user to select a resource by name. Resolve its `id` from the list output.

## Step 3 — Determine output directory

If the user specified an output directory, use it. Otherwise default to:

```
./multica-export-<slug>-<type>
```

where `<slug>` is a lowercased, hyphenated form of the resource name.

## Step 4 — Run the export

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-export.mjs" \
  --scope <type|all> \
  --id <id> \
  --out <dir> \
  [--workspace <workspace-name>]
```

Pass `--scope all` (with no `--id`) to export the **entire workspace** — every skill, agent, and squad — into one flat, deduped bundle. A skill or agent shared across many agents/squads is written exactly once and referenced by name.

The script writes `manifest.json`, skill `SKILL.md` files, agent JSON files, and squad JSON files into `<dir>`. Each agent's and squad's **instructions** (system prompt / charter) are written to a sibling Markdown file — `agents/<slug>.md`, `squads/<slug>.md` — referenced by an `instructions_file` key in the JSON, so the prose is easy to read, diff, and edit. Agents/squads with no instructions get no `.md`.

Avatars are captured automatically: an agent's uploaded-image avatar is downloaded into the bundle (`agents/<slug>.avatar.<ext>`) and referenced by `avatar_file`; emoji avatars (agents and squads) and a squad's avatar are recorded as the `avatar_url` string.

## Step 5 — Report results

Parse the JSON output from the script and report:

- Directory written to.
- Count of skills, agents, and squads exported.
- If `warnings` is non-empty, surface every agent name verbatim with this message: "WARNING: the following agents' exported files contain custom environment variables or MCP config in PLAINTEXT — treat the export directory as sensitive (avoid committing it to a public repo, restrict file permissions, delete it once the import is done): `<agent-name>`."
