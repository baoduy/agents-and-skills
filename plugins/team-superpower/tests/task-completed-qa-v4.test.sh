#!/usr/bin/env bash
# v4: per-task QA verification hook checks.
set -euo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/hooks/task-completed.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export CLAUDE_PROJECT_DIR="$TMP"
mkdir -p "$TMP/.claude/hooks"
LOG="$TMP/.claude/hooks/log.jsonl"

# Case 1: impl: task without qa_verified_at warns MISSING_QA_VERIFICATION.
: > "$LOG"
printf '{"task":{"title":"impl:be-foo","metadata":{"plan_approved_at":"2026-05-15T00:00:00Z","wave":1}}}' \
  | bash "$HOOK"
if grep -q "MISSING_QA_VERIFICATION" "$LOG"; then
  echo "PASS: missing qa_verified_at warns"
else
  echo "FAIL: missing qa_verified_at should warn"; exit 1
fi

# Case 2: impl: task with qa_verified_at + no commits still passes (qa_verified_at present).
: > "$LOG"
printf '{"task":{"title":"impl:be-foo","metadata":{"plan_approved_at":"2026-05-15T00:00:00Z","wave":1,"qa_verified_at":"2026-05-15T01:00:00Z"}}}' \
  | bash "$HOOK"
if grep -q '"MISSING_QA_VERIFICATION".*qa_verified_at metadata missing' "$LOG"; then
  echo "FAIL: qa_verified_at present should not warn missing metadata"; exit 1
else
  echo "PASS: qa_verified_at present suppresses missing-metadata warn"
fi

# Case 3: qa_rounds >= cap with no qa_verified_at and no escalation warns QA_CAP_EXCEEDED.
: > "$LOG"
printf '{"task":{"title":"impl:be-foo","metadata":{"plan_approved_at":"2026-05-15T00:00:00Z","wave":1,"qa_rounds":3}}}' \
  | bash "$HOOK"
if grep -q "QA_CAP_EXCEEDED" "$LOG"; then
  echo "PASS: qa_rounds at cap without escalation warns"
else
  echo "FAIL: qa_rounds at cap should warn"; exit 1
fi

# Case 4: qa_rounds at cap with valid cross-role escalation suppresses warn.
: > "$LOG"
escalation='Phase: impl\nContext: stuck\nclass: cross-role\nqa_rounds: 3\nwhat_failed: lint kept failing\none_change_to_fix: regen types\nOptions: a\nRecommendation: a\nNeed from you: ack\nPeer attempts: qa x3'
printf '{"task":{"title":"impl:be-foo","metadata":{"plan_approved_at":"2026-05-15T00:00:00Z","wave":1,"qa_rounds":3,"blocked_questions":["%b"]}}}' \
  "$escalation" | bash "$HOOK"
if grep -q "QA_CAP_EXCEEDED" "$LOG"; then
  echo "FAIL: valid escalation should suppress QA_CAP_EXCEEDED"; exit 1
else
  echo "PASS: valid cross-role escalation suppresses QA_CAP_EXCEEDED"
fi

# Case 5: non-impl task is not checked for qa metadata.
: > "$LOG"
printf '{"task":{"title":"design:foo","metadata":{}}}' | bash "$HOOK"
if grep -q "MISSING_QA_VERIFICATION" "$LOG"; then
  echo "FAIL: non-impl should not trigger QA check"; exit 1
else
  echo "PASS: non-impl tasks ignored by QA check"
fi

echo "ALL PASS"
