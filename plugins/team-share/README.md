# team-share

Share repo-level Claude Code onboarding artifacts with your team in one pass.

## What it does

The `team-share` agent prepares a repository for teammates by:

1. Writing a shareable `.claude/settings.json` from the maintainer's enabled plugins and marketplaces.
2. Ensuring `CLAUDE.md` exists when the project does not already have one.
3. Refreshing the Understand-Anything knowledge graph with auto-update enabled.
4. Tracking the graph with `git-lfs` and staging the resulting onboarding files for human review.

It is designed to be idempotent and intentionally stops short of committing or pushing.

## Usage

Run:

```text
/team-share [--force] [--language <lang>]
```

Arguments are passed through to `/understand` alongside the default `--auto-update` behavior.

## Notes

- The command expects `git-lfs` and `jq` to be installed.
- It stages files for review but does not create commits.
- The knowledge graph flow depends on the `understand-anything` plugin being available to teammates.