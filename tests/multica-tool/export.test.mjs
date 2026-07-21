import { test } from "node:test";
import assert from "node:assert/strict";
import { redactAgent, buildManifest, exportResource } from "../../plugins/multica-tool/scripts/multica-export.mjs";
import { getAgent } from "../../plugins/multica-tool/scripts/lib.mjs";
import { AGENT_GET, SKILL_GET, AGENT_GET_2, AGENT_GET_REDACTED, SQUAD_GET, SQUAD_MEMBERS, RUNTIME_LIST_SRC, AGENT_ENV_GET } from "./fixtures.mjs";

function fakeCli() {
  return {
    json: (args) => {
      const key = args.slice(0, 3).join(" ");           // first 3 tokens identify the call
      if (key === "squad get sq_SRC1") return SQUAD_GET;
      if (key === "squad member list") return SQUAD_MEMBERS;
      if (key === "agent get ag_SRC1") return AGENT_GET;
      if (key === "agent get ag_SRC2") return AGENT_GET_2;
      if (key === "agent env get") return AGENT_ENV_GET;
      if (key === "skill get sk_SRC1") return SKILL_GET;
      if (key === "runtime list") return RUNTIME_LIST_SRC;
      throw new Error("unexpected " + args.join(" "));
    },
    run: () => "",
  };
}
function memFs() {
  const files = {};
  return { files, mkdirSync: () => {}, writeFileSync: (p, c) => { files[p] = c; } };
}
// Like memFs but enforces that a file's parent dir was mkdir'd first — mirrors
// the real fs ENOENT, so a missing mkdir for nested skill files is caught.
function strictFs() {
  const files = {}, dirs = new Set();
  return {
    files,
    mkdirSync: (p) => { const parts = p.split("/"); for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join("/")); },
    writeFileSync: (p, c) => {
      const parent = p.slice(0, p.lastIndexOf("/"));
      if (!dirs.has(parent)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      files[p] = c;
    },
  };
}

test("redactAgent embeds mcpConfig and customEnv when both are usable", () => {
  const normalized = getAgent({ json: () => AGENT_GET }, "ag_SRC1");
  normalized.customEnv = { API_KEY: "secret-value" };
  normalized.customEnvFetchFailed = false;
  const { record, hadSecrets } = redactAgent(normalized);
  assert.equal(hadSecrets, true);
  assert.deepEqual(record.mcpConfig, { mcpServers: { x: { token: "t" } } }, "mcp_config is now written, not stripped");
  assert.deepEqual(record.customEnv, { API_KEY: "secret-value" });
  assert.ok(!("hasCustomEnv" in record));
  assert.ok(!("mcpConfigRedacted" in record), "export-time signal, not agent config to restore");
  assert.ok(!("customEnvFetchFailed" in record), "export-time signal, not agent config to restore");
  assert.ok(!("skills" in record));
  assert.ok(!("id" in record));
  assert.equal(record.sourceId, "ag_SRC1", "original agent id kept under sourceId, for mention rewriting on import");
  assert.equal(record.sourceRuntimeId, "rt_SRC1");
  assert.equal(record.maxConcurrentTasks, 6, "normalized field survives");
  assert.equal(record.hadSecrets, true);
  assert.equal(record.name, "Helper");
});

test("redactAgent leaves mcpConfig/customEnv null and hadSecrets false when neither is present", () => {
  const normalized = getAgent({ json: () => AGENT_GET_2 }, "ag_SRC2");
  normalized.customEnv = {};
  normalized.customEnvFetchFailed = false;
  const { record, hadSecrets } = redactAgent(normalized);
  assert.equal(hadSecrets, false);
  assert.equal(record.mcpConfig, null);
  assert.equal(record.customEnv, null);
});

test("redactAgent never surfaces a redacted mcp_config, and still flags hadSecrets", () => {
  const normalized = getAgent({ json: () => AGENT_GET_REDACTED }, "ag_SRC3");
  normalized.customEnv = {};
  normalized.customEnvFetchFailed = false;
  const { record, hadSecrets } = redactAgent(normalized);
  assert.equal(record.mcpConfig, null, "redacted value must never be written to disk");
  assert.equal(hadSecrets, true, "still flagged so the user knows something was skipped");
});

test("redactAgent flags hadSecrets when the audited env fetch failed, writes no stale customEnv", () => {
  const normalized = getAgent({ json: () => AGENT_GET_2 }, "ag_SRC2");
  normalized.customEnv = {};
  normalized.customEnvFetchFailed = true;
  const { record, hadSecrets } = redactAgent(normalized);
  assert.equal(record.customEnv, null);
  assert.equal(hadSecrets, true);
});

test("buildManifest dedups skills/agents by name and wires by name", () => {
  const m = buildManifest({
    scope: "squad",
    sourceWorkspaceId: "ws_SRC",
    skills: [{ name: "Greet", sourceId: "sk_SRC1" }, { name: "Greet", sourceId: "sk_SRC1" }],
    agents: [{ name: "Helper", sourceId: "ag_SRC1", sourceRuntimeId: "rt_SRC1", skillNames: ["Greet"], hadSecrets: true }],
    squad: { name: "Team", description: "the team", leaderName: "Helper", members: [{ agentName: "Helper2", role: "member" }] },
  });
  assert.equal(m.version, "1");
  assert.equal(m.skills.length, 1, "skills deduped by name");
  assert.equal(m.skills[0].dir, "skills/greet");
  assert.equal(m.agents[0].file, "agents/helper.json");
  assert.equal(m.agents[0].sourceId, "ag_SRC1", "source agent id carried in manifest for mention rewriting");
  assert.deepEqual(m.agents[0].skillNames, ["Greet"]);
  assert.equal(m.agents[0].hadSecrets, true);
  assert.equal(m.squads[0].leaderName, "Helper");
  assert.equal(m.squads[0].description, "the team");
});

test("export skill writes SKILL.md, config, extra files, manifest", () => {
  const fs = memFs();
  const { manifest } = exportResource({ cli: fakeCli(), scope: "skill", ids: { skillId: "sk_SRC1" }, outDir: "/out", sourceWorkspaceId: "ws_SRC", fs });
  assert.equal(fs.files["/out/skills/greet/SKILL.md"], "# Greet\nbody");
  assert.ok(fs.files["/out/skills/greet/config.json"].includes("warm"));
  assert.equal(fs.files["/out/skills/greet/ref.md"], "extra");
  assert.ok(fs.files["/out/manifest.json"]);
  assert.equal(manifest.skills[0].name, "Greet");
});

test("export creates nested parent dirs for skill files (regression: scripts/ subdir)", () => {
  const fs = strictFs();
  const cli = {
    json: (args) => {
      if (args.slice(0, 3).join(" ") === "skill get sk_N")
        return { id: "sk_N", name: "Nested", content: "x", config: {}, files: [{ path: "scripts/run.sh", content: "echo hi" }] };
      throw new Error("unexpected " + args.join(" "));
    },
    run: () => "",
  };
  exportResource({ cli, scope: "skill", ids: { skillId: "sk_N" }, outDir: "/out", sourceWorkspaceId: "", fs });
  assert.equal(fs.files["/out/skills/nested/scripts/run.sh"], "echo hi");
});

test("export agent writes mcp_config/customEnv to disk and warns when either is present", () => {
  const fs = memFs();
  const { manifest, warnings } = exportResource({ cli: fakeCli(), scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/o", sourceWorkspaceId: "ws", fs });
  const record = JSON.parse(fs.files["/o/agents/helper.json"]);
  assert.deepEqual(record.mcpConfig, { mcpServers: { x: { token: "t" } } }, "mcp_config now round-trips");
  assert.deepEqual(record.customEnv, { API_KEY: "secret-value" }, "custom_env now round-trips");
  assert.deepEqual(warnings, ["Helper"]);          // has_custom_env true / mcp_config present → warned
  assert.equal(manifest.agents[0].sourceRuntimeProvider, "claude", "runtime provider captured for later auto-mapping");
  assert.equal(record.sourceRuntimeProvider, "claude");
});

test("manifest.json never carries mcpConfig/customEnv, even when the agent record does (regression: secrets must stay out of the manifest/stdout projection)", () => {
  const fs = memFs();
  const { manifest } = exportResource({ cli: fakeCli(), scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/o4", sourceWorkspaceId: "ws", fs });
  assert.ok(!("mcpConfig" in manifest.agents[0]), "manifest agent entry must not carry mcp_config");
  assert.ok(!("customEnv" in manifest.agents[0]), "manifest agent entry must not carry custom_env");
  const manifestBlob = fs.files["/o4/manifest.json"];
  assert.ok(!manifestBlob.includes("token"), "the secret value itself must never appear in manifest.json");
});

test("export skips the audited agent env get call when hasCustomEnv is false", () => {
  const fs = memFs();
  const calls = [];
  const cli = fakeCli();
  const wrapped = { ...cli, json: (args) => { calls.push(args.join(" ")); return cli.json(args); } };
  exportResource({ cli: wrapped, scope: "agent", ids: { agentId: "ag_SRC2" }, outDir: "/o2", sourceWorkspaceId: "ws", fs });
  assert.ok(!calls.some((c) => c.startsWith("agent env get")), "ag_SRC2 has has_custom_env:false — must not trigger the audited call");
});

test("export continues when the audited agent env get call fails (e.g. insufficient permission)", () => {
  const fs = memFs();
  const cli = fakeCli();
  const failing = { ...cli, json: (args) => {
    if (args.join(" ") === "agent env get ag_SRC1") throw new Error("permission denied");
    return cli.json(args);
  } };
  const { manifest, warnings } = exportResource({ cli: failing, scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/o3", sourceWorkspaceId: "ws", fs });
  const record = JSON.parse(fs.files["/o3/agents/helper.json"]);
  assert.equal(record.customEnv, null, "failed fetch never writes a partial/stale value");
  assert.deepEqual(warnings, ["Helper"], "still warned even though the customEnv fetch itself failed");
  assert.ok(manifest.agents[0].hadSecrets);
});

test("export squad resolves leader and member names by id and writes squad file", () => {
  const fs = memFs();
  const { manifest, warnings } = exportResource({ cli: fakeCli(), scope: "squad", ids: { squadId: "sq_SRC1" }, outDir: "/s", sourceWorkspaceId: "ws", fs });
  const squad = JSON.parse(fs.files["/s/squads/team.json"]);
  assert.equal(squad.leaderName, "Helper", "leaderId ag_SRC1 resolved to name");
  assert.equal(squad.instructions, "# Team charter\nShip it.", "squad instructions captured in export");
  assert.deepEqual(squad.members.map((m) => m.agentName).sort(), ["Helper", "Helper2"]);
  assert.equal(manifest.agents.length, 2, "both member agents captured");
  assert.deepEqual(warnings, ["Helper"], "only the agent with secrets is warned");
  const helper = manifest.agents.find((a) => a.name === "Helper");
  assert.equal(helper.sourceId, "ag_SRC1", "source agent id recorded in manifest for mention rewriting on import");
});
