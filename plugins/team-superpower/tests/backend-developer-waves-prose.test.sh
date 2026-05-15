#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
F="$PLUGIN_ROOT/agents/backend-developer.md"

fail=0
assert_grep() {
  if grep -qE "$1" "$F"; then
    echo "PASS: $2"
  else
    echo "FAIL: $2 — pattern not found: $1"
    fail=1
  fi
}

assert_grep '## Wave lifecycle' 'backend-developer.md has Wave lifecycle section'
assert_grep 'self-claim' 'backend-developer.md describes self-claim behavior'
assert_grep 'WAVE_COLLISION' 'backend-developer.md mentions WAVE_COLLISION'
assert_grep '`wave:`' 'backend-developer.md references wave metadata'
assert_grep 'idle' 'backend-developer.md acknowledges between-wave idle'

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
