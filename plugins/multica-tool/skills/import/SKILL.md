---
name: import
description: Use when the user wants to import a Multica export bundle into a target workspace, mapping source runtimes to target runtimes before writing any resources.
allowed-tools: Bash, Read
---

# import

Import a local Multica bundle (produced by the export skill) into a target workspace.

## Step 1 — Confirm the target workspace

Ask the user to confirm the name of the target workspace if not already stated. You will need the exact workspace name as registered in Multica.

## Step 2 — Plan pass: read the bundle and collect unmapped runtimes

Read the manifest to discover which source runtimes are referenced:

```bash
cat <folder>/manifest.json
```

Collect each distinct `sourceRuntimeId` from the `agents` array.

List runtimes available in the target workspace:

```bash
multica runtime list --output json
```

For each distinct `sourceRuntimeId`, ask the user to pick a matching target runtime by name or ID. Build a mapping in the form `srcId=dstId`. If any source runtime has no mapping selected, abort and explain which IDs remain unmapped — do not write any resources.

## Step 3 — Run the import

```bash
node plugins/multica-tool/scripts/multica-import.mjs \
  --dir <folder> \
  --workspace <workspace-name> \
  --runtime-map <srcId1=dstId1,srcId2=dstId2,...>
```

## Step 4 — Report results

Parse the JSON output and report:

- Created and updated counts for skills, agents, and squads.
- Name-to-ID maps for skills and agents (`skillIdMap`, `agentIdMap`).
- Squad ID if a squad was imported.
- If `secretsReminder` is non-empty, surface every agent name verbatim with: "WARNING: the following agents had custom environment variables or MCP config that were NOT exported — re-add secrets manually in the Multica UI: `<agent-name>`."
