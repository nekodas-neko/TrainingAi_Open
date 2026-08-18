# The workouts pillar had never been calibrated, and the thresholds turned out to be the one thing that was right

**Date:** 2026-08-18 · **Branch:** `tuning/acwr-calibration` · **Agent:** Tuning 🎶
**Type:** docs-only — calibration evidence · **Filed as:** Q-512, Q-513

Prompted by the owner asking whether *all* pillars had been tuned against historical data. They had
not. The earlier sweep covered the health/recovery **scores**, and **workouts, heart-rate and cardio
had zero calibration coverage.** This is the first review of the workouts pillar, starting with
`ACWR_THRESHOLDS` because it drives deload decisions.

**One correction to that answer, found while acting on it:** I first listed **nutrition** as
uncalibrated too, citing `DEFAULT_STEP_GOAL 8000` and `SESSION_VOLUME_GOAL_KG 5200` as unchecked round
numbers. That was wrong. Both the strength-frequency goal (Q-137, 91 days) and the session-volume goal
(Q-190, 40 sessions) were carefully fitted to the owner's own data on 2026-08-11, with
[`docs/activity-goal-calibration.md`](../../activity-goal-calibration.md) as the record; the step and
zone-minute goals are deliberate population anchors (Paluch 2022, WHO 150 min/wk) with their reasoning
in the source. The genuinely uncalibrated part of nutrition is narrower: **whether the recommended
calorie target tracks the owner's observed weight change.**

## The thresholds are right

Replaying `computeVolumeAcwr` over 77 completed sessions / 109 days, using the window the
decision-driving caller actually passes: mean **0.99**, median 1.05, sd 0.32, and bands of
Undertraining 18.2% / **Optimal 69.3%** / High 12.5% / Very High 0%.

Centred on 1.0 with a modest tail each side — what the literature says a well-managed athlete looks
like. `{0.8, 1.3, 1.5}` divides it sensibly. Nothing to move.

The emergency deload (`acwr > 1.5`) has never fired; the observed maximum is **1.48**. That is
recorded as clean rather than filed, and the contrast with Q-506 is the point. The illness radar
peaked at 38 against a threshold of 40 and *was* filed — because its input was provably broken. Here
the input is healthy. **A near-miss is a symptom, not a diagnosis; the rule is "check the input
first", not "never touch a threshold that just misses".** And an emergency deload that fires often is
not an emergency.

## Two of the three things computing it are wrong

**`health-insight`'s ACWR is null on 110 of 110 days.** It passes a 7-day session list into a helper
that gates on a 21-day span, measured from the earliest session *in the list it was handed*. A 7-day
list can never span 21 days. Structural, not a coverage problem — the route reads `.acwr` every time
and it is always null.

**The score-audit panel and the engine disagree on the band 38% of the time.** Three callers pass
three windows: 28 days (the engine), 7 days (always null), and **all history** (the audit panel). The
chronic term divides by the span of whatever list it gets, so the audit variant computes *this week
vs the entire training history* rather than vs the last four weeks. Mean 1.07 against 0.99, `high`
share 29.2% against 12.5%, and three days past the emergency-deload line the engine never saw.

The mechanism gets worse with progress: the lifetime weekly average is 20,572 kg against 23,239 over
the last 28 days (1.13×), so the smaller denominator inflates the ratio — and any sustained volume
increase widens that gap indefinitely.

That matters more than a display nit because `build-day-audit` **is** the score-audit panel, whose
whole contract is to show a score beside the inputs that produced it. On 38% of days it shows a
training-load band the engine never used.

## Not exercised

No code changed. **The replay is a faithful port, not the shipped function, and it could not be
validated against a stored value because no ACWR is persisted anywhere** — there is nothing to
reconcile against. That is why §1 is phrased as "the thresholds fit this distribution" rather than
"the shipped code produces these numbers". Volume is `sum(weight_kg × reps)` from `set_logs`; the
bodyweight-load path was not traced and three zero-volume sessions were left at zero. The audit
caller's `programTooNew` gate is not modelled and can null its ACWR independently, so **38% is an
upper bound** on the days the panel renders a band. Nothing on-device; no owner-reported symptom
prompted this. Every figure is the owner's (`claude_ro` is row-scoped).

## Correction

The previous session entry said the Tuning lane was "drained". That was wrong, and the owner's
question caught it: it was drained of *health-score* work. Four pillars with real tunable constants
had never been looked at. The baton now tracks pillar coverage explicitly instead of score coverage.
