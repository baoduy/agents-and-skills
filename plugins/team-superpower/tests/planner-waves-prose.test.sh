#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
F="$PLUGIN_ROOT/agents/planner.md"

fail=0
assert_grep() {
  if grep -qE "$1" "$F"; then
    echo "PASS: $2"
  else
    echo "FAIL: $2 — pattern not found: $1"
    fail=1
  fi
}

assert_grep '^\s*-\s+`Files:`' 'planner.md mentions Files: field'
assert_grep '^\s*-\s+`Depends on:`' 'planner.md mentions Depends on: field'
assert_grep '## Waves' 'planner.md mentions ## Waves section'
assert_grep 'topological sort' 'planner.md explains topological sort'
assert_grep '2 `impl:be-\*` and 2 `impl:fe-\*`' 'planner.md states per-wave concurrency cap'
assert_grep 'collision check yourself' 'planner.md instructs self-collision-check'
assert_grep 'WAVE_COLLISION' 'planner.md describes WAVE_COLLISION protocol'
assert_grep 'impl:be-migration-' 'planner.md still describes migration prefix'

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
