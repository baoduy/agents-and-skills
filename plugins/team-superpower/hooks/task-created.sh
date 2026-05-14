#!/usr/bin/env bash
# TaskCreated hook — enforce title prefix on shared task list entries.
#
# Accepts a JSON payload on stdin. Required field:
#   - task.title: string
#
# Title MUST start with one of: impl:, review:, meta:, block:
# v2 additions:
#   - impl: tasks MUST carry a sub-prefix (be-, fe-, qa-fix-be-, qa-fix-fe-,
#     review-fix-be-, review-fix-fe-, contract-update-, be-migration-,
#     be-contract-publish-) — bare `impl:foo` is rejected.
#   - Shape-marker file at docs/superpowers/sessions/<slug>.shape (written by
#     the lead in phase 0) restricts which sub-prefixes are allowed:
#       be-only      → only `impl:be-*`, `impl:contract-update-*` allowed
#       fe-only      → only `impl:fe-*`, `impl:contract-update-*` allowed
#       full-stack   → all sub-prefixes allowed
#   - Slug is taken from .task.metadata.slug or .metadata.slug, with fallback
#     to the most-recent .shape file when only one exists.

set -euo pipefail

LOG_DIR="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/hooks"
LOG_FILE="$LOG_DIR/log.jsonl"
SESSIONS_DIR="${CLAUDE_PROJECT_DIR:-$PWD}/docs/superpowers/sessions"
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
slug="$(printf '%s' "$payload" | jq -r '.task.metadata.slug // .metadata.slug // ""' 2>/dev/null || echo "")"

# Resolve shape from the slug's marker file. If slug is unknown but exactly
# one .shape file exists, use it (single in-flight feature is the common case).
shape=""
if [ -d "$SESSIONS_DIR" ]; then
  shape_file=""
  if [ -n "$slug" ] && [ -f "$SESSIONS_DIR/$slug.shape" ]; then
    shape_file="$SESSIONS_DIR/$slug.shape"
  else
    count="$(find "$SESSIONS_DIR" -maxdepth 1 -type f -name '*.shape' 2>/dev/null | wc -l | tr -d ' ')"
    if [ "$count" = "1" ]; then
      shape_file="$(find "$SESSIONS_DIR" -maxdepth 1 -type f -name '*.shape' 2>/dev/null | head -n1)"
    fi
  fi
  if [ -n "$shape_file" ] && [ -f "$shape_file" ]; then
    shape="$(head -n1 "$shape_file" | tr -d '[:space:]')"
  fi
fi

printf '{"ts":"%s","hook":"task-created","title":%s,"shape":%s}\n' \
  "$ts" \
  "$(printf '%s' "$title" | jq -Rs .)" \
  "$(printf '%s' "$shape" | jq -Rs .)" \
  >> "$LOG_FILE"

# Top-level prefix check
case "$title" in
  review:*|meta:*|block:*) exit 0 ;;
  impl:*) ;;
  "")
    printf '{"ts":"%s","hook":"task-created","warn":"bad_prefix","reason":"title missing"}\n' "$ts" >> "$LOG_FILE"
    ;;
  *)
    printf '{"ts":"%s","hook":"task-created","warn":"bad_prefix","title":%s}\n' "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
    ;;
esac

# At this point title starts with `impl:`. Strip prefix and require a known
# sub-prefix.
rest="${title#impl:}"
case "$rest" in
  be-*|qa-fix-be-*|review-fix-be-*|be-migration-*|be-contract-publish-*)
    sub="be"
    ;;
  fe-*|qa-fix-fe-*|review-fix-fe-*)
    sub="fe"
    ;;
  contract-update-*)
    sub="contract"
    ;;
  *)
    echo "BAD_PREFIX: impl: task requires a sub-prefix (be-|fe-|qa-fix-be-|qa-fix-fe-|review-fix-be-|review-fix-fe-|contract-update-|be-migration-|be-contract-publish-). Got: $title" >&2
    exit 2 ;;
esac

# Shape-aware enforcement
case "$shape" in
  be-only)
    if [ "$sub" = "fe" ]; then
      echo "SHAPE_REJECTED: shape is 'be-only'; impl:fe-* tasks are not allowed for this feature." >&2
      exit 2
    fi
    ;;
  fe-only)
    if [ "$sub" = "be" ]; then
      echo "SHAPE_REJECTED: shape is 'fe-only'; impl:be-* tasks are not allowed for this feature." >&2
      exit 2
    fi
    ;;
  full-stack|"")
    # full-stack: anything goes. Empty shape: hook can't tell — accept and
    # let the lead serialize/validate. Logged above for tuning.
    ;;
esac

exit 0
