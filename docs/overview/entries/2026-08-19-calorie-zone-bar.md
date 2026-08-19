# 2026-08-19 — one bar, and it says where the budget came from (Q-401, Lane B half)

Lane B. v1.325.2. Two new files, three components changed. **The Lane A half — the actual root
cause — is untouched and still open.**

## What the owner saw

> *"why are these values different? should it not match the nutrition goal? I was hopping we could
> combine these 2 widgets/displays"*

Two calorie budgets stacked on the Nutrition tab, **274 kcal apart**, both labelled "left".

## The root cause is two TDEE models, and it is Lane A's to fix

Both numbers are correct and they measure different things. They come from the same BMR and disagree
by exactly the activity multiplier the goal wizard was told about:

| | formula | value |
|---|---|---|
| BMR implied by the shipped maintenance | 1,826 ÷ 1.2 | **1,522** |
| Goal wizard, `calculateBaseline` | BMR × **1.375** (light) − 200 | **1,892** ≈ the stored **1,900** |
| Energy balance, `buildEnergyBalance` | BMR × **1.2** (sedentary) − 200 | **1,626** |

`BMR × (1.375 − 1.2) = 266`. Observed on device: 274, the rest being rounding and weight drift.
`goal-recommendation.ts` bakes a **self-reported** multiplier into the target; `daily-energy.ts` uses
the sedentary one **deliberately**, and its comment says why — measured movement is added explicitly,
so a higher multiplier there would double-count it.

**Retiring `ACTIVITY_MULTIPLIERS` is the fix, and it lives in `packages/shared/`, which is Lane A's.**
Nothing here changes anyone's numbers.

## What this half does

**Makes the disagreement legible, and stops the two surfaces drifting further.**

- **One `CalorieZoneBar` component.** The five-band scale and marker were previously written out
  inside `CalorieBalanceBar`; Home had a gradient progress fill instead. Both now render the same
  component. Two hand-maintained copies of a calorie display is the class that produced this entry.
- **Home's gradient fill is gone.** A fill answers *"how full is the tank"* against a target that
  never moves, which is the wrong question once the budget rises with what you burn. The zone answers
  *"am I on target"*. `HomeNutritionZoneBar` self-fetches through `useEnergyBalanceToday` — the same
  cache key as the energy-balance card beside it, so `cachedFetch` de-dupes them into one request,
  and it is on `useCachedValue` so an invalidation repaints it (Q-402, shipped hours earlier).
- **A provenance line under each bar:** *"1,626 base + 312 earned from movement"*. Without it a
  budget that grows during the day reads as a bug — which is how this entry started.
- **The Calorie Nudge's gate is split.** `tdee-adaptation-card.tsx` required
  `maintenance.source === "calibrated"` for the whole card, so **the only surface that explains the
  two numbers was shut in exactly the case where they differ and nothing else accounts for it.** The
  gate is right for the *action* — suggesting a target off a formula-derived maintenance would move
  the user sideways with false authority — and wrong for the *explanation*. Now: explain on
  `formula`, offer to apply on `calibrated`. The explain variant carries no buttons and no dismiss,
  because dismissing it would hide the reconciliation for the rest of the week.

## Deliberately not done

- **The two cards were not merged into one.** The entry's own point 3 says *"a one-line swap, not a
  new card. Keep `MacroRing` … as they are"*, and the Nutrition tab already had the zone bar as its
  own card directly above the ring. Merging them would drop the Eaten / Burned / Net stats and the
  maintenance sentence, which are real information. The "combine" complaint is answered by the Lane A
  formula change, which makes the two numbers agree — not by stacking them closer together.
- **No target was changed and nothing auto-applies.** Q-302's nudge owns applying.

## Where `budgetProvenance` lives, and why it is not where it belongs

`components/nutrition/budget-provenance.ts`, a `.ts` file rather than inside the `.tsx`, because both
vitest projects are `environment: 'node'` and cannot parse JSX — arithmetic left in a component
cannot be asserted at all. Its better home is `packages/shared/src/nutrition/calorie-balance.ts`,
beside `computeCalorieBalance` whose output it reads; it is not there because that directory is Lane
A's and Lane A owns the other half of this entry in the same folder. Recorded in the backlog so the
move happens when that lands.

Four tests, mutation-checked: flipping the goal delta's sign reddens three.

## What was NOT exercised

- **Nothing about this was seen in a browser at the time of writing** beyond a probe that was still
  running — see the PR for the outcome. `tsc`, lint, 45/45 Custom Rules and the unit tests are what
  is confirmed.
- **No device run.** JS-only; reaches the APK on the next Railway deploy with no rebuild.
- **The explain variant needs `source === 'formula'` AND a drifting goal** to appear. The seeded
  local user reaches `formula`, but whether the drift condition holds for them was not confirmed —
  it depends on their stored target against a computed recommendation.
- **The disagreement itself is still there.** This says why; it does not fix it.
