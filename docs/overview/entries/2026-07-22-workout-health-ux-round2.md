## 2026-07-22 — Workout & health UX round 2 (v1.199.1)

Owner feedback on the v1.198.0 batch, three refinements.

### What shipped
1. **Role pills recoloured + right-aligned.** Main/Secondary/Accessory chips are now colour-coded
   (emerald / sky / violet) via a shared `RoleChip` (`components/workout/role-chip.tsx`,
   `roleColor()` in `lib/workout/intensity-zone.ts`) and moved to the right of the exercise row on
   both the pre-workout list and the AI prescription card.
2. **Score bar on each health detail card.** `contributor-details.tsx` now repeats the band-coloured
   score bar (with the neutral-50 tick) inside each per-factor card, so the how-to-improve text sits
   next to a chart of where you currently are.
3. **Prescription card refresh, harder.** Owner reported the v1.198.0 in-place refresh still didn't
   surface the "Auto-applied" card without a reopen. Now `loadPeriodization()` also runs on **every
   regeneration poll tick** (not only on the pending-flag transition), so the card appears as soon as
   the prescription exists server-side even if workout-data's `aiPrescriptionPending` flag lags.

### Verification (sandbox)
`tsc` + lint clean; `/workout` + all four health detail pages render 200.

### NOT verified (device-gated)
- The **prescription-card refresh** (#3) only exercises its real path on an `ai_dynamic` program with
  a live Gemini generation — still needs an on-device confirm on the next workout. If it still fails,
  the next diagnostic step is Railway logs for whether `/prescribe` succeeds and whether
  `aiPrescriptionPending` ever clears (the fix assumes generation succeeds; a failing generation is a
  separate issue).
- Role-pill colours + the detail-card bars render in-sandbox but the pixel look on the S25 (both
  themes) is unconfirmed.
