#!/usr/bin/env bash
# TaskCreated hook — enforce title prefix on shared task list entries.
#
# Accepts a JSON payload on stdin. Required field:
#   - task.title: string
#
# Title SHOULD start with one of: impl:, review:, meta:, block:
# Violations are logged to .claude/hooks/log.jsonl as warnings; the hook
# always exits 0 so the harness never surfaces feedback to the lead.

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

title="$(printf '%s' "$payload" | jq -r '.task.title // .task.subject // .title // .subject // ""' 2>/dev/null || echo "")"

case "$title" in
  impl:*|review:*|meta:*|block:*)
    printf '{"ts":"%s","hook":"task-created","title":%s}\n' "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
    ;;
  "")
    printf '{"ts":"%s","hook":"task-created","warn":"bad_prefix","reason":"title missing"}\n' "$ts" >> "$LOG_FILE"
    ;;
  *)
    printf '{"ts":"%s","hook":"task-created","warn":"bad_prefix","title":%s}\n' "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
    ;;
esac

exit 0
