#!/usr/bin/env bash
# v4: retrieval budget hook checks.
set -euo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../plugins/team-superpower" && pwd)/hooks/task-completed.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export CLAUDE_PROJECT_DIR="$TMP"
mkdir -p "$TMP/.claude/hooks"
LOG="$TMP/.claude/hooks/log.jsonl"

# Case 1: retrieval_requests > cap warns RETRIEVAL_BUDGET_EXCEEDED.
: > "$LOG"
printf '{"task":{"title":"impl:be-foo","metadata":{"plan_approved_at":"2026-05-15T00:00:00Z","wave":1,"qa_verified_at":"2026-05-15T01:00:00Z","retrieval_requests":3}}}' \
  | bash "$HOOK"
if grep -q "RETRIEVAL_BUDGET_EXCEEDED" "$LOG"; then
  echo "PASS: retrieval_requests > cap warns"
else
  echo "FAIL: retrieval cap exceed should warn"; exit 1
fi

# Case 2: retrieval_requests ≤ cap does not warn.
: > "$LOG"
printf '{"task":{"title":"impl:be-foo","metadata":{"plan_approved_at":"2026-05-15T00:00:00Z","wave":1,"qa_verified_at":"2026-05-15T01:00:00Z","retrieval_requests":2}}}' \
  | bash "$HOOK"
if grep -q "RETRIEVAL_BUDGET_EXCEEDED" "$LOG"; then
  echo "FAIL: at-cap should not warn exceed"; exit 1
else
  echo "PASS: retrieval_requests ≤ cap does not warn"
fi

# Case 3: non-impl task ignored.
: > "$LOG"
printf '{"task":{"title":"plan:foo","metadata":{"retrieval_requests":99}}}' | bash "$HOOK"
if grep -q "RETRIEVAL_BUDGET_EXCEEDED" "$LOG"; then
  echo "FAIL: non-impl should not check retrieval"; exit 1
else
  echo "PASS: non-impl ignored by retrieval check"
fi

echo "ALL PASS"
