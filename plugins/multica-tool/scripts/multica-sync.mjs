import * as nodeFs from "node:fs";
import { makeCli, resolveWorkspaceId, findByName, listSkills, listAgents, listSquads } from "./lib.mjs";
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
