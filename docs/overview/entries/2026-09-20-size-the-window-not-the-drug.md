# Size the window, not the drug

**Tuning agent · 2026-09-20 · branch `tuning/tn52-correct-the-shift-and-size-windows` · docs-only**

The owner: *"How can we make the tuning dynamic so it works on reta and off reta?"* Answering it
meant correcting the premise first, and the correction is the useful part.

## The physiology moved much less than this agent reported

*"Resting HR +13 bpm, HRV down two thirds"* was repeated several times this week — in TN-46, in PS-44,
in three PR bodies, and in a suggestion that the owner raise it with whoever prescribes for him. It
described **2026-09-16/17 alone**. Window means, 28 pre-dose nights against 14 on the drug:

| | pre-dose | on reta | change |
|---|---:|---:|---|
| resting HR | 52.3 | 56.2 | **+3.9 bpm** |
| HRV | 58.8 ms | 44.6 ms | **−14.2 ms (−24%)** |

The 65 bpm and 19 ms readings were a two-day excursion; both have returned. The real sustained change
is about **a quarter** of what was reported. It is still a genuine shift — +3.9 bpm is 1.2× his own
pre-drug nightly sd — but the inflated version reached him attached to a medical suggestion, which is
the part that mattered to get right.

## Which makes the design answer better, not worse

Measured over 59 pre-drug nights: his nightly resting-HR **sd is 3.15 bpm**, mean night-to-night
change **2.40 bpm**. The Body Battery's charge window is **~6 bpm — 1.9 sd**. The sustained shift is
**1.2 sd**.

**A 1.2 sd shift closed a 1.9 sd window.** It did not need to be a big shift, and illness, a bad
sleep week, detraining or altitude would all have done the same. So "on reta / off reta" is the wrong
axis: the app is not fragile because the owner changed, it is fragile because its windows are narrower
than his ordinary noise.

The same shape has now appeared four times — TN-2's charge window, Q-506's fever threshold, TN-47's
±1.5σ rails, TN-46's circular check-in — and **three of the four had no medication involved when they
broke.**

## Filed as TN-52, three rules

1. **Define a threshold as a quantile of the quantity it gates**, not an offset or a fraction of a
   reserve. *"Below your own 10th-percentile waking HR over 28 days"* cannot close, by construction,
   follows any regime with no flag, and **needs no fit** — which also removes what TN-2 is currently
   blocked on, since its fitted offset needs constants that do not exist outside the Railway runtime.
2. **Size every window in units of the user's own sd and refuse one narrower than ~2 sd.** Arithmetic,
   not judgement. The rule worth writing down even if nothing else is built.
3. **Detect regime changes, not medications.** A changepoint on the baseline is general; the
   medication table then *labels* a regime rather than driving the maths.

With a guard against sweeping: max HR from a maximal test, a fever temperature and anything with an
external clinical meaning must stay absolute, because a quantile of your own distribution can only
say *"unusual for you"*, never *"abnormal for a human"*.

## What was not exercised

Reads of stored production rows in the sandbox. No code changed, no scoring touched, no device, no UI.
Row-scoped to the owner. The physiological figures are window means over ring data, not a clinical
measurement.
