# 2026-08-26 — a food item can hold a picture, and it survives offline (BF-35, Lane A half)

**Branch:** `feat/food-image-storage` · **Lane A** · v1.383.0
**Migrations:** Postgres 227 + 228 · local SQLite **v30**

## What shipped

`food_items.image_data_uri`, the cap that governs it, the Open Food Facts thumbnail field, and the
whole offline chain — delta select, pull mapping, local upsert, outbox payload, and **both** write
paths. A barcode scan now stores the product's picture.

## Three premise corrections, made before implementing

The entry was written the same day and was already wrong in three places. All three were checked
against the code rather than reasoned about.

**1. It concluded "never generate one" — the owner had overruled that hours earlier.** The closing
measured-evidence section still carried the pre-decision recommendation. A session reading top-down
sees the ✅ routing block and is fine; one skimming to the evidence builds the opposite of what was
decided. Corrected in place with the reversal marked.

**2. It sized the feature against database storage.** "0.15% of 187 MB", "~1.2 MB at 209 items".
`food_items` is a **synced domain** (`MUTATION_DOMAINS`), so every image rides the outbox push, the
pull delta and the device's SQLite mirror. `packages/shared/src/nutrition/meal-image.ts` already
warns about this exact axis confusion by name: `users.avatar` allows **5 MB** harmlessly because it
is one row per user that never enters the delta, and copying that cap to a synced table *"would be
the largest single regression the sync engine has taken."* `FOOD_ITEM_IMAGE_MAX_BYTES` therefore
lives beside `SAVED_MEAL_IMAGE_MAX_BYTES` and is governed by its reasoning.

**3. "The scan photo is already in the request, so keeping it is free" is half true.** The request
carries **1024 px** (`SCAN_IMAGE_MAX_DIM`) because the model has to read the label; a thumbnail is
**128 px** — roughly **64× fewer pixels**. Storing what arrives would blow the sync budget, so route
2 needs the client to emit a *second*, small downscale. That is `capture-step.tsx`, which is **Lane
B**, so route 2 is split across lanes and the server half is inert until Lane B lands.

## Bytes, not a URL — the decision the entry did not resolve

Open Food Facts serves `image_front_thumb_url` on the product object the barcode call already
fetches, so the URL is genuinely free. It is still the wrong shape: `food_items` is read local-first
and mirrored into on-device SQLite, and a URL renders nothing in airplane mode. So the bytes are
fetched **once, server-side, at scan time** — one request per new item, never per render. OFF's thumb
is already ~100 px, so nothing is re-encoded and no server-side image library was needed.

Cheap to reverse (a column type), so it was decided rather than escalated.

## The two write paths disagree on purpose

| path | bad image | why |
|---|---|---|
| `POST /api/nutrition/food-items` | **refuses**, 400 with a message | interactive caller; they can see it and retry |
| `pushMutations` | **drops the image, keeps the food** + a `warnings[]` entry | a 4xx is a poison pill the outbox quarantines — refusing costs a whole food item over a picture (the RV-32 precedent) |

Same validator, same cap; only the consequence differs. Asserted in a test so the asymmetry is not
"fixed" later.

## A mistake of mine that would have shipped silently

The v30 migration was first inserted **before** v29 in the array. `sqlite-service.ts:45` derives the
target version from `upgrades[upgrades.length - 1]` — the **last element, not the maximum** — so
every upgrading device would have targeted v29 and never run the ALTER. Fresh installs would have
been fine, which is exactly the shape that hides: the CREATE TABLE body has the column, so every test
and every new install passes. Caught by reading how the version is derived rather than assuming.

`check-local-column-upgrade-path.js` and `check-reconcile.js` both pass (41 tables, 128 columns).

## Deliberately not done

- **The search route does not fetch thumbnails.** It returns up to 60 products, so one thumbnail each
  is 60 requests per search — precisely the cost this entry exists to avoid. The barcode route
  fetches because it resolves exactly one product. If search images are wanted, the shape is to carry
  the URL through and fetch at item-creation time: one fetch per item created, not per result shown.
- **The render, route 2's client half, and route 3 (AI generation).** Recorded as BF-35's `Keep:`
  line; the first two are Lane B.

## Verification

- 10 pure-logic cases for `fetchOffThumbDataUri` (every failure path returns null rather than
  throwing — a picture must never fail a nutrition lookup), 6 DB-backed cases for the storage chain.
- **Mutation-tested with applied-proof:** dropping the content-type check, the cap check, the
  try/catch, the OFF field, the row mapper, the delta column, and the push-branch rejection each
  fail a test; each `sed` asserted its anchor first, so a drifted anchor fails loudly.
- Full suite **610 files / 4,992 tests, 0 failures**; `pnpm check:rules` **Ran 59 of 59**;
  `tsc --noEmit`; lint.

## Not exercised

Native SQLite / Capacitor, safe-area, Samsung WebView, real device. **The v30 migration is the part
that matters here and it has not run on a phone** — local migrations have killed the Android DB twice
(a PRAGMA inside the transaction, a non-idempotent ADD COLUMN), and the web sandbox cannot exercise
`getLocalStore` at all. Also not exercised: a real Open Food Facts response — the fetch helper is
tested against mocked responses, so the field name `image_front_thumb_url` is verified against OFF's
documented schema rather than observed in a live payload.
