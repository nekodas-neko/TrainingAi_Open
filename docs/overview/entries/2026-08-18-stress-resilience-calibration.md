# The last two un-calibrated scores: a threshold pointing backwards, and a score with one value

**Date:** 2026-08-18 · **Branch:** `tuning/stress-resilience-calibration` · **Agent:** Tuning 🎶
**Type:** docs-only — calibration evidence · **Filed as:** Q-507, Q-508

Daytime stress and resilience were the last two scores in the app with no calibration review. Picked
under the owner's instruction to take **only tuning work no other lane holds**.

Both are vendored ports pinned to golden vectors, and both say plainly that their algorithms are not
to be touched. So this measured the two things that *are* ours: the hand-tuned constant sitting on
top of daytime stress, and the inputs we feed the resilience model.

## The stress threshold fires at a sensible rate on the wrong days

`STRESS_HIGH_DAY_THRESHOLD_MIN = 120` raises a stress override that eases the day's prescribed
session. It fires on **4 of 25 days (16%)** — a rate nothing about invites changing.

Those four days average readiness **79.0**; the twenty-one quiet days average **65.0**. The
correlation between high-stress minutes and readiness is **+0.400** — the wrong sign for the decision
it drives. The two genuinely bad days in the set (readiness 37 with a sleep score of 31, and
readiness 29) carry 0 and 30 minutes and never fire.

Exercise does not explain it (19 of 25 are workout days, spread evenly). Wear coverage explains part
of it — high-stress and high-*recovery* minutes correlate +0.304, and both zero-days are zero on both
— but not all: net stress still correlates +0.379 with readiness.

**So the threshold was not touched.** Same shape as Q-506 and the inverse failure: there a constant
sat on a dead input, here on a live one pointing backwards. Moving it would change which good days
get eased, not whether the right ones do.

One thing worth carrying: `STRESS_BUCKET_MS` is 30 minutes, so the value can only ever be a multiple
of 30 and the threshold has **seven** meaningful positions. 120 sits exactly on an atom — `>= 121`
would halve the firing rate. A constant in minutes over 30-minute data is a precision illusion.

## Resilience has emitted exactly one value, ever

Level **5** and granular **5.99** on all 13 rows that have one. 5.99 is the clamp bound — the value
`findGranularResilienceLevel` returns when the computation runs off the top of the scale.

The golden vector produces level **1.0** / granular **1.01**, so the port spans the range and the
pinning is input-driven. The mechanism is that `longTermSleepRecovery` is a **sum** over the window
where its two siblings are weighted means — it replicates a `[N,1] × [N]` broadcast from the `.pt`.
Verified exactly against the golden: `13 × 0.6 + 29.99013 = 37.79013`, which is `out_7` to every
stored digit. Solving the golden's outputs for the recovery weights gives 0.30 / **0.70**, so that
summed term carries most of `longTermRecovery`. Our per-day indices run 0–55.6, so a window sum lands
near 130–240 against the golden's 37.79 — above every band boundary, every day.

**The golden cannot catch this**, and that is the lesson worth keeping: its list is 13 *identical*
values of 0.6, two orders of magnitude below production. A golden proves a port computes the same
function; it says nothing about whether the inputs are on the scale it was captured at.

It is dormant too: 13 rows on 2026-08-05 and the same 13 today, newest dated 2026-08-05, while
daytime stress grew 11 → 25 over the same stretch. The daily-index gate is the likely cause (12 of 96
rows carry one, in clusters) but that was **not confirmed** — `/api/admin/db-query` began returning
`Forbidden` to every query, trivial ones included, before the per-gate coverage could be pulled.

## Deliberately not done

Neither constant was changed and no algorithm was touched. Whether the sum is faithful to the vendor
or a porting bug **cannot be settled in this repository** — the vendor source is in the private
archive — and that decision gates the fix, so it is stated as the first action rather than guessed.
The odd behaviour of `resilience_daily_sleep_recovery` (sleep score 93 → 0.0, while 31 → 17.3) is
recorded as an observation with a suspect, not as a diagnosis.

## Not exercised

Nothing on-device; no code changed. The resilience model was **not replayed** against production
inputs — the 130–240 figure is arithmetic from stored indices and golden-inferred weights, and the
private constants needed to run it are not in the sandbox. The stress finding is **n = 25**, where an
r of +0.40 sits near the conventional significance boundary; the group means are the durable part.
All 13 resilience rows predate the sleep recalibration, which feeds this model — so it must be
re-measured once Q-501's stored-row problem clears. Every figure is the owner's (`claude_ro` is
row-scoped).
