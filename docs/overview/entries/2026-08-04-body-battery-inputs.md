# 2026-08-04 — Body Battery: the three input fixes (Q-57), v4 → v5

**Branch:** `fix/body-battery-inputs` · **Domain:** readiness · **Version:** 1.253.0

## What shipped

| | v4 | v5 |
|---|---|---|
| HRmax feeding HR reserve | `220 − age` = 190 | max of daily corroborated peaks over 90 d = **168** |
| `CHARGE_RATE` | 0.40 /min | **0.20** /min |
| Sparse days | rendered as a confident flat line | `confidence.sufficient`; card shows "Limited data" |

New shared module `packages/shared/src/health/body-battery-inputs.ts` (`resolveBatteryHrMax`,
`batteryConfidence`) with 12 tests. Route reads a 90-day snapshot window instead of today-only.

## The part worth reading: two of the three prescriptions were wrong

Q-57 was written from a review of the stored daily summaries. Before implementing it I replayed the
walk over the **real 41-day HR series** pulled from production (`oura_heartrate`, 2-minute buckets,
same charge/drain formula). That changed two of the three answers.

**1. The three fixes interact, and applying them as written would have over-corrected.** Lowering
HRmax *raises* drain (28.5 → 36.4/day on its own) while cutting `CHARGE_RATE` lowers charge. At the
strengths implied (p95 HRmax + `CHARGE_RATE` 0.13) the result was **11 of 36 days below 20 and 5
floored at zero** — the mirror of the ceiling problem, not a fix. `CHARGE_RATE` shipped at 0.20.

**2. p95 of daily peaks was the wrong statistic.** Q-57 specified it; measured, p95 (157) floored 4
days at zero against 2 for the max (168). The max ships. Each daily peak is already
corroboration-gated where it is written (5 readings), so max-of-peaks is not a single artefact, and
the 90-day rolling window is what stops it ratcheting permanently on one bad reading.

**3. The sufficiency threshold is ~100 samples, not the 200/500 the entry guessed.** Grouped by
waking sample count over 36 days, mean day-span was **8** points below 100 and 25–40 in every band
above. Shipped as a *rate* (6 samples/waking hour) because the same count means different things at
8am and 10pm.

Result: days pinned at the ceiling **14 → 0**, end-of-day mean **71.9 → 49.9**, spread preserved
(sd 29.1 → 27.1).

## Two bugs caught during implementation

- **`getBodyBatteryHistory` returns date-ASCENDING.** Widening the window from today-only silently
  turned `rows[0]` from "today" into "oldest day in the window" — which would have anchored the
  battery on a 90-day-old row. Now selected by date.
- **The card paints first from a cached payload**, so a seed written before this deploy has no
  `confidence` key. Reading `battery.confidence.sufficient` would throw on first paint after
  release. Guarded: absent reads as "not known", which shows no warning rather than a false one.

## What this does NOT do

**It does not validate the model.** End-of-day battery vs next-day readiness is still r = −0.06 over
18 pairs. The constants were chosen for *distributional plausibility* (nothing pinned at either
rail, centred near 50) because there is no outcome to fit against. If the correlation is still
absent after ~2 weeks of v5 days, the question becomes whether end-of-day battery is the right
predictor at all — not which constant to nudge. Written into `docs/body-battery-tuning.md`.

**The anchor is untouched.** All reviewed days anchored on readiness, which itself swings 29–87.
Q-42 is the structural half of that and is still open.

## Not verified

Not exercised on device. The route and card were exercised against `pnpm dev` with a real
credentials session — both HRmax branches (`estimated` fallback with 0 peak days, and `observed`
after seeding 18 days) and the sufficiency flag. The **card's rendering** of the "Limited data"
chip and its explanatory line were **not** visually checked at the S25 viewport, and the local
seeded DB has no HR data so the low-confidence state could not be rendered locally at all.
