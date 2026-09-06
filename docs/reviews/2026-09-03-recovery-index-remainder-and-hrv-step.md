# Q-509's remainder is not a trend — and the inputs stepped at the re-key

> **⛔ HALF OF THIS TITLE IS WRONG. Corrected the next day by the agent that wrote it:**
> [`2026-09-04-hrv-ramp-not-step.md`](2026-09-04-hrv-ramp-not-step.md).
>
> **Stands:** `recovery_index_hours` is flat over 58 BLE-era nights (OLS slope −0.0055 h/night,
> r = −0.060). That measurement and its arithmetic are unaffected.
>
> **Refuted:** *"the inputs stepped at the re-key."* The RHR 65.7 → 53.8 and HRV 26.9 → 55.9 figures
> are before/after means across a **monotonic ramp**, which manufactures a step from a trend. Night
> HRV rises 45.5 → 63.0 (+38%) *inside the BLE era*, where no definition change is possible, and the
> weekly series crosses the boundary with no discontinuity. LA-57, filed on this reading, is refuted.
>
> **And the conclusion flips rather than disappears:** candidate 3 does not close as "no
> physiological change to find". A large one happened over exactly these nights and
> `recovery_index_hours` did not respond to it — which corroborates the estimator-bias reading from a
> second direction.

**2026-09-03 · Lane A · read-only production (`claude_ro`, row-scoped to the owner)**

Q-509 had ~0.39 h of its 0.933 h gap left after smoothing (0.487 h), bin occupancy (0.000 h) and
window geometry (≈0.06 h). The review that closed those named candidate 3 — *a real change over the
six weeks* — as the surviving explanation and said the next look goes to ordinary full-length nights.

**Candidate 3's natural reading is refuted, and it took no reconstruction harness to do it.** If the
remainder were a real change accumulating over six weeks, the series would be moving. It is flat.

| `recovery_index_hours`, BLE era | value |
|---|---|
| n, range | **58**, 2026-07-08 → 2026-09-03 |
| first half (29) mean / median | 2.803 / 2.596 |
| second half (29) mean / median | 2.612 / 2.242 |
| OLS slope | **−0.0055 h/night** (−0.165 h per 30 nights) |
| Pearson r | **−0.060** (r² = 0.004) |

Against a per-night sd of ~1.59 h, that is no trend at all. Whatever the remaining 0.39 h is, it was
present from the first BLE night and has not grown.

**This does not refute candidate 3 outright**, and the distinction matters: a change that happened
**at** the re-key and then held would also read flat. What is excluded is a *gradual* six-week
change, which is what "a real change over the six weeks" most naturally means.

## What is at the boundary: the inputs stepped

Testing the step reading directly, on `body_metrics` either side of the 2026-07-07 re-key:

| era | n | mean RHR | mean HRV |
|---|---|---|---|
| Cloud (from 06-10) | 14 | **65.7 bpm** | **26.9 ms** |
| BLE | 59 | **53.8 bpm** | **55.9 ms** |

**HRV more than doubles.** Per night across the boundary:

```
07-02  rhr 64  hrv 31      07-08  rhr 60  hrv 46.5
07-03  rhr 64  hrv 25      07-09  rhr 57  hrv 50.0
07-04  rhr 62  hrv 37      07-12  rhr 58  hrv 50.0
07-05  rhr 61  hrv 39      07-13  rhr 58  hrv 51.0
07-06  rhr 65  hrv 27      07-14  rhr 59  hrv 53.5
07-07  rhr 57  hrv 37      07-20  rhr 56  hrv 56.0
```

Pre-boundary HRV runs **20–39**; post-boundary it sits at **40–56** and never returns. A resting-HR
drop of 12 bpm and a doubling of HRV within days is not physiology — it is two pipelines measuring
differently. `CLAUDE.md` records this exact class already: *"HRV used `Sdnn` instead of `Rmssd`"*.

**Be careful with the RHR half.** It was **already falling before the boundary** — 70 → 61 across
late June — so some of that decline is plausibly real or behavioural, and this review does not claim
otherwise. The **HRV** step is the sharp one, and it is the one coincident with the device change.

## Why this matters past Q-509

`hrv_avg_ms` feeds the readiness composite's `hrvBalance` **and** the rolling personal baseline. A
level shift is eventually absorbed — the baseline is per-user and rolling — but during the weeks it
took to absorb, a Cloud-scaled baseline was being compared against BLE-scaled inputs, which produces
systematically high HRV z-scores. Whether that happened, and over how many nights, is not answered
here.

**The existing input-drift review checked HRV *presence* (18/18 rows), never its *scale*.** That is
the gap this fills, and it is why the step survived six weeks of looking at this area.

## What it means for Q-509

It **strengthens both standing prohibitions**, and neither should be revisited on this evidence:
**do not widen `MEDIAN_WINDOW`**, and **do not move `RECOVERY_INDEX_OPTIMAL_HOURS`**. The entry's own
title — *the input moved, not the physiology* — is now supported by a second, independent measurement
rather than by the anchor-ratio argument alone. Moving a constant to absorb an input-scale change
would bake the change in.

## Method and limits

Two `/api/admin/db-query` reads over `claude_ro.oura_daily_summary` and `claude_ro.body_metrics`. No
frame decoding, no reconstruction harness — deliberately, since the question is about a series rather
than a single night's estimate.

**Limits, stated:** `claude_ro` is row-scoped to the owner, so this is one user. The Cloud-era arm is
**14 nights** against 59, which is thin. Nothing here explains the mechanism of the HRV step — it
shows the step exists and is coincident with the re-key, not which field or filter changed. And
nothing was run on a device.
