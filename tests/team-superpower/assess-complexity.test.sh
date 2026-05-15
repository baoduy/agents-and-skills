#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/../../plugins/team-superpower" && pwd)"
SCRIPT="$PLUGIN_ROOT/scripts/assess-complexity.sh"

fail=0

assert_field() {
  # assert_field <output-yaml> <field-name> <expected-value> <test-name>
  actual="$(printf '%s\n' "$1" | grep -E "^${2}:" | head -n1 | sed -E "s/^${2}:[[:space:]]*//")"
  if [ "$actual" = "$3" ]; then
    echo "PASS: $4"
  else
    echo "FAIL: $4 — ${2}='${actual}', expected '${3}'"
    echo "  full output:"
    printf '%s\n' "$1" | sed 's/^/    /'
    fail=1
  fi
}

# --- Rung 1: solo ---
out="$(bash "$SCRIPT" 'fix typo in welcome message')"
assert_field "$out" mode solo 'fix typo → mode=solo'

out="$(bash "$SCRIPT" 'bump axios from 1.6.0 to 1.7.0')"
assert_field "$out" mode solo 'bump version → mode=solo'

out="$(bash "$SCRIPT" 'rename variable userId to memberId in src/auth/session.ts')"
assert_field "$out" mode solo 'rename → mode=solo'

out="$(bash "$SCRIPT" 'remove unused import from utils.py')"
assert_field "$out" mode solo 'remove unused → mode=solo'

# --- Rung 2: single-agent ---
out="$(bash "$SCRIPT" 'add /healthcheck endpoint that returns 200 OK')"
assert_field "$out" mode single-agent 'add endpoint → mode=single-agent'

out="$(bash "$SCRIPT" 'add a Cancel button to the order details page')"
assert_field "$out" mode single-agent 'add button on page → mode=single-agent'

out="$(bash "$SCRIPT" 'add an idempotency_key column to the payments table')"
assert_field "$out" mode single-agent 'add column → mode=single-agent'

# --- Rung 3: team ---
out="$(bash "$SCRIPT" 'add login page with email and password, hook up to /auth/login endpoint, redirect on success')"
assert_field "$out" mode team 'mixed BE+FE → mode=team'

out="$(bash "$SCRIPT" 'refactor the payments module to use the new gateway interface')"
assert_field "$out" mode team 'refactor → mode=team'

out="$(bash "$SCRIPT" 'redesign the checkout flow with new payment options')"
assert_field "$out" mode team 'redesign → mode=team'

# --- Size signals ---
out="$(bash "$SCRIPT" 'add gdpr compliance audit log for user actions across the app, with retention controls and PII redaction in storage')"
assert_field "$out" size full 'gdpr/compliance → size=full'

out="$(bash "$SCRIPT" 'spike a prototype for the experimental dashboard widget that the team can play with internally')"
assert_field "$out" size minimal 'prototype/spike → size=minimal'

out="$(bash "$SCRIPT" 'add user preferences feature with toggle UI and persistence layer')"
assert_field "$out" size standard 'default team feature → size=standard'

# --- Multi-verb signal triggers team ---
out="$(bash "$SCRIPT" 'add the contact form and update the navigation and wire up the submission endpoint')"
assert_field "$out" mode team 'multi-verb → mode=team'

# --- Long-message signal triggers team ---
long_msg='add a feature that lets users save their preferred display settings across sessions, including font size, color theme, and notification frequency, and persist those settings to the server so they survive device changes and re-installs of the client app on a different machine'
out="$(bash "$SCRIPT" "$long_msg")"
assert_field "$out" mode team 'long message (>200 chars) → mode=team'

# mode_reasoning is always present
out="$(bash "$SCRIPT" 'fix typo')"
if printf '%s' "$out" | grep -q '^mode_reasoning:'; then
  echo "PASS: mode_reasoning present"
else
  echo "FAIL: mode_reasoning missing"
  fail=1
fi

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
