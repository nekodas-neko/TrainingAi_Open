## 2026-07-21 — Sleep night detail, Activity breakdown, Energy budget + last-weight (v1.191.0)

**Branch:** `feat/health-detail-depth` — items #6, #3, #5 of the owner's Health/Training/Workout UX batch.

- **#6 sleep night detail** — the night-detail view (`SleepDetailView` in `components/health-metric-sheet.tsx`)
  dropped the efficiency / overnight-HRV / lowest-HR / breathing-rate chips that the list card shows.
  `/api/sleep-sessions` already returns them; added the fields to `SleepDetailReading` (they flow via the
  existing `sleepRows as SleepDetailReading[]` cast) and render them as tiles. Built a reusable
  **`components/health/metric-scale.tsx`** (`MetricScale` + `rangeStats`) — a value-in-recent-range scale
  with an average tick — and a "Vs your recent nights" section (duration/efficiency/HRV/lowest-HR/breathing).
  `MetricScale` is the shared primitive #7 will reuse.
- **#3 Activity breakdown** — the Activity detail now always shows "What drives your activity score":
  Movement (steps + active calories, ~60%) vs Training (logged gym volume, up to ~40%), plus the live
  base → +training → final line when a workout was logged. Answers "does exercise contribute, how much".
- **#5 energy budget + last-weight:**
  - `/api/body-metadata` now also returns `latestWeightKg` + `latestWeightDate` from a 180-day lookup
    (no repo-interface change), so the weight card shows the last-known reading ("Last logged <date>")
    instead of "—" when nothing was logged in the last 7 days.
  - New `useEnergyBudget` hook + `EnergyBudgetCard`: daily target = the user's daily calorie goal (or
    maintenance TDEE), counts down as food is eaten, back up as cardio is burned; shows remaining kcal
    (ring) + eaten/burned/target + projected weekly weight change (7700 kcal ≈ 1 kg). Added as the first
    card in the Body-tab "Activity & intake" group; hidden until a TDEE + today's calories exist.

### Verification
- `pnpm exec tsc --noEmit`, `pnpm lint` (0 errors), `pnpm test` (1793 passed) — green.
- `pnpm dev`: `/api/body-metadata` returns `latestWeightKg: 82.5, latestWeightDate: 2026-07-17` (5a
  confirmed). `/health`, `/health/sleep`, `/health/activity` all render HTTP 200.

### NOT exercised / caveats
- **Energy budget card (5b) not exercised with data** — the local seed has no food logged today and no
  daily calorie goal, so `useEnergyBudget` returns null and the card is hidden. The math is tsc-verified
  and the card renders when data is present, but the number/ring were not observed against a real day.
- **Sleep scales / activity breakdown** verified as compile + HTTP 200, not pixels (Playwright
  unavailable). The night-detail scales need real multi-night Oura data to populate; on-device look
  unverified.
- **Note (workout energy):** "burned" in the budget is cardio `activity_logs` only — strength-workout
  energy is not yet folded in (no shared estimator exists). Flagged as a follow-up; the budget still
  works from cardio + food + TDEE.
