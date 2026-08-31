import { test } from "node:test";
import assert from "node:assert/strict";
import { exportResource } from "../../plugins/multica-tool/scripts/multica-export.mjs";
import { importAgents, preflight } from "../../plugins/multica-tool/scripts/multica-import.mjs";
import { AGENT_GET, AGENT_GET_2, SQUAD_GET, SQUAD_MEMBERS, RUNTIME_LIST_SRC, PROJECT_GET_1, PROJECT_LIST, LABEL_LIST, PROPERTY_LIST } from "./fixtures.mjs";

function memFs() {
  const store = {};
  return {
    mkdirSync: () => {},
    writeFileSync: (p, c) => { store[p] = c; },
    existsSync: (p) => p in store,
    readFileSync: (p) => store[p],
    files: store,
  };
}

function fakeCli(overrides = {}) {
  return {
    json: (args) => {
      const key = args.join(" ");
      if (key === "agent list") return overrides.agentList || [{ id: "ag_ACTIVE", name: "Active" }];
      if (key === "agent list --include-archived") return overrides.agentListIncl || [
        { id: "ag_ACTIVE", name: "Active" },
        { id: "ag_ARCHIVED", name: "Archived", archived_at: "2026-01-01T00:00:00Z" },
      ];
      if (args[0] === "agent" && args[1] === "get" && args[2] === "ag_ACTIVE") return { 
        id: "ag_ACTIVE", name: "Active", description: "desc", instructions: "instr",
        model: "m", visibility: "workspace", avatar_url: null, service_tier: "",
        permission_mode: null, invocation_targets: [], max_concurrent_tasks: 6,
        runtime_config: {}, custom_args: [], thinking_level: "", runtime_id: "rt1",
        has_custom_env: false, mcp_config: {}, mcp_config_redacted: false, skills: [] 
      };
      if (args[0] === "agent" && args[1] === "get" && args[2] === "ag_ARCHIVED") return { 
        id: "ag_ARCHIVED", name: "Archived", description: "desc", instructions: "instr",
        model: "m", visibility: "workspace", avatar_url: null, service_tier: "",
        permission_mode: null, invocation_targets: [], max_concurrent_tasks: 6,
        runtime_config: {}, custom_args: [], thinking_level: "", runtime_id: "rt1",
        has_custom_env: false, mcp_config: {}, mcp_config_redacted: false, skills: [],
        archived_at: "2026-01-01T00:00:00Z"
      };
      if (key === "runtime list") return RUNTIME_LIST_SRC;
      if (key === "skill list") return [];
      if (key === "squad list") return [];
      if (key === "project list") return [];
      if (args.join(" ") === "label list") return LABEL_LIST;
      if (args.join(" ") === "property list --include-archived") return PROPERTY_LIST;
      return {};
    },
    run: () => "",
  };
}

test("export excludes archived agents from workspace listing", () => {
  const fs = memFs();
  const cli = fakeCli();
  const { manifest, archivedAgentsSkipped } = exportResource({ cli, scope: "all", ids: {}, outDir: "/all", sourceWorkspaceId: "ws", fs, download: () => null });
  
  assert.equal(manifest.agents.length, 1, "only active agent in manifest");
  assert.equal(manifest.agents[0].name, "Active");
  assert.ok(archivedAgentsSkipped.some((s) => s.name === "Archived" && s.path === "workspace listing"), "archived agent recorded as skipped");
});

test("export refuses to export an archived agent explicitly", () => {
  const fs = memFs();
  const cli = fakeCli();
  assert.throws(
    () => exportResource({ cli, scope: "agent", ids: { agentId: "ag_ARCHIVED" }, outDir: "/one", sourceWorkspaceId: "ws", fs, download: () => null }),
    /Cannot export agent "Archived": it is archived/
  );
});

test("export squad excludes archived members but keeps squad if leader is active", () => {
  const fs = memFs();
  const cli = {
    json: (args) => {
      const key = args.join(" ");
      if (key === "squad get sq_S1") return { id: "sq_S1", name: "Squad1", description: "", instructions: "", leader_id: "ag_LEADER", avatar_url: null };
      if (key === "agent get ag_LEADER") return { 
        id: "ag_LEADER", name: "Leader", description: "desc", instructions: "instr",
        model: "m", visibility: "workspace", avatar_url: null, service_tier: "",
        permission_mode: null, invocation_targets: [], max_concurrent_tasks: 6,
        runtime_config: {}, custom_args: [], thinking_level: "", runtime_id: "rt1",
        has_custom_env: false, mcp_config: {}, mcp_config_redacted: false, skills: [] 
      };
      if (key === "agent get ag_MEMBER_ARCHIVED") return { 
        id: "ag_MEMBER_ARCHIVED", name: "ArchivedMember", description: "desc", instructions: "instr",
        model: "m", visibility: "workspace", avatar_url: null, service_tier: "",
        permission_mode: null, invocation_targets: [], max_concurrent_tasks: 6,
        runtime_config: {}, custom_args: [], thinking_level: "", runtime_id: "rt1",
        has_custom_env: false, mcp_config: {}, mcp_config_redacted: false, skills: [],
        archived_at: "2026-01-01T00:00:00Z"
      };
      if (key === "squad member list sq_S1") return [
        { member_id: "ag_LEADER", member_type: "agent", role: "leader" },
        { member_id: "ag_MEMBER_ARCHIVED", member_type: "agent", role: "member" },
      ];
      if (key === "runtime list") return RUNTIME_LIST_SRC;
      if (key === "skill list") return [];
      return {};
    },
    run: () => "",
  };
  const { manifest, archivedAgentsSkipped } = exportResource({ cli, scope: "squad", ids: { squadId: "sq_S1" }, outDir: "/s", sourceWorkspaceId: "ws", fs, download: () => null });
  
  assert.equal(manifest.squads[0].members.length, 1, "only active member kept");
  assert.equal(manifest.squads[0].members[0].agent_name, "Leader");
  assert.ok(archivedAgentsSkipped.some((s) => s.name === "ArchivedMember" && s.path === "squad member"), "archived member recorded as skipped");
});

test("export squad drops squad if leader is archived", () => {
  const fs = memFs();
  const cli = {
    json: (args) => {
      const key = args.join(" ");
      if (key === "squad get sq_S1") return { id: "sq_S1", name: "Squad1", description: "", instructions: "", leader_id: "ag_LEADER_ARCHIVED", avatar_url: null };
      if (key === "agent get ag_LEADER_ARCHIVED") return { 
        id: "ag_LEADER_ARCHIVED", name: "ArchivedLeader", description: "desc", instructions: "instr",
        model: "m", visibility: "workspace", avatar_url: null, service_tier: "",
        permission_mode: null, invocation_targets: [], max_concurrent_tasks: 6,
        runtime_config: {}, custom_args: [], thinking_level: "", runtime_id: "rt1",
        has_custom_env: false, mcp_config: {}, mcp_config_redacted: false, skills: [],
        archived_at: "2026-01-01T00:00:00Z"
      };
      if (key === "squad member list sq_S1") return [
        { member_id: "ag_LEADER_ARCHIVED", member_type: "agent", role: "leader" },
      ];
      if (key === "runtime list") return RUNTIME_LIST_SRC;
      if (key === "skill list") return [];
      return {};
    },
    run: () => "",
  };
  const { manifest } = exportResource({ cli, scope: "squad", ids: { squadId: "sq_S1" }, outDir: "/s", sourceWorkspaceId: "ws", fs, download: () => null });
  
  assert.equal(manifest.squads.length, 0, "squad dropped when leader is archived");
});

test("export project lead exclusion", () => {
  const fs = memFs();
  const cli = {
    json: (args) => {
      const key = args.join(" ");
      if (key === "project get pr_P1") return { id: "pr_P1", title: "Project1", description: "", icon: null, priority: "none", status: "planned", due_date: null, start_date: null, lead_id: "ag_LEAD_ARCHIVED", lead_type: "agent" };
      if (key === "agent get ag_LEAD_ARCHIVED") return { 
        id: "ag_LEAD_ARCHIVED", name: "ArchivedLead", description: "desc", instructions: "instr",
        model: "m", visibility: "workspace", avatar_url: null, service_tier: "",
        permission_mode: null, invocation_targets: [], max_concurrent_tasks: 6,
        runtime_config: {}, custom_args: [], thinking_level: "", runtime_id: "rt1",
        has_custom_env: false, mcp_config: {}, mcp_config_redacted: false, skills: [],
        archived_at: "2026-01-01T00:00:00Z"
      };
      if (key === "project resource list pr_P1") return [];
      if (key === "runtime list") return RUNTIME_LIST_SRC;
      if (key === "skill list") return [];
      if (key === "label list") return LABEL_LIST;
      if (key === "property list --include-archived") return PROPERTY_LIST;
      return {};
    },
    run: () => "",
  };
  const { manifest, archivedAgentsSkipped } = exportResource({ cli, scope: "project", ids: { projectId: "pr_P1" }, outDir: "/p", sourceWorkspaceId: "ws", fs, download: () => null });

  assert.equal(manifest.projects[0].lead_name, null, "lead name cleared when archived");
  assert.ok(archivedAgentsSkipped.some((s) => s.name === "ArchivedLead" && s.path === "project lead"), "archived lead recorded as skipped");
});

// --- import-side archived agent coverage (restore-and-reuse) ---

const IMPORT_AGENT_MANIFEST = {
  version: "1", scope: "agent", source_workspace_id: "ws_SRC", skills: [],
  agents: [{ name: "Helper", file: "agents/helper.json", source_runtime_id: "rt_SRC1", skill_names: [] }],
  squads: [],
};
const IMPORT_AGENT_FILE = JSON.stringify({
  name: "Helper", instructions: "be nice", model: "claude-sonnet-4-6", visibility: "workspace",
  max_concurrent_tasks: 6, source_id: "ag_SRC1", source_runtime_id: "rt_SRC1", skill_names: [],
});
function importAgentFs() {
  return { existsSync: () => true, readFileSync: () => IMPORT_AGENT_FILE, readdirSync: () => [] };
}
// Records every cli.run argv; json() answers `agent list --include-archived` from `existing`.
function importRecordingCli(existing) {
  const calls = [];
  return {
    calls,
    json: (a) => (a[0] === "agent" && a[1] === "list" ? existing : {}),
    run: (a) => { calls.push(a); return a.includes("create") ? '{"id":"ag_NEW1"}' : "{}"; },
  };
}

test("importAgents restores-and-updates an archived name match, counts as reused", () => {
  const cli = importRecordingCli([{ id: "ag_ARCHIVED", name: "Helper", archived_at: "2026-01-01T00:00:00Z" }]);
  const { reused, updated, idMap } = importAgents({ cli, manifest: IMPORT_AGENT_MANIFEST, dir: ".", skillIdMap: new Map(), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs: importAgentFs() });

  assert.equal(reused, 1, "counted as reused, not updated");
  assert.equal(updated, 0);
  assert.equal(idMap.get("Helper"), "ag_ARCHIVED");
  const restoreCall = cli.calls.find((a) => a[0] === "agent" && a[1] === "restore");
  assert.deepEqual(restoreCall, ["agent", "restore", "ag_ARCHIVED"]);
  const updateCall = cli.calls.find((a) => a[0] === "agent" && a[1] === "update");
  assert.equal(updateCall[2], "ag_ARCHIVED", "update targets the restored agent's id");
  assert.ok(cli.calls.indexOf(restoreCall) < cli.calls.indexOf(updateCall), "restore happens before update");
});

test("importAgents updates an active name match without restoring (regression guard)", () => {
  const cli = importRecordingCli([{ id: "ag_ACTIVE", name: "Helper" }]);
  const { reused, updated } = importAgents({ cli, manifest: IMPORT_AGENT_MANIFEST, dir: ".", skillIdMap: new Map(), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs: importAgentFs() });

  assert.equal(updated, 1);
  assert.equal(reused, 0, "no change from current behavior for an active match");
  assert.ok(!cli.calls.some((a) => a[1] === "restore"), "never restores an active agent");
  assert.ok(cli.calls.some((a) => a[0] === "agent" && a[1] === "update" && a[2] === "ag_ACTIVE"));
});

test("importAgents creates when no archived or active match (regression guard)", () => {
  const cli = importRecordingCli([]);
  const { created, idMap } = importAgents({ cli, manifest: IMPORT_AGENT_MANIFEST, dir: ".", skillIdMap: new Map(), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs: importAgentFs() });

  assert.equal(created, 1);
  assert.equal(idMap.get("Helper"), "ag_NEW1");
  assert.ok(cli.calls.some((a) => a[0] === "agent" && a[1] === "create"));
  assert.ok(!cli.calls.some((a) => a[1] === "restore"));
});

test("re-import after restore is idempotent — second import finds the now-active agent via the plain match branch, never restores twice", () => {
  const existing = [{ id: "ag_ARCHIVED", name: "Helper", archived_at: "2026-01-01T00:00:00Z" }];
  const cli = importRecordingCli(existing);

  const first = importAgents({ cli, manifest: IMPORT_AGENT_MANIFEST, dir: ".", skillIdMap: new Map(), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs: importAgentFs() });
  assert.equal(first.reused, 1);
  assert.equal(cli.calls.filter((a) => a[1] === "restore").length, 1);

  // Reflects reality: the matched agent is now active after the restore above.
  existing[0] = { id: "ag_ARCHIVED", name: "Helper" };
  const second = importAgents({ cli, manifest: IMPORT_AGENT_MANIFEST, dir: ".", skillIdMap: new Map(), runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), fs: importAgentFs() });

  assert.equal(second.updated, 1);
  assert.equal(second.reused, 0);
  assert.equal(cli.calls.filter((a) => a[1] === "restore").length, 1, "restore is never called a second time");
});

test("preflight reports agent-archived-will-restore on dry-run and never calls restore", () => {
  const cli = importRecordingCli([{ id: "ag_ARCHIVED", name: "Helper", archived_at: "2026-01-01T00:00:00Z" }]);
  const fs = {
    existsSync: () => true,
    readFileSync: (p) => (p.endsWith("manifest.json") ? JSON.stringify(IMPORT_AGENT_MANIFEST) : IMPORT_AGENT_FILE),
    readdirSync: () => [],
  };
  const rep = preflight({ cli, dir: ".", runtimeMap: new Map([["rt_SRC1", "rt_TGT1"]]), include: new Set(["agents"]), fs });

  assert.ok(
    rep.incompatibilities.some((i) => i.type === "agent-archived-will-restore" && i.detail.includes("Helper")),
    "reports the restore-and-reuse incompatibility"
  );
  assert.ok(!cli.calls.some((a) => a[1] === "restore"), "preflight is read-only, never restores");
});
