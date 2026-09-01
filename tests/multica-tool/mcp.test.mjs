// Import side of the MCP roster: a workspace MCP server travels as name +
// transport only (its entry JSON is write-only in the CLI), so import restores
// per-agent ASSIGNMENTS by name and reports any server it cannot recreate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { importAgents, mcpServerGap, readTaxonomy } from "../../plugins/multica-tool/scripts/multica-import.mjs";

const MANIFEST = {
  version: "1", scope: "workspace", level: "agent",
  skills: [],
  agents: [{ name: "Helper", file: "agents/helper.json", source_runtime_id: "rt_SRC1", skill_names: [] }],
  squads: [],
  mcp_servers_file: "mcp/servers.json",
};

const AGENT_FILE = (mcpServers) => JSON.stringify({
  name: "Helper", source_runtime_id: "rt_SRC1", skill_names: [],
  visibility: "private", max_concurrent_tasks: 6, avatar_url: null,
  mcp_config: null, custom_env: null, mcp_servers: mcpServers,
});

function fakeFs(files) {
  return {
    files,
    existsSync: (p) => p in files,
    readFileSync: (p) => { if (!(p in files)) throw new Error(`ENOENT ${p}`); return files[p]; },
    mkdirSync: () => {}, writeFileSync: () => {},
  };
}

// destLibrary: the destination's `workspace mcp list` result.
function destCli({ destLibrary = [], failEnableFor = null } = {}) {
  const calls = [];
  return {
    calls,
    json: (args) => {
      const key = args.join(" ");
      if (key === "agent list --include-archived") return [];
      if (key === "workspace member list") return [];
      if (args[0] === "workspace" && args[1] === "mcp") return destLibrary;
      throw new Error("unexpected " + key);
    },
    run: (args) => {
      calls.push(args);
      if (failEnableFor && args[2] === "enable" && args[4] === failEnableFor) throw new Error("rejected");
      if (args[0] === "agent" && args[1] === "create") return '{"id":"ag_DST1"}';
      return "{}";
    },
  };
}

const DEST_LIBRARY = [
  { id: "mcp_DST1", name: "shortcut", transport: "stdio" },
  { id: "mcp_DST2", name: "sentry", transport: "http" },
];

test("agent MCP assignments are re-linked by NAME to the destination's server ids", () => {
  const cli = destCli({ destLibrary: DEST_LIBRARY });
  const fs = fakeFs({ "/b/agents/helper.json": AGENT_FILE([{ name: "shortcut", enabled: true }, { name: "sentry", enabled: false }]) });
  const r = importAgents({ cli, manifest: MANIFEST, dir: "/b", skillIdMap: new Map(), runtimeMap: new Map([["rt_SRC1", "rt_DST1"]]), fs });

  const mcpCalls = cli.calls.filter((a) => a[0] === "agent" && a[1] === "mcp");
  // Why: the source server id is meaningless at the destination — a wrong id
  // would silently attach the wrong server, so the name is the only safe key.
  assert.deepEqual(mcpCalls, [
    ["agent", "mcp", "add", "ag_DST1", "mcp_DST1"],
    ["agent", "mcp", "enable", "ag_DST1", "mcp_DST1"],
    ["agent", "mcp", "add", "ag_DST1", "mcp_DST2"],
    ["agent", "mcp", "disable", "ag_DST1", "mcp_DST2"],
  ]);
  assert.deepEqual(r.mcpServersUnresolved, []);
  assert.deepEqual(r.mcpServersApplyFailures, []);
});

test("a bundled MCP server missing from the destination library is reported, not created", () => {
  const cli = destCli({ destLibrary: [DEST_LIBRARY[0]] });
  const fs = fakeFs({ "/b/agents/helper.json": AGENT_FILE([{ name: "shortcut", enabled: true }, { name: "sentry", enabled: true }]) });
  const r = importAgents({ cli, manifest: MANIFEST, dir: "/b", skillIdMap: new Map(), runtimeMap: new Map([["rt_SRC1", "rt_DST1"]]), fs });

  assert.deepEqual(r.mcpServersUnresolved, ["Helper:sentry"]);
  assert.ok(!cli.calls.some((a) => a[0] === "workspace" && a[1] === "mcp"),
    "never invents a server — the bundle has no config to create one from");
});

test("a rejected enable/disable is reported without aborting the agent import", () => {
  const cli = destCli({ destLibrary: DEST_LIBRARY, failEnableFor: "mcp_DST1" });
  const fs = fakeFs({ "/b/agents/helper.json": AGENT_FILE([{ name: "shortcut", enabled: true }]) });
  const r = importAgents({ cli, manifest: MANIFEST, dir: "/b", skillIdMap: new Map(), runtimeMap: new Map([["rt_SRC1", "rt_DST1"]]), fs });
  assert.deepEqual(r.mcpServersApplyFailures, ["Helper:shortcut"]);
  assert.equal(r.created, 1, "the agent itself still landed");
});

test("mcpServerGap names the bundle's servers the destination library lacks", () => {
  const fs = fakeFs({ "/b/mcp/servers.json": JSON.stringify([{ name: "shortcut", transport: "stdio" }, { name: "sentry", transport: "http" }]) });
  const cli = destCli({ destLibrary: [DEST_LIBRARY[0]] });
  assert.deepEqual(mcpServerGap({ cli, manifest: MANIFEST, dir: "/b", fs }), ["sentry"]);
});

test("readTaxonomy prefers the folder file and falls back to a legacy inline array", () => {
  const fs = fakeFs({ "/b/labels/labels.json": JSON.stringify([{ name: "Bug", color: "#ef4444" }]) });
  const pointed = { labels_file: "labels/labels.json", labels: [{ name: "Stale", color: "#000000" }] };
  assert.deepEqual(readTaxonomy(fs, "/b", pointed, "labels"), [{ name: "Bug", color: "#ef4444" }],
    "the folder file wins — the manifest key is only a pointer now");
  const legacy = { labels: [{ name: "Stale", color: "#000000" }] };
  assert.deepEqual(readTaxonomy(fs, "/b", legacy, "labels"), [{ name: "Stale", color: "#000000" }],
    "a pre-folder bundle still imports");
});
