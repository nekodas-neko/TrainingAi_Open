# 2026-09-08 — the day timeline gets tests (PS-39)

**Branch:** `test/day-timeline-export-routes` · **Lane A** · PS-39, coverage ratchet **71 → 70**.

## What shipped

`lib/__tests__/day-timeline-route.test.ts` — 27 cases over `GET /api/day-timeline`. No product
change.

**One route, its own file, because it is the batch**: 309 lines merging sleep, workouts, meals,
saved activities, Oura walks and Oura tags into one ordered list. CLAUDE.md names it the sanctioned
exception to the offline-first read rule (SYNC-R3) — a client-side assembler reproducing this merge
was judged out of scope — which makes it the one screen whose ordering nothing else can check.

The decisions now pinned:

- **Readiness comes from our own derived row before the Cloud column** (Q-43). Cloud-only was null
  for every user not on Oura Cloud, and for this owner since the BLE re-key. The sleep session's own
  score outranks both.
- **A meal sits at the latest item logged inside its window**, and falls back to the window's END
  rather than its start, so a meal logged outside its window still sorts late.
- **A started-but-empty workout row is a phantom** and has nothing to show.
- **An Oura walk overlapping a saved activity is dropped** — the confirmed walk and the raw
  detection behind it are one entry.
- **A guided walk is recognised by its `segments`**, checked before the keyword collapse that would
  flatten it to a bare "Walk".
- **The day group is recomputed from each event's own timestamp**, which is what puts a "fell
  asleep" before midnight under yesterday while its wake-up stays today's.

## Mutation pass — 26 mutations, 2 survivors, one cause

Both were in `isQualityWalk`, and both for the same reason: **each fixture was rejected by a
different guard than the one it named.** "Below the distance floor" was 749 m over half an hour —
1.5 km/h, so the SPEED check rejected it — and "too slow" was 166 m, rejected by the DISTANCE check.
Both cases passed, and deleting either guard changed nothing.

Rewritten so each case fails on exactly one guard and satisfies the other two: 700 m in 8 minutes
(5.25 km/h — fast and long enough, just short), 1 km in an hour (far and long enough, just slow),
6 minutes, and over three hours. All four guards are now independently pinned, including the
duration ceiling and floor separately.

This is the third time in one session that a passing case turned out to be passing for the wrong
reason, and every one was found by mutation rather than by review. The shape is always the same: a
fixture that trips two rules at once tests neither.

## Not exercised

Web/Node only. No device run: a server route with no native, safe-area, gesture or notification
surface, and the tests mock the repository, so no Postgres path, no drifted production data and no
Samsung WebView rendering were exercised.
