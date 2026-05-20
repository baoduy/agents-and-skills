#!/usr/bin/env bash
# TeammateIdle hook — v5 role-aware routing.
#
# Reads the hook event payload from stdin. Expected JSON fields:
#   - mailbox: array of { from, kind, replied, ... } — recent SendMessage history
#   - teammate: string (the idling teammate's role; one of
#       orchestrator | team-leader | solution-architect | feature-planner |
#       security-engineer | backend-developer | frontend-developer | qc-engineer)
#
# v5 behaviour: routing depends on role.
#
#   backend-developer / frontend-developer:
#     - block if any unanswered message FROM team-leader (implementer owes a reply)
#     - block if a self-sent ESCALATE has no reply within heartbeat (advisory log)
#     - otherwise advisory: wave dispatch may still be in flight; ok to idle
#
#   team-leader:
#     - block if SPAWN_REQUEST or RESTART_REQUEST has no SPAWN_DONE / RESTART_DONE
#       reply from lead/orchestrator within heartbeat (must keep coordinating)
#     - block if any unanswered ESCALATE from an implementer (must route)
#     - otherwise advisory tick
#
#   qc-engineer:
#     - block if QC_REWORK_NEEDED has no reply (lead must acknowledge before shutdown)
#     - otherwise advisory tick
#
#   solution-architect / feature-planner / security-engineer (phase A roles):
#     - block if owner sign-off touchpoint message has no reply yet
#     - otherwise advisory tick (shutdown is owner-driven via lead)
#
#   orchestrator (lead):
#     - block if any unanswered SPAWN_REQUEST / RESTART_REQUEST inbound from
#       team-leader (lead is the single spawner)
#     - otherwise advisory tick (lead drives owner touchpoints separately)
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

teammate="$(printf '%s' "$payload" | jq -r '.teammate // ""' 2>/dev/null || echo "")"

# Helper: count unanswered inbound messages where .from matches a pattern.
count_unanswered_from() {
  local from_pattern="$1"
  printf '%s' "$payload" \
    | jq --arg p "$from_pattern" \
        '[.mailbox[]?
          | select(((.from // "") | test($p)))
          | select((.replied // false) == false)
         ] | length' \
        2>/dev/null \
    || echo 0
}

# Helper: count self-sent outbound messages of a given kind with no reply yet.
count_outbound_unanswered_kind() {
  local kind_pattern="$1"
  printf '%s' "$payload" \
    | jq --arg k "$kind_pattern" \
        '[.mailbox[]?
          | select(((.direction // "in") == "out"))
          | select(((.kind // "") | test($k)))
          | select((.replied // false) == false)
         ] | length' \
        2>/dev/null \
    || echo 0
}

warn=""

case "$teammate" in
  backend-developer|frontend-developer)
    unanswered_from_leader="$(count_unanswered_from '^team-leader$')"
    if [ "${unanswered_from_leader:-0}" -gt 0 ]; then
      warn="BLOCKED_IDLE_implementer_owes_team-leader_reply"
    fi
    ;;
  team-leader)
    spawn_pending="$(count_outbound_unanswered_kind 'SPAWN_REQUEST|RESTART_REQUEST')"
    escalate_pending="$(count_unanswered_from '^(backend-developer|frontend-developer)$')"
    if [ "${spawn_pending:-0}" -gt 0 ]; then
      warn="BLOCKED_IDLE_team-leader_awaiting_lead_on_spawn_or_restart"
    elif [ "${escalate_pending:-0}" -gt 0 ]; then
      warn="BLOCKED_IDLE_team-leader_owes_implementer_escalate_reply"
    fi
    ;;
  qc-engineer)
    qc_pending="$(count_outbound_unanswered_kind 'QC_REWORK_NEEDED')"
    if [ "${qc_pending:-0}" -gt 0 ]; then
      warn="BLOCKED_IDLE_qc-engineer_awaiting_lead_ack"
    fi
    ;;
  solution-architect|feature-planner|security-engineer)
    handover_pending="$(count_outbound_unanswered_kind 'HANDOVER_READY|SEC_PASSED|SEC_BLOCKED')"
    if [ "${handover_pending:-0}" -gt 0 ]; then
      warn="BLOCKED_IDLE_phaseA_awaiting_owner_signoff"
    fi
    ;;
  orchestrator)
    lead_inbound_pending="$(count_unanswered_from '^team-leader$')"
    if [ "${lead_inbound_pending:-0}" -gt 0 ]; then
      warn="BLOCKED_IDLE_orchestrator_unhandled_team-leader_request"
    fi
    ;;
  "")
    # Unknown role: fall back to legacy v4 behaviour (any unanswered non-lead inbound).
    legacy_unanswered="$(printf '%s' "$payload" | jq '[.mailbox[]? | select((.from // "") != "lead") | select((.replied // false) == false)] | length' 2>/dev/null || echo 0)"
    if [ "${legacy_unanswered:-0}" -gt 0 ]; then
      warn="BLOCKED_IDLE_legacy_unanswered_inbound"
    fi
    ;;
  *)
    # Unknown but non-empty role — log advisory only, do not block.
    :
    ;;
esac

if [ -n "$warn" ]; then
  printf '{"ts":"%s","hook":"teammate-idle","teammate":%s,"warn":%s}\n' \
    "$ts" \
    "$(printf '%s' "$teammate" | jq -Rs .)" \
    "$(printf '%s' "$warn" | jq -Rs .)" \
    >> "$LOG_FILE"
else
  printf '{"ts":"%s","hook":"teammate-idle","teammate":%s,"ok":true}\n' \
    "$ts" \
    "$(printf '%s' "$teammate" | jq -Rs .)" \
    >> "$LOG_FILE"
fi

exit 0
