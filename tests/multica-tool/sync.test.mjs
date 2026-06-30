import { test } from "node:test";
import assert from "node:assert/strict";
import { sync } from "../../plugins/multica-tool/scripts/multica-sync.mjs";

// One exec for both workspaces; records every argv so we can assert which
// --workspace-id rode along with reads (export) vs writes (import).
function makeExec() {
  const argvs = [];
  const exec = (args) => {
    argvs.push(args);
    const j = args.join(" ");
    if (j.startsWith("workspace list")) return { stdout: JSON.stringify([{ id: "ws_SRC", name: "Source" }, { id: "ws_DST", name: "Dest" }]), stderr: "", status: 0 };
    if (j.startsWith("skill list")) return { stdout: j.includes("ws_SRC") ? JSON.stringify([{ id: "sk_SRC1", name: "Greet" }]) : "[]", stderr: "", status: 0 };
    if (j.startsWith("skill get")) return { stdout: JSON.stringify({ id: "sk_SRC1", name: "Greet", content: "# Greet", config: {}, files: [] }), stderr: "", status: 0 };
    if (j.startsWith("agent list") || j.startsWith("squad list")) return { stdout: "[]", stderr: "", status: 0 };
    if (j.includes("skill create")) return { stdout: '{"id":"sk_DST1"}', stderr: "", status: 0 };
    return { stdout: "{}", stderr: "", status: 0 };
  };
  return { exec, argvs };
}

test("sync resolves both workspaces and threads correct --workspace-id on read vs write", () => {
  const { exec, argvs } = makeExec();
  const tmp = "/tmp/multica-sync-test";
  const report = sync({ exec, type: "skill", name: "Greet", srcWsName: "Source", destWsName: "Dest", tmpDir: tmp, runtimeMap: new Map() });
  assert.equal(report.created.skills, 1);

  const skillGet = argvs.find((a) => a[0] === "skill" && a[1] === "get");
  assert.equal(skillGet[skillGet.indexOf("--workspace-id") + 1], "ws_SRC", "export read used source ws");
  const skillCreate = argvs.find((a) => a[0] === "skill" && a[1] === "create");
  assert.equal(skillCreate[skillCreate.indexOf("--workspace-id") + 1], "ws_DST", "import write used dest ws");
});
