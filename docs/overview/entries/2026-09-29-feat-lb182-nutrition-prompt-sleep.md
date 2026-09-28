# 2026-09-29 — LB-182: the nutrition-goal prompt hears how he said he slept, only when he said it

**Lane A · `app/api/nutrition-goals/recommend`.**

- **Change:** the route reads the window's morning check-ins beside its other reads, and passes each
  one through `answeredMorningScales`, never the raw column. The prompt gets one line per morning he
  actually rated or corrected, with the scale's direction named (1 = slept great, 5 = slept
  terribly, the reverse of every other scale nearby). When there are none, it says so. A failed read
  leaves the line out rather than failing the recommendation.
- **What it tells the model for the owner today:** nothing new. Measured on the snapshot, **3 of 84**
  morning check-ins were ever genuinely rated, the last on 2026-08-12. Since the sheet started
  stating the app's own read of the night, an untouched scale means "accepted it", which is why the
  empty-case line reads "did not rate or correct". The line matters from the next correction on.
- **Verified:**
  - Three new route tests: rated mornings are included in order with the direction; the
    untouched seed never is; a failed read still recommends.
  - The existing TN-66 guard passes.
  - `pnpm dev` against the snapshot, as the owner: `POST /api/nutrition-goals/recommend` → 200,
    1,359 kcal (the figure LA-126 predicted for the corrected baseline).
