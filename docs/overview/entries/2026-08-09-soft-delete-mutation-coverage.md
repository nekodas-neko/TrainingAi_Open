# 2026-08-09 — Deleted rows coming back is 96% untested

**Branch:** `test/soft-delete-mutation-coverage` · **Domains:** `platform`, `nutrition`, `readiness`

## Pointing the same harness at a different invariant

The ownership mutation method worked, so I aimed it at soft-delete filtering: rewrite every
`isNull(x.deletedAt)` and every raw-SQL `deleted_at IS NULL` to an always-true predicate, and count
what notices.

**113 filters neutralised. 371 of 372 tests still passed.** One test detects it — and only as a side
clause in a test about something else. Per file, **every** slice was at zero except `programs.ts`:
`adapter.ts` (69 filters), `periodization.ts` (17), `oura.ts` (11), `user-stats.ts` (7),
`nutrition.ts` (5) all failed nothing.

**109 of 113 (96%) provably unguarded** — worse than ownership's 38%, on the class with the more
visible symptom. "My deleted workout is back" reads exactly like the "my data disappeared" reports
CLAUDE.md already tracks, from the other side.

## A counting mistake, caught the same way as the last two

My first mutator matched only Drizzle's `isNull(s.x.deletedAt)` and reported **86** filters. It
silently missed **27 raw-SQL** `deleted_at IS NULL` predicates — including `countWorkoutSessions`,
written as a raw `sql` template. True surface: **113**.

Third instance this session of the same shape: a scanner reporting a *smaller* number is as suspect
as one reporting zero, and the same invariant written two ways needs both forms matched before any
coverage claim.

## What shipped, and what did not

7 tests over injuries, supplements, activity logs, fitness tests, food logs and workout sessions —
each asserting the row is present *before* the delete and absent after, so a silently-failed seed
cannot pass. **7/7 fail under mutation.**

`adapter.ts` went 0 → 6 and `nutrition.ts` 0 → 1. **`periodization.ts` (17), `oura.ts` (11) and
`user-stats.ts` (7) are still at zero** — 35 filters. Those are the aggregate/rollup domains, where
seeding a realistic Oura rollup or weekly-stats window is a much bigger job than the six single-row
domains covered. Not attempted, and this is a **partial** burn-down.

## The one real gap — Q-178

The mood-log test **failed on clean code**, which is how it surfaced. `mood_logs` has `deleted_at` on
the server *and* the device; `lib/local-store/sqlite-backend.ts:73` filters it; **all three server
reads carry no filter at all.** The device would hide a deleted mood log while the server returned it.

Latent — nothing server-side writes that column and `getSyncDelta` emits no mood tombstone. Filed
rather than fixed: adding the predicate and dropping the column are both defensible, and which is
right depends on whether mood-log deletion is wanted, which is not a call this review should make.

The test was **removed rather than left weakened**, with a comment marking the spot. A file whose
contract is "every test here fails when the filters are removed" is worth keeping literally true.

## Also removed: a test that could not fail

`deleteSavedMeal` is a **hard** delete and `saved_meals` has no `deleted_at` column, so a saved-meal
test can never fail under this mutation. It was written first, survived the run that killed the other
five, and was moved out. Seventh unfalsifiable assertion of the session — the rate is not going down,
which is the argument for mutation-checking every addition rather than sampling.

## Not covered

DB suite only (372 tests), not the full ~3,270. Per-file attribution only — "35 still unguarded"
counts filters in zero-detecting files, not a per-filter proof. The mutation cannot see a **missing**
filter; Q-178 was found by accident of writing a test, and a systematic static sweep for reads of
soft-deletable tables lacking the predicate has **not** been done. That is the obvious next step.
Local Postgres only — no device, no APK, no production data.

---

## The static sweep, and a fix that was wrong

Mutation cannot see a *missing* filter, so the sweep above's "obvious next step" got done: **129
reads** of the 13 soft-deletable tables, **44 with no `deleted_at` filter**. Most are correct —
**13 are inside `getSyncDelta`**, which *must* return deleted rows so tombstones reach devices, and
most of the rest are on tables nothing soft-deletes server-side. Only **6 of 13** tables have a
soft-delete write at all, and production confirms it: `body_metrics`, `mood_logs` and
`workout_sessions` hold **zero** deleted rows between them.

Two reads are on live-soft-deleted tables and outside `getSyncDelta` — both in-use probes. One
reproduces: **delete your only food log for a meal type and the meal type becomes undeletable
forever**, refused with `MEAL_TYPE_HAS_LOGS` citing a log you can no longer see. Filed as **Q-179**.

**Then I fixed it, and the fix was wrong.** Adding the missing `deleted_at` filter makes the probe
pass — and the subsequent hard `DELETE FROM meal_types` fails on
`food_logs.meal_type_id -> meal_types`, **ON DELETE RESTRICT**. The soft-deleted row still
physically references the parent, so the "fix" trades a clean domain error for a **500**.
`activity_logs.activity_type` is the same shape.

**Only the second test caught it.** The first — "a meal type whose only log was deleted is still
deletable" — passed the probe and then blew up on the FK. Had I written just that one and stopped at
the probe behaving correctly, a 500 would have shipped as a bug fix.

Both changes reverted. The probes are correct given the schema; the *lifecycle* is the question, and
Q-179 lays out four options with their consequences — the cheapest one destroys the sync tombstone,
which is the bug class CLAUDE.md's sync rules exist to prevent. That is a decision, not a patch.

Kept: the half that holds today — a **live** food log still blocks the delete. A fix that simply
dropped the check would pass the other test, so asserting both directions is the point.
