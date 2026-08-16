## 2026-07-21 — Energy budget counts all movement (weights + activities + steps), no double-count (v1.195.0)

**Branch:** `feat/energy-budget-all-movement` — completes the owner's ask that "runs, walks, weights, any
activities, and steps" contribute to the daily energy budget, backed by real formulas rather than guesses.

### Research findings (why the previous state was wrong / incomplete)
- **Runs/walks were effectively uncounted.** Logged activities store `caloriesBurned = null` unless native
  Health Connect enriched them; there was no in-app estimator. On web / without HC, they contributed 0.
- **Steps were never counted.** No steps→energy path existed anywhere.
- **Double-counting risk.** The budget target was `BMR × activityMultiplier` (default 1.4). Any multiplier
  above sedentary (1.2) already bakes daily movement into the number, so adding exercise on top
  double-counts — the v1.194.0 strength fold-in was itself sitting on that inflated base.

### The model (research-backed, de-duplicated) — new `lib/health/daily-energy.ts` (9 unit tests)
- **Resting base = BMR × 1.2** (sedentary Mifflin factor: BMR + thermic effect of food + incidental NEAT).
  The budget target is the user's manual daily calorie goal if set, else this resting base. Movement is
  added **on top**, so basing on a higher multiplier (which would double-count) is avoided.
- **All movement via the shared `estWorkoutKcal`** (Compendium-of-Physical-Activities METs × Schofield BMR,
  net of a 1.5-MET resting baseline — one formula, not a second invented one):
  - strength workout_sessions (activity 8), logged activities mapped `activityType → Oura MET id`
    (walk 14, run 12, cycle 5, hike 21, swim 13, …; distance→duration fallback when duration is missing),
    and passive steps.
- **Steps de-duplication:** passive step energy is walking-MET over `max(0, pedometerSteps − 3000 baseline
  − stepsInLoggedOutdoorActivities)`, at ~100 steps/min (Tudor-Locke moderate cadence). The 3,000 baseline
  removes incidental steps already in the sedentary base; subtracting logged outdoor walk/run step-equivalents
  (distance × 1,300 steps/km) stops those steps being counted both as steps and as the logged activity.
- `/api/body-metadata` computes `activeEnergyKcalToday` (replaces the strength-only `workoutKcalToday`);
  `useEnergyBudget` bases on the resting floor and uses it as "burned"; the card labels it "Moved" with a
  caption "workouts, activities & steps, added on top of your resting base".

### Verification
- `pnpm exec tsc --noEmit`, `pnpm lint` (0 errors), `pnpm test` (1802 passed incl. 9 new daily-energy
  tests), `pnpm build` — green.
- `pnpm dev`, seeded profile + a completed lift + a 30-min/5km run + 12k steps: `/api/body-metadata`
  returned **`activeEnergyKcalToday: 624`** — a sane total (resting base ~2,286 + 624 ≈ 2,910 kcal TEE for
  an active 82.5kg male). Unit tests separately prove: strength 200–400, run > walk, distance→duration,
  steps-above-baseline, and the outdoor-walk-step subtraction.

### Sources
MET values: Compendium of Physical Activities (Ainsworth et al.), pinned in
`energy-expenditure-features.json`. BMR: Schofield equations (via `estWorkoutKcal`). Walking cadence:
Tudor-Locke et al. (~100 steps/min ≈ moderate-intensity threshold). Activity factors: Mifflin-St Jeor
(sedentary 1.2). Net-vs-gross cost of transport: PMC4575035.

### Note
On-device confirmation of the budget card against a real logged day still wants the S25 smoke run.
