#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$PLUGIN_ROOT/scripts/detect-stack.sh"

fail=0

assert_eq() {
  # assert_eq <actual> <expected> <name>
  if [ "$1" = "$2" ]; then
    echo "PASS: $3"
  else
    echo "FAIL: $3 — got '$1', expected '$2'"
    fail=1
  fi
}

run() {
  # run <launch-message>
  bash "$SCRIPT" detect-side "$1" 2>/dev/null
}

assert_eq "$(run 'add /healthcheck endpoint that returns 200 OK')" "be-only" "endpoint → be-only"
assert_eq "$(run 'add a Cancel button to the order details page')" "fe-only" "page+button → fe-only"
assert_eq "$(run 'add login page with email and password, hook up to /auth/login endpoint, redirect on success')" "mixed" "page + endpoint → mixed"
assert_eq "$(run 'add idempotency_key column to the payments table')" "be-only" "column+table → be-only"
assert_eq "$(run 'new component for user avatar')" "fe-only" "component → fe-only"
assert_eq "$(run 'fix typo in welcome message')" "none" "no side signals → none"
assert_eq "$(run 'add API for fetching user profile and the matching component')" "mixed" "API + component → mixed"
assert_eq "$(run 'refactor PaymentService class for clarity')" "be-only" "service → be-only"
assert_eq "$(run 'redesign the homepage form layout')" "fe-only" "form → fe-only"
assert_eq "$(run 'add database migration for orders schema')" "be-only" "database+migration → be-only"

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
