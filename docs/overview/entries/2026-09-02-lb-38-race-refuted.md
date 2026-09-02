# 2026-09-02 — the render race I published for LB-38 is refuted (same day)

**Lane B · branch `docs/lb-38-race-refuted` · no version bump · docs only**

#806 named a leading suspect for LB-38's undecodable symbol: `meal-label-sheet.tsx`'s effect cleanup
sets `cancelled = true`, but that flag guards only `setMetrics` and the toast, so an in-flight
`renderMealLabel` suspended at `await document.fonts.ready` could resume, clear the canvas with
`canvas.width = px` and redraw underneath the sample. And because `mealLabelCarriesRecipe` picks
between the recipe payload and the 22-character bookmark per style, two interleaved renders would
encode **different data**.

I instrumented it rather than leaving the lead standing. **The second half is false.**

## Every style encodes the identical payload

Across nine runs, all six styles logged `len=22` and the same token — `CYFq8UeLToCQ…` in one run,
`LK5lyoN5RwGb…` in another, identical within each run. `mealLabelCarriesRecipe` is
`SPECS[style].layout === 'code'`, and none of the styles this test drives takes that branch.

So even a perfect interleave would draw **the same symbol**, and the mechanism cannot produce a wrong
codeword stream. That holds on every run and does not depend on catching a failure.

## And the renders never interleave

Every run logged 11 clean `start → resumed-after-fonts → done` triples, no overlap anywhere. Nine
runs, none failing — which is consistent with the recorded ~1-in-19 rate, and is why the refutation
rests on the payload fact rather than on a failing run's log.

The unguarded in-flight render is a real latent hazard worth fixing on its own merits — `cancelled`
genuinely does not stop the drawing — but it is **not** this bug.

## Where LB-38 stands now

The field is very narrow and every remaining explanation is uncomfortable:

- geometrically perfect symbol (25×25 at exactly 13 px, textbook finders, timing and alignment)
- format info identical to a passing symbol's
- payload identical to what every other style draws
- no second render touching the canvas
- undecodable under all four binarizer × `TRY_HARDER` combinations, cropped or whole

**The next thing to test is the encoder itself**: capture `qr.modules` at draw time and compare it
against the modules actually rendered. That separates *the library produced a bad symbol* from *the
drawing put a good symbol down wrongly*. Neither has been checked.

## The lesson, which is now three-for-three on this entry

Every confident reading I have made of LB-38 has been wrong, and every one was caught by taking one
more measurement rather than by thinking harder:

1. **Ink 0.0807 is half the normal band** → it is normal for that style; the band belonged to another.
2. **A matrix diff of 134/625 means corruption** → different runs use different meals, so it means
   nothing.
3. **Interleaved renders encode different payloads** → they encode the same 22 characters, always.

The instrumentation that settled this took one run. All three claims would have been cheap to check
before publishing, and none of them were.

**Not exercised:** no fix, nothing changed but documentation. `pnpm check:rules` **Ran 67 of 67**. All
instrumentation was reverted and the diff confirmed empty before this branch was cut.
