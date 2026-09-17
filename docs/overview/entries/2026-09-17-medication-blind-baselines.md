# Correlating vitals against dose, and the baseline that is erasing the chance

**Tuning agent · 2026-09-17 · branch `tuning/tn46-medication-blind-baselines` · docs-only**

Following the HRV collapse TN-45 surfaced, the owner named the cause — *"Id imagine its due to the
retatrutide"* — and then the actual ask: *"The idea was to be able to correlate change in vitals
with reta"*.

## A correction this agent had to make first

An earlier draft read `supplements.dose = '10mg'` as the administered dose and remarked that it
looked high against the trial protocols. **That was wrong. 10 mg is the vial strength** —
`supplement_logs` carries `vial_strength_mg 10, vial_water_ml 3, vial_units_per_ml 100`. The real
doses are **0.5 mg on 2026-09-07 and 1 mg on 2026-09-13**, a titration that starts *below* the
published protocols rather than above them. The remark is withdrawn. The trap stays on the entry:
anything reading `supplements.dose` for a dose gets a 20× overstatement, and
`supplement_logs.amount` is the real one.

## The dose-response was already in the data

| date | resting HR | HRV | dose |
|---|---:|---:|---|
| 09-04 → 09-06 | 52.6 / 52.5 / 51.7 | 59 / 50 / 56 | pre-dose |
| **09-07** | 48.4 | 63.5 | **0.5 mg** |
| **09-09** | **56.3** | **39** | peak, 2 days after |
| 09-10 → 09-12 | 53.8 / 55.0 / 54.5 | 43.5 / 49 / 45 | partial washout |
| **09-13** | 55.4 | 48 | **1 mg** |
| **09-16 → 09-17** | **65.1 / 64.9** | **28 / 19** | still falling at day 4 |

Doubling the dose roughly tripled the resting-HR excursion (+4 bpm, then +13) and took HRV from ~55
to 19. A 2–4 day lag to peak, partial washout after the smaller dose, no turn yet after the larger.
**The app holds the doses, holds the vitals, and plots neither against the other.**

## The decision, taken under delegation

Filed as **TN-46**, no gate. Retain a **pre-intervention reference baseline**; annotate, do not
correct.

The live baseline keeps adapting, because freezing it means a permanently depressed score and a radar
crying wolf nightly. But a **snapshot at the intervention date is kept as a reporting reference**, so
the delta stays computable after the live baseline has moved on. `supplement_logs` joins into the
score audit and advisory so a flagged day names the medication and the most recent dose. The overlay
is plotted **with a lag** — a same-day correlation finds nothing on data that plainly shows an effect.

> **⚠ CORRECTED 2026-09-18 — the paragraph below is WRONG, and it was this agent's error.** Lane A
> checked before building and found the pre-intervention baseline is **already on disk**:
> `oura_daily_summary` stores the baselines **per night, per row**, so the 2026-09-06 row still
> carries `rhr_base 52.875 / hrv_base 56.125` and later drift cannot reach back to it. Verified
> independently — 74 rows back to 2026-07-07 and nothing prunes the table. The EMA arithmetic was
> right; the conclusion did not follow, because drift only moves the *latest* baseline. There is no
> erasure, no deadline and no schema change. The sting is that this agent had the evidence in hand —
> it read historical baselines via `lag(rhr_baseline_mean_x8)` to compute the z-scores and still
> argued they were being lost. **The general rule, now in the readiness domain index: a rolling
> aggregate checkpointed per period has no erasure problem however fast it adapts — before adding
> storage to preserve a value, check whether it is already written down with a date on it.** See
> [`lane-a: the baseline was already retained`](2026-09-17-lane-a-tn46-baseline-already-retained.md).
>
> **Also superseded:** the dose-response table ends at 09-17. The 09-18 row reads **RHR 59.4** (from
> 64.9) and **HRV 47** (from 19) — the 1 mg excursion turned at day 5, matching the 0.5 mg washout.
> *"Still falling at day 4"* was true when written and is not current.

**Why the snapshot is urgent.** `updateBaseline` moves ~1/32 per night, so the resting-HR baseline is
being dragged toward 65 and HRV toward 20. Within 30–60 nights every z returns to ~0 — `watch` stops
firing, readiness recovers, nothing physiological has changed, and the recovery reads as progress.
After that, *"what did this do to my vitals"* is no longer answerable from the baselines at all.

Cross-linked from TN-45 (copy must name what moved, never imply infection) and PS-44 (the strap week
now separates real physiology from ring drift).

## What was not exercised

Read-only queries against stored production rows, row-scoped to the owner. No code changed, no
scoring touched, nothing run on device. The physiological reading is an observation about data in the
app, not a clinical judgement.
