# Body Battery, measured against production — 2026-08-04

Prompted by the owner: *"the body battery does annoy me its not setup correctly. the start number is
not always good and it doesn't have the drain working well. also the charge needs looking at."*

`docs/body-battery-tuning.md` already describes how to tune this and what to tune it against. This
ran that analysis for the first time, over **19 days** of `body_battery_daily` on the current
constant set (`v4`), via the read-only production endpoint.

**Headline: the constants are not the first problem.** The model's output currently carries no
signal to tune *against*, and three of its inputs are wrong on their own terms — independently of
what the right target turns out to be.

---

> **✅ Implemented same day as v5 — and backtesting corrected two of this review's answers.**
> Read [`docs/body-battery-tuning.md`](../body-battery-tuning.md) §v5 before acting on anything
> below. In short: (1) the fixes **interact** — lowering HRmax raises drain while cutting
> `CHARGE_RATE` lowers charge, and applying both at the strengths recommended here put 11 of 36
> days below 20; `CHARGE_RATE` shipped halved (0.20), not cut ~3×. (2) **p95 of daily peaks was the
> wrong statistic** — the rolling-90-day **max** shipped instead (p95 floored twice as many days at
> zero). (3) The sufficiency threshold is **~100 samples, not 200/500** — mean day-span is 8 points
> below 100 and 25–40 in every band above. F1 stands unchanged: the output still predicts nothing,
> and v5 does not claim to fix that.

## F1 — The output does not predict anything (the tuning doc's own validation fails)

The doc names this the main lever: *"a day that ends heavily drained should depress the next day's
recovery."*

**It does not.** `end_value` on day D vs derived readiness on day D+1, over 18 usable pairs:

> **r = −0.06**

That is noise. Individual days invert outright:

| Date | ended at | next-day readiness |
|---|---|---|
| 2026-07-28 | **12** (nearly flat) | **74** (good) |
| 2026-08-01 | **25** | **77** |
| 2026-07-25 | **62** | **29** (poor) |
| 2026-07-26 | 29 *(zero HR samples all day)* | 83 |

So "tune the constants until the numbers feel right" has nothing to pull against yet. Changing
`DRAIN_RATE` today would be moving a dial with the feedback wire cut.

## F2 — Charge is over-rated by roughly 3×

`CHARGE_RATE = 0.40` points per minute at full rest. Eight hours of rest is

> 0.40 × 480 = **192 points**, against a **100-point** scale.

Any long quiet stretch pins the battery at the ceiling regardless of what the day held. Observed
over 19 days:

- **one day charged 165 points** (2026-07-18) — 1.65× the entire range
- **4 of 19 days hit `day_max = 100`**
- average charge 33.2/day vs average drain 28.7/day

## F3 — Drain tracks how much the ring sampled, not how hard the day was

Sorted by `hr_sample_count`, drain rises almost monotonically with **data volume**:

| HR samples that day | drain |
|---|---|
| 0 – 200 | 0, 0, 1, 6, 10, 33, 53 |
| 1,200 – 2,600 | 22, 37, 39, 49, 52, 70 |

Restricting to days with ≥500 samples lifts average drain from **28.7 → 39.1**.

The ring power-gates its HR sampling — it sleeps when worn-idle and wakes on charger, movement or
sleep (documented in `CLAUDE.md`). So sample count reflects *ring behaviour*, not effort. The curve
is presenting a measurement artifact as physiology.

## F4 — Over a third of days have too little data to draw a curve at all

A day is 1,440 minutes. Of 19 days:

- **7 have fewer than 200 HR samples**
- **1 has zero** — on 2026-07-26 the battery sat at its anchor (29) all day, charged 0, drained 0

The card renders those days with exactly the same confidence as a 2,541-sample day. On the
zero-sample day the "Body Battery" is just the readiness score wearing a different label.

## F5 — HRmax is a population formula, and it is 19–29 bpm too high

`hr_max` is `220 − age` → **187**. Against 36 days of recorded peaks:

- highest HR **ever** observed: **168**
- 95th percentile of daily peaks: **158**

An inflated maximum inflates the *HR reserve*, so every real heart rate reads as a smaller fraction
of it — meaning **drain is systematically under-triggered**. This is item #2 in the tuning doc
("cheap, high impact"); it now has its number.

## On the anchor — "the start number is not always good"

All 19 days on `v4` anchored on **readiness** (only one older `v2` day fell back to the default 50),
so the anchor is faithfully reporting readiness. Readiness itself ranges **29 → 87** across those
days. Two things follow:

1. The anchor complaint is partly a *readiness* complaint, not a Body Battery one.
2. On a low-sample day the anchor is the only thing the user sees all day (F4), which makes a
   volatile anchor far more visible than it would otherwise be.

---

## What to change, and in what order

**Three of these are wrong on their own terms and do not need a validation signal first:**

1. **Use the observed HRmax instead of `220 − age`** — e.g. the 95th percentile of daily peaks over
   90 days, floored so a quiet period cannot collapse it. Directly fixes F5, and is the change the
   tuning doc already ranks highest.
2. **Cut `CHARGE_RATE` so a full day of rest cannot exceed the scale.** Fixes F2.
3. **Gate the card on data sufficiency.** Below a threshold of HR samples, say so rather than
   drawing a confident curve. Fixes F4, and stops F3's artifact being presented as fact.

**One should wait:**

4. **Re-tuning `DRAIN_RATE` against next-day readiness** — not yet. F1 says that correlation is
   currently noise, so there is nothing to fit to. Fixing 1–3 may itself produce a signal, at which
   point the doc's backtest (re-running history from the retained raw HR, no re-collection needed)
   becomes worth running.

**Every change must bump `MODEL_VERSION`**, which exists precisely so pre- and post-tuning rows are
never mixed. The 19 days above are the `v4` baseline to compare against.

## Method

`POST /api/admin/db-query` against production — read-only, owner-scoped. Sources:
`body_battery_daily` (19 rows on `v4`), joined to `oura_daily_derived.readiness_score` on `day + 1`.
Correlation computed over the 18 pairs where both sides exist. No code changed.

One check worth recording as a **non**-finding: the most recent row is dated **2026-08-04**, which
looks like the future-dated-row bug (Q-56) until you check the clock — it was 08:15 on the 4th in
Brisbane when this ran. Today's row, not a future one.
