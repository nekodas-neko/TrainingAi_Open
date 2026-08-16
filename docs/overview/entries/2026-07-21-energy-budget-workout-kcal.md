## 2026-07-21 — Fold strength-workout energy into the energy budget (v1.194.0)

**Branch:** `feat/energy-budget-workout-kcal` — follow-up to #5 (energy budget), flagged when that
shipped: the budget's "burned" counted cardio (`activity_logs`) only.

Now today's **completed strength sessions** contribute to the budget's "burned", via the existing
shared estimator `estWorkoutKcal` (`lib/health/workout-energy.ts` — MET × Schofield-BMR-per-minute,
ported from Oura's `energy_expenditure_1_0_0` fallback), using activity id 8 ("strength training",
MET 5.5, moderate intensity). No new formula — reused the one already in `lib/`.

- `/api/body-metadata` fetches today's workout sessions (`getWorkoutSessionsFrom` from today's local
  midnight), sums `estWorkoutKcal(durationMin, age, weightKg, sex, activity 8)` over completed
  sessions (duration = `completedAt − startedAt`, capped at 240 min like weekly-stats), and returns a
  new `workoutKcalToday`.
- `useEnergyBudget` gains a `workoutKcalToday` param; `burned = (calsBurnedToday ?? 0) + (workoutKcalToday ?? 0)`.
- Threaded through `health-content.tsx` (`setMetaFromPayload` → state → hook).

### Verification
- `pnpm exec tsc --noEmit`, `pnpm lint` (0 errors), `pnpm test` (1793 passed), `pnpm build` — green.
- `pnpm dev`: seeded the test user's DOB + a completed 18:00→18:55 session today; `/api/body-metadata`
  returned **`workoutKcalToday: 291`** (82.5 kg, age 30, male, 55 min @ MET 5.5) — a plausible value
  that folds into the budget's burned. Degrades to 0 when weight/age/sex is missing.

### Note
Still excludes step-based movement energy (minor); the budget = goal/TDEE − eaten + cardio + strength.
On-device look of the budget card with a real training day still wants the S25 smoke run.
