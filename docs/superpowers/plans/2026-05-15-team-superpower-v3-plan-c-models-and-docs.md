# team-superpower v3 — Plan C: Per-role model + effort pins, preflight attestation, docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply spec §11 model/effort assignments across all 8 agent definition files, add `/effort` first-turn directive bodies, wire preflight teammate-model attestation in the lead command (§7.14), and update plugin docs (README, SESSION_README, CLAUDE.md.template) to describe the v3 capabilities shipped by Plans A and B.

**Architecture:** Pure prose/frontmatter edits across `plugins/team-superpower/`. Each agent gets `model: opus | sonnet` (alias, per §11.4 — env vars do the version pinning) plus a body directive instructing it to run `/effort <level>` on first turn and report `effort_set:` / `model_actual:` in its first heartbeat. The lead command captures those fields and surfaces a one-question owner touchpoint on model mismatch. Docs catch up: README adds a v3 overview, SESSION_README documents mode/waves/iteration cap, CLAUDE.md.template gets a commentary note about `--mode`/`--size`.

**Tech Stack:** Markdown (agents + commands + docs), YAML frontmatter.

**Spec source:** `docs/superpowers/team-superpower-v3-spec.md` §7.7, §7.10–§7.14, §11. Spec §8 steps 10–12.

**Edit boundary:** Agent + command + asset files inside `plugins/team-superpower/`, plus top-level `README.md` (the marketplace README explicitly mentions the plugin — per repo CLAUDE.md, the README is allowed to change when adding plugin features).

---

## Target model + effort matrix (§11.1)

| Role | model | effort | First-turn directive | Notes |
|---|---|---|---|---|
| designer | `opus` | `high` | once per session | currently `claude-opus-4-7` / `xhigh` — change to alias + high |
| software-architect | `opus` | `high` | once per session | currently `claude-opus-4-6` / `high` — change pin to alias |
| security-engineer | `opus` | `high` | once per session | currently `claude-opus-4-6` / `high` — alias |
| reviewer | `opus` | `high` | once per session | currently `claude-opus-4-6` / `high` — alias |
| planner | `sonnet` | `high` | once per session | currently `claude-opus-4-6` / `high` — model + effort both change |
| qa-engineer | `sonnet` | `high` | once per session | currently `claude-opus-4-6` / `high` — model change |
| backend-developer | `sonnet` | `medium` | per task | currently `claude-opus-4-6` / `high` — both change |
| frontend-developer | `sonnet` | `medium` | per task | currently `claude-opus-4-6` / `high` — both change |

The frontmatter pin uses the alias (`opus` / `sonnet`) per §11.4; env vars `ANTHROPIC_DEFAULT_OPUS_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` do the version pinning. Mixing styles is a debugging trap; pick alias everywhere.

---

## Task 1 — Designer + Architect + Security + Reviewer: Opus alias + high effort

Spec §7.10. These four roles already run at `effort: high`. Only the `model:` pin changes (or the `xhigh` for designer drops to `high` per spec table) and a `/effort` directive is added to each body.

**Files:**
- Modify: `plugins/team-superpower/agents/designer.md`
- Modify: `plugins/team-superpower/agents/software-architect.md`
- Modify: `plugins/team-superpower/agents/security-engineer.md`
- Modify: `plugins/team-superpower/agents/reviewer.md`
- Test: `plugins/team-superpower/tests/agent-model-pins.test.sh` (new)

- [ ] **Step 1: Write the failing pin test**

Create `plugins/team-superpower/tests/agent-model-pins.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

fail=0
check_pin() {
  # check_pin <file> <expected-model> <expected-effort> <name>
  local f="$PLUGIN_ROOT/agents/$1"
  local exp_model="$2"
  local exp_effort="$3"
  local name="$4"
  local actual_model actual_effort
  actual_model="$(awk '/^---$/{n++;next} n==1 && /^model:/{print $2}' "$f" | head -n1)"
  actual_effort="$(awk '/^---$/{n++;next} n==1 && /^effort:/{print $2}' "$f" | head -n1)"
  if [ "$actual_model" = "$exp_model" ] && [ "$actual_effort" = "$exp_effort" ]; then
    echo "PASS: $name model=$exp_model effort=$exp_effort"
  else
    echo "FAIL: $name model=$actual_model (want $exp_model), effort=$actual_effort (want $exp_effort)"
    fail=1
  fi
}

check_directive() {
  # check_directive <file> <expected-effort-level> <name>
  local f="$PLUGIN_ROOT/agents/$1"
  local lvl="$2"
  local name="$3"
  if grep -qE "/effort[[:space:]]+$lvl" "$f"; then
    echo "PASS: $name has /effort $lvl body directive"
  else
    echo "FAIL: $name missing /effort $lvl directive"
    fail=1
  fi
}

# Opus roles
check_pin designer.md opus high 'designer'
check_pin software-architect.md opus high 'software-architect'
check_pin security-engineer.md opus high 'security-engineer'
check_pin reviewer.md opus high 'reviewer'
check_directive designer.md high 'designer'
check_directive software-architect.md high 'software-architect'
check_directive security-engineer.md high 'security-engineer'
check_directive reviewer.md high 'reviewer'

# Sonnet roles
check_pin planner.md sonnet high 'planner'
check_pin qa-engineer.md sonnet high 'qa-engineer'
check_pin backend-developer.md sonnet medium 'backend-developer'
check_pin frontend-developer.md sonnet medium 'frontend-developer'
check_directive planner.md high 'planner'
check_directive qa-engineer.md high 'qa-engineer'
check_directive backend-developer.md medium 'backend-developer'
check_directive frontend-developer.md medium 'frontend-developer'

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
```

`chmod +x` and run — expect all fails.

- [ ] **Step 2: Update designer.md**

Change frontmatter to:
```yaml
model: opus
effort: high
```

Append a new subsection BEFORE the existing `## Thinking discipline` (or first major heading after the H1):

```markdown
## First-turn directive (v3)

At the start of your first turn, run `/effort high` to set your reasoning effort. In your first heartbeat/checkpoint message back to the lead, include the self-report fields:

```
effort_set: high
model_actual: <the model you are running on per /model output>
```

The lead captures these and verifies them against your pinned `model: opus`. If `model_actual` does not match the pinned alias (e.g. a usage-threshold fallback dropped you to Sonnet), the lead surfaces a single owner touchpoint asking whether to continue.
```

- [ ] **Step 3: Update software-architect.md, security-engineer.md, reviewer.md**

For each of the three files:
- Change frontmatter `model:` to `opus` (drop the explicit version).
- Keep `effort: high`.
- Append the same `## First-turn directive (v3)` subsection from Step 2 BEFORE the role's first content section. Identical body.

- [ ] **Step 4: Re-run the test (partial PASS expected)**

```bash
bash plugins/team-superpower/tests/agent-model-pins.test.sh
```
Designer + architect + security + reviewer rows should PASS. Sonnet rows still FAIL (handled in Tasks 2 and 3).

- [ ] **Step 5: Commit**

```bash
git add plugins/team-superpower/agents/designer.md plugins/team-superpower/agents/software-architect.md plugins/team-superpower/agents/security-engineer.md plugins/team-superpower/agents/reviewer.md plugins/team-superpower/tests/agent-model-pins.test.sh
git commit -m "feat(team-superpower): pin Opus + add /effort directive on designer/architect/security/reviewer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 — Planner + QA-engineer: Sonnet alias + high effort

Spec §7.10 (qa) + §7.11 (planner).

**Files:**
- Modify: `plugins/team-superpower/agents/planner.md`
- Modify: `plugins/team-superpower/agents/qa-engineer.md`

- [ ] **Step 1: Update planner.md**

Change frontmatter:
```yaml
model: sonnet
effort: high
```

Append the `## First-turn directive (v3)` subsection (same body as Task 1 Step 2, with `/effort high`).

- [ ] **Step 2: Update qa-engineer.md**

Change frontmatter:
```yaml
model: sonnet
effort: high
```

Append the same `## First-turn directive (v3)` subsection with `/effort high`.

- [ ] **Step 3: Re-run test**

```bash
bash plugins/team-superpower/tests/agent-model-pins.test.sh
```
Planner + qa-engineer rows should now PASS. backend-developer + frontend-developer still FAIL.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/agents/planner.md plugins/team-superpower/agents/qa-engineer.md
git commit -m "feat(team-superpower): re-pin planner and qa-engineer to Sonnet/high per spec §11

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 — Backend + Frontend developer: Sonnet + medium effort, per-task directive

Spec §7.11. Implementers fire the directive **per task** (each new task is a fresh subagent dispatched by subagent-driven-development), so the directive's wording differs slightly.

**Files:**
- Modify: `plugins/team-superpower/agents/backend-developer.md`
- Modify: `plugins/team-superpower/agents/frontend-developer.md`

- [ ] **Step 1: Update backend-developer.md frontmatter**

```yaml
model: sonnet
effort: medium
```

Append a new subsection BEFORE `## Wave lifecycle (v3)` (added in Plan B Task 5):

```markdown
## First-turn directive (v3)

At the start of every task you claim (each task is a fresh subagent dispatch), run `/effort medium` to set your reasoning effort. In your task-start log entry, include the self-report fields:

```
effort_set: medium
model_actual: <the model you are running on per /model output>
task: <task-id>
wave: <wave number from task metadata>
```

The lead correlates these across instances. If `model_actual` does not match the pinned alias `sonnet`, the lead surfaces a single owner touchpoint asking whether to continue. Repeat per task; do not assume the previous task's effort sticks across dispatches.
```

- [ ] **Step 2: Update frontend-developer.md**

Same frontmatter change (`model: sonnet`, `effort: medium`). Append the same `## First-turn directive (v3)` subsection before `## Wave lifecycle (v3)`.

- [ ] **Step 3: Re-run the full test**

```bash
bash plugins/team-superpower/tests/agent-model-pins.test.sh
```
Expected: `ALL PASS` (all 16 assertions).

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/agents/backend-developer.md plugins/team-superpower/agents/frontend-developer.md
git commit -m "feat(team-superpower): re-pin BE/FE implementers to Sonnet/medium per spec §11

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 — Lead preflight: teammate model attestation

Spec §7.14.

**Files:**
- Modify: `plugins/team-superpower/commands/team-feature.md` (`## Required prechecks` section and the spawn-prompt template)
- Test: `plugins/team-superpower/tests/team-feature-attestation-prose.test.sh` (new)

- [ ] **Step 1: Write the failing prose test**

```bash
#!/usr/bin/env bash
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
F="$PLUGIN_ROOT/commands/team-feature.md"

fail=0
assert_grep() {
  if grep -qE "$1" "$F"; then echo "PASS: $2"; else echo "FAIL: $2 — pattern not found: $1"; fail=1; fi
}

assert_grep 'model_actual' 'team-feature.md captures model_actual'
assert_grep 'effort_set' 'team-feature.md captures effort_set'
assert_grep 'usage-threshold fallback' 'team-feature.md mentions usage-threshold fallback'
assert_grep 'pinned' 'team-feature.md surfaces pinned-vs-actual mismatch'
assert_grep 'recovery touchpoint' 'team-feature.md classifies attestation as recovery touchpoint'

if [ "$fail" -eq 0 ]; then echo "ALL PASS"; exit 0; fi
exit 1
```

`chmod +x` and run — expect failures.

- [ ] **Step 2: Edit `commands/team-feature.md`**

In `## Required prechecks (run these first, in order)`, after item 0 (lead-model self-attestation), append a new item:

```markdown
0b. **Teammate model attestation (v3).** When you spawn each teammate, capture the teammate's first heartbeat/checkpoint message and parse two self-report fields:
    - `model_actual:` — the model the teammate is actually running on (per its `/model` output).
    - `effort_set:` — the effort level it set on first turn.

    Compare `model_actual` against the teammate's frontmatter `model:` pin (`opus` or `sonnet` alias). If they differ — usually because a usage-threshold fallback dropped Opus to Sonnet, or vice versa — log the mismatch to the checkpoint and surface a one-question **recovery touchpoint** to the owner:

    > Teammate `<role>` is running `<actual>` instead of the pinned `<expected>` (likely a usage-threshold fallback). Continue or abort?

    This recovery touchpoint is NOT counted against the 3-touchpoint budget — it only fires on fallback, which is rare. Owner answers `continue` (proceed) or `abort` (halt and re-launch when usage resets).

    If `effort_set` is missing or differs from the recommended level for that role (per §11.1: designer/architect/security/reviewer/planner/qa = `high`; backend/frontend = `medium`), log a warning to the checkpoint but do NOT surface to owner — soft enforcement only.
```

In `## Spawn prompt template`, append after the existing template body:

```markdown
**Heartbeat self-reports (v3).** Every teammate's first checkpoint message back to the lead MUST include these self-report fields so preflight model attestation works:

```
effort_set: <level the teammate set with /effort>
model_actual: <model from /model output>
```

If a teammate omits these, the lead logs `MISSING_MODEL_ATTESTATION` to the checkpoint and asks the teammate once to add them. Persistent omission is logged but not blocked — soft enforcement.
```

- [ ] **Step 3: Re-run the prose test**

```bash
bash plugins/team-superpower/tests/team-feature-attestation-prose.test.sh
```
Expected: `ALL PASS`.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/commands/team-feature.md plugins/team-superpower/tests/team-feature-attestation-prose.test.sh
git commit -m "feat(team-superpower): preflight teammate model attestation per spec §7.14

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 — CLAUDE.md.template commentary update

Spec §7.7 (second paragraph).

**Files:**
- Modify: `plugins/team-superpower/assets/CLAUDE.md.template`

- [ ] **Step 1: Edit the file**

The existing `limits:` block already has `max_iterations_per_task: 8` (Plan A Task 4 added it). Append a new commentary paragraph after the file's existing usage commentary at the top (the `<!-- ... -->` block at lines 3–14), OR add a one-line trailer comment to the `limits:` block. Pick the trailer-comment approach for minimal churn:

Find:
```yaml
  # max_parallel_implementers: 2 # reserved for v3 wave dispatcher (Plan B), currently fixed at 2
```

Append after it (still inside the fenced block):
```yaml
# ────────────────────────────────────────────────────────────────────────────
# v3 mode/size overrides (no project-level config needed)
# ────────────────────────────────────────────────────────────────────────────
# The lead picks mode (solo / single-agent / team) and size (minimal / standard
# / full) from launch-message heuristics by default. Override per-feature with
# `/team-feature --mode=<mode> --size=<size>`. `--explain` prints the heuristic
# decision without spawning. See SESSION_README.md for the full ladder.
```

- [ ] **Step 2: Verify with grep**

```bash
grep -n -- '--mode=' plugins/team-superpower/assets/CLAUDE.md.template
grep -n -- '--explain' plugins/team-superpower/assets/CLAUDE.md.template
```
Each should match at least once.

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/assets/CLAUDE.md.template
git commit -m "docs(team-superpower): note v3 --mode/--size/--explain flags in CLAUDE.md template

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 — SESSION_README v3 sections

Spec §7.13. Document mode determination, wave schedule, iteration cap, model fallback.

**Files:**
- Modify: `plugins/team-superpower/assets/SESSION_README.md`

- [ ] **Step 1: Add four new subsections under `## Customising for your project`**

Append after the existing `### 7. Superpowers version pinning`:

```markdown
### 8. Complexity assessment (v3 — mode and size)

In phase 0.5 the lead runs a heuristic ladder against the launch message and picks one of three modes:

- **solo** — lead does the work itself; 2 owner touchpoints (plan-and-diff + finish). Triggers on trivial keywords (typo, rename, bump, comment-out) or single-file launches.
- **single-agent** — one implementer (BE or FE) spawned; 3 touchpoints. Triggers on small-scope verbs + single-side signal + no discovery language.
- **team** — full v2 flow at the chosen size. Default.

When mode is `team`, the lead also picks a size:

- **minimal** — designer + planner + 1 BE + 1 FE + reviewer (5 teammates).
- **standard** (default) — adds qa-engineer (6 teammates).
- **full** — adds software-architect + security-engineer (8 teammates). Forced by `security.domain: payments | healthcare` or regulated keywords.

The decision lands in the checkpoint's `mode`, `size`, `mode_reasoning`, `overrides_applied` fields. Override per feature with `/team-feature --mode=<mode> --size=<size>`. Preview with `/team-feature --explain <message>` (prints the decision and exits).

If the lead picks an unexpected mode, read `mode_reasoning` in the checkpoint — it names the ladder rung and the matching keyword. Bias future launches by phrasing the request explicitly, or use the override flags.

### 9. Wave schedule (v3 — phase 4)

In phase 4 the lead reads the plan's `## Waves` section. Each wave's tasks have an explicit `Depends on:` list. Independent tasks within a wave run concurrently, up to **2 backend-developer instances + 2 frontend-developer instances at peak**. Subsequent waves wait for the previous wave to fully complete.

Read the plan's `## Waves` section to see how the planner decomposed the work. Each task carries `Files:` (paths) and `Depends on:` (task IDs) — the lead uses `Files:` for collision detection (`wave-collision-check.sh`) and `Depends on:` for wave ordering.

If two tasks in the same wave collide on a shared file, the wave **hard-fails**. The lead pings the planner with `WAVE_COLLISION`; planner adds a dependency edge between them so they end up in different waves; lead retries. Cap is 3 retries (`wave_replans: K/3` in the checkpoint), then owner escalation. Hard-failing is intentional — graceful serialization would mask planner bugs.

Wave progress shows up in checkpoint as `wave: N/M, tasks_complete: X/Y`.

### 10. Iteration cap (v3 — MAX_ITERATIONS)

Every `impl:` task carries an `iteration_count:` integer. If an implementer retries the same failing test 8 times, it halts and posts a §7 escalation with `what_failed:`, `one_change_to_fix:`, and `class:`. The `task-completed` hook rejects completions where `iteration_count > 8` unless a `reflection:` block is attached.

Configure per project in CLAUDE.md `limits.max_iterations_per_task` (default 8). Lower for slow-feedback environments; never raise above 12 — past that, retry is masking a structural issue.

When you see an `ITERATION_CAP_EXCEEDED` escalation, the right move is usually to address the `one_change_to_fix:` field — it's the implementer's single best guess at the root cause.

### 11. Model fallback (v3 — preflight attestation)

Each agent role is pinned to a model (Opus for designer/architect/security/reviewer; Sonnet for planner/BE/FE/QA — see spec §11.3). At spawn, the lead captures each teammate's first heartbeat:

- `model_actual:` — the model the teammate is actually running on.
- `effort_set:` — the effort level it set on first turn.

If `model_actual` does not match the frontmatter `model:` pin (e.g. a usage-threshold fallback dropped Opus to Sonnet), the lead surfaces a single owner touchpoint asking whether to continue. This is a **recovery touchpoint** and does NOT count against the 3-touchpoint budget — it only fires on fallback.

If `effort_set` is missing or wrong, the lead logs a warning to the checkpoint but does not surface to the owner. Soft enforcement.
```

- [ ] **Step 2: Verify with grep**

```bash
grep -n 'Complexity assessment (v3' plugins/team-superpower/assets/SESSION_README.md
grep -n 'Wave schedule (v3' plugins/team-superpower/assets/SESSION_README.md
grep -n 'Iteration cap (v3' plugins/team-superpower/assets/SESSION_README.md
grep -n 'Model fallback (v3' plugins/team-superpower/assets/SESSION_README.md
```
All four should match.

- [ ] **Step 3: Commit**

```bash
git add plugins/team-superpower/assets/SESSION_README.md
git commit -m "docs(team-superpower): SESSION_README — v3 mode/waves/iteration cap/model fallback

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7 — Top-level README v3 section

Spec §7.12.

**Files:**
- Modify: `README.md` (repo root)

- [ ] **Step 1: Check the current README structure**

```bash
grep -nE "^## " README.md
```
Sections currently are: `## Plugins`, `## Install`, `## Layout`, `## Contributing`, `## License`.

- [ ] **Step 2: Append a new `## team-superpower v3` section AFTER `## Plugins` and BEFORE `## Install`**

Insert:

```markdown
## team-superpower v3

The `team-superpower` plugin shipped a v3 amendment in 2026-05. Three additions on top of v2:

1. **Autonomous complexity assessment (phase 0.5).** The lead picks mode (`solo` / `single-agent` / `team`) and size (`minimal` / `standard` / `full`) from launch-message heuristics. No extra owner touchpoint; the 3-touchpoint promise is preserved. Override per feature with `/team-feature --mode=<mode> --size=<size>`; preview with `--explain`.

2. **Dependency-grouped parallel waves (phase 4).** The planner emits a `## Waves` section. Independent tasks within a wave run concurrently across up to **2 BE + 2 FE implementers** at peak. Collisions on shared files hard-fail and force a planner re-plan; cap is 3 retries before owner escalation.

3. **Per-role model and effort configuration.** Each agent file pins `model:` (alias) and `effort:`:
   - **Opus** for orchestration / design / architecture / security / final review (lead + designer + software-architect + security-engineer + reviewer).
   - **Sonnet** for planning / implementation / QA (planner + backend-developer + frontend-developer + qa-engineer).

   For production teams, pin specific versions via env vars:

   ```bash
   export ANTHROPIC_DEFAULT_OPUS_MODEL="claude-opus-4-7"
   export ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-4-6"
   ```

   Agent files use aliases so version bumps are intentional.

A typical full-stack `team-standard` feature runs ~3 Opus sessions (lead, designer, reviewer) and ~5–7 Sonnet sessions (planner, BE×1–2, FE×1–2, QA). See `plugins/team-superpower/docs/superpowers/team-superpower-v3-spec.md` for the full spec and `plugins/team-superpower/assets/SESSION_README.md` for owner-facing operational notes.
```

- [ ] **Step 3: Verify**

```bash
grep -n 'team-superpower v3' README.md
grep -n 'ANTHROPIC_DEFAULT_OPUS_MODEL' README.md
```
Each should match.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): announce team-superpower v3 — mode/waves/per-role models

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8 — End-to-end smoke + plugin manifest sanity

Spec §8 step 12 (the bits doable without an actual `/team-feature` run, which we can't trigger from a planning subagent).

**Files:**
- None modified; verification only.

- [ ] **Step 1: Run every test suite**

```bash
for t in plugins/team-superpower/tests/*.test.sh; do
  echo "=== $(basename "$t") ==="
  bash "$t" 2>&1 | tail -2
done
```
Expected: every suite ends with `ALL PASS`.

- [ ] **Step 2: Validate JSON manifests**

```bash
python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
```

- [ ] **Step 3: Verify every agent has `model:` AND `effort:` frontmatter**

```bash
for f in plugins/team-superpower/agents/*.md; do
  m="$(awk '/^---$/{n++;next} n==1 && /^model:/{print $2}' "$f")"
  e="$(awk '/^---$/{n++;next} n==1 && /^effort:/{print $2}' "$f")"
  printf '%-32s model=%-10s effort=%s\n' "$(basename "$f")" "$m" "$e"
done
```
Expected: 8 rows; opus×4 and sonnet×4, effort high×6 / medium×2 (BE+FE).

- [ ] **Step 4: Verify checkpoint-doc fields are intact (Plan A + Plan B both visible)**

```bash
grep -n 'mode_reasoning\|wave_replans\|model_actual\|effort_set' plugins/team-superpower/commands/team-feature.md | head -10
```
Expected: all four fields mentioned at least once.

- [ ] **Step 5: Confirm fence count is even (no broken markdown)**

```bash
for f in plugins/team-superpower/commands/*.md plugins/team-superpower/agents/*.md plugins/team-superpower/assets/*.md README.md; do
  c="$(grep -cE '^```' "$f")"
  if [ $((c % 2)) -ne 0 ]; then echo "ODD: $f ($c)"; fi
done
```
Expected: no output (every fence balanced).

- [ ] **Step 6: No commit — verification only**

If everything passes, Plan C is shipped end-to-end.

---

## Self-review notes

- All agent files end up using **alias pins** (`opus` / `sonnet`) per §11.4. Env vars handle the version pinning. No mixed-style pins remain.
- The `/effort` directives use the same template body across all 4 Opus agents and 2 Sonnet-high agents; the 2 implementers (BE/FE) get a slightly different body because their `/effort` fires per-task.
- The lead-side attestation block is intentionally a recovery touchpoint, not counted against the 3-touchpoint budget (per §11.6 item 2).
- Docs touch order: CLAUDE.md.template first (smallest change), then SESSION_README, then top-level README. Each is independent — running them out of order is fine.
- Tests for prose changes use `grep -qE` regex against committed markdown — fast, deterministic.
- README change is the only edit OUTSIDE `plugins/team-superpower/`; permitted per repo CLAUDE.md when adding a plugin feature whose announcement belongs in the marketplace overview.
