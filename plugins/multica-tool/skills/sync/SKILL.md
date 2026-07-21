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

## Step 2 — Run the sync (auto-mapping first)

For agents and squads, each exported agent record carries its source runtime's `provider` (e.g. `claude`, `opencode`) alongside its ID. The sync script auto-maps a source runtime to the destination workspace's runtime when there is **exactly one** runtime of that provider there — no manual mapping needed in the common case. For skills (which have no runtime dependency), an empty runtime map is always acceptable. Try the sync without `--runtime-map` first:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-sync.mjs" \
  <type> <name> from <src-ws> <dest-ws>
```

If it aborts with `Unmapped runtimes: ...` (0 or 2+ runtimes share that provider in the destination workspace), resolve manually:

```bash
multica runtime list --workspace-id <dest-ws-id> --output json   # list destination workspace runtimes
```

Ask the user to select a matching target runtime by name or ID for each unmapped `sourceRuntimeId`, then re-run with an explicit map (explicit entries always take precedence over auto-mapping):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-sync.mjs" \
  <type> <name> from <src-ws> <dest-ws> \
  --runtime-map <srcId1=dstId1,srcId2=dstId2,...>
```

The script exports to a temporary directory, imports into the destination workspace, then cleans up the temporary files automatically.

## Step 3 — Report results

Parse the JSON output and report:

- Created and updated counts for skills, agents, and squads.
- Name-to-ID maps (`skillIdMap`, `agentIdMap`).
- Squad ID if a squad was synced.
- If `secretsReminder` is non-empty, surface every agent name verbatim with: "WARNING: the following agents' bundle files contained custom environment variables or MCP config in PLAINTEXT — the temporary export directory (already cleaned up) briefly held these secrets in plaintext: `<agent-name>`."
- If `secretsApplyFailures` is non-empty, surface every agent name verbatim with: "WARNING: mcp_config or custom_env failed to apply to the following agents during sync (the agent itself was still created/updated) — set them manually in the Multica UI: `<agent-name>`."
