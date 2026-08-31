// Workspace issue taxonomy (labels + custom properties) round-trip.
// Both are WORKSPACE-scoped in multica 0.4.36 — the CLI has no project-scoped
// variant — so they ride along with the scopes that carry issue-bearing work.
import { test } from "node:test";
import assert from "node:assert/strict";
import { exportResource } from "../../plugins/multica-tool/scripts/multica-export.mjs";
import { importLabels, importProperties, parseInclude, preflight } from "../../plugins/multica-tool/scripts/multica-import.mjs";
import { LABEL_LIST, PROPERTY_LIST, AGENT_GET, SKILL_GET, RUNTIME_LIST_SRC, PROJECT_GET_1, PROJECT_RESOURCES_1 } from "./fixtures.mjs";

function memFs() {
  const files = {};
  return { files, mkdirSync: () => {}, writeFileSync: (p, c) => { files[p] = c; }, existsSync: (p) => p in files, readFileSync: (p) => files[p] };
}

function exportCli() {
  return {
    json: (args) => {
      const key = args.join(" ");
      if (key === "label list") return LABEL_LIST;
      if (key === "property list --include-archived") return PROPERTY_LIST;
      if (key === "project get pr_SRC1") return PROJECT_GET_1;
      if (key === "project resource list pr_SRC1") return PROJECT_RESOURCES_1;
      if (key === "agent get ag_SRC1") return AGENT_GET;
      if (key === "agent env get ag_SRC1") return { custom_env: {} };
      if (key === "skill get sk_SRC1") return SKILL_GET;
      if (key === "runtime list") return RUNTIME_LIST_SRC;
      throw new Error("unexpected " + key);
    },
    run: () => "",
  };
}

// Records every cli.run argv so the exact flags reaching the CLI can be asserted —
// the flag surface is the whole contract here (a wrong/removed flag aborts an import).
function recordingCli({ labels = [], properties = [] } = {}) {
  const calls = [];
  return {
    calls,
    json: (args) => {
      const key = args.join(" ");
      if (key === "label list") return labels;
      if (key === "property list --include-archived") return properties;
      throw new Error("unexpected " + key);
    },
    run: (args) => { calls.push(args); return "{}"; },
  };
}
const flagOf = (argv, flag) => argv[argv.indexOf(flag) + 1];

// --- export ----------------------------------------------------------------

test("export --scope project bundles workspace labels and properties, stripping server-owned ids", () => {
  const { manifest } = exportResource({ cli: exportCli(), scope: "project", ids: { projectId: "pr_SRC1" }, outDir: "/p", sourceWorkspaceId: "ws", fs: memFs(), download: () => null });

  assert.deepEqual(manifest.labels, [
    { name: "Bug", color: "#ef4444", description: "The bug issues" },
    { name: "Chore", color: "#6b7280", description: "" },
  ], "labels bundled by name+color; `id` dropped because the destination re-mints it");

  const severity = manifest.properties.find((p) => p.name === "Severity");
  assert.deepEqual(severity.options, [{ name: "Critical", color: "#ef4444" }, { name: "Minor", color: "#6b7280" }],
    "option ids dropped — `property update` re-matches options BY NAME, so name+color is the portable payload");
  assert.equal(severity.icon, "flag");
  assert.ok(!("position" in severity), "position is server-assigned with no CLI setter — never bundled");
  assert.ok(!("usage_count" in severity), "usage_count is source-workspace state, not a definition");

  assert.deepEqual(manifest.properties.find((p) => p.name === "Owner").options, [],
    "a non-select property reports config.options as null — normalized to an empty list, never crashes");
  assert.equal(manifest.properties.find((p) => p.name === "Retired").archived, true,
    "archived state travels, so a retired definition does not reappear in every picker at the destination");
});

test("export reports label descriptions as unportable — the CLI has no --description flag", () => {
  const { labelDescriptionsNotPortable } = exportResource({ cli: exportCli(), scope: "project", ids: { projectId: "pr_SRC1" }, outDir: "/p", sourceWorkspaceId: "ws", fs: memFs(), download: () => null });
  assert.deepEqual(labelDescriptionsNotPortable, ["Bug"], "only labels that actually carry a description are flagged");
});

test("export --scope agent bundles no taxonomy — a single agent is not a workspace migration", () => {
  const cli = exportCli();
  const { manifest } = exportResource({ cli, scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/a", sourceWorkspaceId: "ws", fs: memFs(), download: () => null });
  // exportCli() throws on any call it does not expect; reaching here at all proves
  // no label/property list call was made for this scope.
  assert.deepEqual(manifest.labels, []);
  assert.deepEqual(manifest.properties, []);
});

// --- import: labels ---------------------------------------------------------

test("parseInclude accepts labels and properties, but neither is on by default", () => {
  assert.deepEqual([...parseInclude(null)].sort(), ["agents", "skills", "squads"]);
  const inc = parseInclude("labels,properties");
  assert.ok(inc.has("labels") && inc.has("properties"));
});

test("importLabels creates a missing label and updates an existing one by name", () => {
  const cli = recordingCli({ labels: [{ id: "lb_TGT9", name: "Bug", color: "#000000", description: "" }] });
  const manifest = { labels: [{ name: "Bug", color: "#ef4444", description: "" }, { name: "Chore", color: "#6b7280", description: "" }] };
  const r = importLabels({ cli, manifest });

  assert.equal(r.created, 1);
  assert.equal(r.updated, 1);
  const update = cli.calls.find((a) => a[1] === "update");
  assert.equal(update[2], "lb_TGT9", "matched by name, addressed by the DESTINATION id — never the source id");
  assert.equal(flagOf(update, "--color"), "#ef4444");
  const create = cli.calls.find((a) => a[1] === "create");
  assert.equal(flagOf(create, "--name"), "Chore");
});

test("importLabels reports an unrestorable description instead of dropping it silently", () => {
  const cli = recordingCli();
  const r = importLabels({ cli, manifest: { labels: [{ name: "Bug", color: "#ef4444", description: "The bug issues" }] } });
  assert.deepEqual(r.descriptionUnsupported, ["Bug"]);
  assert.ok(!cli.calls.some((a) => a.includes("--description")),
    "regression guard: `label create/update` reject --description in multica 0.4.36 — passing it aborts the import");
});

test("importLabels stays quiet when the destination already carries the same description", () => {
  const cli = recordingCli({ labels: [{ id: "lb_TGT9", name: "Bug", color: "#ef4444", description: "The bug issues" }] });
  const r = importLabels({ cli, manifest: { labels: [{ name: "Bug", color: "#ef4444", description: "The bug issues" }] } });
  assert.deepEqual(r.descriptionUnsupported, [], "nothing is lost, so nothing is reported");
});

// --- import: properties -----------------------------------------------------

const SEVERITY = { name: "Severity", type: "select", description: "how bad", icon: "flag", archived: false, options: [{ name: "Critical", color: "#ef4444" }, { name: "Minor", color: null }] };

test("importProperties creates a select with one --option per choice, colour suffix only when set", () => {
  const cli = recordingCli();
  const r = importProperties({ cli, manifest: { properties: [SEVERITY] } });
  assert.equal(r.created, 1);
  const create = cli.calls.find((a) => a[1] === "create");
  assert.equal(flagOf(create, "--type"), "select");
  assert.equal(flagOf(create, "--icon"), "flag");
  const options = create.filter((a, i) => create[i - 1] === "--option");
  assert.deepEqual(options, ["Critical:#ef4444", "Minor"],
    "the ':#rrggbb' suffix is optional — a colourless option must not become 'Minor:null'");
});

test("importProperties addresses an existing property by NAME, the key issue values reference", () => {
  const cli = recordingCli({ properties: [{ name: "Severity", type: "select", description: "", icon: "", archived: false, options: [] }] });
  const r = importProperties({ cli, manifest: { properties: [SEVERITY] } });
  assert.equal(r.updated, 1);
  assert.equal(r.created, 0);
  const update = cli.calls.find((a) => a[1] === "update");
  assert.equal(update[2], "Severity");
});

test("importProperties skips a name collision with a different type — type is immutable", () => {
  const cli = recordingCli({ properties: [{ name: "Severity", type: "text", description: "", icon: "", archived: false, options: [] }] });
  const r = importProperties({ cli, manifest: { properties: [SEVERITY] } });
  assert.equal(r.created + r.updated, 0);
  assert.equal(cli.calls.length, 0, "re-creating it would orphan every value already stored under that name");
  assert.match(r.typeConflicts[0], /Severity.*text.*select/);
});

test("importProperties re-archives an archived definition after writing it", () => {
  const cli = recordingCli();
  const r = importProperties({ cli, manifest: { properties: [{ ...SEVERITY, archived: true }] } });
  assert.deepEqual(r.archivedApplied, ["Severity"]);
  assert.deepEqual(cli.calls.map((a) => a[1]), ["create", "archive"], "created, then archived — never left visible in pickers");
});

test("importProperties unarchives BEFORE updating so the write lands on an active definition", () => {
  const cli = recordingCli({ properties: [{ name: "Severity", type: "select", description: "", icon: "", archived: true, options: [] }] });
  importProperties({ cli, manifest: { properties: [SEVERITY] } });
  assert.deepEqual(cli.calls.map((a) => a[1]), ["unarchive", "update"],
    "ordering matters: updating an archived definition is not a supported CLI path");
});

// --- preflight --------------------------------------------------------------

test("preflight counts taxonomy and warns before any write", () => {
  const manifest = {
    version: "1", skills: [], agents: [], squads: [], projects: [], autopilots: [],
    labels: [{ name: "Bug", color: "#ef4444", description: "The bug issues" }],
    properties: [SEVERITY, { name: "Retired", type: "text", description: "", icon: "", archived: true, options: [] }],
  };
  const fs = memFs();
  fs.files["./manifest.json"] = JSON.stringify(manifest);
  const cli = recordingCli({ properties: [{ name: "Severity", type: "text", description: "", icon: "", archived: false, options: [] }] });
  const rep = preflight({ cli, dir: ".", runtimeMap: new Map(), include: new Set(["labels", "properties"]), fs });

  assert.equal(rep.bundle.labels, 1);
  assert.equal(rep.willImport.properties, 2);
  const types = rep.incompatibilities.map((i) => i.type);
  assert.ok(types.includes("label-description-not-settable"));
  assert.ok(types.includes("property-type-conflict"));
  assert.ok(types.includes("property-archived"));
  assert.equal(cli.calls.length, 0, "preflight is read-only");
});

test("preflight skips taxonomy checks entirely when neither type is included", () => {
  const fs = memFs();
  fs.files["./manifest.json"] = JSON.stringify({ version: "1", skills: [], agents: [], squads: [], projects: [], autopilots: [], labels: [{ name: "Bug", color: "#ef4444", description: "x" }], properties: [SEVERITY] });
  const rep = preflight({ cli: recordingCli(), dir: ".", runtimeMap: new Map(), include: new Set(["squads"]), fs });
  assert.equal(rep.bundle.labels, 1, "the bundle still reports what it holds");
  assert.equal(rep.willImport.labels, 0, "but nothing will be written");
  assert.deepEqual(rep.incompatibilities, []);
});
