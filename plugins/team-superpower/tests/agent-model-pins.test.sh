#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

fail=0
check_pin() {
  # check_pin <file> <expected-model> <expected-effort> <name>
  local f="$PLUGIN_ROOT/agents/$1"
  local exp_model="$2"
  local exp_effort="$3"
  local name="$4"
  local actual_model actual_effort
  actual_model="$(awk '/^---$/{n++;next} n==1 && /^model:/{print $2}' "$f" | head -n1)"
  actual_effort="$(awk '/^---$/{n++;next} n==1 && /^effort:/{print $2}' "$f" | head -n1)"
  if [ "$actual_model" = "$exp_model" ] && [ "$actual_effort" = "$exp_effort" ]; then
    echo "PASS: $name model=$exp_model effort=$exp_effort"
  else
    echo "FAIL: $name model=$actual_model (want $exp_model), effort=$actual_effort (want $exp_effort)"
    fail=1
  fi
}

check_directive() {
  # check_directive <file> <expected-effort-level> <name>
  local f="$PLUGIN_ROOT/agents/$1"
  local lvl="$2"
  local name="$3"
  if grep -qE "/effort[[:space:]]+$lvl" "$f"; then
    echo "PASS: $name has /effort $lvl body directive"
  else
    echo "FAIL: $name missing /effort $lvl directive"
    fail=1
  fi
}

# Opus roles
check_pin designer.md opus high 'designer'
check_pin software-architect.md opus high 'software-architect'
check_pin security-engineer.md opus high 'security-engineer'
check_pin reviewer.md opus high 'reviewer'
check_directive designer.md high 'designer'
check_directive software-architect.md high 'software-architect'
check_directive security-engineer.md high 'security-engineer'
check_directive reviewer.md high 'reviewer'

# Sonnet roles
check_pin planner.md sonnet high 'planner'
check_pin qa-engineer.md sonnet high 'qa-engineer'
check_pin backend-developer.md sonnet medium 'backend-developer'
check_pin frontend-developer.md sonnet medium 'frontend-developer'
check_directive planner.md high 'planner'
check_directive qa-engineer.md high 'qa-engineer'
check_directive backend-developer.md medium 'backend-developer'
check_directive frontend-developer.md medium 'frontend-developer'

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
