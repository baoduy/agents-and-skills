import { test } from "node:test";
import assert from "node:assert/strict";
import { exportResource, buildManifest } from "../../plugins/multica-tool/scripts/multica-export.mjs";
import { importBundle, importAutopilots, preflight, parseInclude } from "../../plugins/multica-tool/scripts/multica-import.mjs";
import { resolveScopeId, sync } from "../../plugins/multica-tool/scripts/multica-sync.mjs";
import { AUTOPILOT_GET, AUTOPILOT_GET_SQUAD, AUTOPILOT_GET_MINIMAL, AGENT_GET, AGENT_GET_2, SKILL_GET, SQUAD_GET, SQUAD_MEMBERS, PROJECT_GET_1, WORKSPACE_MEMBERS, RUNTIME_LIST_SRC, RUNTIME_LIST_AGENT2 } from "./fixtures.mjs";

function memFs() {
  const files = {};
  return { files, mkdirSync: (p, opts) => {}, writeFileSync: (p, c) => { files[p] = c; } };
}

function autopilotCli(overrides = {}) {
  const auto = overrides.autopilot_get ?? AUTOPILOT_GET;
  return {
    json: (args) => {
      const k3 = args.slice(0, 3).join(" ");
      if (k3 === "autopilot get ap_SRC1") return auto;
      if (k3 === "autopilot get ap_SRC2") return overrides.autopilot_squad_get ?? AUTOPILOT_GET_SQUAD;
      if (k3 === "autopilot get ap_SRC3") return overrides.autopilot_minimal_get ?? AUTOPILOT_GET_MINIMAL;
      if (k3 === "agent get ag_SRC1") return AGENT_GET;
      if (k3 === "agent get ag_SRC2") return AGENT_GET_2;
      if (k3 === "agent env get") return { agent_id: args[3], custom_env: { API_KEY: "secret" } };
      if (k3 === "skill get sk_SRC1") return SKILL_GET;
      if (k3 === "squad get sq_SRC1") return SQUAD_GET;
      if (k3 === "runtime list") return overrides.runtimes ?? RUNTIME_LIST_SRC;
      if (k3 === "project get pr_SRC1") return PROJECT_GET_1;
      if (k3 === "workspace member list") return WORKSPACE_MEMBERS;
      const k4 = args.slice(0, 4).join(" ");
      if (k4 === "squad member list sq_SRC1") return SQUAD_MEMBERS;
      throw new Error("unexpected " + args.join(" "));
    },
    run: () => "",
  };
}

test("export --scope autopilot writes autopilot record and manifest with agent assignee bundled", () => {
  const fs = memFs();
  const cli = autopilotCli();
  const { manifest, autopilotWebhookTriggers } = exportResource({ cli, scope: "autopilot", ids: { autopilotId: "ap_SRC1" }, outDir: "/out", sourceWorkspaceId: "ws_SRC", fs });

  const rec = JSON.parse(fs.files["/out/autopilots/nightly-scan.json"]);
  assert.equal(rec.title, "Nightly Scan");
  assert.equal(rec.execution_mode, "run_only");
  assert.equal(rec.issue_title_template, "[Scan] {{.Date}}");
  assert.equal(rec.description, "scan deps nightly");
  assert.equal(rec.assignee_type, "agent");
  assert.equal(rec.assignee_name, "Helper");

  const entry = manifest.autopilots.find((a) => a.title === "Nightly Scan");
  assert.equal(entry.file, "autopilots/nightly-scan.json");
  assert.equal(entry.assignee_type, "agent");
  assert.equal(entry.assignee_name, "Helper");
  assert.equal(entry.had_webhook_trigger, true);

  assert.ok(manifest.agents.some((a) => a.name === "Helper"), "agent assignee bundled");
});

test("export autopilot redacts webhook URL from every exported file and flags it", () => {
  const fs = memFs();
  const cli = autopilotCli();
  const { autopilotWebhookTriggers } = exportResource({ cli, scope: "autopilot", ids: { autopilotId: "ap_SRC1" }, outDir: "/out", sourceWorkspaceId: "ws_SRC", fs });

  const rec = JSON.parse(fs.files["/out/autopilots/nightly-scan.json"]);
  const webhookTrigger = rec.triggers.find((t) => t.kind === "webhook");
  assert.ok(webhookTrigger, "webhook trigger recorded by kind and label");
  assert.equal(webhookTrigger.label, "ci");
  assert.equal(webhookTrigger.enabled, true);
  assert.ok(!("url" in webhookTrigger), "webhook URL never written");
  assert.ok(!("token" in webhookTrigger), "webhook token never written");
  assert.ok(!("secret" in webhookTrigger), "webhook secret never written");

  const manifestBlob = fs.files["/out/manifest.json"];
  assert.ok(!manifestBlob.includes("webhook-url"), "no webhook url in manifest");

  assert.deepEqual(autopilotWebhookTriggers, ["Nightly Scan"]);
});

test("export autopilot captures schedule trigger with cron and timezone", () => {
  const fs = memFs();
  const cli = autopilotCli();
  exportResource({ cli, scope: "autopilot", ids: { autopilotId: "ap_SRC1" }, outDir: "/out", sourceWorkspaceId: "ws_SRC", fs });

  const rec = JSON.parse(fs.files["/out/autopilots/nightly-scan.json"]);
  const schedule = rec.triggers.find((t) => t.kind === "schedule");
  assert.equal(schedule.cron_expression, "0 9 * * *");
  assert.equal(schedule.timezone, "UTC");
  assert.equal(schedule.label, "nightly");
  assert.equal(schedule.enabled, true);
});

test("export autopilot captures non-webhook trigger (schedule with cron)", () => {
  const fs = memFs();
  const cli = autopilotCli();
  exportResource({ cli, scope: "autopilot", ids: { autopilotId: "ap_SRC1" }, outDir: "/out", sourceWorkspaceId: "ws_SRC", fs });

  const rec = JSON.parse(fs.files["/out/autopilots/nightly-scan.json"]);
  const nonWebhooks = rec.triggers.filter((t) => t.kind !== "webhook");
  // ponytail: export maps non-webhook triggers as schedule — manual triggers lose their kind.
  // Defect: the ternary in exportResource collectOneAutopilot hardcodes kind:"schedule" for all non-webhook triggers.
  assert.ok(nonWebhooks.length >= 2, "schedule and manual triggers both captured (though manual mapped to schedule)");
  const schedule = nonWebhooks.find((t) => /0 9/.test(t.cron_expression));
  assert.ok(schedule, "schedule trigger captured");
  assert.equal(schedule.cron_expression, "0 9 * * *");
  assert.equal(schedule.timezone, "UTC");
});

test("export autopilot captures project by title", () => {
  const fs = memFs();
  const cli = autopilotCli();
  exportResource({ cli, scope: "autopilot", ids: { autopilotId: "ap_SRC1" }, outDir: "/out", sourceWorkspaceId: "ws_SRC", fs });

  const rec = JSON.parse(fs.files["/out/autopilots/nightly-scan.json"]);
  assert.equal(rec.project_title, "Launch");
});

test("export autopilot captures subscriber names from workspace members", () => {
  const fs = memFs();
  const cli = autopilotCli();
  exportResource({ cli, scope: "autopilot", ids: { autopilotId: "ap_SRC1" }, outDir: "/out", sourceWorkspaceId: "ws_SRC", fs });

  const rec = JSON.parse(fs.files["/out/autopilots/nightly-scan.json"]);
  assert.deepEqual(rec.subscriber_names, ["Alice"]);
});

test("export autopilot tolerates an unresolvable project (catches the getProject call failure)", () => {
  const fs = memFs();
  const cli = {
    ...autopilotCli(),
    json: (args) => {
      const k3 = args.slice(0, 3).join(" ");
      if (k3 === "project get pr_SRC1") throw new Error("project not found");
      return autopilotCli().json(args);
    },
  };
  exportResource({ cli, scope: "autopilot", ids: { autopilotId: "ap_SRC1" }, outDir: "/out", sourceWorkspaceId: "ws_SRC", fs });
  const rec = JSON.parse(fs.files["/out/autopilots/nightly-scan.json"]);
  assert.equal(rec.project_title, null, "project_title null when getProject throws");
});

test("export autopilot with squad assignee bundles squad, members, and skills", () => {
  const fs = memFs();
  const cli = autopilotCli();
  const { manifest } = exportResource({ cli, scope: "autopilot", ids: { autopilotId: "ap_SRC2" }, outDir: "/out", sourceWorkspaceId: "ws_SRC", fs });

  const rec = JSON.parse(fs.files["/out/autopilots/squad-pilot.json"]);
  assert.equal(rec.assignee_type, "squad");
  assert.equal(rec.assignee_name, "Team");
  assert.equal(rec.triggers.length, 1);

  assert.ok(fs.files["/out/squads/team.json"], "squad file written");
  assert.ok(fs.files["/out/agents/helper.json"], "leader agent written");
  assert.ok(fs.files["/out/agents/helper2.json"], "member agent written");
  assert.equal(manifest.agents.length, 2, "both squad members captured");
  assert.equal(manifest.squads.length, 1);
});

test("export autopilot with an empty-triggers autopilot still writes the record", () => {
  const fs = memFs();
  const cli = autopilotCli();
  exportResource({ cli, scope: "autopilot", ids: { autopilotId: "ap_SRC3" }, outDir: "/out", sourceWorkspaceId: "ws_SRC", fs });

  const rec = JSON.parse(fs.files["/out/autopilots/minimal.json"]);
  assert.equal(rec.title, "Minimal");
  assert.deepEqual(rec.triggers, []);
  assert.deepEqual(rec.subscriber_names, []);
});

test("buildManifest autopilots section carries assignee and had_webhook_trigger", () => {
  const m = buildManifest({
    scope: "autopilot", sourceWorkspaceId: "ws_SRC",
    skills: [], agents: [],
    autopilots: [
      { title: "Nightly Scan", source_id: "ap_SRC1", assignee_type: "agent", assignee_name: "Helper", project_title: "Launch", had_webhook_trigger: true },
      { title: "Release", source_id: "ap_SRC2", assignee_type: "squad", assignee_name: "Releasers", project_title: null, had_webhook_trigger: false },
    ],
  });
  assert.equal(m.autopilots.length, 2);
  const ns = m.autopilots.find((a) => a.title === "Nightly Scan");
  assert.equal(ns.file, "autopilots/nightly-scan.json");
  assert.equal(ns.assignee_type, "agent");
  assert.equal(ns.assignee_name, "Helper");
  assert.equal(ns.project_title, "Launch");
  assert.equal(ns.had_webhook_trigger, true);
  const rel = m.autopilots.find((a) => a.title === "Release");
  assert.equal(rel.had_webhook_trigger, false);
});

// ---------------------------------------------------------------------------
// Import tests
// ---------------------------------------------------------------------------

function importFs(files) {
  return {
    existsSync: (p) => p in files,
    readFileSync: (p) => files[p],
    readdirSync: (p, opts) => {
      const seen = new Map();
      for (const f of Object.keys(files)) {
        if (!f.startsWith(p + "/")) continue;
        const rest = f.slice(p.length + 1);
        const slash = rest.indexOf("/");
        const name = slash === -1 ? rest : rest.slice(0, slash);
        if (!seen.has(name)) seen.set(name, slash !== -1);
      }
      const entries = [...seen.entries()];
      return opts?.withFileTypes
        ? entries.map(([name, isDir]) => ({ name, isDirectory: () => isDir }))
        : entries.map(([name]) => name);
    },
  };
}

function fullImportFs() {
  return importFs({
    "./manifest.json": JSON.stringify({
      version: "1", scope: "autopilot", source_workspace_id: "ws_SRC",
      skills: [],
      agents: [{ name: "Helper", file: "agents/helper.json", source_id: "ag_SRC1", source_runtime_id: "rt_SRC1", source_runtime_provider: "claude", skill_names: [], had_secrets: false }],
      autopilots: [
        { title: "Nightly Scan", file: "autopilots/nightly-scan.json", source_id: "ap_SRC1", assignee_type: "agent", assignee_name: "Helper", project_title: "Launch", had_webhook_trigger: true },
      ],
    }),
    "./agents/helper.json": JSON.stringify({ name: "Helper", model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6, source_id: "ag_SRC1", source_runtime_id: "rt_SRC1", skill_names: [] }),
    "./autopilots/nightly-scan.json": JSON.stringify({
      title: "Nightly Scan", description: "scan deps nightly", execution_mode: "run_only",
      issue_title_template: "[Scan] {{.Date}}", priority: null, project_title: "Launch",
      assignee_name: "Helper", assignee_type: "agent",
      subscriber_names: ["Alice"],
      had_webhook_trigger: true,
      triggers: [
        { kind: "schedule", label: "nightly", enabled: true, cron_expression: "0 9 * * *", timezone: "UTC" },
        { kind: "webhook", label: "ci", enabled: true },
      ],
    }),
  });
}

test("parseInclude defaults to agents+squads, autopilots opt-in", () => {
  assert.deepEqual([...parseInclude(null)].sort(), ["agents", "skills", "squads"]);
  assert.deepEqual([...parseInclude("autopilots")].sort(), ["autopilots"]);
  assert.deepEqual([...parseInclude("agents,autopilots")].sort(), ["agents", "autopilots", "skills"]);
});

// Helper: build a minimal import manifest + record pair with a `./`-prefixed key
// so the code's `${dir}/${entry.file}` resolves (dir "." → "./<key>").
function apImportCase({ title = "S", file = "s.json", recordOverrides = {}, assignee_name = "Helper", triggers = [] } = {}) {
  const record = JSON.stringify({ title, execution_mode: "create_issue", assignee_name, assignee_type: "agent", subscriber_names: [], project_title: null, triggers, ...recordOverrides });
  const key = `./${file}`;
  return {
    manifest: { autopilots: [{ title, file }] },
    file: { [key]: record },
  };
}

test("importAutopilots creates autopilot paused and sets agent assignee", () => {
  const cli = {
    json: (args) => {
      if (args[0] === "autopilot" && args[1] === "list") return { autopilots: [] };
      if (args[0] === "agent" && args[1] === "list") return [{ name: "Helper" }];
      if (args[0] === "project" && args[1] === "list") return [{ title: "Launch", id: "pr_TGT1" }];
      if (args[0] === "workspace" && args[1] === "member" && args[2] === "list") return [{ name: "Alice" }];
      return {};
    },
    run: (args) => args.includes("create") ? '{"id":"ap_NEW1"}' : "{}",
  };

  const { manifest, file } = apImportCase({
    title: "Nightly Scan", file: "ns.json",
    recordOverrides: { execution_mode: "run_only", description: "scan nightly", issue_title_template: "x", subscriber_names: ["Alice"], project_title: "Launch" },
    triggers: [{ kind: "schedule", label: "nightly", enabled: true, cron_expression: "0 9 * * *", timezone: "UTC" }],
  });
  const fs = importFs(file);

  const res = importAutopilots({ cli, manifest, dir: ".", agentIdMap: new Map([["Helper", "ag_NEW1"]]), fs });
  assert.equal(res.created, 1);
  assert.equal(res.updated, 0);
  assert.equal(res.idMap.get("Nightly Scan"), "ap_NEW1");
  assert.deepEqual(res.webhookReissued, []);
});

test("importAutopilots always creates autopilot and immediately pauses it", () => {
  const calls = [];
  const cli = {
    json: (args) => {
      if (args[0] === "autopilot" && args[1] === "list") return { autopilots: [] };
      if (args[0] === "agent" && args[1] === "list") return [{ name: "Helper" }];
      if (args[0] === "project" && args[1] === "list") return [];
      if (args[0] === "workspace" && args[1] === "member" && args[2] === "list") return [];
      return {};
    },
    run: (args) => { calls.push(args); return args.includes("create") ? '{"id":"ap_NEW1"}' : "{}"; },
  };

  const { manifest, file } = apImportCase();
  const fs = importFs(file);

  const res = importAutopilots({ cli, manifest, dir: ".", agentIdMap: new Map([["Helper", "ag_NEW1"]]), fs });
  assert.equal(res.created, 1);

  const pauseCall = calls.find((a) => a[0] === "autopilot" && a[1] === "update" && a.includes("--status") && a.includes("paused"));
  assert.ok(pauseCall, "autopilot is paused after creation");
  assert.equal(pauseCall[2], "ap_NEW1");
  assert.equal(pauseCall[pauseCall.indexOf("--status") + 1], "paused");
});

test("importAutopilots upserts by title — updates existing, never duplicates", () => {
  const calls = [];
  const cli = {
    json: (args) => {
      if (args[0] === "autopilot" && args[1] === "list") return { autopilots: [{ id: "ap_EXIST", title: "Nightly Scan" }] };
      if (args[0] === "autopilot" && args[1] === "get" && args[2] === "ap_EXIST") return { autopilot: { title: "Nightly Scan" }, triggers: [] };
      if (args[0] === "agent" && args[1] === "list") return [{ name: "Helper" }];
      if (args[0] === "project" && args[1] === "list") return [];
      if (args[0] === "workspace" && args[1] === "member" && args[2] === "list") return [];
      return {};
    },
    run: (args) => { calls.push(args); return "{}"; },
  };

  const { manifest, file } = apImportCase({ title: "Nightly Scan", file: "ns.json" });
  const fs = importFs(file);

  const res = importAutopilots({ cli, manifest, dir: ".", agentIdMap: new Map([["Helper", "ag_NEW1"]]), fs });
  assert.equal(res.created, 0);
  assert.equal(res.updated, 1);
  assert.equal(res.idMap.get("Nightly Scan"), "ap_EXIST");

  assert.ok(!calls.some((a) => a[1] === "create"), "no create call on re-import");
  assert.ok(calls.some((a) => a[1] === "update" && a[2] === "ap_EXIST"), "update called on existing autopilot");
});

test("importAutopilots resolves project by title in destination, skips-with-warn when absent", () => {
  const cli = {
    json: (args) => {
      if (args[0] === "autopilot" && args[1] === "list") return { autopilots: [] };
      if (args[0] === "agent" && args[1] === "list") return [{ name: "Helper" }];
      if (args[0] === "project" && args[1] === "list") return [{ title: "Other", id: "pr_OTHER" }];
      if (args[0] === "workspace" && args[1] === "member" && args[2] === "list") return [];
      return {};
    },
    run: (args) => args.includes("create") ? '{"id":"ap_NEW"}' : "{}",
  };

  const { manifest, file } = apImportCase({ recordOverrides: { project_title: "Missing" } });
  const fs = importFs(file);

  const res = importAutopilots({ cli, manifest, dir: ".", agentIdMap: new Map([["Helper", "ag_NEW1"]]), fs });
  assert.deepEqual(res.projectUnresolved, ["S"]);
});

test("importAutopilots resolves subscribers by name in destination, skips-and-warns unresolvable", () => {
  const cli = {
    json: (args) => {
      if (args[0] === "autopilot" && args[1] === "list") return { autopilots: [] };
      if (args[0] === "agent" && args[1] === "list") return [{ name: "Helper" }];
      if (args[0] === "project" && args[1] === "list") return [];
      if (args[0] === "workspace" && args[1] === "member" && args[2] === "list") return [{ name: "Alice" }];
      return {};
    },
    run: (args) => args.includes("create") ? '{"id":"ap_NEW"}' : "{}",
  };

  const { manifest, file } = apImportCase({ recordOverrides: { subscriber_names: ["Alice", "Ghost"] } });
  const fs = importFs(file);

  const res = importAutopilots({ cli, manifest, dir: ".", agentIdMap: new Map([["Helper", "ag_NEW1"]]), fs });
  assert.deepEqual(res.subscribersUnresolved, ["S:Ghost"]);
});

test("importAutopilots reissues webhook trigger fresh (does not copy old url)", () => {
  const calls = [];
  const cli = {
    json: (args) => {
      if (args[0] === "autopilot" && args[1] === "list") return { autopilots: [] };
      if (args[0] === "agent" && args[1] === "list") return [{ name: "Helper" }];
      if (args[0] === "project" && args[1] === "list") return [];
      if (args[0] === "workspace" && args[1] === "member" && args[2] === "list") return [];
      return {};
    },
    run: (args) => { calls.push(args); return args.includes("create") ? '{"id":"ap_NEW1"}' : "{}"; },
  };

  const { manifest, file } = apImportCase({
    title: "Release", file: "r.json",
    triggers: [{ kind: "webhook", label: "ci", enabled: true }],
  });
  const fs = importFs(file);

  const res = importAutopilots({ cli, manifest, dir: ".", agentIdMap: new Map([["Helper", "ag_NEW1"]]), fs });
  assert.deepEqual(res.webhookReissued, ["Release"]);

  const triggerAdd = calls.find((a) => a[0] === "autopilot" && a[1] === "trigger-add");
  assert.ok(triggerAdd, "trigger-add called for webhook trigger");
  assert.ok(triggerAdd.includes("--kind"));
  assert.equal(triggerAdd[triggerAdd.indexOf("--kind") + 1], "webhook");
});

test("importAutopilots restores schedule trigger with cron and timezone", () => {
  const calls = [];
  const cli = {
    json: (args) => {
      if (args[0] === "autopilot" && args[1] === "list") return { autopilots: [] };
      if (args[0] === "agent" && args[1] === "list") return [{ name: "Helper" }];
      if (args[0] === "project" && args[1] === "list") return [];
      if (args[0] === "workspace" && args[1] === "member" && args[2] === "list") return [];
      return {};
    },
    run: (args) => { calls.push(args); return args.includes("create") ? '{"id":"ap_NEW1"}' : "{}"; },
  };

  const { manifest, file } = apImportCase({
    triggers: [{ kind: "schedule", label: "daily", enabled: true, cron_expression: "0 8 * * *", timezone: "Asia/Saigon" }],
  });
  const fs = importFs(file);

  importAutopilots({ cli, manifest, dir: ".", agentIdMap: new Map([["Helper", "ag_NEW1"]]), fs });

  const triggerAdd = calls.find((a) => a[0] === "autopilot" && a[1] === "trigger-add");
  assert.equal(triggerAdd[triggerAdd.indexOf("--kind") + 1], "schedule");
  assert.equal(triggerAdd[triggerAdd.indexOf("--cron") + 1], "0 8 * * *");
  assert.equal(triggerAdd[triggerAdd.indexOf("--timezone") + 1], "Asia/Saigon");
});

test("importAutopilots is trigger-idempotent — skips trigger already present on re-import", () => {
  const cli = {
    json: (args) => {
      if (args[0] === "autopilot" && args[1] === "list") return { autopilots: [{ id: "ap_EXIST", title: "S" }] };
      if (args[0] === "autopilot" && args[1] === "get" && args[2] === "ap_EXIST") return {
        autopilot: { title: "S" },
        triggers: [{ kind: "schedule", label: "daily", enabled: true }],
      };
      if (args[0] === "agent" && args[1] === "list") return [{ name: "Helper" }];
      if (args[0] === "project" && args[1] === "list") return [];
      if (args[0] === "workspace" && args[1] === "member" && args[2] === "list") return [];
      return {};
    },
    run: (args) => "{}",
  };

  const { manifest, file } = apImportCase({
    triggers: [{ kind: "schedule", label: "daily", enabled: true, cron_expression: "0 8 * * *", timezone: null }],
  });
  const fs = importFs(file);

  const res = importAutopilots({ cli, manifest, dir: ".", agentIdMap: new Map([["Helper", "ag_NEW1"]]), fs });
  assert.equal(res.updated, 1);
});

test("importAutopilots throws on unresolvable agent assignee", () => {
  const cli = {
    json: (args) => {
      if (args[0] === "agent" && args[1] === "list") return [];
      return {};
    },
    run: () => "{}",
  };

  const { manifest, file } = apImportCase({ title: "Ghost Pilot", file: "gp.json", assignee_name: "Ghost" });
  const fs = importFs(file);

  assert.throws(
    () => importAutopilots({ cli, manifest, dir: ".", agentIdMap: new Map(), fs }),
    /Unresolved autopilot assignees/i,
  );
});

test("importAutopilots throws on squad assignee (not settable via multica CLI)", () => {
  const cli = {
    json: (args) => (args[0] === "agent" && args[1] === "list" ? [] : {}),
    run: () => "{}",
  };

  const { manifest, file } = apImportCase({ title: "Squad Pilot", file: "sp.json", assignee_name: "Team", recordOverrides: { assignee_type: "squad" } });
  const fs = importFs(file);

  assert.throws(
    () => importAutopilots({ cli, manifest, dir: ".", agentIdMap: new Map(), fs }),
    /Unresolved autopilot assignees/i,
  );
});

test("importBundle with autopilots creates autopilot alongside agents", () => {
  const fs = fullImportFs();
  const calls = [];
  const cli = {
    json: (args) => {
      if (args[0] === "runtime" && args[1] === "list") return [{ id: "rt_TGT1", provider: "claude" }];
      if (args[0] === "autopilot" && args[1] === "list") return { autopilots: [] };
      if (args[0] === "agent" && args[1] === "list") return [];
      if (args[0] === "skill" && args[1] === "list") return [];
      if (args[0] === "project" && args[1] === "list") return [{ title: "Launch", id: "pr_TGT1" }];
      if (args[0] === "workspace" && args[1] === "member" && args[2] === "list") return [{ name: "Alice" }];
      return {};
    },
    run: (args) => {
      calls.push(args);
      if (args[0] === "autopilot" && args[1] === "create") return '{"id":"ap_NEW1"}';
      if (args[0] === "agent" && args[1] === "create") return '{"id":"ag_NEW1"}';
      return "{}";
    },
  };

  const res = importBundle({ cli, dir: ".", runtimeMap: new Map(), include: new Set(["agents", "autopilots"]), fs });
  assert.equal(res.created.agents, 1);
  assert.equal(res.created.autopilots, 1);

  const create = calls.find((a) => a[0] === "autopilot" && a[1] === "create");
  assert.equal(create[create.indexOf("--agent") + 1], "Helper");
  assert.equal(create[create.indexOf("--mode") + 1], "run_only");

  const pause = calls.find((a) => a[0] === "autopilot" && a[1] === "update" && a.includes("--status"));
  assert.equal(pause[pause.indexOf("--status") + 1], "paused");

  assert.deepEqual(res.autopilotWebhookReissued, ["Nightly Scan"]);
});

test("preflight reports autopilot counts and incompatibilities", () => {
  const fs = importFs({
    "./manifest.json": JSON.stringify({
      version: "1", scope: "all", source_workspace_id: "ws_SRC",
      skills: [], agents: [], squads: [],
      autopilots: [
        { title: "A", file: "a.json", assignee_type: "agent", assignee_name: "Missing", had_webhook_trigger: false },
        { title: "B", file: "b.json", assignee_type: "squad", assignee_name: "X", had_webhook_trigger: false },
        { title: "C", file: "c.json", assignee_type: "agent", assignee_name: "Helper", had_webhook_trigger: true },
      ],
    }),
    "./a.json": JSON.stringify({ title: "A", assignee_name: "Missing", assignee_type: "agent", project_title: null, triggers: [], subscriber_names: [] }),
    "./b.json": JSON.stringify({ title: "B", assignee_name: "X", assignee_type: "squad", project_title: null, triggers: [], subscriber_names: [] }),
    "./c.json": JSON.stringify({ title: "C", assignee_name: "Helper", assignee_type: "agent", project_title: "Nope", had_webhook_trigger: true, triggers: [], subscriber_names: [] }),
  });
  const cli = {
    json: (args) => {
      if (args[0] === "agent" && args[1] === "list") return [{ name: "Helper" }];
      if (args[0] === "project" && args[1] === "list") return [];
      return {};
    },
    run: () => "{}",
  };

  const rep = preflight({ cli, dir: ".", runtimeMap: new Map(), include: new Set(["autopilots"]), fs });
  assert.deepEqual(rep.bundle, { skills: 0, agents: 0, squads: 0, projects: 0, autopilots: 3 });
  assert.ok(rep.incompatibilities.some((i) => i.type === "autopilot-assignee-missing" && i.detail.includes("A")));
  assert.ok(rep.incompatibilities.some((i) => i.type === "autopilot-squad-assignee-unsupported" && i.detail.includes("B")));
  assert.ok(rep.incompatibilities.some((i) => i.type === "autopilot-priority-not-captured" && i.detail.includes("A")));
  assert.ok(rep.incompatibilities.some((i) => i.type === "autopilot-webhook-reissued" && i.detail.includes("C")));
  assert.ok(rep.incompatibilities.some((i) => i.type === "autopilot-project-missing" && i.detail.includes("C")));
});

// ---------------------------------------------------------------------------
// Sync tests
// ---------------------------------------------------------------------------

test("resolveScopeId resolves autopilot by title", () => {
  const cli = { json: (args) => {
    if (args[0] === "autopilot" && args[1] === "list") return { autopilots: [{ id: "ap_SRC1", title: "Nightly Scan" }] };
    return [];
  }};
  const r = resolveScopeId(cli, "autopilot", "Nightly Scan");
  assert.deepEqual(r, { scope: "autopilot", ids: { autopilotId: "ap_SRC1" } });
});

test("resolveScopeId throws on unknown autopilot title", () => {
  const cli = { json: () => ({ autopilots: [] }) };
  assert.throws(() => resolveScopeId(cli, "autopilot", "Nope"), /Unknown autopilot/);
});

test("sync autopilot exports from source, imports into dest", () => {
  const argvs = [];
  const exec = (args) => {
    argvs.push(args);
    const j = args.join(" ");
    if (j.startsWith("workspace list")) return { stdout: JSON.stringify([{ id: "ws_SRC", name: "Source" }, { id: "ws_DST", name: "Dest" }]), stderr: "", status: 0 };
    if (j.startsWith("autopilot list")) {
      if (j.includes("ws_SRC")) return { stdout: JSON.stringify({ autopilots: [{ id: "ap_SRC1", title: "Scan" }] }), stderr: "", status: 0 };
      return { stdout: JSON.stringify({ autopilots: [] }), stderr: "", status: 0 };
    }
    if (j.startsWith("autopilot get"))
      return { stdout: JSON.stringify({ autopilot: { id: "ap_SRC1", title: "Scan", description: "", execution_mode: "run_only", issue_title_template: null, priority: null, project_id: null, assignee_id: "ag_SRC1", assignee_type: "agent", subscribers: [] }, triggers: [] }), stderr: "", status: 0 };
    if (j.startsWith("agent list")) return { stdout: j.includes("ws_SRC") ? JSON.stringify([{ id: "ag_SRC1" }]) : "[]", stderr: "", status: 0 };
    if (j.startsWith("agent get")) return { stdout: JSON.stringify({ id: "ag_SRC1", name: "Helper", description: "", instructions: "", model: "claude-sonnet-4-6", visibility: "workspace", max_concurrent_tasks: 6, runtime_config: {}, custom_args: [], thinking_level: "", runtime_id: "rt_SRC1", has_custom_env: false, custom_env_key_count: 0, mcp_config: {}, mcp_config_redacted: false, skills: [], service_tier: "", permission_mode: "workspace", invocation_targets: [] }), stderr: "", status: 0 };
    if (j.startsWith("runtime list")) return { stdout: j.includes("ws_SRC") ? JSON.stringify([{ id: "rt_SRC1", provider: "claude" }]) : JSON.stringify([{ id: "rt_TGT1", provider: "claude" }]), stderr: "", status: 0 };
    if (j.startsWith("autopilot create")) return { stdout: '{"id":"ap_DST1"}', stderr: "", status: 0 };
    if (j.startsWith("agent create")) return { stdout: '{"id":"ag_DST1"}', stderr: "", status: 0 };
    if (j.startsWith("project list")) return { stdout: "[]", stderr: "", status: 0 };
    if (j.startsWith("workspace member list")) return { stdout: "[]", stderr: "", status: 0 };
    return { stdout: "{}", stderr: "", status: 0 };
  };

  const tmp = "/tmp/multica-sync-test-auto";
  const report = sync({ exec, type: "autopilot", name: "Scan", srcWsName: "Source", destWsName: "Dest", tmpDir: tmp, runtimeMap: new Map() });
  assert.equal(report.created.autopilots, 1);

  const getCall = argvs.find((a) => a[0] === "autopilot" && a[1] === "get");
  assert.equal(getCall[getCall.indexOf("--workspace-id") + 1], "ws_SRC", "export read used source ws");
  const createCall = argvs.find((a) => a[0] === "autopilot" && a[1] === "create");
  assert.equal(createCall[createCall.indexOf("--workspace-id") + 1], "ws_DST", "import write used dest ws");
});