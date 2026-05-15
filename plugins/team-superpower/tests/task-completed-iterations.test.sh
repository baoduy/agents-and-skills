#!/usr/bin/env bash
# Tests for the iteration_count cap check in task-completed.sh.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$PLUGIN_ROOT/hooks/task-completed.sh"

# Each test runs the hook with a payload on stdin, sets CLAUDE_PROJECT_DIR to a
# temp dir, and inspects the resulting log line.

fail=0

run_hook() {
  # run_hook <payload>
  tmp="$(mktemp -d)"
  CLAUDE_PROJECT_DIR="$tmp" bash "$HOOK" <<< "$1" >/dev/null 2>&1 || true
  cat "$tmp/.claude/hooks/log.jsonl" 2>/dev/null || true
  rm -rf "$tmp"
}

assert_contains() {
  # assert_contains <haystack> <needle> <test-name>
  if printf '%s' "$1" | grep -q -- "$2"; then
    echo "PASS: $3"
  else
    echo "FAIL: $3 (expected to find '$2' in output)"
    echo "  got: $1"
    fail=1
  fi
}

assert_not_contains() {
  # assert_not_contains <haystack> <needle> <test-name>
  if printf '%s' "$1" | grep -q -- "$2"; then
    echo "FAIL: $3 (did NOT expect '$2')"
    echo "  got: $1"
    fail=1
  else
    echo "PASS: $3"
  fi
}

# Case 1: impl task with iteration_count 9, no reflection → ITERATION_CAP_EXCEEDED warn
payload='{"task":{"title":"impl:be-foo","metadata":{"plan_approved_at":"2026-05-15T10:00:00Z","iteration_count":9}}}'
out="$(run_hook "$payload")"
assert_contains "$out" 'ITERATION_CAP_EXCEEDED' 'cap=9 no reflection emits ITERATION_CAP_EXCEEDED'

# Case 2: impl task with iteration_count 9, WITH reflection → no warn
payload='{"task":{"title":"impl:be-foo","metadata":{"plan_approved_at":"2026-05-15T10:00:00Z","iteration_count":9,"reflection":"we kept rewriting the same assertion"}}}'
out="$(run_hook "$payload")"
assert_not_contains "$out" 'ITERATION_CAP_EXCEEDED' 'cap=9 with reflection does not emit ITERATION_CAP_EXCEEDED'

# Case 3: impl task with iteration_count 5 → no warn
payload='{"task":{"title":"impl:be-foo","metadata":{"plan_approved_at":"2026-05-15T10:00:00Z","iteration_count":5}}}'
out="$(run_hook "$payload")"
assert_not_contains "$out" 'ITERATION_CAP_EXCEEDED' 'cap=5 under default 8 does not warn'

# Case 4: non-impl task with high iteration_count → no warn
payload='{"task":{"title":"review:x","metadata":{"iteration_count":99}}}'
out="$(run_hook "$payload")"
assert_not_contains "$out" 'ITERATION_CAP_EXCEEDED' 'non-impl task ignores iteration_count'

# Case 5: impl task missing iteration_count → no warn (treat absent as 0)
payload='{"task":{"title":"impl:be-foo","metadata":{"plan_approved_at":"2026-05-15T10:00:00Z"}}}'
out="$(run_hook "$payload")"
assert_not_contains "$out" 'ITERATION_CAP_EXCEEDED' 'impl task with no iteration_count does not warn'

if [ "$fail" -eq 0 ]; then
  echo "ALL PASS"
  exit 0
fi
exit 1
