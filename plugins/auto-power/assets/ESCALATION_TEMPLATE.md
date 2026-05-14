# Auto-Power Escalation Template

The runtime writes one of these files to `docs/superpowers/specs/<slug>-ESCALATION.md` whenever a substantive failure halts the pipeline. Use the structure below verbatim — replace bracketed placeholders.

```markdown
# Escalation: <slug>

**Halted at:** <ISO-8601 UTC>
**Phase:** <plan | arch_sec | worktree | impl | verify | review | finish>
**Signal:** <SEC_BLOCKED | ARCH_BLOCKED | QA_FAIL_EXHAUSTED | SEMANTIC_CONFLICT | CI_RED_PERSISTENT | FINISH_BLOCKED | TEST_SUITE_MISSING | PLAN_FILE_MISSING | OTHER:<short>>
**Branch:** <branch>
**Worktree:** <path or "in-repo">
**Checkpoint:** docs/superpowers/specs/<slug>-checkpoint.json

## What failed

<One paragraph: the immediate symptom and the gate that caught it.>

## Retry history

| # | Attempt | Outcome |
|---|---|---|
| 1 | <action taken> | <result> |
| 2 | <action taken> | <result> |
| 3 | <action taken> | <result> |

## Last error logs

```
<verbatim last error block; truncate at 2 KB if longer>
```

## Suggested fixes

- <fix 1: concrete, file-level>
- <fix 2>
- <fix 3>

## Resume command

After applying a fix:

```bash
/auto-power-resume <slug> --cleared
```

If you decide to abandon the work:

```bash
# Delete the checkpoint and (if we created it) the worktree:
rm docs/superpowers/specs/<slug>-checkpoint.json
git worktree remove <worktree-path>   # only if worktree_created_by_us=true
git branch -D <branch>                # only after confirming no work to keep
```
```

## Signal reference

| Signal | Origin | Auto-retry? |
|---|---|---|
| `SEC_BLOCKED` | security self-review ❌ | No — escalate immediately |
| `ARCH_BLOCKED` | architecture self-review ❌ | No — escalate immediately |
| `QA_FAIL_EXHAUSTED` | `verification-before-completion` red after `max_retries` | No — escalate after retries used |
| `SEMANTIC_CONFLICT` | merge conflict touching overlapping logic | No |
| `CI_RED_PERSISTENT` | same CI failure signature after `max_retries` | No |
| `FINISH_BLOCKED` | non-ff, push rejected, dirty worktree | No |
| `TEST_SUITE_MISSING` | no test runner detected, can't verify | No |
| `PLAN_FILE_MISSING` | plan task references a non-existent file | No |
