# 2026-09-04 — two tiles labelled BMR, and one of them was mislabelled (BF-114, UI half)

**Branch:** `fix/bf-114-bmr-provenance` · Lane B · labelling only, no arithmetic changed, no APK.
The engine half is handed to Lane A — see the end.

The owner: *"the BMR in scale is different to home; should probably indicate the difference?"*

## The entry's premise was wrong, and that is the finding

BF-114 recorded the Body tab's figure as *"the scale's own bioimpedance estimate, re-read every
weigh-in"*. It is nothing of the kind. `lib/scale-ble/composition.ts` computes it with
**Mifflin-St Jeor** from weight, height, age and sex, and says so in its own comment —
*"independent of impedance"*. The stored `body_metrics.bmr_kcal` is our own formula output.

That changes the explanation the entry proposed. The 218 kcal gap is not *"two different measurements
of different things"*; it is **a formula against a measurement**, which is both simpler to state and a
stronger reason the measured one should win. It also means the label the entry suggested —
*"scale estimate"* — would have been false, so it is not what shipped.

## Two more things, found by reading rather than by the report

**The Body tab had two tiles both labelled `BMR`.** The "Body Composition" card's is Cunningham from
lean mass (the DEXA-corrected figure); the "Body Composition (Scale)" card's is the Mifflin-St Jeor
value. Same screen, same word, different numbers, neither saying which was which. That is a sharper
version of what the owner reported than the report itself.

**The scale card's popover was false for two of its tiles.** It claimed the whole card is *"measured
directly by your body-composition scale (bioelectrical impedance) — not calculated from
weight/body-fat"*. BMR uses no impedance at all, and **Visceral Fat** is derived from BMI and age.
The claim is right for the rest of the card, which is what made it easy to miss.

## What shipped

- Composition card's BMR tile → *"calculated from lean mass"*.
- Scale card's BMR tile → *"from weight & height"*, and Visceral Fat → *"from BMI & age"*.
- The popover carves both out of its impedance claim by name.
- One sentence on why the numbers differ: the targets *"prefer a clinically measured resting rate
  when you have one"*.

**That last wording is deliberate and the first draft was wrong.** It said *"your calorie targets do
not use this BMR"* — true of the stored value, and misleading about the number, because
`energy-balance-service.ts` falls back to `mifflinStJeorBmr(...)` when there is no measured RMR and
no body composition, which is the same equation on the same inputs. "Prefer a measured rate" is true
in every state.

## Verification

Six source-level cases in `app/health/__tests__/bmr-provenance-labels.test.ts`, **three mutations
killing them**: relabelling the scale BMR as a scale measurement (1 failure), the composition tile
losing its source line (1), and the popover reverting to its blanket impedance claim (2). Two of the
cases guard the *premise* rather than the copy — that `lib/scale-ble/composition.ts` really is
Mifflin-St Jeor, and that the energy model never reads the stored `bmrKcal`. If either changes, the
labels stop being true and the guard says so.

`tsc`, lint (0 errors), `pnpm check:rules` **Ran 68 of 68**, full suite **6,449 passed / 0 failed**,
`check-test-typecheck` at baseline.

## Handed to Lane A, not left implied

The surface the owner actually compared — Home's *"your resting burn (N kcal)"*, shared with
Nutrition through `calorie-balance-bar.tsx` — still names no source, and **cannot yet**.
`restingBaseKcal` is `measuredBmr ?? formula` and the payload records no field saying which; the
existing `maintenance.source` is about a different number. That is `lib/health/energy-balance-service.ts`,
reached by `app/api/**`, so BF-114 is rewritten to **Lane A** with that as its `Keep:` — including
the warning that the label must say the measurement is **carried forward to today's lean mass**,
since `personalRmr` returns `cunninghamBmr(currentFfmKg) + residual` rather than the lab's number.

## Not exercised

**The device**, and the screen. The changed tiles are on Health → Body, which needs a weigh-in with
body-composition fields to render at all; the seeded dev user has none, so the cards do not appear
on `pnpm dev` (the same wall BF-113 hit). The labels are pinned by source guard and the premise by
test; neither is a substitute for reading the card on the S25.
