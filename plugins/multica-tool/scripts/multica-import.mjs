import * as nodeFs from "node:fs";
import { listSkills, findByName } from "./lib.mjs";

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
