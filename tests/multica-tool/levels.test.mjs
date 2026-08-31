// Export LEVELS: a whole-workspace export bundles its own tier plus every tier
// below it (skill < agent < squad < project). Default is `squad`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { exportResource, LEVELS, levelAtLeast } from "../../plugins/multica-tool/scripts/multica-export.mjs";
import { AGENT_GET, AGENT_GET_2, SKILL_GET, SKILL_GET_2, SQUAD_GET, SQUAD_MEMBERS, RUNTIME_LIST_SRC, PROJECT_LIST, PROJECT_GET_1, PROJECT_GET_2, PROJECT_RESOURCES_1, PROJECT_RESOURCES_2, AUTOPILOT_GET, WORKSPACE_MEMBERS, LABEL_LIST, PROPERTY_LIST, WORKSPACE_MCP_LIST, AGENT_MCP_LIST } from "./fixtures.mjs";

function memFs() {
  const files = {};
  return { files, mkdirSync: () => {}, writeFileSync: (p, c) => { files[p] = c; } };
}

// Records every CLI read so a test can assert a tier's list call was NEVER made.
function wsCli() {
  const seen = [];
  return {
    seen,
    json: (args) => {
      seen.push(args.join(" "));
      const k2 = args.slice(0, 2).join(" ");
      const k3 = args.slice(0, 3).join(" ");
      if (k2 === "skill list") return [{ id: "sk_SRC1", name: "Greet" }, { id: "sk_SRC2", name: "Lonely" }];
      if (k2 === "agent list") return [{ id: "ag_SRC1" }, { id: "ag_SRC2" }];
      if (k2 === "squad list") return [{ id: "sq_SRC1", name: "Team" }];
      if (k2 === "project list") return PROJECT_LIST;
      if (k2 === "autopilot list") return { autopilots: [{ id: "ap_SRC1", title: "Nightly Scan" }] };
      if (k3 === "skill get sk_SRC1") return SKILL_GET;
      if (k3 === "skill get sk_SRC2") return SKILL_GET_2;
      if (k3 === "agent get ag_SRC1") return AGENT_GET;
      if (k3 === "agent get ag_SRC2") return AGENT_GET_2;
      if (k3 === "agent env get") return { agent_id: args[3], custom_env: { API_KEY: "s" } };
      if (k3 === "squad get sq_SRC1") return SQUAD_GET;
      if (args.slice(0, 4).join(" ") === "squad member list sq_SRC1") return SQUAD_MEMBERS;
      if (k3 === "project get pr_SRC1") return PROJECT_GET_1;
      if (k3 === "project get pr_SRC2") return PROJECT_GET_2;
      if (args.slice(0, 4).join(" ") === "project resource list pr_SRC1") return PROJECT_RESOURCES_1;
      if (args.slice(0, 4).join(" ") === "project resource list pr_SRC2") return PROJECT_RESOURCES_2;
      if (k3 === "autopilot get ap_SRC1") return AUTOPILOT_GET;
      if (k3 === "runtime list") return RUNTIME_LIST_SRC;
      if (k3 === "workspace member list") return WORKSPACE_MEMBERS;
      if (args.join(" ") === "label list") return LABEL_LIST;
      if (args.join(" ") === "property list --include-archived") return PROPERTY_LIST;
      if (args[0] === "workspace" && args[1] === "mcp") return WORKSPACE_MCP_LIST;
      if (args[0] === "agent" && args[1] === "mcp") return AGENT_MCP_LIST;
      throw new Error("unexpected " + args.join(" "));
    },
    run: () => "",
  };
}

const runLevel = (level) => {
  const cli = wsCli(), fs = memFs();
  const res = exportResource({ cli, scope: "workspace", level, ids: {}, outDir: "/w", sourceWorkspaceId: "ws", fs, download: () => null });
  return { ...res, cli, fs };
};

test("LEVELS are ordered lowest tier first and levelAtLeast compares by that order", () => {
  assert.deepEqual(LEVELS, ["skill", "agent", "squad", "project"]);
  assert.equal(levelAtLeast("squad", "agent"), true);
  assert.equal(levelAtLeast("agent", "squad"), false);
  assert.equal(levelAtLeast("project", "project"), true);
});

test("--level skill bundles every workspace skill and nothing above it", () => {
  const { manifest, cli, fs } = runLevel("skill");
  // Why: at the skill tier there is no agent to reference a skill, so pruning
  // orphans would empty the bundle the operator explicitly asked for.
  assert.deepEqual(manifest.skills.map((s) => s.name).sort(), ["Greet", "Lonely"]);
  assert.equal(manifest.agents.length, 0);
  assert.equal(manifest.squads.length, 0);
  assert.equal(manifest.projects.length, 0);
  assert.equal(manifest.autopilots.length, 0);
  assert.ok(!cli.seen.includes("agent list"), "the agent tier is never even listed");
  assert.ok(fs.files["/w/skills/lonely/SKILL.md"], "orphan skill kept at this level");
});

test("--level agent adds every agent and prunes skills no agent references", () => {
  const { manifest, pruned_skills, cli } = runLevel("agent");
  assert.equal(manifest.agents.length, 2);
  assert.deepEqual(pruned_skills, ["Lonely"]);
  assert.equal(manifest.squads.length, 0);
  assert.ok(!cli.seen.includes("squad list"), "the squad tier is never listed");
  assert.ok(!cli.seen.includes("project list"));
});

test("--level squad adds squads but no projects or autopilots", () => {
  const { manifest, cli } = runLevel("squad");
  assert.equal(manifest.squads.length, 1);
  assert.equal(manifest.agents.length, 2);
  assert.equal(manifest.projects.length, 0);
  assert.equal(manifest.autopilots.length, 0);
  assert.ok(!cli.seen.includes("project list"), "the project tier is never listed");
  assert.ok(!cli.seen.includes("autopilot list"));
  assert.equal(manifest.labels_file, null, "taxonomy rides with the project tier only");
  assert.equal(manifest.mcp_servers_file, null);
});

test("--level project adds projects, autopilots and the workspace taxonomy", () => {
  const { manifest, fs } = runLevel("project");
  assert.equal(manifest.projects.length, 2);
  assert.equal(manifest.autopilots.length, 1, "autopilots ride with the project tier");
  assert.ok(fs.files["/w/autopilots/nightly-scan.json"]);
  assert.equal(manifest.labels_file, "labels/labels.json");
  assert.equal(manifest.properties_file, "properties/properties.json");
  assert.equal(manifest.mcp_servers_file, "mcp/servers.json");
  assert.equal(manifest.level, "project");
});

test("a squad reached twice — listed, then again as an autopilot assignee — is bundled once", () => {
  const cli = wsCli(), fs = memFs();
  // AUTOPILOT_GET assigns agent ag_SRC1, so force the squad path via a squad autopilot.
  const squadAuto = { autopilot: { ...AUTOPILOT_GET.autopilot, assignee_id: "sq_SRC1", assignee_type: "squad" }, triggers: [] };
  const patched = { ...cli, json: (args) => (args.slice(0, 3).join(" ") === "autopilot get ap_SRC1" ? squadAuto : cli.json(args)) };
  const { manifest } = exportResource({ cli: patched, scope: "workspace", level: "project", ids: {}, outDir: "/w", sourceWorkspaceId: "ws", fs, download: () => null });
  assert.deepEqual(manifest.squads.map((s) => s.name), ["Team"], "no duplicate squad entry");
});

test("every exported agent carries its workspace MCP server assignments by name", () => {
  const { fs } = runLevel("agent");
  const rec = JSON.parse(fs.files["/w/agents/helper.json"]);
  assert.deepEqual(rec.mcp_servers, [
    { name: "shortcut", enabled: true },
    { name: "sentry", enabled: false },
  ], "server ids are per-workspace — only name + enabled travel");
});

test("--level project reports the autopilots that were live at the source", () => {
  const { autopilotsActiveAtSource, fs } = runLevel("project");
  // Why: import always lands an autopilot paused, so the operator needs the list
  // of what to re-activate by hand.
  assert.deepEqual(autopilotsActiveAtSource, ["Nightly Scan"]);
  assert.equal(JSON.parse(fs.files["/w/autopilots/nightly-scan.json"]).status, "active");
});

test("--level project reports MCP server configs as unportable", () => {
  const { mcpServerConfigsNotPortable } = runLevel("project");
  // Why: `workspace mcp list` never returns a server's entry JSON, so a bundle
  // can name the servers but never recreate them.
  assert.deepEqual(mcpServerConfigsNotPortable, ["shortcut", "sentry"]);
});
