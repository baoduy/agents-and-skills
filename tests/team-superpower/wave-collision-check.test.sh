#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/../../plugins/team-superpower" && pwd)"
SCRIPT="$PLUGIN_ROOT/scripts/wave-collision-check.sh"

fail=0

assert_collision() {
  # $1: stdin content, $2: expected exit (0|1), $3: test name
  local out exit_code
  out="$(printf '%s' "$1" | bash "$SCRIPT" 2>&1)" && exit_code=0 || exit_code=$?
  if [ "$exit_code" = "$2" ]; then
    echo "PASS: $3"
  else
    echo "FAIL: $3 — exit=$exit_code expected=$2"
    echo "  output: $out"
    fail=1
  fi
}

# Disjoint files → exit 0
assert_collision "impl:be-a src/a.cs
impl:be-b src/b.cs" 0 "disjoint files → no collision"

# Shared file → exit 1
assert_collision "impl:be-a src/shared.cs
impl:be-b src/shared.cs" 1 "shared file → collision"

# Case-insensitive normalization
assert_collision "impl:be-a Src/Auth.cs
impl:be-b src/auth.cs" 1 "case-insensitive collision"

# Leading ./ stripped
assert_collision "impl:be-a ./src/x.cs
impl:be-b src/x.cs" 1 "leading-dotslash collision"

# Multiple files per task, partial overlap
assert_collision "impl:be-a src/a.cs src/shared.cs
impl:be-b src/b.cs src/shared.cs" 1 "partial-overlap collision"

# Single task in wave → exit 0
assert_collision "impl:be-only src/x.cs" 0 "single task → no collision"

# Three tasks, only one pair collides → exit 1
assert_collision "impl:be-a src/a.cs
impl:be-b src/b.cs
impl:be-c src/a.cs" 1 "three tasks, one collision pair"

# Diagnostic includes the colliding task IDs and the shared file
out="$(printf 'impl:be-x src/foo.cs
impl:be-y src/foo.cs' | bash "$SCRIPT" 2>&1 || true)"
if printf '%s' "$out" | grep -q 'impl:be-x' && printf '%s' "$out" | grep -q 'impl:be-y' && printf '%s' "$out" | grep -qi 'foo.cs'; then
  echo "PASS: diagnostic names the collision"
else
  echo "FAIL: diagnostic missing task IDs or filename"
  echo "  output: $out"
  fail=1
fi

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
