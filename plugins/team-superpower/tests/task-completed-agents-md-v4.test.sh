#!/usr/bin/env bash
# v4: AGENTS.md protection hook check.
set -euo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/hooks/task-completed.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export CLAUDE_PROJECT_DIR="$TMP"
mkdir -p "$TMP/.claude/hooks" "$TMP/docs/superpowers"
LOG="$TMP/.claude/hooks/log.jsonl"

# Build a tiny git repo with a commit touching AGENTS.md.
cd "$TMP"
git init -q
git config commit.gpgsign false
git config tag.gpgsign false
git -c user.email=test@x -c user.name=Test commit --allow-empty -q -m "init"
echo "init" > docs/superpowers/AGENTS.md
git add docs/superpowers/AGENTS.md
git -c user.email=teammate@x -c user.name=Teammate commit -q -m "touch AGENTS.md"
sha="$(git rev-parse HEAD)"

# Case 1: commit touching AGENTS.md warns AGENT_WROTE_AGENTS_MD.
: > "$LOG"
printf '{"task":{"title":"impl:be-foo","metadata":{"plan_approved_at":"2026-05-15T00:00:00Z","wave":1,"qa_verified_at":"2026-05-15T01:00:00Z","commits":["%s"]}}}' \
  "$sha" | bash "$HOOK"
if grep -q "AGENT_WROTE_AGENTS_MD" "$LOG"; then
  echo "PASS: commit touching AGENTS.md warns"
else
  echo "FAIL: AGENT_WROTE_AGENTS_MD should fire"; exit 1
fi

# Case 2: commit not touching AGENTS.md does not warn.
echo "other" > other.txt
git add other.txt
git -c user.email=teammate@x -c user.name=Teammate commit -q -m "other"
sha2="$(git rev-parse HEAD)"
: > "$LOG"
printf '{"task":{"title":"impl:be-foo","metadata":{"plan_approved_at":"2026-05-15T00:00:00Z","wave":1,"qa_verified_at":"2026-05-15T01:00:00Z","commits":["%s"]}}}' \
  "$sha2" | bash "$HOOK"
if grep -q "AGENT_WROTE_AGENTS_MD" "$LOG"; then
  echo "FAIL: non-AGENTS commit should not warn"; exit 1
else
  echo "PASS: unrelated commit does not warn"
fi

echo "ALL PASS"
