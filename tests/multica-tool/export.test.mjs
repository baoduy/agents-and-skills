import { test } from "node:test";
import assert from "node:assert/strict";
import { redactAgent, buildManifest, exportResource } from "../../plugins/multica-tool/scripts/multica-export.mjs";
import { getAgent } from "../../plugins/multica-tool/scripts/lib.mjs";
import { AGENT_GET, AGENT_GET_IMG, SKILL_GET, AGENT_GET_2, AGENT_GET_REDACTED, SQUAD_GET, SQUAD_MEMBERS, RUNTIME_LIST_SRC, AGENT_ENV_GET } from "./fixtures.mjs";

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

test("redactAgent embeds mcp_config and custom_env when both are usable", () => {
  const normalized = getAgent({ json: () => AGENT_GET }, "ag_SRC1");
  normalized.custom_env = { API_KEY: "secret-value" };
  normalized.custom_env_fetch_failed = false;
  const { record, hadSecrets } = redactAgent(normalized);
  assert.equal(hadSecrets, true);
  assert.deepEqual(record.mcp_config, { mcpServers: { x: { token: "t" } } }, "mcp_config is now written, not stripped");
  assert.deepEqual(record.custom_env, { API_KEY: "secret-value" });
  assert.ok(!("has_custom_env" in record));
  assert.ok(!("mcp_config_redacted" in record), "export-time signal, not agent config to restore");
  assert.ok(!("custom_env_fetch_failed" in record), "export-time signal, not agent config to restore");
  assert.ok(!("skills" in record));
  assert.ok(!("id" in record));
  assert.equal(record.source_id, "ag_SRC1", "original agent id kept under source_id, for mention rewriting on import");
  assert.equal(record.source_runtime_id, "rt_SRC1");
  assert.equal(record.max_concurrent_tasks, 6, "normalized field survives");
  assert.equal(record.had_secrets, true);
  assert.equal(record.name, "Helper");
});

test("redactAgent leaves mcp_config/custom_env null and hadSecrets false when neither is present", () => {
  const normalized = getAgent({ json: () => AGENT_GET_2 }, "ag_SRC2");
  normalized.custom_env = {};
  normalized.custom_env_fetch_failed = false;
  const { record, hadSecrets } = redactAgent(normalized);
  assert.equal(hadSecrets, false);
  assert.equal(record.mcp_config, null);
  assert.equal(record.custom_env, null);
});

test("redactAgent never surfaces a redacted mcp_config, and still flags hadSecrets", () => {
  const normalized = getAgent({ json: () => AGENT_GET_REDACTED }, "ag_SRC3");
  normalized.custom_env = {};
  normalized.custom_env_fetch_failed = false;
  const { record, hadSecrets } = redactAgent(normalized);
  assert.equal(record.mcp_config, null, "redacted value must never be written to disk");
  assert.equal(hadSecrets, true, "still flagged so the user knows something was skipped");
});

test("redactAgent flags hadSecrets when the audited env fetch failed, writes no stale custom_env", () => {
  const normalized = getAgent({ json: () => AGENT_GET_2 }, "ag_SRC2");
  normalized.custom_env = {};
  normalized.custom_env_fetch_failed = true;
  const { record, hadSecrets } = redactAgent(normalized);
  assert.equal(record.custom_env, null);
  assert.equal(hadSecrets, true);
});

test("redactAgent returns instructions separately and strips them from the record", () => {
  const normalized = getAgent({ json: () => AGENT_GET }, "ag_SRC1");
  normalized.custom_env = {};
  normalized.custom_env_fetch_failed = false;
  const { record, instructions } = redactAgent(normalized);
  assert.equal(instructions, "be nice", "instructions returned alongside the record");
  assert.ok(!("instructions" in record), "instructions no longer embedded in the JSON record");
});

test("redactAgent returns empty-string instructions when the agent has none", () => {
  const normalized = getAgent({ json: () => AGENT_GET_2 }, "ag_SRC2");
  normalized.custom_env = {};
  normalized.custom_env_fetch_failed = false;
  const { instructions } = redactAgent(normalized);
  assert.equal(instructions, "", "empty instructions normalized to \"\"");
});

test("buildManifest dedups skills/agents by name and wires by name", () => {
  const m = buildManifest({
    scope: "squad",
    sourceWorkspaceId: "ws_SRC",
    skills: [{ name: "Greet", source_id: "sk_SRC1" }, { name: "Greet", source_id: "sk_SRC1" }],
    agents: [{ name: "Helper", source_id: "ag_SRC1", source_runtime_id: "rt_SRC1", skill_names: ["Greet"], had_secrets: true }],
    squads: [{ name: "Team", description: "the team", leader_name: "Helper", members: [{ agent_name: "Helper2", role: "member" }] }],
  });
  assert.equal(m.version, "1");
  assert.equal(m.skills.length, 1, "skills deduped by name");
  assert.equal(m.skills[0].dir, "skills/greet");
  assert.equal(m.agents[0].file, "agents/helper.json");
  assert.equal(m.agents[0].source_id, "ag_SRC1", "source agent id carried in manifest for mention rewriting");
  assert.deepEqual(m.agents[0].skill_names, ["Greet"]);
  assert.equal(m.agents[0].had_secrets, true);
  assert.equal(m.squads[0].leader_name, "Helper");
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

test("export agent writes mcp_config/custom_env to disk and warns when either is present", () => {
  const fs = memFs();
  const { manifest, warnings } = exportResource({ cli: fakeCli(), scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/o", sourceWorkspaceId: "ws", fs });
  const record = JSON.parse(fs.files["/o/agents/helper.json"]);
  assert.deepEqual(record.mcp_config, { mcpServers: { x: { token: "t" } } }, "mcp_config now round-trips");
  assert.deepEqual(record.custom_env, { API_KEY: "secret-value" }, "custom_env now round-trips");
  assert.deepEqual(warnings, ["Helper"]);          // has_custom_env true / mcp_config present → warned
  assert.equal(manifest.agents[0].source_runtime_provider, "claude", "runtime provider captured for later auto-mapping");
  assert.equal(record.source_runtime_provider, "claude");
});

test("export agent writes instructions to a sibling .md and records instructions_file", () => {
  const fs = memFs();
  exportResource({ cli: fakeCli(), scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/oi", sourceWorkspaceId: "ws", fs });
  const record = JSON.parse(fs.files["/oi/agents/helper.json"]);
  assert.equal(fs.files["/oi/agents/helper.md"], "be nice", "instructions written to agents/<slug>.md");
  assert.equal(record.instructions_file, "agents/helper.md", "record points at the .md");
  assert.ok(!("instructions" in record), "instructions no longer in the JSON record");
});

test("export agent with empty instructions writes no .md and no instructions_file", () => {
  const fs = memFs();
  exportResource({ cli: fakeCli(), scope: "agent", ids: { agentId: "ag_SRC2" }, outDir: "/oe", sourceWorkspaceId: "ws", fs });
  const record = JSON.parse(fs.files["/oe/agents/helper2.json"]);
  assert.equal(fs.files["/oe/agents/helper2.md"], undefined, "no .md written for empty instructions");
  assert.ok(!("instructions_file" in record), "no instructions_file key when empty");
  assert.ok(!("instructions" in record), "instructions never embedded");
});

test("manifest.json never carries mcp_config/custom_env, even when the agent record does (regression: secrets must stay out of the manifest/stdout projection)", () => {
  const fs = memFs();
  const { manifest } = exportResource({ cli: fakeCli(), scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/o4", sourceWorkspaceId: "ws", fs });
  assert.ok(!("mcp_config" in manifest.agents[0]), "manifest agent entry must not carry mcp_config");
  assert.ok(!("custom_env" in manifest.agents[0]), "manifest agent entry must not carry custom_env");
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
  assert.equal(record.custom_env, null, "failed fetch never writes a partial/stale value");
  assert.deepEqual(warnings, ["Helper"], "still warned even though the custom_env fetch itself failed");
  assert.ok(manifest.agents[0].had_secrets);
});

test("export agent records an emoji avatar as a string and downloads no file", () => {
  const fs = memFs();
  let downloadCalls = 0;
  exportResource({ cli: fakeCli(), scope: "agent", ids: { agentId: "ag_SRC1" }, outDir: "/a", sourceWorkspaceId: "ws", fs, download: () => { downloadCalls++; return null; } });
  const record = JSON.parse(fs.files["/a/agents/helper.json"]);
  assert.equal(record.avatar_url, "emoji:🤖", "emoji avatar carried as a string");
  assert.ok(!("avatar_file" in record), "emoji avatar has no bundled file");
  assert.equal(downloadCalls, 0, "emoji avatars are never downloaded");
});

test("export agent downloads an image avatar into the bundle and records avatar_file", () => {
  const fs = memFs();
  const cli = { json: (args) => { const k = args.slice(0, 3).join(" "); if (k === "agent get ag_SRC4") return AGENT_GET_IMG; if (k === "runtime list") return RUNTIME_LIST_SRC; throw new Error("unexpected " + args.join(" ")); }, run: () => "" };
  const download = (url) => { assert.equal(url, "https://cdn.example.com/uploads/pixel.png"); return Buffer.from("PNGBYTES"); };
  exportResource({ cli, scope: "agent", ids: { agentId: "ag_SRC4" }, outDir: "/img", sourceWorkspaceId: "ws", fs, download });
  const record = JSON.parse(fs.files["/img/agents/pixel.json"]);
  assert.equal(record.avatar_file, "agents/pixel.avatar.png", "avatar_file points at the bundled image");
  assert.equal(String(fs.files["/img/agents/pixel.avatar.png"]), "PNGBYTES", "image bytes written to the bundle");
});

test("export agent tolerates a failed avatar download — keeps avatar_url, writes no file", () => {
  const fs = memFs();
  const cli = { json: (args) => { const k = args.slice(0, 3).join(" "); if (k === "agent get ag_SRC4") return AGENT_GET_IMG; if (k === "runtime list") return RUNTIME_LIST_SRC; throw new Error("unexpected " + args.join(" ")); }, run: () => "" };
  exportResource({ cli, scope: "agent", ids: { agentId: "ag_SRC4" }, outDir: "/imgfail", sourceWorkspaceId: "ws", fs, download: () => null });
  const record = JSON.parse(fs.files["/imgfail/agents/pixel.json"]);
  assert.equal(record.avatar_url, "https://cdn.example.com/uploads/pixel.png", "avatar_url still recorded");
  assert.ok(!("avatar_file" in record), "no avatar_file when the download failed");
});

test("export squad resolves leader and member names by id and writes squad file", () => {
  const fs = memFs();
  const { manifest, warnings } = exportResource({ cli: fakeCli(), scope: "squad", ids: { squadId: "sq_SRC1" }, outDir: "/s", sourceWorkspaceId: "ws", fs });
  const squad = JSON.parse(fs.files["/s/squads/team.json"]);
  assert.equal(squad.leader_name, "Helper", "leader_id ag_SRC1 resolved to name");
  assert.equal(squad.avatar_url, "emoji:🦍", "squad avatar_url captured in export");
  assert.equal(squad.instructions, "# Team charter\nShip it.", "squad instructions captured in export");
  assert.deepEqual(squad.members.map((m) => m.agent_name).sort(), ["Helper", "Helper2"]);
  assert.equal(manifest.agents.length, 2, "both member agents captured");
  assert.deepEqual(warnings, ["Helper"], "only the agent with secrets is warned");
  const helper = manifest.agents.find((a) => a.name === "Helper");
  assert.equal(helper.source_id, "ag_SRC1", "source agent id recorded in manifest for mention rewriting on import");
});

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
