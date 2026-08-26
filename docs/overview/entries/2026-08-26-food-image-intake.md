# 2026-08-26 — filling the food tile, and which sources are actually free

**Branch:** `feat/food-image-intake` · docs-only · BugFix Intake

## The question

BF-32 shipped a placeholder tile on every food row, and the owner asked the obvious follow-on:
*"When the AI does a food match; does it come with a picture/image of the food that could be added
to our photo as the default? ... ONly if it doesnt add more time/expense."*

That condition is the entry. Answering it needed the three sources separated, because they are not
comparable.

## Two of the three are free; the third is not, and BF-35 recommends against it

| Source | Cost |
|---|---|
| **Open Food Facts** — barcode + food search | **Zero extra requests.** OFF serves `image_front_small_url` on the *same* product object. `OFF_FIELDS` is `'code,product_name,brands,serving_size,nutriments'` and simply never asked. |
| **The photo scan** | **Zero API cost.** The user's own photo is already in the request and is **thrown away** once the nutrition JSON returns. |
| **AI image generation** | **Real money per image.** `lib/exercise-image-gen.ts` is the precedent, so it is buildable — and it is the only one that fails the owner's condition. |

**The discarded scan photo is the best default of the three.** It is the user's actual meal rather
than a stock shot of a similar product, it needs no new dependency, and the downscale is already
written: `meal-photo-tile.tsx` does 128 px WebP at ~6 KB against a server-side cap sized for exactly
this.

## A premise worth correcting

The owner expected *"we save foods for x amount of days in history so only a small repertoire will
have its food image saved."* **`food_items` does not prune** — no cleanup job, and `food_logs`
carries `ON DELETE RESTRICT` against it, so the catalogue grows for the life of the account. The
14-day window is the *local Oura raw* store, a different thing.

Still cheap: **500 items × 6 KB ≈ 3 MB** against a 171 MB database at $0.15/GB/month. Worth stating
rather than discovering later during a database-size read.

## Two decisions left open on purpose

**Bytes or URL?** A URL is free and always current but breaks offline — and the row it decorates is
read local-first. Recommended: store bytes, matching `saved_meals` and the offline-first premise.

**`food_items` is shared, not per-user.** An OFF product shot belongs on the item, where one copy
serves everyone; a scan photo is the user's own meal and belongs to the log or a user-scoped column.

And one real constraint: OFF images are **CC-BY-SA**. Display is fine, attribution is owed, and where
that line goes should be decided before shipping rather than after.

## Also confirmed this session

**BF-34 is not fixed.** The owner re-tested on v1.381.3 after a force stop and still cannot reach the
delete button, which is correct — the entry was filed and root-caused, and no fix has merged. Nothing
about the diagnosis changes; it is waiting on Lane B.

## The retention question, measured against production

The owner pushed back on "forever": *"It stays for ever are you saying? ... do all the details stay
on the phone/app? we need to limit as much as possible going into railway. ... Just not sure if its
worth saving for over 7/14 days if its not being used again."*

**Yes to forever, on both sides.** The server has no cleanup job; the phone mirrors what
`getSyncDelta` sends (`foodItemsReferenced` + `foodItemsCreated`) and the local store has no
`DELETE FROM food_items` at all.

**Measured 2026-08-26:**

| Measure | Value |
|---|---|
| Whole production database | **187 MB** |
| `food_items` + `food_logs`, both | **288 kB** — 0.15% of it |
| The owner's food items | **209** |
| …logged exactly once | **170 (81%)** |
| …unused for 14 days | **114 (55%)** |
| …never logged at all | 26 |

**The reuse instinct is right and the deletion rule is still unbuildable.** `food_logs.food_item_id`
is `ON DELETE RESTRICT`, so an item referenced by any log cannot be removed while that log exists —
"expire items unused for 14 days" is really "delete 14 days of history first". A retention sweep
could only ever take the 26 never-logged orphans, about **10 kB**.

**So the lever is acquisition, not expiry**, which is what BF-35 already recommends: take an image
only where one arrives free, never generate one. An image never fetched needs no rule to clean up.

That is worth writing down rather than answering in chat, because the next person to have this idea
will have it for the same good reason, and the foreign key is not visible from the feature
description.
