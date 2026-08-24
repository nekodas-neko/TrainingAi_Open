# 2026-08-24 — implausible session durations culled, and the bound stops being four numbers (LA-21)

**Branch:** `fix/cull-implausible-session-duration` · **Lane A** · shared math + three routes.
No migration, no APK.

## The owner's call

> *"There are likely all errors from it being left on too long. Make sure they are culled from
> statistics."*

**Culled, not clamped.** My entry had proposed clamping on the grounds that the eleven sessions are
real workouts, and they are — 5–6 exercises, 13–18 sets, 3,700–7,400 kg each. But the owner knows what
happened, and a clamped 240 minutes standing in for a 14-hour row is still a number nobody measured.
The exercise and set logs are untouched and the **volume stays**; only the clock was wrong, so only
the duration-derived figures go.

## There are two causes, and the local clock times separate them cleanly

| local start → end | n | reading |
|---|---:|---|
| **00:00** → 08:53–14:05 | **7** | `startedAt` fell back to local midnight |
| 07:29–11:56 → 18:12–22:52 | **4** | started for real, completed ~11 hours later — morning to after work |

The owner's explanation covers four of them. The other seven are the cause already named in code
comments that were sitting in `weekly-stats` and `body-metadata` the whole time: *"a midnight
`startedAt` fallback + evening completion."* Both stopped after 2026-05-29 and **neither is
explained**, so per CLAUDE.md this is unexplained rather than fixed — which is why the cull is a bound
on the number rather than a fix for a cause.

## The bound already existed. Three times.

`MAX_PLAUSIBLE_SESSION_MIN = 240` was declared independently in **`body-metadata`, `weekly-stats` and
`daily-energy`**, with **two different behaviours** attached — `daily-energy` clamps for logged
activities and excludes for sessions, `weekly-stats` excludes and substitutes the exercise-log span —
and the `body-metadata` copy was **declared and never read**.

That is the One Formula, One Place failure this repo keeps paying for, and it had a real consequence:
`body-metadata` and `weekly-stats` were **already culling**, while `health-trends`' `sessionLoad` and
the per-session energy routes were not. The defect was half-fixed in two places and invisible in the
others.

There is one export now. Each site keeps its own deliberate clamp-or-exclude choice — `weekly-stats`
substituting the log span is *right* for a midnight-`startedAt` session, because its logs are real.

## What shipped

- `MAX_PLAUSIBLE_SESSION_MIN` and `isPlausibleSessionDuration` in `workout-energy.ts`, beside the
  `HR_MIN_PLAUSIBLE`/`HR_MAX_PLAUSIBLE` bounds they mirror.
- Applied inside **both** `estWorkoutKcal` and `estWorkoutKcalFromHr`, so `estSessionKcal` is covered
  on both branches — a bound on the MET path alone would have left the defect exactly where a strap
  was worn.
- `app/api/health-trends` drops the point from the `sessionLoad` series.
- **240 is not a fresh number**: `lib/stores/workout-store.ts` already treats a session whose start
  anchor is over four hours old as abandoned. A *completed* session claiming more than four hours is
  one the app itself would have refused to resume.

## Verified

- 5 new tests pinned to the real data — 56 min (p50) and 92 min (longest real session) pass; 534 and
  845 (the shortest and longest bad ones) return null.
- **Two mutations:** removing the upper bound fails 4 tests; bounding only the MET path and not the HR
  path fails 2. The second is the one that matters, because HR is the branch that runs in practice.
- **Through the real route on `pnpm dev`:** the dev database's 1,176-minute session leaves the series
  — 10 points → 9, and **max `sessionLoad` 10,585 → 495**.
- Full suite **565 files / 4,648 tests**; `pnpm check:rules` 55 of 55.

## What is left

**The midnight-`startedAt` fallback is not fixed.** Seven sessions recorded a start time that was
never captured, and culling hides that rather than recovering the real span. `weekly-stats` already
substitutes the exercise-log span for exactly this case; whether the other consumers should, or
whether the write path should stop inventing a midnight start at all, is the open half — kept on
LA-21.

**Failure surfaces NOT exercised:** production — the before/after was measured on the dev database's
own long session, and the eleven production rows are all from May, so none of them will be re-read
until someone opens a May session. Nothing device, native, safe-area or offline is touched.
