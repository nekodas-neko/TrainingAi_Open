# 2026-08-20 — the done screen was estimating your calories from the first weight you ever logged (Q-330)

**PR:** #TBD · branch `fix/session-energy-weight-source` · Lane A

## What was wrong

`GET /api/workout-sessions/[id]/energy` — the calorie figure on the done screen, right after you
finish a workout — resolved body weight through `repo.getBodyMetricsBaseline()`. That method orders
`asc(bodyMetrics.date)` and takes the first row: **the earliest weight ever recorded**, not the
current one.

Q-330 was filed with the assumption that this might be defensible — that weighing a historical
session against "the weight you were at the time" is arguably correct. **Reading the query settled
it: it is not the weight at the time of anything.** It is the start of recorded history, frozen. Its
error does not converge; it grows with every kilogram gained or lost.

Measured on production: oldest weight **70.5 kg** (2026-05-01), newest **71.5 kg** (2026-08-20) —
which is exactly the ~1 kcal gap Q-330 recorded between the done screen (107) and the day's ENERGY
row (107.93).

The same method had a second wrong caller. `app/api/nutrition/meal-plans/generate/route.ts` asks for
it under a comment that says, in its own words, it wants *"CURRENT weight … the body doing the
eating"* — and then reached for the earliest one.

## What changed

- Both callers now use `repo.getMostRecentConfirmedWeightKg()` (`desc(date) LIMIT 1` over non-null
  weights).
- `progress-summary` is left on `getBodyMetricsBaseline` and is the one caller for which "baseline"
  is the right reading: its consumer is `goalProgressPct(baseline, current, target)`, a
  goal-progress bar, which genuinely needs the starting point.
- The repository interface's comment now says outright that this method is *not* the current weight
  and names the one to use instead. The old comment was already accurate ("earliest-ever … starting
  point for long-term goal progress") — two callers read it and reached for it anyway, so it now
  states the negative case as well.

## Verified

Against the local dev server, with a session completed that minute at RPE 9 (55 min), local weights
running 81.85 kg on 2026-08-04 to 80 kg on 2026-08-19:

| surface | before | after |
|---|---|---|
| `GET /api/workout-sessions/[id]/energy` | 107 | **106** |
| `activeBreakdown.workoutKcalBySession` | 106.068… | **106.068…** |

So the two surfaces now agree exactly for a same-day session — which was **Q-419's acceptance
criterion**, and is why that entry has been retired from the queue along with Q-330.

`POST /api/nutrition/meal-plans/generate` was exercised end-to-end against the real model and
returned a plan (`mealsPerDay: 5`).

Full gate: `tsc` clean · lint clean · **Ran 50 of 50 Custom Rules steps** · 4,341 unit tests pass.

## Honest limits

- **The meal-plan half is a correctness fix with a small behavioural footprint today.**
  `suggestMealCount` rounds and then clamps to a meal count, so a 1 kg difference in the input
  almost never changes the integer it returns. It is fixed because the divergence grows and the
  route's own comment asked for the other number, not because a user is seeing a wrong meal count
  now.
- **No test pins the two energy surfaces to one number.** Both estimate strength as activity 8, and
  the committed fixture MET for it (0.6) sits below the formula's 1.5 floor, so in CI both sides are
  0 and an equality assertion would pass vacuously — the Q-391 trap. Filed as **Q-331** with the
  shape of a test that would work.
- **Not exercised:** the APK, native SQLite, safe-area insets, Samsung WebView rendering. This is a
  server-side change to two API routes and reaches the device through a Railway deploy with no
  rebuild; there is no local-store or native path in the diff.

## Tests added

- `lib/data/postgres/__tests__/body-weight-baseline-vs-current.test.ts` — locks the semantics of the
  two methods against each other: opposite ends of history, the baseline stays frozen as newer
  readings arrive, both key off `date` rather than insert order, weight and body fat are picked
  independently, and nulls come back rather than a throw.
- `app/api/__tests__/session-energy-weight-source.test.ts` — the route estimates from the latest
  weight and never calls `getBodyMetricsBaseline`. Its first case is a vacuity guard: it asserts the
  chosen activity's MET clears the 1.5 floor and that the two weights give different answers, so the
  file cannot pass by comparing zeroes.
