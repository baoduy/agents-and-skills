# multica-tool: agent configuration round-trip (MCP config + custom env) — design

**Date:** 2026-07-21
**Status:** Approved (design phase)
**Extends:** `2026-06-30-multica-tool-plugin-design.md`

## Purpose

Today `multica-tool` export/import silently drops two agent fields that can carry real
secrets — `mcp_config` (MCP server definitions, often including API tokens in each
server's `env` block) and `custom_env` (arbitrary custom environment variables). Both are
stripped in `redactAgent` (`multica-export.mjs`), replaced by a single `hadSecrets` boolean
and a warning telling the user to "re-add secrets manually after import." This makes every
export/import/sync of an agent that uses MCP servers or custom env incomplete — the
destination agent silently ends up without them.

This design makes both fields real round-trip fields, matching how every other agent field
(`instructions`, `model`, `runtimeConfig`, `customArgs`, `skills`, ...) already works.

## Research findings (multica CLI 0.4.6, live-tested against a real workspace)

- **`mcp_config` is not secret-gated the way `custom_env` is.** It comes back **in full,
  unredacted** from plain `multica agent get <id>` when called by the workspace owner
  (verified by creating a throwaway agent with `--mcp-config '{"mcpServers":{"foo":{...,
  "env":{"API_KEY":"sk-..."}}}}'` and reading it straight back via `agent get`). The
  response carries an `mcp_config_redacted` boolean alongside it — `false` for the owner in
  testing, presumably `true` when a non-owner/insufficiently-privileged caller reads it.
  `mcp_config` is settable via `--mcp-config` / `--mcp-config-file` / `--mcp-config-stdin`
  on **both** `agent create` and `agent update`.
- **`custom_env` is architecturally hidden.** `agent get`/`agent list` never include it —
  only `has_custom_env` (bool) and `custom_env_key_count` (int). Reading the actual values
  requires the dedicated `multica agent env get <id>` command, which is **owner/admin only
  and every call is recorded** (per its own `--help` text). Setting it uses `multica agent
  env set <id> --custom-env-stdin` (or `--custom-env`/`--custom-env-file`), which supports a
  `****` sentinel per-key to preserve an existing value without re-exposing it — not needed
  here since export always carries the full known value forward.
- **Asymmetric CLI surface for custom env:** `agent create` accepts `--custom-env*` flags
  directly at creation time, but `agent update` has **no** such flag — updating an existing
  agent's custom env requires the separate `agent env set` call.
- **Squads have no MCP/env concept** — confirmed via `squad create --help`. This design is
  agent-only.
- **Secret-on-command-line risk:** the CLI's own `--help` text for `--mcp-config`,
  `--custom-env`, and `agent env set --custom-env` all warn that inline values are visible
  in shell history and `ps`, and recommend `*-stdin` or `*-file` variants for real secrets.

## Scope decisions

1. **Both `mcp_config` and `custom_env` become full round-trip fields** on agent
   export/import/sync (not MCP-only) — the existing "had secrets, re-add manually" warning
   already treats them as one category, and leaving `custom_env` half-fixed would keep the
   tool incomplete for any agent using either feature.
2. **Bundle storage: inline in the existing `agents/<slug>.json` file.** No separate
   `.secrets.json` — matches how every other field is stored today. Trade-off (accepted):
   the export directory itself becomes sensitive whenever any exported agent carries MCP
   config or custom env; the warning text (below) makes this explicit so the user can decide
   how to handle the directory (encryption, `.gitignore`, deletion after import, etc.) rather
   than the tool silently making that call for them.
3. **Overwrite rule: always overwrite from source, every run — but only when the source
   actually has a non-empty value.** No avatar-style "set once, then leave destination
   alone" dedup for these fields — matches the existing convention used by `model`,
   `instructions`, `runtimeConfig`, and `customArgs`, all of which push their CLI flag only
   when the source value is truthy/non-empty, otherwise leave the destination untouched (no
   explicit "clear" semantics introduced here, consistent with today's `if (rec.model)
   common.push(...)` pattern).
4. **`custom_env` fetch is unconditional (no `--include-env` opt-in flag), but skipped when
   `hasCustomEnv` is false.** Every export of an agent that has custom env set will trigger
   the audited `agent env get` call — accepted, since this tool always runs as the
   authenticated owner exporting their own resources, so the audit entry is expected and
   attributable. The `hasCustomEnv` short-circuit avoids firing that audited call for the
   common case (an agent with no custom env at all) — pure efficiency, not a behavior
   change from "always fetch."
5. **Correctness guard against `mcp_config_redacted`.** If the raw agent record reports
   `mcp_config_redacted: true`, `mcpConfig` is **not** written to the bundle — treated the
   same as "not available," with a warning. This is required, not optional: combined with
   scope decision #3 ("always overwrite from source"), writing a redacted/masked value into
   the bundle would silently clobber a good destination `mcp_config` on import.
6. **Secrets transit via stdin, not inline CLI args, at import time.** `--mcp-config-stdin`
   and `--custom-env-stdin` (via `agent env set`) are used instead of `--mcp-config
   <json>`/`--custom-env <json>`, per the CLI's own guidance — keeps secret values out of
   shell history and out of `ps` output on the machine running the import. This requires a
   small extension to `lib.mjs`'s CLI runner to optionally pass stdin `input` through to
   `spawnSync`; no temp files, no cleanup path needed.
7. **Warning message changes, field names don't.** `hadSecrets` / `secretsReminder` stay
   (renaming would be pure churn for no behavior change) but the message text changes from
   "not exported — re-add manually" to a statement that the bundle **does** contain
   plaintext secrets and the directory should be treated as sensitive.

## Data flow

### Export

1. `getAgent` (`lib.mjs`) is unchanged — it already returns `mcpConfig` (from
   `a.mcp_config`) and `hasCustomEnv` (from `a.has_custom_env`). Additionally captures
   `mcpConfigRedacted: a.mcp_config_redacted ?? false`.
2. New `getAgentCustomEnv(cli, id)` in `lib.mjs`:
   ```js
   export function getAgentCustomEnv(cli, id) {
     const r = cli.json(["agent", "env", "get", id]);
     return r.custom_env ?? {};
   }
   ```
   Called from `collectAgent` (`multica-export.mjs`) only when `a.hasCustomEnv` is true;
   otherwise `customEnv` stays `{}`.
3. `redactAgent` no longer strips `mcpConfig`; adds `customEnv`. New logic:
   ```js
   const mcpUsable = !a.mcpConfigRedacted && nonEmpty(a.mcpConfig);
   const hadSecrets = mcpUsable || nonEmpty(a.customEnv) || !!a.mcpConfigRedacted;
   ```
   `record` includes `mcpConfig: mcpUsable ? a.mcpConfig : null` and `customEnv:
   nonEmpty(a.customEnv) ? a.customEnv : null`. `hasCustomEnv` and `mcpConfigRedacted` are
   still excluded from the record itself (they're export-time signals, not agent config to
   restore).
4. Both fields are written into `agents/<slug>.json` exactly like every other field — no
   manifest schema change beyond the two new keys on each agent record.

### Import

1. `importAgents` (`multica-import.mjs`): after the existing `common` flags array is built,
   add:
   ```js
   if (rec.mcpConfig && Object.keys(rec.mcpConfig).length) {
     common.push("--mcp-config-stdin");
     // passed via cli.run's new `input` option, not appended to `args`
   }
   ```
   Requires `cli.run`/`makeCli` to accept an options bag with `input`, threaded to
   `spawnSync(..., { input, encoding: "utf8" })`. `mcp_config` is pushed into the *same*
   `common` array used for both `create` and `update` (flag exists symmetrically on both).
2. `custom_env` cannot go through `common` for the update path (no such flag on `agent
   update`). Handling:
   - **Create:** pass `--custom-env-stdin` alongside the other `create`-only flags, same
     stdin mechanism.
   - **Update (existing match):** after the `agent update` call, if `rec.customEnv` is
     non-empty, issue a follow-up `multica agent env set <id> --custom-env-stdin` call —
     same shape as the existing `agent skills set` follow-up already used for skill
     assignment.
3. No dedup/"already set" check on the destination — always issued when the source value is
   non-empty, per scope decision #3.

## Manifest / bundle schema changes

`agents/<slug>.json` record gains two new (already-normalized) keys:

```json
{
  "name": "...",
  "mcpConfig": { "mcpServers": { "...": { "command": "...", "args": [...], "env": { "...": "..." } } } },
  "customEnv": { "API_KEY": "..." },
  "hadSecrets": true
}
```

Both are `null` when absent, redacted-at-source, or empty. `manifest.json`'s existing
`agents[].hadSecrets` field is unchanged in shape — only its meaning shifts from "were
dropped" to "this record carries plaintext secrets" (or "MCP config was redacted at the
source and could not be captured").

## Error handling summary

| Step | Condition | Behavior |
|------|-----------|----------|
| Export: `agent env get` | agent lacks admin/owner perms in source workspace, call fails | Warn (reuse `hadSecrets`-class warning), `customEnv: null`, export continues |
| Export: `mcp_config_redacted: true` | source caller can't see real MCP config | `mcpConfig: null`, `hadSecrets: true`, warning fired, export continues — **never** write the redacted value |
| Import: `--mcp-config-stdin` / `agent env set --custom-env-stdin` | CLI call non-zero exit | Warn, agent import still counts as created/updated (matches existing avatar-failure convention) |

None of these abort the overall export/import/sync run, consistent with the existing
`hadSecrets`-warning pattern.

## Skill/command doc changes

`skills/export/SKILL.md`, `skills/import/SKILL.md`, `skills/sync/SKILL.md`: replace the
"WARNING: ... were NOT exported — re-add secrets manually" message with:

> "WARNING: the following agents' exported files contain custom environment variables or
> MCP config in PLAINTEXT — treat the export directory as sensitive (avoid committing it to
> a public repo, restrict file permissions, delete it once the import is done): `<agent-name>`."

## Testing (`tests/multica-tool/`)

Extends the existing fixture-and-mock-CLI style. New coverage:

- `getAgentCustomEnv` calls `agent env get` and normalizes `custom_env`.
- Export: `hasCustomEnv: false` never triggers `agent env get` (asserts the mock CLI records
  zero calls to that subcommand).
- Export: `mcp_config_redacted: true` produces `mcpConfig: null` + warning, and the *raw*
  (redacted) value is never written to disk.
- Export: normal case — non-empty `mcpConfig`/`customEnv` written verbatim into the agent
  JSON record.
- Import: new agent (`create` path) — both `--mcp-config-stdin` and `--custom-env-stdin` are
  passed at creation when present; the JSON payload passed as `input` matches the record.
- Import: existing agent (`update` path) — `--mcp-config-stdin` passed on `agent update`;
  separate `agent env set --custom-env-stdin` follow-up call issued only when `customEnv` is
  non-empty.
- Import: source has empty/absent `mcpConfig`/`customEnv` — neither flag/follow-up call is
  issued (destination untouched), matching the `model`/`instructions` convention.
- Always-overwrite: re-running import twice with a non-empty source value issues the
  set/update call both times (no dedup).

Run: `node --test tests/multica-tool/*.test.mjs`.

## Out of scope (YAGNI)

- No separate secrets file / bundle split — accepted trade-off is the whole export
  directory becomes sensitive when secrets are present (scope decision #2).
- No `--include-env` opt-in flag — always-fetch-when-present was chosen over gating the
  audited call behind a flag (scope decision #4).
- No content-hash change detection or "set once" dedup for these fields — always-overwrite
  matches the rest of the agent record (scope decision #3).
- No handling for `agent update`'s lack of a `--custom-env` flag beyond the documented
  `agent env set` follow-up call — this is the CLI's existing shape, not something to work
  around further.
- No support for the `****`-preserve-existing-key sentinel on `agent env set` — irrelevant
  here since export always carries the full known source value, never a partial update.
- No changes to `permission_mode`/`invocation_targets`/`public_to_member` allow-lists — out
  of scope for this design; member IDs aren't portable across workspaces without a
  remapping mechanism this tool doesn't have (unlike runtimes, which already have one).
- No changes to the (separately designed, not-yet-implemented) avatar support work
  (`2026-07-17-multica-tool-avatar-support-design.md`) — orthogonal, tracked separately.
