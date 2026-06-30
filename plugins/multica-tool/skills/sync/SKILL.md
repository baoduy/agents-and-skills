---
name: sync
description: Use when the user wants to sync a Multica skill, agent, or squad from one workspace to another in a single operation.
allowed-tools: Bash, Read
---

# sync

Copy a Multica resource from a source workspace to a destination workspace.

## Step 1 — Parse the sync request

Expect the user's request in the form:

```
sync <type> <name> from <src-ws> to <dest-ws>
```

Where `<type>` is `skill`, `agent`, or `squad`; `<name>` is the resource name; `<src-ws>` and `<dest-ws>` are workspace names registered in Multica.

## Step 2 — Build the runtime map

List runtimes available in the destination workspace:

```bash
multica runtime list --output json
```

Using the source workspace, fetch the resource to discover which `sourceRuntimeId` values are referenced (for agents and squads). For each distinct `sourceRuntimeId`, ask the user to select a matching target runtime by name or ID. Build a mapping in the form `srcId=dstId`. If any source runtime has no mapping, abort before running the sync.

For skills (which have no runtime dependency), an empty runtime map is acceptable.

## Step 3 — Run the sync

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-sync.mjs" \
  <type> <name> from <src-ws> <dest-ws> \
  [--runtime-map <srcId1=dstId1,srcId2=dstId2,...>]
```

The script exports to a temporary directory, imports into the destination workspace, then cleans up the temporary files automatically.

## Step 4 — Report results

Parse the JSON output and report:

- Created and updated counts for skills, agents, and squads.
- Name-to-ID maps (`skillIdMap`, `agentIdMap`).
- Squad ID if a squad was synced.
- If `secretsReminder` is non-empty, surface every agent name verbatim with: "WARNING: the following agents had custom environment variables or MCP config that were NOT exported — re-add secrets manually in the Multica UI: `<agent-name>`."
