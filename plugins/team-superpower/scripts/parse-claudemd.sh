#!/usr/bin/env bash
# parse-claudemd.sh — extract the team-superpower YAML block from CLAUDE.md.
#
# Usage:
#   parse-claudemd.sh extract [<path-to-CLAUDE.md>]   prints the YAML block to stdout
#   parse-claudemd.sh shape   [<path-to-CLAUDE.md>]   prints "full-stack" | "be-only" | "fe-only" | "none"
#   parse-claudemd.sh get <dotted.key> [<path>]       prints a single scalar value
#                                                      (limited: top-level group + leaf, e.g. backend.test_command)
#
# Exit codes:
#   0  success
#   1  CLAUDE.md missing or contains no `team-superpower` fenced block
#   2  bad arguments
#   3  key not found (only for `get`)
#
# Notes:
#   - The fenced block is recognised by the literal opener "```team-superpower"
#     (with no language indent) and the matching "```" closer.
#   - Comments starting with `#` (after optional whitespace) are stripped before
#     value extraction. Inline `# comment` tails are also stripped.
#   - This is a deliberately tiny parser. It does NOT validate the schema.
#     Schema validation is the lead's job (it halts on bad values per the spec).

set -euo pipefail

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
}

CLAUDE_FILE_DEFAULT="${CLAUDE_PROJECT_DIR:-$PWD}/CLAUDE.md"

extract_block() {
  local file="$1"
  [ -f "$file" ] || return 1
  # awk: print lines strictly between the opener and closer fences.
  awk '
    /^```team-superpower[[:space:]]*$/ { in_block = 1; next }
    in_block && /^```[[:space:]]*$/    { in_block = 0; exit }
    in_block                            { print }
  ' "$file"
}

block_has_content() {
  # Returns 0 if the YAML block extracted to stdin has at least one non-comment,
  # non-blank line; 1 otherwise.
  local payload
  payload="$(cat || true)"
  printf '%s' "$payload" | grep -vE '^[[:space:]]*(#|$)' | head -n1 | grep -q .
}

# Strip an inline `# comment` tail (but not `#` inside a quoted string — we
# tolerate the simple case here, the spec doesn't ship complex YAML values).
strip_comment() {
  sed -E 's/[[:space:]]+#[^"\x27]*$//' | sed -E 's/^[[:space:]]*#.*$//'
}

cmd_extract() {
  local file="${1:-$CLAUDE_FILE_DEFAULT}"
  if [ ! -f "$file" ]; then
    echo "parse-claudemd: $file does not exist" >&2
    return 1
  fi
  local block
  block="$(extract_block "$file")"
  if [ -z "$block" ] || ! printf '%s' "$block" | block_has_content; then
    echo "parse-claudemd: no \`team-superpower\` block found in $file" >&2
    return 1
  fi
  printf '%s\n' "$block"
}

# Read a top-level scalar like `backend: none` or detect whether a group is
# explicitly "none".
group_is_none() {
  # group_is_none <yaml-block-on-stdin> <group-name>
  local group="$2"
  awk -v g="$group" '
    BEGIN { found = 0 }
    {
      sub(/[[:space:]]+#[^"\x27]*$/, "")
      sub(/^[[:space:]]*#.*$/, "")
    }
    $0 ~ "^"g":[[:space:]]+none[[:space:]]*$" { found = 1; exit }
    END { exit found ? 0 : 1 }
  ' <<<"$1"
}

# A group is "present" if there is `group:` followed (on subsequent indented
# lines) by at least one non-comment, non-blank key/value pair.
group_is_present() {
  # group_is_present <yaml-block> <group-name>
  local group="$2"
  awk -v g="$group" '
    BEGIN { state = 0; has_keys = 0 }
    {
      line = $0
      # strip comments
      sub(/[[:space:]]+#[^"\x27]*$/, "", line)
      sub(/^[[:space:]]*#.*$/, "", line)
    }
    line ~ "^"g":[[:space:]]*$"          { state = 1; next }
    line ~ "^"g":[[:space:]]+none"       { state = 0; exit }
    state == 1 && line ~ /^[^[:space:]]/ { state = 0 }
    state == 1 && line ~ /^[[:space:]]+[A-Za-z_][A-Za-z0-9_]*:/ { has_keys = 1 }
    END { exit has_keys ? 0 : 1 }
  ' <<<"$1"
}

cmd_shape() {
  local file="${1:-$CLAUDE_FILE_DEFAULT}"
  local block
  block="$(cmd_extract "$file")" || return 1

  local be_present=1 fe_present=1
  group_is_present "$block" backend  || be_present=0
  group_is_present "$block" frontend || fe_present=0

  if   [ "$be_present" -eq 1 ] && [ "$fe_present" -eq 1 ]; then echo "full-stack"
  elif [ "$be_present" -eq 1 ];                              then echo "be-only"
  elif [ "$fe_present" -eq 1 ];                              then echo "fe-only"
  else                                                            echo "none"
  fi
}

cmd_get() {
  local key="${1:-}"
  local file="${2:-$CLAUDE_FILE_DEFAULT}"
  if [ -z "$key" ]; then usage >&2; return 2; fi
  local block
  block="$(cmd_extract "$file")" || return 1

  case "$key" in
    *.*)
      local group leaf
      group="${key%%.*}"
      leaf="${key#*.}"
      local value
      value="$(awk -v g="$group" -v k="$leaf" '
        BEGIN { in_group = 0; pat = "^[[:space:]]+" k "[[:space:]]*:[[:space:]]*" }
        {
          line = $0
          sub(/[[:space:]]+#[^"\x27]*$/, "", line)
          sub(/^[[:space:]]*#.*$/, "", line)
        }
        line ~ "^"g":[[:space:]]*$"           { in_group = 1; next }
        in_group && line ~ /^[^[:space:]]/    { in_group = 0 }
        in_group && line ~ pat {
          v = line
          sub(pat, "", v)
          sub(/[[:space:]]+$/, "", v)
          gsub(/^"|"$/, "", v)
          gsub(/^\x27|\x27$/, "", v)
          print v
          exit
        }
      ' <<<"$block")"
      if [ -z "$value" ]; then return 3; fi
      printf '%s\n' "$value"
      ;;
    *)
      # Top-level scalar (e.g. "backend" for `backend: none`)
      local value
      value="$(awk -v k="$key" '
        BEGIN { pat = "^" k ":[[:space:]]+" }
        {
          line = $0
          sub(/[[:space:]]+#[^"\x27]*$/, "", line)
          sub(/^[[:space:]]*#.*$/, "", line)
        }
        line ~ pat {
          v = line; sub(pat, "", v); sub(/[[:space:]]+$/, "", v)
          print v
          exit
        }
      ' <<<"$block")"
      if [ -z "$value" ]; then return 3; fi
      printf '%s\n' "$value"
      ;;
  esac
}

main() {
  local sub="${1:-}"
  shift || true
  case "$sub" in
    extract) cmd_extract "$@" ;;
    shape)   cmd_shape   "$@" ;;
    get)     cmd_get     "$@" ;;
    -h|--help|"") usage; [ -z "$sub" ] && return 2 || return 0 ;;
    *) echo "unknown subcommand: $sub" >&2; usage >&2; return 2 ;;
  esac
}

main "$@"
