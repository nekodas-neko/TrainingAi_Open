# 2026-09-21 — TN-20: the write that destroyed four days is a GET

**Branch:** `lane-a/tn20-empty-snapshot-guard` · **Lane A** · data integrity, shipped alone as the
entry requires.

## What the entry expected, and what is actually there

Its first action reads: *"find the writer. Candidates worth checking first are the same
delete-before-guard shape as Q-528 (`replaceOuraDailySummary`) and any `fullHistory` path — a
recompute that starts by clearing and then writes nothing when its input query returns empty."*

**There is no recompute and no delete.** `body_battery_daily` has exactly one writer:
`GET /api/body-battery`, which snapshots the row on every read *by design* — its own comment says
*"Every read updates today's row, so the last read of the day captures the end-of-day value."*

So the mechanism is last-read-wins with no emptiness guard. A read whose waking-hours HR query comes
back empty computes a whole day of nothing — `hrSampleCount` 0, charged 0, drained 0, `endValue`
back at the anchor — and wrote it straight over a correct row. **The destructive write is a `GET`,
which is why nothing looked suspicious.** The entry's warning *"do not fix this by re-running the
recompute"* was aimed at a path that does not exist; the caution behind it was right for a reason it
did not have, since here a read *is* a write.

## Two corrections from production

Measured 2026-09-21 against `body_battery_daily` (84 days) and `oura_heartrate`:

| date | stored count | raw samples | drained | end = anchor |
|---|---:|---:|---:|---|
| 2026-07-26 | 0 | 272 | 0 | yes |
| 2026-08-22 | 0 | 265 | 0 | yes |
| 2026-08-26 | 0 | 1,954 | 0 | yes |
| 2026-08-31 | 0 | 3,767 | 0 | yes |

1. **It is 4 of 84, not "3 of the last 11".** The extra day (2026-07-26) predates the entry.
2. **It is not "losing days now".** The newest is 2026-08-31 — three weeks before this was written.
   **The mechanism was never fixed**: the guard did not exist until this change, so the right
   reading is the one CLAUDE.md gives for `error_events` — *something that stopped is not something
   that was fixed*. It stopped firing; it stayed possible. That is also why the fix ships with a
   test rather than on the strength of the table looking calm.

All four carry the identical signature — `total_charged = total_drained = 0`, `end_value = anchor`,
`anchor_source = 'readiness'` — which is what a walk over zero samples produces.

## The guard, and the fix that was rejected

`setWhere: excluded.hr_sample_count > 0 OR stored.hr_sample_count = 0`, in the `ON CONFLICT` clause
so it is atomic rather than a read-modify-write.

**Not a monotonic `excluded >= stored`**, which is the obvious alternative and is wrong twice: it
would freeze a day at a bad value, and it would block a legitimate downward correction. The entry
itself draws the line — on healthy days a stored count sits *slightly below* raw because of
waking-hours windowing, and **"zero against thousands is a different failure"**. The guard tests for
that failure, not for direction. A mutation pins it: the monotonic version fails the control.

**It repairs as well as protects.** A later read of the same day that does see samples passes the
guard and overwrites the empty row, so a day flattened in the morning heals itself by evening. That
is the entry's pass test, met by the write path instead of a backfill.

## Verification

- **4 tests against real Postgres**, through the real repository and the real drizzle upsert: the
  production case, the self-repair, and two controls.
- **Mutation pass, three mutations:** guard removed (the bug) → the production case goes red;
  monotonic guard → **the control goes red**, which is the point of having it; the same condition
  rewritten as `NOT (excluded = 0 AND stored > 0)` (the deliberate control) → 4 green.
- Full suite, `check:rules` and typecheck below.

## Not exercised, and what is still owed

- **The four damaged days are NOT repaired.** The route only ever writes `todayIso`, so nothing
  re-reaches a past date; the guard stops the fifth day and heals the current one, and that is all.
  Rebuilding 2026-07-26 / 08-22 / 08-26 / 08-31 from the raw samples that still exist needs a
  backfill path that does not exist yet, and it is a production data write — **confirm-first, and
  owed to the owner rather than assumed.** TN-20 stays queued for it.
- **The triggering condition is not identified.** This fixes the damage the empty read causes, not
  whatever made a read see no waking samples on those four days. TN-55 measures the adjacent thing
  (`walkBodyBattery` filters to `>= wakeTime`), so a wrong or late `wakeTime` is the first place to
  look — recorded rather than investigated here.
- **No device check needed and no APK** — server-side only, ships via Railway.
