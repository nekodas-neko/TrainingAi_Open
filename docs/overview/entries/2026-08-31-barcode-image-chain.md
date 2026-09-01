# 2026-08-31 — BF-70: the barcode thumbnail is fetched, and now it survives the trip

**Branch:** `lane-a/next` · **Lane A** (with the form-model half the entry places in the same change)
· JS/server only, no APK.

The barcode route has fetched the Open Food Facts thumbnail since BF-35, and every layer between it
and the stored row threw it away. The entry named four; there were **five**.

## The fifth layer

`log-food.ts`'s own `createFoodItem` — the web fallback that POSTs to `/api/nutrition/food-items` —
built a body of twelve fields and not the image. The route has accepted and stored `imageDataUri`
since BF-35, so even with the four filed sites fixed, the web path would still have dropped it. It
is not visible from any of the four; you only see it by following the value rather than the list.

## Why the dead line typechecked, which is the part worth keeping

`create-food-item.ts:68` read `imageDataUri: s.imageDataUri ?? null` where `s` is
`sanitiseNutrition(...)`'s return. That compiles because **`RawNutrition` declares the field** —
and resolves to `undefined` on every call because every caller builds that argument from numeric
fields alone. So the line that dropped the picture read as the line that carried it, and its comment
said so outright.

The fix is not only to read from `input`. It is to **delete the declaration**, so the same mistake
becomes a compile error. `scripts/check-sanitiser-no-image-field.js` (Custom Rules, now **65**)
keeps it deleted.

**A `@ts-expect-error` in a test cannot hold this, and finding out why is worth recording:**
`tsconfig.json` excludes `**/__tests__/**`, so **no test file is typechecked at all**. A type-level
assertion written there is inert while reading as a guard. The mutation that proved it: re-add the
field, run `tsc` — exit 0.

*(And the first attempt at that assertion went into `RawNutrition` instead of `NutritionScanResult`,
because both declare `imageDataUri` and only one is real. That is the same confusion the bug is made
of.)*

## The source label, and why the entry's suggested mechanism was the wrong one

`handleConfirm` set `source: scanResult?.confidence ? 'ai' : 'manual'`, so every barcode scan stored
as `'ai'` — which is why BF-38 measured **3 rows of 221** carrying `'barcode'`.

The entry suggested following the barcode route's `notes` stamp. Two measurements say not to:

- `offProductToNutrition` sets `confidence: 'high'` for **both** OFF routes and the photo scan sets
  one too, so "has a confidence" means "came from a scan" and nothing more.
- `notes` on the photo path is **model-authored prose** (`scan/route.ts:89`), so keying behaviour off
  it would be gating on LLM output — which this repo's own AI rule forbids.

So `NutritionScanResult` gains an explicit `origin: 'barcode' | 'search' | 'photo'`, set by the route
that knows, and `scanOriginToSource` maps it. **`'search'` still maps to `'ai'`**, which is a wrong
label: `food_items.source` has no value for an Open Food Facts text lookup and adding one is a
migration. That is pinned by a test so it reads as a stated compromise rather than an oversight.

## Verified

- 6 unit tests; **3 mutations killed** (the old confidence rule, the missing `origin` on the shared
  OFF mapper, and — after the check was written — the re-added dead field, plus its two failure
  modes and the false positive of the prose that names it).
- Full suite **684 files / 5,744 tests** · `pnpm check:rules` **Ran 65 of 65** · `tsc` clean.
- **Exercised against the real Open Food Facts API** on `pnpm dev`, barcode `9310072030821`:

  | Step | Result |
  |---|---|
  | `GET /api/nutrition/barcode` | `Shapes Vegemite & Cheese`, `origin: 'barcode'`, a real 5,359-char data URI |
  | `POST /api/nutrition/food-items` | 201 |
  | the stored row | `source = barcode`, `image_data_uri` **stored, 5,359 chars** |

  Before this change that row would have been `source = ai` with a null image.

## Not exercised

The React half — `scanToEditable` → form → `handleConfirm` — is covered by `tsc` and by the unit test
on `scanOriginToSource`, not by a run: the flow starts at the camera scanner, which does not exist
headless. Device, safe-area and WebView paths do not apply; no APK needed.

## Also removed from the queue

**BF-2's entry, which this session shipped four steps of and then left in the queue.** It read as
READY at position 3. Its own protocol says a finished entry must not still be there; the completion
words the checker looks for were in its body, not its heading, so nothing caught it. Nothing is owed
— the display half is LA-45 and the entry surface was BF-71.

Four references to BF-70 elsewhere in the backlog went stale the moment it was struck, including
BF-35's *"blocked by BF-70"* and BF-38's batch line. All four are rewritten rather than left.
