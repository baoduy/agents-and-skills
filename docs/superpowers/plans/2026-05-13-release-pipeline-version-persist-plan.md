# Release Pipeline Version Persist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist CI-computed `NEXT_VERSION` back to `main` via commit+push during the release run, so `main` HEAD reflects the released version across `package.json`, `.claude-plugin/marketplace.json`, and `plugins/*/.claude-plugin/plugin.json`.

**Architecture:** Single-file change to `.github/workflows/npm-publish.yaml`. Reorder steps so the release-flag determination happens before file rewrites. Gate the existing rewrite steps on the flag. Add a new "Commit version bump" step that stages the three version surfaces, guards on empty diff, commits with `[skip ci]`, and pushes to `origin HEAD:main`. Loop prevention via `[skip ci]` (primary) + existing `concurrency` group (secondary). Auth via existing `GITHUB_TOKEN` with `permissions: contents: write` (already declared).

**Tech Stack:** GitHub Actions, `actions/checkout@v4`, `paulhatch/semantic-version@v5.4.0`, `softprops/action-gh-release@v2`, bash.

**Spec:** `docs/superpowers/specs/2026-05-13-release-pipeline-version-persist-design.md`

**Testing posture:** CI-workflow changes cannot be meaningfully unit-tested in this repo (no `act` harness installed, no existing workflow test suite). Static validation via `actionlint` is the closest thing to a unit test. End-to-end validation is the next real release run.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `.github/workflows/npm-publish.yaml` | Modify | Entire change lives here |

No other files touched by this implementation.

---

## Task 1: Manual pre-merge check — branch protection on `main`

**Files:** none (GitHub UI check)

- [ ] **Step 1: Verify no branch protection blocks bot push**

Open in browser: `https://github.com/baoduy/agents-and-skills/settings/branches`

Confirm one of:
- No protection rule exists for `main`, OR
- A rule exists AND its "Allow specified actors to bypass required pull requests" list includes `github-actions[bot]`.

If a blocking rule exists and bypass is not configured: **halt the plan**. Pick one:
- Remove the rule (solo repo, low cost).
- Add `github-actions[bot]` to bypass list.
- Switch implementation to PAT-secret approach (rewrite Task 3; out of scope for v1).

- [ ] **Step 2: Record outcome**

Write a one-line note in the implementer's status:
- `branch-protection: absent` → proceed to Task 2, OR
- `branch-protection: present, bot bypass configured` → proceed to Task 2, OR
- `branch-protection: blocking` → halt, escalate.

---

## Task 2: Install `actionlint` (one-time, local)

**Files:** none (toolchain)

- [ ] **Step 1: Check if actionlint already installed**

Run: `which actionlint`
Expected (already installed): `/opt/homebrew/bin/actionlint` (or similar path).
Expected (not installed): no output, exit 1.

If installed, skip to Task 3.

- [ ] **Step 2: Install actionlint via Homebrew**

Run: `brew install actionlint`
Expected: `==> Pouring actionlint--...` and `which actionlint` now returns a path.

- [ ] **Step 3: Verify version**

Run: `actionlint -version`
Expected: version string printed, exit 0.

---

## Task 3: Reorder workflow steps and gate version-rewrite steps

**Files:**
- Modify: `.github/workflows/npm-publish.yaml:48-75`

Goal: move "Determine release flag" above the rewrite steps, and add `if:` gates so the rewrites only run when the flag is true.

- [ ] **Step 1: Read current state of the relevant block**

Run: `sed -n '48,75p' .github/workflows/npm-publish.yaml`
Expected output (current order):
```
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: "https://registry.npmjs.org/"

      - name: Update version in package.json
        run: npm version "${NEXT_VERSION}" --no-git-tag-version --allow-same-version

      - name: Sync plugin manifest versions
        run: |
          ...

      - name: Determine release flag
        id: flag
        run: |
          ...
```

- [ ] **Step 2: Apply the reordering edit**

Replace the block at `.github/workflows/npm-publish.yaml:48-75` with this exact content:

```yaml
      - name: Determine release flag
        id: flag
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            echo "enable=${{ github.event.inputs.release }}" >> "$GITHUB_OUTPUT"
          elif [ "${{ github.event_name }}" = "push" ] && [ "${{ github.ref }}" = "refs/heads/main" ]; then
            echo "enable=true" >> "$GITHUB_OUTPUT"
          else
            echo "enable=false" >> "$GITHUB_OUTPUT"
          fi

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: "https://registry.npmjs.org/"

      - name: Update version in package.json
        if: steps.flag.outputs.enable == 'true'
        run: npm version "${NEXT_VERSION}" --no-git-tag-version --allow-same-version

      - name: Sync plugin manifest versions
        if: steps.flag.outputs.enable == 'true'
        run: |
          if [ -f .claude-plugin/marketplace.json ]; then
            node -e "const fs=require('fs');const p='.claude-plugin/marketplace.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));if(Array.isArray(j.plugins)){j.plugins.forEach(pl=>{pl.version=process.env.NEXT_VERSION});}fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');"
          fi
          for f in plugins/*/.claude-plugin/plugin.json; do
            [ -f "$f" ] || continue
            node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('$f','utf8'));j.version=process.env.NEXT_VERSION;fs.writeFileSync('$f',JSON.stringify(j,null,2)+'\n');"
          done
```

- [ ] **Step 3: Verify YAML still parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/npm-publish.yaml'))" && echo OK`
Expected: `OK`

- [ ] **Step 4: Run actionlint**

Run: `actionlint .github/workflows/npm-publish.yaml`
Expected: no output, exit 0.

- [ ] **Step 5: Diff inspection**

Run: `git diff .github/workflows/npm-publish.yaml`
Expected: the "Determine release flag" block has moved up; "Update version in package.json" and "Sync plugin manifest versions" each have a new `if: steps.flag.outputs.enable == 'true'` line. No other changes.

- [ ] **Step 6: Commit the reorder**

```bash
git add .github/workflows/npm-publish.yaml
git commit -m "ci: gate version rewrites on release flag and reorder steps"
```

---

## Task 4: Add "Commit version bump" step

**Files:**
- Modify: `.github/workflows/npm-publish.yaml` — insert one new step between the "Sync plugin manifest versions" step and the "Create GitHub Release" step

- [ ] **Step 1: Locate the insertion point**

Run: `grep -n "Create GitHub Release\|Sync plugin manifest" .github/workflows/npm-publish.yaml`
Expected: two line numbers, with the "Sync plugin manifest versions" line preceding the "Create GitHub Release" line. Note the line number of "Create GitHub Release".

- [ ] **Step 2: Insert the new step**

Insert the following block immediately before the `- name: Create GitHub Release` line:

```yaml
      - name: Commit version bump
        if: steps.flag.outputs.enable == 'true'
        env:
          NEXT_VERSION: ${{ env.NEXT_VERSION }}
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

          git add package.json .claude-plugin/marketplace.json plugins/*/.claude-plugin/plugin.json

          if git diff --cached --quiet; then
            echo "No version diff to commit — semantic-version produced same value as HEAD"
            exit 0
          fi

          git commit -m "chore(release): v${NEXT_VERSION} [skip ci]"
          git push origin HEAD:main

```

- [ ] **Step 3: Verify YAML parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/npm-publish.yaml'))" && echo OK`
Expected: `OK`

- [ ] **Step 4: Run actionlint**

Run: `actionlint .github/workflows/npm-publish.yaml`
Expected: no output, exit 0.

- [ ] **Step 5: Verify step ordering**

Run: `grep -n "name:" .github/workflows/npm-publish.yaml`
Expected order (top to bottom):
```
Calculate version
Set NEXT_VERSION
Print the version
Determine release flag
Update version in package.json
Sync plugin manifest versions
Commit version bump
Create GitHub Release
Publish to npm
```

Note: `actions/checkout@v4` and `actions/setup-node@v4` appear as `uses:` lines, not `name:` — they will not show in this grep. That's expected.

- [ ] **Step 6: Diff inspection**

Run: `git diff .github/workflows/npm-publish.yaml`
Expected: a single new step block "Commit version bump" added; no other changes.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/npm-publish.yaml
git commit -m "ci: commit version bump to main before release tag"
```

---

## Task 5: Verify `permissions` and `concurrency` already in place

**Files:**
- Read: `.github/workflows/npm-publish.yaml:13-23`

- [ ] **Step 1: Confirm concurrency group**

Run: `sed -n '13,15p' .github/workflows/npm-publish.yaml`
Expected:
```
concurrency:
  group: npm-publish-${{ github.ref }}
```
If absent or different — halt, the loop-prevention secondary guard is missing.

- [ ] **Step 2: Confirm `contents: write` permission**

Run: `sed -n '20,23p' .github/workflows/npm-publish.yaml`
Expected:
```
    permissions:
      contents: write
      packages: write
      id-token: write
```
If `contents: write` is missing — halt, push will fail with 403.

- [ ] **Step 3: Confirm `actions/checkout@v4` keeps credentials**

Run: `grep -A 3 "actions/checkout" .github/workflows/npm-publish.yaml`
Expected: a `with:` block with `fetch-depth: 0` and `fetch-tags: true`. No `persist-credentials: false`. The default `persist-credentials: true` is fine and not shown explicitly.

If `persist-credentials: false` appears — halt, the push will lack auth.

- [ ] **Step 4: No commit needed**

No file changes in this task. The check is a verification gate before merging.

---

## Task 6: End-to-end dry assertion via empty-diff path

**Goal:** Confirm the new step is safe on the empty-diff path before the first real release. Done locally — no CI push.

**Files:** none modified

- [ ] **Step 1: Simulate the staged-file detection logic locally**

In the repo root, run:

```bash
git status --porcelain package.json .claude-plugin/marketplace.json plugins/*/.claude-plugin/plugin.json
```

Expected: no output (working tree clean for these files).

- [ ] **Step 2: Verify the empty-diff guard wording matches**

Run: `grep -A 2 "No version diff" .github/workflows/npm-publish.yaml`
Expected: matches the design spec §3 exactly:
```
            echo "No version diff to commit — semantic-version produced same value as HEAD"
            exit 0
```

- [ ] **Step 3: Verify `[skip ci]` is in the commit message template**

Run: `grep "skip ci" .github/workflows/npm-publish.yaml`
Expected: one line containing `chore(release): v${NEXT_VERSION} [skip ci]`.

- [ ] **Step 4: No commit needed**

Static verification only.

---

## Task 7: Document rollback recipe

**Files:**
- Create: `docs/superpowers/plans/2026-05-13-release-pipeline-version-persist-rollback.md`

- [ ] **Step 1: Write the rollback recipe**

Content:

```markdown
# Rollback: Release Pipeline Version Persist

If the new workflow malfunctions on its first real release, recover with:

## Symptoms → action

| Symptom | Action |
|---|---|
| Workflow re-triggers itself (loop) | `gh run cancel <run-id>` for all queued runs; revert workflow commit; manually delete the looping commit from `main` if needed. |
| `git push` fails with 403 | Check branch protection in GitHub UI; if rule was added since plan ran, either remove or add bot bypass; re-run workflow via `workflow_dispatch`. |
| Tag created but commit not pushed | `git push origin HEAD:main` manually from a local clone with the rewritten files; or delete the orphan tag (`gh release delete vX.Y.Z --yes && git push --delete origin vX.Y.Z`) and re-run workflow. |
| npm publish failed but commit pushed | Re-run `npm publish --access public --no-git-checks` locally with `NODE_AUTH_TOKEN` exported, OR re-run the workflow (the commit step is idempotent via empty-diff guard). |
| Need to bypass entirely | Revert the workflow commits (`git revert <commit-task-3> <commit-task-4>`); run release manually: `npm version <X.Y.Z> --no-git-tag-version`, sync manifest files by hand, `git commit -m "chore(release): vX.Y.Z"`, `git push`, `gh release create vX.Y.Z --generate-notes`, `npm publish --access public`. |

## Full manual release fallback

```bash
NEXT_VERSION=X.Y.Z
npm version "$NEXT_VERSION" --no-git-tag-version --allow-same-version
node -e "const fs=require('fs');const p='.claude-plugin/marketplace.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));if(Array.isArray(j.plugins)){j.plugins.forEach(pl=>{pl.version=process.env.NEXT_VERSION});}fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');"
for f in plugins/*/.claude-plugin/plugin.json; do
  node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('$f','utf8'));j.version=process.env.NEXT_VERSION;fs.writeFileSync('$f',JSON.stringify(j,null,2)+'\n');"
done
git add package.json .claude-plugin/marketplace.json plugins/*/.claude-plugin/plugin.json
git commit -m "chore(release): v$NEXT_VERSION"
git push origin main
gh release create "v$NEXT_VERSION" --generate-notes --latest
npm publish --access public
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-05-13-release-pipeline-version-persist-rollback.md
git commit -m "docs(plans): rollback recipe for release-pipeline version-persist"
```

---

## Task 8: First-release observation checklist (post-merge, post-release)

**This task is owner-driven, not implementer-driven.** It runs after the workflow PR is merged and the first real release fires.

**Files:** none

- [ ] **Step 1: Watch the workflow run**

Open: `https://github.com/baoduy/agents-and-skills/actions`
Confirm: single run for the triggering push. No follow-up run from the bot's `[skip ci]` commit.

- [ ] **Step 2: Verify bumped commit on `main`**

Run:
```bash
git fetch origin
git log origin/main -2 --oneline
```
Expected: top commit is `chore(release): vX.Y.Z [skip ci]` by `github-actions[bot]`.

- [ ] **Step 3: Verify commit touches only version files**

Run: `git show --stat origin/main`
Expected: `package.json`, `.claude-plugin/marketplace.json`, one `plugins/*/.claude-plugin/plugin.json` per plugin. No other files.

- [ ] **Step 4: Verify tag at bumped commit**

Run:
```bash
git fetch --tags
git rev-parse vX.Y.Z
git rev-parse origin/main
```
Expected: both SHAs identical.

- [ ] **Step 5: Verify npm version**

Run: `npm view @drunkcoding/agents-and-skills version`
Expected: `X.Y.Z`

- [ ] **Step 6: Mark plan complete in checkpoint**

Update the session checkpoint (`docs/superpowers/sessions/2026-05-13-release-pipeline-version-persist.md` if one exists) with verification timestamp and outcome.

---

## Self-review notes

- **Spec coverage check:** §1 goal → Tasks 3+4. §2 step ordering → Task 3. §3 commit step → Task 4. §4 loop prevention + auth → Task 5 (verify), Task 4 (apply). §5 edge cases → Task 6 (empty-diff static check) + Task 8 (loop observation). §6 verification → Task 8. §7 out-of-scope → respected (no signed commits, no release-please). §8 single-file change → respected (Task 7 adds a docs file, not source).
- **Placeholder scan:** none. Every step has exact commands, exact file paths, exact expected output, or exact code blocks.
- **Type consistency:** `NEXT_VERSION` env var name is consistent across all tasks. `steps.flag.outputs.enable` matches workflow line 67. Filenames (`.claude-plugin/marketplace.json`, `plugins/*/.claude-plugin/plugin.json`, `package.json`) consistent across Tasks 3, 4, 6, 7, 8.

---

## Execution handoff

Plan complete. Per the standing owner instruction ("make the reasonable call and continue"), proceeding to **Subagent-Driven execution** via `superpowers:subagent-driven-development` — one task per fresh subagent, two-stage review between tasks.
