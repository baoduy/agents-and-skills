import { test } from "node:test";
import assert from "node:assert/strict";
import { exportResource } from "../../plugins/multica-tool/scripts/multica-export.mjs";
import { AGENT_GET, AGENT_GET_2, SQUAD_GET, SQUAD_MEMBERS, RUNTIME_LIST_SRC, PROJECT_GET_1, PROJECT_LIST } from "./fixtures.mjs";

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
      return {};
    },
    run: () => "",
  };
  const { manifest, archivedAgentsSkipped } = exportResource({ cli, scope: "project", ids: { projectId: "pr_P1" }, outDir: "/p", sourceWorkspaceId: "ws", fs, download: () => null });
  
  assert.equal(manifest.projects[0].lead_name, null, "lead name cleared when archived");
  assert.ok(archivedAgentsSkipped.some((s) => s.name === "ArchivedLead" && s.path === "project lead"), "archived lead recorded as skipped");
});
