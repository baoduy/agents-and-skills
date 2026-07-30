# Multica export — orphan-skill cleanup

**Date:** 2026-07-30
**Component:** `plugins/multica-tool` (export)

## Problem

`--scope all` exports **every** workspace skill because it calls `listSkills(cli)`
directly, independent of agents. Standalone skills that no agent references
("legacy"/orphan skills) end up in the bundle, cluttering it. In every other
scope, skills only enter a bundle *through* an agent's `skill_names`, so orphans
never arise there.

Goal: after an export, drop any skill that no exported agent references, so the
bundle contains only skills something actually uses.

## Behavior

After resource collection, compute the set of skill names referenced by any
exported agent — the union of every agent's `skill_names`. For every scope
**except `skill`**, any collected skill whose name is not in that set is an
orphan: it is never written to disk and never appears in `manifest.json`.

| Scope | Effect |
|-------|--------|
| `all` | The only scope that produces orphans (standalone skills from `listSkills`). They are pruned. |
| `agent` / `squad` / `project` / `projects` | Skills enter only via agents, so the referenced set already covers them — the pass removes nothing (safe no-op). |
| `skill` | Pass is skipped entirely. The one requested skill is the explicit target, not a leftover, and must survive. |

## Implementation

One block in `exportResource` (`scripts/multica-export.mjs`), inserted between
the collection `if (scope === …)` chain and the `buildManifest` call:

```js
// Orphan-skill cleanup: drop skills that no exported agent references via its
// skill_names. Only `all` ever produces these (standalone workspace skills from
// listSkills that no agent uses). Skipped for `skill` scope — its lone skill is
// the explicit target, not an orphan.
const pruned_skills = [];
if (scope !== "skill") {
  const referenced = new Set();
  for (const a of agentsById.values()) for (const n of a.skill_names) referenced.add(n);
  for (const name of [...skills.keys()]) {
    if (!referenced.has(name)) { pruned_skills.push(name); skills.delete(name); }
  }
}
```

Because `skills` is pruned **before** `buildManifest` and before the write
loops — which both read the same `skills` map / resulting manifest — orphans are
consistently absent from both the manifest and the filesystem. No separate
delete pass, no `fs.rm`, no double manifest write.

`exportResource` returns `{ manifest, warnings, pruned_skills }`.

## Out of scope

Cleaning unrelated stale skill dirs left in a re-used `--out` folder from a
prior run. The export has never cleaned its target directory, and doing so would
require destructive `fs.rmSync` on a user-supplied path. If wanted, design
separately.

## Reporting

`skills/export/SKILL.md` Step 5 gains one line: when `pruned_skills` is
non-empty, report the count and names — e.g. "Pruned N orphan skill(s) not
linked to any agent: `<name>`, …".

## Tests (`tests/multica-tool/export.test.mjs`)

Add a `SKILL_GET_2` fixture (`Lonely`, referenced by no agent):

1. **`all` scope** with `skill list` returning both `Greet` (used by `Helper`)
   and `Lonely` (orphan): assert `Lonely` is absent from `manifest.skills` and
   `/all/skills/lonely/` is never written; `Greet` survives; `pruned_skills`
   equals `["Lonely"]`. — *Encodes: never ship a skill nothing uses.*
2. **`skill` scope** exporting `Lonely` directly: assert it survives and
   `pruned_skills` is empty. — *Encodes: never discard a skill explicitly
   requested.*
