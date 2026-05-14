#!/usr/bin/env bash
# team-state.sh — inspect and clean up team-superpower team state.
#
# Subcommands:
#   scan                     List every known superpower-* team on this machine.
#   scan <slug>              Inspect a single slug; print state for the lead/owner.
#   cleanup <slug>           Dry-run cleanup; print what would be removed (exit 1).
#   cleanup <slug> --force   Remove team config, task list, tmux session.
#
# Flags (cleanup only):
#   --force                  Apply the cleanup (otherwise dry-run).
#   --ignore-heartbeat       Skip the "lead may still be alive" refusal.
#                            Required when the heartbeat file is < 10 min old.
#
# What this script preserves (always):
#   - docs/superpowers/{specs,plans,reviews}      durable artefacts
#   - the project-side checkpoint markdown        kept; appended with a Cleanup record
#
# What it removes (with --force):
#   - ~/.claude/teams/superpower-<slug>/          team config
#   - ~/.claude/tasks/superpower-<slug>/          shared task list
#   - tmux session "claude-superpower-<slug>"     best-effort
#
# Idempotent: re-running is safe.
#
# Exit codes:
#   0  success
#   1  dry-run completed with items to remove (caller should re-run with --force)
#   2  bad arguments
#   3  heartbeat indicates a live lead; refuse without --ignore-heartbeat
#   4  nothing to clean up (cleanup only; scan is read-only and always exits 0)

set -euo pipefail

CLAUDE_HOME="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
TEAMS_DIR="$CLAUDE_HOME/teams"
TASKS_DIR="$CLAUDE_HOME/tasks"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
SESSIONS_DIR="$PROJECT_DIR/docs/superpowers/sessions"
HEARTBEAT_TTL_SECONDS=600  # 10 min

print_usage() {
  sed -n '1,/^set -euo pipefail/{/^set -euo pipefail/d;s/^# \{0,1\}//;p;}' "$0"
}

team_name_for_slug() { printf 'superpower-%s' "$1"; }
tmux_name_for_slug() { printf 'claude-superpower-%s' "$1"; }

heartbeat_file_for_slug() {
  local slug="$1"
  printf '%s/%s.heartbeat' "$SESSIONS_DIR" "$slug"
}

checkpoint_for_slug() {
  local slug="$1"
  if [ ! -d "$SESSIONS_DIR" ]; then return; fi
  local match
  match="$(find "$SESSIONS_DIR" -maxdepth 1 -type f -name "*-$slug.md" 2>/dev/null | sort | tail -n1)"
  printf '%s' "$match"
}

heartbeat_age_seconds() {
  local hb="$1"
  if [ ! -f "$hb" ]; then echo "-1"; return; fi
  local mtime now
  mtime="$(stat -c %Y "$hb" 2>/dev/null || stat -f %m "$hb" 2>/dev/null || echo 0)"
  now="$(date +%s)"
  echo $(( now - mtime ))
}

list_all_team_slugs() {
  [ -d "$TEAMS_DIR" ] || return 0
  find "$TEAMS_DIR" -maxdepth 1 -mindepth 1 -type d -name 'superpower-*' 2>/dev/null \
    | sed 's|.*/superpower-||' | sort
}

cmd_scan() {
  local slug="${1:-}"

  if [ -z "$slug" ]; then
    local slugs
    slugs="$(list_all_team_slugs)"
    if [ -z "$slugs" ]; then
      echo "No team-superpower teams found under $TEAMS_DIR"
      return 0
    fi
    echo "team-superpower teams on this machine:"
    while IFS= read -r s; do
      [ -z "$s" ] && continue
      local team team_dir hb age
      team="$(team_name_for_slug "$s")"
      team_dir="$TEAMS_DIR/$team"
      hb="$(heartbeat_file_for_slug "$s")"
      age="$(heartbeat_age_seconds "$hb")"
      if [ "$age" -lt 0 ]; then
        printf '  %s\t(no heartbeat)\n' "$s"
      else
        printf '  %s\theartbeat: %ds ago\n' "$s" "$age"
      fi
    done <<< "$slugs"
    return 0
  fi

  local team team_dir task_dir hb age ckpt tmux_name
  team="$(team_name_for_slug "$slug")"
  team_dir="$TEAMS_DIR/$team"
  task_dir="$TASKS_DIR/$team"
  hb="$(heartbeat_file_for_slug "$slug")"
  age="$(heartbeat_age_seconds "$hb")"
  ckpt="$(checkpoint_for_slug "$slug")"
  tmux_name="$(tmux_name_for_slug "$slug")"

  printf 'slug:              %s\n' "$slug"
  printf 'team_name:         %s\n' "$team"
  printf 'team_config:       %s\n' "$team_dir"
  if [ -d "$team_dir" ]; then printf 'team_config_state: present\n'; else printf 'team_config_state: absent\n'; fi
  printf 'task_list:         %s\n' "$task_dir"
  if [ -d "$task_dir" ]; then printf 'task_list_state:   present\n'; else printf 'task_list_state:   absent\n'; fi
  printf 'checkpoint:        %s\n' "${ckpt:-<none>}"
  if [ "$age" -lt 0 ]; then
    printf 'heartbeat:         <none>\n'
    printf 'liveness:          unknown (no heartbeat — treat as stale)\n'
  else
    printf 'heartbeat:         %s (%ds ago)\n' "$hb" "$age"
    if [ "$age" -lt "$HEARTBEAT_TTL_SECONDS" ]; then
      printf 'liveness:          LIKELY ALIVE (heartbeat < %ds)\n' "$HEARTBEAT_TTL_SECONDS"
    else
      printf 'liveness:          stale\n'
    fi
  fi
  printf 'tmux_session:      %s\n' "$tmux_name"
  if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$tmux_name" 2>/dev/null; then
    printf 'tmux_state:        present\n'
  else
    printf 'tmux_state:        absent\n'
  fi
}

cmd_cleanup() {
  local slug="${1:-}"
  shift || true
  local force=0
  local ignore_hb=0
  for arg in "$@"; do
    case "$arg" in
      --force) force=1 ;;
      --ignore-heartbeat) ignore_hb=1 ;;
      *) echo "unknown flag: $arg" >&2; return 2 ;;
    esac
  done
  if [ -z "$slug" ]; then
    echo "usage: team-state.sh cleanup <slug> [--force] [--ignore-heartbeat]" >&2
    return 2
  fi

  local team team_dir task_dir hb age ckpt tmux_name
  team="$(team_name_for_slug "$slug")"
  team_dir="$TEAMS_DIR/$team"
  task_dir="$TASKS_DIR/$team"
  hb="$(heartbeat_file_for_slug "$slug")"
  age="$(heartbeat_age_seconds "$hb")"
  ckpt="$(checkpoint_for_slug "$slug")"
  tmux_name="$(tmux_name_for_slug "$slug")"

  # Build the work list.
  local items=()
  [ -d "$team_dir" ] && items+=("team_config:$team_dir")
  [ -d "$task_dir" ] && items+=("task_list:$task_dir")
  if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$tmux_name" 2>/dev/null; then
    items+=("tmux_session:$tmux_name")
  fi

  if [ ${#items[@]} -eq 0 ]; then
    echo "Nothing to clean up for slug '$slug'."
    [ -n "$ckpt" ] && echo "Checkpoint untouched: $ckpt"
    return 4
  fi

  # Heartbeat refusal (only when --force, since dry-run is harmless).
  if [ "$force" -eq 1 ] && [ "$age" -ge 0 ] && [ "$age" -lt "$HEARTBEAT_TTL_SECONDS" ] && [ "$ignore_hb" -ne 1 ]; then
    echo "REFUSED: heartbeat at $hb is ${age}s old (< ${HEARTBEAT_TTL_SECONDS}s)." >&2
    echo "         A lead may still be alive. Re-run with --ignore-heartbeat to override." >&2
    return 3
  fi

  if [ "$force" -ne 1 ]; then
    echo "Dry-run for slug '$slug' (pass --force to apply):"
    for it in "${items[@]}"; do printf '  would remove: %s\n' "$it"; done
    [ -n "$ckpt" ] && echo "  would append cleanup record to: $ckpt"
    return 1
  fi

  # Apply.
  local removed=0
  if [ -d "$team_dir" ]; then
    rm -rf -- "$team_dir"
    echo "removed: $team_dir"
    removed=$((removed+1))
  fi
  if [ -d "$task_dir" ]; then
    rm -rf -- "$task_dir"
    echo "removed: $task_dir"
    removed=$((removed+1))
  fi
  if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$tmux_name" 2>/dev/null; then
    tmux kill-session -t "$tmux_name" && echo "killed tmux session: $tmux_name"
    removed=$((removed+1))
  fi
  # Heartbeat is informational; remove it so future scans don't see a stale "alive" signal.
  if [ -f "$hb" ]; then
    rm -f -- "$hb"
    echo "removed heartbeat: $hb"
  fi

  if [ -n "$ckpt" ] && [ -f "$ckpt" ]; then
    local ts
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    if ! grep -q '^## Cleanup' "$ckpt"; then
      {
        printf '\n## Cleanup\n'
        printf -- '- cleaned at: %s\n' "$ts"
        printf -- '- removed: %d resource(s) (team_config, task_list, tmux_session as applicable)\n' "$removed"
        printf -- '- status: cleaned\n'
      } >> "$ckpt"
      echo "appended cleanup record to: $ckpt"
    fi
  fi

  echo "Cleanup complete for $slug."
  return 0
}

main() {
  local sub="${1:-}"
  shift || true
  case "$sub" in
    scan)    cmd_scan "$@" ;;
    cleanup) cmd_cleanup "$@" ;;
    -h|--help|help|"") print_usage; [ -z "$sub" ] && return 2 || return 0 ;;
    *) echo "unknown subcommand: $sub" >&2; print_usage; return 2 ;;
  esac
}

main "$@"
