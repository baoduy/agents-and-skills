import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { makeCli, resolveWorkspaceId, findByName, listSkills, listAgents, listSquads, realExec, requireAuth } from "./lib.mjs";
import { exportResource } from "./multica-export.mjs";
import { importBundle } from "./multica-import.mjs";

export function resolveScopeId(cli, type, name) {
  const lists = { skill: listSkills, agent: listAgents, squad: listSquads };
  if (!lists[type]) throw new Error(`Unknown type "${type}" (skill|agent|squad)`);
  const match = findByName(lists[type](cli), name);
  if (!match) throw new Error(`Unknown ${type} "${name}" in source workspace`);
  const key = { skill: "skillId", agent: "agentId", squad: "squadId" }[type];
  return { scope: type, ids: { [key]: match.id } };
}

export function sync({ exec, type, name, srcWsName, destWsName, tmpDir, runtimeMap, fs = nodeFs }) {
  const resolver = makeCli(exec);                       // no ws — for workspace list
  const srcId = resolveWorkspaceId(resolver, srcWsName);
  const destId = resolveWorkspaceId(resolver, destWsName);
  const srcCli = makeCli(exec, { workspaceId: srcId });
  const destCli = makeCli(exec, { workspaceId: destId });

  const { scope, ids } = resolveScopeId(srcCli, type, name);
  exportResource({ cli: srcCli, scope, ids, outDir: tmpDir, sourceWorkspaceId: srcId, fs });
  return importBundle({ cli: destCli, dir: tmpDir, runtimeMap, fs });
}

function parseRuntimeMap(raw) {
  const map = new Map();
  if (!raw) return map;
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return map;
}

function main() {
  // Usage: multica-sync.mjs <type> <name> from <src-ws> <dest-ws> [--runtime-map <src=dst,...>]
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

  // Positional: type name from srcWs destWs
  const [type, name, _from, srcWsName, destWsName] = args;
  const rawMap = get("--runtime-map");

  if (!type || !name || _from !== "from" || !srcWsName || !destWsName) {
    console.error("Usage: multica-sync.mjs <type> <name> from <src-ws> <dest-ws> [--runtime-map <src=dst,...>]");
    process.exit(1);
  }

  requireAuth(realExec);
  const runtimeMap = parseRuntimeMap(rawMap);
  const tmpDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "multica-sync-"));

  try {
    const result = sync({ exec: realExec, type, name, srcWsName, destWsName, tmpDir, runtimeMap, fs: nodeFs });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    nodeFs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
