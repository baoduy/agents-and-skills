// multica 0.6.x: skill labels, stale skill files, squad role drift, autopilot
// trigger enabled/schedule drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import { importSkills, importSquad, importAutopilots } from "../../plugins/multica-tool/scripts/multica-import.mjs";
import { exportResource } from "../../plugins/multica-tool/scripts/multica-export.mjs";

// In-memory fs; paths normalized so "./x" and "x" hit the same entry.
function memFs(seed = {}) {
  const n = (p) => p.replace(/^\.\//, "");
  const files = Object.fromEntries(Object.entries(seed).map(([k, v]) => [n(k), v]));
  return {
    files,
    existsSync: (p) => n(p) in files,
    readFileSync: (p) => files[n(p)],
    writeFileSync: (p, d) => { files[n(p)] = d; },
    mkdirSync: () => {},
    readdirSync: (p, opts) => {
      const seen = new Map();
      for (const f of Object.keys(files)) {
        if (!f.startsWith(n(p) + "/")) continue;
        const rest = f.slice(n(p).length + 1), slash = rest.indexOf("/");
        const name = slash === -1 ? rest : rest.slice(0, slash);
        if (!seen.has(name)) seen.set(name, slash !== -1);
      }
      return [...seen].map(([name, isDir]) => (opts?.withFileTypes ? { name, isDirectory: () => isDir } : name));
    },
  };
}

// json(args) answered from a "space-joined argv -> value" table; anything else is [].
function cli(table = {}, runOut = () => "{}") {
  const calls = [];
  return {
    calls,
    json: (a) => table[a.join(" ")] ?? [],
    run: (a) => { calls.push(a); return runOut(a); },
  };
}
const has = (calls, prefix) => calls.some((a) => a.join(" ").startsWith(prefix));

const SDLC = { name: "SDLC", color: "#3b82f6", description: "The SDLC Skills" };

test("export carries a skill's labels in the manifest", () => {
  const c = cli({
    "skill get sk1 --with-content": { id: "sk1", name: "Greet", content: "# Greet", files: [] },
    "skill label list sk1": [{ id: "lb1", ...SDLC, resource_type: "skill", usage_count: 3 }],
  });
  const { manifest } = exportResource({ cli: c, scope: "skill", ids: { skillId: "sk1" }, outDir: "/o", sourceWorkspaceId: "ws", fs: memFs(), download: () => null });
  assert.deepEqual(manifest.skills[0].labels, [SDLC], "definition travels by name; ids/usage never bundled");
});

test("importSkills creates a missing skill label definition and attaches it", () => {
  const fs = memFs({ "skills/greet/SKILL.md": "# Greet" });
  const c = cli({}, (a) => (a[0] === "label" ? '{"id":"lb_NEW"}' : '{"id":"sk_NEW"}'));
  importSkills({ cli: c, manifest: { skills: [{ name: "Greet", dir: "skills/greet", labels: [SDLC] }] }, dir: ".", fs });
  const create = c.calls.find((a) => a[0] === "label" && a[1] === "create");
  assert.equal(create[create.indexOf("--resource-type") + 1], "skill");
  assert.equal(create[create.indexOf("--description") + 1], "The SDLC Skills");
  assert.ok(has(c.calls, "skill label add sk_NEW lb_NEW"));
});

test("importSkills on a matched skill: reuses label, skips attached ones, deletes stale files", () => {
  const fs = memFs({ "skills/greet/SKILL.md": "# Greet", "skills/greet/keep.md": "k" });
  const c = cli({
    "skill list": [{ id: "sk_T", name: "Greet", description: "d" }],
    "label list --resource-type skill": [{ id: "lb_T", name: "SDLC" }, { id: "lb_X", name: "Other" }],
    "skill label list sk_T": [{ id: "lb_T", name: "SDLC" }],
    "skill files list sk_T": [{ id: "f1", path: "keep.md" }, { id: "f2", path: "old.md" }],
  });
  const r = importSkills({ cli: c, manifest: { skills: [{ name: "Greet", dir: "skills/greet", labels: [SDLC, { name: "Other", color: "#000000" }] }] }, dir: ".", fs });
  assert.ok(!c.calls.some((a) => a[0] === "label" && a[1] === "create"), "existing definitions are reused by name");
  assert.ok(!has(c.calls, "skill label add sk_T lb_T"), "already attached — not re-added");
  assert.ok(has(c.calls, "skill label add sk_T lb_X"));
  assert.ok(has(c.calls, "skill files delete sk_T f2"));
  assert.ok(!has(c.calls, "skill files delete sk_T f1"), "a file still in the bundle is kept");
  assert.equal(r.filesDeleted, 1);
});

test("importSkills on a created skill never lists or deletes destination files", () => {
  const fs = memFs({ "skills/greet/SKILL.md": "# Greet" });
  const c = cli({}, () => '{"id":"sk_NEW"}');
  importSkills({ cli: c, manifest: { skills: [{ name: "Greet", dir: "skills/greet" }] }, dir: ".", fs });
  assert.ok(!has(c.calls, "skill files delete"));
  assert.ok(!has(c.calls, "skill label"), "legacy bundle without labels touches no labels");
});

test("importSquad re-applies a drifted member role via set-role", () => {
  const c = cli({
    "squad list": [{ id: "sq_T", name: "Team", avatar_url: "emoji:x" }],
    "squad member list sq_T": [{ member_id: "ag_2", member_type: "agent", role: "member" }, { member_id: "ag_3", member_type: "agent", role: "qa" }],
  });
  const squad = { name: "Team", leader_name: "L", members: [{ agent_name: "B", role: "reviewer" }, { agent_name: "C", role: "qa" }] };
  importSquad({ cli: c, squad, agentIdMap: new Map([["L", "ag_1"], ["B", "ag_2"], ["C", "ag_3"]]) });
  const sets = c.calls.filter((a) => a[2] === "set-role");
  assert.equal(sets.length, 1, "unchanged role is left alone");
  assert.deepEqual(sets[0], ["squad", "member", "set-role", "sq_T", "--member-id", "ag_2", "--role", "reviewer", "--member-type", "agent"]);
  assert.ok(!c.calls.some((a) => a[2] === "add"), "present members are never re-added");
});

const AP_REC = (triggers) => ({ title: "Nightly", assignee_type: "agent", assignee_name: "Bot", execution_mode: "run_only", triggers });

test("importAutopilots switches a disabled source trigger off right after adding it", () => {
  const fs = memFs({ "autopilots/n.json": JSON.stringify(AP_REC([{ kind: "schedule", label: "n", enabled: false, cron_expression: "0 9 * * *", timezone: "UTC" }])) });
  const c = cli({ "agent list": [{ name: "Bot" }] }, (a) => (a[1] === "trigger-add" ? '{"id":"tr_NEW"}' : '{"id":"ap_NEW"}'));
  importAutopilots({ cli: c, manifest: { autopilots: [{ file: "autopilots/n.json" }] }, dir: ".", agentIdMap: new Map(), fs });
  assert.ok(has(c.calls, "autopilot trigger-update ap_NEW tr_NEW --enabled=false"));
});

test("importAutopilots updates a matched trigger only when schedule or enabled drifted", () => {
  const fs = memFs({ "autopilots/n.json": JSON.stringify(AP_REC([
    { kind: "schedule", label: "n", enabled: false, cron_expression: "0 10 * * *", timezone: "UTC" },
    { kind: "schedule", label: "same", enabled: true, cron_expression: "0 1 * * *", timezone: "UTC" },
  ])) });
  const c = cli({
    "agent list": [{ name: "Bot" }],
    "autopilot list": { autopilots: [{ id: "ap_T", title: "Nightly" }] },
    "autopilot get ap_T": { autopilot: { id: "ap_T" }, triggers: [
      { id: "tr_1", kind: "schedule", label: "n", enabled: true, cron_expression: "0 9 * * *", timezone: "UTC" },
      { id: "tr_2", kind: "schedule", label: "same", enabled: true, cron_expression: "0 1 * * *", timezone: "UTC" },
    ] },
  });
  importAutopilots({ cli: c, manifest: { autopilots: [{ file: "autopilots/n.json" }] }, dir: ".", agentIdMap: new Map(), fs });
  const ups = c.calls.filter((a) => a[1] === "trigger-update");
  assert.equal(ups.length, 1);
  assert.deepEqual(ups[0], ["autopilot", "trigger-update", "ap_T", "tr_1", "--cron", "0 10 * * *", "--enabled=false"]);
  assert.ok(!has(c.calls, "autopilot trigger-add"), "matched triggers are never duplicated");
});

test("preflight lists destination skill files an import would delete — never SKILL.md/config.json", async () => {
  const { preflight } = await import("../../plugins/multica-tool/scripts/multica-import.mjs");
  const fs = memFs({
    "manifest.json": JSON.stringify({ skills: [{ name: "Greet", dir: "skills/greet" }], agents: [] }),
    "skills/greet/SKILL.md": "# Greet", "skills/greet/keep.md": "k",
  });
  const c = cli({
    "skill list": [{ id: "sk_T", name: "Greet" }],
    "skill files list sk_T": [{ id: "f1", path: "keep.md" }, { id: "f2", path: "old.md" }, { id: "f3", path: "SKILL.md" }],
  });
  const rep = preflight({ cli: c, dir: ".", runtimeMap: new Map(), include: new Set(["skills"]), fs });
  const dels = rep.incompatibilities.filter((i) => i.type === "skill-file-will-delete").map((i) => i.detail);
  assert.equal(dels.length, 1);
  assert.match(dels[0], /old\.md/);
  assert.equal(c.calls.length, 0, "preflight is read-only");
});

test("importSkills never deletes SKILL.md or config.json even if the file list reports them", () => {
  const fs = memFs({ "skills/greet/SKILL.md": "# Greet" });
  const c = cli({
    "skill list": [{ id: "sk_T", name: "Greet", description: "d" }],
    "skill files list sk_T": [{ id: "f1", path: "SKILL.md" }, { id: "f2", path: "config.json" }],
  });
  importSkills({ cli: c, manifest: { skills: [{ name: "Greet", dir: "skills/greet" }] }, dir: ".", fs });
  assert.ok(!has(c.calls, "skill files delete"));
});
