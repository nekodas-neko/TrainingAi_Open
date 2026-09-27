# 2026-09-28 — LA-168: a rollup pass no longer thins a workout it cuts through

## What was wrong

The BLE rollup bins ring HR at 15 s inside a workout (±10 min) and at 5 minutes elsewhere. It
rewrites its HR window every pass, upserting what it regenerates and deleting the other `ble` rows
from its cutoff forward. The workout windows came from `readWorkoutWindows(since)`, which selected
sessions whose **start** was at or after the cutoff. The incremental cutoff is the watermark minus
3 days, and it slides forward pass by pass. So a pass whose cutoff landed inside a workout (after its
start, before its end plus pad) did not see the workout. It re-binned the rest of the session at
5 minutes and deleted the 15-second rows.

**Production evidence.** For 09-06 the stored rows switch from 15-second to 5-minute spacing at
09:43:42, 45 seconds after the 09:42:57 start. Every 5-minute row carries `updated_at` 09-09 13:01,
three days later. Snapshot-against-now counts for ring-only sessions: 180 → 13, 103 → 12,
110 → 31, 32 → 5, 87 → 52, 164 → 99. Strap sessions are unaffected where the strap covers.

## The fix

- `rollup-io.ts`: the read now selects workouts that **overlap** the cutoff: unfinished, or completed
  at or after it, bounded to a day before it.
- `run.ts`: passes the cutoff minus the 10-minute pad, so a session that ended just before the cutoff
  still owns its padded bins.

`oura-ble-workout-window-overlap.test.ts` has three cases: a cutoff mid-workout, a cutoff in the pad
of a finished one, and a cutoff inside an unfinished one. All three fail before the fix and pass after it.
**Mutation pass:** reverting to start-only failed all three, removing the pad failed the pad case,
and dropping the unfinished arm failed its case. The control, a 48-hour look-back, which is
equivalent here, passed as it should.

## Not done

Rows already thinned stay thinned. Recovery needs a full-window rollup and reaches back only 14 days.
The Known-Issues row records that and the owner decision. Server-only change, so no APK is needed.
