# 2026-08-30 — `useLibrary` had never been run (LB-21), Lane A

**Branch:** `test/generate-with-library` · **Lane A** · tests only, no production code changed ·
no migration, no version bump.

## What this is

LB-21, filed by Lane B out of BF-11h's own "Not exercised" section. `selectLibraryMeals` is well
covered in `library-match.test.ts` — ranking, eligibility windows, untagged-suits-any-slot,
no-meal-twice. The **route wiring** was not: `grep -rl useLibrary --include=*.test.ts` returned
nothing. BF-11g shipped the flag with no test, BF-11h made it settable from the wizard, and between
them nobody had run a generation with it on.

New file: `app/api/nutrition/meal-plans/generate/__tests__/use-library-wiring.test.ts`, 12 cases.

## The entry's premise was wrong, and that is the main finding

LB-21 says: *"Do not reach for an AI call to test this. The library path is the half that does NOT
call the model — a fully-pinned or fully-library-filled request generates nothing, which is what
makes an end-to-end test of this flag cheap and deterministic."*

It does not. `generateObject` is called **unconditionally**, before `generatedNeeded` is computed,
because `planName` and `restDayAdjustment` come out of that same call. Fill all three slots from the
library and the route still sends the full generate prompt, saying `Meals: exactly 0.`

Two consequences. The test mocks the model, the way `app/api/nutrition/scan/__tests__` already does —
so the file is still cheap and deterministic, just not for the reason the entry gave. And the finding
is filed as **LA-38**, with the last case in this file pinning the behaviour so it is a recorded fact
rather than a surprise for the next reader.

**Then measuring it changed what LA-38 is.** With the model made to reject, a three-meal plan the
library filled completely returns **`502 "Could not generate a plan right now."`** — the `catch` does
not know the call was unnecessary, so a plan that needed nothing from the model fails when the model
is down. That is an availability bug, not a token bill, and it settles the fix: **skip the call**,
rather than make it cheaper. Both fields it supplies are derivable when nothing is being generated —
every meal in hand already has a name, and the rest-day line can state the reduction the code
actually applies instead of prose that may not match it.

## What the 12 cases pin

**With the flag off** — both library reads skipped (a regression there is invisible except as
latency, which is why it is asserted); `listSavedMeals` still read when meals are *pinned*, since
pins need it, while `listMealTypes` still is not; and `matchReason` null on every slot.

**With it on** — both reads happen; picks land at the slot they were matched against, **after** the
pinned meals (the `kept.length` offset nothing checked); `libraryMatchCount` equals the picks
actually used; a pinned meal is never offered back through the library; a slot the library could not
fill says `'No saved meal fitted this slot.'` rather than null, which is how BF-11h's review step
tells "nothing fitted" from "the library had no say"; and the meal-type windows are both *passed*
and *applied* — a breakfast-tagged meal lands only in the 07:00 slot, and one tagged 02:00–04:00
fills nothing.

## The fixture, and why it is three pure ingredients

`scaleIngredientsToTargets` moves each macro **group** independently and counts only that group's own
contribution. A realistic chicken/rice/oil meal lands protein and carbs exactly and comes out
**45.8 g of fat against a 22.4 g target**, because the fat carried by the chicken and the rice is
invisible to the fat group's scale. That is the scaler working as designed — but it means a
realistic fixture makes the match a question about incidental fat rather than about the route's
wiring. Three near-pure ingredients, one per macro, land on target and let the wiring decide.

## Verified

Mutation-proven, anchors asserted first — seven mutations, all killed:

| Mutation | Failures |
|---|---|
| library read gated on pins only (BF-11g's own documented footgun) | 5 |
| meal types always fetched | 2 |
| windows not threaded into `selectLibraryMeals` | 1 |
| pick slot index misses the `kept.length` offset | 1 |
| pinned meal offered back through the library | 2 |
| `matchReason` set even when the library was off | 1 |
| `libraryMatchCount` hardcoded to 0 | 2 |

Full suite green; `pnpm check:rules` Ran 62 of 62; `tsc --noEmit` clean.

## Not exercised

**Nothing shipped to exercise** — this PR changes no production code, so there is no runtime surface,
no device path and no deploy behaviour to check. The route itself is unchanged and was already
running in production.

The test deliberately does not exercise the real model (that is `library-match.test.ts`'s ranking,
already covered, plus the live splitting tests that need an API key) or the real portion scaler
(`scaleWithTopUp` is mocked to identity, because its own top-up path makes a second model call and
the arithmetic belongs to `meal-split`).
