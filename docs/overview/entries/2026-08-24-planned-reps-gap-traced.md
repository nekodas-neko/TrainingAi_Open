# 2026-08-24 — traced why 83% of sets carry no `planned_reps` (Q-299b)

**Branch:** `claude/implementation-lane-a-setup-p3f5zk` · **Lane A** · docs-only, no code change.

Split off Q-299 after its autoregulation symmetry fix shipped. Measured against production,
joined `set_logs` through `exercise_logs` to `workout_sessions.started_at` (the table itself has no
`created_at`):

| window | total sets | `planned_reps` filled |
|---|---:|---:|
| before 2026-07-18 | 713 | **0** |
| 2026-07-18 → 07-27 | 120 | **0** |
| 2026-07-30 → today (2026-08-23) | 244 | **244 (100%)** |

Two causes, both accounting for the historical 83% figure, neither needing a code change today.

**(a) Pre-migration history — 713 sets, the large majority of the gap.** Migration
`126_set_log_planned_snapshot.sql` added the column on 2026-07-18; nothing logged before that date
could ever have carried a value. Not fixable retroactively — there is no stored prescription to
recover from.

**(b) A ~9-day write-path bug, 2026-07-18 → 07-27 (120 sets), already self-resolved.** In the same
window, `planned_pct` was captured correctly (tracked total almost exactly) while `planned_reps`
was zero on every single day — a real, narrow defect, not noise. From 2026-07-30 it is 244 of 244
(100%), every day through 2026-08-23, a full month with no gap.

## Recorded as self-resolved, not claimed fixed

Per CLAUDE.md's "something that stopped is not something that was fixed": the cause, and the
change that closed the 07-27 → 07-30 gap, are **not identified**. This repo's git history starts at
the 2026-08-16 public snapshot (`git log --oneline --all | tail -1` → the initial public commit),
so finding the actual fix commit would need the private archive
(`nekodas-neko/TrainingAI_Old`, attachable via `add_repo` per `CLAUDE.md`'s BF-4 precedent). The
current write path (`packages/shared/src/workout/log-exercise.ts:264`, `plannedReps:
progressionStyle?.[i]?.reps ?? undefined`) was read and is correct today, and has produced 100%
coverage for a month — there is no live defect for a git-archaeology pass to point at, and naming a
commit for a bug that already isn't happening wouldn't change anything actionable. Not pursued
further for that reason.

## Verified

- Three production queries against `claude_ro.set_logs`/`exercise_logs`/`workout_sessions`, cross-
  checked (the day-by-day breakdown for the 07-15→08-01 window and the 07-30-onward window both
  independently confirm the three-window summary table).
- `pnpm check:rules` — 55 of 55 (docs-only change).

Both halves of the original Q-299 are now closed: the code asymmetry (shipped earlier this
session) and this trace of the missing-data root cause (no code owed).
