import * as nodeFs from "node:fs";
import { listSkills, listAgents, listSquads, findByName } from "./lib.mjs";

export function importSkills({ cli, manifest, dir, fs = nodeFs }) {
  const idMap = new Map();
  let created = 0, updated = 0;
  const existing = listSkills(cli);

  for (const s of manifest.skills) {
    const sdir = dir === "." ? s.dir : `${dir}/${s.dir}`;
    const contentPath = `${sdir}/SKILL.md`;
    const configPath = `${sdir}/config.json`;
    const config = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "{}";
    const match = findByName(existing, s.name);
    let id;
    if (match) {
      cli.run(["skill", "update", match.id, "--content-file", contentPath, "--config", config]);
      id = match.id; updated++;
    } else {
      const out = cli.run(["skill", "create", "--name", s.name, "--content-file", contentPath, "--config", config]);
      id = JSON.parse(out).id; created++;
    }
    idMap.set(s.name, id);
    // upsert extra files (everything except SKILL.md and config.json)
    for (const f of fs.readdirSync(sdir)) {
      if (f === "SKILL.md" || f === "config.json") continue;
      cli.run(["skill", "files", "upsert", id, "--path", f, "--content-file", `${sdir}/${f}`]);
    }
  }
  return { idMap, created, updated };
}

export function importAgents({ cli, manifest, dir, skillIdMap, runtimeMap, fs = nodeFs }) {
  const idMap = new Map();
  let created = 0, updated = 0;
  const existing = listAgents(cli);

  for (const a of manifest.agents) {
    const rec = JSON.parse(fs.readFileSync(`${dir}/${a.file}`, "utf8"));
    const targetRuntime = runtimeMap.get(rec.sourceRuntimeId);
    if (!targetRuntime) throw new Error(`Unmapped runtime "${rec.sourceRuntimeId}" for agent "${rec.name}"`);
    // Only pass optional flags when present — `--model ""` would CLEAR the model.
    const common = [
      "--visibility", rec.visibility ?? "private",
      "--max-concurrent-tasks", String(rec.maxConcurrentTasks ?? 6),
    ];
    if (rec.instructions) common.push("--instructions", rec.instructions);
    if (rec.model) common.push("--model", rec.model);
    if (rec.thinkingLevel) common.push("--thinking-level", rec.thinkingLevel);
    if (rec.runtimeConfig && Object.keys(rec.runtimeConfig).length) common.push("--runtime-config", JSON.stringify(rec.runtimeConfig));
    if (Array.isArray(rec.customArgs) && rec.customArgs.length) common.push("--custom-args", JSON.stringify(rec.customArgs));
    const match = findByName(existing, rec.name);
    let id;
    if (match) {
      cli.run(["agent", "update", match.id, "--runtime-id", targetRuntime, ...common]);
      id = match.id; updated++;
    } else {
      const out = cli.run(["agent", "create", "--name", rec.name, "--runtime-id", targetRuntime, ...common]);
      id = JSON.parse(out).id; created++;
    }
    idMap.set(rec.name, id);
    const skillIds = (rec.skillNames ?? []).map((n) => skillIdMap.get(n)).filter(Boolean);
    cli.run(["agent", "skills", "set", id, "--skill-ids", skillIds.join(",")]);
  }
  return { idMap, created, updated };
}

export function importSquad({ cli, squad, agentIdMap }) {
  const existing = listSquads(cli);
  const leaderId = agentIdMap.get(squad.leaderName);
  const match = findByName(existing, squad.name);
  let id, created = 0, updated = 0;
  if (match) {
    cli.run(["squad", "update", match.id, "--leader", leaderId, "--description", squad.description ?? ""]);
    id = match.id; updated++;
  } else {
    const out = cli.run(["squad", "create", "--name", squad.name, "--leader", leaderId, "--description", squad.description ?? ""]);
    id = JSON.parse(out).id; created++;
  }
  for (const m of squad.members) {
    if (m.agentName === squad.leaderName) continue;
    cli.run(["squad", "member", "add", id, "--member-id", agentIdMap.get(m.agentName), "--role", m.role, "--type", "agent"]);
  }
  return { newId: id, created, updated };
}
