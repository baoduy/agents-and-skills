#!/usr/bin/env bash
# TaskCompleted hook — gate implementation completions on plan approval and
# validate any embedded escalation entries.
#
# Accepts a JSON payload on stdin with at minimum:
#   - task.title: string
#   - task.metadata.plan_approved_at: string (ISO datetime), required for impl: tasks
#   - task.metadata.blocked_questions: array of strings (optional)
#   - task.metadata.commits: array of git SHAs (optional, used by v2 checks)
#   - task.metadata.contract_files: array of paths (optional, for contract-publish)
#
# v2 rules added on top of v1:
#   - impl:be-migration-* completions: refuse if another in-progress migration
#     exists in the shared task list payload (anti-race).
#   - impl:be-contract-publish-* completions: at least one commit on this task
#     must touch a contracts file (default `contracts/` directory, or paths
#     listed in metadata.contract_files). Verified via `git show --name-only`.

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

# v2: migration serialization. If this is a migration task, verify no other
# `impl:be-migration-*` task is currently in_progress in the shared task list
# (payload.tasks[]). The lead also enforces this; the hook is a backstop.
case "$title" in
  impl:be-migration-*)
    other_in_progress="$(printf '%s' "$payload" | jq -r --arg me "$title" '
      [ .tasks[]?
        | select((.title // "") != $me)
        | select(((.title // "") | startswith("impl:be-migration-")))
        | select((.status // "") == "in_progress")
      ] | length' 2>/dev/null || echo 0)"
    if [ "${other_in_progress:-0}" -gt 0 ]; then
      echo "MIGRATION_RACE: another impl:be-migration-* task is in_progress; migrations must serialize. (title: $title)" >&2
      exit 2
    fi
    ;;
esac

# v2: contract-publish must actually touch a contracts file in at least one
# of its commits. Best-effort: skip if git unavailable or no commits recorded.
case "$title" in
  impl:be-contract-publish-*)
    if command -v git >/dev/null 2>&1; then
      commits="$(printf '%s' "$payload" | jq -r '(.task.metadata.commits // .metadata.commits // [])[]?' 2>/dev/null || true)"
      patterns="$(printf '%s' "$payload" | jq -r '(.task.metadata.contract_files // .metadata.contract_files // ["contracts/"])[]?' 2>/dev/null || echo "contracts/")"
      if [ -n "$commits" ]; then
        touched=0
        while IFS= read -r sha; do
          [ -z "$sha" ] && continue
          files="$(git show --no-color --name-only --pretty=format: "$sha" 2>/dev/null || true)"
          while IFS= read -r pat; do
            [ -z "$pat" ] && continue
            if printf '%s\n' "$files" | grep -qE "(^|/)${pat//./\\.}"; then
              touched=1; break 2
            fi
          done <<< "$patterns"
        done <<< "$commits"
        if [ "$touched" -ne 1 ]; then
          echo "EMPTY_CONTRACT_PUBLISH: $title claims to publish a contract but no commit touches a contract file (looked for: $(echo "$patterns" | tr '\n' ' '))" >&2
          exit 2
        fi
      fi
    fi
    ;;
esac

# Validate escalation entries if present.
required_fields=("Phase" "Context" "Options" "Recommendation" "Need from you" "Peer attempts")
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
