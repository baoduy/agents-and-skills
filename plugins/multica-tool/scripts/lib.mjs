import { spawnSync } from "node:child_process";

export function slugify(name) {
  const s = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "unnamed";
}

export function realExec(args) {
  return spawnSync("multica", args, { encoding: "utf8" });
}

export function makeCli(exec, { workspaceId } = {}) {
  function run(args) {
    let full = args;
    if (workspaceId) {
      full = [...args, "--workspace-id", workspaceId];
    }
    const res = exec(full);
    if (res.status !== 0) throw new Error(res.stderr?.trim() || `multica exited ${res.status}`);
    return res.stdout;
  }
  function json(args) {
    const fullArgs = workspaceId ? [...args, "--workspace-id", workspaceId, "--output", "json"] : [...args, "--output", "json"];
    const res = exec(fullArgs);
    if (res.status !== 0) throw new Error(res.stderr?.trim() || `multica exited ${res.status}`);
    return JSON.parse(res.stdout);
  }
  return { run, json };
}

export function requireAuth(exec) {
  const res = exec(["auth", "status"]);
  if (res.status !== 0) throw new Error("Not authenticated. Run: multica login");
}
