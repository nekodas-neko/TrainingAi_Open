# 2026-08-30 — Nine percent of My Foods was the same food, written again

**Lane A · branch `fix/food-item-duplicate-create` · BF-38 (the exact-match half) · v1.395.2**

The entry came from a screenshot the owner sent about something else: `LOADED MAC & CHEESE / CORE
POWERFOODS / 350 g / 672 kcal` appearing twice in a 24-item list. Nothing had ever checked, at any
layer, whether a food being created already existed.

## Measured before building, and it moved the plan twice

Against production, 2026-08-30 — **221 `food_items`, 200 distinct name+brand, 21 redundant** (the
entry's own figures, taken four days earlier, were 209 and 19; it is still growing). By source: `ai`
215 rows / 195 distinct, `barcode` 3 / 2, `text` 3 / 3.

**The entry said to start with the barcode case, "the unambiguous one", and that premise does not
hold.** `barcode` is **NULL on all 221 rows — including all three whose `source` is `'barcode'`.**
The column exists, the route stores it, the Zod schema accepts it, Q-131 even fixed the offline push
branch to pass it through. Nothing ever fills it: `NutritionScanResult` has **no `barcode` field**,
so `/api/nutrition/barcode` validates the code, looks the product up, and returns a payload without
it. A barcode key would have matched nothing at all.

**The `ai` case was assumed to need a fuzzy rule, and mostly does not.** The assumption was that a
model naming the same food twice will not produce byte-identical strings. Measured, it usually does:
of the 17 duplicate groups, **8 agree on every field** once case and whitespace are normalised, and
those hold **10 of the 21 redundant rows**.

## What shipped

`foodItemIdentityKey` (`packages/shared/src/nutrition/food-item-identity.ts`) decides it once, on
exact identity: normalised name and brand — case and whitespace only — plus **every number a log
depends on**: serving size, calories, protein, carbs, fat. Grams round to 0.1 and calories to an
integer, which is exactly what `sanitiseNutrition` and the integer column already store.

**Both write paths check, and they check differently on purpose.** The interactive route passes
`reuseExisting: true` and uses whatever id comes back. The offline push does **not**: it arrives with
an id a queued `food_logs` mutation already references, and `food_logs.food_item_id` is
`ON DELETE RESTRICT`, so handing back a different id would strand that log against a row the server
never created. The device de-duplicates *before* it mints an id instead, against a new
`findFoodItemsByCalories` — the same calorie prefilter the server uses, so the two cannot disagree
about which rows to consider. Deliberately **not** `searchFoodItems`, whose `LIMIT 20` a short name
like "Rice" can fill with substring matches, which would make the check silently weaker on the
device than on the web.

The server prefilters on `calories` alone: an integer column, exact, and needing no text
normalisation in SQL. Re-implementing the name normalisation in SQL would be one formula in two
languages, drifting from the day it was written; `findDuplicateFoodItem` is the only thing that
decides.

## The half that is deliberately not merged, and why it is not a weaker rule

The other 9 groups split two ways, and neither is waiting for a looser match:

- **One food at two servings** — `mandarin` at 42 kcal/80 g and 53 kcal/100 g, plus capsicum,
  edamame, mozzarella, parmesan, pizza sauce. Identical density. A calories-per-gram rule would
  merge them — and because `food_logs` stores a multiplier **against the item's serving size**,
  reusing the 100 g row for an 80 g entry does not lose a row, **it changes what the new log means**.
- **Two estimates that disagree** — `protein bar` (Carman's) reads **137 and 342 kcal at the same
  40 g**; `bolognese potato bake` 483 vs 528 at 350 g. One of each pair is simply wrong, and merging
  picks a winner silently.

Closing those means showing the owner the conflicting pairs and asking. BF-38 stays queued with a
`Keep:` naming exactly that plus the barcode chain, and the entry's two falsified paragraphs are
rewritten rather than left to be re-read as true.

No history was touched, per the entry's own warning: `food_logs.food_item_id` is `ON DELETE
RESTRICT`, so collapsing the existing 21 means re-pointing logs first, and that is a separate
decision once the rule has been shown correct on new writes.

## Verification

- Full suite **647 files / 5356 tests passed**; `pnpm check:rules` **Ran 61 of 61**; `tsc` clean;
  lint 0 errors (120 pre-existing warnings, unchanged).
- **12 mutations, every anchor asserted before running, all 12 caught** — including reverting the
  route to the shipped state, making the push branch de-duplicate (which breaks the queued log's
  foreign key), dropping serving size / brand / macros from the key, removing the user scope from
  the prefilter, and skipping the device check entirely. Three survived a first pass and each was a
  real gap: the route's one boolean had no test at all, and two were resolved by *correcting a
  claim* rather than adding a test — see below.
- **Exercised on `pnpm dev` against the local database**, logged in as the seeded user: four POSTs
  to `/api/nutrition/food-items` — identical, identical again, a case-and-whitespace variant, and a
  genuinely different serving — produced **two** rows, with the first three returning one id.

**A survivor that was a wrong claim, not a missing test.** A mutation removing the calorie rounding
from the server's prefilter survived, and the test written to catch it **threw `22P02` out of int4
parsing**: `sanitiseNutrition` already returns `Math.round(calories)`, so no live caller can produce
a fraction, and passing one does not round, it errors. The rounding stays — `foodItemIdentityKey` is
a public helper and the column is an integer — but its comment now says it is a contract guard
rather than a fix for a reachable bug.

**Not exercised:** the S25 and the APK. The device half runs in `create-food-item.ts` against the
local store, and `getLocalStore` returns null in `pnpm dev` and in Playwright — so "logging your
usual lunch twice makes one row" is proven by unit tests and unverified on the only runtime that
matters. Recorded on BF-38's verification bullet and in `projectOverview.md`.

## Filed, not fixed

**LA-36** — `food_items.image_data_uri` is written to the device on every create and read back by
**nothing**. All three local read paths omit the column while the server's `rowToFoodItem` returns
it, so the local-first read that supersedes the API is the one that loses the picture — the
device-versus-web divergence the Canonical Runtime rule exists to prevent, pointing the wrong way.
`saved_meals` in the same file reads its image, which is why saved meals show pictures and foods do
not. Found while extracting the shared local row mapper this change needed; deliberately not folded
in, because it is a visible change on two Lane B screens.
