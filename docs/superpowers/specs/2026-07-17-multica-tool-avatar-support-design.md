# multica-tool: avatar export/import support — design

**Date:** 2026-07-17
**Status:** Approved (design phase)
**Extends:** `2026-06-30-multica-tool-plugin-design.md`

## Purpose

Extend the `multica-tool` plugin's export/import/sync so agent and squad avatars carry
over, instead of being silently dropped. Today `getAgent`/`getSquad` (in `lib.mjs`) don't
even read `avatar_url` off the raw CLI JSON, so avatars are invisible to the exporter.

## Research findings (multica CLI 0.4.3, multica-ai/multica source)

- **Avatars exist on:** `agent`, `squad`, and `workspace` records (`avatar_url` field on
  each). **Skills have no avatar concept** — confirmed via CLI help and the platform docs.
  Workspaces are outside this tool's scope (it never exports workspaces themselves).
- **Agent avatar — CLI has a full round-trip command.** `multica agent avatar <id> --file
  <path>` uploads a local file and sets `avatar_url` in one step. There is **no**
  `--avatar-url` flag on `agent create`/`agent update` — file upload is the *only* way to
  set an agent's avatar via the CLI.
- **Squad avatar — CLI only exposes URL passthrough.** `multica squad update <id>
  --avatar-url <url>` sets an arbitrary URL string directly. There is **no** `multica squad
  avatar` upload subcommand, and `squad create` doesn't accept `--avatar-url` either (must
  create, then update).
- **Portability catch:** on self-hosted instances, `avatar_url` can be an instance-local
  path (e.g. `/uploads/workspaces/<ws>/<id>.webp` served from that specific server). It is
  **not guaranteed to resolve on a different Multica server**. Since `multica-tool` already
  supports migrating resources between workspaces (potentially on different servers, via
  export-to-folder → import-elsewhere), this matters for squads specifically, where the URL
  is the only thing we can carry across.
- **Raw upload endpoint exists:** `POST <server>/api/upload-file` (multipart), confirmed
  working by the user against `https://multica.tsv2.dev/api/upload-file`, returns JSON
  including a durable `url` field. This is the same generic upload primitive the CLI's own
  `agent avatar` command uses internally (upload → PATCH `avatar_url`), just not wrapped by
  the CLI for squads. `multica attachment upload` was considered as an alternative generic
  uploader but rejected — it requires an active chat task (`MULTICA_TASK_ID`), which is
  unavailable to a standalone export/import script, and is semantically scoped to chat-reply
  attachments, not avatars.
- **No CLI command exposes the auth token** (no `gh auth token`-equivalent). Calling the raw
  upload endpoint requires reading the token from the local Multica credential file
  (`multica config show` prints its path); the plugin has never done this before, so it's
  new capability, isolated to exactly one call site (see below).

## Scope decisions

1. **Agents and squads both get avatar support.** Skills are excluded (no avatar concept in
   Multica). Workspaces are excluded (not exported by this tool).
2. **Agent avatars stay 100% CLI-driven.** No raw HTTP needed — `agent avatar --file`
   already does upload+set in one call.
3. **Squad avatars are CLI-driven when source and destination share the same Multica
   server** (URL passthrough via `squad update --avatar-url`), and use exactly **one** raw
   HTTP call (`POST /api/upload-file`) when they don't. This is the only place in the whole
   plugin that talks to Multica's HTTP API directly instead of shelling out to `multica` —
   deliberately isolated into a single helper so it's easy to find, review, and replace if
   the endpoint changes, since it's not part of the documented CLI/API surface.
4. **Dedup rule:** avatar upload/set is only ever attempted when the **destination**
   agent/squad does not already have a non-null `avatar_url`. First import/sync sets the
   avatar once; every subsequent re-run leaves it alone — no repeated uploads, no
   accumulating duplicate files in storage. Trade-off (accepted): if the avatar image
   changes at the source after the first sync, that change does **not** propagate on later
   re-syncs, since the destination already "has an avatar." Content-hash-based
   change-detection was considered and explicitly rejected as unneeded machinery for this
   use case.
5. **All avatar failures are non-fatal.** Download failure at export, or upload/set failure
   at import, produce a warning (same severity class as the existing `hadSecrets`
   warnings) and never abort the surrounding skill/agent/squad export or import.

## Data flow

### Export

1. `getAgent`/`getSquad` (`lib.mjs`) start returning `avatarUrl: raw.avatar_url ?? null`
   alongside their existing normalized fields.
2. In `exportResource` (`multica-export.mjs`), for each collected agent/squad whose
   `avatarUrl` is non-null:
   - `fetch(avatarUrl)` (plain GET, no auth — avatar URLs are public media links).
   - Pick a file extension: from the URL path if it matches a known image extension
     (`png|jpg|jpeg|gif|webp`), else from the response `Content-Type`, else default to
     `png`.
   - Write the bytes to `agents/<slug>-avatar.<ext>` or `squads/<slug>-avatar.<ext>` in the
     output directory.
   - Record `avatarFile` (bundle-relative path) and `avatarUrl` (original, kept for
     reference/debugging — not re-used by agent import, see below) on the manifest entry.
   - On fetch failure: push a warning (`"<name> (avatar download failed: <reason>)"`),
     leave `avatarFile: null`, still keep `avatarUrl` for reference.
3. Capture `sourceServerUrl` once (parse the `server_url:` line from `multica config
   show`) and store it as a new top-level field in `manifest.json`. Only squads consult
   this at import time; it's captured unconditionally since it's cheap and scope-wide.

### Import

**Agents:** after create/update, if the bundle has `avatarFile` for this agent **and** the
destination agent (existing match, or freshly created) currently has no `avatar_url`, call
`multica agent avatar <id> --file <path>`. Otherwise skip.

**Squads:** after create/update, if the bundle has `avatarFile`/`avatarUrl` for this squad
**and** the destination squad currently has no `avatar_url`:
- Parse the destination's `server_url` the same way (`multica config show`).
- If it equals `manifest.sourceServerUrl` → `multica squad update <id> --avatar-url
  <original avatarUrl>` (pure passthrough, no upload — the URL is still reachable).
- Otherwise → upload the bundled file via the one raw call, `POST
  <destServerUrl>/api/upload-file` (multipart, bearer token read from the local Multica
  credential file), take `url` from the JSON response, then `multica squad update <id>
  --avatar-url <newUrl>`.
- Any failure in this branch (credential read, network, non-2xx response) → warning,
  continue the rest of the import.

Note: since `sync` always resolves both workspaces via the *same* authenticated CLI session
(`resolveWorkspaceId` against one `multica workspace list`), source and destination are
always the same server for `sync` — the raw-upload branch is only ever exercised by the
standalone export-to-folder → import-elsewhere flow, not by `sync`.

## Manifest schema changes

```json
{
  "version": "1",
  "sourceServerUrl": "http://127.0.0.1:8080",
  "agents": [{
    "name": "...", "file": "agents/<slug>.json",
    "avatarFile": "agents/<slug>-avatar.png",
    "avatarUrl": "http://.../uploads/workspaces/.../<id>.png"
  }],
  "squads": [{
    "name": "...", "file": "squads/<slug>.json",
    "avatarFile": "squads/<slug>-avatar.webp",
    "avatarUrl": "https://multica-api.tsv2.dev/uploads/workspaces/.../<id>.webp"
  }]
}
```

`avatarFile` and `avatarUrl` are both nullable (absent avatar, or download failed).

## Error handling summary

| Step | Failure | Behavior |
|------|---------|----------|
| Export: avatar download | network error, non-2xx, timeout | Warn, `avatarFile: null`, export continues |
| Import: agent avatar upload | `agent avatar --file` non-zero exit | Warn, agent import still counts as created/updated |
| Import: squad raw upload | credential file unreadable/missing token, network error, non-2xx | Warn, squad import still counts as created/updated |
| Import: squad avatar-url set | `squad update --avatar-url` non-zero exit | Warn, squad import still counts as created/updated |

None of these abort the overall export/import/sync run — matches the existing
`hadSecrets`-warning pattern rather than the "abort on ambiguous name" / "abort on
unmapped runtime" fail-loud paths, since a missing avatar is cosmetic, not a correctness
or data-loss risk.

## Testing (`tests/multica-tool/`)

Extends the existing fixture-and-mock-CLI test style (`fixtures.mjs` + injectable CLI
runner). New coverage:

- `getAgent`/`getSquad` normalization carries `avatarUrl` through from raw `avatar_url`.
- Export: given a mocked `fetch`, an agent/squad with `avatar_url` gets its bytes written
  to the expected bundle path and `avatarFile`/`avatarUrl` recorded in the manifest.
- Export: mocked `fetch` failure produces a warning, `avatarFile: null`, and export still
  completes (doesn't throw).
- Import: destination agent/squad already has a non-null `avatar_url` → the avatar step is
  skipped entirely (no `agent avatar` / `squad update --avatar-url` / raw-upload call
  issued) — encodes the dedup rule.
- Import: destination has no avatar, same `sourceServerUrl` as destination → squad avatar
  set via passthrough `--avatar-url`, no raw HTTP call made.
- Import: destination has no avatar, different `sourceServerUrl` → raw upload helper is
  invoked (mocked), its returned `url` is what's passed to `--avatar-url`.
- Import: agent avatar upload always goes through `agent avatar --file` regardless of
  server match (no raw HTTP call ever made for agents).

Run: `node --test tests/multica-tool/*.test.mjs`.

## Out of scope (YAGNI)

- No content-hash-based change detection for already-set avatars (see dedup trade-off
  above) — re-running sync never refreshes a changed source avatar.
- No workspace avatar support — this tool doesn't export workspaces at all.
- No raw-HTTP path for agents — the CLI already covers the full round-trip.
- No generic "attachment upload" fallback — rejected due to its chat-task scoping.
- No validation of avatar file size/type on our side — `agent avatar --file` and the raw
  upload endpoint already enforce their own limits (5MB, `png|jpg|jpeg|gif|webp`); we let
  those calls fail loud with the server's own error message rather than duplicating checks.
