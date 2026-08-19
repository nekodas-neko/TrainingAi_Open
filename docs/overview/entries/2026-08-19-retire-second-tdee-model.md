# 2026-08-19 — one TDEE model, not two (Q-401, Lane A half)

**Lane A** · branch `fix/retire-second-tdee-model` · no migration, no route, no APK.

The Nutrition tab showed two calorie budgets **274 kcal apart**, stacked, both labelled "left". The
Lane B half (v1.325.2) made the disagreement legible. This removes it.

Neither number was wrong; they were different contracts run at once:

| | formula | value |
|---|---|---|
| Goal wizard, `calculateBaseline` | BMR × **1.375** (light, self-reported) − 200 | 1,892 ≈ the stored 1,900 |
| Energy balance, `buildEnergyBalance` | BMR × **1.2** (sedentary) − 200 | 1,626 |

Gap = BMR × (1.375 − 1.2) = **266 kcal**; observed on device **274**, the rest rounding and weight
drift. `daily-energy.ts` already said why it used sedentary: *"measured movement is added explicitly,
so a higher activity multiplier here would double-count it."* One model **assumed** activity, the
other **measured** it.

**Owner decision:** *"i want the lowest number that assumes no exercise/movement — and only has BMR
essentially. then we adjust/increase that number [by] activity."*

## The change

`ACTIVITY_MULTIPLIERS` is gone. `calculateBaseline` now uses `SEDENTARY_MULTIPLIER` imported from
`daily-energy.ts` — literally the same constant the measured model uses, so the two are one
expression rather than two that agree by coincidence.

The activity level is still asked for and still used, but only where it is **not** double-counted:
`STEP_GOAL_BY_ACTIVITY` and the water bump. Those add nothing to calories.

`budgetProvenance` moved from `components/nutrition/` into
`packages/shared/src/nutrition/calorie-balance.ts` beside `computeCalorieBalance`, which is where its
own header said it belonged — it was parked in components only to avoid colliding with this work.

## What it moves, measured rather than estimated

Nothing stored changes: `nutrition_targets` is untouched and no history is re-scored. What changes is
the **recommendation**, computed on demand.

| activity level | old TDEE | new TDEE | delta |
|---|---:|---:|---:|
| sedentary | 2136 | 2136 | 0 |
| light | 2448 | 2136 | −312 |
| moderate | 2759 | 2136 | −623 |
| active | 3070 | 2136 | −934 |
| extra_active | 3382 | 2136 | −1246 |

*(BMR 1780 — an 80 kg / 180 cm / 30 y male.)*

On the owner's profile (BMR 1522, light, recomp): **1,893 → 1,626**, which is exactly the
energy-balance figure their device already showed. The two numbers now agree by construction.

## The honest cost

**The higher the declared activity level, the larger the drop** — up to 1,246 kcal at
`extra_active`. That is correct under the new contract, because the day's movement is added back at
render time from *measured* sources: logged strength sessions, logged activities, and steps above a
baseline (`computeActiveEnergy`).

The exposure is a user whose activity is **real but unlogged and unmeasured**. They previously got
credit for it through a self-reported multiplier and now get none. For this app that is a narrow
case — logging workouts is the app — but it is the trade, and it is the reason the entry insisted the
budget must say *"1,626 base + 274 earned from training"* rather than silently changing.

One knock-on worth knowing: `clampRecommendation`'s ceiling is `baseline.calories × 1.2`, so the AI's
headline suggestion is now clamped against a sedentary baseline. Checked live rather than assumed —
the route returned **2,244 kcal** for a recomp profile against a new ceiling of 2,323, so it is not
clamped in the ordinary case.

## Tests

The test that pinned `ACTIVITY_MULTIPLIERS` is replaced by one that pins the **contract**: the same
calories for all five activity levels, step goal and water still varying, and
`tdee === round(bmr × 1.2)` — the same expression `energy-balance-service` computes. The
Katch-McArdle case deliberately keeps `activityLevel: 'moderate'` so it fails if the multiplier ever
returns.

Full suite 508 files / 4155 tests green.

## Left open

`Q-323` — the calorie budget now moves with activity but the macro grams beneath it do not. That is
deliberate (the ring keeps the SET goal, and the grams derive from that row), and the residual
question is which macro absorbs earned calories. Q-401's answer was carbs, not protein — protein is
dosed per kg of bodyweight — and it is unimplemented. Do **not** scale all three uniformly.

## Not exercised

Production, and the APK. `/api/nutrition-goals/recommend` was driven on `pnpm dev` against a seeded
profile.
