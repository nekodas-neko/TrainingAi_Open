# 2026-09-18 — LA-117: a field called `allTimeStreak` could only ever report 90

**Branch:** `lane-a/la117-leaderboard-all-time-streak` · **Lane A** · no migration

## What it was

BF-176's defect, on a second surface, under a louder name. `app/api/friends/leaderboard/route.ts`
bounded its trained-days query at `STREAK_WINDOW_DAYS = 90` and then computed `allTimeStreak` from
the result. The owner's real best is **102**, so the board could not report it — and, as BF-176
established, a streak longer than its window does not under-report by the difference: it reports a
property of the window.

I filed this entry myself while shipping BF-176 and deliberately did not batch it, because it is a
different surface nobody reported and it changes a number other people see on a shared board.

## The sibling the entry did not name

`weeklyStreak` on the same route reads the **same clipped day list** (`longestWeeklyStreak(days)`),
so it was capped at ~14 weeks by the same bound. The entry named only `allTimeStreak`. Reading the
route rather than the entry is what found it, which is the sibling-surface sweep doing its job —
and it is fixed for free by the same one-line removal.

## What shipped

The 90-day `gte` is gone from the streak query; both fields now read every trained day. The route
carries a comment saying the cost was measured rather than assumed, and what to do instead if the
app ever grows a real user base (bound on rows and rename the field — do not quietly reinstate a
day window under a name that promises all-time).

## The measurement, because option 1 required one

The entry offered two fixes and made the cheap one conditional: *drop the window* only if the
unbounded scan measures cheaply, otherwise *rename the field* to `recentStreak`. Measured against
production on 2026-09-18:

- `pg_stat_user_tables` — `workout_sessions` is **133 rows / 96 kB** across the whole database.
  These are the physical-size and estimate columns respectively; the size is exact, the row count
  is a planner estimate, so it is quoted as the *shape* of the table rather than as a row total.
- `claude_ro.workout_sessions` — **113** exact rows for the owner, 2026-04-30 → 2026-09-16. That
  view is row-scoped, so this is the owner's history only.

Either way the table is small enough that dropping the bound is free, and the index is already
`(user_id, started_at)`. So option 1, on evidence rather than on preference.

## What was deliberately NOT done

**The two streak implementations were not unified**, per the warning the entry inherited from
BF-176. `computeStreak` counts **training days** with a rest allowance; the home loop counts
**calendar days spanned**. Both are defensible and they answer different questions — making them
"agree" would silently redefine what the owner's 102 means. `streak-window.ts` now says outright
that the leaderboard does not read `STREAK_LOOKBACK_DAYS`, so the next session does not unify them
by accident: 365 would cap an all-time field just as 90 did.

## Verification

`lib/data/postgres/__tests__/friends-leaderboard-route.test.ts`, 13 passing (was 10). Three new
cases, and the mutation pass ran against the unfixed route to prove each one earns its place:

| Case | Unfixed route | Fixed route |
|---|---|---|
| 121 consecutive days → `allTimeStreak` | **90** — exactly the number the entry predicted | 121 |
| …and `weeklyStreak` (probed separately, with the first assertion stubbed out) | **14** | 18 |
| 30 consecutive days → `allTimeStreak` (**deliberately equivalent control**) | 30 | 30 |
| two 10-day blocks 200 days apart | 10 | 10 |

The last two are the controls and they pass either way by design. Removing a filter is only safe if
it changes nothing for the rows the filter never excluded — and a fix that returned the *total
count* of trained days rather than the longest run would pass the first case and fail the last.

**Not exercised:** the S25 device. This is an engine-half change reaching the phone through a
Railway deploy with no APK, and `components/more/friend-leaderboard.tsx` was not touched — but the
number it renders changes, and nobody has looked at the card at 121 rather than 90.
