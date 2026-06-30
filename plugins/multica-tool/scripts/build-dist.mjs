#!/usr/bin/env node
// Generate OpenCode discovery artifacts from the canonical Claude Code plugin.
// Source of truth: this plugin's skills/ + agents/ + commands/ + scripts/.
// Output: dist/opencode/{skills,agents,commands}/ — copy into .opencode/ (project)
// or ~/.config/opencode/ (global). Run: node plugins/multica-tool/scripts/build-dist.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = dirname(dirname(PLUGIN_ROOT));
const OUT = join(REPO_ROOT, "dist", "opencode");
const NAMES = ["export", "import", "sync"];
// Runtime scripts shared by every skill (exclude this generator).
const SCRIPTS = readdirSync(join(PLUGIN_ROOT, "scripts")).filter(
  (f) => f.endsWith(".mjs") && f !== "build-dist.mjs",
);

// Naive frontmatter split — every source file uses single-line `key: value`.
function parse(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("missing frontmatter");
  const fm = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i !== -1) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { fm, body: m[2] };
}

const read = (...p) => readFileSync(join(PLUGIN_ROOT, ...p), "utf8");
function write(rel, content) {
  const abs = join(OUT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}
// OpenCode resolves a skill's relative paths against the skill base dir it injects.
const toOpencodePath = (s) => s.replace(/"\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\//g, '"scripts/');
const stripSelfPrefix = (s) => s.replace(/multica-tool:/g, "");

rmSync(OUT, { recursive: true, force: true });

for (const name of NAMES) {
  // Skill: keep prose, rewrite script path, drop Claude-only allowed-tools, bundle scripts.
  const skill = parse(read("skills", name, "SKILL.md"));
  const fm = `---\nname: ${skill.fm.name}\ndescription: ${skill.fm.description}\n---\n`;
  write(`skills/${name}/SKILL.md`, fm + toOpencodePath(skill.body));
  for (const s of SCRIPTS) {
    mkdirSync(join(OUT, "skills", name, "scripts"), { recursive: true });
    copyFileSync(join(PLUGIN_ROOT, "scripts", s), join(OUT, "skills", name, "scripts", s));
  }

  // Command: description only; body invokes the local (unprefixed) skill name.
  const cmd = parse(read("commands", `${name}.md`));
  write(`commands/${name}.md`, `---\ndescription: ${stripSelfPrefix(cmd.fm.description)}\n---\n${stripSelfPrefix(cmd.body)}`);

  // Agent: tools -> permission.bash; body unprefixed.
  const agent = parse(read("agents", `${name}.md`));
  const head = `---\ndescription: ${stripSelfPrefix(agent.fm.description)}\nmode: subagent\npermission:\n  bash: allow\n---\n`;
  write(`agents/${name}.md`, head + stripSelfPrefix(agent.body));
}

// Self-check: outputs must carry no Claude-only path/env and must bundle scripts.
for (const name of NAMES) {
  const md = readFileSync(join(OUT, "skills", name, "SKILL.md"), "utf8");
  if (md.includes("CLAUDE_PLUGIN_ROOT") || md.includes("plugins/multica-tool"))
    throw new Error(`leaked Claude path in ${name}/SKILL.md`);
  for (const s of SCRIPTS) readFileSync(join(OUT, "skills", name, "scripts", s)); // throws if missing
}

console.log(`Wrote OpenCode artifacts for [${NAMES.join(", ")}] to ${OUT}`);
