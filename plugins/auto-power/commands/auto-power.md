---
description: Run the obra/superpowers chain end-to-end as a single hands-off pipeline. Auto-answers safe clarifying questions during spec, then runs plan → arch+sec → impl → verify → review → ff-merge with no further touchpoints. The only owner touchpoint is spec approval. Checkpointed and resumable.
---

# /auto-power

**Usage:** `/auto-power <idea> [--branch=<name>] [--no-worktree | --worktree] [--max-retries=N] [--ci-wait=MIN]`

**Arguments:**

| Flag | Default | Effect |
|---|---|---|
| `<idea>` (required, positional) | — | One-line description of the feature to build. Same input you would give to `superpowers:brainstorming`. |
| `--branch=<name>` | `auto-power/<slug>` | Override the branch name |
| `--no-worktree` | off | Force in-place work on the current branch (skip worktree creation even if running from the main repo) |
| `--worktree` | off | Force creation of a new worktree even if already inside one |
| `--max-retries=N` | 3 | Override `limits.max_retries` |
| `--ci-wait=MIN` | 30 | Override `limits.ci_wait_minutes` |

## Procedure

1. Parse the arguments above. Slugify `<idea>` (kebab-case, ≤ 40 chars) to derive `<slug>`.
2. Invoke the `auto-power-runtime` skill. Pass: `slug`, `idea`, parsed flags, the absolute path to `plugins/auto-power/assets/CHECKPOINT_SCHEMA.md`, and the path to `plugins/auto-power/assets/ESCALATION_TEMPLATE.md`.
3. Follow the runtime skill exactly. Do not improvise touchpoint decisions — every prompt is either covered by the skill's rules or surfaces an escalation.

## Owner touchpoints

Exactly one by design: spec approval at the end of phase 1. Every other interactive prompt is auto-resolved per the runtime skill's whitelist (`§1`) or auto-approve table (`§5`), or escalates via `§6`.

## Artifacts produced

- `docs/superpowers/specs/<date>-<slug>-design.md`
- `docs/superpowers/specs/<date>-<slug>-plan.md`
- `docs/superpowers/specs/<slug>-auto-decisions.md`
- `docs/superpowers/specs/<slug>-checkpoint.json`
- On failure: `docs/superpowers/specs/<slug>-ESCALATION.md`

## On escalation

If the runtime writes an escalation file, fix the underlying issue and resume:

```
/auto-power-resume <slug> --cleared
```

See `plugins/auto-power/README.md` for the full lifecycle and escalation handling.
