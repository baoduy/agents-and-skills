# Worktree Cleanup on Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `/team-feature`'s auto-cleanup so it removes the planner's git worktree when (and only when) the feature was actually merged AND platform cleanup verified clean, and surface deterministic option menus when merge or worktree-remove fails.

**Architecture:** Pure documentation edit inside `plugins/team-superpower/`. Every change is text in markdown files the lead agent reads at runtime — no code, no scripts. The lead behaviour is encoded in `commands/team-feature.md` and `commands/team-feature-resume.md`; the reviewer signal is documented in `agents/reviewer.md`; user-facing material lives in `assets/SESSION_README.md`, `assets/ESCALATION.md`, and the plugin `README.md`. The "tests" in this plan are `grep` assertions that the new content lands in the right file.

**Tech Stack:** Markdown, git, bash for the grep-based test commands.

---

## File Structure

| File | Action | Responsibility after change |
|---|---|---|
| `plugins/team-superpower/agents/reviewer.md` | Modify | Documents the new `FINISH_BLOCKED <reason>` mailbox signal in Hat 2 (Phase 7), the `<reason>` enum, and the lead-driven retry-on-A behaviour. |
| `plugins/team-superpower/commands/team-feature.md` | Modify | Adds phase-7 `FINISH_BLOCKED` handling with the 5-option menu; inserts Step D.5 (worktree removal) with the 4-option menu in auto-cleanup; updates the checkpoint format example and the Hard rules section. |
| `plugins/team-superpower/commands/team-feature-resume.md` | Modify | Adds two resume cases: `finish (blocked: ...)` (respawn reviewer, re-present 5-option menu, honour `merge_retries` cap) and partial Step D.5 (re-enter 4-option menu). |
| `plugins/team-superpower/assets/SESSION_README.md` | Modify | Adds troubleshooting rows for `FINISH_BLOCKED conflict` and `worktree remove failed`. Documents the new Closing-block fields. |
| `plugins/team-superpower/assets/ESCALATION.md` | Modify | Adds a 3rd worked example: a `FINISH_BLOCKED` escalation (option E). No change to the phase enum. |
| `plugins/team-superpower/README.md` | Modify | Updates the "Automatic cleanup after the feature ships" section to mention worktree removal on `merged`, the two failure menus, and the retry cap. |

No new files. No edits outside `plugins/team-superpower/` except the spec/plan/review docs in `docs/superpowers/`.

---

## Task 1: Reviewer agent — document FINISH_BLOCKED signal

**Files:**
- Modify: `plugins/team-superpower/agents/reviewer.md`

- [ ] **Step 1: Write the failing test**

Verify the file does not yet mention the new signal:

```bash
grep -F "FINISH_BLOCKED" plugins/team-superpower/agents/reviewer.md && echo FAIL || echo PASS
```

Expected: `PASS` (grep returns non-zero; new content is absent).

- [ ] **Step 2: Edit reviewer.md — add FINISH_BLOCKED + reason enum + retry behaviour**

In `plugins/team-superpower/agents/reviewer.md`, find the `## Hat 2 — Finish branch (phase 7)` section (currently 4 lines starting with "Run the unmodified Superpowers `finishing-a-development-branch` skill..."). Append a new sub-section at the end of Hat 2, before `## Escalation`, with this exact content:

```markdown
### Merge-failure signal: `FINISH_BLOCKED <reason>`

If the owner picks the `merged` decision and `finishing-a-development-branch`'s merge step fails, do NOT post `FINISH_DONE`. Instead post `FINISH_BLOCKED <reason>` to the lead's mailbox with the verbatim git stderr appended.

`<reason>` MUST be one of:

- `conflict` — `git merge` produced conflict markers
- `non-ff` — non-fast-forward, remote diverged
- `dirty-worktree` — uncommitted changes blocked the merge
- `push-rejected` — local merge succeeded but `git push` was rejected
- `other:<short-string>` — any other failure; include the git stderr verbatim in the mailbox message body

The lead will translate the owner's choice from a 5-option menu and may instruct you to do one of:

- **Retry merge** — re-run only the merge step against the now-stable state. The lead enforces a cap of 3 such retries.
- **Switch to `pr_opened`** — re-run `finishing-a-development-branch` with `decision=pr_opened`. Post `FINISH_DONE pr_opened <ref>` on success.
- **Switch to `kept`** — post `FINISH_DONE kept <branch>` directly (no further merge attempt).
- **Switch to `discarded`** — run the discard path of `finishing-a-development-branch`. Post `FINISH_DONE discarded <ref>` on success.

You do NOT decide which option applies; you wait for the lead's instruction and execute exactly one merge attempt or decision-switch per instruction.
```

- [ ] **Step 3: Run test to verify it passes**

```bash
grep -F "FINISH_BLOCKED" plugins/team-superpower/agents/reviewer.md && \
grep -F "Switch to \`pr_opened\`" plugins/team-superpower/agents/reviewer.md && \
grep -F "cap of 3 such retries" plugins/team-superpower/agents/reviewer.md && \
echo PASS || echo FAIL
```

Expected: `PASS`.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/agents/reviewer.md
git commit -m "docs(team-superpower): document FINISH_BLOCKED signal in reviewer

Hat 2 (phase 7) now defines FINISH_BLOCKED <reason> for merge failures
(conflict / non-ff / dirty-worktree / push-rejected / other:<...>) and
the four lead-driven follow-up actions: retry, switch to pr_opened,
switch to kept, switch to discarded. The retry cap (3) is named so the
reviewer doesn't have to track it.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: team-feature.md — phase-7 FINISH_BLOCKED handling + 5-option menu

**Files:**
- Modify: `plugins/team-superpower/commands/team-feature.md` (target: the phase 7 bullet on line 72, plus a new sub-section right after the phase chain)

- [ ] **Step 1: Write the failing test**

```bash
grep -F "FINISH_BLOCKED" plugins/team-superpower/commands/team-feature.md && echo FAIL || echo PASS
```

Expected: `PASS`.

- [ ] **Step 2: Edit team-feature.md — extend phase 7 + add merge-failure section**

In `plugins/team-superpower/commands/team-feature.md`, replace the existing phase-7 bullet (the line that currently reads "**Finish (reviewer).** Same reviewer runs `finishing-a-development-branch`. The owner makes the merge / PR / keep / discard decision (third and last owner touchpoint). On `FINISH_DONE <decision> <ref>`, checkpoint: `phase: finish, status: <merged|pr_opened|kept|discarded>`. Touch heartbeat.") with this exact text:

```markdown
7. **Finish (reviewer).** Same reviewer runs `finishing-a-development-branch`. The owner makes the merge / PR / keep / discard decision (third and last owner touchpoint). On `FINISH_DONE <decision> <ref>`, checkpoint: `phase: finish, status: <merged|pr_opened|kept|discarded>`. Touch heartbeat. If the reviewer posts `FINISH_BLOCKED <reason>` instead, follow **Phase 7 merge-failure handling** below.
```

Then insert a new section between the phase chain (after the phase-7 bullet) and the existing `## Automatic cleanup (runs after FINISH_DONE)` heading. The new section text is:

```markdown
## Phase 7 merge-failure handling

When the reviewer posts `FINISH_BLOCKED <reason>` (instead of `FINISH_DONE`), the merge step of `finishing-a-development-branch` failed for the `merged` decision. Handle it inline — this is the same owner touchpoint as the finish-branch decision continued, NOT a new touchpoint.

1. Read the mailbox message. Stash `<reason>` and the verbatim git stderr.
2. Update the checkpoint: `phase: finish, status: merge_blocked, reason: <reason>, merge_retries: K/3` where `K` is the count of prior retry attempts in this run (start at 0).
3. Touch the heartbeat.
4. Present the 5-option menu below to the owner.
5. Translate the owner's choice into the next instruction to the reviewer per the table.

### 5-option merge-failure menu

Present verbatim:

> **Merge failed:** `<reason>`. Pick one:
> - **A. Retry merge** — re-attempt the merge now (you've resolved conflicts externally or upstream has stabilised).
> - **B. Switch to pr_opened** — open a PR for human merge instead.
> - **C. Switch to kept** — keep the worktree as-is, you'll handle the merge later.
> - **D. Switch to discarded** — drop the branch entirely.
> - **E. Escalate** — pause and surface a §7 escalation with full git output.

Translation:

| Choice | Reviewer instruction | Expected next signal |
|---|---|---|
| **A** | "Retry the merge step only. Do not re-do design/plan/etc." Increment `merge_retries`. | `FINISH_DONE merged <ref>` OR a new `FINISH_BLOCKED <reason>` |
| **B** | "Re-run `finishing-a-development-branch` with `decision=pr_opened`." | `FINISH_DONE pr_opened <ref>` |
| **C** | "Post `FINISH_DONE kept <branch>` directly. Do not attempt another merge." | `FINISH_DONE kept <ref>` |
| **D** | "Run the discard path of `finishing-a-development-branch`." | `FINISH_DONE discarded <ref>` |
| **E** | Lead posts §7 template to owner with verbatim git stderr; halts until owner responds. | Owner directs manually |

### Retry cap

`merge_retries` is bounded at 3. Before presenting the menu, check the current value:

- `merge_retries < 3` → present all five options.
- `merge_retries == 3` → drop option A. The menu shows B/C/D/E only.

The counter is persisted in the checkpoint so `/team-feature-resume` honours it across sessions.

### Flow rejoin

On any `FINISH_DONE <decision>` (any decision), flow rejoins normal phase 7: checkpoint `phase: finish, status: <decision>`, then run **Automatic cleanup** below. Auto-cleanup Step D.5 (worktree removal) runs only when `decision == merged`.
```

- [ ] **Step 3: Run test to verify it passes**

```bash
grep -F "Phase 7 merge-failure handling" plugins/team-superpower/commands/team-feature.md && \
grep -F "5-option merge-failure menu" plugins/team-superpower/commands/team-feature.md && \
grep -F "merge_retries" plugins/team-superpower/commands/team-feature.md && \
grep -F "FINISH_BLOCKED" plugins/team-superpower/commands/team-feature.md && \
echo PASS || echo FAIL
```

Expected: `PASS`.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/commands/team-feature.md
git commit -m "feat(team-superpower): phase-7 merge-failure menu in team-feature

When the reviewer posts FINISH_BLOCKED <reason> instead of FINISH_DONE,
the lead now surfaces a deterministic 5-option menu (retry / switch to
pr_opened / switch to kept / switch to discarded / escalate) with a
3-retry cap. The cap is persisted in the checkpoint so it survives
/team-feature-resume. This handling counts as the existing finish-
branch touchpoint continued — it does not exceed the 3-touchpoint cap.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: team-feature.md — insert auto-cleanup Step D.5 + 4-option remove-failure menu

**Files:**
- Modify: `plugins/team-superpower/commands/team-feature.md` (target: insert a new sub-section between Step D and Step E in the `## Automatic cleanup` block)

- [ ] **Step 1: Write the failing test**

```bash
grep -F "Step D.5" plugins/team-superpower/commands/team-feature.md && echo FAIL || echo PASS
```

Expected: `PASS`.

- [ ] **Step 2: Edit team-feature.md — insert Step D.5**

In `plugins/team-superpower/commands/team-feature.md`, locate the `### Step E — Final checkpoint commit` heading. Immediately BEFORE it, insert this new sub-section verbatim:

```markdown
### Step D.5 — Worktree removal (on successful merge only)

Runs only after Step C / D have brought platform state to absent. Removes the planner's git worktree when, and only when, the feature was actually merged.

**Trigger conditions** (ALL must be true; any miss → skip and record the reason in the Closing block):

1. `FINISH_DONE merged <ref>` is recorded in the checkpoint.
2. Step A precondition check passed.
3. Step B teammate shutdown was clean.
4. The post-Step-C (or post-Step-D) scan shows `team_config_state: absent`, `task_list_state: absent`, `tmux_state: absent`.
5. The checkpoint has a non-empty `**Worktree:**` field.

If any condition fails, record `worktree: removal-skipped:<reason>` in the Closing block (Step E) where `<reason>` is one of:

- `not-merged-decision` — finish decision was `pr_opened`, `kept`, or `discarded`.
- `team-cleanup-incomplete` — Step C/D left platform state present.
- `no-worktree-recorded` — checkpoint has no `**Worktree:**` line.

**Procedure** (only when all trigger conditions pass):

1. Read the worktree path from the checkpoint's `**Worktree:**` line. Call it `WT_PATH`.
2. `cd` to the repo root (the **main** worktree, NOT `WT_PATH`). `git worktree remove` refuses when the current directory is inside the target.
3. Run `git worktree list --porcelain`. If `WT_PATH` is not listed (already pruned, manual removal, etc.), record `worktree: already-absent` in the Closing block and skip to Step E.
4. Touch the heartbeat.
5. Run `git worktree remove "$WT_PATH"` (non-forced).
6. On success → record `worktree: removed` in the Closing block. Touch heartbeat. Proceed to Step E.
7. On non-zero exit → enter the **4-option remove-failure menu** below.

**Branch handling:** `git worktree remove` does NOT delete the branch. The feature branch survives this step. Branch deletion is left to the owner.

### 4-option remove-failure menu

Triggered when `git worktree remove "$WT_PATH"` exits non-zero. Common causes: untracked files, locked worktree, in-progress git operation, owner pre-seeded files.

Present verbatim:

> **Could not remove worktree** `<WT_PATH>`. Git said: `<stderr>`. Pick one:
> - **A. Show files + retry** — list what's blocking, then retry the remove.
> - **B. Force remove** — discard uncommitted work in `<WT_PATH>` and remove. (Confirmation required.)
> - **C. Keep worktree** — leave it on disk; you'll remove it manually later.
> - **D. Escalate** — pause and surface a §7 escalation with the verbatim stderr.

Translation:

| Choice | Action | Closing-block record |
|---|---|---|
| **A** | Run `git -C "$WT_PATH" status --short` and `git -C "$WT_PATH" diff --stat`. Surface output to owner. Retry `git worktree remove "$WT_PATH"`. Cap: 3 retries per Step D.5. On success: record `worktree: removed (after manual fix)` and proceed to Step E. On 3rd retry still failing: drop option A from the next menu and force B/C/D. | See action column. |
| **B** | Lead prompts: `"This will discard uncommitted work in <WT_PATH>. Confirm force-remove? (type 'yes' to confirm)"`. On `yes`: snapshot the file list from the pre-remove `git -C "$WT_PATH" status --short` (or take a snapshot now if option A hasn't run), then run `git worktree remove --force "$WT_PATH"`. On any other input: abort B, re-present the menu. | `worktree: force-removed`, `dropped_files: [<path>, ...]` |
| **C** | Log `WT_PATH` in the Closing block. Tell the owner: `"Worktree retained at <WT_PATH>. Remove manually with 'git worktree remove <WT_PATH>' once you've handled it."` Proceed to Step E. | `worktree: kept-by-owner`, `worktree_path: <WT_PATH>` |
| **D** | Halt Step D.5. Post the §7 template to the owner with the verbatim stderr from the failed remove. Wait for direction. | `worktree: escalated`, `worktree_path: <WT_PATH>` |

In all four cases, Step E still runs after Step D.5 closes (whether by success or by the owner's menu choice). Step E records the outcome in the Closing block.
```

- [ ] **Step 3: Update Step E to include the new Closing-block fields**

In the same file, locate the `### Step E — Final checkpoint commit` section. Replace its existing example block (currently 5 markdown lines: `## Closing` then 3 bullet lines then a closing fence) with this expanded version:

Find:

```markdown
```markdown
## Closing
- finished at: <ISO datetime>
- decision: <merged|pr_opened|kept|discarded>
- cleanup: complete
```
```

Replace with:

```markdown
```markdown
## Closing
- finished at: <ISO datetime>
- decision: <merged|pr_opened|kept|discarded>
- cleanup: complete
- worktree: <removed | already-absent | removal-skipped:<reason> | removed (after manual fix) | force-removed | kept-by-owner | escalated>
- worktree_path: <path>            # present whenever the worktree directory still exists on disk after cleanup (states: kept-by-owner, escalated, or removal-skipped where the path exists)
- merge_retries: K                 # only when K > 0; matches the final value of the mid-phase counter
- dropped_files: [<path>, ...]     # only when state == force-removed
```

`removal-skipped` reasons: `not-merged-decision` | `team-cleanup-incomplete` | `no-worktree-recorded`.
```

- [ ] **Step 4: Run test to verify both edits land**

```bash
grep -F "Step D.5 — Worktree removal" plugins/team-superpower/commands/team-feature.md && \
grep -F "4-option remove-failure menu" plugins/team-superpower/commands/team-feature.md && \
grep -F "worktree: <removed |" plugins/team-superpower/commands/team-feature.md && \
grep -F "removal-skipped" plugins/team-superpower/commands/team-feature.md && \
echo PASS || echo FAIL
```

Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add plugins/team-superpower/commands/team-feature.md
git commit -m "feat(team-superpower): auto-cleanup Step D.5 removes worktree on merge

New Step D.5 between platform-cleanup (Step C/D) and the final
checkpoint commit (Step E) removes the planner's git worktree when
(and only when) the finish decision was 'merged' AND platform state
verified clean. Failure surfaces a deterministic 4-option menu (show
files + retry / force remove with confirmation / keep / escalate) with
a 3-retry cap on option A. Step E's Closing block grows new fields:
worktree, worktree_path, merge_retries, dropped_files.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: team-feature.md — checkpoint format + Hard rules updates

**Files:**
- Modify: `plugins/team-superpower/commands/team-feature.md`

- [ ] **Step 1: Write the failing test**

```bash
grep -F "blocked: <reason>" plugins/team-superpower/commands/team-feature.md && echo FAIL || echo PASS
```

Expected: `PASS`.

- [ ] **Step 2: Update the Checkpointing example to show the merge_blocked state**

In `plugins/team-superpower/commands/team-feature.md`, locate the `## Checkpointing` section's example block. Find the `- [ ] finish` line and replace with:

```markdown
- [ ] finish — when `FINISH_BLOCKED <reason>` is in flight, this line reads `- [ ] finish (blocked: <reason>, merge_retries: K/3)` instead, and stays unchecked until `FINISH_DONE` arrives.
```

- [ ] **Step 3: Append new Hard rules**

In the same file, locate the `## Hard rules` section. After the last existing bullet (the one starting with `**Never** force cleanup while the heartbeat is fresh`), append these new bullets verbatim:

```markdown
- **Never** run Step D.5 worktree removal unless the finish decision is `merged` AND the platform-cleanup scan (Step C, or Step D fallback) shows every state `absent`. Other decisions or partial cleanups must record `worktree: removal-skipped:<reason>` and leave the worktree on disk.
- **Never** force-remove a worktree (`--force`) without explicit owner confirmation in the 4-option menu. The default remove is non-forced; force only on option B with a typed `yes`.
- **Never** retry merge more than 3 times. After the 3rd `FINISH_BLOCKED`, drop option A from the 5-option menu and require B/C/D/E.
- **Never** treat the `FINISH_BLOCKED` menu as a new owner touchpoint. It is the same finish-branch touchpoint continued — the 3-touchpoint cap stays at 3.
```

- [ ] **Step 4: Run test to verify both edits**

```bash
grep -F "blocked: <reason>" plugins/team-superpower/commands/team-feature.md && \
grep -F "Never** run Step D.5 worktree removal" plugins/team-superpower/commands/team-feature.md && \
grep -F "Never** force-remove a worktree" plugins/team-superpower/commands/team-feature.md && \
grep -F "Never** retry merge more than 3 times" plugins/team-superpower/commands/team-feature.md && \
echo PASS || echo FAIL
```

Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add plugins/team-superpower/commands/team-feature.md
git commit -m "docs(team-superpower): checkpoint format + Hard rules for D.5/merge cap

The Checkpointing example now shows the alternate
'finish (blocked: <reason>, merge_retries: K/3)' state. Four new Hard
rules name the safety invariants: D.5 only runs on merged + clean
platform cleanup, --force requires typed confirmation, merge retries
cap at 3, and FINISH_BLOCKED handling is the same touchpoint not a new
one.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: team-feature-resume.md — resume cases for merge_blocked and mid-D.5

**Files:**
- Modify: `plugins/team-superpower/commands/team-feature-resume.md`

- [ ] **Step 1: Write the failing test**

```bash
grep -F "finish (blocked:" plugins/team-superpower/commands/team-feature-resume.md && echo FAIL || echo PASS
```

Expected: `PASS`.

- [ ] **Step 2: Add a resume case after Step 4 ("Identify resume point")**

Open `plugins/team-superpower/commands/team-feature-resume.md`. Locate the `### Step 4 — Identify resume point` section. After its existing `Read all the artefacts the next phase depends on:` bullet list (the one ending with `- If next phase is \`finish\`: code-review report (\`REVIEW_PASSED\`).`), append this sub-section verbatim:

```markdown
### Step 4.a — Mid-phase 7 resume (merge_blocked)

If the checkpoint's `## Phases` block shows `- [ ] finish (blocked: <reason>, merge_retries: K/3)`, the previous lead crashed inside phase-7 merge-failure handling. Resume protocol:

1. Read `<reason>` and `K` from the checkpoint line.
2. Re-spawn the reviewer (Hat 2 only; reviewer is reused).
3. Re-present the 5-option menu from `/team-feature` § Phase 7 merge-failure handling, with option A dropped if `K == 3`.
4. The owner's choice is translated and reviewer continues per the same translation table.
5. On the next `FINISH_DONE`, normal auto-cleanup runs (including Step D.5 if decision is `merged`).

Do NOT re-run earlier phases. Their checkpoints stand.

### Step 4.b — Mid-Step-D.5 resume (worktree removal in flight)

If the checkpoint's `## Closing` block exists but is incomplete (has `decision:` and `cleanup: complete` but is missing the `worktree:` line) AND the recorded decision is `merged`, the previous lead crashed inside Step D.5. Resume protocol:

1. Verify Step A–D conditions still hold by running `bash ${CLAUDE_PLUGIN_ROOT}/scripts/team-state.sh scan <slug>` — all states must be `absent`. If anything is `present`, halt and instruct the owner to run `/team-cleanup <slug>` before resuming.
2. Re-run Step D.5 from the top: read `**Worktree:**`, `cd` to repo root, check `git worktree list --porcelain`, attempt non-forced remove. The procedure is idempotent — if the worktree was already removed in the prior session it'll be recorded as `already-absent`.
3. On remove failure, re-enter the 4-option remove-failure menu fresh (no carry-over retry count — the prior session's count was not persisted because Step D.5 retries are per-session, not per-run; this is intentional, the owner sees a fresh menu).
4. On completion, write the missing Closing-block fields (`worktree`, `worktree_path` if applicable, `dropped_files` if applicable) and commit.
```

- [ ] **Step 3: Add an entry to Step 6 (Respawn only the teammates needed)**

In the same file, locate the `### Step 6 — Respawn only the teammates needed` section, specifically the phase-to-role spawn table. Append one row to that table:

```markdown
| `finish (blocked: ...)` | `reviewer` (Hat 2) — same reviewer instance; re-present the 5-option menu, honour the persisted `merge_retries` count |
```

- [ ] **Step 4: Update Step 9 touchpoint count language to mention the menu continuation**

In the same file, locate `### Step 9 — Resume the phase chain`. Find the line `- three allowed owner touchpoints (design sign-off, plan approval, finish-branch decision), nothing else without §7 template` and replace with:

```markdown
- three allowed owner touchpoints (design sign-off, plan approval, finish-branch decision — `FINISH_BLOCKED` follow-up menus count as the same finish-branch touchpoint continued), nothing else without §7 template
```

- [ ] **Step 5: Run test to verify all three edits**

```bash
grep -F "Step 4.a — Mid-phase 7 resume" plugins/team-superpower/commands/team-feature-resume.md && \
grep -F "Step 4.b — Mid-Step-D.5 resume" plugins/team-superpower/commands/team-feature-resume.md && \
grep -F "finish (blocked: ...)" plugins/team-superpower/commands/team-feature-resume.md && \
grep -F "FINISH_BLOCKED\` follow-up menus count as the same" plugins/team-superpower/commands/team-feature-resume.md && \
echo PASS || echo FAIL
```

Expected: `PASS`.

- [ ] **Step 6: Commit**

```bash
git add plugins/team-superpower/commands/team-feature-resume.md
git commit -m "feat(team-superpower): resume mid-phase-7 merge-blocked + mid-D.5

Two new resume cases in /team-feature-resume:

- Step 4.a handles 'finish (blocked: ...)' — re-spawns the reviewer
  and re-presents the 5-option merge-failure menu with the persisted
  merge_retries cap honoured.
- Step 4.b handles partial Step D.5 — the worktree-remove procedure is
  idempotent, so the resume just re-enters Step D.5 from the top and
  re-presents the 4-option menu on failure.

The respawn table grows a row for finish(blocked) and Step 9 clarifies
that FINISH_BLOCKED menus count as the same finish-branch touchpoint.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: SESSION_README.md — troubleshooting rows + Closing-block doc

**Files:**
- Modify: `plugins/team-superpower/assets/SESSION_README.md`

- [ ] **Step 1: Write the failing test**

```bash
grep -F "FINISH_BLOCKED" plugins/team-superpower/assets/SESSION_README.md && echo FAIL || echo PASS
```

Expected: `PASS`.

- [ ] **Step 2: Add troubleshooting rows**

Open `plugins/team-superpower/assets/SESSION_README.md`. Locate the `## Troubleshooting` table (the one with column headers `| Symptom | What it usually means | First thing to check |`). Append two new rows just before the existing `| Auto-cleanup skipped after FINISH_DONE` row:

```markdown
| `FINISH_BLOCKED <reason>` from the reviewer | The merge step of `finishing-a-development-branch` failed (`conflict` / `non-ff` / `dirty-worktree` / `push-rejected`) | The lead surfaces a 5-option menu (retry / pr_opened / kept / discarded / escalate). Pick one; merge retries cap at 3. |
| `git worktree remove` failed during cleanup | Step D.5 hit an uncommitted/untracked file or a locked worktree | Pick from the 4-option menu (show files + retry / force-remove with confirmation / keep / escalate). Force-remove discards uncommitted work — only confirm if you've checked the file list. |
```

- [ ] **Step 3: Document the new Closing-block fields**

In the same file, locate the `## Cleanup model` section. After the existing paragraph that ends with `A \`## Closing\` block is appended to the checkpoint.`, append this paragraph verbatim:

```markdown
### Closing-block fields

The auto-cleanup writes a `## Closing` block with these fields:

- `finished at: <ISO datetime>` — when cleanup finished.
- `decision: <merged|pr_opened|kept|discarded>` — the finish-branch decision.
- `cleanup: complete` — confirms all cleanup steps ran (or were intentionally skipped).
- `worktree: <state>` — outcome of Step D.5. One of: `removed`, `already-absent`, `removal-skipped:<reason>`, `removed (after manual fix)`, `force-removed`, `kept-by-owner`, `escalated`.
- `worktree_path: <path>` — present only when the worktree directory still exists on disk (states `kept-by-owner`, `escalated`, or `removal-skipped` where the path exists).
- `merge_retries: K` — present only when K > 0; how many retries the 5-option menu ran before reaching `FINISH_DONE`.
- `dropped_files: [<path>, ...]` — present only when `worktree: force-removed`; the file list snapshot from before the forced removal.

`removal-skipped` reasons: `not-merged-decision` (decision was pr_opened/kept/discarded) | `team-cleanup-incomplete` (Step C/D left platform state present) | `no-worktree-recorded` (checkpoint had no `**Worktree:**` line).
```

- [ ] **Step 4: Run test to verify both edits**

```bash
grep -F "FINISH_BLOCKED" plugins/team-superpower/assets/SESSION_README.md && \
grep -F "Closing-block fields" plugins/team-superpower/assets/SESSION_README.md && \
grep -F "dropped_files" plugins/team-superpower/assets/SESSION_README.md && \
echo PASS || echo FAIL
```

Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add plugins/team-superpower/assets/SESSION_README.md
git commit -m "docs(team-superpower): troubleshooting + Closing-block reference

SESSION_README.md gets two new troubleshooting rows (FINISH_BLOCKED
and worktree-remove failure) plus a full reference section documenting
every Closing-block field the auto-cleanup writes (worktree,
worktree_path, merge_retries, dropped_files) and the
removal-skipped reason enum.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: ESCALATION.md — 3rd worked example (FINISH_BLOCKED option E)

**Files:**
- Modify: `plugins/team-superpower/assets/ESCALATION.md`

- [ ] **Step 1: Write the failing test**

```bash
grep -F "Worked example 3" plugins/team-superpower/assets/ESCALATION.md && echo FAIL || echo PASS
```

Expected: `PASS`.

- [ ] **Step 2: Append the 3rd worked example**

Open `plugins/team-superpower/assets/ESCALATION.md`. Append this section at the end of the file (after the last code fence of Worked example 2):

```markdown

## Worked example 3 — lead-to-owner (`FINISH_BLOCKED` option E)

```
BLOCKED: Merge of feature/user-search into main failed: push rejected because origin/main advanced. Owner picked option E (escalate) from the 5-option menu rather than retrying inline.
Phase: finish
Context: Reviewer attempted `git push` after a clean local merge. Push was rejected: "Updates were rejected because the remote contains work that you do not have locally." The remote moved between phase 6 and phase 7. The lead's 5-option menu was presented; owner chose E because they want to coordinate the rebase manually rather than have the team retry blind.
Options:
  A. Owner rebases the feature branch locally onto origin/main, signals "ready to retry"; lead instructs reviewer to retry merge (counts as 1/3 retries).
  B. Owner pulls latest origin/main into trunk first, then signals; lead retries.
  C. Owner switches the decision to pr_opened and merges via GitHub UI.
Recommendation: A — the conflict surface is small and a clean rebase plus retry is the cheapest path. We won't move until you say which.
Need from you: choose A/B/C.
```
```

- [ ] **Step 3: Run test to verify the edit**

```bash
grep -F "Worked example 3" plugins/team-superpower/assets/ESCALATION.md && \
grep -F "push rejected because origin/main advanced" plugins/team-superpower/assets/ESCALATION.md && \
echo PASS || echo FAIL
```

Expected: `PASS`.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/assets/ESCALATION.md
git commit -m "docs(team-superpower): worked example 3 for FINISH_BLOCKED escalation

Adds a third escalation worked example showing the lead-to-owner
template when the owner picks option E (escalate) from the 5-option
merge-failure menu. The scenario is a push-rejected race against
origin/main; the example demonstrates how the lead frames the three
follow-up options (rebase + retry / sync trunk + retry / switch to
pr_opened) using the canonical §7 template.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Plugin README — update "Automatic cleanup after the feature ships" section

**Files:**
- Modify: `plugins/team-superpower/README.md`

- [ ] **Step 1: Write the failing test**

```bash
grep -F "worktree removal" plugins/team-superpower/README.md && echo FAIL || echo PASS
```

Expected: `PASS`.

- [ ] **Step 2: Update the auto-cleanup section**

Open `plugins/team-superpower/README.md`. Locate the `## Automatic cleanup after the feature ships` heading. The section currently ends with a sentence about `rm -rf` not running on half-finished features. After that sentence, append this paragraph verbatim:

```markdown

### Worktree removal on merge

When (and only when) the finish decision is `merged` AND the platform-cleanup scan shows everything `absent`, the lead now runs a Step D.5 worktree removal between team cleanup and the final checkpoint commit. `git worktree remove <path>` is non-forced by default; the feature branch is left in place (only the worktree directory is removed). If `git worktree remove` fails (untracked files, locked worktree, in-progress git operation), the lead presents a 4-option menu:

| | Option | Behaviour |
|---|---|---|
| A | Show files + retry | Lists blocking files via `git status --short` + `git diff --stat`, then retries (cap 3). |
| B | Force remove | Discards uncommitted work in the worktree (requires typed `yes` confirmation). |
| C | Keep worktree | Leaves the directory on disk; owner removes manually. |
| D | Escalate | §7 escalation with verbatim stderr. |

Other finish decisions (`pr_opened`, `kept`, `discarded`) skip Step D.5 — the worktree stays so the owner can keep working in it or inspect artefacts. The Closing block records the outcome with a `worktree:` field.

### Merge-failure menu

If the reviewer's merge step in phase 7 fails (`conflict` / `non-ff` / `dirty-worktree` / `push-rejected`), it posts `FINISH_BLOCKED <reason>` instead of `FINISH_DONE`. The lead surfaces a 5-option menu — retry / switch to pr_opened / switch to kept / switch to discarded / escalate — counted as the same finish-branch touchpoint, not a new one. Retries cap at 3; after the 3rd `FINISH_BLOCKED`, option A drops. The cap persists across `/team-feature-resume` via the checkpoint.
```

- [ ] **Step 3: Run test to verify the edit**

```bash
grep -F "Worktree removal on merge" plugins/team-superpower/README.md && \
grep -F "Merge-failure menu" plugins/team-superpower/README.md && \
grep -F "FINISH_BLOCKED" plugins/team-superpower/README.md && \
echo PASS || echo FAIL
```

Expected: `PASS`.

- [ ] **Step 4: Commit**

```bash
git add plugins/team-superpower/README.md
git commit -m "docs(team-superpower): README covers worktree removal + merge-failure menu

Two new subsections under 'Automatic cleanup after the feature ships':

- 'Worktree removal on merge' explains the Step D.5 trigger conditions
  and the 4-option remove-failure menu.
- 'Merge-failure menu' explains FINISH_BLOCKED, the 5-option menu, and
  the 3-retry cap.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Cross-file consistency verification

**Files:**
- No edits. Read-only verification of all files touched in Tasks 1–8.

- [ ] **Step 1: Verify every file mentions the new signals consistently**

Run all checks in one block:

```bash
set -e

# FINISH_BLOCKED must appear in reviewer.md (defines signal), team-feature.md (handles signal), team-feature-resume.md (resume case), SESSION_README.md (troubleshooting), README.md (overview).
for f in \
  plugins/team-superpower/agents/reviewer.md \
  plugins/team-superpower/commands/team-feature.md \
  plugins/team-superpower/commands/team-feature-resume.md \
  plugins/team-superpower/assets/SESSION_README.md \
  plugins/team-superpower/README.md; do
  grep -q "FINISH_BLOCKED" "$f" || { echo "MISSING FINISH_BLOCKED in $f"; exit 1; }
done

# merge_retries must appear in team-feature.md (defines/uses cap), team-feature-resume.md (honours cap), SESSION_README.md (documents field).
for f in \
  plugins/team-superpower/commands/team-feature.md \
  plugins/team-superpower/commands/team-feature-resume.md \
  plugins/team-superpower/assets/SESSION_README.md; do
  grep -q "merge_retries" "$f" || { echo "MISSING merge_retries in $f"; exit 1; }
done

# Step D.5 must appear in team-feature.md (defines step), team-feature-resume.md (resume case), README.md (overview).
for f in \
  plugins/team-superpower/commands/team-feature.md \
  plugins/team-superpower/commands/team-feature-resume.md \
  plugins/team-superpower/README.md; do
  grep -q "Step D.5\|Step-D.5\|worktree removal\|Worktree removal\|D.5 — Mid-Step-D.5" "$f" || { echo "MISSING Step D.5 reference in $f"; exit 1; }
done

# The reason enum must be identical across files that list it.
expected_reasons="conflict.*non-ff.*dirty-worktree.*push-rejected"
for f in \
  plugins/team-superpower/agents/reviewer.md \
  plugins/team-superpower/commands/team-feature.md \
  plugins/team-superpower/assets/SESSION_README.md; do
  grep -qE "$expected_reasons" "$f" || { echo "REASON ENUM mismatch in $f"; exit 1; }
done

# Closing-block field set must be present in team-feature.md (canonical) and SESSION_README.md (reference).
for field in "worktree:" "worktree_path:" "merge_retries:" "dropped_files:"; do
  for f in \
    plugins/team-superpower/commands/team-feature.md \
    plugins/team-superpower/assets/SESSION_README.md; do
    grep -qF "$field" "$f" || { echo "MISSING field '$field' in $f"; exit 1; }
  done
done

echo PASS
```

Expected: `PASS`.

- [ ] **Step 2: Verify JSON manifests still parse** (defensive — no manifest changes were intended, but Step C of every prior task was a markdown edit, so a paste error could in principle hit a manifest)

```bash
python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
```

Expected: `OK`.

- [ ] **Step 3: Spot-check the spec acceptance criteria**

Read `docs/superpowers/specs/2026-05-13-worktree-cleanup-on-merge-design.md` § Acceptance criteria. For each of the 6 criteria, name the task that satisfies it:

| Criterion | Satisfied by |
|---|---|
| 1. team-feature.md documents both menus with exact option text and translation tables. | Task 2 (5-option menu) + Task 3 (4-option menu) |
| 2. team-feature-resume.md handles two new resume states. | Task 5 (Step 4.a + 4.b) |
| 3. reviewer.md documents FINISH_BLOCKED <reason> + reason enum. | Task 1 |
| 4. Integration: after FINISH_DONE merged, worktree gone, branch present, Closing populated. | Task 3 (procedure) + Task 4 (Closing format) + Task 9 (cross-file check) |
| 5. Integration: 5-option menu surfaced on conflicting merge; every option reaches a FINISH_DONE. | Task 2 (menu definition) + Task 5 (resume case) |
| 6. Integration: 4-option menu surfaced on remove failure; B succeeds with confirmation, Closing records force-removed + dropped_files. | Task 3 (menu definition) + Task 4 (dropped_files field) |

If any row reads "no task" — go back and add one.

- [ ] **Step 4: Confirm commit history**

```bash
git log --oneline -10
```

Expected: 8 new commits on top of the current `dev` HEAD, one per Task 1–8. Task 9 has no commit (read-only verification).

- [ ] **Step 5: Final summary** (no commit)

Print a 3-line summary to confirm the implementation is done:

```bash
echo "Tasks 1-8: documented worktree-cleanup-on-merge across 6 files."
echo "Task 9: cross-file consistency PASS, JSON parse PASS, acceptance criteria mapped."
echo "Plan complete. Ready for /team-feature integration test on the next real feature."
```

---

## Spec coverage map (self-review)

| Spec section | Task(s) |
|---|---|
| Problem / Goal / Non-goals | Captured in plan header (`Goal`, `Architecture`) and Task 8 README update. |
| Trigger conditions (5 conditions for D.5) | Task 3 § Trigger conditions |
| New mailbox signal `FINISH_BLOCKED <reason>` + reason enum | Task 1 (defines); Tasks 2/5/6/8 (reference) |
| Lead behaviour on FINISH_BLOCKED (5 steps) | Task 2 § Phase 7 merge-failure handling |
| 5-option merge-failure menu | Task 2 |
| Retry cap (merge_retries ≤ 3) | Task 2 § Retry cap + Task 4 § Hard rules |
| Step D.5 procedure (8 steps) | Task 3 § Procedure |
| 4-option remove-failure menu | Task 3 |
| Branch handling | Task 3 § Branch handling + Task 8 README |
| Checkpoint format updates (mid-phase 7 + Closing block) | Task 4 (mid-phase 7 line) + Task 3 Step 3 (Closing block) |
| File changes table (6 files) | Tasks 1–8 (one task per file, with Task 4 stacking two extra edits on team-feature.md) |
| Out of scope (branch deletion, prune, helper scripts, scripts/team-state.sh, plugin.json, marketplace.json, root README) | No tasks touch these files — verified in Task 9 Step 2. |
| Acceptance criteria (6 items) | Mapped in Task 9 Step 3. |

No spec section is unaddressed.
