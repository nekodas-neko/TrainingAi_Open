# 2026-08-19 — per-session workout kcal, from the function that owns the total (Q-391, Lane A half)

**Branch:** `feat/day-log-session-kcal` · **Lane:** Implementation A

## The entry named the wrong route, and it matters

Q-391 is the owner's second request for a calories-burnt stat on the day screen's Training card. It
says the blocker is that `estWorkoutKcal` reads the filesystem and so cannot run client-side —
correct — and concludes *"that makes this cross-lane: `/api/day-log` is Lane A's."*

**Putting it in `day-log` would have recreated the defect the same screen already guards against.**
`components/health/day-detail/energy-summary.ts` states the rule in its own header: the Energy
section's `workoutKcal` is read from `/api/nutrition/energy-balance` — the route Nutrition's card
also reads — *"because the day screen disagreeing with Nutrition about how much was burned is worse
than either being slightly off."*

A second per-session estimate in `day-log`, computed from its own profile and weight lookups, would
disagree with the day total sitting two cards below it. `energy-balance-service` resolves weight as
*"last known weight, however old"* across a 14-day window; `day-log` holds only that date's row. The
two would drift apart for any day the user did not weigh in.

## So it ships from the function that already sums the total

`computeActiveEnergy` gains `workoutKcalBySession: { id, kcal }[]` — **the addends of `workoutKcal`**,
surfaced on `/api/nutrition/energy-balance` under `activeBreakdown`. The parts cannot disagree with
the total because they are the terms that were summed.

- **Keyed by session `id`, not name.** `/api/day-log` already exposes `workoutSessionId` per exercise,
  so Lane B can join without name-keying — which matters, since a name is not identity here and two
  same-named sessions in one day would collide.
- **Unrounded on purpose.** The total is rounded; rounding each addend and rounding their sum are
  different numbers, and a card reading 120 + 130 under a total of 251 is exactly what this avoids.
  Rounding is the renderer's decision.
- **A dropped session is absent, not zero.** One filtered by the plausibility guard contributed
  nothing; zero would read as "measured, and it was nothing".
- `id` is optional on the input, so every existing caller is unchanged and simply gets `[]`.

## Verified end-to-end

Against `pnpm dev`, on the three seeded days that carry a completed session:

```
2026-08-16 → [{"id":"6a007073-533d-4f6f-9ea6-0b6cc45074d2","kcal":0}]
2026-08-14 → [{"id":"33e45ed9-2688-4bd7-8f70-a4bfd058a009","kcal":0}]
2026-08-12 → [{"id":"54f4858e-f322-41e9-ad97-8162cbf22d4c","kcal":0}]
```

Each id matches its `workout_sessions` row exactly. Full suite **507 files, 4,303 tests, 0 failed**;
`tsc` clean; `pnpm check:rules` **Ran 50 of 50**.

## ⚠️ The magnitude is NOT verifiable here, and the tests nearly hid that

`kcal: 0` above is not a defect — it is the synthetic constants. The fixture set gives activity 8
("strength training") a `met_moderate` of **0.6**, and the estimator is
`max(0, duration × (met − 1.5) × bmrPerMinute)`, so **every strength estimate is 0 under fixtures**,
in this sandbox and in CI. The day total is 0 for the same reason.

**Three of my first-draft assertions passed vacuously because of it** — `parts sum to total`,
`long ≈ short × 2` and `rounded part === total` are all trivially true at 0. The rewritten file
asserts only what is meaningful at any MET (which ids appear, which are omitted, the sum invariant),
and the one proportionality check guards on `hasRealConstants()` and skips. That trap is now written
into the test file's header so the next person adding a case does not fall into it.

An existing deep-equal test on the zero result needed the new field; updated.

## Not exercised

The rendering — deliberately Lane B's. Nothing on device. No migration, no schema change, no route
added. **And the presentation question the entry raises is still open and still Lane B's:** the
estimate is duration-only, so a 49-minute session moving 2,364 kg and one moving 800 kg produce the
same number, and placing it beside VOLUME KG / EXERCISES / SETS implies otherwise. Label it or move
it; that decision was not made here.
