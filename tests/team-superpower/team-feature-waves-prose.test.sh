#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/../../plugins/team-superpower" && pwd)"
F="$PLUGIN_ROOT/commands/team-feature.md"

fail=0
assert_grep() {
  if grep -qE "$1" "$F"; then
    echo "PASS: $2"
  else
    echo "FAIL: $2 — pattern not found: $1"
    fail=1
  fi
}

assert_grep 'Phase 4' 'team-feature.md retains Phase 4 section'
assert_grep '## Waves' 'team-feature.md references plan ## Waves section'
assert_grep 'wave-collision-check.sh' 'team-feature.md invokes wave-collision-check helper'
assert_grep 'WAVE_COLLISION' 'team-feature.md routes WAVE_COLLISION to planner'
assert_grep '3 .*re-plan' 'team-feature.md caps re-plans at 3'
assert_grep 'min\(.*be_count.*2\)' 'team-feature.md describes BE spawn-count cap of 2'
assert_grep 'min\(.*fe_count.*2\)' 'team-feature.md describes FE spawn-count cap of 2'
assert_grep 'wave: N/M' 'team-feature.md emits per-wave checkpoint field'

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
