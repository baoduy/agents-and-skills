# team-superpower v3 — Plan A: MAX_ITERATIONS + complexity assessment + mode dispatch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MAX_ITERATIONS guardrail, autonomous mode/size assessment in phase 0.5, and three mode-specific execution paths (solo / single-agent / team) with `--mode` / `--size` / `--explain` overrides to `plugins/team-superpower/`.

**Architecture:** Three additive change groups inside the `plugins/team-superpower/` plugin: (1) a new `scripts/assess-complexity.sh` plus a `detect_side_from_text` function in `scripts/detect-stack.sh` produce a YAML decision block from the launch message; (2) `commands/team-feature.md` gains a Phase 0.5 section that runs the script (or honors `--mode/--size/--explain` flags), then routes through solo / single-agent / team execution paths; (3) `hooks/task-created.sh` rejects `impl:*` tasks under solo, `hooks/task-completed.sh` rejects implementer completions over the iteration cap, and the BE/FE agents increment and halt on an `iteration_count:` field. `assets/CLAUDE.md.template` gains a `limits.max_iterations_per_task` field. No changes to wave dispatch (Plan B) or per-role model pins (Plan C).

**Tech Stack:** Bash 4+, jq, POSIX shell, Markdown slash-command files. Tests are bash assertion scripts under `plugins/team-superpower/tests/` invoked by `bash tests/<name>.sh`.

**Spec ref:** `docs/superpowers/team-superpower-v3-spec.md` §4, §6, §7.1, §7.5, §7.6 (item 2 only — wave metadata is Plan B), §7.7, §7.8, §7.9. Implementation order = spec §8 steps 1–4.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `plugins/team-superpower/scripts/assess-complexity.sh` | Create | Heuristic ladder → emit `mode/size/shape/mode_reasoning` YAML to stdout. |
| `plugins/team-superpower/scripts/detect-stack.sh` | Modify | Add `detect_side_from_text` function used by the ladder. |
| `plugins/team-superpower/hooks/task-created.sh` | Modify | Reject `impl:*` titles under `mode=solo`. |
| `plugins/team-superpower/hooks/task-completed.sh` | Modify | Reject `impl:*` completion when `iteration_count > limits.max_iterations_per_task` and no `reflection:` block. |
| `plugins/team-superpower/agents/backend-developer.md` | Modify | Document `iteration_count:` increment + halt-and-escalate at cap. |
| `plugins/team-superpower/agents/frontend-developer.md` | Modify | Same. |
| `plugins/team-superpower/commands/team-feature.md` | Modify | Add Phase 0.5 (complexity assessment), `--mode/--size/--explain` flag handling, and three mode-specific execution sections. |
| `plugins/team-superpower/assets/CLAUDE.md.template` | Modify | Add `limits.max_iterations_per_task: 8` (default). |
| `plugins/team-superpower/tests/assess-complexity.test.sh` | Create | ~15 launch-message fixtures → expected mode/size pairs. |
| `plugins/team-superpower/tests/detect-side-from-text.test.sh` | Create | BE-only / FE-only / mixed / none fixtures. |
| `plugins/team-superpower/tests/task-created-solo.test.sh` | Create | Solo mode rejects `impl:*`; accepts `meta:*` / `review:*`. |
| `plugins/team-superpower/tests/task-completed-iterations.test.sh` | Create | Reject when `iteration_count > 8` no reflection; accept with reflection or under cap. |

---

## Task 1: Add `iteration_count` cap check to `task-completed.sh`

**Files:**
- Create: `plugins/team-superpower/tests/task-completed-iterations.test.sh`
- Modify: `plugins/team-superpower/hooks/task-completed.sh`

The hook currently warns on missing `plan_approved_at`. v3 adds a `iteration_count` cap check that emits a warning when `iteration_count > limits.max_iterations_per_task` AND no `reflection:` block is attached. Default cap = 8. The cap is read from `CLAUDE.md`'s `limits.max_iterations_per_task` via the existing `parse-claudemd.sh` helper. The hook continues to use the warn-via-log pattern (the v2 hook already chose warnings over hard exits — keep that convention; the lead enforces).

- [ ] **Step 1: Write the failing test**

Create `plugins/team-superpower/tests/task-completed-iterations.test.sh`:

```bash
#!/usr/bin/env bash
# Tests for the iteration_count cap check in task-completed.sh.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$PLUGIN_ROOT/hooks/task-completed.sh"

# Each test runs the hook with a payload on stdin, sets CLAUDE_PROJECT_DIR to a
# temp dir, and inspects the resulting log line.

fail=0

run_hook() {
  # run_hook <payload>
  tmp="$(mktemp -d)"
  CLAUDE_PROJECT_DIR="$tmp" bash "$HOOK" <<< "$1" >/dev/null 2>&1 || true
  cat "$tmp/.claude/hooks/log.jsonl" 2>/dev/null || true
  rm -rf "$tmp"
}

assert_contains() {
  # assert_contains <haystack> <needle> <test-name>
  if printf '%s' "$1" | grep -q -- "$2"; then
    echo "PASS: $3"
  else
    echo "FAIL: $3 (expected to find '$2' in output)"
    echo "  got: $1"
    fail=1
  fi
}

assert_not_contains() {
  # assert_not_contains <haystack> <needle> <test-name>
  if printf '%s' "$1" | grep -q -- "$2"; then
    echo "FAIL: $3 (did NOT expect '$2')"
    echo "  got: $1"
    fail=1
  else
    echo "PASS: $3"
  fi
}

# Case 1: impl task with iteration_count 9, no reflection → ITERATION_CAP_EXCEEDED warn
payload='{"task":{"title":"impl:be-foo","metadata":{"plan_approved_at":"2026-05-15T10:00:00Z","iteration_count":9}}}'
out="$(run_hook "$payload")"
assert_contains "$out" 'ITERATION_CAP_EXCEEDED' 'cap=9 no reflection emits ITERATION_CAP_EXCEEDED'

# Case 2: impl task with iteration_count 9, WITH reflection → no warn
payload='{"task":{"title":"impl:be-foo","metadata":{"plan_approved_at":"2026-05-15T10:00:00Z","iteration_count":9,"reflection":"we kept rewriting the same assertion"}}}'
out="$(run_hook "$payload")"
assert_not_contains "$out" 'ITERATION_CAP_EXCEEDED' 'cap=9 with reflection does not emit ITERATION_CAP_EXCEEDED'

# Case 3: impl task with iteration_count 5 → no warn
payload='{"task":{"title":"impl:be-foo","metadata":{"plan_approved_at":"2026-05-15T10:00:00Z","iteration_count":5}}}'
out="$(run_hook "$payload")"
assert_not_contains "$out" 'ITERATION_CAP_EXCEEDED' 'cap=5 under default 8 does not warn'

# Case 4: non-impl task with high iteration_count → no warn
payload='{"task":{"title":"review:x","metadata":{"iteration_count":99}}}'
out="$(run_hook "$payload")"
assert_not_contains "$out" 'ITERATION_CAP_EXCEEDED' 'non-impl task ignores iteration_count'

# Case 5: impl task missing iteration_count → no warn (treat absent as 0)
payload='{"task":{"title":"impl:be-foo","metadata":{"plan_approved_at":"2026-05-15T10:00:00Z"}}}'
out="$(run_hook "$payload")"
assert_not_contains "$out" 'ITERATION_CAP_EXCEEDED' 'impl task with no iteration_count does not warn'

if [ "$fail" -eq 0 ]; then
  echo "ALL PASS"
  exit 0
fi
exit 1
```

Make it executable:

```bash
chmod +x plugins/team-superpower/tests/task-completed-iterations.test.sh
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash plugins/team-superpower/tests/task-completed-iterations.test.sh`
Expected: At least the first FAIL line — `cap=9 no reflection emits ITERATION_CAP_EXCEEDED` — because the hook does not yet check `iteration_count`. Exit status non-zero.

- [ ] **Step 3: Add the check to `task-completed.sh`**

Modify `plugins/team-superpower/hooks/task-completed.sh`. After the existing `impl:` plan-approval case (the `case "$title" in impl:*) ...` block that warns on `no_plan_approval`), insert a new block that:

1. Parses `iteration_count` from `.task.metadata.iteration_count` (default 0).
2. Parses `reflection` from `.task.metadata.reflection` (default empty).
3. Reads the cap from `CLAUDE.md` using the existing `parse-claudemd.sh` helper, default 8.
4. If the title matches `impl:*` AND `iteration_count > cap` AND `reflection` is empty → log `ITERATION_CAP_EXCEEDED`.

Insert this block immediately after the closing `esac` of the existing `impl:*` plan-approval block (which is at line ~54). Exact insertion:

```bash
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash plugins/team-superpower/tests/task-completed-iterations.test.sh`
Expected: `ALL PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add plugins/team-superpower/hooks/task-completed.sh plugins/team-superpower/tests/task-completed-iterations.test.sh
git commit -m "feat(team-superpower): MAX_ITERATIONS cap check in task-completed hook"
```

---

## Task 2: Document `iteration_count` increment + halt in backend-developer agent

**Files:**
- Modify: `plugins/team-superpower/agents/backend-developer.md`

The agent doc needs to instruct the implementer to (a) increment `iteration_count` on every RED→GREEN cycle on the same test name, (b) halt at 8, (c) post a §7 escalation with mandatory fields `what_failed:`, `one_change_to_fix:`, `iteration_count: 8`, and `class:`. The cap is read from `CLAUDE.md`'s `limits.max_iterations_per_task` (default 8). The instruction goes under "Hard rules" as a new numbered item.

- [ ] **Step 1: Read the current file end of "Hard rules" section**

Read `plugins/team-superpower/agents/backend-developer.md`. Locate the "Hard rules" section (numbered list). Note the last existing rule number (item 9 in current file). The new rule becomes item 10.

- [ ] **Step 2: Insert the new hard rule**

Add this item to the numbered "Hard rules" list, immediately after the existing item 9:

```markdown
10. **MAX_ITERATIONS guardrail.** Track `iteration_count` per task (start at 0 on claim). Increment by 1 every time you have to retry the SAME failing test (same test name, same expectation) after a RED→GREEN attempt did not stick. The cap is read from `CLAUDE.md`'s `limits.max_iterations_per_task` (default 8). When `iteration_count` reaches the cap, halt and post a §7 escalation with these mandatory fields:
    - `Phase:` (current Superpowers skill phase)
    - `Context:` (one-paragraph summary of the stuck test)
    - `what_failed:` (exact failure message from the last attempt)
    - `one_change_to_fix:` (single most likely fix you would try next)
    - `iteration_count: <N>`
    - `class: tactical | cross-role | architectural | owner-only`
    - `Options:`, `Recommendation:`, `Need from you:`, `Peer attempts:` (escalation template required fields).

    The `TaskCompleted` hook rejects completion when `iteration_count > cap` and no `reflection:` block is attached to the task metadata. After the escalation resolves, reset `iteration_count` to 0 if the resolution changed the test specification; otherwise keep counting.
```

- [ ] **Step 3: Verify the edit is in place**

Run: `grep -n 'MAX_ITERATIONS guardrail' plugins/team-superpower/agents/backend-developer.md`
Expected: at least one match.

Run: `grep -nE '^10\. \*\*MAX_ITERATIONS' plugins/team-superpower/agents/backend-developer.md`
Expected: exactly one match showing the rule is numbered 10.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/agents/backend-developer.md
git commit -m "feat(team-superpower): MAX_ITERATIONS hard rule in backend-developer agent"
```

---

## Task 3: Document `iteration_count` increment + halt in frontend-developer agent

**Files:**
- Modify: `plugins/team-superpower/agents/frontend-developer.md`

Mirror of Task 2 on the frontend-developer doc.

- [ ] **Step 1: Locate the "Hard rules" section**

Read `plugins/team-superpower/agents/frontend-developer.md`. Locate "Hard rules" numbered list. Note the last existing rule number.

- [ ] **Step 2: Insert the new hard rule**

Insert the SAME rule body as Task 2 step 2, with `MAX_ITERATIONS guardrail` and identical wording (the rule applies symmetrically to both implementers — repeat verbatim, don't say "see backend-developer"). Use the next sequential number for the frontend-developer file's hard-rules list.

The exact rule body (copy verbatim, only adjusting the leading number to match the next slot in this file's list):

```markdown
N. **MAX_ITERATIONS guardrail.** Track `iteration_count` per task (start at 0 on claim). Increment by 1 every time you have to retry the SAME failing test (same test name, same expectation) after a RED→GREEN attempt did not stick. The cap is read from `CLAUDE.md`'s `limits.max_iterations_per_task` (default 8). When `iteration_count` reaches the cap, halt and post a §7 escalation with these mandatory fields:
    - `Phase:` (current Superpowers skill phase)
    - `Context:` (one-paragraph summary of the stuck test)
    - `what_failed:` (exact failure message from the last attempt)
    - `one_change_to_fix:` (single most likely fix you would try next)
    - `iteration_count: <N>`
    - `class: tactical | cross-role | architectural | owner-only`
    - `Options:`, `Recommendation:`, `Need from you:`, `Peer attempts:` (escalation template required fields).

    The `TaskCompleted` hook rejects completion when `iteration_count > cap` and no `reflection:` block is attached to the task metadata. After the escalation resolves, reset `iteration_count` to 0 if the resolution changed the test specification; otherwise keep counting.
```

(Replace `N.` with the correct next number from the file.)

- [ ] **Step 3: Verify the edit is in place**

Run: `grep -n 'MAX_ITERATIONS guardrail' plugins/team-superpower/agents/frontend-developer.md`
Expected: at least one match.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/agents/frontend-developer.md
git commit -m "feat(team-superpower): MAX_ITERATIONS hard rule in frontend-developer agent"
```

---

## Task 4: Add `limits.max_iterations_per_task` to CLAUDE.md template

**Files:**
- Modify: `plugins/team-superpower/assets/CLAUDE.md.template`

The template already has a `limits:` block (lines ~80–84) with `phase_stall_minutes`, `max_tasks_per_implementer`, `max_concurrent_teammates`. Add one more line and a reserved (commented) line for the future per-wave cap (Plan B will keep this comment in place — do not delete it).

- [ ] **Step 1: Insert the new limit lines**

In `plugins/team-superpower/assets/CLAUDE.md.template`, locate the `limits:` block. Add these two lines INSIDE the block, right after `max_concurrent_teammates: 5`:

```yaml
  max_iterations_per_task: 8     # MAX_ITERATIONS guardrail; implementer halts and escalates on cap
  # max_parallel_implementers: 2 # reserved for v3 wave dispatcher (Plan B), currently fixed at 2
```

- [ ] **Step 2: Verify the edit**

Run: `grep -n 'max_iterations_per_task' plugins/team-superpower/assets/CLAUDE.md.template`
Expected: exactly one match, value `8`.

Run: `python3 -c "import re,sys; t=open('plugins/team-superpower/assets/CLAUDE.md.template').read(); m=re.search(r'\`\`\`team-superpower\n(.*?)\`\`\`', t, re.DOTALL); print('OK' if m and 'max_iterations_per_task: 8' in m.group(1) else 'FAIL')"`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/assets/CLAUDE.md.template
git commit -m "feat(team-superpower): add limits.max_iterations_per_task to CLAUDE.md template"
```

---

## Task 5: Add `detect_side_from_text` function to `detect-stack.sh`

**Files:**
- Create: `plugins/team-superpower/tests/detect-side-from-text.test.sh`
- Modify: `plugins/team-superpower/scripts/detect-stack.sh`

The complexity-assessment ladder needs to classify a launch message into `be-only` / `fe-only` / `mixed` / `none`. We add a helper function to `detect-stack.sh` that exposes this when the script is sourced (or invoked with a `detect-side` subcommand). Approach: add a subcommand mode at the top of the script that runs ONLY the side-from-text classifier and exits, without doing filesystem stack detection.

Keyword tables for the classifier are LITERAL strings matched case-insensitively against the message — no regex magic, just plain substring matching, to keep behavior predictable.

- [ ] **Step 1: Write the failing test**

Create `plugins/team-superpower/tests/detect-side-from-text.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$PLUGIN_ROOT/scripts/detect-stack.sh"

fail=0

assert_eq() {
  # assert_eq <actual> <expected> <name>
  if [ "$1" = "$2" ]; then
    echo "PASS: $3"
  else
    echo "FAIL: $3 — got '$1', expected '$2'"
    fail=1
  fi
}

run() {
  # run <launch-message>
  bash "$SCRIPT" detect-side "$1" 2>/dev/null
}

assert_eq "$(run 'add /healthcheck endpoint that returns 200 OK')" "be-only" "endpoint → be-only"
assert_eq "$(run 'add a Cancel button to the order details page')" "fe-only" "page+button → fe-only"
assert_eq "$(run 'add login page with email and password, hook up to /auth/login endpoint, redirect on success')" "mixed" "page + endpoint → mixed"
assert_eq "$(run 'add idempotency_key column to the payments table')" "be-only" "column+table → be-only"
assert_eq "$(run 'new component for user avatar')" "fe-only" "component → fe-only"
assert_eq "$(run 'fix typo in welcome message')" "none" "no side signals → none"
assert_eq "$(run 'add API for fetching user profile and the matching component')" "mixed" "API + component → mixed"
assert_eq "$(run 'refactor PaymentService class for clarity')" "be-only" "service → be-only"
assert_eq "$(run 'redesign the homepage form layout')" "fe-only" "form → fe-only"
assert_eq "$(run 'add database migration for orders schema')" "be-only" "database+migration → be-only"

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
```

Make executable: `chmod +x plugins/team-superpower/tests/detect-side-from-text.test.sh`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bash plugins/team-superpower/tests/detect-side-from-text.test.sh`
Expected: every assertion FAILs because `detect-side` subcommand does not exist yet.

- [ ] **Step 3: Add the subcommand to `detect-stack.sh`**

In `plugins/team-superpower/scripts/detect-stack.sh`, immediately after the `set -euo pipefail` line (~line 23, before `ROOT="${1:-$PWD}"`), insert:

```bash
# ---- subcommand: detect-side ---------------------------------------------
# Usage:
#   bash detect-stack.sh detect-side "<launch message>"
# Outputs one of: be-only | fe-only | mixed | none
# Used by scripts/assess-complexity.sh for the rung-2 single-side signal.
if [ "${1:-}" = "detect-side" ]; then
  shift
  text="${1:-}"
  # Normalize to lowercase for case-insensitive matching.
  lc="$(printf '%s' "$text" | tr '[:upper:]' '[:lower:]')"

  be_keywords=(
    "endpoint" "/api" "/auth" "/health" "route" "controller" "service"
    "repository" "schema" "migration" "database" "column" "table"
    "queue" "worker" "cron" "webhook" "grpc" "rpc"
  )
  fe_keywords=(
    "component" "page" "form" "button" "modal" "input" "field"
    "ui" "layout" "css" "tailwind" "tsx" "jsx" "react" "vue"
    "svelte" "stylesheet" "wireframe" "design system" "screen"
  )

  has_be=0
  has_fe=0
  for kw in "${be_keywords[@]}"; do
    case "$lc" in *"$kw"*) has_be=1; break ;; esac
  done
  for kw in "${fe_keywords[@]}"; do
    case "$lc" in *"$kw"*) has_fe=1; break ;; esac
  done

  if [ "$has_be" -eq 1 ] && [ "$has_fe" -eq 1 ]; then echo "mixed"
  elif [ "$has_be" -eq 1 ]; then echo "be-only"
  elif [ "$has_fe" -eq 1 ]; then echo "fe-only"
  else echo "none"
  fi
  exit 0
fi
```

(This runs before the existing `ROOT="${1:-$PWD}"` line, so the side-detect path never enters the filesystem detection code.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bash plugins/team-superpower/tests/detect-side-from-text.test.sh`
Expected: `ALL PASS`, exit 0.

- [ ] **Step 5: Verify filesystem-detect mode still works**

Run: `bash plugins/team-superpower/scripts/detect-stack.sh "$PWD" 2>/dev/null | head -3`
Expected: prints the auto-generated YAML header (`# Auto-generated by team-superpower detect-stack.sh ...`) — confirms the subcommand path did not break the default invocation.

- [ ] **Step 6: Commit**

```bash
git add plugins/team-superpower/scripts/detect-stack.sh plugins/team-superpower/tests/detect-side-from-text.test.sh
git commit -m "feat(team-superpower): detect-side subcommand in detect-stack.sh"
```

---

## Task 6: Create `scripts/assess-complexity.sh`

**Files:**
- Create: `plugins/team-superpower/scripts/assess-complexity.sh`
- Create: `plugins/team-superpower/tests/assess-complexity.test.sh`

The standalone script encodes the §4.3 heuristic ladder. Inputs: launch message (positional arg 1), optional repo root (arg 2, default `$PWD`). Outputs YAML to stdout:

```yaml
mode: solo | single-agent | team
size: minimal | standard | full   # only when mode=team
shape: full-stack | be-only | fe-only | none
mode_reasoning: |
  <which rung matched and why>
```

Exit codes: 0 confident, 1 ambiguous. The script reads `security.domain` from CLAUDE.md (via `parse-claudemd.sh`) when picking team size, and reads stack shape the same way (or defaults to `full-stack` when unknown).

- [ ] **Step 1: Write the failing test**

Create `plugins/team-superpower/tests/assess-complexity.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$PLUGIN_ROOT/scripts/assess-complexity.sh"

fail=0

assert_field() {
  # assert_field <output-yaml> <field-name> <expected-value> <test-name>
  actual="$(printf '%s\n' "$1" | grep -E "^${2}:" | head -n1 | sed -E "s/^${2}:[[:space:]]*//")"
  if [ "$actual" = "$3" ]; then
    echo "PASS: $4"
  else
    echo "FAIL: $4 — ${2}='${actual}', expected '${3}'"
    echo "  full output:"
    printf '%s\n' "$1" | sed 's/^/    /'
    fail=1
  fi
}

# --- Rung 1: solo ---
out="$(bash "$SCRIPT" 'fix typo in welcome message')"
assert_field "$out" mode solo 'fix typo → mode=solo'

out="$(bash "$SCRIPT" 'bump axios from 1.6.0 to 1.7.0')"
assert_field "$out" mode solo 'bump version → mode=solo'

out="$(bash "$SCRIPT" 'rename variable userId to memberId in src/auth/session.ts')"
assert_field "$out" mode solo 'rename → mode=solo'

out="$(bash "$SCRIPT" 'remove unused import from utils.py')"
assert_field "$out" mode solo 'remove unused → mode=solo'

# --- Rung 2: single-agent ---
out="$(bash "$SCRIPT" 'add /healthcheck endpoint that returns 200 OK')"
assert_field "$out" mode single-agent 'add endpoint → mode=single-agent'

out="$(bash "$SCRIPT" 'add a Cancel button to the order details page')"
assert_field "$out" mode single-agent 'add button on page → mode=single-agent'

out="$(bash "$SCRIPT" 'add an idempotency_key column to the payments table')"
assert_field "$out" mode single-agent 'add column → mode=single-agent'

# --- Rung 3: team ---
out="$(bash "$SCRIPT" 'add login page with email and password, hook up to /auth/login endpoint, redirect on success')"
assert_field "$out" mode team 'mixed BE+FE → mode=team'

out="$(bash "$SCRIPT" 'refactor the payments module to use the new gateway interface')"
assert_field "$out" mode team 'refactor → mode=team'

out="$(bash "$SCRIPT" 'redesign the checkout flow with new payment options')"
assert_field "$out" mode team 'redesign → mode=team'

# --- Size signals ---
out="$(bash "$SCRIPT" 'add gdpr compliance audit log for user actions across the app, with retention controls and PII redaction in storage')"
assert_field "$out" size full 'gdpr/compliance → size=full'

out="$(bash "$SCRIPT" 'spike a prototype for the experimental dashboard widget that the team can play with internally')"
assert_field "$out" size minimal 'prototype/spike → size=minimal'

out="$(bash "$SCRIPT" 'add user preferences feature with toggle UI and persistence layer')"
assert_field "$out" size standard 'default team feature → size=standard'

# --- Multi-verb signal triggers team ---
out="$(bash "$SCRIPT" 'add the contact form and update the navigation and wire up the submission endpoint')"
assert_field "$out" mode team 'multi-verb → mode=team'

# --- Long-message signal triggers team ---
long_msg='add a feature that lets users save their preferred display settings across sessions, including font size, color theme, and notification frequency, and persist those settings to the server so they survive device changes and re-installs of the client app on a different machine'
out="$(bash "$SCRIPT" "$long_msg")"
assert_field "$out" mode team 'long message (>200 chars) → mode=team'

# mode_reasoning is always present
out="$(bash "$SCRIPT" 'fix typo')"
if printf '%s' "$out" | grep -q '^mode_reasoning:'; then
  echo "PASS: mode_reasoning present"
else
  echo "FAIL: mode_reasoning missing"
  fail=1
fi

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
```

Make executable: `chmod +x plugins/team-superpower/tests/assess-complexity.test.sh`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bash plugins/team-superpower/tests/assess-complexity.test.sh`
Expected: every assertion FAILs because the script does not exist. Likely also `bash: ...: No such file or directory`.

- [ ] **Step 3: Write the script**

Create `plugins/team-superpower/scripts/assess-complexity.sh`:

```bash
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

small_scope_keywords=(
  "add endpoint" "add /" "new component" "add field" "add column"
  "add validation" "fix bug" "fix error" "add test" "add migration"
  "add button" "add page" "add route" "add controller" "add service"
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
  local txt="$1"
  local arr_name="$2"
  local -n arr_ref="$arr_name"
  for kw in "${arr_ref[@]}"; do
    case "$txt" in *"$kw"*) return 0 ;; esac
  done
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
  if contains_any "$lc" small_scope_keywords \
     && { [ "$side" = "be-only" ] || [ "$side" = "fe-only" ]; } \
     && ! contains_any "$lc" discovery_keywords; then
    single_agent=1
    single_agent_why="small-scope keyword + single-side ($side) + no discovery language"
  fi
fi

# Rung 3: team (default)
verb_count=0
# Cheap multi-verb heuristic: count occurrences of " and " between action words.
verb_count="$(printf '%s' "$lc" | grep -oE '[[:space:]]and[[:space:]]' | wc -l | tr -d ' ')"
long_message=0
[ "$length" -gt 200 ] && long_message=1

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
```

Make executable: `chmod +x plugins/team-superpower/scripts/assess-complexity.sh`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash plugins/team-superpower/tests/assess-complexity.test.sh`
Expected: `ALL PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add plugins/team-superpower/scripts/assess-complexity.sh plugins/team-superpower/tests/assess-complexity.test.sh
git commit -m "feat(team-superpower): assess-complexity.sh heuristic ladder script"
```

---

## Task 7: Solo-mode guard in `task-created.sh`

**Files:**
- Create: `plugins/team-superpower/tests/task-created-solo.test.sh`
- Modify: `plugins/team-superpower/hooks/task-created.sh`

When the checkpoint frontmatter says `mode: solo`, an `impl:*` task should NOT exist — solo mode means the lead does the work itself with no implementer. The hook should warn (log `INVALID_FOR_SOLO_MODE`) if such a task is created. The mode is read from the most recent `docs/superpowers/sessions/*.md` checkpoint or from `.task.metadata.mode` if present.

Reading the checkpoint inside a shell hook is fragile — keep it simple: prefer `.task.metadata.mode` if present; otherwise look at `docs/superpowers/sessions/<slug>.mode` marker file (a new convention the lead writes alongside the existing `<slug>.shape` marker — Task 9 wires that). The hook still works without the marker (just doesn't enforce).

- [ ] **Step 1: Write the failing test**

Create `plugins/team-superpower/tests/task-created-solo.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$PLUGIN_ROOT/hooks/task-created.sh"

fail=0

run_hook() {
  # run_hook <payload> [mode-marker-content]
  tmp="$(mktemp -d)"
  if [ -n "${2:-}" ]; then
    mkdir -p "$tmp/docs/superpowers/sessions"
    printf '%s' "$2" > "$tmp/docs/superpowers/sessions/foo.mode"
  fi
  CLAUDE_PROJECT_DIR="$tmp" bash "$HOOK" <<< "$1" >/dev/null 2>&1 || true
  cat "$tmp/.claude/hooks/log.jsonl" 2>/dev/null || true
  rm -rf "$tmp"
}

assert_contains() {
  if printf '%s' "$1" | grep -q -- "$2"; then echo "PASS: $3"; else echo "FAIL: $3"; fail=1; fi
}
assert_not_contains() {
  if printf '%s' "$1" | grep -q -- "$2"; then echo "FAIL: $3 (did not expect)"; fail=1; else echo "PASS: $3"; fi
}

# Case 1: solo via metadata + impl: task → warn
payload='{"task":{"title":"impl:be-foo","metadata":{"mode":"solo"}}}'
out="$(run_hook "$payload")"
assert_contains "$out" 'INVALID_FOR_SOLO_MODE' 'metadata mode=solo with impl: → INVALID_FOR_SOLO_MODE'

# Case 2: solo via marker file + impl: task → warn
payload='{"task":{"title":"impl:be-foo","metadata":{}}}'
out="$(run_hook "$payload" "solo")"
assert_contains "$out" 'INVALID_FOR_SOLO_MODE' 'marker mode=solo with impl: → INVALID_FOR_SOLO_MODE'

# Case 3: solo + meta: task → no warn
payload='{"task":{"title":"meta:something","metadata":{"mode":"solo"}}}'
out="$(run_hook "$payload")"
assert_not_contains "$out" 'INVALID_FOR_SOLO_MODE' 'mode=solo with meta: task is allowed'

# Case 4: solo + review: task → no warn
payload='{"task":{"title":"review:diff-check","metadata":{"mode":"solo"}}}'
out="$(run_hook "$payload")"
assert_not_contains "$out" 'INVALID_FOR_SOLO_MODE' 'mode=solo with review: task is allowed'

# Case 5: team mode + impl: → no warn
payload='{"task":{"title":"impl:be-foo","metadata":{"mode":"team"}}}'
out="$(run_hook "$payload")"
assert_not_contains "$out" 'INVALID_FOR_SOLO_MODE' 'mode=team with impl: is allowed'

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
```

Make executable: `chmod +x plugins/team-superpower/tests/task-created-solo.test.sh`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bash plugins/team-superpower/tests/task-created-solo.test.sh`
Expected: Cases 1 and 2 FAIL because the hook does not yet check mode.

- [ ] **Step 3: Add the solo-mode guard**

In `plugins/team-superpower/hooks/task-created.sh`, immediately AFTER the existing `Top-level prefix check` `case` (around the `*)` warn block, before the `impl:` sub-prefix check), insert:

```bash
# v3: solo-mode guard. If checkpoint mode is solo, impl:* tasks are invalid
# (solo means the lead does the work itself; no implementer is spawned).
mode_meta="$(printf '%s' "$payload" | jq -r '.task.metadata.mode // .metadata.mode // ""' 2>/dev/null || echo "")"
mode_marker=""
if [ -z "$mode_meta" ] && [ -d "$SESSIONS_DIR" ]; then
  # Look for a <slug>.mode file the lead writes when it picks a mode.
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

case "$title" in
  impl:*)
    if [ "$effective_mode" = "solo" ]; then
      printf '{"ts":"%s","hook":"task-created","warn":"INVALID_FOR_SOLO_MODE","title":%s}\n' \
        "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
    fi
    ;;
esac
```

Place this block AFTER the existing top-level prefix `case "$title" in review:*|meta:*|block:*) exit 0 ;; impl:*) ;; ...` esac (the file currently has this around lines 69–78). The new block must come before the `rest="${title#impl:}"` line so the impl sub-prefix flow still runs after we logged the solo violation. (We log only — we do not early-exit because the hook chose warn-only semantics in v2; the lead enforces.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bash plugins/team-superpower/tests/task-created-solo.test.sh`
Expected: `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add plugins/team-superpower/hooks/task-created.sh plugins/team-superpower/tests/task-created-solo.test.sh
git commit -m "feat(team-superpower): solo-mode guard in task-created hook"
```

---

## Task 8: Add Phase 0.5 (complexity assessment + flag parsing) to `team-feature.md`

**Files:**
- Modify: `plugins/team-superpower/commands/team-feature.md`

The team-feature lead prompt currently has:

- Required prechecks (numbered 0–6)
- Phase 0 (stack detection, shape, version pinning)
- Preflight (stale-state scan)
- Initial checkpoint and heartbeat

Phase 0.5 inserts between Phase 0 and the existing "Preflight" / "Initial checkpoint" sections. It (a) parses `--mode=`, `--size=`, `--explain` flags from `$ARGUMENTS`, (b) runs `assess-complexity.sh` if no `--mode` is set, (c) writes the decision to the checkpoint and to a `<slug>.mode` marker file.

The frontmatter format already documents `superpowers_version`, `plugin_version`, etc. We extend it (via prose; the format block is in the "Checkpointing" section deeper in the file). Add a note in 0.6 and add 0.7 = new mode/size record.

- [ ] **Step 1: Insert the flag-parser preamble in the prechecks**

In `plugins/team-superpower/commands/team-feature.md`, find the line `Owner's feature request:` (currently right above `$ARGUMENTS`). Immediately AFTER the `$ARGUMENTS` line (i.e. before the `## Your job` section), insert this new section:

```markdown
## Parsing the launch flags

Before doing anything else, parse override flags from the owner's request. The flags are space-separated tokens, may appear before the feature description, and use `=` to bind their value:

- `--mode=<solo|single-agent|team>` — force the execution mode; skip the heuristic ladder.
- `--size=<minimal|standard|full>` — force the team size (only meaningful with `--mode=team`; ignored otherwise — log the override but proceed).
- `--explain` — run Phase 0.5 to compute the decision, print it to the owner, and STOP. Do not spawn anything.

If any of these flags appear, strip them from `$ARGUMENTS` and treat the remainder as the actual launch message. Record the flags used in the checkpoint field `overrides_applied:` (a list of strings, empty if none).

Examples:
- `/team-feature --mode=solo update copy in welcome banner` → mode=solo, launch_message="update copy in welcome banner".
- `/team-feature --explain redesign the checkout flow` → run heuristic, print decision, stop.
- `/team-feature --mode=team --size=full add /healthcheck` → mode=team, size=full, launch_message="add /healthcheck".
```

- [ ] **Step 2: Insert Phase 0.5 right after Phase 0**

Locate the end of Phase 0 (the subsection `### 0.6 — Pin the Superpowers version` ends with a frontmatter snippet that mentions `stack_shape: full-stack | be-only | fe-only`). Immediately AFTER that frontmatter snippet closes (the closing backticks), insert this new section:

```markdown
## Phase 0.5 — Complexity assessment (mode and size)

This phase runs after stack detection and BEFORE preflight. It picks an execution mode (solo / single-agent / team) and, when applicable, a team size (minimal / standard / full). The decision is autonomous — the owner can override via `--mode` / `--size` but there is NO owner touchpoint here.

### 0.5.1 — Determine mode and size

1. If `--mode=` was supplied in the launch flags: use it directly. Skip step 2.
2. Otherwise, run the heuristic ladder:
   ```bash
   bash ${CLAUDE_PLUGIN_ROOT}/scripts/assess-complexity.sh "$LAUNCH_MESSAGE" "$PWD"
   ```
   Capture stdout — it is YAML containing `mode:`, optionally `size:`, `shape:`, and `mode_reasoning:`. Exit 0 = confident; exit 1 = ambiguous (the script defaults to team and includes the ambiguity in `mode_reasoning`).
3. If `--size=` was supplied AND the resolved mode is `team`, override the `size:` field with the flag value. If the resolved mode is `solo` or `single-agent`, log that `--size=` was ignored.

### 0.5.2 — Handle `--explain`

If `--explain` was supplied, print the YAML decision to the owner with this header and STOP — do not write the marker file, do not write the checkpoint, do not spawn anything:

```
Heuristic decision for your launch message:

<paste the YAML block from assess-complexity.sh>

Re-run without `--explain` to proceed, or supply `--mode=` / `--size=` to override.
```

### 0.5.3 — Write the mode marker

Otherwise, write the mode to a marker file the hooks can read:

```bash
mkdir -p docs/superpowers/sessions
echo "$mode" > docs/superpowers/sessions/<slug>.mode
git add docs/superpowers/sessions/<slug>.mode
```

The `TaskCreated` hook reads this marker to reject `impl:*` titles when `mode=solo`.

### 0.5.4 — Write mode and size to the checkpoint frontmatter

Extend the checkpoint frontmatter with:

```yaml
mode: solo | single-agent | team
size: minimal | standard | full       # only when mode=team
mode_reasoning: |
  <copy of mode_reasoning from assess-complexity.sh output, or "owner override via --mode=..." when flagged>
overrides_applied: []                 # list of flag strings, e.g. ["--mode=team", "--size=full"]
```

`mode_reasoning` is mandatory — it makes a wrong heuristic call debuggable later.

## Mode-specific execution

The phase chain that follows depends on the mode:

### Solo mode

- Do NOT spawn any teammates. Do NOT create a team. Skip `TeamCreate`.
- The lead does the work itself in its own session.
- Touchpoint 1 — **Plan-and-diff review**: write a one-paragraph description of the change + the proposed diff; ask the owner "Approve and apply?".
- On approval, apply the change.
- Touchpoint 2 — **Finish decision**: present the change as applied and ask the owner "Commit / discard?".
- On commit, write the commit and stop. Do NOT run a CI gate — solo changes are too small to justify it.
- The 3-touchpoint promise becomes 2 for solo mode (spec §4.6).

### Single-agent mode

- Skip designer, planner, software-architect, security-engineer, qa-engineer, reviewer.
- Spawn exactly ONE implementer matching shape: `backend-developer` if `side: be-only`, `frontend-developer` if `side: fe-only`. (Use the `side_signal:` line from `assess-complexity.sh`'s `mode_reasoning` to decide.)
- Touchpoint 1 — **Inline spec sign-off**: lead writes a one-paragraph spec at `docs/superpowers/specs/<slug>.md` and asks the owner "Ok to proceed?".
- Touchpoint 2 — **Plan approval**: lead writes a one-task inline plan at `docs/superpowers/plans/<slug>.md` (the single task usually 5 lines: `Files`, `Depends on: []`, `Verification`, code outline) and asks the owner "Approve plan?".
- Dispatch the implementer with that single task. Wait for `done`.
- Lead reviews the implementer's diff itself in a single pass (no separate reviewer teammate).
- Touchpoint 3 — **Finish decision**: run `superpowers:finishing-a-development-branch` (CI gate per `CLAUDE.md`'s `ci` block).

### Team mode

Run the full v2 phase chain with the chosen size (per the existing spawn table in §0.5 of this file). Size determines whether `software-architect`, `security-engineer`, and `qa-engineer` are spawned:

- `minimal`: designer, planner, implementer(s), reviewer (no architect / security / QA).
- `standard`: + `qa-engineer`.
- `full`: + `software-architect` + `security-engineer`.

The existing v2 phase chain (design → plan → arch+sec → impl → QA → review → finish) runs unchanged. The shape-adaptive spawn from §0.5 still applies on top of size.
```

- [ ] **Step 3: Verify the edits**

Run: `grep -n '^## Phase 0.5' plugins/team-superpower/commands/team-feature.md`
Expected: exactly one match.

Run: `grep -n '^## Parsing the launch flags' plugins/team-superpower/commands/team-feature.md`
Expected: exactly one match.

Run: `grep -nE '^### (Solo mode|Single-agent mode|Team mode)' plugins/team-superpower/commands/team-feature.md`
Expected: three matches in this order.

Run: `grep -c 'assess-complexity.sh' plugins/team-superpower/commands/team-feature.md`
Expected: at least 1.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/commands/team-feature.md
git commit -m "feat(team-superpower): Phase 0.5 complexity assessment and mode dispatch in team-feature"
```

---

## Task 9: Add `mode_reasoning` / `overrides_applied` to the checkpoint format block

**Files:**
- Modify: `plugins/team-superpower/commands/team-feature.md` (the existing **Checkpointing** section)

The "Checkpointing" section of `team-feature.md` has a YAML frontmatter format block that lists every field the checkpoint carries. Extend it to include the new v3 fields so future readers (and the resume command) know about them.

- [ ] **Step 1: Locate the existing checkpoint frontmatter block**

In `plugins/team-superpower/commands/team-feature.md`, find the section titled `## Checkpointing` (it lives later in the file, after the spawning rules). Inside it is a fenced YAML block listing all frontmatter fields used today.

- [ ] **Step 2: Extend the field list**

In that YAML block, add these lines immediately after the existing `stack_shape:` line (preserve order, do not delete anything):

```yaml
mode: solo | single-agent | team       # v3, written in phase 0.5
size: minimal | standard | full        # v3, only when mode=team
mode_reasoning: |                      # v3, populated by scripts/assess-complexity.sh or "owner override via ..."
  <multi-line reasoning trace>
overrides_applied: []                  # v3, list of flag strings, e.g. ["--mode=team", "--size=full"]
```

- [ ] **Step 3: Verify**

Run: `grep -nE '^(mode|size|mode_reasoning|overrides_applied):' plugins/team-superpower/commands/team-feature.md`
Expected: at least one match per field.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/commands/team-feature.md
git commit -m "feat(team-superpower): document v3 mode/size fields in checkpoint format"
```

---

## Task 10: End-to-end smoke check — script invocation chain

**Files:** (read-only smoke tests)

Verify the new scripts and hook chain compose correctly end-to-end. This is a manual check, not a TDD step — it confirms that Task 5's `detect-side` subcommand is reachable from Task 6's `assess-complexity.sh`, and that all four test scripts pass together.

- [ ] **Step 1: Run every test script**

```bash
bash plugins/team-superpower/tests/task-completed-iterations.test.sh
bash plugins/team-superpower/tests/detect-side-from-text.test.sh
bash plugins/team-superpower/tests/assess-complexity.test.sh
bash plugins/team-superpower/tests/task-created-solo.test.sh
```

Expected: all four print `ALL PASS` and exit 0.

- [ ] **Step 2: Spot-check the four spec example launch messages**

Run each and verify the mode:

```bash
bash plugins/team-superpower/scripts/assess-complexity.sh 'add login page' | grep '^mode:'
# Expected: mode: team

bash plugins/team-superpower/scripts/assess-complexity.sh 'fix typo in error message' | grep '^mode:'
# Expected: mode: solo

bash plugins/team-superpower/scripts/assess-complexity.sh 'add /healthcheck endpoint that returns 200 OK' | grep '^mode:'
# Expected: mode: single-agent

bash plugins/team-superpower/scripts/assess-complexity.sh 'add user preferences feature with toggle UI' | grep '^mode:'
# Expected: mode: team
```

These match acceptance criteria 1, 2, 3 from spec §3 (success criteria).

- [ ] **Step 3: Confirm manifests still parse**

```bash
python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
```

Expected: `OK`.

- [ ] **Step 4: Confirm hooks still run cleanly with minimal input**

```bash
echo '{"task":{"title":"meta:hello"}}' | bash plugins/team-superpower/hooks/task-created.sh
echo '{"task":{"title":"meta:hello"}}' | bash plugins/team-superpower/hooks/task-completed.sh
echo $?
```

Expected: exit 0; no errors.

- [ ] **Step 5: Validate that no unexpected files leak outside `plugins/team-superpower/`**

```bash
git diff --name-only main..HEAD -- ':!plugins/team-superpower/' ':!docs/superpowers/plans/'
```

Expected: empty (or only repo-config touched if needed — should be none for Plan A).

- [ ] **Step 6: No commit**

Smoke check only; no file changes here.

---

## Spec coverage trace

| Spec section | Task |
|---|---|
| §4.1 The three modes | Task 8 (mode-specific execution sections) |
| §4.2 Team sizes | Task 8 (team-mode size section) |
| §4.3 Heuristic ladder | Task 6 (assess-complexity.sh implementation) |
| §4.4 Owner override flags | Task 8 (Parsing the launch flags section) |
| §4.5 Mode/size record (checkpoint) | Tasks 8 + 9 (write mode/size/reasoning) |
| §4.6 Touchpoints by mode | Task 8 (per-mode touchpoint counts) |
| §6 MAX_ITERATIONS | Tasks 1 + 2 + 3 + 4 |
| §7.1 commands/team-feature.md Phase 0.5 + mode-specific execution | Task 8 |
| §7.5 hooks/task-created.sh solo guard | Task 7 |
| §7.6 hooks/task-completed.sh iteration cap (item 2 only — items 1/3/4 are Plan B or v2) | Task 1 |
| §7.7 assets/CLAUDE.md.template `limits` | Task 4 |
| §7.8 scripts/detect-stack.sh detect_side_from_text | Task 5 |
| §7.9 scripts/assess-complexity.sh | Task 6 |
| §8 step 1 (MAX_ITERATIONS hook) | Task 1 |
| §8 step 2 (complexity assessment script) | Tasks 5 + 6 |
| §8 step 3 (mode dispatch in lead) | Task 8 |
| §8 step 4 (override flags) | Task 8 |
| §9 acceptance crit. 1, 2, 3 (mode for sample messages) | Task 10 step 2 |
| §9 acceptance crit. 6 (`--mode` / `--size` flags + `overrides_applied:`) | Tasks 8 + 9 |
| Plan B / Plan C items | Out of scope here |

---

## Risks

| Risk | Mitigation |
|---|---|
| `assess-complexity.sh` keyword tables produce false positives in real launch messages | The owner has `--mode=` to override and `--explain` to preview. `mode_reasoning` makes wrong calls debuggable. |
| The `<slug>.mode` marker file is missing when the hook tries to enforce | Hook gracefully treats absent marker as "unknown mode" (no enforcement). Lead writes the marker BEFORE any task creation, so this only fails if the lead crashed between Phase 0.5 and Phase 1. |
| `parse-claudemd.sh get limits.max_iterations_per_task` returns empty string when key not in CLAUDE.md | Hook defaults to 8 when parse returns empty or non-numeric. |
| Existing single-feature tests in the plugin (none today) get disturbed | This plan creates `tests/` from scratch; no existing tests to break. |
| The keyword list for `detect_side_from_text` becomes a maintenance burden as projects diverge | Out of scope. Future amendment can move to CLAUDE.md-configurable keyword lists. |
