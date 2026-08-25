# The Atwater factors have one home (LB-9)

**Branch:** `fix/atwater-one-place` · **Lane A** · no migration · no behaviour change

Lane B found four longhand copies of `4 / 4 / 9` while building Q-395b's macro-split arc, closed the
one it could reach, and filed the rest — `packages/shared/` is Lane A's.

## What was where

| site | shape |
|---|---|
| `calorie-balance.ts` | a `KCAL_PER_G` that was **not exported**, so nothing could reuse it |
| `goal-recommendation.ts` | `* 4` / `* 9` hardcoded at **four** call sites (the entry said three) |
| `components/nutrition/macro-energy.ts` | its own copy, existing only because it could reach neither |
| `saved-meal-card.tsx` | already folded into `macro-energy.ts` by Q-395b |

`goal-recommendation.ts` is where they hid, and it is worth naming why: `proteinG * 4` reads as
arithmetic rather than as a constant, so it does not look like a duplicate of anything.

## One module, not an export

The entry suggested exporting `KCAL_PER_G` from `calorie-balance.ts`. It is instead a six-line
`packages/shared/src/nutrition/atwater.ts` with no dependencies — **a component that wants two
numbers should not have to import a day's worth of calorie-budget maths to get them**, and an import
that cheap is what stops a fifth copy appearing the next time something needs them.

`macro-energy.ts` re-exports it so existing `components/` imports keep working and keeps only the two
shapes the UI actually needs. One incidental simplification: `reconcileDailyMacros` was recomputing
the macro total inline when `caloriesFromMacros` — four lines above it — already did exactly that.

**No behaviour change.** Every copy already held the same values, which is what makes the fold safe;
the test pins them so a future edit to the constants is a deliberate act rather than a refactor's
side effect.

## Verification

Six tests, **mutation-verified** — retyping `* 4` / `* 9` back into `goal-recommendation.ts` fails
the hardcode case. They scrape source rather than compare values, because an imported number cannot
tell a literal `4` from a reference to one.

- `pnpm check:rules` — Ran 56 of 56. `tsc --noEmit` clean, `pnpm lint` 0 errors.
- Full suite: **4778 passed, 51 skipped, 0 failures.**

## Not exercised

Nothing on device. The change is behaviour-preserving by construction and the value-pinning test says
so, so the device risk is the same as not shipping it.
