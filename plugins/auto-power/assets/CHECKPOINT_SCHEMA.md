# Auto-Power Checkpoint Schema

Location: `docs/superpowers/specs/<slug>-checkpoint.json` (next to the spec/plan files for the same `<slug>`).

Format: plain JSON. Users may inspect or edit by hand.

## Schema

```json
{
  "slug": "add-foo-widget",
  "started_at": "2026-05-14T08:30:00Z",
  "updated_at": "2026-05-14T09:12:00Z",
  "status": "running | blocked | done",
  "phase": "spec | plan | arch_sec | worktree | impl | verify | review | finish",
  "branch": "auto-power/add-foo-widget",
  "worktree_path": "/abs/path/to/worktree-or-null",
  "worktree_created_by_us": true,
  "spec_path": "docs/superpowers/specs/2026-05-14-add-foo-widget-design.md",
  "plan_path": "docs/superpowers/specs/2026-05-14-add-foo-widget-plan.md",
  "auto_decisions_path": "docs/superpowers/specs/2026-05-14-add-foo-widget-auto-decisions.md",
  "current_task_id": "task-3",
  "tasks_done": ["task-1", "task-2"],
  "retries": { "impl": 1, "verify": 0, "ci": 0 },
  "last_error": null,
  "finish_mode": "ff-merge",
  "limits": { "max_retries": 3, "ci_wait_minutes": 30, "phase_stall_minutes": 30 }
}
```

## Field reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `slug` | string | yes | Kebab-case identifier; appears in every artifact filename |
| `started_at` | ISO-8601 UTC | yes | Set once at pipeline start; never overwritten |
| `updated_at` | ISO-8601 UTC | yes | Bumped on every write |
| `status` | enum | yes | `running` during pipeline, `blocked` after escalation, `done` after successful merge |
| `phase` | enum | yes | One of: `spec`, `plan`, `arch_sec`, `worktree`, `impl`, `verify`, `review`, `finish` |
| `branch` | string | yes | Git branch holding the work |
| `worktree_path` | string \| null | yes | Absolute worktree path; `null` when running in main repo |
| `worktree_created_by_us` | bool | yes | `true` only when the pipeline itself created the worktree. Drives cleanup behavior on finish |
| `spec_path` | string | yes | Relative path to the approved design doc |
| `plan_path` | string | yes | Set after plan phase completes |
| `auto_decisions_path` | string | yes | Append-only log of auto-answers and auto-approves |
| `current_task_id` | string \| null | yes | Plan task currently in flight; null outside `impl` phase |
| `tasks_done` | string[] | yes | Completed plan task IDs |
| `retries` | object | yes | Keys: any of `plan`, `arch_sec`, `impl`, `verify`, `review`, `finish`, `ci`. Counters reset on phase advance |
| `last_error` | object \| null | yes | `{ phase, signal, message, at }` populated on retry or escalation |
| `finish_mode` | enum | yes | Always `ff-merge` in v1 |
| `limits` | object | yes | `max_retries` (default 3), `ci_wait_minutes` (default 30), `phase_stall_minutes` (default 30) |

## Write triggers

The runtime writes the checkpoint:

1. At pipeline start (initial creation).
2. Before every phase transition.
3. After every retry counter increment.
4. After every task completion (`tasks_done` append + `current_task_id` advance).
5. Before any escalation file write.
6. On successful merge (`status: done`).

## Hard rules

- Never overwrite the checkpoint without bumping `updated_at`.
- Never resume into a branch different from the one recorded.
- Never advance `phase` without first writing the checkpoint.
- Never remove a worktree where `worktree_created_by_us: false`.
