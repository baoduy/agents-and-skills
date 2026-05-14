#!/usr/bin/env bash
# TeammateIdle hook — block idle if there are unanswered inbound peer messages.
#
# Reads the hook event payload from stdin. Expected JSON fields (best-effort —
# the agent-teams runtime may evolve; we only fail closed on what we can verify):
#   - mailbox: array of { from, replied, ... }
#   - teammate: string (the idling teammate's role)
#
# Behaviour:
#   - count messages where from != "lead" AND replied == false
#   - if count > 0  -> exit 2 with stderr BLOCKED_IDLE
#   - else          -> exit 0
#
# Logs every invocation to .claude/hooks/log.jsonl in the project root for tuning.

set -euo pipefail

LOG_DIR="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/hooks"
LOG_FILE="$LOG_DIR/log.jsonl"
mkdir -p "$LOG_DIR"

payload="$(cat || true)"

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ -z "$payload" ]; then
  printf '{"ts":"%s","hook":"teammate-idle","skipped":"empty payload"}\n' "$ts" >> "$LOG_FILE"
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  printf '{"ts":"%s","hook":"teammate-idle","skipped":"jq not installed"}\n' "$ts" >> "$LOG_FILE"
  exit 0
fi

unanswered="$(printf '%s' "$payload" | jq '[.mailbox[]? | select((.from // "") != "lead") | select((.replied // false) == false)] | length' 2>/dev/null || echo 0)"

printf '{"ts":"%s","hook":"teammate-idle","unanswered":%s}\n' "$ts" "$unanswered" >> "$LOG_FILE"

if [ "${unanswered:-0}" -gt 0 ]; then
  printf '{"ts":"%s","hook":"teammate-idle","warn":"blocked_idle","unanswered":%s}\n' "$ts" "$unanswered" >> "$LOG_FILE"
fi

exit 0
