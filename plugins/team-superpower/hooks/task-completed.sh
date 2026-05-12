#!/usr/bin/env bash
# TaskCompleted hook — gate implementation completions on plan approval and
# validate any embedded escalation entries.
#
# Accepts a JSON payload on stdin with at minimum:
#   - task.title: string
#   - task.metadata.plan_approved_at: string (ISO datetime), required for impl: tasks
#   - task.metadata.blocked_questions: array of strings (optional)
#
# Rules:
#   - impl: task -> plan_approved_at MUST be present (exit 2 NO_PLAN_APPROVAL)
#   - any blocked_questions entry -> must mention every escalation field
#     (Phase, Context, Options, Recommendation, Need from you)
#     otherwise exit 2 BAD_ESCALATION: missing field(s) <list>

set -euo pipefail

LOG_DIR="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/hooks"
LOG_FILE="$LOG_DIR/log.jsonl"
mkdir -p "$LOG_DIR"

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

payload="$(cat || true)"

if [ -z "$payload" ]; then
  printf '{"ts":"%s","hook":"task-completed","skipped":"empty payload"}\n' "$ts" >> "$LOG_FILE"
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  printf '{"ts":"%s","hook":"task-completed","skipped":"jq not installed"}\n' "$ts" >> "$LOG_FILE"
  exit 0
fi

title="$(printf '%s' "$payload" | jq -r '.task.title // .title // ""' 2>/dev/null || echo "")"
plan_approved_at="$(printf '%s' "$payload" | jq -r '.task.metadata.plan_approved_at // .metadata.plan_approved_at // ""' 2>/dev/null || echo "")"

printf '{"ts":"%s","hook":"task-completed","title":%s,"plan_approved_at":%s}\n' \
  "$ts" \
  "$(printf '%s' "$title" | jq -Rs .)" \
  "$(printf '%s' "$plan_approved_at" | jq -Rs .)" \
  >> "$LOG_FILE"

case "$title" in
  impl:*)
    if [ -z "$plan_approved_at" ]; then
      echo "NO_PLAN_APPROVAL: impl: tasks require metadata.plan_approved_at before completion (title: $title)" >&2
      exit 2
    fi
    ;;
esac

# Validate escalation entries if present.
required_fields=("Phase" "Context" "Options" "Recommendation" "Need from you")
missing_any=""
entries="$(printf '%s' "$payload" | jq -c '(.task.metadata.blocked_questions // .metadata.blocked_questions // [])[]?' 2>/dev/null || true)"

if [ -n "$entries" ]; then
  while IFS= read -r entry; do
    [ -z "$entry" ] && continue
    raw="$(printf '%s' "$entry" | jq -r '.' 2>/dev/null || printf '%s' "$entry")"
    missing=""
    for field in "${required_fields[@]}"; do
      if ! printf '%s' "$raw" | grep -qE "(^|[^A-Za-z])${field}[[:space:]]*:"; then
        if [ -z "$missing" ]; then
          missing="$field"
        else
          missing="$missing, $field"
        fi
      fi
    done
    if [ -n "$missing" ]; then
      if [ -z "$missing_any" ]; then
        missing_any="$missing"
      else
        missing_any="$missing_any | $missing"
      fi
    fi
  done <<< "$entries"
fi

if [ -n "$missing_any" ]; then
  echo "BAD_ESCALATION: missing field(s) $missing_any" >&2
  exit 2
fi

exit 0
