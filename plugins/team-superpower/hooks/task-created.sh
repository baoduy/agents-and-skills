#!/usr/bin/env bash
# TaskCreated hook — v5 prefix + wave validation for shared task list entries.
#
# Accepts a JSON payload on stdin. Required field:
#   - task.title: string
#
# v5 changes (delta from v4):
#   - ADDED: impl:rework-* allowed top-level. Rework tasks dispatched by
#     team-leader (phase-end SOLID/DRY review) or qc-engineer (end-of-plan QC)
#     do not carry a be-/fe- prefix; their original-task id is in the
#     `Reworks:` line of the implementer's commit body and validated by
#     task-completed.sh.
#   - ADDED: INVALID_WAVE_REFERENCE — v5 waves are dotted strings, not single
#     integers. Accepted shapes: "<plan-phase>.<wave>" (e.g. "1.1", "2.3"),
#     "<plan-phase>.rework" (e.g. "1.rework"), or "qc-rework".
#   - REMOVED: qa-fix-be-, qa-fix-fe-, review-fix-be-, review-fix-fe- prefixes
#     (v4 QA loop is gone). Use impl:rework-* instead.
#   - REMOVED: bare integer wave format.
#
# Preserved checks:
#   - Top-level prefix must be impl: / review: / meta: / block:.
#   - impl:* must carry a known sub-prefix per the shape file.
#   - solo-mode guard: impl:* invalid when checkpoint mode is solo.
#   - Shape-marker file at docs/superpowers/sessions/<slug>.shape restricts
#     allowed sub-prefixes (be-only / fe-only / full-stack).

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

wave="$(printf '%s' "$payload" | jq -r '.task.metadata.wave // .metadata.wave // ""' 2>/dev/null || echo "")"

printf '{"ts":"%s","hook":"task-created","title":%s,"shape":%s,"wave":%s}\n' \
  "$ts" \
  "$(printf '%s' "$title" | jq -Rs .)" \
  "$(printf '%s' "$shape" | jq -Rs .)" \
  "$(printf '%s' "$wave" | jq -Rs .)" \
  >> "$LOG_FILE"

# Top-level prefix check
case "$title" in
  review:*|meta:*|block:*) exit 0 ;;
  impl:*) ;;
  "")
    printf '{"ts":"%s","hook":"task-created","warn":"bad_prefix","reason":"title missing"}\n' "$ts" >> "$LOG_FILE"
    exit 0
    ;;
  *)
    printf '{"ts":"%s","hook":"task-created","warn":"bad_prefix","title":%s}\n' "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
    exit 0
    ;;
esac

# v3: solo-mode guard. If checkpoint mode is solo, impl:* tasks are invalid.
mode_meta="$(printf '%s' "$payload" | jq -r '.task.metadata.mode // .metadata.mode // ""' 2>/dev/null || echo "")"
mode_marker=""
if [ -z "$mode_meta" ] && [ -d "$SESSIONS_DIR" ]; then
  marker_file=""
  if [ -n "$slug" ] && [ -f "$SESSIONS_DIR/$slug.mode" ]; then
    marker_file="$SESSIONS_DIR/$slug.mode"
  else
    count="$(find "$SESSIONS_DIR" -maxdepth 1 -type f -name '*.mode' 2>/dev/null | wc -l | tr -d ' ')"
    if [ "$count" = "1" ]; then
      marker_file="$(find "$SESSIONS_DIR" -maxdepth 1 -type f -name '*.mode' 2>/dev/null | head -n1)"
    fi
  fi
  if [ -n "$marker_file" ] && [ -f "$marker_file" ]; then
    mode_marker="$(head -n1 "$marker_file" | tr -d '[:space:]')"
  fi
fi
effective_mode="${mode_meta:-$mode_marker}"

if [ "$effective_mode" = "solo" ]; then
  printf '{"ts":"%s","hook":"task-created","warn":"INVALID_FOR_SOLO_MODE","title":%s}\n' \
    "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
fi

# v5 INVALID_WAVE_REFERENCE: wave metadata is required and must match the v5 shape.
if [ -z "$wave" ]; then
  printf '{"ts":"%s","hook":"task-created","warn":"INVALID_WAVE_REFERENCE","title":%s,"reason":"wave metadata missing"}\n' \
    "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
elif ! printf '%s' "$wave" | grep -qE '^([0-9]+\.[0-9]+|[0-9]+\.rework|qc-rework)$'; then
  printf '{"ts":"%s","hook":"task-created","warn":"INVALID_WAVE_REFERENCE","title":%s,"wave":%s,"reason":"unrecognised wave shape"}\n' \
    "$ts" \
    "$(printf '%s' "$title" | jq -Rs .)" \
    "$(printf '%s' "$wave" | jq -Rs .)" \
    >> "$LOG_FILE"
fi

# At this point title starts with `impl:`. Strip prefix and require a known
# v5 sub-prefix.
rest="${title#impl:}"
case "$rest" in
  rework-*)
    # Rework tasks dispatched by team-leader (phase-end review) or qc-engineer
    # (end-of-plan QC). The Reworks: <orig-id> line in the commit body is
    # validated by task-completed.sh (MISSING_REWORK_REFERENCE). No shape check
    # — rework inherits the originating task's scope.
    sub="rework"
    ;;
  be-*|be-migration-*|be-contract-publish-*)
    sub="be"
    ;;
  fe-*)
    sub="fe"
    ;;
  contract-update-*)
    sub="contract"
    ;;
  *)
    printf '{"ts":"%s","hook":"task-created","warn":"bad_subprefix","title":%s}\n' "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
    exit 0
    ;;
esac

# Shape-aware enforcement. rework + contract-update are scope-neutral and
# allowed under any shape — they inherit scope from the originating task or
# from BE ownership of the contract.
case "$shape" in
  be-only)
    if [ "$sub" = "fe" ]; then
      printf '{"ts":"%s","hook":"task-created","warn":"shape_rejected","shape":"be-only","title":%s}\n' "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
    fi
    ;;
  fe-only)
    if [ "$sub" = "be" ]; then
      printf '{"ts":"%s","hook":"task-created","warn":"shape_rejected","shape":"fe-only","title":%s}\n' "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
    fi
    ;;
  full-stack|"")
    # full-stack: anything goes. Empty shape: hook can't tell — accept and
    # let the lead serialize/validate. Logged above for tuning.
    ;;
esac

exit 0
