# Comparing the three devices — what can honestly be matched, and how

_Written 2026-08-26 alongside the Colmi connector (PS-8). The owner now wears up to three sensors,
and the point of the Colmi is comparison, so this is the reference for doing it without producing
confident nonsense._

**Related:** [`2026-08-26-alternative-ring-colmi-testing.md`](superpowers/plans/2026-08-26-alternative-ring-colmi-testing.md)
(the connector) · [`device-agnostic-source-architecture.md`](device-agnostic-source-architecture.md)
(raw-capable vs computed) · `GET /api/admin/device-comparison` · `lib/health/device-comparison.ts`

---

## 1. The three devices are not three of the same thing

| | **Polar H10** | **Oura Ring 5** | **Colmi R09** |
|---|---|---|---|
| How it measures HR | **electrical (ECG)** | optical (PPG) | optical (PPG) |
| Where | chest | finger | finger, other hand |
| HR cadence | ~1 Hz + beat-to-beat RR | 5-minute bins | log interval, **5 min at finest** |
| Worn | during workouts | all day | all day |
| Also gives | RR intervals, accelerometer | sleep stages, temperature, steps | sleep stages, **skin temperature**, SpO2, HRV, stress, 15-min activity |
| In this app | `oura_heartrate` source `chest_strap` | `oura_heartrate` source `ble` | `colmi_readings` |

**Only the H10 is ground truth.** It measures the electrical signal the heart actually produces.
Both rings infer heart rate from light bouncing off tissue, which is a different physical quantity
that usually correlates. So:

- **ring vs ring** tells you the two disagree. It cannot tell you which is right.
- **ring vs strap** tells you which is wrong.

Any conclusion of the form "the Colmi is accurate" that rests only on ring-vs-ring agreement is
unsupported — two optical sensors on two hands can be wrong together, and for the same reasons
(poor perfusion, cold hands, motion).

---

## 2. Bucket to the coarsest cadence — this is the mistake that looks like data

Both rings sample every 5 minutes at best; the strap emits every second. Align them on a 1-minute
grid and the two rings coincide only when their phases happen to line up, so the pair reports
`overlap: 0` and every statistic comes back null. **That reads as "they never agreed" when it
means "they were never compared"**, and it is the single easiest way to draw a wrong conclusion here.

`bucketSeries(rows, minutes)` anchors windows to the epoch so every device lands on the same grid
regardless of when it sampled. The endpoint defaults to **5 minutes** and reports `bucketMinutes`
back, because every `overlap` is a function of it.

| comparing | bucket |
|---|---|
| ring vs ring, resting HR | **5 min** (their native floor) |
| ring vs strap, during a workout | 1 min — the ring is the limit, and finer shows its lag |
| whole-day trend | 15–30 min |
| daily totals (steps, sleep) | the day itself, not a time grid |

---

## 3. Per-metric: what matches, what does not

### Heart rate — comparable, with a caveat about *when*

Both rings under-report during movement (PPG hates motion) and agree best at rest. **Compare resting
and sleeping HR first**; a workout comparison mostly measures which ring copes worse with motion,
which is worth knowing but is a different question.

Expect the strap to lead both rings on a fast change: optical HR at a finger lags a rate rise by
seconds, and a 5-minute bin turns a lag into a whole missing bucket. A ring reading low during the
first minutes of an interval is expected, not a fault.

### HRV — **do not compare the numbers directly**

The H10 gives beat-to-beat RR, from which rMSSD is computed exactly. Both rings report a
vendor-derived HRV on their own schedule (the Colmi every 30 minutes) by an undocumented method.
These are not the same measurement and there is no reason for their magnitudes to match.

**Compare the trend, not the value** — do they move together night to night? A correlation is
meaningful; a mean absolute delta in milliseconds is not.

### Steps and distance — the hand matters more than the device

A finger step counter reads materially differently on the dominant hand. **Swap the rings between
hands halfway through the trial**; without that, a step-count difference cannot be attributed to the
device rather than the hand. Distance is steps × an assumed stride and inherits everything above
plus a stride assumption that is probably not yours.

### The 15-minute activity rollup

`0x43` returns per-15-minute buckets of **steps, calories and distance**. Read from the packet as
year/month/day (BCD), a quarter-of-day index 0–95, then calories, steps, distance as little-endian
u16s.

**There is no MET field.** Calories is the MET-analogue — MET is essentially calories per kilogram
per hour, so calories per 15 minutes is the same information once bodyweight is known. If a MET-like
number is wanted, derive it from calories and bodyweight rather than looking for it in the packet.

> **We are finer-grained than the reference client here.** Gadgetbridge computes the hour as
> `value[4] / 4` and then sets minutes to zero, collapsing all four quarters of an hour onto the
> hour — so its four samples overwrite each other and it effectively stores hourly activity.
> `resolveActivityBucket` keeps `(quarterHour % 4) * 15`, so we keep all four. Worth knowing before
> anyone "fixes" our version to match theirs.

### Sleep — compare the shape before the stages

Both rings report light/deep/REM/awake spans. **Stage agreement between consumer devices is
generally poor**, and neither vendor publishes its method. What is comparable and useful:

1. **bed time and wake time** — usually close, and a real disagreement is a real finding
2. **total sleep duration**
3. **stage proportions** across a fortnight, as a trend

Per-night stage-by-stage matching is not a fair test of either device.

The Colmi reports a session as `daysAgo` plus minutes after that midnight, and a session starting
before midnight comes back as a start minute *greater* than the end minute. `resolveSleepWindow`
handles that; the important consequence for comparison is that **a night belongs to the day it
started in**, which is how it is stored, and how the other devices' nights must be keyed to line up.

### Skin temperature — the Colmi's alone

Half-hourly, `raw / 10 + 20` °C. **No other device you own reports it.** It has nothing to be
compared against, which makes it the one metric here where the Colmi is not a second opinion but the
only opinion. Treat absolute values with suspicion and the night-to-night *deviation* as the signal —
the same way the Oura's temperature deviation is used.

### SpO2 — hourly min/max, no reference

Comparable against nothing you own. Note the ring reports a min and a max per hour, not a mean; the
storage keeps both (`value` = min, `value_high` = max).

---

## 4. Confounds to record before the trial, not after

- **Which hand each ring is on**, and **swap at the halfway mark**. Contralateral is fine for HR,
  HRV and sleep; it is not fine for steps.
- **Fit.** A loose ring produces optical noise indistinguishable from a bad sensor.
- **Firmware, at both ends of the trial.** A silent mid-trial update splits the data across two
  devices — the same `model_version` trap `CLAUDE.md` already documents for scores.
- **Which automatic measurements were switched on.** A metric whose switch was off recorded nothing,
  and an empty history looks exactly like a ring that was not worn. The sync reads them back and the
  pairing card shows them.

---

## 5. How long before believing anything

**14 nights minimum**, and split the analysis by anything that changed mid-trial. `CLAUDE.md`
records a documented false conclusion in this project drawn from a pooled correlation across four
model versions, where the honest per-version signal was n = 11. The same failure is available here
in two flavours: pooling across a hand swap, and pooling across a firmware change.

Report `overlap` alongside every statistic. A mean absolute delta over 6 buckets is not a finding.

---

## 6. Reading the endpoint

`GET /api/admin/device-comparison?from=&to=&bucket=` (admin only, ≤30 days).

- `coverage` — buckets each device reported. **Read this first**: it is the denominator for
  everything else, and a device with near-zero coverage was not being compared.
- `pairs[]` — for each unordered pair: `overlap`, `meanAbsDelta`, `maxAbsDelta`, `meanBias`.
- **`meanBias` is separate from `meanAbsDelta` on purpose.** A device reading 5 bpm high all day and
  one alternating ±5 have identical mean absolute error and are different faults: the first is
  calibration and correctable, the second is noise and is not.
- A pair that never overlapped returns `null`, not 0 — 0 would read as perfect agreement.
- `truncated` — the row table is capped; the statistics are computed over the whole window first.
