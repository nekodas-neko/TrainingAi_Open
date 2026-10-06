# How the scores are built

**2026-10-05**, written for the owner from the code as it stands (the owner asked for "a list of our
tuning/scoring structure"). Every number below is quoted from the file it lives in; when a
weight or curve changes there, this page is out of date until it is changed too.

Three things produce a **0–100 score**: **Sleep**, **Readiness** and **Activity**. Two more
produce something score-shaped but are not weighted models: **Body Battery** (a level that is
walked up and down through the day) and **Heart Rate** (a measurement against your own baseline).
Every score is banded the same way — **High ≥ 70, Moderate ≥ 50, Low below** (`score-band.ts`).

## The shape every score shares

Each score is the same three steps. Knowing which step a problem lives in is most of tuning:

1. **Input → sub-score.** Each component turns a raw measurement (hours of deep sleep, today's
   steps) into 0–100 through a **curve**. *The curve decides what "good" means for that component.*
2. **Sub-scores → score.** A **weighted average**: each sub-score times its weight, divided by the
   total weight. *The weight decides how much that component matters.*
3. **Adjustments** that a weight cannot express: a cap, a taper, a final calibration.

So **score = Σ (weight × sub-score) ÷ Σ weight**, then adjusted.

---

## Sleep — `packages/shared/src/health/sleep-score.ts`

**Weights** (points, total 110):

| Component | Weight | Share | Raw input | Curve: what scores well |
|---|---|---|---|---|
| Total sleep | 24 | 22% | `durationHours` | 8 h ≈ 77 · 9 h ≈ 92 · 10 h = 100 |
| Overnight HRV | 14 | 13% | `averageHrvMs` ÷ your 14-night median | ≥ 1.35× = 100 · at baseline = 70 |
| Overnight HR | 14 | 13% | `avgHeartRate` ÷ your 14-night median | ≤ 0.85× = 100 · at baseline = 70 (lower is better) |
| REM | 10 | 9% | `remSleepHours` | 2 h ≈ 82 · 3 h = 100 |
| Deep | 10 | 9% | `deepSleepHours` | 1.1 h ≈ 77 · 2 h = 100 |
| Restfulness | 9 | 8% | efficiency, minus a penalty for awake fraction | — |
| Efficiency | 9 | 8% | `efficiency` % | 90% ≈ 68 · 98% = 100 |
| Schedule | 8 | 7% | the *worse* of a late bedtime or an early wake vs your habit | on time = 100 · 2.5 h off = 40 |
| Latency | 6 | 5% | `onsetLatencySec` | a U-curve: ~14 min = 90; instant or slow both score lower |
| Timing | 6 | 5% | sleep midpoint vs 03:00 | 03:00 = 95, falling either side |

**Data path.** The ring's raw BLE events are decoded into a night (`sleep_sessions`); stages come
from the staging model, HR and HRV from the ring's overnight samples
([`oura-ble-operations.md`](../oura-ble-operations.md)). The night scored is the main sleep, never
a nap (`sleep-night.ts`).

**Adjustments after the average:**
- **Awake-fragmentation cap.** A night whose awake time is well above *your* normal is capped, from
  100 at 1 standard deviation down to 15 at 4. It only ever lowers a score.
- **Final calibration.** The weighted average squeezes nights together (half of all nights used to
  land in a 6-point band), so a fitted curve stretches the result across 0–100. It was fitted to
  the owner's own nights and would need refitting per person.

**Baselines:** HRV, HR and schedule need 7 prior nights before they are included at all.

**Not scored today:** food timing before bed, caffeine, alcohol, room temperature — nothing the app
records reaches the sleep score.

---

## Readiness — `packages/shared/src/health/readiness-composite.ts`

**Weights** (fractions, total 1.00). Since 2026-10-06 (#2224) the morning check-in is not part of
readiness: its 0.10 was removed and the other eight renormalised over the 0.90 they held, so their
ratios are unchanged. The check-in still tunes the day's session. Rows scored before that carry a
`checkin` term and the model version `v4:…`.

| Component | Weight | Raw input | How it becomes 0–100 |
|---|---|---|---|
| Previous night | 0.178 (0.16 ÷ 0.90) | last night's Sleep score | passed straight through |
| Resting HR | 0.167 (0.15 ÷ 0.90) | z-score vs your baseline (`oura_daily_summary`) | 50 at baseline; lower HR scores higher |
| HRV balance | 0.167 (0.15 ÷ 0.90) | z-score vs your baseline | 50 at baseline; higher HRV scores higher |
| Temperature | 0.111 (0.10 ÷ 0.90) | z-score vs your baseline | 100 at baseline; falls with deviation **either way** (a fever signal) |
| Sleep balance | 0.111 (0.10 ÷ 0.90) | recent sleep duration vs your baseline | 50 at baseline; more scores higher |
| Previous-day activity | 0.100 (0.09 ÷ 0.90) | yesterday's Activity score (before taper) | passed through |
| Recovery index | 0.100 (0.09 ÷ 0.90) | hours from the night's lowest HR to waking | 5 h = 100, linear |
| Activity balance | 0.067 (0.06 ÷ 0.90) | today's Activity score | passed through — still moves through the day; open as #2097 |

**z-scores to points:** 33 points per standard deviation around 50, with the last 20 points at each
end compressed rather than clipped, so the worst days keep their order instead of all reading 0.

**Baselines:** the baseline-relative inputs need 14 nights of history.

**⚠ Missing data is handled differently here than in Sleep and Activity.** A missing input becomes
a **neutral 50** instead of dropping out. No Recovery Index, for example, means a 50 in a 10% slot,
and a missing input pulls the score toward the middle. Sleep and Activity instead drop the component and spread its weight over the rest. The
ingest architecture ([`ingest-and-scoring.md`](ingest-and-scoring.md) §3) shows the two are the
same family and how to unify them by storing the score together with its **coverage**.

---

## Activity — `packages/shared/src/health/activity-score.ts`

**Weights** (points, total 100), in two lanes:

| Lane | Component | Weight | Raw input | Sub-score |
|---|---|---|---|---|
| Daily movement | Steps | 18 | today's steps | % of your step goal, capped at 100 |
| | Active energy | 15 | today's active kcal | % of your goal |
| | Zone minutes | 10 | minutes in HR zone 2+ (vigorous counted double) | % of your goal |
| | Move hours | 12 | hours with movement | % of your goal |
| Strength (rolling 7 days) | Sessions | 25 | sessions in the last 7 days ÷ your weekly goal | curve; the goal = 100 |
| | Volume | 20 | 7-day tonnage ÷ your target | % of target |

Goals come from `daily-goals.ts` and are **absolute**, not "as active as you usually are", so 100
means an objectively good day. Missing components drop out and the rest are re-weighted.

**Adjustment — over-exertion taper.** Once your training load ratio (ACWR) passes its high band, the
score is eased down by up to 15%, so 100 means *optimal*, not *maximum*. Readiness reads the score
**before** the taper, so fatigue is not counted twice.

---

## Body Battery — `body-battery-walk.ts`

Not a weighted score. It starts from a level at waking and is walked through the day: it **charges**
while your heart rate sits near resting, **drains** in proportion to how far above resting it goes,
and drains extra during below-baseline stress. The tuning surface is the rates and the charge
threshold, not weights — `TN-2` is the open question about where that threshold sits.

## Heart Rate — `score-audit/heart-rate.ts`

Deliberately not a score: a measurement shown against your personal baseline. Its tuning surface
is the baseline itself.

---

## Your proposed method, and how it compares

**The proposal:** give each component a value (e.g. *consistent bedtime = 400*), sum them, divide to
see what share of the score each one carries, and tune by raising or lowering the values.

**That is what the weights already are.** Sleep's `schedule = 8` out of 110 is exactly
*"consistent bedtime = 400 out of 5,500"* in different units, and its 7% share is the percentage
you describe. So the method matches; nothing needs rebuilding to adopt it.

**What it does not cover, and why tuning by weight alone would disappoint:**

1. **A weight says how much a component matters, not what "good" is.** Most real fixes have been to
   the *curve* or the *baseline*, not the weight. The 2026-07-25 night scored 80 when you rated it
   terrible; a heavier weight would not have fixed it, because the model had no HR or schedule
   component at all. HRV pinned at 100 on 40 of 44 nights because its baseline was an all-time
   average, not because its weight was wrong.
2. **Averaging squeezes scores together, and more components squeeze harder.** Add a component and
   every night drifts toward the middle. That is why Sleep needs its final calibration step.
3. **Overlapping components count twice.** HRV and HR both measure your nervous system; efficiency
   and restfulness both measure wakefulness. Raising one effectively raises the pair.
4. **Some rules are not weights at all:** the fragmentation cap, the over-exertion taper, temperature
   scoring badly in both directions.
5. **Every change re-scores your history.** A weight change moves past days too, which is why a
   tuning proposal must say how many days it moves.

## What would make tuning simpler — recommendation

1. **One table per score, in one unit: points out of 100.** Readiness uses fractions, Sleep points out
   of 110, Activity points out of 100. Restating all three as points out of 100 makes "this component
   is worth 14 of 100" readable at a glance, which is your model. It is a pure re-expression and
   moves no score.
2. **Show each component's curve next to its weight**, as a few anchor points ("7 h → 62, 8 h → 77"),
   so both knobs are visible together.
3. **One rule for missing data across all three** — the coverage approach in the ingest
   architecture — so Readiness stops treating "no data" as "average".
4. **A "what if" before any change:** edit a weight or an anchor and see how many past days move and
   by how much. That is the check a tuning proposal already owes, done by a tool rather than by hand.

Items 1 and 2 are documentation and display; items 3 and 4 are engineering. All four are tracked
as one issue: #2319.
