# Multica Project Export / Import / Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project (metadata-only) export/import/sync to multica-tool, carrying the project→agent-lead mapping, plus selective import where the user chooses which resource types to import after an incompatibility pre-flight.

**Architecture:** Three Node ESM scripts under `plugins/multica-tool/scripts/` (`multica-export.mjs`, `multica-import.mjs`, `multica-sync.mjs`) call the `multica` CLI through thin `cli.json`/`cli.run` wrappers in `lib.mjs`. Export walks resources into a flat deduped bundle (`manifest.json` + per-type files); import reads the bundle and upserts via the CLI. Projects become a fourth resource type alongside skills/agents/squads; their lead agent is bundled like a squad leader.

**Tech Stack:** Node.js ESM (node: built-ins only, no deps), `node --test`, the `multica` CLI (v0.4.14+).

## Global Constraints

- All source edits live under `plugins/multica-tool/` only. Tests live at repo-root `tests/multica-tool/`.
- No new npm dependencies — node built-ins only.
- CLI field names are snake_case; get-wrappers in `lib.mjs` are the ONLY place that names raw CLI fields (explicit allow-list — never leak unexpected fields into a bundle).
- `cli.json(args)` runs `multica <args> --output json` and `JSON.parse`s stdout; `cli.run(args)` returns stdout, throwing on non-zero exit.
- Lead is set on the write side by **name** (`--lead <name>`), never by id.
- `project create`/`update` have **no `--priority` flag** — priority is read-only.
- Default import set is `agents,squads` (skills follow agents); projects are opt-in.
- Import is best-effort: never throw on a missing lead, unsupported resource, or unsettable priority — record and report instead.
- Run tests with `node --test tests/multica-tool/*.test.js` — note the test runner picks up `*.test.mjs` too via the glob `node --test tests/multica-tool/`. Use `node --test tests/multica-tool/` to run all.

---

### Task 1: Project read-wrappers in lib.mjs

**Files:**
- Modify: `plugins/multica-tool/scripts/lib.mjs`
- Test: `tests/multica-tool/lib.test.mjs`

**Interfaces:**
- Produces:
  - `listProjects(cli) -> Array<rawProject>`
  - `getProject(cli, id) -> { id, title, description, icon, priority, status, due_date, start_date, lead_id, lead_type }`
  - `getProjectResources(cli, id) -> Array<{ resource_type, resource_ref, label }>`
  - `findByTitle(list, title) -> item | null` (throws on duplicate title)

- [ ] **Step 1: Write the failing test**

Add to `tests/multica-tool/lib.test.mjs` (append; keep existing imports, add these names to the import from `lib.mjs`):

```javascript
import { getProject, getProjectResources, findByTitle } from "../../plugins/multica-tool/scripts/lib.mjs";

test("getProject normalizes to the allow-listed fields only", () => {
  const raw = {
    id: "pr_SRC1", title: "Launch", description: "the launch", icon: "🚀",
    priority: "high", status: "in_progress", due_date: null, start_date: null,
    lead_id: "ag_SRC1", lead_type: "agent",
    // fields that must be dropped — source-workspace state, not portable:
    done_count: 5, issue_count: 9, resource_count: 2, workspace_id: "ws_SRC",
    created_at: "x", updated_at: "y",
  };
  const cli = { json: () => raw };
  const p = getProject(cli, "pr_SRC1");
  assert.deepEqual(p, {
    id: "pr_SRC1", title: "Launch", description: "the launch", icon: "🚀",
    priority: "high", status: "in_progress", due_date: null, start_date: null,
    lead_id: "ag_SRC1", lead_type: "agent",
  });
});

test("getProjectResources keeps only type/ref/label", () => {
  const cli = { json: () => [
    { id: "r1", resource_type: "github_repo", resource_ref: { url: "https://x/repo.git" }, label: null, position: 0, workspace_id: "w" },
  ] };
  assert.deepEqual(getProjectResources(cli, "pr_SRC1"), [
    { resource_type: "github_repo", resource_ref: { url: "https://x/repo.git" }, label: null },
  ]);
});

test("findByTitle returns the match and throws on duplicates", () => {
  const list = [{ id: "a", title: "One" }, { id: "b", title: "Two" }];
  assert.equal(findByTitle(list, "Two").id, "b");
  assert.equal(findByTitle(list, "None"), null);
  assert.throws(() => findByTitle([{ title: "Dup" }, { title: "Dup" }], "Dup"), /Duplicate title/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multica-tool/lib.test.mjs`
Expected: FAIL — `getProject`/`getProjectResources`/`findByTitle` are not exported.

- [ ] **Step 3: Add the implementation to lib.mjs**

Append to `plugins/multica-tool/scripts/lib.mjs`:

```javascript
export const listProjects = (cli) => cli.json(["project", "list"]);

export function findByTitle(list, title) {
  const hits = (list || []).filter((x) => x.title === title);
  if (hits.length > 1) throw new Error(`Duplicate title "${title}" — refusing to guess`);
  return hits[0] || null;
}

export function getProject(cli, id) {
  const p = cli.json(["project", "get", id]);
  return {
    id: p.id, title: p.title, description: p.description ?? "",
    icon: p.icon ?? null, priority: p.priority ?? "none", status: p.status ?? null,
    due_date: p.due_date ?? null, start_date: p.start_date ?? null,
    lead_id: p.lead_id ?? null, lead_type: p.lead_type ?? null,
  };
}

export const getProjectResources = (cli, id) =>
  (cli.json(["project", "resource", "list", id]) ?? []).map((r) => ({
    resource_type: r.resource_type, resource_ref: r.resource_ref, label: r.label ?? null,
  }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multica-tool/lib.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/lib.mjs tests/multica-tool/lib.test.mjs
git commit -m "feat(multica-tool): add project read-wrappers to lib"
```

---

### Task 2: Export projects (fixtures + collect + scopes + manifest + write)

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-export.mjs`
- Modify: `tests/multica-tool/fixtures.mjs`
- Test: `tests/multica-tool/export.test.mjs`

**Interfaces:**
- Consumes: `listProjects`, `getProject`, `getProjectResources` (Task 1); existing `collectAgent`, `slugify`.
- Produces:
  - `collectProject(cli, id, agentsById, skills, providerById) -> { title, description, icon, priority, status, due_date, start_date, source_id, lead_type, lead_name, lead_source_id, resources }`
  - `buildManifest` now returns a `projects` array: `[{ title, file, source_id, lead_name, lead_type }]`.
  - `exportResource` supports `scope` values `"project"` (needs `ids.projectId`) and `"projects"` (all), and includes projects in `"all"`.

- [ ] **Step 1: Add project fixtures**

Append to `tests/multica-tool/fixtures.mjs`:

```javascript
// Two projects: one agent-led with mixed resources + non-none priority,
// one unled with no resources. Lead ag_SRC1 = "Helper" (AGENT_GET).
export const PROJECT_LIST = [
  { id: "pr_SRC1", title: "Launch", lead_id: "ag_SRC1", lead_type: "agent", priority: "high" },
  { id: "pr_SRC2", title: "Backlog", lead_id: null, lead_type: null, priority: "none" },
];
export const PROJECT_GET_1 = {
  id: "pr_SRC1", title: "Launch", description: "the launch", icon: "🚀",
  priority: "high", status: "in_progress", due_date: null, start_date: null,
  lead_id: "ag_SRC1", lead_type: "agent",
};
export const PROJECT_GET_2 = {
  id: "pr_SRC2", title: "Backlog", description: "", icon: null,
  priority: "none", status: "planned", due_date: null, start_date: null,
  lead_id: null, lead_type: null,
};
export const PROJECT_RESOURCES_1 = [
  { resource_type: "github_repo", resource_ref: { url: "https://github.com/x/repo.git" }, label: null, position: 0 },
  { resource_type: "local_directory", resource_ref: { path: "/x", daemon_id: "d1" }, label: "local", position: 1 },
];
export const PROJECT_RESOURCES_2 = [];
```

- [ ] **Step 2: Write the failing test**

Append to `tests/multica-tool/export.test.mjs` (add `PROJECT_*` to the fixtures import line):

```javascript
import { PROJECT_LIST, PROJECT_GET_1, PROJECT_GET_2, PROJECT_RESOURCES_1, PROJECT_RESOURCES_2 } from "./fixtures.mjs";

// fakeCli variant that also answers project + runtime/agent calls.
function projectCli() {
  return {
    json: (args) => {
      const key = args.slice(0, 4).join(" ");
      const k3 = args.slice(0, 3).join(" ");
      if (k3 === "project list") return PROJECT_LIST;
      if (k3 === "project get pr_SRC1") return PROJECT_GET_1;
      if (k3 === "project get pr_SRC2") return PROJECT_GET_2;
      if (key === "project resource list pr_SRC1") return PROJECT_RESOURCES_1;
      if (key === "project resource list pr_SRC2") return PROJECT_RESOURCES_2;
      if (k3 === "agent get ag_SRC1") return AGENT_GET;
      if (k3 === "skill get sk_SRC1") return SKILL_GET;
      if (k3 === "runtime list") return RUNTIME_LIST_SRC;
      throw new Error("unexpected " + args.join(" "));
    },
    run: () => "",
  };
}

test("export --scope project bundles the lead agent and writes the project record", () => {
  const fs = memFs();
  const { manifest } = exportResource({
    cli: projectCli(), scope: "project", ids: { projectId: "pr_SRC1" },
    outDir: "out", sourceWorkspaceId: "ws_SRC", fs, download: () => null,
  });
  // lead agent bundled (decision A)
  assert.ok(manifest.agents.some((a) => a.name === "Helper"), "lead agent bundled");
  // project manifest entry + file
  const entry = manifest.projects.find((p) => p.title === "Launch");
  assert.equal(entry.file, "projects/launch.json");
  assert.equal(entry.lead_name, "Helper");
  assert.equal(entry.lead_type, "agent");
  const rec = JSON.parse(fs.files["out/projects/launch.json"]);
  assert.equal(rec.title, "Launch");
  assert.equal(rec.lead_name, "Helper");
  assert.equal(rec.lead_source_id, "ag_SRC1");
  assert.equal(rec.priority, "high");
  assert.equal(rec.resources.length, 2, "both resources recorded (portability decided at import)");
});

test("export --scope projects records an unled project with lead_name null", () => {
  const fs = memFs();
  const { manifest } = exportResource({
    cli: projectCli(), scope: "projects", ids: {},
    outDir: "out", sourceWorkspaceId: "ws_SRC", fs, download: () => null,
  });
  assert.equal(manifest.projects.length, 2);
  const backlog = JSON.parse(fs.files["out/projects/backlog.json"]);
  assert.equal(backlog.lead_name, null);
  assert.equal(backlog.lead_type, null);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: FAIL — scope `project`/`projects` unhandled; `manifest.projects` undefined.

- [ ] **Step 4: Implement export changes**

In `plugins/multica-tool/scripts/multica-export.mjs`:

4a. Extend the import from `./lib.mjs` to add `listProjects, getProject, getProjectResources`.

4b. Add `collectProject` after `collectAgent`:

```javascript
// Collect a project's portable metadata + its lead agent (bundled, like a squad
// leader) and github_repo/other resources. Returns the project bundle record.
function collectProject(cli, id, agentsById, skills, providerById) {
  const p = getProject(cli, id);
  let lead_name = null;
  if (p.lead_type === "agent" && p.lead_id) {
    lead_name = collectAgent(cli, p.lead_id, agentsById, skills, providerById).raw.name;
  }
  return {
    title: p.title, description: p.description, icon: p.icon,
    priority: p.priority, status: p.status, due_date: p.due_date, start_date: p.start_date,
    source_id: id, lead_type: p.lead_type, lead_name, lead_source_id: p.lead_id,
    resources: getProjectResources(cli, id),
  };
}
```

4c. In `buildManifest`, add `projects` to the destructured args and dedupe-by-title into the returned object:

```javascript
export function buildManifest({ scope, sourceWorkspaceId, skills, agents, squads, projects }) {
  // ...existing seenSkills / seenAgents...
  const seenProjects = new Map();
  for (const p of projects ?? []) if (!seenProjects.has(p.title)) seenProjects.set(p.title, p);
  return {
    // ...existing version/scope/source_workspace_id/skills/agents/squads...
    projects: [...seenProjects.values()].map((p) => ({
      title: p.title, file: `projects/${slugify(p.title)}.json`,
      source_id: p.source_id, lead_name: p.lead_name ?? null, lead_type: p.lead_type ?? null,
    })),
  };
}
```

4d. In `exportResource`, declare `const projects = [];` next to `const squads = [];`, add scope handling, and pass projects to `buildManifest`:

```javascript
  else if (scope === "project") projects.push(collectProject(cli, ids.projectId, agentsById, skills, getProviderById()));
  else if (scope === "projects") for (const p of listProjects(cli)) projects.push(collectProject(cli, p.id, agentsById, skills, getProviderById()));
```

In the `scope === "all"` block, after the squads loop add:

```javascript
    for (const p of listProjects(cli)) projects.push(collectProject(cli, p.id, agentsById, skills, getProviderById()));
```

Pass `projects` into the `buildManifest({ ... })` call.

4e. After the squads write loop, add the projects write loop:

```javascript
  const projectByTitle = new Map(projects.map((p) => [p.title, p]));
  for (const entry of manifest.projects) {
    fs.mkdirSync(`${outDir}/projects`, { recursive: true });
    fs.writeFileSync(`${outDir}/${entry.file}`, JSON.stringify(projectByTitle.get(entry.title), null, 2));
  }
```

4f. In `main()`, update the usage guard, scope switch, and unknown-scope message:

```javascript
  if (!scope || !out || (scope !== "all" && scope !== "projects" && !id)) {
    console.error("Usage: multica-export.mjs --scope <skill|agent|squad|project|projects|all> --id <id> --out <dir> [--workspace <name>]  (--id not needed for --scope all|projects)");
    process.exit(1);
  }
```

```javascript
  else if (scope === "project")  ids.projectId = id;
  else if (scope === "projects") { /* all projects — no id */ }
```

Update the final `else` unknown-scope error string to `skill|agent|squad|project|projects|all`.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/multica-tool/export.test.mjs`
Expected: PASS (all existing export tests still pass — they never set `projects`, and `buildManifest` tolerates it undefined).

- [ ] **Step 6: Commit**

```bash
git add plugins/multica-tool/scripts/multica-export.mjs tests/multica-tool/fixtures.mjs tests/multica-tool/export.test.mjs
git commit -m "feat(multica-tool): export projects with bundled lead agent"
```

---

### Task 3: importProjects function

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-import.mjs`
- Test: `tests/multica-tool/import.test.mjs`

**Interfaces:**
- Consumes: `listProjects`, `getProjectResources`, `findByTitle`, `listAgents` (from `lib.mjs`); manifest `projects` entries + `projects/<slug>.json` records (Task 2).
- Produces:
  - `importProjects({ cli, manifest, dir, agentIdMap, fs }) -> { idMap, created, updated, priorityUnsupported, resourcesUnsupported, leadUnresolved }`

- [ ] **Step 1: Write the failing test**

Append to `tests/multica-tool/import.test.mjs`:

```javascript
import { importProjects } from "../../plugins/multica-tool/scripts/multica-import.mjs";

const PROJECT_MANIFEST = {
  version: "1", scope: "projects", source_workspace_id: "ws_SRC",
  skills: [], agents: [], squads: [],
  projects: [
    { title: "Launch", file: "projects/launch.json", source_id: "pr_SRC1", lead_name: "Helper", lead_type: "agent" },
  ],
};
const LAUNCH_REC = {
  title: "Launch", description: "the launch", icon: "🚀",
  priority: "high", status: "in_progress", due_date: null, start_date: null,
  source_id: "pr_SRC1", lead_type: "agent", lead_name: "Helper", lead_source_id: "ag_SRC1",
  resources: [
    { resource_type: "github_repo", resource_ref: { url: "https://github.com/x/repo.git" }, label: null },
    { resource_type: "local_directory", resource_ref: { path: "/x" }, label: "local" },
  ],
};
// recordingCli that answers project list / resource list / agent list.
function projectRecordingCli({ existingProjects = [], existingAgents = [], existingResources = [] } = {}) {
  const calls = [];
  return {
    calls,
    json: (args) => {
      const k = args.slice(0, 3).join(" ");
      if (args[0] === "project" && args[1] === "list") return existingProjects;
      if (k.startsWith("project resource list")) return existingResources;
      if (args[0] === "agent" && args[1] === "list") return existingAgents;
      return {};
    },
    run: (args) => { calls.push(args); return args.includes("create") ? '{"id":"pr_NEW1"}' : "{}"; },
  };
}

test("importProjects creates the project, sets --lead to the imported agent, adds github_repo resource, reports unsupported bits", () => {
  const fs = memFs({ "projects/launch.json": JSON.stringify(LAUNCH_REC) });
  const cli = projectRecordingCli();
  const agentIdMap = new Map([["Helper", "ag_NEW1"]]);
  const r = importProjects({ cli, manifest: PROJECT_MANIFEST, dir: ".", agentIdMap, fs });
  assert.equal(r.created, 1);
  const create = cli.calls.find((a) => a[0] === "project" && a[1] === "create");
  assert.equal(create[create.indexOf("--lead") + 1], "Helper", "lead set by agent name");
  assert.equal(create[create.indexOf("--title") + 1], "Launch");
  assert.ok(!create.includes("--priority"), "priority is never passed (no CLI flag)");
  const addRepo = cli.calls.find((a) => a[0] === "project" && a[1] === "resource" && a[2] === "add");
  assert.equal(addRepo[addRepo.indexOf("--url") + 1], "https://github.com/x/repo.git");
  assert.deepEqual(r.priorityUnsupported, ["Launch"]);
  assert.deepEqual(r.resourcesUnsupported, ["Launch:local_directory"]);
  assert.deepEqual(r.leadUnresolved, []);
});

test("importProjects updates by title and does not re-add an existing resource (idempotent)", () => {
  const fs = memFs({ "projects/launch.json": JSON.stringify(LAUNCH_REC) });
  const cli = projectRecordingCli({
    existingProjects: [{ id: "pr_TGT9", title: "Launch" }],
    existingResources: [{ resource_type: "github_repo", resource_ref: { url: "https://github.com/x/repo.git" }, label: null }],
  });
  const r = importProjects({ cli, manifest: PROJECT_MANIFEST, dir: ".", agentIdMap: new Map([["Helper", "ag_NEW1"]]), fs });
  assert.equal(r.updated, 1); assert.equal(r.created, 0);
  assert.equal(r.idMap.get("Launch"), "pr_TGT9");
  assert.ok(cli.calls.some((a) => a[0] === "project" && a[1] === "update" && a[2] === "pr_TGT9"));
  assert.ok(!cli.calls.some((a) => a[1] === "resource" && a[2] === "add"), "existing url not re-added");
});

test("importProjects records leadUnresolved and omits --lead when the agent is nowhere", () => {
  const fs = memFs({ "projects/launch.json": JSON.stringify(LAUNCH_REC) });
  const cli = projectRecordingCli(); // no existing agents, empty agentIdMap
  const r = importProjects({ cli, manifest: PROJECT_MANIFEST, dir: ".", agentIdMap: new Map(), fs });
  const create = cli.calls.find((a) => a[1] === "create");
  assert.ok(!create.includes("--lead"), "no lead flag when unresolvable");
  assert.deepEqual(r.leadUnresolved, ["Launch"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: FAIL — `importProjects` is not exported.

- [ ] **Step 3: Implement importProjects**

In `plugins/multica-tool/scripts/multica-import.mjs`, extend the `./lib.mjs` import to add `listProjects, getProjectResources, findByTitle`, then add:

```javascript
export function importProjects({ cli, manifest, dir, agentIdMap, fs = nodeFs }) {
  const idMap = new Map();
  let created = 0, updated = 0;
  const priorityUnsupported = [], resourcesUnsupported = [], leadUnresolved = [];
  const existing = listProjects(cli);
  // Lead resolves against just-imported agents first, then destination agents.
  let destAgentNames = null;
  const leadResolvable = (name) =>
    agentIdMap.has(name) || (destAgentNames ??= new Set(listAgents(cli).map((a) => a.name))).has(name);

  for (const entry of manifest.projects ?? []) {
    const rec = JSON.parse(fs.readFileSync(`${dir}/${entry.file}`, "utf8"));
    const flags = ["--title", rec.title];
    if (rec.description) flags.push("--description", rec.description);
    if (rec.icon) flags.push("--icon", rec.icon);
    if (rec.status) flags.push("--status", rec.status);
    if (rec.due_date) flags.push("--due-date", rec.due_date);
    if (rec.start_date) flags.push("--start-date", rec.start_date);
    const wantsLead = rec.lead_type === "agent" && !!rec.lead_name;
    const leadOk = wantsLead && leadResolvable(rec.lead_name);
    if (leadOk) flags.push("--lead", rec.lead_name);

    const match = findByTitle(existing, rec.title);
    let id;
    if (match) {
      cli.run(["project", "update", match.id, ...flags]);
      id = match.id; updated++;
    } else {
      id = JSON.parse(cli.run(["project", "create", ...flags])).id;
      created++;
    }
    idMap.set(rec.title, id);

    if (wantsLead && !leadOk) leadUnresolved.push(rec.title);
    if (rec.priority && rec.priority !== "none") priorityUnsupported.push(rec.title);

    // Resources: recreate github_repo only, idempotent by url.
    const existingUrls = new Set(
      getProjectResources(cli, id).filter((r) => r.resource_type === "github_repo").map((r) => r.resource_ref?.url).filter(Boolean),
    );
    for (const r of rec.resources ?? []) {
      if (r.resource_type !== "github_repo") { resourcesUnsupported.push(`${rec.title}:${r.resource_type}`); continue; }
      const url = r.resource_ref?.url;
      if (!url || existingUrls.has(url)) continue;
      cli.run(["project", "resource", "add", id, "--type", "github_repo", "--url", url, ...(r.label ? ["--label", r.label] : [])]);
      existingUrls.add(url);
    }
  }
  return { idMap, created, updated, priorityUnsupported, resourcesUnsupported, leadUnresolved };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/multica-import.mjs tests/multica-tool/import.test.mjs
git commit -m "feat(multica-tool): importProjects with lead + resource round-trip"
```

---

### Task 4: Selective import (`--include`), squad skip guard, and importBundle wiring

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-import.mjs`
- Test: `tests/multica-tool/import.test.mjs`

**Interfaces:**
- Consumes: `importProjects` (Task 3), existing `importSkills`/`importAgents`/`importSquad`/`rewriteAgentMentions`/`resolveRuntimeMap`.
- Produces:
  - `parseInclude(raw) -> Set<string>` (default `{skills,agents,squads}`; `agents` implies `skills`)
  - `importSquad` returns `{ skipped: true }` when the leader agent id is unresolvable
  - `importBundle({ cli, dir, runtimeMap, include, fs })` honors `include`; return adds `include`, `created.projects`, `updated.projects`, `projectIdMap`, `priorityUnsupported`, `resourcesUnsupported`, `leadUnresolved`, `squadsSkipped`.

- [ ] **Step 1: Write the failing test**

Append to `tests/multica-tool/import.test.mjs`. This exercises `importBundle` end-to-end against a bundle on `memFs` with a fuller recording cli. Reuse the existing recording-cli helpers where possible; add one that answers every list/get needed:

```javascript
import { importBundle, parseInclude } from "../../plugins/multica-tool/scripts/multica-import.mjs";

// Minimal bundle: one agent (Helper) + one project (Launch) led by Helper.
function bundleFs() {
  return memFs({
    "manifest.json": JSON.stringify({
      version: "1", scope: "all", source_workspace_id: "ws_SRC",
      skills: [], squads: [],
      agents: [{ name: "Helper", file: "agents/helper.json", source_id: "ag_SRC1", source_runtime_id: "rt_SRC1", source_runtime_provider: "claude", skill_names: [], had_secrets: false }],
      projects: [{ title: "Launch", file: "projects/launch.json", source_id: "pr_SRC1", lead_name: "Helper", lead_type: "agent" }],
    }),
    "agents/helper.json": JSON.stringify({ name: "Helper", visibility: "workspace", max_concurrent_tasks: 6, source_runtime_id: "rt_SRC1", skill_names: [] }),
    "projects/launch.json": JSON.stringify(LAUNCH_REC),
  });
}
function fullRecordingCli() {
  const calls = [];
  return {
    calls,
    json: (args) => {
      if (args[0] === "runtime" && args[1] === "list") return [{ id: "rt_TGT1", provider: "claude" }];
      if (args[0] === "agent" && args[1] === "list") return [];
      if (args[0] === "project" && args[1] === "list") return [];
      if (args[0] === "project" && args[1] === "resource") return [];
      if (args[0] === "squad" && args[1] === "list") return [];
      return {};
    },
    run: (args) => { calls.push(args); return args.includes("create") ? '{"id":"NEW"}' : "{}"; },
  };
}

test("parseInclude defaults to agents+squads (+skills), projects opt-in", () => {
  assert.deepEqual([...parseInclude(null)].sort(), ["agents", "skills", "squads"]);
  assert.deepEqual([...parseInclude("projects")].sort(), ["projects"]);
  assert.deepEqual([...parseInclude("agents,projects")].sort(), ["agents", "projects", "skills"]);
});

test("importBundle default include does NOT import projects", () => {
  const cli = fullRecordingCli();
  const res = importBundle({ cli, dir: ".", runtimeMap: new Map(), fs: bundleFs() });
  assert.equal(res.created.projects, 0);
  assert.ok(!cli.calls.some((a) => a[0] === "project" && a[1] === "create"), "no project write by default");
  assert.ok(cli.calls.some((a) => a[0] === "agent" && a[1] === "create"), "agents still imported");
});

test("importBundle with projects in include creates the project led by the imported agent", () => {
  const cli = fullRecordingCli();
  const res = importBundle({ cli, dir: ".", runtimeMap: new Map(), include: new Set(["skills", "agents", "projects"]), fs: bundleFs() });
  assert.equal(res.created.projects, 1);
  const create = cli.calls.find((a) => a[0] === "project" && a[1] === "create");
  assert.equal(create[create.indexOf("--lead") + 1], "Helper");
  assert.deepEqual(res.priorityUnsupported, ["Launch"]);
});

test("importBundle skips a squad whose leader was not imported (agents excluded)", () => {
  const fs = memFs({
    "manifest.json": JSON.stringify({
      version: "1", scope: "all", source_workspace_id: "ws_SRC",
      skills: [], agents: [], projects: [],
      squads: [{ name: "Team", file: "squads/team.json", leader_name: "Helper", members: [] }],
    }),
    "squads/team.json": JSON.stringify({ name: "Team", description: "", leader_name: "Helper", members: [] }),
  });
  const cli = fullRecordingCli();
  const res = importBundle({ cli, dir: ".", runtimeMap: new Map(), include: new Set(["squads"]), fs });
  assert.deepEqual(res.squadsSkipped, ["Team"]);
  assert.ok(!cli.calls.some((a) => a[0] === "squad" && a[1] === "create"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: FAIL — `parseInclude` not exported; `importBundle` ignores `include`; no `squadsSkipped`.

- [ ] **Step 3: Implement include filtering + squad guard**

3a. Add `parseInclude` near the top of `multica-import.mjs` (after imports):

```javascript
// User-facing selectable types are agents/squads/projects; skills follow agents.
export function parseInclude(raw) {
  const set = new Set((raw ? raw.split(",") : ["agents", "squads"]).map((s) => s.trim()).filter(Boolean));
  if (set.has("agents")) set.add("skills");
  return set;
}
```

3b. Guard `importSquad` — at the top, right after `const leaderId = agentIdMap.get(squad.leader_name);` add:

```javascript
  if (!leaderId) return { skipped: true, created: 0, updated: 0 };
```

Also guard the member loop against a missing member id — change the member loop body's first line to also skip unknowns:

```javascript
    const memberId = agentIdMap.get(m.agent_name);
    if (!memberId || present.has(memberId)) continue;
```

3c. Rewrite `importBundle` to honor `include`:

```javascript
export function importBundle({ cli, dir, runtimeMap, include, fs = nodeFs }) {
  const inc = include ?? new Set(["skills", "agents", "squads"]);
  const manifest = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, "utf8"));

  let effective = new Map();
  if (inc.has("agents")) {
    const r = resolveRuntimeMap({ cli, manifest, runtimeMap });
    if (r.unresolved.length) {
      const detail = r.unresolved.map(({ srcId, provider, matchCount }) => provider
        ? `${srcId} (provider "${provider}": ${matchCount} matching runtimes in destination, expected exactly 1)`
        : `${srcId} (no provider recorded)`).join(", ");
      throw new Error(`Unmapped runtimes: ${detail} — pass --runtime-map, aborting before any write`);
    }
    effective = r.effective;
  }

  const skillRes = inc.has("skills")
    ? importSkills({ cli, manifest, dir, fs })
    : { idMap: new Map(), created: 0, updated: 0 };
  const agentRes = inc.has("agents")
    ? importAgents({ cli, manifest, dir, skillIdMap: skillRes.idMap, runtimeMap: effective, fs })
    : { idMap: new Map(), sourceIdMap: new Map(), created: 0, updated: 0, secretsApplyFailures: [], avatarApplyFailures: [], avatarUnsupported: [], permissionApplyFailures: [], permissionUnsupported: [] };
  const mentionRes = inc.has("agents")
    ? rewriteAgentMentions({ cli, manifest, dir, agentIdMap: agentRes.idMap, sourceIdMap: agentRes.sourceIdMap, fs })
    : { updated: 0 };

  const squadIdMap = new Map();
  let squadsCreated = 0, squadsUpdated = 0;
  const squadsSkipped = [];
  if (inc.has("squads")) {
    for (const squad of manifest.squads ?? []) {
      squad.instructions = readInstructions(fs, dir, squad);
      const r = importSquad({ cli, squad, agentIdMap: agentRes.idMap, sourceIdMap: agentRes.sourceIdMap });
      if (r.skipped) { squadsSkipped.push(squad.name); continue; }
      squadIdMap.set(squad.name, r.newId);
      squadsCreated += r.created; squadsUpdated += r.updated;
    }
  }

  let projectRes = { idMap: new Map(), created: 0, updated: 0, priorityUnsupported: [], resourcesUnsupported: [], leadUnresolved: [] };
  if (inc.has("projects")) {
    projectRes = importProjects({ cli, manifest, dir, agentIdMap: agentRes.idMap, fs });
  }

  return {
    include: [...inc],
    created: { skills: skillRes.created, agents: agentRes.created, squads: squadsCreated, projects: projectRes.created },
    updated: { skills: skillRes.updated, agents: agentRes.updated, squads: squadsUpdated, projects: projectRes.updated },
    mentionsRewritten: mentionRes.updated,
    skillIdMap: Object.fromEntries(skillRes.idMap),
    agentIdMap: Object.fromEntries(agentRes.idMap),
    squadIdMap: Object.fromEntries(squadIdMap),
    projectIdMap: Object.fromEntries(projectRes.idMap),
    secretsReminder: (manifest.agents ?? []).filter((a) => a.had_secrets).map((a) => a.name),
    secretsApplyFailures: agentRes.secretsApplyFailures,
    avatarApplyFailures: agentRes.avatarApplyFailures,
    avatarUnsupported: agentRes.avatarUnsupported,
    permissionApplyFailures: agentRes.permissionApplyFailures,
    permissionUnsupported: agentRes.permissionUnsupported,
    squadsSkipped,
    priorityUnsupported: projectRes.priorityUnsupported,
    resourcesUnsupported: projectRes.resourcesUnsupported,
    leadUnresolved: projectRes.leadUnresolved,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: PASS (existing importBundle tests still pass — they call it without `include`, getting the default `{skills,agents,squads}`, and now also receive the new `projects: 0` counters).

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/multica-import.mjs tests/multica-tool/import.test.mjs
git commit -m "feat(multica-tool): selective import via --include + graceful squad skip"
```

---

### Task 5: Pre-flight (`--dry-run`) and import main() flags

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-import.mjs`
- Test: `tests/multica-tool/import.test.mjs`

**Interfaces:**
- Consumes: `resolveRuntimeMap`, `parseInclude`, manifest + project records.
- Produces:
  - `preflight({ cli, dir, runtimeMap, include, fs }) -> { bundle, willImport, runtimes, incompatibilities, secretsReminder }`
  - `main()` accepts `--include <csv>` and `--dry-run`.

- [ ] **Step 1: Write the failing test**

Append to `tests/multica-tool/import.test.mjs`:

```javascript
import { preflight } from "../../plugins/multica-tool/scripts/multica-import.mjs";

test("preflight reports counts and project incompatibilities without writing", () => {
  const cli = fullRecordingCli();
  const rep = preflight({ cli, dir: ".", runtimeMap: new Map(), include: new Set(["skills", "agents", "projects"]), fs: bundleFs() });
  assert.deepEqual(rep.bundle, { skills: 0, agents: 1, squads: 0, projects: 1 });
  assert.deepEqual(rep.willImport, { skills: 0, agents: 1, squads: 0, projects: 1 });
  assert.ok(rep.incompatibilities.some((i) => i.type === "priority-not-settable" && i.detail.includes("Launch")));
  assert.ok(rep.incompatibilities.some((i) => i.type === "resource-not-portable" && i.detail.includes("local_directory")));
  assert.equal(cli.calls.length, 0, "dry-run performs no writes");
});

test("preflight flags lead-agent-missing when projects are imported without agents", () => {
  const cli = fullRecordingCli();
  const rep = preflight({ cli, dir: ".", runtimeMap: new Map(), include: new Set(["projects"]), fs: bundleFs() });
  assert.equal(rep.willImport.agents, 0);
  assert.ok(rep.incompatibilities.some((i) => i.type === "lead-agent-missing" && i.detail.includes("Helper")));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: FAIL — `preflight` not exported.

- [ ] **Step 3: Implement preflight + wire main()**

3a. Add `preflight` to `multica-import.mjs`:

```javascript
export function preflight({ cli, dir, runtimeMap, include, fs = nodeFs }) {
  const inc = include ?? new Set(["skills", "agents", "squads"]);
  const manifest = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, "utf8"));
  const count = (k) => (manifest[k] ?? []).length;
  const bundle = { skills: count("skills"), agents: count("agents"), squads: count("squads"), projects: count("projects") };
  const willImport = {
    skills: inc.has("skills") ? bundle.skills : 0,
    agents: inc.has("agents") ? bundle.agents : 0,
    squads: inc.has("squads") ? bundle.squads : 0,
    projects: inc.has("projects") ? bundle.projects : 0,
  };

  const incompatibilities = [];
  let runtimes = { resolved: [], unresolved: [] };
  if (inc.has("agents")) {
    const { effective, unresolved } = resolveRuntimeMap({ cli, manifest, runtimeMap });
    runtimes = {
      resolved: [...effective.entries()].map(([s, d]) => `${s}=${d}`),
      unresolved: unresolved.map((u) => u.srcId),
    };
    for (const u of unresolved) {
      incompatibilities.push({ type: "unmapped-runtime", detail: u.provider
        ? `${u.srcId} (provider "${u.provider}": ${u.matchCount} matches, expected 1)`
        : `${u.srcId} (no provider recorded)` });
    }
  }

  if (inc.has("projects")) {
    const bundleAgentNames = new Set((manifest.agents ?? []).map((a) => a.name));
    for (const entry of manifest.projects ?? []) {
      const rec = JSON.parse(fs.readFileSync(`${dir}/${entry.file}`, "utf8"));
      if (rec.priority && rec.priority !== "none") {
        incompatibilities.push({ type: "priority-not-settable", detail: `${rec.title} (priority "${rec.priority}")` });
      }
      for (const r of rec.resources ?? []) {
        if (r.resource_type !== "github_repo") {
          incompatibilities.push({ type: "resource-not-portable", detail: `${rec.title} (${r.resource_type})` });
        }
      }
      const leadAvailable = inc.has("agents") && bundleAgentNames.has(rec.lead_name);
      if (rec.lead_type === "agent" && rec.lead_name && !leadAvailable) {
        incompatibilities.push({ type: "lead-agent-missing", detail: `${rec.title} → ${rec.lead_name} (ensure this agent exists in the destination)` });
      }
    }
  }

  const secretsReminder = (manifest.agents ?? []).filter((a) => a.had_secrets).map((a) => a.name);
  return { bundle, willImport, runtimes, incompatibilities, secretsReminder };
}
```

3b. Update `main()` to parse the flags and branch:

```javascript
  const dir       = get("--dir");
  const workspace = get("--workspace");
  const rawMap    = get("--runtime-map");
  const rawInclude = get("--include");
  const dryRun    = args.includes("--dry-run");
  // ...existing usage guard + auth + wsId + cli + runtimeMap...
  const include = parseInclude(rawInclude);
  if (dryRun) {
    console.log(JSON.stringify(preflight({ cli, dir, runtimeMap, include, fs: nodeFs }), null, 2));
    return;
  }
  const result = importBundle({ cli, dir, runtimeMap, include, fs: nodeFs });
  console.log(JSON.stringify(result, null, 2));
```

(Keep the `requireAuth`, `resolveWorkspaceId`, `makeCli` lines already in `main()`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multica-tool/import.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/multica-import.mjs tests/multica-tool/import.test.mjs
git commit -m "feat(multica-tool): --dry-run pre-flight for selective import"
```

---

### Task 6: Sync a project

**Files:**
- Modify: `plugins/multica-tool/scripts/multica-sync.mjs`
- Test: `tests/multica-tool/sync.test.mjs`

**Interfaces:**
- Consumes: `findByTitle`, `listProjects` (Task 1); `exportResource` project scope (Task 2); `importBundle` include param (Task 4).
- Produces: `resolveScopeId(cli, "project", title) -> { scope: "project", ids: { projectId } }`; `sync()` derives an `include` set per type and passes it to `importBundle`.

- [ ] **Step 1: Write the failing test**

Read the existing `tests/multica-tool/sync.test.mjs` first to match its harness, then append:

```javascript
import { resolveScopeId } from "../../plugins/multica-tool/scripts/multica-sync.mjs";
import { PROJECT_LIST } from "./fixtures.mjs";

test("resolveScopeId resolves a project by title", () => {
  const cli = { json: (args) => (args[0] === "project" && args[1] === "list" ? PROJECT_LIST : []) };
  const r = resolveScopeId(cli, "project", "Launch");
  assert.deepEqual(r, { scope: "project", ids: { projectId: "pr_SRC1" } });
});

test("resolveScopeId throws on an unknown project title", () => {
  const cli = { json: () => PROJECT_LIST };
  assert.throws(() => resolveScopeId(cli, "project", "Nope"), /Unknown project/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multica-tool/sync.test.mjs`
Expected: FAIL — `resolveScopeId` does not handle `project`.

- [ ] **Step 3: Implement sync changes**

3a. Extend the `./lib.mjs` import in `multica-sync.mjs` to add `findByTitle, listProjects`.

3b. Handle `project` in `resolveScopeId` (add before the `lists` lookup):

```javascript
export function resolveScopeId(cli, type, name) {
  if (type === "project") {
    const match = findByTitle(listProjects(cli), name);
    if (!match) throw new Error(`Unknown project "${name}" in source workspace`);
    return { scope: "project", ids: { projectId: match.id } };
  }
  const lists = { skill: listSkills, agent: listAgents, squad: listSquads };
  if (!lists[type]) throw new Error(`Unknown type "${type}" (skill|agent|squad|project)`);
  // ...unchanged...
}
```

3c. In `sync()`, derive an include set from the type and pass it to `importBundle`:

```javascript
  const { scope, ids } = resolveScopeId(srcCli, type, name);
  exportResource({ cli: srcCli, scope, ids, outDir: tmpDir, sourceWorkspaceId: srcId, fs });
  const includeByType = { skill: ["skills"], agent: ["agents"], squad: ["agents", "squads"], project: ["agents", "projects"] };
  const include = new Set(includeByType[type] ?? ["agents", "squads"]);
  if (include.has("agents")) include.add("skills");
  return importBundle({ cli: destCli, dir: tmpDir, runtimeMap, include, fs });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multica-tool/sync.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/scripts/multica-sync.mjs tests/multica-tool/sync.test.mjs
git commit -m "feat(multica-tool): sync a project (by title) with its lead agent"
```

---

### Task 7: Update skill docs

**Files:**
- Modify: `plugins/multica-tool/skills/export/SKILL.md`
- Modify: `plugins/multica-tool/skills/import/SKILL.md`
- Modify: `plugins/multica-tool/skills/sync/SKILL.md`

**Interfaces:** None (documentation).

- [ ] **Step 1: Update export/SKILL.md**

- Add `project` and `projects` to the scope list in Step 2 and the Step 4 command usage: `--scope <skill|agent|squad|project|projects|all>`, noting `--id` is not needed for `all` or `projects`.
- Add a sentence: "Exporting a project (or `projects`/`all`) also **bundles the project's lead agent** so the bundle is self-contained; projects carry metadata only (title, description, icon, priority, status, dates, lead mapping) and `github_repo` resources — never issues."
- In Step 5 reporting, add the project count to the reported counts.

- [ ] **Step 2: Update import/SKILL.md**

Rewrite the flow to add a pre-flight + selection gate before the real import:

- New step "Pre-flight": run
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/multica-import.mjs" --dir <dir> --workspace <name> [--runtime-map ...] --dry-run
  ```
  Present `bundle`/`willImport` counts and every `incompatibilities` entry to the user.
- New step "Select types": ask which of `agents`, `squads`, `projects` to import. **Default = `agents,squads`; projects require explicit opt-in.** If `unmapped-runtime` incompatibilities exist, tell the user to resolve them with `--runtime-map` before proceeding (import will abort otherwise). Surface `priority-not-settable`, `resource-not-portable`, and `lead-agent-missing` as caveats the UI can fix up afterward.
- Import step: pass the selection through `--include <csv>`.
- Reporting step: add `created.projects`/`updated.projects`, and surface `leadUnresolved`, `priorityUnsupported`, `resourcesUnsupported`, and `squadsSkipped` verbatim as "applied best-effort; adjust in the UI" notes.

- [ ] **Step 3: Update sync/SKILL.md**

- Add `project` to the syncable types, resolved by **title**, e.g. `multica-sync.mjs project "<title>" from <src-ws> <dest-ws>`, noting the project's lead agent is synced alongside it.

- [ ] **Step 4: Validate the skills**

Run the `validate-skills` skill against the three changed SKILL.md files:

Run: `/validate-skills`
Expected: no `[FAIL]` items for `plugins/multica-tool/skills/{export,import,sync}`. Fix any that appear.

- [ ] **Step 5: Commit**

```bash
git add plugins/multica-tool/skills/export/SKILL.md plugins/multica-tool/skills/import/SKILL.md plugins/multica-tool/skills/sync/SKILL.md
git commit -m "docs(multica-tool): document project export/import/sync + selective import"
```

---

### Task 8: Full verification

**Files:** None (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `node --test tests/multica-tool/`
Expected: all tests pass, no failures.

- [ ] **Step 2: Validate plugin manifests**

Run:
```bash
python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
```
Expected: `OK`.

- [ ] **Step 3: Run the plugin-validator agent**

Invoke the `plugin-validator:plugin-validator` agent (or `/plugin-validator`) against `plugins/multica-tool`. Fix any `[FAIL]` items (skills, agents, commands, hooks).

- [ ] **Step 4: Live smoke test (manual, if a workspace is available)**

```bash
# metadata-only export of all projects
node plugins/multica-tool/scripts/multica-export.mjs --scope projects --out /tmp/mx-projects
# inspect one bundle record + the manifest projects array
cat /tmp/mx-projects/manifest.json
# dry-run import preflight into a scratch workspace
node plugins/multica-tool/scripts/multica-import.mjs --dir /tmp/mx-projects --workspace <scratch-ws> --include agents,projects --dry-run
```
Expected: `projects/*.json` files with `lead_name`; preflight prints counts + any incompatibilities and writes nothing.

- [ ] **Step 5: Final commit (if any fixes were made in Steps 1-4)**

```bash
git add -A
git commit -m "test(multica-tool): verify project export/import/sync end-to-end"
```

---

## Self-Review

**Spec coverage:**
- Export scopes `projects`/`project` + folded into `all` → Task 2. ✔
- Project→agent-lead mapping (`lead_name`) + bundling the lead agent (decision A) → Task 2 (`collectProject`). ✔
- `github_repo` resources exported → Task 2; recreated on import → Task 3. ✔
- Selective import (default agents+squads, projects opt-in) → Task 4 (`parseInclude`, `importBundle` gating). ✔
- Pre-flight incompatibility report → Task 5 (`preflight`, `--dry-run`). ✔
- Best-effort import (priority/resource/lead warnings, no throw) → Task 3 + graceful squad skip Task 4. ✔
- Sync a project → Task 6. ✔
- Docs → Task 7; verification/validators → Task 8. ✔
- Limitations (priority not settable, non-github_repo not portable, non-agent leads not re-applied) surfaced via `priorityUnsupported`/`resourcesUnsupported`/`leadUnresolved` → Tasks 3, 5, 7. ✔

**Placeholder scan:** No TBD/TODO; every code step carries concrete code. ✔

**Type consistency:** `collectProject` return shape matches the `projects/<slug>.json` record read by `importProjects` and `preflight`; `parseInclude`/`include` is a `Set<string>` everywhere; `importSquad` skip returns `{ skipped, created, updated }` consumed in `importBundle`; `findByTitle` defined in Task 1, used in Tasks 3 and 6. ✔
