# The re-derive nobody ran, and what it would do if they did

**Tuning agent · 2026-09-17 · branch `tuning/rederive-would-fire-fever` · docs-only**

Four owner decisions came back in one sitting, and answering the first one opened the largest
finding of the run.

## The four decisions, recorded

- **TN-45 — surface the illness `watch` band, quietly.** A calm line under the readiness score, not
  a banner. `Gate: owner` lifted. The lane was also wrong: the copy lives in `illnessAdvisory()`
  under `packages/shared`, so it is **Lane A then B**, not Lane B alone.
- **TN-30 — re-pin max HR at 181.** The owner ruled 175 the floor and the age-calculated 187 the
  ceiling, and asked for a number in between.
- **PS-44 — the overnight chest-strap window is on.** Seven nights of strap-and-ring overlap.
- **TN-44 / PS-41 — do not block on a Health Connect tester.** Build against synthetic data; the
  untested surface is recorded as open rather than silently assumed.

## The finding: Q-506's remedy is built, owner-gated, and would misbehave if fired today

`POST /api/admin/rederive-baselines` was built for exactly this defect on 2026-08-24 and has never
been fired. That is deliberate — BF-13's `Keep:` records the run as the owner's to fire, since it
writes production data. What is new is that it has sat a month, and what it would do. The stored
baseline confirms it has not run: temperature's deviation is **166** centi-°C against a true
nightly spread of **10.8** — still **15.4×** too wide, down from 18.7× when Q-506 filed it. Thirty
nights moved it 196 → 166, which extrapolates to about **fifteen more months** of waiting.
Temperature is the only one of five baselines that is wrong; the other four sit inside the normal
range for an EMA deviation.

That dead 40% weight is a complete explanation of TN-45's table. It is arithmetic, not bad luck:
resting HR and HRV **both maximally bad score 39**, one point under `watch`, and stay 39 at absurd
inputs because both saturate. All three non-temperature biomarkers maxed reach **64**, one point
under `elevated`.

**The part to act on:** replaying the fold cold and re-running the real radar per night, a corrected
baseline produces `normal` 51 · `watch` 3 · **`fever` 6** over sixty nights — and **four of the six
fever nights have healthy or neutral HRV**. A corrected deviation of 0.077 °C puts `FEVER_TEMP_Z`
at 0.19 °C above baseline when ordinary night-to-night spread is 0.128 °C. One night scores **37,
below `watch`, and is still flagged `fever`**, because `isFever` short-circuits the thresholds.

So: run it, but re-scale the threshold in the same PR, or the owner gets six fever banners and
25-point readiness penalties on nights he was fine. Working:
[`what the temperature re-derive would do`](../../reviews/2026-09-17-what-the-temperature-rederive-would-do.md).

This does not block TN-45 — under a corrected baseline the two real `watch` days score **61 and 60**
rather than 41 and 36, so the band fires more decisively, not less.

## A correction to my own earlier note

I recorded the 175 bpm reading as coming from "a run". It was the **Cooper test** — `fitness_tests`
holds a `cooper12` on 2026-09-14, 1975 m in 720 s, avg 156, peak 175. That matters because the owner
had explicitly parked the anchor question until the Cooper was done. It was already done when I
wrote that the question was still open.

I also carried "the pinned 178" as the live ceiling. It is not: all 101 cached days in
`daily_zone_minutes` use **187**, the age-predicted value. The 178 is a queued decision that has
never shipped.

## What was not exercised

Everything is a replay against stored production rows in the sandbox. The re-derive route was not
run, not even in `dryRun`. No device, no APK, no UI. All row-scoped to the owner's own account.
