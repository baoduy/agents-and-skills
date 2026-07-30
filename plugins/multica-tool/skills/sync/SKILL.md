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

Where `<type>` is `skill`, `agent`, `squad`, or `project`; `<name>` is the resource name (for `project`, its **title**); `<src-ws>` and `<dest-ws>` are workspace names registered in Multica.

Projects are resolved by title, not ID, e.g. `multica-sync.mjs project "<title>" from <src-ws> <dest-ws>` — the project's lead agent is synced alongside it.

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

Ask the user to select a matching target runtime by name or ID for each unmapped `source_runtime_id`, then re-run with an explicit map (explicit entries always take precedence over auto-mapping):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-sync.mjs" \
  <type> <name> from <src-ws> <dest-ws> \
  --runtime-map <srcId1=dstId1,srcId2=dstId2,...>
```

The script exports to a temporary directory, imports into the destination workspace, then cleans up the temporary files automatically.

## Step 3 — Report results

Parse the JSON output and report:

- Created and updated counts for skills, agents, squads, and projects.
- Name-to-ID maps (`skillIdMap`, `agentIdMap`).
- `squadIdMap`: name-to-ID map for every squad synced.
- If `secretsReminder` is non-empty, surface every agent name verbatim with: "WARNING: the following agents' bundle files contained custom environment variables or MCP config in PLAINTEXT — the temporary export directory (already cleaned up) briefly held these secrets in plaintext: `<agent-name>`."
- If `secretsApplyFailures` is non-empty, surface every agent name verbatim with: "WARNING: mcp_config or custom_env failed to apply to the following agents during sync (the agent itself was still created/updated) — set them manually in the Multica UI: `<agent-name>`."
- If `avatarApplyFailures` is non-empty, surface every agent name verbatim with: "WARNING: the avatar image failed to upload for the following agents — set it manually in the destination workspace: `<agent-name>`."
- If `avatarUnsupported` is non-empty, surface every agent name verbatim with: "NOTE: the following agents had an emoji avatar at the source, which the CLI cannot set on an agent — set it manually in the destination workspace: `<agent-name>`."
- If `permissionApplyFailures` is non-empty, surface every agent name verbatim with: "WARNING: member-specific sharing failed to apply for the following agents — set their invocation permissions manually in the destination workspace: `<agent-name>`."
- If `permissionUnsupported` is non-empty, surface every agent name verbatim with: "NOTE: the following agents were shared with specific members at the source, but none of those users exist in the destination workspace — re-share manually if needed: `<agent-name>`."

Avatars sync automatically, but **only when the destination resource has none** — an existing agent or squad that already carries an avatar is never overwritten.
