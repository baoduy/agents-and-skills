# Rollback: Release Pipeline Version Persist

If the new workflow malfunctions on its first real release, recover with the matrix below.

## Symptoms → action

| Symptom | Action |
|---|---|
| Workflow re-triggers itself (loop) | `gh run cancel <run-id>` for all queued runs; revert workflow commit; manually delete the looping bot commit from `main` if needed (`git revert <sha>` + force-resolve). |
| `git push` fails with 403 | Check branch protection in GitHub UI; if rule was added since plan ran, either remove or add bot bypass; re-run workflow via `workflow_dispatch`. |
| Tag created but bot commit not on `main` | From a local clone: stage the version files, commit, `git push origin HEAD:main` manually. Alternatively: delete the orphan tag (`gh release delete vX.Y.Z --yes && git push --delete origin vX.Y.Z`) and re-run workflow. |
| npm publish failed but bot commit pushed | Re-run `npm publish --access public --no-git-checks` locally with `NODE_AUTH_TOKEN` exported. Empty-diff guard makes the commit step idempotent on re-run. |
| Need to bypass entirely | Revert the workflow commits; release manually using the fallback script below. |

## Full manual release fallback

```bash
export NEXT_VERSION=X.Y.Z
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

## Revert recipe

```bash
git log --oneline .github/workflows/npm-publish.yaml | head
# identify the two ci: commits from this plan
git revert <commit-task-4> <commit-task-3>
git push origin <branch>
```
