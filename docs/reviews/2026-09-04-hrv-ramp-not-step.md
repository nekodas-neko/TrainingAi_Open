# 2026-09-04 — the HRV "step" at the re-key is a ramp, and LA-57 is wrong

**What this corrects:** LA-57, filed 2026-09-03 by this same agent, which concluded *"a doubling
within days is a measurement-definition change, not physiology."* The data does not support it.

## What LA-57 measured, and why the shape misled

It compared means either side of the 2026-07-07 re-key — `body_metrics.hrv_ms` **26.9 (Cloud, n=14)
→ 55.9 (BLE, n=59)** — and noted per-night ranges of **20–39** before and **40–56** after, *"with no
return and no overlap to speak of"*.

Both observations are what a **monotonic ramp** produces when it is cut in the middle. Weekly means
over the same span:

| week | daily HRV (ms) | daily RHR (bpm) |
|---|---|---|
| 2026-06-22 | 21.8 | 68.3 |
| 2026-06-29 | 31.1 | 63.6 |
| **2026-07-06** (contains the re-key) | **41.6** | **58.9** |
| 2026-07-13 | 46.4 | 57.7 |
| 2026-07-20 | 52.9 | 55.0 |
| 2026-07-27 | 59.2 | 52.6 |
| 2026-08-03 | 68.0 | 50.0 |

There is no discontinuity at the boundary. The re-key week sits on the line between its neighbours,
and the series keeps climbing for four more weeks afterwards.

## The measurement that settles it

Night HRV **within the BLE era alone** — one device, one decoder, where a definition change is not
possible:

| week | n | night HRV (ms) | min | max |
|---|---|---|---|---|
| 2026-07-06 | 5 | 45.5 | 40.0 | 50.0 |
| 2026-07-13 | 7 | 46.4 | 35.0 | 53.5 |
| 2026-07-20 | 7 | 52.9 | 34.0 | 67.5 |
| 2026-07-27 | 7 | 59.2 | 47.0 | 67.0 |
| 2026-08-03 | 7 | 63.0 | 54.0 | 68.0 |
| 2026-08-10 | 7 | 62.4 | 58.0 | 70.5 |
| 2026-08-17 | 7 | 58.0 | 47.5 | 66.0 |
| 2026-08-24 | 7 | 56.6 | **26.5** | 72.0 |
| 2026-08-31 | 5 | 60.2 | 51.0 | 71.5 |

**+38% inside a single device era**, then a plateau. A change in which statistic is computed produces
a step and a new stable level. It cannot make values keep rising for five weeks under an unchanged
decoder.

**And the ranges do overlap.** LA-57 said there was none "to speak of". The week of 2026-08-24
contains a BLE night at **26.5 ms** — inside the 20–39 band the entry attributed to Cloud-era
measurement.

## What is actually happening

The subject's autonomic markers improved steeply and continuously over about two months: night HRV
+38% within the BLE era, daily RHR 68.3 → 50.0 across the whole window. Over the same period steps
rose (5,618 → 7,558 daily mean) and weight rose 68.35 → 71.45 kg. For a training app whose owner
trains, a large HRV improvement across two months of consistent work is the ordinary reading.

**What cannot be concluded either way:** whether a definition change *also* occurred at the boundary,
underneath the ramp. Nothing here excludes it. What is excluded is the evidence LA-57 offered for it —
pre/post means and non-overlapping ranges — both of which a ramp produces on its own. Establishing a
step under a trend needs the trend modelled and a discontinuity tested against it, and there are only
about two weeks of pre-boundary HRV to fit, which is thin.

## What this does to Q-509

Q-509's remaining question is candidate 3, *"a real change over the six weeks"*. The 2026-09-03 review
refuted its gradual form by measuring `recovery_index_hours` flat over 58 BLE nights (slope −0.0055
h/night, r = −0.060). That measurement stands. Its interpretation needs correcting:

**It is not that nothing was changing. A great deal was.** Night HRV rose 38% and RHR fell 6 bpm
across exactly those nights, and `recovery_index_hours` did not move. So candidate 3 closes in the
opposite direction from "no physiological change to find": there was a large one, and the metric
named for recovery did not respond to it.

That is an **independent line of evidence for the entry's own conclusion** — that the hours estimator
is dominated by something other than physiology, which Q-509 already attributes to the BLE series
being ~2× noisier sample-to-sample. It arrives there without the anchor-ratio argument.

## A caveat I checked and discarded, recorded so it is not re-raised

`oura_daily_summary` (the BLE rollup's own table) holds **no rows before 2026-07-07**, which raised
the possibility that Q-509's Cloud-vs-BLE refit compares *two different estimators* — Oura's cloud
number against our reimplementation — rather than one estimator on two inputs. **It does not.**
`oura_heartrate` carries Cloud-sourced series (`awake`/`rest`/`live`/`workout`) from 2026-06-22 to
2026-07-06 and `ble` from 2026-07-06, so our estimator can and did run on both. Q-509's like-for-like
framing is sound.

## Method and limits

Every figure is from `claude_ro` via the read-only admin endpoint, which is row-scoped to the owner —
so this is one person's data, which is the right scope for the question. Weekly means, no smoothing.
The 2026-07-06 week straddles the re-key and is reported as-is rather than split.
