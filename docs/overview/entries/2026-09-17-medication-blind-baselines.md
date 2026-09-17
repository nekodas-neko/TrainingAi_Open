# The medication the scorers cannot see

**Tuning agent · 2026-09-17 · branch `tuning/tn46-medication-blind-baselines` · docs-only**

Following the HRV collapse TN-45 surfaced, the owner offered a cause: *"Id imagine its due to the
retatrutide"*. He is right, and the app had the evidence the whole time.

`supplements` holds **Retatrutide, 10 mg, `started_on` 2026-09-06, active**. Nightly vitals:
resting HR **52.3 → 57.7** and HRV **58.9 → 39.1**, comparing the 27 nights before with the 9 after.
Per night the divergence begins **2026-09-09**, three days after the first dose, and accelerates to
`rhr 64.9 / hrv 19` by 09-17.

**The finding is not that a drug moved his vitals. It is that the system cannot tell**, in two ways:

1. **No scorer reads `started_on`.** The illness radar, readiness's HRV-balance and resting-HR
   contributors and all six baselines are blind to the row that explains the move. The `watch` band
   fired on 09-16 and the app's own wording for it is *"may be fighting something"* — an infection
   framing for a pharmacological effect whose start date it stores.
2. **The baseline will absorb it and then report normal.** `updateBaseline` moves ~1/32 per night
   once mature, so the resting-HR baseline is being dragged toward 65 and HRV toward 20. Within
   **30–60 nights every z returns to ~0** — `watch` stops firing, readiness recovers, nothing
   physiological has improved. A baseline-relative system cannot see a sustained shift; it redefines
   normal and goes quiet, and the recovery looks like progress.

Filed as **TN-46**, `Gate: owner`, with four options and a recommendation: annotate the period from
the medication table rather than correct for it. Cross-linked from TN-45 (which constrains the copy
— name what moved, never imply infection) and PS-44 (whose strap week now discriminates between two
live hypotheses: if both instruments show the drop it is physiology, if only the ring does it is
drift).

**The window closes.** The before/after contrast is measurable only while the baseline still
remembers the old normal.

## What was not exercised

Read-only queries against stored production rows, row-scoped to the owner. No code changed, no
scoring touched, nothing run on device. The physiological reading is an observation about data in
the app, not a clinical judgement — noted in the entry alongside the suggestion that a sustained
resting-HR rise is worth raising with whoever prescribes and monitors it.
