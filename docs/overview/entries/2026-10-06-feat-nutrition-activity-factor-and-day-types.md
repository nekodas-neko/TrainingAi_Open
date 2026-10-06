# The measured activity factor is exposed; the past-day plan variant was not built

**Branch:** `feat/nutrition-activity-factor-and-day-types` · **2026-10-06** · #2208 (LB-50) shipped ·
#2121 (LB-195) left out

## #2208 — the activity factor

The prompt half was already fixed on 2026-09-02 and still holds on `main`: the baseline line no longer
names the activity level, and the prompt says the TDEE is BMR × 1.2 with no multiplier.

The factor half is new. `computeEnergyBalance` now returns `maintenance.activityFactor`:

- `calibrated` — `maintenance / bmr` over the calibration window, **null until the calibration clears
  its gates**. It never falls back to a formula figure.
- `measuredMovement` — `(formula resting base + average daily movement) / bmr` over the 28-day movement
  window. It uses the formula-path resting base on both paths. On the calibrated path `restingBaseKcal` is
  derived from the maintenance itself, so using it would just return the calibrated factor.
- `gapMessage` — the same reason `maintenance.gapMessage` carries ("Log food on 10 more days to
  calibrate").

The arithmetic is `activityFactor()` in `packages/shared/src/nutrition/adaptive-tdee.ts`. Nothing renders
the factor yet; BF-102's picker is the consumer. **It is additive: no stored or displayed target, budget
or balance moves, so 0 past days change.** The coach's `getEnergyBalance` tool passes `maintenance`
through, so the coach can now quote the factor. It is a code-computed number and gates nothing.

**Finding, not fixed (a calibration question, not this item's):** TN-29's ceiling input
`measuredMovementMaintenance = formulaBaseline + avgActiveOverWindow` still includes the BF-88 step
credit, which the movement total now also counts. It reads about one credit (~100 kcal for the owner)
high, so the `above_measured_movement` ceiling is looser than intended. Reported on #2208 for the
coordinator to file.

## #2121 — left out, premise stale

The issue says the plan card *"has day chevrons and the plan is rendered for `logDate`"*. On `main` it is
not: `nutrition-content.tsx` mounts `ActivePlanCard` only when `selectedDate === todayStr`, and has done
since the initial snapshot. No past day ever shows a variant, so a per-date answer has nothing to fix.
Showing the plan on past days is a change to the daily-use Nutrition screen and needs the owner's yes
on a mockup first. A first version of the history-backed day type was built and then removed from this
PR.

**Verification gotcha:** the first browser pass appeared to show the plan card on past days. That was
a stale service-worker bundle on `engine.localhost:3020` left by an earlier session. Unregister the
worker and clear `caches` before trusting a dev-server render on a shared origin.
