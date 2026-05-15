# team-superpower v3 — Plan B: Dependency-grouped parallel waves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the v2 team-superpower plugin so the planner emits a wave schedule, the lead dispatches up to 2 BE + 2 FE implementers per wave, collisions on shared files hard-fail and force a re-plan, and the implementers report wave metadata back through the existing hooks.

**Architecture:** Planner enriches every `impl:` task with `Files:`/`Depends on:` fields plus a `## Waves` section. Lead reads the section in phase 4 and runs a per-wave dispatcher: collision check → spawn-count calc (≤2 per side) → task claim → wait-for-completion → checkpoint. Hooks gain `MISSING_WAVE_METADATA` and a `WAVE_COLLISION` mailbox protocol. Implementers self-claim, log wave on claim, and post `WAVE_COLLISION` if they discover an undeclared overlap mid-task.

**Tech Stack:** Bash (hooks + scripts), Markdown (agent prompts + lead command), node:test for unit checks.

**Spec source:** `docs/superpowers/team-superpower-v3-spec.md` §5 (waves), §7.2 (lead dispatcher), §7.3 (planner additions), §7.4 (implementer additions), §7.5–7.6 (hooks). Spec §8 steps 5–9.

**Edit boundary:** All implementation edits stay inside `plugins/team-superpower/`. Plan doc + design doc may live under `docs/superpowers/`.

---

## Task 1 — Planner emits `Files:`/`Depends on:`/`## Waves`

Spec §7.3.

**Files:**
- Modify: `plugins/team-superpower/agents/planner.md` (Phase 2.b section + new "Wave schedule emission" subsection)
- Test: `plugins/team-superpower/tests/planner-waves-prose.test.sh` (new — grep-only prose check)

- [ ] **Step 1: Write the failing test**

Create `plugins/team-superpower/tests/planner-waves-prose.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
F="$PLUGIN_ROOT/agents/planner.md"

fail=0
assert_grep() {
  if grep -qE "$1" "$F"; then
    echo "PASS: $2"
  else
    echo "FAIL: $2 — pattern not found: $1"
    fail=1
  fi
}

assert_grep '^\s*-\s+`Files:`' 'planner.md mentions Files: field'
assert_grep '^\s*-\s+`Depends on:`' 'planner.md mentions Depends on: field'
assert_grep '## Waves' 'planner.md mentions ## Waves section'
assert_grep 'topological sort' 'planner.md explains topological sort'
assert_grep '2 `impl:be-\*` and 2 `impl:fe-\*`' 'planner.md states per-wave concurrency cap'
assert_grep 'collision check yourself' 'planner.md instructs self-collision-check'
assert_grep 'WAVE_COLLISION' 'planner.md describes WAVE_COLLISION protocol'
assert_grep 'impl:be-migration-' 'planner.md still describes migration prefix'

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
```

- [ ] **Step 2: Make it executable and run**

```bash
chmod +x plugins/team-superpower/tests/planner-waves-prose.test.sh
bash plugins/team-superpower/tests/planner-waves-prose.test.sh
```
Expected: FAIL on at least the `## Waves`, `Files:`, `Depends on:`, `WAVE_COLLISION` patterns (planner.md currently uses `files`/`depends_on` lowercase in metadata, no Waves section).

- [ ] **Step 3: Edit `plugins/team-superpower/agents/planner.md`**

Inside `## Phase 2.b — writing-plans`, item 4 currently lists metadata as: `files`, `depends_on`, `tests`, `estimated_minutes`. Replace that bullet list with:

```markdown
4. Each task in the plan MUST declare BOTH human-readable fields (in the task body) and machine metadata (consumed by hooks):
   - **`Files:`** — list of file paths or globs the task will touch. Used by the lead's collision check (spec §5.4). Path-like; wildcards expanded against the worktree.
   - **`Depends on:`** — list of task IDs (`impl:be-…` / `impl:fe-…`) that must complete first, or `[]`. Drives the wave schedule.
   - **`Verification:`** — exact command(s) the implementer runs at GREEN.
   - **`Estimated minutes:`** — integer, 2–5 (the 2–5 minute rule still applies).

   The metadata `files`, `depends_on`, `tests`, `estimated_minutes`, and the new `wave` (assigned below) are mirrored into the shared-task-list entry by the lead. Hooks read the metadata; humans read the prose Fields. Keep them in sync.
```

Then APPEND a new subsection after the "Task prefix convention (shape-aware)" subsection (immediately before `### Shape rules`):

```markdown
### Wave schedule emission (v3)

After the task list is complete, derive a wave schedule by topological sort on `Depends on:` edges:

- **Wave 1** = every task with `Depends on: []`.
- **Wave N** = every task whose dependencies are all in waves 1..N-1.

Emit the schedule as a `## Waves` section at the tail of the plan, after all task bodies:

```yaml
## Waves

### Wave 1 (parallel)
- impl:be-add-preferences-table
- impl:fe-add-changelog-entry

### Wave 2 (parallel)
- impl:be-preferences-repository
```

Within a wave, list tasks in **alphabetical order** so diffs are deterministic.

**Concurrency cap.** Each wave may have at most **2 `impl:be-*` and 2 `impl:fe-*` tasks running concurrently**. If a wave has more than 2 of a side, that's fine — the lead serializes the extras *within* the wave (no new wave needed). Do not split a wave merely to keep counts at ≤2.

**Self-collision check.** Before posting `PLAN_READY`, walk every pair of tasks within each wave and verify their `Files:` lists are disjoint (case-insensitive, leading `./` stripped). If any pair overlaps you MUST add a `Depends on:` edge between them so they end up in different waves. Wildcards expand against the current worktree; if you cannot expand them cheaply, declare a conservative dependency edge.

**Contract publish (full-stack).** The `impl:be-contract-publish-<slug>` task lands in whichever wave its declared BE dependencies clear, AND every `impl:fe-*` task carries `Depends on: [impl:be-contract-publish-<slug>]` so all FE work falls in a later wave. The lead enforces the same gate via the `CONTRACT_PUBLISHED` mailbox signal.

**Migration isolation.** Every `impl:be-migration-*` task must occupy a wave **alone** — no other BE work in the same wave (FE work in the same wave is fine if no file overlap). Chain migrations via `Depends on:` so the wave scheduler naturally serializes them.

### WAVE_COLLISION re-plan loop

If the lead pings you with `WAVE_COLLISION wave=N tasks=[T_i, T_j] shared_files=[…]`:

1. Re-derive dependencies for T_i and T_j. Pick whichever ordering is more natural (the task whose verification depends on the other's output goes second), add a `Depends on:` edge to push the second task into a later wave.
2. Re-emit the plan with the updated `## Waves` section (the rest of the plan stays).
3. Commit the revision and post `PLAN_READY <path>` again.
4. The lead caps the loop at 3 retries on the same wave before escalating to owner — do not push back, the collision is real.
```

- [ ] **Step 4: Re-run the prose test**

```bash
bash plugins/team-superpower/tests/planner-waves-prose.test.sh
```
Expected: `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add plugins/team-superpower/agents/planner.md plugins/team-superpower/tests/planner-waves-prose.test.sh
git commit -m "feat(team-superpower): planner emits Files/Depends on/## Waves per spec §7.3

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 — task-created hook recognizes `wave:` metadata

Spec §7.5 (wave-aware logging).

**Files:**
- Modify: `plugins/team-superpower/hooks/task-created.sh`
- Test: extend `plugins/team-superpower/tests/task-created-solo.test.sh` with a new assertion block, OR add `plugins/team-superpower/tests/task-created-wave.test.sh` (new — preferred to keep concerns separate).

- [ ] **Step 1: Write the failing test**

Create `plugins/team-superpower/tests/task-created-wave.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$PLUGIN_ROOT/hooks/task-created.sh"
LOG_DIR_REL=".claude/hooks"
TMP="$(mktemp -d)"
trap "rm -rf $TMP" EXIT
mkdir -p "$TMP/docs/superpowers/sessions" "$TMP/$LOG_DIR_REL"

fail=0
LOG="$TMP/$LOG_DIR_REL/log.jsonl"

run() {
  CLAUDE_PROJECT_DIR="$TMP" bash "$HOOK" <<<"$1" >/dev/null
}

# Case 1: impl:be-* with wave metadata logs the wave number
echo "full-stack" > "$TMP/docs/superpowers/sessions/foo.shape"
: > "$LOG"
run '{"task":{"title":"impl:be-thing","metadata":{"slug":"foo","wave":2}}}'
if grep -q '"wave":2' "$LOG"; then
  echo "PASS: task-created logs wave=2 for impl:be-thing"
else
  echo "FAIL: wave field not logged"
  cat "$LOG"
  fail=1
fi

# Case 2: impl: task with no wave metadata logs warn=MISSING_WAVE_METADATA
: > "$LOG"
run '{"task":{"title":"impl:be-other","metadata":{"slug":"foo"}}}'
if grep -q 'MISSING_WAVE_METADATA' "$LOG"; then
  echo "PASS: task-created warns MISSING_WAVE_METADATA when wave absent"
else
  echo "FAIL: missing-wave warning not emitted"
  cat "$LOG"
  fail=1
fi

# Case 3: meta:/review:/block: tasks do NOT trigger MISSING_WAVE_METADATA
: > "$LOG"
run '{"task":{"title":"review:diff","metadata":{"slug":"foo"}}}'
if grep -q 'MISSING_WAVE_METADATA' "$LOG"; then
  echo "FAIL: non-impl task incorrectly triggered MISSING_WAVE_METADATA"
  fail=1
else
  echo "PASS: review: task does not trigger wave warning"
fi

# Case 4: solo-mode still wins — INVALID_FOR_SOLO_MODE precedes wave check
echo "solo" > "$TMP/docs/superpowers/sessions/foo.mode"
: > "$LOG"
run '{"task":{"title":"impl:be-x","metadata":{"slug":"foo"}}}'
if grep -q 'INVALID_FOR_SOLO_MODE' "$LOG"; then
  echo "PASS: solo guard still fires alongside wave check"
else
  echo "FAIL: solo guard missing"
  cat "$LOG"
  fail=1
fi

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
```

```bash
chmod +x plugins/team-superpower/tests/task-created-wave.test.sh
bash plugins/team-superpower/tests/task-created-wave.test.sh
```
Expected: FAIL on `wave=2` log and `MISSING_WAVE_METADATA` warning.

- [ ] **Step 2: Edit `plugins/team-superpower/hooks/task-created.sh`**

After the existing `printf '{"ts":...,"title":...,"shape":...}' >> "$LOG_FILE"` block (lines 62–66 in current file), capture and log the wave number; then in the `case "$title" in impl:*) ...` block add the missing-wave warning.

Find:
```bash
printf '{"ts":"%s","hook":"task-created","title":%s,"shape":%s}\n' \
  "$ts" \
  "$(printf '%s' "$title" | jq -Rs .)" \
  "$(printf '%s' "$shape" | jq -Rs .)" \
  >> "$LOG_FILE"
```

Replace with:
```bash
wave="$(printf '%s' "$payload" | jq -r '.task.metadata.wave // .metadata.wave // ""' 2>/dev/null || echo "")"
wave_json="null"
if printf '%s' "$wave" | grep -qE '^[0-9]+$'; then
  wave_json="$wave"
fi

printf '{"ts":"%s","hook":"task-created","title":%s,"shape":%s,"wave":%s}\n' \
  "$ts" \
  "$(printf '%s' "$title" | jq -Rs .)" \
  "$(printf '%s' "$shape" | jq -Rs .)" \
  "$wave_json" \
  >> "$LOG_FILE"
```

Then, in the `case "$title" in impl:*) ...` block that currently handles `INVALID_FOR_SOLO_MODE`, add a sibling check inside the same case for missing wave metadata. Replace the existing case:

```bash
case "$title" in
  impl:*)
    if [ "$effective_mode" = "solo" ]; then
      printf '{"ts":"%s","hook":"task-created","warn":"INVALID_FOR_SOLO_MODE","title":%s}\n' \
        "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
    fi
    ;;
esac
```

With:

```bash
case "$title" in
  impl:*)
    if [ "$effective_mode" = "solo" ]; then
      printf '{"ts":"%s","hook":"task-created","warn":"INVALID_FOR_SOLO_MODE","title":%s}\n' \
        "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
    fi
    if [ -z "$wave" ]; then
      printf '{"ts":"%s","hook":"task-created","warn":"MISSING_WAVE_METADATA","title":%s}\n' \
        "$ts" "$(printf '%s' "$title" | jq -Rs .)" >> "$LOG_FILE"
    fi
    ;;
esac
```

- [ ] **Step 3: Re-run the wave test and verify other suites still pass**

```bash
bash plugins/team-superpower/tests/task-created-wave.test.sh
bash plugins/team-superpower/tests/task-created-solo.test.sh
```
Both expected: `ALL PASS`.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/hooks/task-created.sh plugins/team-superpower/tests/task-created-wave.test.sh
git commit -m "feat(team-superpower): task-created hook logs wave and warns MISSING_WAVE_METADATA

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 — task-completed hook enforces `wave:` metadata

Spec §7.6 item 1.

**Files:**
- Modify: `plugins/team-superpower/hooks/task-completed.sh`
- Test: `plugins/team-superpower/tests/task-completed-wave.test.sh` (new)

- [ ] **Step 1: Write the failing test**

Create `plugins/team-superpower/tests/task-completed-wave.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$PLUGIN_ROOT/hooks/task-completed.sh"
TMP="$(mktemp -d)"
trap "rm -rf $TMP" EXIT
mkdir -p "$TMP/.claude/hooks"

fail=0
LOG="$TMP/.claude/hooks/log.jsonl"

run() {
  CLAUDE_PROJECT_DIR="$TMP" bash "$HOOK" <<<"$1" >/dev/null
}

# Case 1: impl:* with no wave → MISSING_WAVE_METADATA
: > "$LOG"
run '{"task":{"title":"impl:be-thing","metadata":{"plan_approved_at":"2026-05-15T01:00:00Z"}}}'
if grep -q 'MISSING_WAVE_METADATA' "$LOG"; then
  echo "PASS: missing wave warning on impl: task"
else
  echo "FAIL: expected MISSING_WAVE_METADATA"
  cat "$LOG"
  fail=1
fi

# Case 2: impl:* with wave=1 → no missing warning
: > "$LOG"
run '{"task":{"title":"impl:fe-thing","metadata":{"plan_approved_at":"2026-05-15T01:00:00Z","wave":1}}}'
if grep -q 'MISSING_WAVE_METADATA' "$LOG"; then
  echo "FAIL: wave present but warning fired"
  cat "$LOG"
  fail=1
else
  echo "PASS: wave present suppresses warning"
fi

# Case 3: meta:/review: tasks never trigger MISSING_WAVE_METADATA
: > "$LOG"
run '{"task":{"title":"review:diff","metadata":{}}}'
if grep -q 'MISSING_WAVE_METADATA' "$LOG"; then
  echo "FAIL: non-impl task triggered wave warning"
  fail=1
else
  echo "PASS: review: task ignored by wave check"
fi

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
```

```bash
chmod +x plugins/team-superpower/tests/task-completed-wave.test.sh
bash plugins/team-superpower/tests/task-completed-wave.test.sh
```
Expected: FAIL on Case 1.

- [ ] **Step 2: Edit `plugins/team-superpower/hooks/task-completed.sh`**

Insert a new wave-metadata check immediately AFTER the existing `case "$title" in impl:*) if [ -z "$plan_approved_at" ] ...` block (current lines 48–54), and BEFORE the v3 MAX_ITERATIONS guardrail block:

```bash
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
```

- [ ] **Step 3: Re-run the new test and the existing iteration suite**

```bash
bash plugins/team-superpower/tests/task-completed-wave.test.sh
bash plugins/team-superpower/tests/task-completed-iterations.test.sh
```
Both expected: `ALL PASS`.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/hooks/task-completed.sh plugins/team-superpower/tests/task-completed-wave.test.sh
git commit -m "feat(team-superpower): task-completed warns MISSING_WAVE_METADATA per spec §7.6

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 — `wave-collision-check.sh` helper script

Spec §5.4 — collision detection. New helper the lead invokes at the top of each wave; takes a YAML-ish task list on stdin and exits 0 (no collision) or 1 (collision) with diagnostic on stdout.

**Files:**
- Create: `plugins/team-superpower/scripts/wave-collision-check.sh`
- Test: `plugins/team-superpower/tests/wave-collision-check.test.sh` (new)

- [ ] **Step 1: Write the failing test**

```bash
#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$PLUGIN_ROOT/scripts/wave-collision-check.sh"

fail=0

assert_collision() {
  # $1: stdin content, $2: expected exit (0|1), $3: test name
  local out exit_code
  out="$(printf '%s' "$1" | bash "$SCRIPT" 2>&1)" && exit_code=0 || exit_code=$?
  if [ "$exit_code" = "$2" ]; then
    echo "PASS: $3"
  else
    echo "FAIL: $3 — exit=$exit_code expected=$2"
    echo "  output: $out"
    fail=1
  fi
}

# Disjoint files → exit 0
assert_collision "impl:be-a src/a.cs
impl:be-b src/b.cs" 0 "disjoint files → no collision"

# Shared file → exit 1
assert_collision "impl:be-a src/shared.cs
impl:be-b src/shared.cs" 1 "shared file → collision"

# Case-insensitive normalization
assert_collision "impl:be-a Src/Auth.cs
impl:be-b src/auth.cs" 1 "case-insensitive collision"

# Leading ./ stripped
assert_collision "impl:be-a ./src/x.cs
impl:be-b src/x.cs" 1 "leading-dotslash collision"

# Multiple files per task, partial overlap
assert_collision "impl:be-a src/a.cs src/shared.cs
impl:be-b src/b.cs src/shared.cs" 1 "partial-overlap collision"

# Single task in wave → exit 0
assert_collision "impl:be-only src/x.cs" 0 "single task → no collision"

# Three tasks, only one pair collides → exit 1
assert_collision "impl:be-a src/a.cs
impl:be-b src/b.cs
impl:be-c src/a.cs" 1 "three tasks, one collision pair"

# Diagnostic includes the colliding task IDs and the shared file
out="$(printf 'impl:be-x src/foo.cs
impl:be-y src/foo.cs' | bash "$SCRIPT" 2>&1 || true)"
if printf '%s' "$out" | grep -q 'impl:be-x' && printf '%s' "$out" | grep -q 'impl:be-y' && printf '%s' "$out" | grep -qi 'foo.cs'; then
  echo "PASS: diagnostic names the collision"
else
  echo "FAIL: diagnostic missing task IDs or filename"
  echo "  output: $out"
  fail=1
fi

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
```

Save as `plugins/team-superpower/tests/wave-collision-check.test.sh`, `chmod +x`, and run. Expected: every assertion fails (script does not exist yet).

- [ ] **Step 2: Implement the script**

Create `plugins/team-superpower/scripts/wave-collision-check.sh`:

```bash
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

while IFS= read -r line; do
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
```

```bash
chmod +x plugins/team-superpower/scripts/wave-collision-check.sh
```

- [ ] **Step 3: Run the test**

```bash
bash plugins/team-superpower/tests/wave-collision-check.test.sh
```
Expected: `ALL PASS`.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/scripts/wave-collision-check.sh plugins/team-superpower/tests/wave-collision-check.test.sh
git commit -m "feat(team-superpower): wave-collision-check.sh helper for wave dispatch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 — backend-developer wave lifecycle

Spec §7.4.

**Files:**
- Modify: `plugins/team-superpower/agents/backend-developer.md` (Hard rules + new "Wave lifecycle" subsection)
- Test: `plugins/team-superpower/tests/backend-developer-waves-prose.test.sh` (new)

- [ ] **Step 1: Write the prose test**

```bash
#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
F="$PLUGIN_ROOT/agents/backend-developer.md"

fail=0
assert_grep() {
  if grep -qE "$1" "$F"; then
    echo "PASS: $2"
  else
    echo "FAIL: $2 — pattern not found: $1"
    fail=1
  fi
}

assert_grep '## Wave lifecycle' 'backend-developer.md has Wave lifecycle section'
assert_grep 'self-claim' 'backend-developer.md describes self-claim behavior'
assert_grep 'WAVE_COLLISION' 'backend-developer.md mentions WAVE_COLLISION'
assert_grep '`wave:`' 'backend-developer.md references wave metadata'
assert_grep 'idle' 'backend-developer.md acknowledges between-wave idle'

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
```

Save as `plugins/team-superpower/tests/backend-developer-waves-prose.test.sh`, `chmod +x`, run. Expected: failures.

- [ ] **Step 2: Edit `plugins/team-superpower/agents/backend-developer.md`**

Add a new subsection immediately before `## Hard rules`. (If unsure where, place it after the last subsection of the role brief and before the Hard rules list.)

```markdown
## Wave lifecycle (v3)

Every task you claim carries `wave:` metadata (an integer). The planner assigns it in `## Waves`; the lead mirrors it into the shared-task-list entry at dispatch.

1. **At claim:** read `wave:` from the task metadata. Log it on the first line of your work for the task (`"wave_claim: be-instance-N, task=<id>, wave=<W>"`) so the lead can correlate parallel implementer instances.
2. **Self-collision check before writing code:** look at every other in-progress `impl:be-*` task in the same wave (visible in the shared task list). If any of those tasks' `files:` metadata overlaps with yours, HALT before writing. Post `WAVE_COLLISION wave=<W> tasks=[<your-task>, <other-task>] shared_files=[<overlap>]` to the lead's mailbox and stop. The lead will route to planner for a re-plan.
3. **Between waves:** if no `impl:be-*` task in the current wave matches your prefix or remains unclaimed, idle. Re-check the shared task list on every heartbeat tick. Do NOT spawn extra tasks or claim from a future wave — the lead controls wave advancement.
4. **`iteration_count`:** continues to apply per the MAX_ITERATIONS Hard rule. A wave halt resets nothing; counts persist per task across the wave.
```

- [ ] **Step 3: Re-run the prose test**

```bash
bash plugins/team-superpower/tests/backend-developer-waves-prose.test.sh
```
Expected: `ALL PASS`.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/agents/backend-developer.md plugins/team-superpower/tests/backend-developer-waves-prose.test.sh
git commit -m "feat(team-superpower): backend-developer wave lifecycle per spec §7.4

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 — frontend-developer wave lifecycle

Spec §7.4. Same shape as Task 5, FE side.

**Files:**
- Modify: `plugins/team-superpower/agents/frontend-developer.md`
- Test: `plugins/team-superpower/tests/frontend-developer-waves-prose.test.sh` (new)

- [ ] **Step 1: Write the prose test**

```bash
#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
F="$PLUGIN_ROOT/agents/frontend-developer.md"

fail=0
assert_grep() {
  if grep -qE "$1" "$F"; then
    echo "PASS: $2"
  else
    echo "FAIL: $2 — pattern not found: $1"
    fail=1
  fi
}

assert_grep '## Wave lifecycle' 'frontend-developer.md has Wave lifecycle section'
assert_grep 'self-claim' 'frontend-developer.md describes self-claim behavior'
assert_grep 'WAVE_COLLISION' 'frontend-developer.md mentions WAVE_COLLISION'
assert_grep '`wave:`' 'frontend-developer.md references wave metadata'
assert_grep 'idle' 'frontend-developer.md acknowledges between-wave idle'
assert_grep 'contract' 'frontend-developer.md notes contract dependency in waves'

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
```

`chmod +x` + run. Expected: failures.

- [ ] **Step 2: Edit `plugins/team-superpower/agents/frontend-developer.md`**

Insert a new subsection before `## Hard rules`:

```markdown
## Wave lifecycle (v3)

Every task you claim carries `wave:` metadata (an integer). The planner assigns it in `## Waves`; the lead mirrors it into the shared-task-list entry at dispatch.

1. **At claim:** read `wave:` from the task metadata. Log it on the first line of your work for the task (`"wave_claim: fe-instance-N, task=<id>, wave=<W>"`) so the lead can correlate parallel implementer instances.
2. **Self-collision check before writing code:** look at every other in-progress `impl:fe-*` task in the same wave. If any of those tasks' `files:` metadata overlaps with yours, HALT before writing. Post `WAVE_COLLISION wave=<W> tasks=[<your-task>, <other-task>] shared_files=[<overlap>]` to the lead's mailbox and stop.
3. **Contract gate (full-stack only):** every `impl:fe-*` task lists `impl:be-contract-publish-<slug>` as a dependency. Re-pull the contract hash on every resume; if the hash differs from what the BE published, post `CONTRACT_DRIFT_DETECTED` to the lead and idle until `CONTRACT_UPDATED` arrives.
4. **Between waves:** idle if no `impl:fe-*` task in the current wave matches your queue. Re-check the shared task list each heartbeat tick. Do NOT claim from a future wave; the lead controls wave advancement.
5. **`iteration_count`:** continues to apply per the MAX_ITERATIONS Hard rule. Counts persist per task across wave halts.
```

- [ ] **Step 3: Re-run the prose test**

```bash
bash plugins/team-superpower/tests/frontend-developer-waves-prose.test.sh
```
Expected: `ALL PASS`.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/agents/frontend-developer.md plugins/team-superpower/tests/frontend-developer-waves-prose.test.sh
git commit -m "feat(team-superpower): frontend-developer wave lifecycle per spec §7.4

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7 — team-feature lead: Phase 4 wave dispatcher

Spec §7.2 — the central change. Rewrites the existing Phase 4 step in `commands/team-feature.md` and adds the collision-retry policy.

**Files:**
- Modify: `plugins/team-superpower/commands/team-feature.md`
- Test: `plugins/team-superpower/tests/team-feature-waves-prose.test.sh` (new)

- [ ] **Step 1: Write the prose test**

```bash
#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
F="$PLUGIN_ROOT/commands/team-feature.md"

fail=0
assert_grep() {
  if grep -qE "$1" "$F"; then
    echo "PASS: $2"
  else
    echo "FAIL: $2 — pattern not found: $1"
    fail=1
  fi
}

assert_grep 'Phase 4' 'team-feature.md retains Phase 4 section'
assert_grep '## Waves' 'team-feature.md references plan ## Waves section'
assert_grep 'wave-collision-check.sh' 'team-feature.md invokes wave-collision-check helper'
assert_grep 'WAVE_COLLISION' 'team-feature.md routes WAVE_COLLISION to planner'
assert_grep '3 .*re-plan' 'team-feature.md caps re-plans at 3'
assert_grep 'min\(.*be_count.*2\)' 'team-feature.md describes BE spawn-count cap of 2'
assert_grep 'min\(.*fe_count.*2\)' 'team-feature.md describes FE spawn-count cap of 2'
assert_grep 'wave: N/M' 'team-feature.md emits per-wave checkpoint field'

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
```

`chmod +x` + run. Expected: failures.

- [ ] **Step 2: Edit `plugins/team-superpower/commands/team-feature.md`**

Locate the existing Phase 4 block (search for `4. **Implementation (shape-adaptive, parallel where allowed).**`). Replace the entire numbered item 4 (it ends with the line: `Checkpoint after each task transition: \`phase: implementation, tasks_complete: M/N\`. Touch heartbeat at every transition.`) with:

```markdown
4. **Implementation (wave-based, shape-adaptive).** Read the approved plan's `## Waves` section. For each wave N in order:

   **4.1 Collision check.** Build a wave manifest by concatenating each task's `id` + space-separated `files:` metadata, one task per line. Pipe it to `bash ${CLAUDE_PLUGIN_ROOT}/scripts/wave-collision-check.sh`. Exit 0 → proceed. Exit 1 → halt the wave, do NOT dispatch any task in it, post `WAVE_COLLISION wave=N tasks=[…] shared_files=[…]` to the planner's mailbox (verbatim from the helper output), and wait for a fresh `PLAN_READY <path>`. Re-read the plan, re-build the manifest, re-run the collision check. Cap the loop at **3 retries on the same wave** (`wave_replans: K/3` in the checkpoint). On the 4th attempt, escalate to owner via §7 template — planner cannot converge on this dependency graph.

   **4.2 Create task entries.** For every task in this wave, create one shared-task-list entry with title from the plan (`impl:be-*`, `impl:fe-*`, `impl:be-migration-*`, `impl:be-contract-publish-*`, `impl:contract-update-*`). Set metadata: `wave: N`, `depends_on: [...]`, `files: [...]`, `tests: [...]`, `estimated_minutes`, `plan_approved_at`, `iteration_count: 0`. The `TaskCreated` hook will warn on missing wave.

   **4.3 Spawn counts.**
   - `be_count = count(impl:be-* tasks in wave N)`; `fe_count = count(impl:fe-* tasks in wave N)`.
   - Live BE instances target = `min(be_count, 2)`; FE target = `min(fe_count, 2)`.
   - If a live instance is below target, spawn additional implementer(s) for that side using the canonical spawn-prompt template (§Spawn prompt template). Reuse already-spawned implementers across waves — do NOT respawn.
   - If a live instance is above target (previous wave had more tasks than this one), let it idle. Idle instances do NOT trigger `TeammateIdle` because that hook checks unanswered peer mail, not work activity.

   **4.4 Task claim.** Each implementer self-claims one task from the wave queue matching its side prefix. The lead does NOT assign tasks explicitly — implementers pull from the queue. If a side has more tasks than instances, the extras get claimed serially by whichever instance frees up first.

   **4.5 Contract gate.** If the wave contains `impl:be-contract-publish-<slug>`, do NOT release any `impl:fe-*` queue items until `CONTRACT_PUBLISHED <task-id>` arrives, even if the FE tasks technically live in a later wave. Plan dependencies already enforce this; the gate is a backstop.

   **4.6 Migration serialization.** `impl:be-migration-*` tasks must occupy a wave alone on the BE side. The planner enforces upfront via `Depends on:`; the `TaskCompleted` hook is a final backstop with `MIGRATION_RACE`.

   **4.7 Mid-wave collision.** If an implementer posts `WAVE_COLLISION` mid-wave (an undeclared overlap surfaced during work), halt the wave: keep in-flight tasks running to completion, do not claim any further task, route the collision to planner as in 4.1. Same 3-retry cap.

   **4.8 Mid-implementation contract drift.** If `CONTRACT_DRIFT_DETECTED` arrives from frontend-developer, or backend-developer files `impl:contract-update-*` on its own, pause all `impl:fe-*` claims until `CONTRACT_UPDATED <task-id>` arrives. Frontend-developer re-pulls the contract hash on resume.

   **4.9 Wave completion.** A wave completes when:
   - every task in the wave has status `done`,
   - every task's `TaskCompleted` hook returned 0 (verified via the JSONL log),
   - no implementer holds unanswered peer mail relevant to this wave.

   On completion, checkpoint: `phase: implementation, wave: N/M, tasks_complete: X/Y` and advance to wave N+1.

   **4.10 Task failure inside a wave.** If any task fails (`iteration_count` exceeded with no reflection, two-stage review rejects, test never goes green), halt the wave at that task. Other in-flight tasks finish; no new claims until the failure resolves via the four-class clarification routing. On resolution: resume the wave from where it stopped — do NOT restart.

   **4.11 Idle implementer cleanup.** Between waves, if any implementer instance has been idle for the entire previous wave AND no upcoming wave will use it, the lead MAY shut it down to free context. Fresh implementers spawn for later waves on demand. (Optional; harmless to leave idle implementers alive.)

   Checkpoint after each wave: `phase: implementation, wave: N/M, tasks_complete: X/Y`. Touch heartbeat. Do not advance to phase 5 until wave M/M completes.
```

- [ ] **Step 3: Re-run the prose test**

```bash
bash plugins/team-superpower/tests/team-feature-waves-prose.test.sh
```
Expected: `ALL PASS`.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/commands/team-feature.md plugins/team-superpower/tests/team-feature-waves-prose.test.sh
git commit -m "feat(team-superpower): Phase 4 wave dispatcher in team-feature lead

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8 — Checkpoint format documents wave fields

Spec §7.2 + §5.5. Add `wave: N/M`, `wave_replans: K/3`, `tasks_complete: X/Y` to the checkpoint frontmatter example in `commands/team-feature.md`.

**Files:**
- Modify: `plugins/team-superpower/commands/team-feature.md` (the checkpoint frontmatter example block — same one that already documents v3 mode/size fields from Plan A)

- [ ] **Step 1: Locate the checkpoint example**

```bash
grep -n 'mode_reasoning\|overrides_applied' plugins/team-superpower/commands/team-feature.md | head -5
```
Identify the YAML frontmatter block that documents `mode`, `size`, `mode_reasoning`, `overrides_applied` (added in Plan A Task 9). The wave fields go in the same example.

- [ ] **Step 2: Edit**

In that example block, append three new commented fields right before the closing `---`:

```yaml
wave: 0/0                        # current wave / total waves during phase 4 (set when phase 4 starts)
wave_replans: 0/3                # collision-driven re-plans for the current wave; cap 3 before owner escalation
tasks_complete: 0/0              # tasks complete in current wave / wave size
```

If you cannot find a single canonical block, append a `## Wave fields in the checkpoint` subsection at the end of the existing checkpoint documentation explaining the three fields with the same wording.

- [ ] **Step 3: Verify with grep**

```bash
grep -n 'wave_replans\|tasks_complete: 0/0' plugins/team-superpower/commands/team-feature.md
```
Expected: at least 2 lines matched.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/commands/team-feature.md
git commit -m "docs(team-superpower): document wave/wave_replans/tasks_complete checkpoint fields

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9 — End-to-end smoke check for Plan B

Run all Plan B test suites + Plan A test suites + JSON manifest validation. No code changes.

**Files:**
- None modified; verification only.

- [ ] **Step 1: Run all test suites**

```bash
for t in plugins/team-superpower/tests/*.test.sh; do
  echo "=== $t ==="
  bash "$t"
done
```
Expected: every suite ends with `ALL PASS`.

- [ ] **Step 2: Validate manifests**

```bash
python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
```
Expected: `OK`.

- [ ] **Step 3: Sanity-check the lead command file parses as Markdown (no broken YAML fence in checkpoint example)**

```bash
grep -cE '^```' plugins/team-superpower/commands/team-feature.md
```
Expected: an even number (every code fence opens and closes).

- [ ] **Step 4: Verify wave-collision-check.sh handles real planner output shape**

Manual fixture:

```bash
printf 'impl:be-add-preferences-table db/migrations/2026-05-12-add-preferences-table.sql
impl:fe-add-changelog-entry CHANGELOG.md\n' | bash plugins/team-superpower/scripts/wave-collision-check.sh
echo "exit=$?"
```
Expected: empty stdout, `exit=0`.

```bash
printf 'impl:be-a src/auth.cs
impl:be-b src/auth.cs\n' | bash plugins/team-superpower/scripts/wave-collision-check.sh
echo "exit=$?"
```
Expected: one `COLLISION impl:be-a impl:be-b src/auth.cs` line, `exit=1`.

- [ ] **Step 5: No commit — verification only**

If everything passes, Plan B is shipped. If anything fails, fix in place and amend the previous commit for that task.

---

## Self-review notes

- Every task touches files only inside `plugins/team-superpower/` (per CLAUDE.md plugins-only-edits rule) or under `plugins/team-superpower/tests/`.
- Hook tests run hermetically via `CLAUDE_PROJECT_DIR=<tmpdir>` — no global state contamination.
- Prose tests use `grep -qE` regex against committed markdown — fast, deterministic, replaces the lack of an executable spec for prompts.
- Tasks ordered to keep dependencies linear: prose changes first (planner, hooks), helper script next, then implementer prose, then the lead's dispatcher (which references all the above), then docs, then smoke.
- The wave-collision-check.sh script is intentionally minimal: O(n²) pair compare on small wave sizes (≤ 4 tasks per side × 2 sides = 8 tasks max) is cheap. Glob expansion is deferred to the lead — the helper receives already-expanded file lists.
