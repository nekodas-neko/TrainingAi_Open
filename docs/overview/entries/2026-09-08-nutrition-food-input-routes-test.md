# 2026-09-08 — the food-input path gets tests, and the trap recurs immediately (PS-39)

**Branch:** `test/nutrition-food-input-routes` · **Lane A** · PS-39, coverage ratchet **70 → 66**.

## What shipped

`lib/__tests__/nutrition-food-input-routes.test.ts` — 29 cases over `nutrition/barcode`,
`nutrition/food-search`, `nutrition/recent-for-meal` and `nutrition/saved-meals`. No product change.

Batched because they are the four ways an item reaches a meal — scan it, search for it, reuse
something recent, reuse something saved — and two share one flaky third-party dependency whose
failure modes are the point. Now pinned:

- **"The database is down" and "your food is not in it" are different answers.** One offers a retry,
  the other sends you to the photo scanner. Collapsing them told the user their food was unknown
  during Open Food Facts' 2026-08-13 outage. 503 `unavailable` and 404 `notFound`, never one for the
  other — including when the lookup *throws* rather than returning null.
- **A failed lookup reaches `error_events`, not just the console.** When the owner reported barcode
  scanning broken there was no record to read, and the cause is now unrecoverable.
- **`food-search` matches whole words in the name**, because OFF's free-text search matches
  ingredient lists — "milk" legitimately returns cheddar — and a substring match puts "Milka" at the
  top of a search for milk.
- **Region first, widened only when too thin**, and unavailable only when BOTH pages fail.
- **`origin: 'barcode'`** is what makes the stored row say where it came from (BF-70); `confidence`
  cannot, since the mapper sets 'high' for text search too.
- **A refused saved-meal write is a 400, not a 500** — the outbox retries 5xx forever and
  quarantines 4xx, so a write that can never succeed must not look retryable. A genuine fault still
  propagates.

## The trap recurred while its own warning was being written

The previous PR added a checklist to PS-39 for the defect three earlier batches had produced: *a
fixture that trips two rules at once tests neither*. **This batch produced two more.**

- A **single-word query cannot tell `every` from `some`.** The whole-word rule was tested only with
  "milk", so replacing "every term matches" with "any term matches" changed no answer. Two-word
  cases now separate them, plus one where the brand supplies the missing word.
- A product with **empty nutriments cannot tell "no product" from "no usable product"** — the mapper
  rejects it either way, so the route's own `!data.product` guard was deletable. A `{ status: 1 }`
  with no product at all is its own case now.

That it recurred immediately is the argument for the checklist rather than against it, and PS-39
records the count rather than a retelling. The schema fixture was also wrong in a way the schema
caught first: `multiplier` where the field is `quantityMultiplier`, which failed three cases at once
until the field name was read rather than assumed.

## Mutation pass — 40 mutations, 2 survivors, both fixed

Both are the recurrence above. Everything else — the 503/404 split, the reporting call, the origin
stamp, the thumbnail's must-not-fail-the-scan behaviour, the region widening, the dedup, the
shorter-name ranking, both rate limits, the `servings` default and the deliberate absence of a
`mealTypeIds` default — was caught first time.

## Not exercised

Web/Node only. Open Food Facts is stubbed at the network seam (`offFetchJson`,
`fetchOffThumbDataUri`) while the product mapper stays real, so the mapping and its serving-size
arithmetic are exercised but no live OFF call is. No device run: server routes with no native,
safe-area, gesture or notification surface, and the repository is mocked, so no Postgres path and no
drifted production data.
