# LA-36 — the food pictures were on the device and nothing read them back

**Branch:** `feat/la36-food-item-thumbnails` · **Version:** 1.485.0

Lane A's half shipped on 2026-09-28: every local food read returns `imageDataUri`. Nothing rendered
it. `meal-card.tsx` passed **`thumbSrc={null}`** on every diary row, with a comment saying
*"`food_items` carries no image column, so today this is always the placeholder"* — stale since the
column shipped.

## What shipped

Four lines. `DiaryRow` takes the logged item's `imageDataUri` and passes it to the tile the
artboards already draw. Rows without a picture keep the placeholder, which is the point: BF-32's
rule is that the box is the always-present state, because a row without it makes the list read as
ragged.

No contract was widened. `MealThumb`'s docstring says its `<img>` needs no host exemption
**because** the source is a capped `data:` URI and *"do not widen `src` to accept a remote URL"* —
checked before using it: `food_items.image_data_uri` is a base64 thumbnail capped at
`FOOD_ITEM_IMAGE_MAX_BYTES` (16 KB), the same class as a saved meal's.

**Only the diary.** Search and recent-food rows render no tile today, so giving them one is a look
change to those lists rather than filling a box that already exists — and it is where the entry's
memory note bites (20 search rows at the cap is ~320 KB). Left alone deliberately.

## The test was vacuous twice before it was real

- First it patched `/api/nutrition/food-logs` — but that route answers the **array itself**, not an
  object wrapping it, so the overlay rewrote nothing.
- Fixing that revealed the real problem: **the seeded user has zero food logs today**, so both
  assertions were passing against an empty diary.

So the spec seeds its own row with `psql` — a food item carrying a pixel and a log for today,
removed in `afterAll` (verified: zero rows left). **And the control run is what makes it count:**
against `origin/main`'s `meal-card.tsx` the positive test fails, so it is testing the change rather
than the fixture.

## Verified

- `e2e/la36-food-item-thumbnail.spec.ts` — **2 tests** at 412 px dark: a pictured food renders its
  `data:` URI, and clearing the picture on that same proven row falls back to the tile.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **9,541 passed** · `pnpm build`.

## Not exercised

- **A real photo at the real cap.** The fixture is a 1×1 PNG; nothing here measures a 16 KB
  thumbnail's memory cost in a long list, and only the diary renders one.
- **The device.** No native change, but the pictures live in the device's SQLite and the sandbox
  reads them through the API instead — so this has never been drawn from the local store.
- **`LB-167` is still open** on whether the placeholder tile reads as a failed image. This change
  makes it appear less often where a picture exists; it does not answer that question.
