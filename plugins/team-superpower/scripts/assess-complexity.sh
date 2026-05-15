#!/usr/bin/env bash
# assess-complexity.sh — encode the team-superpower v3 heuristic ladder.
#
# Inputs:
#   $1 — owner's launch message (required)
#   $2 — repo root (optional, default $PWD); reads CLAUDE.md's
#        security.domain to bias size and stack to seed `shape:`.
#
# Output: YAML on stdout. Always emits `mode:`, `shape:`, `mode_reasoning:`.
# Emits `size:` only when mode == team.
#
# Exit codes:
#   0 — confident decision
#   1 — ambiguous (mode could plausibly be single-agent OR team; defaults to
#       team and notes the ambiguity in mode_reasoning).
#
# This script never spawns or writes outside stdout. The lead handles writes.

set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "usage: assess-complexity.sh <launch-message> [repo-root]" >&2
  exit 2
fi

MSG="$1"
ROOT="${2:-$PWD}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DETECT="$SCRIPT_DIR/detect-stack.sh"
PARSE="$SCRIPT_DIR/parse-claudemd.sh"

lc="$(printf '%s' "$MSG" | tr '[:upper:]' '[:lower:]')"
length="${#MSG}"

# --- Discovery / size keyword tables --------------------------------------

discovery_keywords=(
  "design" "architecture" "system" "flow" "feature" "epic" "refactor"
  "migrate" "migrate to" "replace with" "replace" "rewrite" "redesign"
  "overhaul"
)

trivial_keywords=(
  "fix typo" "typo in" "rename" "rename variable" "update copy"
  "update text" "change wording" "bump version" "update readme"
  "comment out" "add comment" "remove unused" "format" "prettify"
  "lint fix"
)

tiny_scope_phrases=(
  "one line" "single line" "one file" "just change" "quick fix"
  "tiny" "trivial"
)

small_scope_verbs=(
  "add" "create" "new " "introduce" "fix"
)

small_scope_nouns=(
  "endpoint" "/" "component" "field" "column" "validation"
  "bug" "error" "test" "migration" "button" "page" "route"
  "controller" "service"
)

regulated_keywords=(
  "compliance" "audit" "regulatory" "pii" "pci" "gdpr" "hipaa"
)

low_stakes_keywords=(
  "prototype" "spike" "internal-only" "experiment" "poc"
)

team_request_keywords=(
  "team" "agents" "full feature"
)

contains_any() {
  # contains_any <text-lc> <array-name>
  # Compatible with Bash 3.2 (no namerefs).
  local txt="$1"
  local arr_name="$2"
  eval 'local kw; for kw in "${'"$arr_name"'[@]}"; do
    case "$txt" in *"$kw"*) return 0 ;; esac
  done'
  return 1
}

# Rung 1: trivial / tiny-scope / single named file
single_file_match=0
# Detect a single path literal in the message (very rough: looks like x/y or x.y).
if printf '%s' "$MSG" | grep -qE '(^|[[:space:]])[A-Za-z0-9_./-]+\.[A-Za-z0-9]+([[:space:]]|$)'; then
  # Count distinct file-ish tokens; if exactly 1, treat as named file.
  count="$(printf '%s\n' "$MSG" | grep -oE '(^|[[:space:]])[A-Za-z0-9_./-]+\.[A-Za-z0-9]+([[:space:]]|$)' | tr -d '[:space:]' | sort -u | wc -l | tr -d ' ')"
  if [ "$count" = "1" ]; then single_file_match=1; fi
fi

solo=0
solo_why=""
if contains_any "$lc" trivial_keywords; then solo=1; solo_why="trivial keyword match";
elif contains_any "$lc" tiny_scope_phrases; then solo=1; solo_why="tiny-scope phrase match";
elif [ "$single_file_match" = "1" ]; then solo=1; solo_why="single named file in message";
fi

# Rung 2: small-scope + single-side + no discovery language
side="none"
if [ -x "$DETECT" ] || [ -f "$DETECT" ]; then
  side="$(bash "$DETECT" detect-side "$MSG" 2>/dev/null || echo none)"
fi
single_agent=0
single_agent_why=""
if [ "$solo" = "0" ]; then
  if contains_any "$lc" small_scope_verbs \
     && contains_any "$lc" small_scope_nouns \
     && { [ "$side" = "be-only" ] || [ "$side" = "fe-only" ]; } \
     && ! contains_any "$lc" discovery_keywords; then
    single_agent=1
    single_agent_why="small-scope verb+noun + single-side ($side) + no discovery language"
  fi
fi

# Rung 3: team (default)
verb_count=0
# Cheap multi-verb heuristic: count occurrences of " and " between action words.
verb_count="$(printf '%s' "$lc" | { grep -oE '[[:space:]]and[[:space:]]' || true; } | wc -l | tr -d ' ')"
long_message=0
if [ "$length" -gt 200 ]; then long_message=1; fi

team=0
team_why=""
if [ "$solo" = "0" ] && [ "$single_agent" = "0" ]; then
  team=1
  if [ "$side" = "mixed" ]; then team_why="multi-side signal (BE+FE)";
  elif contains_any "$lc" discovery_keywords; then team_why="discovery language match";
  elif [ "$verb_count" -ge 1 ]; then team_why="multi-verb message ($verb_count 'and' joiners)";
  elif [ "$long_message" = "1" ]; then team_why="long message (>200 chars)";
  elif contains_any "$lc" team_request_keywords; then team_why="explicit team request";
  else team_why="rung-1 and rung-2 did not match; defaulting to team";
  fi
fi

# Resolve mode
if [ "$solo" = "1" ]; then mode="solo"; reason="Rung 1 matched: $solo_why."
elif [ "$single_agent" = "1" ]; then mode="single-agent"; reason="Rung 2 matched: $single_agent_why."
else mode="team"; reason="Rung 3 matched: $team_why."
fi

# Size (team only)
size=""
size_why=""
if [ "$mode" = "team" ]; then
  domain=""
  if [ -f "$ROOT/CLAUDE.md" ] && [ -f "$PARSE" ]; then
    domain="$(bash "$PARSE" get security.domain "$ROOT/CLAUDE.md" 2>/dev/null || true)"
  fi
  if [ "$domain" = "payments" ] || [ "$domain" = "healthcare" ]; then
    size="full"; size_why="security.domain=$domain"
  elif contains_any "$lc" regulated_keywords; then
    size="full"; size_why="regulated keyword match"
  elif contains_any "$lc" low_stakes_keywords; then
    size="minimal"; size_why="low-stakes keyword match"
  else
    size="standard"; size_why="default"
  fi
fi

# Shape: prefer CLAUDE.md, fall back to mixed.
shape=""
if [ -f "$ROOT/CLAUDE.md" ] && [ -f "$PARSE" ]; then
  shape="$(bash "$PARSE" shape "$ROOT/CLAUDE.md" 2>/dev/null || true)"
fi
if [ -z "$shape" ] || [ "$shape" = "none" ]; then
  # Fall back to side detection: mixed → full-stack; be-only / fe-only as-is.
  case "$side" in
    mixed) shape="full-stack" ;;
    be-only) shape="be-only" ;;
    fe-only) shape="fe-only" ;;
    *) shape="full-stack" ;;
  esac
fi

# Emit
printf 'mode: %s\n' "$mode"
if [ "$mode" = "team" ]; then
  printf 'size: %s\n' "$size"
fi
printf 'shape: %s\n' "$shape"
printf 'mode_reasoning: |\n'
printf '  %s\n' "$reason"
if [ "$mode" = "team" ]; then
  printf '  Size: %s — %s.\n' "$size" "$size_why"
fi
printf '  side_signal: %s; verb_joiners: %d; length: %d chars.\n' "$side" "$verb_count" "$length"

exit 0
