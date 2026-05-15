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
      printf '{"ts":"%s","hook":"task-completed","warn":"no_plan_approval","title":%s}\n' "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
    fi
    ;;
esac

# v3: wave metadata. impl:* tasks must carry a `wave:` integer (planner sets
# it; the lead mirrors it into shared-task-list metadata at dispatch time).
case "$title" in
  impl:*)
    wave="$(printf '%s' "$payload" | jq -r '.task.metadata.wave // .metadata.wave // ""' 2>/dev/null || echo "")"
    if [ -z "$wave" ] || ! printf '%s' "$wave" | grep -qE '^[0-9]+$'; then
      printf '{"ts":"%s","hook":"task-completed","warn":"MISSING_WAVE_METADATA","title":%s}\n' \
        "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
    fi
    ;;
esac

# v3: MAX_ITERATIONS guardrail. impl:* completions whose iteration_count
# exceeds the per-project cap (default 8) must carry a reflection: block.
case "$title" in
  impl:*)
    iteration_count="$(printf '%s' "$payload" | jq -r '.task.metadata.iteration_count // .metadata.iteration_count // 0' 2>/dev/null || echo 0)"
    reflection="$(printf '%s' "$payload" | jq -r '.task.metadata.reflection // .metadata.reflection // ""' 2>/dev/null || echo "")"

    cap=8
    parse_helper="${CLAUDE_PLUGIN_ROOT:-}/scripts/parse-claudemd.sh"
    if [ -z "${CLAUDE_PLUGIN_ROOT:-}" ]; then
      # Fall back to a relative path the hook can find when CLAUDE_PLUGIN_ROOT is unset.
      hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
      parse_helper="$hook_dir/../scripts/parse-claudemd.sh"
    fi
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

# v4: per-task QA verification. impl:* completions must carry
# `qa_verified_at:` metadata AND a `QA-verified: round=N` line in at least one
# commit message body (N ≤ max_qa_rounds_per_task, default 3). The hook also
# rejects `trivial=true` claims for diffs >20 lines or new-file additions, and
# rejects `qa_rounds: 3` escalations missing the cross-role fields.
case "$title" in
  impl:*)
    qa_verified_at="$(printf '%s' "$payload" | jq -r '.task.metadata.qa_verified_at // .metadata.qa_verified_at // ""' 2>/dev/null || echo "")"
    qa_rounds="$(printf '%s' "$payload" | jq -r '.task.metadata.qa_rounds // .metadata.qa_rounds // 0' 2>/dev/null || echo 0)"
    trivial_claim="$(printf '%s' "$payload" | jq -r '.task.metadata.trivial // .metadata.trivial // false' 2>/dev/null || echo false)"

    qa_cap=3
    if [ -f "$parse_helper" ] && [ -f "${CLAUDE_PROJECT_DIR:-$PWD}/CLAUDE.md" ]; then
      configured_qa="$(bash "$parse_helper" get limits.max_qa_rounds_per_task "${CLAUDE_PROJECT_DIR:-$PWD}/CLAUDE.md" 2>/dev/null || true)"
      if [ -n "$configured_qa" ] && printf '%s' "$configured_qa" | grep -qE '^[0-9]+$'; then
        qa_cap="$configured_qa"
      fi
    fi

    # Check 7a: qa_verified_at metadata present.
    if [ -z "$qa_verified_at" ]; then
      printf '{"ts":"%s","hook":"task-completed","warn":"MISSING_QA_VERIFICATION","title":%s,"reason":"qa_verified_at metadata missing"}\n' \
        "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
    fi

    # Check 7b: QA-verified: round=N commit body line, verified via git log if commits recorded.
    if command -v git >/dev/null 2>&1; then
      qa_commits="$(printf '%s' "$payload" | jq -r '(.task.metadata.commits // .metadata.commits // [])[]?' 2>/dev/null || true)"
      if [ -n "$qa_commits" ]; then
        qa_line_found=0
        qa_round_observed=0
        while IFS= read -r sha; do
          [ -z "$sha" ] && continue
          body="$(git show --no-color --no-patch --format=%B "$sha" 2>/dev/null || true)"
          line="$(printf '%s\n' "$body" | grep -E '^QA-verified:[[:space:]]*round=[0-9]+' | head -n1 || true)"
          if [ -n "$line" ]; then
            qa_line_found=1
            n="$(printf '%s' "$line" | sed -nE 's/^QA-verified:[[:space:]]*round=([0-9]+).*/\1/p')"
            if [ -n "$n" ] && [ "$n" -gt "$qa_round_observed" ]; then
              qa_round_observed="$n"
            fi
          fi
        done <<< "$qa_commits"
        if [ "$qa_line_found" -ne 1 ]; then
          printf '{"ts":"%s","hook":"task-completed","warn":"MISSING_QA_VERIFICATION","title":%s,"reason":"no QA-verified line in commit body"}\n' \
            "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
        elif [ "$qa_round_observed" -gt "$qa_cap" ]; then
          printf '{"ts":"%s","hook":"task-completed","warn":"QA_ROUND_OVER_CAP","title":%s,"round":%d,"cap":%d}\n' \
            "$ts" "$(printf '%s' "$title" | jq -Rs .)" "$qa_round_observed" "$qa_cap" >> "$LOG_FILE"
        fi
      fi
    fi

    # Check 8: qa_rounds at cap requires §7 cross-role escalation.
    if [ "${qa_rounds:-0}" -ge "$qa_cap" ] && [ -z "$qa_verified_at" ]; then
      # An escalation entry tagged class:cross-role with qa_rounds, what_failed, one_change_to_fix must be present.
      escalation_ok=0
      escalation_entries="$(printf '%s' "$payload" | jq -c '(.task.metadata.blocked_questions // .metadata.blocked_questions // [])[]?' 2>/dev/null || true)"
      if [ -n "$escalation_entries" ]; then
        while IFS= read -r entry; do
          [ -z "$entry" ] && continue
          raw="$(printf '%s' "$entry" | jq -r '.' 2>/dev/null || printf '%s' "$entry")"
          if printf '%s' "$raw" | grep -qE 'class[[:space:]]*:[[:space:]]*cross-role' \
            && printf '%s' "$raw" | grep -qE 'qa_rounds[[:space:]]*:' \
            && printf '%s' "$raw" | grep -qE 'what_failed[[:space:]]*:' \
            && printf '%s' "$raw" | grep -qE 'one_change_to_fix[[:space:]]*:'; then
            escalation_ok=1
            break
          fi
        done <<< "$escalation_entries"
      fi
      if [ "$escalation_ok" -ne 1 ]; then
        printf '{"ts":"%s","hook":"task-completed","warn":"QA_CAP_EXCEEDED","title":%s,"qa_rounds":%d,"cap":%d}\n' \
          "$ts" "$(printf '%s' "$title" | jq -Rs .)" "$qa_rounds" "$qa_cap" >> "$LOG_FILE"
      fi
    fi

    # Pre-check: INVALID_TRIVIAL_CLAIM — trivial=true requires diff ≤20 lines AND no new files.
    if [ "$trivial_claim" = "true" ] && command -v git >/dev/null 2>&1; then
      tc_commits="$(printf '%s' "$payload" | jq -r '(.task.metadata.commits // .metadata.commits // [])[]?' 2>/dev/null || true)"
      tc_added=0
      tc_lines=0
      if [ -n "$tc_commits" ]; then
        while IFS= read -r sha; do
          [ -z "$sha" ] && continue
          st="$(git show --no-color --name-status --pretty=format: "$sha" 2>/dev/null || true)"
          if printf '%s\n' "$st" | grep -qE '^A[[:space:]]'; then
            tc_added=1
          fi
          n="$(git show --no-color --shortstat --pretty=format: "$sha" 2>/dev/null | grep -oE '[0-9]+ insertion' | head -n1 | grep -oE '[0-9]+' || echo 0)"
          tc_lines=$((tc_lines + ${n:-0}))
        done <<< "$tc_commits"
        if [ "$tc_added" -eq 1 ] || [ "$tc_lines" -gt 20 ]; then
          printf '{"ts":"%s","hook":"task-completed","warn":"INVALID_TRIVIAL_CLAIM","title":%s,"added_files":%d,"insertions":%d}\n' \
            "$ts" "$(printf '%s' "$title" | jq -Rs .)" "$tc_added" "$tc_lines" >> "$LOG_FILE"
        fi
      fi
    fi
    ;;
esac

# v4: retrieval budget. impl:* tasks may not exceed `retrieval_budget_per_task`
# (default 2). Also: a `Flagged-assumptions:` line in a commit body is only
# permitted when retrieval_requests == budget (cannot flag assumptions
# prematurely without exhausting the budget).
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

# v4: AGENTS.md protection. Agents never write to docs/superpowers/AGENTS.md.
# Reviewer writes only to docs/superpowers/AGENTS.suggestions.md. If any commit
# on this task touches AGENTS.md, warn AGENT_WROTE_AGENTS_MD — the owner is the
# only role that may promote suggestions to AGENTS.md.
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
      printf '{"ts":"%s","hook":"task-completed","warn":"migration_race","title":%s}\n' "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
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
          printf '{"ts":"%s","hook":"task-completed","warn":"empty_contract_publish","title":%s}\n' "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
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
  printf '{"ts":"%s","hook":"task-completed","warn":"bad_escalation","missing":%s}\n' "$ts" "$(printf '%s' "$missing_any" | jq -Rs .)" >> "$LOG_FILE"
fi

exit 0
