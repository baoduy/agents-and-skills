# Multica whole-workspace export + agent field fidelity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `--scope all` whole-workspace export/import mode and round-trip two more agent fields (`service_tier`, member-specific `permission_mode`).

**Architecture:** Extend the existing single-root exporter to collect every skill/agent/squad into the same flat, name-deduped bundle (the on-disk format already supports many squads). Import loops all squads instead of just the first, and applies the two new agent fields — `service_tier` inline, member-specific `public_to` sharing as an isolated follow-up call gated on destination-member resolvability.

**Tech Stack:** Node.js (ESM, `node:test`), the `multica` CLI. No new dependencies.

## Global Constraints

- Node built-in test runner only: `node --test tests/multica-tool/*.test.mjs`. No test framework.
- All `cli`/`fs`/`download` are injected for testability — never call the real CLI or network in unit tests.
- Feature code stays under `plugins/multica-tool/`; tests under repo-root `tests/multica-tool/`.
- Manifest `version` stays `"1"` — the format is backward compatible (no schema change).
- Optional CLI flags are pushed only when their value is truthy (empty string means "inherit/clear" — never pass it), matching the existing `model`/`thinking_level` pattern.
- House style: minimal diff, surgical edits, match surrounding snake_case field naming.
- This plan builds on the uncommitted avatar work already in the working tree. Commit that first (see Task 0) so each task below is an isolated commit.

---

### Task 0: Commit the pending avatar work

**Files:** none created; commits existing working-tree changes.

- [ ] **Step 1: Confirm tests pass and review the pending diff**

Run: `node --test tests/multica-tool/*.test.mjs`
Expected: `# pass 61 # fail 0`

Run: `git status --short` — expect modified `plugins/multica-tool/scripts/{lib,multica-export,multica-import}.mjs`, `plugins/multica-tool/skills/{export,import,sync}/SKILL.md`, `tests/multica-tool/{export,import,fixtures}*.mjs`.

- [ ] **Step 2: Commit the avatar feature**

```bash
git add plugins/multica-tool/scripts/lib.mjs plugins/multica-tool/scripts/multica-export.mjs plugins/multica-tool/scripts/multica-import.mjs plugins/multica-tool/skills/export/SKILL.md plugins/multica-tool/skills/import/SKILL.md plugins/multica-tool/skills/sync/SKILL.md tests/multica-tool/export.test.mjs tests/multica-tool/import.test.mjs tests/multica-tool/fixtures.mjs
git commit -m "feat(multica-tool): export/import agent and squad avatars

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1: Capture `service_tier`, `permission_mode`, `invocation_targets` in `getAgent`

**Files:**
- Modify: `plugins/multica-tool/scripts/lib.mjs` (`getAgent` allow-list)
- Modify: `tests/multica-tool/fixtures.mjs` (`AGENT_GET`)
- Test: `tests/multica-tool/lib.test.mjs`

**Interfaces:**
- Produces: `getAgent(cli, id)` return object gains `service_tier: string`, `permission_mode: string|null`, `invocation_targets: Array<{target_id, target_type}>`. These flow untouched through `redactAgent`'s `...rest` into the exported agent record (Task 2 relies on that).

- [ ] **Step 1: Extend the `AGENT_GET` fixture**

In `tests/multica-tool/fixtures.mjs`, add the three fields to `AGENT_GET` (keep it mirroring a workspace-visible agent):

```js
  has_custom_env: true, custom_env_key_count: 1, avatar_url: "emoji:🤖",
  service_tier: "", permission_mode: "public_to",
  invocation_targets: [{ target_id: "ws_SRC", target_type: "workspace" }],
  mcp_config: { mcpServers: { x: { token: "t" } } }, mcp_config_redacted: false,
```

- [ ] **Step 2: Write the failing test**

Add to `tests/multica-tool/lib.test.mjs`:

```js
test("getAgent captures service_tier, permission_mode, and invocation_targets", () => {
  const cli = cliReturning({ "agent get ag_SRC1": AGENT_GET });
  const a = getAgent(cli, "ag_SRC1");
  assert.equal(a.service_tier, "");
  assert.equal(a.permission_mode, "public_to");
  assert.deepEqual(a.invocation_targets, [{ target_id: "ws_SRC", target_type: "workspace" }]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/multica-tool/lib.test.mjs`
Expected: FAIL — `a.permission_mode` is `undefined`.

- [ ] **Step 4: Add the fields to `getAgent`**

In `plugins/multica-tool/scripts/lib.mjs`, inside `getAgent`'s returned object, add after the `visibility`/`avatar_url` line:

```js
    service_tier: a.service_tier ?? "",
    permission_mode: a.permission_mode ?? null,
    invocation_targets: (a.invocation_targets ?? []).map((t) => ({ target_id: t.target_id, target_type: t.target_type })),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/multica-tool/lib.test.mjs tests/multica-tool/export.test.mjs`
Expected: PASS (export tests still green — the new fields are additive).

- [ ] **Step 6: Commit**

```bash
git add plugins/multica-tool/scripts/lib.mjs tests/multica-tool/fixtures.mjs tests/multica-tool/lib.test.mjs
git commit -m "feat(multica-tool): capture service_tier/permission_mode/invocation_targets in getAgent"
```

---

### Task 2: `--scope all` whole-workspace export

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-export.mjs` (`buildManifest`, `exportResource`, `main`)
- Test: `tests/multica-tool/export.test.mjs`

**Interfaces:**
- Consumes: `getAgent` fields from Task 1; `listSkills`, `listAgents`, `listSquads` from `lib.mjs`.
- Produces: `exportResource({ scope: "all", ids: {}, … })` collects every resource. `buildManifest` now takes `squads` (array) instead of `squad` (single). Import (Task 3) relies on `manifest.squads` holding every squad.

- [ ] **Step 1: Update the `buildManifest` unit test to the array signature**

In `tests/multica-tool/export.test.mjs`, in the test `"buildManifest dedups skills/agents by name and wires by name"`, change the `squad:` argument to `squads:` wrapping the object in an array:

```js
    squads: [{ name: "Team", description: "the team", leader_name: "Helper", members: [{ agent_name: "Helper2", role: "member" }] }],
```

- [ ] **Step 2: Write the failing test for `--scope all`**

Add to `tests/multica-tool/export.test.mjs`:

```js
test("export all collects every resource and writes a shared agent exactly once", () => {
  const fs = memFs();
  const cli = {
    json: (args) => {
      const two = args.slice(0, 2).join(" ");
      const three = args.slice(0, 3).join(" ");
      if (two === "skill list") return [{ id: "sk_SRC1", name: "Greet" }];
      if (two === "agent list") return [{ id: "ag_SRC1" }, { id: "ag_SRC2" }];
      if (two === "squad list") return [{ id: "sq_A", name: "A" }, { id: "sq_B", name: "B" }];
      if (three === "skill get sk_SRC1") return SKILL_GET;
      if (three === "agent get ag_SRC1") return AGENT_GET;
      if (three === "agent get ag_SRC2") return AGENT_GET_2;
      if (three === "runtime list") return RUNTIME_LIST_SRC;
      if (three === "squad get sq_A") return { id: "sq_A", name: "A", description: "", instructions: "", leader_id: "ag_SRC1", avatar_url: "emoji:🅰️" };
      if (three === "squad get sq_B") return { id: "sq_B", name: "B", description: "", instructions: "", leader_id: "ag_SRC2", avatar_url: "emoji:🅱️" };
      if (three === "squad member list") {
        if (args[3] === "sq_A") return [{ member_id: "ag_SRC1", member_type: "agent", role: "leader" }, { member_id: "ag_SRC2", member_type: "agent", role: "member" }];
        if (args[3] === "sq_B") return [{ member_id: "ag_SRC2", member_type: "agent", role: "leader" }];
      }
      throw new Error("unexpected " + args.join(" "));
    },
    run: () => "",
  };
  const { manifest } = exportResource({ cli, scope: "all", ids: {}, outDir: "/all", sourceWorkspaceId: "ws", fs, download: () => null });
  assert.equal(manifest.skills.length, 1, "one skill");
  assert.equal(manifest.agents.length, 2, "ag_SRC1 + ag_SRC2 each once (ag_SRC2 shared by both squads)");
  assert.equal(manifest.squads.length, 2, "both squads present");
  assert.ok(fs.files["/all/agents/helper2.json"], "shared agent written once");
  assert.ok(fs.files["/all/squads/a.json"] && fs.files["/all/squads/b.json"], "both squad files written");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: FAIL — `scope: "all"` collects nothing today; `manifest.squads.length` is 0.

- [ ] **Step 4: Change `buildManifest` to accept a `squads` array**

In `plugins/multica-tool/scripts/multica-export.mjs`, change the `buildManifest` signature and squads mapping:

```js
export function buildManifest({ scope, sourceWorkspaceId, skills, agents, squads }) {
  const seenSkills = new Map();
  for (const s of skills) if (!seenSkills.has(s.name)) seenSkills.set(s.name, s);
  const seenAgents = new Map();
  for (const a of agents) if (!seenAgents.has(a.name)) seenAgents.set(a.name, a);
  return {
    version: "1",
    scope,
    source_workspace_id: sourceWorkspaceId,
    skills: [...seenSkills.values()].map((s) => ({ name: s.name, dir: `skills/${slugify(s.name)}`, source_id: s.source_id })),
    agents: [...seenAgents.values()].map((a) => ({ name: a.name, file: `agents/${slugify(a.name)}.json`, source_id: a.source_id, source_runtime_id: a.source_runtime_id, source_runtime_provider: a.source_runtime_provider ?? null, skill_names: a.skill_names, had_secrets: !!a.had_secrets })),
    squads: (squads ?? []).map((squad) => ({ name: squad.name, file: `squads/${slugify(squad.name)}.json`, description: squad.description ?? "", instructions: squad.instructions ?? "", avatar_url: squad.avatar_url ?? null, leader_name: squad.leader_name, members: squad.members })),
  };
}
```

- [ ] **Step 5: Add the `listSkills`/`listAgents`/`listSquads` imports**

In `plugins/multica-tool/scripts/multica-export.mjs`, extend the `lib.mjs` import to include the list helpers:

```js
import { slugify, getSkill, getAgent, getAgentCustomEnv, getSquad, getSquadMembers, listRuntimes, listSkills, listAgents, listSquads, makeCli, realExec, requireAuth, resolveWorkspaceId } from "./lib.mjs";
```

- [ ] **Step 6: Collect all resources in `exportResource`**

In `exportResource`, replace `let squad = null;` with `const squads = [];`, then replace the scope `if` blocks with a `collectOneSquad` closure and an `all` branch:

```js
  // Collect a squad's agents (leader + members) and return the squad bundle object.
  function collectOneSquad(squadId) {
    const sq = getSquad(cli, squadId);
    const members = getSquadMembers(cli, squadId).filter((m) => m.member_type === "agent");
    for (const m of members) collectAgent(cli, m.member_id, agentsById, skills, getProviderById());
    if (!agentsById.has(sq.leader_id)) collectAgent(cli, sq.leader_id, agentsById, skills, getProviderById());
    const nameOf = (id) => agentsById.get(id)?.raw.name;
    return {
      name: sq.name, description: sq.description, instructions: sq.instructions, avatar_url: sq.avatar_url,
      leader_name: nameOf(sq.leader_id),
      members: members.map((m) => ({ agent_name: nameOf(m.member_id), role: m.role })),
    };
  }

  if (scope === "skill") collectSkill(cli, ids.skillId, skills);
  else if (scope === "agent") collectAgent(cli, ids.agentId, agentsById, skills, getProviderById());
  else if (scope === "squad") squads.push(collectOneSquad(ids.squadId));
  else if (scope === "all") {
    for (const s of listSkills(cli)) collectSkill(cli, s.id, skills);
    for (const a of listAgents(cli)) collectAgent(cli, a.id, agentsById, skills, getProviderById());
    for (const sq of listSquads(cli)) squads.push(collectOneSquad(sq.id));
  }
```

Then update the `buildManifest` call to pass `squads` instead of `squad`:

```js
  const manifest = buildManifest({
    scope, sourceWorkspaceId,
    skills: [...skills.values()].map((s) => ({ name: s.name, source_id: s.id })),
    agents: [...agentsById.values()].map((a) => ({ name: a.raw.name, source_id: a.raw.id, source_runtime_id: a.raw.runtime_id, source_runtime_provider: a.raw.source_runtime_provider, skill_names: a.skill_names, had_secrets: a.red.hadSecrets })),
    squads,
  });
```

- [ ] **Step 7: Run the failing test to verify it passes**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: PASS (including the updated `buildManifest` test).

- [ ] **Step 8: Teach `main()` the `all` scope**

In `plugins/multica-tool/scripts/multica-export.mjs` `main()`, update the usage guard and id assignment:

```js
  if (!scope || !out || (scope !== "all" && !id)) {
    console.error("Usage: multica-export.mjs --scope <skill|agent|squad|all> --id <id> --out <dir> [--workspace <name>]  (--id not needed for --scope all)");
    process.exit(1);
  }
```

and in the scope→ids block:

```js
  const ids = {};
  if (scope === "skill")       ids.skillId  = id;
  else if (scope === "agent")  ids.agentId  = id;
  else if (scope === "squad")  ids.squadId  = id;
  else if (scope === "all")    { /* whole workspace — no id */ }
  else { console.error(`Unknown scope "${scope}" — use skill|agent|squad|all`); process.exit(1); }
```

- [ ] **Step 9: Run the full export + lib suite**

Run: `node --test tests/multica-tool/lib.test.mjs tests/multica-tool/export.test.mjs`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add plugins/multica-tool/scripts/multica-export.mjs tests/multica-tool/export.test.mjs
git commit -m "feat(multica-tool): add --scope all whole-workspace export"
```

---

### Task 3: Import every squad, not just the first

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-import.mjs` (`importBundle`)
- Test: `tests/multica-tool/import.test.mjs`

**Interfaces:**
- Consumes: `importSquad({ cli, squad, agentIdMap, sourceIdMap })` (unchanged) returning `{ newId, created, updated }`.
- Produces: `importBundle(...)` result now has `squadIdMap: {name: id}` and aggregated `created.squads`/`updated.squads`; the old `squadId` field is removed.

- [ ] **Step 1: Write the failing test**

Add to `tests/multica-tool/import.test.mjs` (near the other `importBundle`-level imports — add `import { importBundle } from "../../plugins/multica-tool/scripts/multica-import.mjs";` if not already present):

```js
test("importBundle imports every squad and returns a squadIdMap", () => {
  const files = {
    "b/manifest.json": JSON.stringify({
      version: "1", scope: "all", source_workspace_id: "ws_SRC",
      skills: [],
      agents: [{ name: "Helper", file: "agents/helper.json", source_runtime_id: "rt_SRC1", source_runtime_provider: "claude", skill_names: [] }],
      squads: [
        { name: "A", file: "squads/a.json", leader_name: "Helper", instructions: "", members: [{ agent_name: "Helper", role: "leader" }] },
        { name: "B", file: "squads/b.json", leader_name: "Helper", instructions: "", members: [{ agent_name: "Helper", role: "leader" }] },
      ],
    }),
    "b/agents/helper.json": JSON.stringify({ name: "Helper", instructions: "be nice", model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6, source_id: "ag_SRC1", source_runtime_id: "rt_SRC1", skill_names: [] }),
  };
  const fs = { existsSync: (p) => p in files, readFileSync: (p) => files[p], readdirSync: () => [] };
  let sqN = 0;
  const cli = {
    json: (a) => {
      if (a[0] === "runtime" && a[1] === "list") return [{ id: "rt_TGT1", provider: "claude" }];
      if (a[0] === "squad" && a[1] === "member" && a[2] === "list") return [];
      if (a[1] === "list") return [];
      return {};
    },
    run: (a) => {
      if (a[0] === "squad" && a[1] === "create") return `{"id":"sq_NEW${++sqN}"}`;
      if (a.includes("create")) return '{"id":"ag_NEW1"}';
      return "{}";
    },
  };
  const res = importBundle({ cli, dir: "b", runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  assert.equal(res.created.squads, 2, "both squads created");
  assert.deepEqual(Object.keys(res.squadIdMap).sort(), ["A", "B"]);
  assert.ok(!("squadId" in res), "single squadId replaced by squadIdMap");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: FAIL — only squad `A` is imported; `res.squadIdMap` is undefined.

- [ ] **Step 3: Loop all squads in `importBundle`**

In `plugins/multica-tool/scripts/multica-import.mjs`, replace the single-squad block:

```js
  let squadRes = { newId: null, created: 0, updated: 0 };
  if (manifest.squads?.length) squadRes = importSquad({ cli, squad: manifest.squads[0], agentIdMap: agentRes.idMap, sourceIdMap: agentRes.sourceIdMap });
```

with a loop:

```js
  const squadIdMap = new Map();
  let squadsCreated = 0, squadsUpdated = 0;
  for (const squad of manifest.squads ?? []) {
    const r = importSquad({ cli, squad, agentIdMap: agentRes.idMap, sourceIdMap: agentRes.sourceIdMap });
    squadIdMap.set(squad.name, r.newId);
    squadsCreated += r.created;
    squadsUpdated += r.updated;
  }
```

- [ ] **Step 4: Update the `importBundle` return**

Change the `created`/`updated`/squad lines in the returned object:

```js
    created: { skills: skillRes.created, agents: agentRes.created, squads: squadsCreated },
    updated: { skills: skillRes.updated, agents: agentRes.updated, squads: squadsUpdated },
    mentionsRewritten: mentionRes.updated,
    skillIdMap: Object.fromEntries(skillRes.idMap),
    agentIdMap: Object.fromEntries(agentRes.idMap),
    squadIdMap: Object.fromEntries(squadIdMap),
```

(Delete the old `squadId: squadRes.newId,` line.)

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/multica-tool/scripts/multica-import.mjs tests/multica-tool/import.test.mjs
git commit -m "feat(multica-tool): import every squad in the bundle, return squadIdMap"
```

---

### Task 4: Import `service_tier` and member-specific `permission_mode`

**Files:**
- Modify: `plugins/multica-tool/scripts/lib.mjs` (add `listWorkspaceMembers`)
- Modify: `plugins/multica-tool/scripts/multica-import.mjs` (`importAgents`, `importBundle`)
- Test: `tests/multica-tool/import.test.mjs`

**Interfaces:**
- Consumes: agent record fields `service_tier`, `permission_mode`, `invocation_targets` (Task 1); `listWorkspaceMembers(cli)`.
- Produces: `importAgents(...)` result gains `permissionApplyFailures: string[]` and `permissionUnsupported: string[]`; `importBundle(...)` surfaces both.

- [ ] **Step 1: Add `listWorkspaceMembers` to lib.mjs**

In `plugins/multica-tool/scripts/lib.mjs`, next to the other `list*` helpers:

```js
export const listWorkspaceMembers = (cli) => cli.json(["workspace", "member", "list"]);
```

- [ ] **Step 2: Write the failing tests**

Add to `tests/multica-tool/import.test.mjs`:

```js
test("importAgents passes --service-tier when set, omits it when empty", () => {
  const mk = (svc) => {
    const fs = { existsSync: () => true, readFileSync: () => JSON.stringify({ ...JSON.parse(AGENT_FILE), service_tier: svc }), readdirSync: () => [] };
    const calls = [];
    const cli = { calls, json: (a) => (a[1] === "list" ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; } };
    importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
    return calls.find((a) => a[1] === "create");
  };
  const withTier = mk("flex");
  assert.equal(withTier[withTier.indexOf("--service-tier") + 1], "flex");
  assert.ok(!mk("").includes("--service-tier"), "empty service_tier omitted");
});

test("importAgents restores member-specific public_to only for members that exist in the destination", () => {
  const rec = { ...JSON.parse(AGENT_FILE), permission_mode: "public_to", invocation_targets: [{ target_id: "u1", target_type: "user" }, { target_id: "u_missing", target_type: "user" }] };
  const fs = { existsSync: () => true, readFileSync: () => JSON.stringify(rec), readdirSync: () => [] };
  const calls = [];
  const cli = {
    calls,
    json: (a) => {
      if (a[0] === "workspace" && a[1] === "member" && a[2] === "list") return [{ user_id: "u1" }, { user_id: "u2" }];
      if (a[1] === "list") return [];
      return {};
    },
    run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; },
  };
  const { permissionUnsupported } = importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  const pub = calls.find((a) => a.includes("--public-to-member"));
  assert.deepEqual(pub, ["agent", "update", "ag_NEW1", "--public-to-member", "u1"], "only the resolvable member id applied");
  assert.deepEqual(permissionUnsupported, [], "at least one member resolved, so not unsupported");
});

test("importAgents reports permissionUnsupported and makes no call when no member target resolves", () => {
  const rec = { ...JSON.parse(AGENT_FILE), permission_mode: "public_to", invocation_targets: [{ target_id: "u_gone", target_type: "user" }] };
  const fs = { existsSync: () => true, readFileSync: () => JSON.stringify(rec), readdirSync: () => [] };
  const calls = [];
  const cli = {
    calls,
    json: (a) => {
      if (a[0] === "workspace" && a[1] === "member" && a[2] === "list") return [{ user_id: "u1" }];
      if (a[1] === "list") return [];
      return {};
    },
    run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; },
  };
  const { permissionUnsupported } = importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  assert.deepEqual(permissionUnsupported, ["Helper"]);
  assert.ok(!calls.some((a) => a.includes("--public-to-member")), "no call when nothing resolves");
});

test("importAgents makes no public-to-member call for a workspace-wide public_to agent", () => {
  const rec = { ...JSON.parse(AGENT_FILE), permission_mode: "public_to", invocation_targets: [{ target_id: "ws", target_type: "workspace" }] };
  const fs = { existsSync: () => true, readFileSync: () => JSON.stringify(rec), readdirSync: () => [] };
  const calls = [];
  const cli = { calls, json: (a) => (a[1] === "list" ? [] : {}), run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; } };
  importAgents({ cli, manifest: AGENT_MANIFEST, dir: ".", skillIdMap: new Map([["Greet", "sk_NEW1"]]), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs });
  assert.ok(!calls.some((a) => a.includes("--public-to-member")), "workspace target handled by --visibility, no follow-up");
  assert.ok(!calls.some((a) => a[0] === "workspace" && a[1] === "member"), "member list never fetched when no user targets");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: FAIL — `--service-tier` never pushed; `--public-to-member` never called; `permissionUnsupported` undefined.

- [ ] **Step 4: Import `listWorkspaceMembers`, add result arrays and a memoized member set**

In `plugins/multica-tool/scripts/multica-import.mjs`, add `listWorkspaceMembers` to the `lib.mjs` import. Then in `importAgents`, alongside the existing `avatarApplyFailures`/`avatarUnsupported` declarations, add:

```js
  const permissionApplyFailures = [];  // CLI rejected --public-to-member
  const permissionUnsupported = [];    // no member target resolved in the destination
  // Lazy + memoized: destination member user_ids, only listed when an agent needs them.
  let destMemberIds = null;
  const getDestMemberIds = () => destMemberIds ??= new Set(listWorkspaceMembers(cli).map((m) => m.user_id));
```

- [ ] **Step 5: Push `--service-tier` in the common flags**

In `importAgents`, in the block that builds `common` (right after the `custom_args` push), add:

```js
    if (rec.service_tier) common.push("--service-tier", rec.service_tier);
```

- [ ] **Step 6: Apply the member-specific permission follow-up**

In `importAgents`, after the avatar block (still inside the `for (const a of manifest.agents)` loop), add:

```js
    // Restore member-specific public_to sharing that --visibility can't express.
    // (private and workspace-wide public_to already round-trip via --visibility.)
    if (rec.permission_mode === "public_to") {
      const memberTargets = (rec.invocation_targets ?? []).filter((t) => t.target_type === "user");
      if (memberTargets.length) {
        const resolvable = memberTargets.map((t) => t.target_id).filter((tid) => getDestMemberIds().has(tid));
        if (!resolvable.length) {
          permissionUnsupported.push(rec.name);
        } else {
          try {
            cli.run(["agent", "update", id, ...resolvable.flatMap((tid) => ["--public-to-member", tid])]);
          } catch {
            permissionApplyFailures.push(rec.name);
          }
        }
      }
    }
```

- [ ] **Step 7: Return the two arrays from `importAgents`**

Change the `importAgents` return to include them:

```js
  return { idMap, sourceIdMap, created, updated, secretsApplyFailures, avatarApplyFailures, avatarUnsupported, permissionApplyFailures, permissionUnsupported };
```

- [ ] **Step 8: Surface them from `importBundle`**

In `importBundle`'s returned object, after the avatar fields, add:

```js
    permissionApplyFailures: agentRes.permissionApplyFailures,
    permissionUnsupported: agentRes.permissionUnsupported,
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add plugins/multica-tool/scripts/lib.mjs plugins/multica-tool/scripts/multica-import.mjs tests/multica-tool/import.test.mjs
git commit -m "feat(multica-tool): import service_tier and member-specific public_to permissions"
```

---

### Task 5: Documentation — `--scope all`, new fields, new warnings

**Files:**
- Modify: `plugins/multica-tool/skills/export/SKILL.md`
- Modify: `plugins/multica-tool/skills/import/SKILL.md`
- Modify: `plugins/multica-tool/skills/sync/SKILL.md`

**Interfaces:** none (docs only). Report-field names must match Task 3/4 output: `squadIdMap`, `permissionApplyFailures`, `permissionUnsupported`.

- [ ] **Step 1: Export SKILL — document `--scope all`**

In `plugins/multica-tool/skills/export/SKILL.md`, in Step 4's command block, change the scope hint and add a note under it:

Change `--scope <type>` usage to note `all`, and add after the command block:

```markdown
Pass `--scope all` (with no `--id`) to export the **entire workspace** — every skill, agent, and squad — into one flat, deduped bundle. A skill or agent shared across many agents/squads is written exactly once and referenced by name.
```

- [ ] **Step 2: Import SKILL — squadIdMap + permission warnings**

In `plugins/multica-tool/skills/import/SKILL.md` Step 3, change the "Squad ID if a squad was imported." bullet to:

```markdown
- `squadIdMap`: name-to-ID map for every squad imported.
```

and add two bullets after the `avatarUnsupported` bullet:

```markdown
- If `permissionApplyFailures` is non-empty, surface every agent name verbatim with: "WARNING: member-specific sharing failed to apply for the following agents — set their invocation permissions manually in the Multica UI: `<agent-name>`."
- If `permissionUnsupported` is non-empty, surface every agent name verbatim with: "NOTE: the following agents were shared with specific members at the source, but none of those users exist in the target workspace — re-share manually if needed: `<agent-name>`."
```

- [ ] **Step 3: Sync SKILL — permission warnings**

In `plugins/multica-tool/skills/sync/SKILL.md` Step 3, add the same two bullets after its `avatarUnsupported` bullet (reuse the wording from Step 2, replacing "Multica UI"/"target workspace" with "destination workspace").

- [ ] **Step 4: Validate the three skills**

Run: `python3 -c "import re; [print(p, 'OK') for p in ['plugins/multica-tool/skills/export/SKILL.md','plugins/multica-tool/skills/import/SKILL.md','plugins/multica-tool/skills/sync/SKILL.md'] if (lambda t: re.match(r'^---\n.*?\n---\n', t, re.S) and len(t.split(chr(10)))<520)(open(p).read())]"`
Expected: three `OK` lines (frontmatter present, body under ~500 lines).

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/skills/export/SKILL.md plugins/multica-tool/skills/import/SKILL.md plugins/multica-tool/skills/sync/SKILL.md
git commit -m "docs(multica-tool): document --scope all, service_tier, and permission warnings"
```

---

### Task 6: Full-suite regression + live smoke test + validation

**Files:** none modified (verification only).

- [ ] **Step 1: Run the entire test suite**

Run: `node --test tests/multica-tool/*.test.mjs`
Expected: all pass, 0 fail.

- [ ] **Step 2: Syntax-check every script**

Run: `for f in lib multica-export multica-import multica-sync; do node --check plugins/multica-tool/scripts/$f.mjs && echo "OK $f"; done`
Expected: four `OK` lines.

- [ ] **Step 3: Live read-only smoke test of `--scope all`**

Run (writes only to the scratchpad, reads the live workspace):

```bash
node plugins/multica-tool/scripts/multica-export.mjs --scope all --out "$SCRATCH/exp-all" >/dev/null 2>&1
echo "skills:$(ls "$SCRATCH/exp-all/skills" | wc -l) agents:$(ls "$SCRATCH/exp-all/agents"/*.json | wc -l) squads:$(ls "$SCRATCH/exp-all/squads"/*.json | wc -l)"
python3 -c "import json; a=json.load(open('$SCRATCH/exp-all/agents/default.json')); print('service_tier' in a, 'permission_mode' in a, 'invocation_targets' in a)"
```

(Substitute the scratchpad path for `$SCRATCH`.) Expected: nonzero counts; three `True` values confirming the new fields round-trip. Confirm a squad-shared agent appears once in `agents/`.

- [ ] **Step 4: Run the plugin-validator agent**

Invoke the `plugin-validator` agent scoped to `plugins/multica-tool/` (per repo policy after any plugin implementation). Fix any `[FAIL]` items before finishing.

- [ ] **Step 5: Final commit if validation produced fixes**

Only if Step 4 changed files:

```bash
git add -A plugins/multica-tool
git commit -m "chore(multica-tool): address plugin-validator findings"
```

## Self-Review

**Spec coverage:**
- Part A (`--scope all`, `squads[]`, dedup, import loop) → Tasks 2 & 3. ✓
- Part B (`service_tier`, `permission_mode` member-specific, report fields) → Tasks 1 & 4. ✓
- "Not restored" fields (`disabled_runtime_skills`, `runtime_mode`, `status`) → intentionally untouched; no task needed. ✓
- Docs (SKILL.md updates for scope/fields/warnings) → Task 5. ✓
- Testing (unit + live smoke) → embedded per task + Task 6. ✓

**Placeholder scan:** every code/test step contains concrete code; no TBD/TODO. ✓

**Type consistency:** `squads` array threads buildManifest (Task 2) → manifest.squads → import loop (Task 3). `permissionApplyFailures`/`permissionUnsupported` defined in `importAgents` (Task 4 Step 4) and returned (Step 7), surfaced by `importBundle` (Step 8), documented (Task 5). `listWorkspaceMembers` returns objects with `user_id`, matched against `invocation_targets[].target_id` for `target_type === "user"`. ✓

**Open verification (flagged in spec):** confirm during Task 4 live testing that a `user`-type `invocation_targets.target_id` equals the member list's `user_id` (not `id`). If the CLI uses `id` instead, adjust `getDestMemberIds` to map `m.id`. The unit tests use `user_id`; the live smoke test (Task 6 Step 3) plus a targeted manual check will confirm.
