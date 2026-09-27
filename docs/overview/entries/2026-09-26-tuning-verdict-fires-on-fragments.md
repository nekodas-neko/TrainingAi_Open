# Tuning — the sleep verdict fires on naps, and the same rows widen the band that judges real nights

**Branch:** `tuning/sleep-verdict-fires-on-fragments` · **2026-09-26** · filed **TN-83**
**Plan:** [`docs/superpowers/plans/2026-09-26-outlier-gated-rating-prompt.md`](../../superpowers/plans/2026-09-26-outlier-gated-rating-prompt.md)

## Why this was checked at all

`TN-81` shipped the same day it was planned (#1697) — the verdict computation, the `sleep_verdicts`
table, the repository methods — and `LA-149` was filed for the wiring. The plan set
`VERDICT_IQR_MULTIPLIER = 0.5` as an explicit guess, tuned toward **4–6 prominent announcements a
month**, with "re-measure once real announcements have fired" written into the source comment. Nothing
had measured it, and once `LA-149` lands the first measurement is the owner reading it.

Running the shipped `sleepVerdictForNight` over 125 real nights (a replica with the multiplier
parameterised was cross-checked against the real function — identical counts, so the sweep is sound):

- **poor 25 · good 10 · normal 61** over 96 judged nights = **10.9 prominent per 30 nights**, about
  twice the intended rate.

That was the expected kind of finding. The poor-night list was not.

## What the flagged nights actually were

```
2026-08-09 [duration+onset+efficiency] dur=0    onset=663  eff=0
2026-08-11 [duration+onset+efficiency] dur=0    onset=762  eff=0
2026-08-22 [onset]                     dur=8.25 onset=-42  eff=96
2026-08-22 [duration+onset+efficiency] dur=0    onset=1064 eff=0
2026-09-26 [efficiency]                dur=0    onset=997  eff=0
```

Onset is minutes from local midnight: **997 is 16:37**, **1055 is 17:35**, **644 is 10:44**. These are
**afternoon naps and failed captures being announced as bad nights** — and note 2026-08-22 appearing
twice, once as a real 8.25 h night and once as a 0 h fragment.

Confirmed against production: **125 rows across 106 distinct dates** (last 120 days: **120 rows, 102
dates, 30 rows under 3 h, 6 at exactly 0 h with efficiency 0**). On every duplicate date the shape is
one real night plus one fragment — `7.92 / 0.00`, `8.50 / 0.00`, `7.17 / 0.08`, `7.42 / 4.75`.
`sleep_sessions` is not one row per night, and the verdict treats every row as one.

## It fails twice, in opposite directions

**False alarms** — the fragment is judged as the night, so the owner is told his sleep was bad on a day
he slept 7.9 hours.

**Desensitised bands** — those same fragments sit inside the trailing-28 window, so a 0 h and a 0.08 h
value drag `p25` down, widen the "normal" band, and make a genuinely short night read as acceptable.

Too loud on artifacts and too quiet on real nights, from one cause. The rate alone understates it,
which is why the rate was the wrong thing to have checked first and the night list was the right one.

## The trap in the sweep

```
0.25 → 16.6    0.5 → 10.9 (shipped)    0.75 → 9.1
1.0  →  8.1    1.5 →  6.6              2.0 →  6.6
```

**Multiplier 1.5 lands inside the 4–6 target and would be wrong.** It reaches the rate by suppressing
real signal while still announcing on fragments, and it takes `good` to **zero** — the entire
"unusually good night" half of the feature disappears. The rate target is a check on a correct
population, never a knob to reach it. Recorded on the entry in those terms, because the sweep makes
the wrong fix look like the cheap one.

## Filed, and it blocks

**`TN-83`**, Lane A, now **#1 in Lane A's READY list**; **`LA-149` is parked on it** (`Needs: TN-83`).
Wiring the announcement first means the owner's first experience of the feature is a false verdict, and
the design depends on him trusting it enough to correct it — `OR-171`'s guard is precisely about him
stopping reading. The fix is night selection, not a threshold: pick one night per date and exclude
sub-threshold fragments from **both** the target and the baselines, then re-measure.

## A correction to Tuning's own plan

The plan's §5 cited *"119 rows for the last 120 days — `duration_hours` on all 119"* as evidence the
inputs were complete. **That count included fragments.** Corrected in the same PR: 102 dates, 30 of 120
rows under 3 h. The conclusion (inputs are sufficient) holds; the completeness figure was inflated by
the exact artifact this entry is about — the measurement that justified the plan had the defect in it.

## What TN-81 got right

Components rather than a composite; signed onset minutes so 23:50 and 00:10 are 20 minutes apart
rather than 1,420; per-component baseline readiness instead of an all-or-nothing gate; a
`modelVersion` stamp so a stored snapshot says which rule produced it; `null` below 28 nights rather
than a guess. Three of those were not in the plan and improve on it. **The rule is sound — it is being
fed the wrong rows.**

## Verification

`pnpm check:rules` — Ran 80 of 80, all passed. `check-backlog-pointers` — 528 entries, no duplicates,
no cycles. The measurement ran against production data through the shipped module; the probe test was
temporary and is not committed. Docs-only, so nothing here is device-gated.
