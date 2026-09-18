# 2026-09-18 — BF-176: the streak was a property of the window, not of the training

**Branch:** `lane-a/bf176-streak-window` · **Lane A** · no migration

## What the owner saw

*"My streak went from 90 → 89? Can we check to see what it should be and why it went down"* — **on a
day he trained.** His real streak is **102 days**, unbroken since 2026-06-08 under the app's own rule
(two rest days allowed, the third breaks).

## The mechanism, which is worse than a clipped number

`app/api/streak-data/route.ts` sent **90** days of `trainedDays`. The loop consuming it
(`session-select-content.tsx:1008-1030`) walks back **365**. Past day 90 every lookup returns
`undefined` — and the loop reads `undefined` as a **rest day**, not as missing data. Three of those
and it breaks.

So the count was pinned to the window edge. **Once the real streak exceeds the window, the number
stops describing the lifter and starts describing where the edge lands.** It went 90 → 89 because the
edge slid off a rest day (2026-06-20) onto a trained one (06-21), and the day that dropped out of the
payload was trained. It would have oscillated between ~88 and 90 indefinitely.

That is why a supplier sending less than the consumer walks does not under-report by the difference.
It reports a property of the window.

## What shipped

`STREAK_LOOKBACK_DAYS = 365` in `packages/shared/src/workout/streak-window.ts`, imported by the
route. The number is shared **because the two files have to agree and nothing made them** — the old
shape had a local `90` in one file and a literal `365` in another, with no path between them.

## Tests state the defect as an experiment

The useful assertion is not "the number is bigger". It is that the number stops being a property of
the window:

- The same **300-day unbroken history** reports **90, 120 and 200** at three different window sizes.
  The lifter did not change.
- **The entry's pass test:** slide the window a day and the count must not move (it advances by
  exactly the one new trained day).
- A genuine break still breaks it — widening a window is not the same as never breaking.
- Two rest days stay *inside* the streak and are counted, pinning that the home loop measures
  **calendar days spanned** rather than training days.

The loop is **transcribed** into the test rather than imported: it lives in a component this lane does
not own, and the mismatch between it and the route is the thing being pinned. Importing it would
still have required modelling the window separately, and the copy is what makes the disagreement
visible.

## Filed, not fixed — LA-117

`app/api/friends/leaderboard/route.ts` computes **`allTimeStreak`** over its own
`STREAK_WINDOW_DAYS = 90`. Same defect, louder name: a field called all-time that structurally cannot
exceed 90.

The entry invited fixing it in this PR and it is one line. **It was kept out on purpose:** different
surface, nobody reported it, it changes a number other people see on a shared board, and this PR's
value was a one-constant fix whose verification surface should stay one screen. LA-117 carries the
two candidate fixes and the warning that the two streak implementations are **different quantities**
and must not be unified to make them agree.

## Verification

Full suite green by real exit code; `pnpm check:rules` 75 of 75; typecheck clean. 9 unit tests.

**Not exercised:** the streak card itself was not rendered — `/session-select` needs a session and
credentials login does not complete in this sandbox. The route returns a larger `trainedDays` map;
the arithmetic on top of it is pinned by the transcribed loop, not by a screen. **The `trainedDays`
payload is cached (`streak-data`, `TTL_LONG`) and stamped optimistically on workout completion**, so
the owner's card may show the old number until that cache turns over.
