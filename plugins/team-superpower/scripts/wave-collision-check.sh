#!/usr/bin/env bash
# wave-collision-check.sh — detect file-scope collisions inside a wave.
#
# Input (stdin): one task per line, space-separated:
#   <task-id> <file1> [<file2> ...]
# Files are normalized (lowercase, leading ./ stripped, slashes preserved).
#
# Exit codes:
#   0 — no collision
#   1 — at least one pair of tasks share a normalized file
#
# Stdout on collision: one line per colliding pair:
#   COLLISION <task-i> <task-j> <file>

set -euo pipefail

normalize() {
  # lowercase + strip leading ./
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's|^\./||'
}

tasks=()
files_list=()

while IFS= read -r line || [ -n "$line" ]; do
  [ -z "$line" ] && continue
  # shellcheck disable=SC2206
  parts=($line)
  task="${parts[0]}"
  files=()
  for ((i=1; i<${#parts[@]}; i++)); do
    files+=("$(normalize "${parts[$i]}")")
  done
  tasks+=("$task")
  files_list+=("${files[*]}")
done

collisions=0
n=${#tasks[@]}
for ((i=0; i<n; i++)); do
  for ((j=i+1; j<n; j++)); do
    # shellcheck disable=SC2206
    fi=(${files_list[$i]})
    # shellcheck disable=SC2206
    fj=(${files_list[$j]})
    for f1 in "${fi[@]}"; do
      [ -z "$f1" ] && continue
      for f2 in "${fj[@]}"; do
        [ -z "$f2" ] && continue
        if [ "$f1" = "$f2" ]; then
          printf 'COLLISION %s %s %s\n' "${tasks[$i]}" "${tasks[$j]}" "$f1"
          collisions=$((collisions+1))
        fi
      done
    done
  done
done

if [ "$collisions" -gt 0 ]; then exit 1; fi
exit 0
