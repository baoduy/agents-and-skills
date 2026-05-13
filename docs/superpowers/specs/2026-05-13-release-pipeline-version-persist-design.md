# Design: Persist CI-Computed Version Back to `main` During Release

**Date:** 2026-05-13
**Topic slug:** `release-pipeline-version-persist`
**Status:** Approved (sections 1–6)
**Author:** Claude (brainstorming skill)

---

## §1 — Goal and non-goals

### Problem
`.github/workflows/npm-publish.yaml` computes `NEXT_VERSION` via `paulhatch/semantic-version@v5.4.0`, then rewrites:

- `package.json`
- `.claude-plugin/marketplace.json` (each `plugins[].version`)
- `plugins/*/.claude-plugin/plugin.json`

These rewrites happen **in-CI only** and are discarded at end of run. Repo `main` keeps `0.1.0` source-of-truth. Each release run reads the previous tag, increments from there, but the files on `main` never reflect the released version. Consumers cloning at `main` see stale versions in manifests.

### Goal
Persist the rewritten files back to `main` as part of the release run, **before** the GitHub release tag is created, so:

- Tag `vX.Y.Z` points at the commit that contains `version: "X.Y.Z"` everywhere.
- `main` HEAD always reflects the latest released version across all four file surfaces.
- npm tarball and marketplace consumers see consistent versions.

### Non-goals
- Changing the version-computation strategy (`paulhatch/semantic-version` stays).
- Switching to PR-based version bumps (e.g., `release-please`).
- Reworking the marketplace.json plugin list mechanism.
- Adding pre-release / canary channels.
- Signing commits (out of scope; can revisit later).

---

## §2 — Workflow step diff and ordering

### Current order
1. checkout
2. Calculate version (semantic-version)
3. Set `NEXT_VERSION` env
4. Print version
5. setup-node
6. Update version in `package.json`
7. Sync plugin manifest versions
8. Determine release flag
9. Create GitHub Release
10. Publish to npm

### New order
1. checkout (`fetch-depth: 0`, `fetch-tags: true`, `persist-credentials: true` — already set or default)
2. Calculate version (semantic-version)
3. Set `NEXT_VERSION` env
4. Print version
5. **Determine release flag** ← moved up
6. setup-node
7. Update version in `package.json` ← gated on `flag == 'true'`
8. Sync plugin manifest versions ← gated on `flag == 'true'`
9. **Commit version bump** ← NEW, gated on `flag == 'true'`
10. Create GitHub Release (tag `vX.Y.Z` at HEAD = bumped commit)
11. Publish to npm

### Permissions block (top of job)
```yaml
permissions:
  contents: write   # required for git push and gh release create
  id-token: write   # already present for npm provenance
```

### Concurrency (already present, retained)
```yaml
concurrency:
  group: npm-publish-${{ github.ref }}
  cancel-in-progress: false
```

---

## §3 — New step: "Commit version bump"

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

### Design notes
- `git config` scope is local to the runner checkout — does not modify global config.
- `git add` lists the three surfaces explicitly; no `-A` to avoid accidental inclusion.
- Empty-diff guard handles re-runs and manual-sync scenarios.
- Commit message contains `[skip ci]` to short-circuit workflow re-trigger.
- `HEAD:main` push form makes the target ref explicit even on detached-HEAD checkouts.

---

## §4 — Loop prevention and authentication

### Loop prevention (two layers)
1. **`[skip ci]` in commit message** — GitHub Actions skips workflow runs for commits whose message contains `[skip ci]`. Primary guard.
2. **`concurrency: npm-publish-${{ github.ref }}` group** — already present. Any race condition queues rather than running in parallel. Secondary guard.

### Rejected alternative
`paths-ignore` on workflow trigger — brittle (couples trigger config to exact set of version-bump files). Skipped.

### Authentication
- `actions/checkout@v4` with `persist-credentials: true` (default) leaves `GITHUB_TOKEN` configured for git push.
- Job-level `permissions: contents: write` grants the token push access.
- No PAT or deploy key needed **provided `main` has no branch protection blocking `github-actions[bot]` pushes**.

### Branch protection assumption
**Assumption A: `main` has no branch protection rule on this repo.** Solo personal repo; assumption likely correct.

**Plan task includes a manual pre-merge check:**
1. GitHub UI → Settings → Branches → confirm no protection rule on `main`.
2. If rule exists, add `github-actions[bot]` to bypass list, OR fall back to PAT secret approach (out of scope for v1).

---

## §5 — Edge cases

| # | Case | Handling |
|---|---|---|
| 1 | No version change (re-run on same SHA) | `git diff --cached --quiet` → exit 0. No commit, no push, release step is idempotent. |
| 2 | Another push lands between checkout and push | `concurrency` group serializes release runs. Human push to `main` mid-run is rare on solo repo; if it fires, `git push` rejects, run fails loudly. Owner retries. No automatic rebase (avoids rebase-conflict surface for near-zero scenario). |
| 3 | Tag already exists | `softprops/action-gh-release@v2` updates existing release. Safe. Empty-diff guard prevents the only path that would create a stale tag. |
| 4 | `workflow_dispatch` with `release=false` | All three new/moved gated steps skip (`enable != 'true'`). Release and publish also skip. Clean no-op. |
| 5 | Push fails after staging | Step exits non-zero. Subsequent steps (release, publish) skipped. Repo state unchanged. Owner fixes and retries. |
| 6 | First-run case (no prior tag) | `paulhatch/semantic-version` defaults to `0.0.1` per its docs. Empty-diff guard not relevant (versions differ from `0.1.0`). Normal path. |
| 7 | Manifest sync rewrites identical bytes | `git add` stages no diff. Empty-diff guard handles it. |

---

## §6 — Verification

### Post-run owner checks
1. **Commit on main:**
   ```bash
   git log origin/main -1 --oneline
   # expect: <sha> chore(release): vX.Y.Z [skip ci]
   ```
2. **Touches only version surfaces:**
   ```bash
   git show --stat origin/main
   # expect: package.json, .claude-plugin/marketplace.json, plugins/*/.claude-plugin/plugin.json
   ```
3. **Tag points at bumped commit:**
   ```bash
   git rev-parse vX.Y.Z
   git rev-parse origin/main
   # both identical
   ```
4. **npm tarball matches:**
   ```bash
   npm view @drunkcoding/agents-and-skills version
   # expect: X.Y.Z
   ```
5. **No loop fired:** GH Actions UI shows exactly one `npm-publish` run for the release tag.

### Pre-merge manual check (one-time)
- Confirm no branch protection rule on `main` blocks `github-actions[bot]` push.

### Smoke-test approach
**Approach A — merge and observe:** merge workflow change, watch first real release, hotfix if broken. Solo repo, low blast radius. Plan task includes rollback recipe (revert workflow commit + manual `npm version` + manual `gh release create`).

Rejected: temporary branch override for end-to-end test — adds revert step, easier to forget cleanup.

---

## §7 — Out of scope (deferred)

- Signed commits via GPG key in CI.
- Switching to `release-please` for PR-based version bumps.
- Removing `[skip ci]` in favor of a more rigorous loop guard (e.g., commit-author check).
- Adding a "dry-run" mode that prints the bump diff without pushing.

---

## §8 — Files touched by implementation

1. `.github/workflows/npm-publish.yaml` — only file changed by the implementation. Adds permissions block, reorders steps, adds "Commit version bump" step, gates update/sync steps on flag.

No source files, no plugin contents, no manifests change as part of this implementation. CI behavior change only.
