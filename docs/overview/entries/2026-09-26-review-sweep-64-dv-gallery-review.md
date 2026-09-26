# 2026-09-26 — Review sweep 64: reading DV's design gallery from the phone

**Branch:** `review/sweep-64-dv-gallery-review` · **Agent:** Review · **Docs only.**

- **Read 28 of DV's 75 device captures,** and its P24–P40 measurements.
- **Filed RV-216 to RV-220.** RV-216, RV-217 and RV-218 need Lane A for their data half.
  - RV-216: Home's 111-day streak against More's best streak of 49, from two `computeStreak`
    functions.
  - RV-217: the Sleep contributors show raw keys (`hrv`/`hr`/`schedule`) because of a missing
    `CONTRIBUTOR_KEYS` mapping.
  - RV-218: four calorie numbers across two screens, and "205 workouts" that means 205 kcal.
  - RV-219: Day's "0 kg" bodyweight lift and truncated names.
  - RV-220: DV's capture faults. A Health set caught the launcher, and several scrolls never
    moved.
- **Amended RV-208, RV-211, RV-212 and RV-214** with device evidence. Two sweep-63 items were
  corrected: the white dialog primary is not a one-off, and "Dumbbell" is an icon-name fallback.
- **DV's numbers retire three worries:** scroll, keyboard occlusion and tap latency are fine on
  the phone.

Write-up: `docs/reviews/2026-09-26-sweep-64-dv-gallery-review.md`.
