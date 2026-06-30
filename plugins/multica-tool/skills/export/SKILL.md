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
  --scope <type> \
  --id <id> \
  --out <dir> \
  [--workspace <workspace-name>]
```

The script writes `manifest.json`, skill SKILL.md files, agent JSON files, and squad JSON files into `<dir>`.

## Step 5 — Report results

Parse the JSON output from the script and report:

- Directory written to.
- Count of skills, agents, and squads exported.
- If `warnings` is non-empty, surface every agent name verbatim with this message: "WARNING: the following agents had custom environment variables or MCP config that were NOT exported — re-add secrets manually after import: `<agent-name>`."
