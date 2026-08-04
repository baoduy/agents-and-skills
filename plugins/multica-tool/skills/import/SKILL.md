---
name: import
description: Use when the user wants to import a Multica export bundle into a target workspace, mapping source runtimes to target runtimes before writing any resources.
allowed-tools: Bash, Read
---

# import

Import a local Multica bundle (produced by the export skill) into a target workspace.

## Step 1 — Determine the target workspace

You need the exact workspace name as registered in Multica for `--workspace` in the steps below.

- If the user named a target workspace, use it.
- If the user did **not** name one, default to the **basename of the import folder** — e.g. importing from `export/mx-workspace` defaults the target workspace to `mx-workspace`. State the inferred workspace name to the user before continuing. This default is reliable for whole-workspace bundles (`export/<workspace-name>`); a single-resource bundle nested under `export/<workspace-name>/<slug>-<type>` has the resource slug as its basename, not the workspace — name the target workspace explicitly in that case.

No existence check is needed here: the Step 2 dry-run fails with `Unknown workspace "<name>"` if the inferred workspace is not present in the target account, at which point ask the user for the correct name.

## Step 2 — Pre-flight (dry run)

Before writing anything, run the import script with `--dry-run` to preview the bundle. Preview against the **full** set (`--include agents,squads,projects,autopilots`) regardless of what the user ultimately chooses to import — incompatibilities for a type (e.g. project caveats) are only computed when that type is included, so previewing everything up front is what lets the user see a project's or autopilot's cost before deciding whether to opt it in:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-import.mjs" \
  --dir <folder> \
  --workspace <workspace-name> \
  --include agents,squads,projects,autopilots \
  [--runtime-map <srcId1=dstId1,srcId2=dstId2,...>] \
  --dry-run
```

Present the `bundle` and `willImport` counts, and every entry in `incompatibilities`, to the user.

## Step 3 — Select which types to import

Ask the user which of `agents`, `squads`, `projects`, `autopilots` they want to import. **Default is `agents,squads`** — `projects` and `autopilots` each require explicit opt-in.

If the pre-flight's `incompatibilities` list contains an `unmapped-runtime` or `autopilot-squad-assignee-unsupported` entry, tell the user it **aborts the import before any write** (see Step 4 below) — `unmapped-runtime` needs `--runtime-map`; a squad-assigned autopilot has no fix, since the multica CLI has no command to assign a squad to an autopilot (only `--agent`) — drop that autopilot from the bundle or recreate its assignment by hand after importing the squad. An `autopilot-assignee-missing` entry also aborts unless resolved by including `agents` or ensuring that agent already exists in the destination. Other incompatibility kinds are informational only and applied best-effort, fixed up afterward in the Multica UI: `priority-not-settable` (project priority isn't settable via the CLI, so it never round-trips), `resource-not-portable` (only `github_repo` resources are portable — other resource kinds are dropped), `lead-agent-missing` (a non-agent lead isn't re-applied to the imported project), `autopilot-priority-not-captured` (the multica CLI/API never returns an autopilot's priority, so it can't be captured or restored at all — a known platform gap, not a bug in this tool), `autopilot-project-missing` (the autopilot's target project isn't found by title in the destination — it's created/updated with no project set), and `autopilot-webhook-reissued` (informational — the webhook trigger always gets a freshly issued URL).

## Step 4 — Run the import (auto-mapping first)

Each exported agent record carries its source runtime's `provider` (e.g. `claude`, `opencode`) alongside its ID. The import script auto-maps a source runtime to the target workspace's runtime when there is **exactly one** runtime of that provider there — no manual mapping needed in the common case. Try the import without `--runtime-map` first, passing the selected types from Step 3 via `--include`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-import.mjs" \
  --dir <folder> \
  --workspace <workspace-name> \
  --include <agents,squads,projects,autopilots>
```

If it aborts with `Unmapped runtimes: ...` (0 or 2+ runtimes share that provider in the target workspace, or the bundle predates provider capture), resolve manually:

```bash
cat <folder>/manifest.json                 # note each distinct source_runtime_id
multica runtime list --output json         # list target workspace runtimes
```

Ask the user to pick a matching target runtime by name or ID for each unmapped `source_runtime_id`, then re-run with an explicit map (explicit entries always take precedence over auto-mapping):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-import.mjs" \
  --dir <folder> \
  --workspace <workspace-name> \
  --include <agents,squads,projects,autopilots> \
  --runtime-map <srcId1=dstId1,srcId2=dstId2,...>
```

If it instead aborts with `Unresolved autopilot assignees: ...`, that is not fixable with `--runtime-map` — either the autopilot is squad-assigned (no CLI support, see Step 3) or its assignee agent isn't available in this import or the destination; ensure `agents` is included, or that the agent already exists in the destination workspace under the same name, then re-run.

The import also rewrites any `mention://agent/<id>` link inside squad and agent instructions (e.g. `[@dev-backend](mention://agent/<id>)`) from the source agent's id to its new id in the target workspace — the CLI does this automatically for every agent captured in the bundle; no extra flag needed. Mentions pointing to an agent outside the bundle are left untouched.

Instructions are read back from each resource's sibling `.md` (`agents/<slug>.md`, `squads/<slug>.md`) when present — editing that Markdown is the supported way to review and enhance an agent's or squad's instructions before import. An agent's description is read back the same way from `agents/<slug>.description.md` when a `description_file` key is present. Older bundles that predate the split (instructions/description inline in the JSON, no `instructions_file`/`description_file`) still import unchanged.

Avatars are restored automatically, but **only when the target resource has none** — an existing agent or squad that already carries an avatar is never overwritten. New agents get their bundled image re-uploaded; new squads get their `avatar_url` (emoji or URL) set. An agent whose source avatar was an emoji can't be restored (the CLI has no emoji setter for agents) and is reported as unsupported.

Importing `autopilots` always creates a brand-new autopilot **paused**, regardless of the source's status — activation is left as a deliberate follow-up action, never automatic. Re-importing an already-imported autopilot updates it by title (never duplicates) but leaves its current status alone. Its triggers are upserted by kind+label — a re-import never adds a duplicate trigger — and a webhook trigger always gets a freshly issued URL, never the source's.

## Step 5 — Report results

Parse the JSON output and report:

- Created and updated counts for skills, agents, squads, projects, and autopilots (`created.autopilots`/`updated.autopilots`).
- Name-to-ID maps for skills and agents (`skillIdMap`, `agentIdMap`).
- `squadIdMap`: name-to-ID map for every squad imported.
- `autopilotIdMap`: name-to-ID map for every autopilot imported.
- `mentionsRewritten`: how many agents had an agent-mention link rewritten to its new id.
- If `leadUnresolved`, `priorityUnsupported`, `resourcesUnsupported`, or `squadsSkipped` is non-empty, surface each entry verbatim as an "applied best-effort; adjust in the UI" note — e.g. "NOTE: applied best-effort; adjust in the UI — `<entry>`."
- If `secretsReminder` is non-empty, surface every agent name verbatim with: "WARNING: the following agents' bundle files contained custom environment variables or MCP config in PLAINTEXT — the source export directory should be treated as sensitive: `<agent-name>`."
- If `secretsApplyFailures` is non-empty, surface every agent name verbatim with: "WARNING: mcp_config or custom_env failed to apply to the following agents during import (the agent itself was still created/updated) — set them manually in the Multica UI: `<agent-name>`."
- If `avatarApplyFailures` is non-empty, surface every agent name verbatim with: "WARNING: the avatar image failed to upload for the following agents — set it manually in the Multica UI: `<agent-name>`."
- If `avatarUnsupported` is non-empty, surface every agent name verbatim with: "NOTE: the following agents had an emoji avatar at the source, which the CLI cannot set on an agent — set it manually in the Multica UI: `<agent-name>`."
- If `permissionApplyFailures` is non-empty, surface every agent name verbatim with: "WARNING: member-specific sharing failed to apply for the following agents — set their invocation permissions manually in the Multica UI: `<agent-name>`."
- If `permissionUnsupported` is non-empty, surface every agent name verbatim with: "NOTE: the following agents were shared with specific members at the source, but none of those users exist in the target workspace — re-share manually if needed: `<agent-name>`."
- If `autopilotProjectUnresolved` is non-empty, surface every autopilot title verbatim with: "NOTE: the following autopilots' target project could not be matched by title in the target workspace — created/updated with no project set: `<autopilot-title>`."
- If `autopilotSubscribersUnresolved` is non-empty, surface every `<title>:<member-name>` entry verbatim with: "NOTE: the following autopilot subscribers could not be matched by name in the target workspace — skipped: `<entry>`."
- If `autopilotPriorityNotCaptured` is non-empty, surface every autopilot title verbatim with: "NOTE: the following autopilots' priority could not be captured from the source (the multica CLI/API never returns it) — a known platform gap, not something this tool can fix: `<autopilot-title>`."
- If `autopilotWebhookReissued` is non-empty, surface every autopilot title verbatim with: "NOTE: the following autopilots had a webhook trigger created with a freshly issued URL — the previous URL does not carry over: `<autopilot-title>`."
