# The Body Battery charge window has closed — 2026-08-24

*Tuning · production data pulled 2026-08-24, ring data current to that morning. Filed as
[`TN-2`, `TN-3a`, `TN-3b`, `TN-4`](../implementation-backlog.md). Propose-only: no scoring change is
implemented here.*

**Every count below is the owner's account only** — `claude_ro` views are row-scoped to one user —
and `error_events` prunes at 30 days. Written as "the owner's, recently", never "the system's".

## What prompted it

Two owner questions in one message: *"How is daytime stress going? Is it a real number we can see?
Could we show it on the HR graphs?"* and *"body battery… its 9:19pm here and its already at looks
like its been 0 for awhile"*.

## 1. Daytime stress is real, and already on screen

Populated on **31 of 31** days. The daily aggregate is compressed — mean **0.007**, sd **0.100**,
range **−0.14 … +0.23** on a [−1,+1] scale — but the underlying bucket series is not: **22 of 31
days** carry high-stress minutes, mean **50/day**, max **180**.

So the *day* number is close to useless on its own and the *bucket* series carries the signal. That
distinction is the whole of TN-3a.

`components/body-battery/stress-strip.tsx` already renders today's series as a sparkline inside the
Body Battery card, with a High/Elevated/Calm/Recovering label and "high ~N min today". The owner did
not know it existed, which makes this a discoverability finding as much as a data one.

**It is not recorded per bucket.** `summarizeStressDay` reduces the series to three daily scalars and
only those reach `oura_daily_derived`. The bucket series lives in the `/api/body-battery` response
for today, wake → now, and is then discarded. No hour-of-day question can be answered from storage.

## 2. The battery floors because the charge window is unreachable

Charging requires `HR ≤ restingHr + 0.05 × (hrMax − restingHr)`. Today that is **57.8 bpm**.

| | |
|---|---|
| 5th-percentile waking HR, August | **62 bpm** |
| Median waking HR, August | **86 bpm** |
| Waking **time** able to charge, 2026-08-24 | **0.5%** |
| Charge ceiling, 2026-06-30 → 2026-08-24 | **73.2 → 57.8 bpm** |
| Points charged/day, peak 2026-07-18 → last week | **165 → 0–6** |
| Days ending at 0 | 7 of 56; **5 of the last 8** |

Today: anchor 57, charged **1**, drained **79**. At the median waking HR the drain is ~8.8 pts/hour,
so a 57-point anchor empties in 6.5 hours — awake ~6am, floored ~12:30pm, flat until 9:19pm. The
report matches the arithmetic exactly.

### Both causes are the data being correct

Resting HR fell **67 → 52** (a real fitness gain) and `hrMax` fell **187 → 168** on 2026-08-05 when
observed-peak resolution replaced the age estimate. The ceiling `rHR + f × (hrMax − rHR)` shrinks
from both ends. At `f = 0.05` the offset above resting HR is **5.8 bpm**, and waking rest sits
roughly 10–18 bpm above sleeping rest — so the boundary is unreachable while awake by construction,
and gets worse as fitness improves.

This is **Q-515's** mechanism with a visible consequence. Q-515's conclusion holds unchanged: the
constant is not the lever, the anchoring is.

## Method note — a per-sample percentile is not a per-time percentile

The first pass measured the offset between waking p05 HR and resting HR per day and found it
unstable: mean +4.6, **sd 5.6**, range −5 … +20. That instability was an artefact. It tracks sample
count — days with ~150 samples read offset ~0, days with ~5,000 read ~20 — because the ring
power-gates its PPG when worn and idle, so samples are not uniformly spaced in time.

Re-measuring **weighted by inter-sample gap** (capped at the route's own `SAMPLE_CAP_MIN = 7`)
changed the headline number by an order of magnitude: the current ceiling covers a median **1.6%** of
waking *time* in August, not the ~20% a naive per-sample count suggests.

**Any future percentile or coverage measurement on this HR series must be time-weighted.** This is
the same class as the `moveHours` / `zoneMinutes` coverage traps already recorded — an input that
looks present and variable can still be measured against the wrong denominator.

## 3. Fitting the replacement

Replay validated before any counterfactual, per the standing rule: modelled end-of-day distribution
**48.7 / sd 31.6** against stored **48.5 / sd 30.4**, mean absolute error **13 pts** over 56 days.
The residual is mostly the wake-time approximation (fixed 06:00–22:00 window rather than the night's
recorded end) and the omitted stress term.

Sweeping an explicit bpm offset above resting HR:

| offset | mean end | sd | days @0 | days @100 |
|---|---|---|---|---|
| +6 bpm (≈ status quo) | 48.4 | 31.3 | 6 | 1 |
| **+8 bpm** | **58.3** | **32.4** | **4** | **7** |
| +10 bpm | 67.4 | 31.6 | 0 | 15 |
| +12 bpm | 75.0 | 28.2 | 0 | 21 |
| +14 bpm | 81.7 | 24.7 | 0 | 24 |
| +16 bpm | 87.0 | 21.0 | 0 | 33 |
| stored | 48.5 | 30.4 | 7 | 1 |

**+18 bpm was tried first and is wrong** — mean 90.8, sd 17.0, nothing floored, a third of days
pinned at 100. Recorded because "it floors too often" invites exactly that overshoot, and a tank
that is always full carries no information (the Q-57 lesson, already in the route's own comments).

**The replay omits `STRESS_DRAIN_RATE`**, which the shipped route applies on top and which fires on
~50 stress-high minutes/day. Real ends land below this table, so the bracket is **+8 … +12** and the
fit belongs against the shipped TypeScript, not against these numbers.

**Rejected: a percentile of the owner's own waking HR.** Stable by construction, so charge goes
near-constant and a genuinely restful day stops reading as one — the treadmill removed from the
activity-goal volume lane in Q-190.

## 4. An unexplained outage that stopped by itself

`daytime-stress: constants not set`, **31 × HTTP 500 on `/api/body-battery`** between 10:37 and
20:59 UTC on **2026-08-23**, then nothing. `buildDaytimeStressSeriesFromModel` is called at
`route.ts:248` outside any try, so the throw reaches the outer catch and the **entire Body Battery
card** was down, not just the stress strip. `ensureServerOuraConstants()` runs at boot from
`instrumentation-node.ts:147`, so these are requests served without that having completed.

Nothing fixed it; it stopped. Recorded as unexplained (TN-4) — the `error_events` row disappears on
2026-09-22.

## Failure surfaces not exercised

Everything here is SQL against production plus source reading. **No code was run**: no `pnpm dev`, no
device, no APK, no native path, no offline path. The replay is a re-implementation of the route's
arithmetic in SQL and agrees with stored values to 13 points mean absolute error — it is evidence for
a proposal, not a substitute for fitting against the shipped TypeScript.
