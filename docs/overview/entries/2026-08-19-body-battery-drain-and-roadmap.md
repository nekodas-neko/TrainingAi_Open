# Body Battery measures how long you wore the ring

**Date:** 2026-08-19 · **Branch:** `tuning/body-battery-exertion-brief` · **Agent:** Tuning 🎶
**Type:** docs-only — diagnosis + design brief · **Filed as:** Q-521

From an owner brief: *"body battery still doesn't seem that good… id like that type of granular
drain."* They were right, and the reason is worse than needing a tune.

## The drain model does not respond to activity

51 days, joined to steps and completed workouts:

| relationship | measured | should be |
|---|---|---|
| `corr(hr_sample_count, total_drained)` | **+0.518** | — |
| `corr(steps, total_drained)` | **−0.153** | strongly positive |
| `corr(steps, end_value)` | **+0.112** | strongly negative |

**The strongest predictor of the battery ending low is how many HR samples were recorded** — how long
the ring was on. Steps are *negatively* associated with drain.

A workout moves the day's end value by **0.6 points**: 50.6 on 37 workout days against 50.0 on 14
without. And the four days that ended at exactly 0 had **828–4,152 steps**, while the 16 days that
cleared the 8,000-step goal did *not* end lower. So today `0` means "you wore the ring a long time",
and the owner wants it to mean "you did everything" — close to opposites.

**Mechanism:** drain is `-DRAIN_RATE × (hrr − REST_THRESHOLD) × dt`, purely HR-driven. With Q-515's
boundary having fallen to ~60 bpm as the owner got fitter, nearly every waking sample drains, and
`(hrr − threshold)` varies far less than wear duration — so drain ≈ rate × time worn. **Q-521 is
downstream of Q-515.**

## Two of the three asks were already done

The owner asked for the same treatment across sleep, activity and battery. They turned out to be at
three different stages, which is worth knowing before building anything:

**Sleep is delivered.** Q-503's calibration already reserves the top: anchors `[88.7,97] [91,99]
[93,100]`, the owner's best real night blends to 91, and the replayed distribution puts **7 of 65
nights (11%) in the 90s**. It doesn't *look* done because stored history is still the old model
(mean 85.3, 27 of 36 nights ≥ 85) — that's Q-501/Q-518, not a scoring gap.

**Activity is specified.** Q-505 already states that hitting every target gives 100, with the
"what if I do too much" question resolved. Unbuilt, waiting on Lane A.

**Body Battery is the genuinely new work.**

## The brief, and the tension in it

Drain proportional to total exertion, normalised against the day's targets so "everything hit" lands
near empty — which is why a workout-only day should leave reserve. Keep the morning anchor, floor at 0,
route overshoot to an overreach signal rather than below empty.

Two constraints the data imposes: **`active_calories` is present on 8 of 51 days** and cannot carry
weight; and normalising to targets means **a fitter person drains less for the same absolute work** —
correct for "did I do my day", wrong for "how depleted am I". The brief chooses the former and that
choice needs writing into the model's comment so it isn't silently reversed.

Stated once, because it will come up: an exertion-scaled battery **cannot also detect overreaching** —
on a target-hitting day the well-recovered and the overreached athlete both read 0. That job belongs to
ACWR, readiness and the illness radar. It arguably resolves Q-276 by making Body Battery explicitly not
a recovery number.

## Not exercised

No code changed, and **no drain model was prototyped or replayed** — the numbers describe the current
model only. n = 51, one athlete, Pearson on daily aggregates; the weak values (+0.112, −0.153) mean
*no relationship* rather than a precise signed effect. **Zone minutes and movement-per-hour were not
pulled or coverage-checked** — they're named because the owner named them, and verifying their
coverage is the first implementation step given what `active_calories` shows. The sleep claim rests on
the distribution recorded in Q-503, not a fresh replay. No causal claim is made.
