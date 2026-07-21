---
name: import
description: Use when the user wants to import a Multica export bundle into a target workspace, mapping source runtimes to target runtimes before writing any resources.
allowed-tools: Bash, Read
---

# import

Import a local Multica bundle (produced by the export skill) into a target workspace.

## Step 1 — Confirm the target workspace

Ask the user to confirm the name of the target workspace if not already stated. You will need the exact workspace name as registered in Multica.

## Step 2 — Run the import (auto-mapping first)

Each exported agent record carries its source runtime's `provider` (e.g. `claude`, `opencode`) alongside its ID. The import script auto-maps a source runtime to the target workspace's runtime when there is **exactly one** runtime of that provider there — no manual mapping needed in the common case. Try the import without `--runtime-map` first:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-import.mjs" \
  --dir <folder> \
  --workspace <workspace-name>
```

If it aborts with `Unmapped runtimes: ...` (0 or 2+ runtimes share that provider in the target workspace, or the bundle predates provider capture), resolve manually:

```bash
cat <folder>/manifest.json                 # note each distinct sourceRuntimeId
multica runtime list --output json         # list target workspace runtimes
```

Ask the user to pick a matching target runtime by name or ID for each unmapped `sourceRuntimeId`, then re-run with an explicit map (explicit entries always take precedence over auto-mapping):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-import.mjs" \
  --dir <folder> \
  --workspace <workspace-name> \
  --runtime-map <srcId1=dstId1,srcId2=dstId2,...>
```

The import also rewrites any `mention://agent/<id>` link inside squad and agent instructions (e.g. `[@dev-backend](mention://agent/<id>)`) from the source agent's id to its new id in the target workspace — the CLI does this automatically for every agent captured in the bundle; no extra flag needed. Mentions pointing to an agent outside the bundle are left untouched.

## Step 3 — Report results

Parse the JSON output and report:

- Created and updated counts for skills, agents, and squads.
- Name-to-ID maps for skills and agents (`skillIdMap`, `agentIdMap`).
- Squad ID if a squad was imported.
- `mentionsRewritten`: how many agents had an agent-mention link rewritten to its new id.
- If `secretsReminder` is non-empty, surface every agent name verbatim with: "WARNING: the following agents' bundle files contained custom environment variables or MCP config in PLAINTEXT — the source export directory should be treated as sensitive: `<agent-name>`."
- If `secretsApplyFailures` is non-empty, surface every agent name verbatim with: "WARNING: mcp_config or custom_env failed to apply to the following agents during import (the agent itself was still created/updated) — set them manually in the Multica UI: `<agent-name>`."
