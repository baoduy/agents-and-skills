#!/usr/bin/env bash
# TaskCompleted hook — v5 gate for implementation completions.
#
# Accepts a JSON payload on stdin with at minimum:
#   - task.title: string
#   - task.metadata.wave: string (e.g. "1.1", "1.rework", "qc-rework")
#   - task.metadata.iteration_count: integer (optional)
#   - task.metadata.reflection: string (optional, required when iteration_count > cap)
#   - task.metadata.retrieval_requests: integer (optional)
#   - task.metadata.commits: array of git SHAs (optional)
#   - task.metadata.contract_files: array of paths (optional, for contract-publish)
#
# v5 checks (delta from v4):
#   - REMOVED: per-task QA verification (qa_verified_at, QA-verified commit line, qa_rounds cap, trivial=true claims)
#   - REMOVED: 6-field escalation template validation (Phase/Context/Options/Recommendation/Need from you/Peer attempts)
#   - REMOVED: v4 wave format (single integer); v5 wave is dotted (e.g. "1.1") or rework label
#   - ADDED: MISSING_STATIC_CHECKS — every impl:* task must have a .team-superpower/static-check-<task-id>.log
#     containing exit=0 for all sections (lint, format, typecheck).
#   - ADDED: MISSING_REWORK_REFERENCE — every impl:rework-* task must have a `Reworks: <orig-id>` line
#     in at least one commit body.
#
# v5 preserved checks:
#   - migration serialization (impl:*-migration-* anti-race)
#   - contract-publish must touch a contracts file
#   - AGENTS.md protection (no agent commit may touch docs/superpowers/AGENTS.md)
#   - retrieval budget cap + premature Flagged-assumptions guard
#   - MAX_ITERATIONS guardrail

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

printf '{"ts":"%s","hook":"task-completed","title":%s}\n' \
  "$ts" \
  "$(printf '%s' "$title" | jq -Rs .)" \
  >> "$LOG_FILE"

# Resolve parse-claudemd.sh helper for limits.* lookups.
parse_helper="${CLAUDE_PLUGIN_ROOT:-}/scripts/parse-claudemd.sh"
if [ -z "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  parse_helper="$hook_dir/../scripts/parse-claudemd.sh"
fi

# v5: wave metadata. impl:* tasks must carry a `wave:` string. Accepted shapes:
#   - "<plan-phase>.<wave>"  e.g. "1.1", "2.3"
#   - "<plan-phase>.rework"  e.g. "1.rework"
#   - "qc-rework"
case "$title" in
  impl:*)
    wave="$(printf '%s' "$payload" | jq -r '.task.metadata.wave // .metadata.wave // ""' 2>/dev/null || echo "")"
    if [ -z "$wave" ] || ! printf '%s' "$wave" | grep -qE '^([0-9]+\.[0-9]+|[0-9]+\.rework|qc-rework)$'; then
      printf '{"ts":"%s","hook":"task-completed","warn":"MISSING_WAVE_METADATA","title":%s,"wave":%s}\n' \
        "$ts" \
        "$(printf '%s' "$title" | jq -Rs .)" \
        "$(printf '%s' "$wave" | jq -Rs .)" \
        >> "$LOG_FILE"
    fi
    ;;
esac

# v5 check 10: MISSING_STATIC_CHECKS. Every impl:* task must have a
# .team-superpower/static-check-<task-id>.log with exit=0 across lint/format/typecheck.
case "$title" in
  impl:*)
    project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
    static_log="$project_dir/.team-superpower/static-check-${title}.log"
    if [ ! -f "$static_log" ]; then
      printf '{"ts":"%s","hook":"task-completed","warn":"MISSING_STATIC_CHECKS","title":%s,"reason":"log file not found","path":%s}\n' \
        "$ts" \
        "$(printf '%s' "$title" | jq -Rs .)" \
        "$(printf '%s' "$static_log" | jq -Rs .)" \
        >> "$LOG_FILE"
    else
      # Any exit= line with a non-zero value fails the check.
      if grep -E '^exit=' "$static_log" | grep -qvE '^exit=0$'; then
        bad="$(grep -E '^exit=' "$static_log" | grep -vE '^exit=0$' | head -n1 || true)"
        printf '{"ts":"%s","hook":"task-completed","warn":"MISSING_STATIC_CHECKS","title":%s,"reason":"non-zero exit","line":%s}\n' \
          "$ts" \
          "$(printf '%s' "$title" | jq -Rs .)" \
          "$(printf '%s' "$bad" | jq -Rs .)" \
          >> "$LOG_FILE"
      fi
    fi
    ;;
esac

# v5 check 11: MISSING_REWORK_REFERENCE. impl:rework-* tasks must carry a
# `Reworks: <orig-id-or-qc-issue-id>` line in at least one commit body.
case "$title" in
  impl:rework-*)
    if command -v git >/dev/null 2>&1; then
      rw_commits="$(printf '%s' "$payload" | jq -r '(.task.metadata.commits // .metadata.commits // [])[]?' 2>/dev/null || true)"
      if [ -n "$rw_commits" ]; then
        rw_found=0
        while IFS= read -r sha; do
          [ -z "$sha" ] && continue
          body="$(git show --no-color --no-patch --format=%B "$sha" 2>/dev/null || true)"
          if printf '%s\n' "$body" | grep -qE '^Reworks:[[:space:]]*[^[:space:]]+'; then
            rw_found=1; break
          fi
        done <<< "$rw_commits"
        if [ "$rw_found" -ne 1 ]; then
          printf '{"ts":"%s","hook":"task-completed","warn":"MISSING_REWORK_REFERENCE","title":%s,"reason":"no Reworks: line in commit body"}\n' \
            "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
        fi
      else
        printf '{"ts":"%s","hook":"task-completed","warn":"MISSING_REWORK_REFERENCE","title":%s,"reason":"no commits recorded"}\n' \
          "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
      fi
    fi
    ;;
esac

# MAX_ITERATIONS guardrail (preserved from v3/v4).
case "$title" in
  impl:*)
    iteration_count="$(printf '%s' "$payload" | jq -r '.task.metadata.iteration_count // .metadata.iteration_count // 0' 2>/dev/null || echo 0)"
    reflection="$(printf '%s' "$payload" | jq -r '.task.metadata.reflection // .metadata.reflection // ""' 2>/dev/null || echo "")"

    cap=8
    if [ -f "$parse_helper" ] && [ -f "${CLAUDE_PROJECT_DIR:-$PWD}/CLAUDE.md" ]; then
      configured="$(bash "$parse_helper" get limits.max_iterations_per_task "${CLAUDE_PROJECT_DIR:-$PWD}/CLAUDE.md" 2>/dev/null || true)"
      if [ -n "$configured" ] && printf '%s' "$configured" | grep -qE '^[0-9]+$'; then
        cap="$configured"
      fi
    fi

    if [ "${iteration_count:-0}" -gt "$cap" ] && [ -z "$reflection" ]; then
      printf '{"ts":"%s","hook":"task-completed","warn":"ITERATION_CAP_EXCEEDED","title":%s,"iteration_count":%d,"cap":%d}\n' \
        "$ts" \
        "$(printf '%s' "$title" | jq -Rs .)" \
        "$iteration_count" \
        "$cap" \
        >> "$LOG_FILE"
    fi
    ;;
esac

# Retrieval budget (preserved from v4).
case "$title" in
  impl:*)
    retrieval_requests="$(printf '%s' "$payload" | jq -r '.task.metadata.retrieval_requests // .metadata.retrieval_requests // 0' 2>/dev/null || echo 0)"
    retrieval_cap=2
    if [ -f "$parse_helper" ] && [ -f "${CLAUDE_PROJECT_DIR:-$PWD}/CLAUDE.md" ]; then
      configured_r="$(bash "$parse_helper" get limits.retrieval_budget_per_task "${CLAUDE_PROJECT_DIR:-$PWD}/CLAUDE.md" 2>/dev/null || true)"
      if [ -n "$configured_r" ] && printf '%s' "$configured_r" | grep -qE '^[0-9]+$'; then
        retrieval_cap="$configured_r"
      fi
    fi

    if [ "${retrieval_requests:-0}" -gt "$retrieval_cap" ]; then
      printf '{"ts":"%s","hook":"task-completed","warn":"RETRIEVAL_BUDGET_EXCEEDED","title":%s,"requests":%d,"cap":%d}\n' \
        "$ts" "$(printf '%s' "$title" | jq -Rs .)" "$retrieval_requests" "$retrieval_cap" >> "$LOG_FILE"
    fi

    if command -v git >/dev/null 2>&1; then
      r_commits="$(printf '%s' "$payload" | jq -r '(.task.metadata.commits // .metadata.commits // [])[]?' 2>/dev/null || true)"
      if [ -n "$r_commits" ]; then
        flagged=0
        while IFS= read -r sha; do
          [ -z "$sha" ] && continue
          body="$(git show --no-color --no-patch --format=%B "$sha" 2>/dev/null || true)"
          if printf '%s\n' "$body" | grep -qE '^Flagged-assumptions:'; then
            flagged=1; break
          fi
        done <<< "$r_commits"
        if [ "$flagged" -eq 1 ] && [ "${retrieval_requests:-0}" -lt "$retrieval_cap" ]; then
          printf '{"ts":"%s","hook":"task-completed","warn":"PREMATURE_ASSUMPTION_FLAG","title":%s,"requests":%d,"cap":%d}\n' \
            "$ts" "$(printf '%s' "$title" | jq -Rs .)" "$retrieval_requests" "$retrieval_cap" >> "$LOG_FILE"
        fi
      fi
    fi
    ;;
esac

# AGENTS.md protection (preserved from v4).
if command -v git >/dev/null 2>&1; then
  agm_commits="$(printf '%s' "$payload" | jq -r '(.task.metadata.commits // .metadata.commits // [])[]?' 2>/dev/null || true)"
  if [ -n "$agm_commits" ]; then
    while IFS= read -r sha; do
      [ -z "$sha" ] && continue
      files="$(git show --no-color --name-only --pretty=format: "$sha" 2>/dev/null || true)"
      if printf '%s\n' "$files" | grep -qE '^docs/superpowers/AGENTS\.md$'; then
        printf '{"ts":"%s","hook":"task-completed","warn":"AGENT_WROTE_AGENTS_MD","title":%s,"sha":%s}\n' \
          "$ts" "$(printf '%s' "$title" | jq -Rs .)" "$(printf '%s' "$sha" | jq -Rs .)" >> "$LOG_FILE"
      fi
    done <<< "$agm_commits"
  fi
fi

# Migration serialization (preserved). v5 widens the prefix match: any task
# whose title contains the qualifier `-migration-` (e.g. impl:be-migration-*,
# impl:rework-be-migration-*) is migration-class.
case "$title" in
  *-migration-*)
    other_in_progress="$(printf '%s' "$payload" | jq -r --arg me "$title" '
      [ .tasks[]?
        | select((.title // "") != $me)
        | select(((.title // "") | contains("-migration-")))
        | select((.status // "") == "in_progress")
      ] | length' 2>/dev/null || echo 0)"
    if [ "${other_in_progress:-0}" -gt 0 ]; then
      printf '{"ts":"%s","hook":"task-completed","warn":"MIGRATION_RACE","title":%s}\n' "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
    fi
    ;;
esac

# Contract-publish must touch a contracts file (preserved). v5 widens to any
# task whose title contains the qualifier `-contract-publish-`.
case "$title" in
  *-contract-publish-*)
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
          printf '{"ts":"%s","hook":"task-completed","warn":"EMPTY_CONTRACT_PUBLISH","title":%s}\n' "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
        fi
      fi
    fi
    ;;
esac

exit 0
