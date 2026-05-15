#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/../../plugins/team-superpower" && pwd)"
F="$PLUGIN_ROOT/commands/team-feature.md"

fail=0
assert_grep() {
  if grep -qE "$1" "$F"; then echo "PASS: $2"; else echo "FAIL: $2 — pattern not found: $1"; fail=1; fi
}

assert_grep 'model_actual' 'team-feature.md captures model_actual'
assert_grep 'effort_set' 'team-feature.md captures effort_set'
assert_grep 'usage-threshold fallback' 'team-feature.md mentions usage-threshold fallback'
assert_grep 'pinned' 'team-feature.md surfaces pinned-vs-actual mismatch'
assert_grep 'recovery touchpoint' 'team-feature.md classifies attestation as recovery touchpoint'

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
