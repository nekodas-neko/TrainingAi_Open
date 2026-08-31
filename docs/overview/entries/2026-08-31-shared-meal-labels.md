# BF-57 — the meal goes in the code, and item 1 turned out to be impossible

**Branch:** `feat/shared-meal-labels-bf57` · **Lane B** · v1.408.0

## What was wrong

The owner asked to share meals with a partner (BF-77). The answer was supposed to already exist:
`encodeSharedMeal` / `decodeSharedMeal` / `decodeMealLabelScan` and the QR capacity table shipped on
2026-08-30. **Nothing emitted any of it.** `meal-label-render.ts` still called
`encodeMealLabelToken(meal.id)`, so every printed label carried 22 characters that resolve only
against the *scanning* user's own meals — and a label handed to anyone else fell to *"that saved
meal no longer exists"*, which is wrong twice over: the meal exists, and the real answer is "not
yours".

## Item 1 was reconciled, not implemented — and that is the durable output

The entry's binding item was *"give the QR ~30 mm of the 50 mm label"*, so version 11's 251 bytes —
the whole recipe, nothing rolled — would fit **every** style. It reasoned from a code of
12.2–16.4 mm. That range is pre-Q-411. Measured against the square canvas:

| | code box | budget at 0.49 mm/module |
|---|---|---|
| `inlineCentred` (default) | 18.5 mm | v3 — **42 bytes** |
| `band` · `editorial` · `ticket` | 16.4 · 16.9 · 17.7 mm | v2–v3 |
| `square` · `plaque` | 20.1 · 20.9 mm | v4 — 62 bytes |
| **`share` (new)** | **34.4 mm** | **v11 — 251 bytes** |

**None of the five print styles can grow.** Each is already the largest `codeUnits` that clears its
own content by the 6 units its own comment requires, and 30 mm is 128 of the 171 usable units — the
whole label. Four of the six cannot hold even 62 bytes, and below that `encodeSharedMeal`'s
documented last resort is to **trim the meal's name**. Forcing item 1 would have shipped labels with
eaten titles: a change that renders, scans, and is quietly wrong.

So **two payloads ship**, which is the reconciliation rather than a hedge:

- The five print styles keep the private bookmark. That is the right code for a jar in your own
  kitchen — *scan this to log it* — and its 22 characters are what let those layouts print the
  finest modules in the feature *and* carry the ingredient list.
- **`share`** drops the calorie block and the ingredient list — both of which the code itself
  carries — and spends the label on the code. It is the only style that reaches version 11.

`mealLabelShareBudget` reads the budget off each style's geometry rather than the other way round,
and `meal-label-code-size.test.ts` holds the measurement, so *"why not just share from every
style?"* is answered by CI instead of re-argued.

**`plaque` and `square` clear the 62-byte floor and still carry the token, deliberately.** They
would name about two ingredients and roll the rest — that looks like sharing, produces a visibly
poorer copy than the style built for it, and gives nobody a reason to pick the right one. One
clearly labelled answer beats three partial ones. The sheet says which you are looking at: *"This
code is a private bookmark — it logs the meal on your own phone and does nothing on anyone else's."*

## The scan path

A shared label **saves a copy into the scanner's library**; it does not log the meal. A shared
recipe is something you keep and cook again, and logging it would put a meal in today's diary that
nobody said they had eaten.

**Ingredients are normalised to per-100 g**, exactly as `ingredientToEntry` does for a planned meal,
and that is load-bearing twice: it is what makes `createFoodItem`'s duplicate check find the chicken
breast already in the scanner's library instead of minting a row per scan, and it is the basis every
other food item is stored on — a meal stored per-recipe-weight would read correctly and scale wrongly
the moment anyone edited it. The weight rides in the multiplier, so the totals survive.

`ingredient-picker.tsx` got the same `decodeMealLabelScan` swap in the sibling sweep — it is the
other camera that can reach a meal label, and without it the *newer* labels were the ones falling
through to a product lookup.

## Two decisions worth keeping

**The unresolvable-id message names both causes.** That branch is reached when the owner deleted
their own meal *and* when someone else's pre-BF-57 label is scanned. The old copy asserted the
first; the second is the case that matters now. It says the meal is not in your library, that it was
deleted or printed by someone else, and that a fresh label carries the whole meal.

**A rolled tail is stated on the paper.** `share`'s caption becomes *"Scan to add this meal ·
3 ingredients grouped"*, and the sheet says which ones. A copy whose totals are exact but whose
ingredient rows are fewer than the author's is true, and a surprise if you find out by counting.

## Verified

`tsc --noEmit` clean · `pnpm lint` **0 errors** · `pnpm check:rules` **Ran 65 of 65** (the count moved
with #687's new check, re-run after merging it) · full `npx vitest run` **687 files / 5,763 passed**,
3 files / 59 skipped.

**`e2e/meal-label.spec.ts` decodes the `share` label's real QR out of the rendered canvas and checks
the recipe back.** The fixture is eight ingredients against a 251-byte budget, so it takes the rolled
path — and the totals come back **exactly**: 480 g, 1,920 kcal, 400 P, 32 C, 16 F. That is the
guarantee a scanner cannot check for themselves, since a copy with plausible-looking wrong numbers is
indistinguishable from a correct one. 5 specs green.

Every guard is **mutation-tested**: hardcoding `servings: 1`, sending `mealTypeIds: []`, removing the
zero-weight guard, dropping the weight from the multiplier, shrinking `share` to 100 units, letting
`plaque` carry the recipe, removing the shared-meal scan branch, and restoring the old error message
each fail their own test — and making `share` emit the token again fails the **e2e** decode.

One guard needed sharpening: `decodeMealLabelToken` had to be matched as a **call**, not a word,
because the comment explaining the swap names it. Same shape as the Custom Rules line-grep that
flagged a comment in the previous batch.

## Not exercised

- **The device, and it is the whole of what BF-57 still owes.** The scan path runs through
  `getLocalStore`, which **returns null in the web sandbox**, so none of it executes off-device. What
  is proven is the payload, the arithmetic and the render; what is unproven is a second phone.
- **A printer, which is older than this entry.** No label of any style has been through one, so
  0.49 mm per module — the floor the whole budget is derived from — is a convention, not a
  measurement. If a real print says otherwise, `MIN_MM_PER_MODULE` is the one number to move and the
  budgets follow.
- **`share` against a long meal name.** `fitText` shrinks it and the caption, but only browser
  metrics decide where that stops being readable.
- **Duplicate scans.** Scanning one label twice makes two meals; filed as **LB-34** rather than
  folded in, because what the offer should *say* in a one-tap kitchen flow is a product question.
