#!/usr/bin/env bash
# TaskCreated hook — enforce title prefix on shared task list entries.
#
# Accepts a JSON payload on stdin. Required field:
#   - task.title: string
#
# Title MUST start with one of: impl:, review:, meta:, block:
# Otherwise exit 2 with stderr BAD_PREFIX so the team-team runtime refuses
# the task and surfaces the failure to the lead.

set -euo pipefail

LOG_DIR="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/hooks"
LOG_FILE="$LOG_DIR/log.jsonl"
mkdir -p "$LOG_DIR"

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

payload="$(cat || true)"

if [ -z "$payload" ]; then
  printf '{"ts":"%s","hook":"task-created","skipped":"empty payload"}\n' "$ts" >> "$LOG_FILE"
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  printf '{"ts":"%s","hook":"task-created","skipped":"jq not installed"}\n' "$ts" >> "$LOG_FILE"
  exit 0
fi

title="$(printf '%s' "$payload" | jq -r '.task.title // .title // ""' 2>/dev/null || echo "")"

printf '{"ts":"%s","hook":"task-created","title":%s}\n' "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"

case "$title" in
  impl:*|review:*|meta:*|block:*) exit 0 ;;
  "")
    echo "BAD_PREFIX: task title missing; must start with impl:|review:|meta:|block:" >&2
    exit 2 ;;
  *)
    echo "BAD_PREFIX: task title must start with impl:|review:|meta:|block: (got: $title)" >&2
    exit 2 ;;
esac
