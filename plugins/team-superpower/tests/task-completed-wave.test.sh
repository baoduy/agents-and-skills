#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$PLUGIN_ROOT/hooks/task-completed.sh"
TMP="$(mktemp -d)"
trap "rm -rf $TMP" EXIT
mkdir -p "$TMP/.claude/hooks"

fail=0
LOG="$TMP/.claude/hooks/log.jsonl"

run() {
  CLAUDE_PROJECT_DIR="$TMP" bash "$HOOK" <<<"$1" >/dev/null
}

# Case 1: impl:* with no wave → MISSING_WAVE_METADATA
: > "$LOG"
run '{"task":{"title":"impl:be-thing","metadata":{"plan_approved_at":"2026-05-15T01:00:00Z"}}}'
if grep -q 'MISSING_WAVE_METADATA' "$LOG"; then
  echo "PASS: missing wave warning on impl: task"
else
  echo "FAIL: expected MISSING_WAVE_METADATA"
  cat "$LOG"
  fail=1
fi

# Case 2: impl:* with wave=1 → no missing warning
: > "$LOG"
run '{"task":{"title":"impl:fe-thing","metadata":{"plan_approved_at":"2026-05-15T01:00:00Z","wave":1}}}'
if grep -q 'MISSING_WAVE_METADATA' "$LOG"; then
  echo "FAIL: wave present but warning fired"
  cat "$LOG"
  fail=1
else
  echo "PASS: wave present suppresses warning"
fi

# Case 3: meta:/review: tasks never trigger MISSING_WAVE_METADATA
: > "$LOG"
run '{"task":{"title":"review:diff","metadata":{}}}'
if grep -q 'MISSING_WAVE_METADATA' "$LOG"; then
  echo "FAIL: non-impl task triggered wave warning"
  fail=1
else
  echo "PASS: review: task ignored by wave check"
fi

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
