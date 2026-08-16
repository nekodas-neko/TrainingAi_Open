# Body Battery — tuning the model against physiology

Body Battery (`app/api/body-battery/route.ts`, `components/body-battery-card.tsx`)
is computed **on read** from the per-minute Oura heart-rate series. The *shape* of
the curve is physiologically grounded (it tracks real HR relative to resting HR),
but the **rate** constants were chosen by feel, not calibrated:

```
REST_THRESHOLD = 0.05   // HR reserve at/under which the tank charges
CHARGE_RATE    = 0.40   // battery points / min at full rest
DRAIN_RATE     = 0.60   // battery points / min per unit reserve over threshold
```

This doc records what we capture so the model can later be tuned from *feel-based*
to *body-based*, and how to run that analysis.

## What we already record (enough to tune retrospectively)

| Signal | Where | Use in tuning |
|---|---|---|
| Per-minute heart rate | `oura_heartrate` (timestamp, bpm, source) | **Raw input** — lets us *recompute* the battery for any past day with new constants (backtesting), no re-collection needed |
| Resting HR + HRV, daily | `body_metrics.resting_heart_rate`, `hrv_ms` | RHR feeds the HR-reserve calc; next-day HRV is a **validation target** |
| Readiness / sleep / activity scores + daily stress | `oura_daily` (`readiness_score`, `stress_high`, `recovery_high`, …) | Next-day readiness is the primary **validation target**; Oura stress is a cross-check |
| Sleep sessions | `sleep_sessions` | Wake time (anchor timing), overnight recovery context |
| Subjective energy / soreness | `mood_logs` (energy level, sore muscles) | **Subjective ground truth** to correlate against |
| **Daily Body Battery snapshot** | `body_battery_daily` (migration 100) | The model's *output* + the exact inputs/constants that produced it |

### The `body_battery_daily` snapshot (added for this purpose)

Written through on every `GET /api/body-battery`, so the last read of each day
becomes that day's end-of-day record. One row per `(user_id, date)`:

- `anchor`, `anchor_source` — opening value (morning readiness) and its source
- `end_value`, `day_min`, `day_max` — the day's trajectory
- `total_charged`, `total_drained` — energy in/out over the day
- `resting_hr`, `hr_max` — the inputs to the HR-reserve calc that were actually used
- `hr_max_observed` — the real peak HR seen that day (for HRmax personalisation, below)
- `hr_sample_count` — how much HR data backed the curve (data-quality flag; low = unreliable day)
- `model_version` — constant signature (e.g. `v1:rest0.05:chg0.4:drn0.6`). **Partitions rows by constant set so pre/post-tuning data is never mixed.** Bump it whenever the constants change.

## How to tune (best → worst proxy)

### 1. Validate against next-morning readiness / HRV (the main lever)
Hypothesis: *a day that ends heavily drained should depress the next day's recovery.*

- Join `body_battery_daily.end_value` (and `day_min`) for day `D` against
  `oura_daily.readiness_score` and `body_metrics.hrv_ms` for day `D+1`.
- If days you end low still produce high next-day readiness → **drain is too aggressive** (lower `DRAIN_RATE`).
- If you bottom out at 60 every day while HRV quietly trends down → **drain is too gentle** (raise `DRAIN_RATE`).
- Because raw HR is retained, you can **re-run the whole history with candidate constants** and pick the set whose `end_value` best correlates with next-day readiness — a proper backtest, no waiting.

### 2. Personalise the HR inputs (cheap, high impact)
`hr_max` is currently `220 − age` (a population formula, often ±10–15 bpm off).
`hr_max_observed` captures the user's real peak. Once a credible personal max is
established (e.g. 95th percentile of observed HR over 90 days), feed it into the
reserve calc instead of the formula — this aligns the drain curve with the
actual heart, the single biggest accuracy win.

### 3. Subjective check
Correlate `end_value` / `day_min` with `mood_logs` energy. Catches gross
mis-calibration the data alone won't.

### 4. Oura stress cross-check
Does a day the battery flags as heavy-drain also show high `stress_high` minutes
in `oura_daily`? Persistent disagreement means the drain trigger is off.

## ✅ The analysis has now been run — 2026-08-04

Full evidence: [`docs/reviews/2026-08-04-body-battery-measured.md`](reviews/2026-08-04-body-battery-measured.md).
Queued as backlog **Q-57**. The short version, because it changes what this doc tells you to do:

- **Analysis #1 (the "main lever") FAILS.** `end_value(D)` vs next-day readiness came out at
  **r = −0.06** over 18 pairs. The hypothesis at the top of that section — that ending drained
  depresses next-day recovery — does not hold in this data. **So do not start by tuning the
  constants; there is nothing to fit against yet.**
- **Analysis #2 (personalise HRmax) is confirmed and quantified.** `220 − age` gives 187; the real
  peak across 36 days is 168 and the p95 of daily peaks is 158. Drain is systematically
  under-triggered. Take this one first.
- **Two problems this doc did not anticipate**, both wrong regardless of the tuning target:
  `CHARGE_RATE` is ~3× over (8h of rest = 192 points against a 100-point scale; one day charged
  165; 4 of 19 days pinned at the ceiling), and **drain currently tracks HR *sample count*, not
  effort** — 7 of 19 days have fewer than 200 samples and one has zero, and the card renders those
  with full confidence.
- The last caveat below (**"`hr_sample_count` low ⇒ exclude that day from tuning"**) turned out to
  be the finding, not a footnote: it is more than a third of days, and the *product* needs to
  exclude them too, not just the analysis.

## ✅ The three input fixes shipped — 2026-08-04, `MODEL_VERSION` v4 → v5

Q-57 implemented. **The 36 `v4` days are the baseline; do not pool them with v5 rows.**

**What shipped:**

| | v4 | v5 |
|---|---|---|
| HRmax feeding reserve | `220 − age` = 190 | max of daily corroborated peaks over 90 d = **168** |
| `CHARGE_RATE` | 0.40 /min | **0.20** /min |
| Sparse-day handling | none — rendered as a confident flat line | `confidence.sufficient`, card says "Limited data" |

**Backtested, not reasoned.** Every candidate was replayed over the real 41-day HR series pulled
from production (`oura_heartrate`, 2-minute buckets), walking the same charge/drain formula. Across
the 36 days that have a `body_battery_daily` row:

| | charge/day | drain/day | end µ | pinned at 100 | ended >80 | ended <20 |
|---|---|---|---|---|---|---|
| v4 (190, 0.40) | 41.2 | 28.5 | 71.9 | **14 / 36** | 18 | 2 |
| v5 (168, 0.20) | 18.3 | 36.4 | 49.9 | **0 / 36** | 7 | 6 |

**Two corrections to what the section above told you to do — both found by backtesting:**

1. **The three fixes interact, and applying them as written would have over-corrected.** Lowering
   HRmax *raises* drain (28.5 → 36.4 on its own) while cutting `CHARGE_RATE` lowers charge. Doing
   both at the strengths the review implied (p95 HRmax + `CHARGE_RATE` 0.13) put **11 of 36 days
   below 20 and floored 5 at zero** — the mirror image of the ceiling problem, not a fix for it.
   `CHARGE_RATE` landed at 0.20 (halved, not cut 3×) for that reason.
2. **p95 of daily peaks was the wrong statistic — the max is used instead.** p95 (157) floored the
   battery at zero on 4 days vs 2 for the max (168). Each daily peak is already corroboration-gated
   where it is written, so the max across days is not a single artefact; the 90-day rolling window
   is what stops it ratcheting permanently.

**And one threshold the review guessed wrong.** It proposed gating on 200 or 500 samples. Grouping
all 36 days by waking sample count, the distance the battery actually travelled in a day was:

| samples | days | mean day span |
|---|---|---|
| <100 | 7 | **8** |
| 100–199 | 7 | 25 |
| 200–499 | 8 | 35 |
| 500–999 | 8 | 27 |
| 1000+ | 6 | 40 |

The cliff is **below 100**, not at 200. The gate ships as a *rate* (6 waking samples/hour, ≈100 over
a 16-hour day) because the same absolute count means different things at 8am and 10pm.

**Note for anyone re-running the analysis:** `body_battery_daily.hr_max` now records the ceiling
the walk **actually used** (the resolved value), not the age estimate — on v4 rows it is the age
estimate, on v5 rows usually the observed peak. Split by `model_version` before comparing.

## Open follow-up

- **[ ] Re-run analysis #1 against v5 once ~2 weeks of v5 days exist.** It failed on v4
  (`end_value(D)` vs next-day readiness, r = −0.06 over 18 pairs) — which is why the constants were
  set from distributional plausibility rather than fitted to an outcome. **v5 has not fixed that
  and does not claim to.** If the correlation is still absent on v5 days, the next question is
  whether end-of-day battery is the right predictor at all, not which constant to nudge.
- **[ ] The anchor ("start number") is still readiness, unexamined.** All 19 reviewed days anchored
  on readiness, which itself swings 29–87. Q-42 (extract the shared readiness composite) is the
  structural half of that.
- Useful real-world data points to collect meanwhile: "on [day] I did [hard session / nothing],
  battery read X at end of day, woke feeling Y / readiness Z."

### Caveats
- End-of-day capture depends on the app being opened during/late in the day
  (write-through on read). A user who never opens the app late will have an
  earlier-than-true `end_value`. A scheduled end-of-day recompute would remove
  this dependency if rigour demands it.
- `hr_sample_count` low ⇒ exclude that day from tuning (ring not worn / not synced).
