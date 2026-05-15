#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$PLUGIN_ROOT/hooks/task-created.sh"
LOG_DIR_REL=".claude/hooks"
TMP="$(mktemp -d)"
trap "rm -rf $TMP" EXIT
mkdir -p "$TMP/docs/superpowers/sessions" "$TMP/$LOG_DIR_REL"

fail=0
LOG="$TMP/$LOG_DIR_REL/log.jsonl"

run() {
  CLAUDE_PROJECT_DIR="$TMP" bash "$HOOK" <<<"$1" >/dev/null
}

# Case 1: impl:be-* with wave metadata logs the wave number
echo "full-stack" > "$TMP/docs/superpowers/sessions/foo.shape"
: > "$LOG"
run '{"task":{"title":"impl:be-thing","metadata":{"slug":"foo","wave":2}}}'
if grep -q '"wave":2' "$LOG"; then
  echo "PASS: task-created logs wave=2 for impl:be-thing"
else
  echo "FAIL: wave field not logged"
  cat "$LOG"
  fail=1
fi

# Case 2: impl: task with no wave metadata logs warn=MISSING_WAVE_METADATA
: > "$LOG"
run '{"task":{"title":"impl:be-other","metadata":{"slug":"foo"}}}'
if grep -q 'MISSING_WAVE_METADATA' "$LOG"; then
  echo "PASS: task-created warns MISSING_WAVE_METADATA when wave absent"
else
  echo "FAIL: missing-wave warning not emitted"
  cat "$LOG"
  fail=1
fi

# Case 3: meta:/review:/block: tasks do NOT trigger MISSING_WAVE_METADATA
: > "$LOG"
run '{"task":{"title":"review:diff","metadata":{"slug":"foo"}}}'
if grep -q 'MISSING_WAVE_METADATA' "$LOG"; then
  echo "FAIL: non-impl task incorrectly triggered MISSING_WAVE_METADATA"
  fail=1
else
  echo "PASS: review: task does not trigger wave warning"
fi

# Case 4: solo-mode still wins — INVALID_FOR_SOLO_MODE precedes wave check
echo "solo" > "$TMP/docs/superpowers/sessions/foo.mode"
: > "$LOG"
run '{"task":{"title":"impl:be-x","metadata":{"slug":"foo"}}}'
if grep -q 'INVALID_FOR_SOLO_MODE' "$LOG"; then
  echo "PASS: solo guard still fires alongside wave check"
else
  echo "FAIL: solo guard missing"
  cat "$LOG"
  fail=1
fi

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
