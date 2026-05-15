#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$PLUGIN_ROOT/hooks/task-created.sh"

fail=0

run_hook() {
  # run_hook <payload> [mode-marker-content]
  tmp="$(mktemp -d)"
  if [ -n "${2:-}" ]; then
    mkdir -p "$tmp/docs/superpowers/sessions"
    printf '%s' "$2" > "$tmp/docs/superpowers/sessions/foo.mode"
  fi
  CLAUDE_PROJECT_DIR="$tmp" bash "$HOOK" <<< "$1" >/dev/null 2>&1 || true
  cat "$tmp/.claude/hooks/log.jsonl" 2>/dev/null || true
  rm -rf "$tmp"
}

assert_contains() {
  if printf '%s' "$1" | grep -q -- "$2"; then echo "PASS: $3"; else echo "FAIL: $3"; fail=1; fi
}
assert_not_contains() {
  if printf '%s' "$1" | grep -q -- "$2"; then echo "FAIL: $3 (did not expect)"; fail=1; else echo "PASS: $3"; fi
}

# Case 1: solo via metadata + impl: task → warn
payload='{"task":{"title":"impl:be-foo","metadata":{"mode":"solo"}}}'
out="$(run_hook "$payload")"
assert_contains "$out" 'INVALID_FOR_SOLO_MODE' 'metadata mode=solo with impl: → INVALID_FOR_SOLO_MODE'

# Case 2: solo via marker file + impl: task → warn
payload='{"task":{"title":"impl:be-foo","metadata":{}}}'
out="$(run_hook "$payload" "solo")"
assert_contains "$out" 'INVALID_FOR_SOLO_MODE' 'marker mode=solo with impl: → INVALID_FOR_SOLO_MODE'

# Case 3: solo + meta: task → no warn
payload='{"task":{"title":"meta:something","metadata":{"mode":"solo"}}}'
out="$(run_hook "$payload")"
assert_not_contains "$out" 'INVALID_FOR_SOLO_MODE' 'mode=solo with meta: task is allowed'

# Case 4: solo + review: task → no warn
payload='{"task":{"title":"review:diff-check","metadata":{"mode":"solo"}}}'
out="$(run_hook "$payload")"
assert_not_contains "$out" 'INVALID_FOR_SOLO_MODE' 'mode=solo with review: task is allowed'

# Case 5: team mode + impl: → no warn
payload='{"task":{"title":"impl:be-foo","metadata":{"mode":"team"}}}'
out="$(run_hook "$payload")"
assert_not_contains "$out" 'INVALID_FOR_SOLO_MODE' 'mode=team with impl: is allowed'

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
