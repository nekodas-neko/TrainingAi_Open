# 2026-09-24 — the sleep score's two autonomic terms are one axis

**Branch:** `tuning/sleep-autonomic-collinearity` · **Agent:** Tuning · **Docs-only.**

TN-60 fixed a floor rail in the readiness composite. The obvious next question was whether the sleep
composite has the same one. It does not — it has a different problem, at the other end, and the
measurement that found it is about the model's own geometry rather than its accuracy.

## r = +0.873

Across **60 nights** carrying both terms, `corr(hrv, hr) = +0.873`. Every other pair in the model is far
looser: `hrv`–`total_sleep` 0.559, `hr`–`total_sleep` 0.498, `total_sleep`–`efficiency` 0.681.

`SLEEP_WEIGHTS` gives each of them **14 of 110**, and `sleep-score.ts:20` states the intent outright:
*"Autonomic state (hrv + hr) is now 28 of 110 (25%)."* At r = 0.873 that is one effective axis carrying
25%, not two carrying 12.7% each. The share is what the owner chose; what follows from the collinearity
is that **a single bad autonomic reading moves a quarter of the score** where two independent terms
would have partly cancelled.

## They also go flat together

`hrv` reads exactly 100 on **12 of 60** nights, `hr` on **10 of 60**, and **all 10 of the `hr` ceiling
nights are `hrv` ceiling nights too**. On those, 28 of 110 weight is a constant.

The anchor tables explain it, and the two ceilings are not symmetric. `HRV_RATIO` reaches 100 at a ratio
of **1.35** — 35% above baseline, genuinely rare. `HR_RATIO` reaches 100 at **0.85**, which is its
*first* anchor, so every night at or below 85% of baseline HR scores exactly 100 with no resolution
beyond. One ceiling is a bound; the other is an open plateau.

## What it is not

**This is not TN-60's defect and the entry says so explicitly.** TN-60's rail was demonstrably wrong —
stored history inverted its own ordering. Here the total still discriminates: nights with one railed
contributor average **82.6** (36–94), with two **79.9** (42–92), so railing does not even monotonically
inflate the score. The loss is resolution at the top of one axis.

Full distribution, nights by contributors at exactly 100: 0 → 43 (mean 60.9) · 1 → 12 (82.6) · 2 → 8
(79.9) · 3 → 5 (91.4) · 4 → 3 (95.3) · 5 → 1 (95.0). **29 of 72 nights (40%) have at least one.**

## The recommendation is the small one

Extend `HR_RATIO` below 0.85 rather than touch a weight: one array, cannot reorder any night against
another, and it adds information instead of redistributing it. Then re-measure the collinearity, since
part of the 0.873 is the shared plateau. Weight changes re-score every stored night and would walk into
the same half-applied-history state TN-62 is still waiting on.

## TN-69 — the daytime-stress scalar, third failed validation

Same pass, different metric. `daytime_stress_scaled` drives **61% of Body Battery drain** (TN-55) and
TN-33 recorded that its sign could not be settled from stored data. Three attempts today, all negative:

1. **TN-65's RPE residual** — the new tool. 38 training days, 426 sets: same-day **r = +0.159**,
   previous-day stress against today's residual **r = −0.161**. Two near-mirror magnitudes with opposite
   signs at n = 38 is the shape of nothing. The residual stays the right instrument for scoring work; it
   has nothing to grip here.
2. **Persistence.** Lag-1 over 121 day-pairs: stress **−0.041**, against readiness **+0.361** and sleep
   score **+0.582**. The scalar is independent of its own previous day.
3. **Coherence with the scores.** Over 62 days, readiness **−0.023**, sleep score **−0.003**.

**The one agreement it does show is circular.** Against `stress_high_minutes` r = −0.326 and
`recovery_high_minutes` r = +0.215, both correctly signed — but `daytime-stress-thresholds.ts` defines
those counts as thresholds on *this very series* (`STRESS_HIGH_LEVEL = -0.5`, `RECOVERY_HIGH_LEVEL =
0.5`). Same number, counted differently. That is the trap TN-67 caught in the energy check-in, one
metric over, and it is written down because it looks like external agreement.

The sign convention itself was never the open question — `daytime-stress.ts:72` states *"negative =
below baseline = stressed"* plainly. What is open is whether the series tracks real stress.

**The counter-argument that keeps this short of a verdict:** a stress *exposure* has no obvious reason
to persist day to day, unlike readiness or sleep. So −0.041 alone is not damning, and TN-69 does not
claim the metric is noise. It claims that after three independent attempts nothing supports it, and the
apparent support is circular.

**The useful consequence:** TN-55 cut `STRESS_DRAIN_RATE` 0.20 → 0.020 and called it *"a deliberate
de-weighting of an untrusted input"* — a decision taken on caution. These measurements convert that
caution into evidence. What would actually settle it is a signal collected independently of the ring,
which is the three-week log declined on 2026-09-21; nothing in stored data substitutes.

## TN-1 gains a number

While checking the stress columns: **`chronic_stress_score` is populated on 0 of 129 days**, and
`chronic_stress_contributors` on 0 of 129. TN-1 is in DV's lane awaiting a console read, so the
measurement is written onto it — the value is not wrong or stale, it **has never been produced**, and
the question to carry to the phone is *why has the producer never run* rather than *why is this number
odd*. `resilience_level` beside it is populated on 30 of 129.

## Not exercised

Nothing runs. Read-only `claude_ro` queries, **row-scoped to the owner**, plus source reading. **Not
established:** whether the collinearity is physiological (HRV and overnight HR both index
parasympathetic tone, so 0.873 is unsurprising) or an artefact of both terms being computed from the
same BLE stream — the two look identical from here. And both numbers are **our own** derived outputs, so
this measures internal geometry and is not a validation claim; per TN-67 no external validation of any
score currently exists. `pnpm check:rules` result below. For TN-69 specifically, **not established:** whether the stress
scalar's lack of persistence is a property of stress itself or of the measurement — the two are
indistinguishable from stored data, which is the whole reason three attempts have now failed.
