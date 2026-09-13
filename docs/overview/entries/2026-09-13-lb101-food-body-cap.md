# 2026-09-13 — the route capped its body below the image it permits (LB-101)

**Branch:** `lane-a/lb101-food-item-body-cap` · one constant, one test file, docs. No user-visible
change of its own — the workaround that hid it is still live, and removing that is LA-105.

## The defect

`/api/nutrition/food-items` carried `const MAX_BODY_BYTES = 8 * 1024`, with the comment *"One food
item: a name, a brand and a dozen macro numbers"* — written before BF-35 gave the route
`imageDataUri` and a 16 KB image cap of its own.

**Base64 costs a third more than the bytes it encodes**, so an image at its own permitted size is
~21.8 KB on the wire. `readJsonLimited` runs at line 31 and `rejectMealImage` at line 55, so the
request was refused with a **413 before the image check ever ran**. The user did not lose the
picture; they lost the food.

Lane B measured it driving the real capture flow: a 128 px WebP of a detailed 600 × 400 source at
q0.8 came back **6,612 bytes = 8,816 base64 characters** and the save 413'd, while a smooth
photo-like source came back 1,410 and fitted. It bit detailed photos, not every photo — which is why
BF-35's own testing missed it.

The cap is now **derived** — `Math.ceil(FOOD_ITEM_IMAGE_MAX_BYTES * 4 / 3) + 4 * 1024` = 25,942 —
rather than restated, so raising the image cap raises this by construction. Restating it is what let
the two drift in the first place.

## Two things checked that the entry asked about

**The offline push branch has no such mismatch.** `app/api/sync/push/route.ts` caps at 4 MB, which is
three orders of magnitude clear of an image. The entry asked for this to be checked rather than
assumed, and the answer is that only the interactive route was wrong.

**A smaller thing turned up at the boundary, and is deliberately left alone.** `mealImageBytes` is
`ceil(base64Length * 0.75)`, which **ignores base64 padding** — so an image whose decoded size is
exactly 16,384 measures as 16,386 and `rejectMealImage` refuses it. The effective cap is about two
bytes under the advertised one. It errs strict rather than permissive, so it is harmless; what it
changes is the test, which asserts just under the cap and says why. The exact-cap boundary belongs to
the image validator, not to the body cap this entry is about, and asserting on it here would have been
testing the wrong thing while looking thorough.

## Verified

**Mutation pass: four mutants, all killed** — the flat `8 * 1024` restored (the original defect), the
4/3 base64 overhead dropped, the 4 KB of headroom for the food's own fields removed, and the cap
effectively lifted altogether. One deliberately equivalent control — `4 * 1024` written as `4096` —
survived.

Five tests, including the measured 6,612-byte case, and two that hold the cap still a cap: an
oversized image is refused with a message rather than a silent 413, and an enormous body is still
413'd.

`pnpm check:rules` and the full suite green.

**Not exercised:** no device, and the capture flow itself was not re-driven — Lane B's Playwright
measurement is what established the failing size, and the workaround that currently prevents it is
still in place.

## What is still owed

**LA-105 removes the workaround**, and it is Lane B's: `THUMB_WIRE_BUDGET = 7 * 1024`, the quality
ladder that re-encodes down to fit it, the `tooBigForTheBody` guard and the two assertions pinning
them exist **only** because of this cap. LB-101's entry said to leave them until the cap moved. It has
moved. The downscale itself stays — what is dead is re-encoding to 7 KB to sneak under a limit that is
now 25,942.
