# A logged meal is one diary row that opens to its ingredients (BF-39)

**Branch:** `feat/diary-nested-meal-rows` · **Lane B**

Three owner reports across five days, from three screens. The clearest came with a screenshot of one
AI-logged breakfast rendered as **eight** diary rows — flour, protein powder, baking powder, salt,
milk, eggs, butter, bacon — filling the whole meal section: *"when I add a meal from ai; it breaks
it down into its components and floods the list. we need to be able to create an over arching food
and have the ingredients and macro break down inside of it."*

The engine half shipped separately (migrations 238 + 239, local SQLite v31): `food_logs` carries
`saved_meal_id` and `meal_group_id`, stamped by `logMealItems` on both write paths and threaded
through the outbox payload, the push branch, the sync delta, the pull mapping and the local read.
This is the read.

## Two rules, and they are the whole design

**Grouped on `meal_group_id`, never on `saved_meal_id`.** Two servings of the same meal on one day
share the meal and not the group. Grouping on the meal would report one helping where two were
eaten, which is the verification BF-39 asks for by name — and the mutation test proves the guard
fails when it is done the wrong way.

**A group needs a resolvable meal.** Nothing back-fills: meals logged before the columns existed
carry NULL in both and render loose, and so does a group whose meal has since been deleted. That is
correct rather than broken — the rows are still real food, and heading them "Meal" would be
inventing a name the app does not have.

A one-row group is not nested either. It would be a single food wearing a meal's name: the nesting
buys nothing and costs a tap.

## Shape

`diary-groups.ts` holds the rule as a pure function so it can be driven in `node` at all — both
vitest projects run there, and this is the part with the edge cases. `DiaryMealGroup` is the header
and the container; `meal-card.tsx` maps entries instead of logs and renders either a `DiaryRow` or a
group. **Collapsed by default, because the flood is what was reported** — and it opens to the
ingredient rows, each still tapping into the quick-edit sheet and still swiping to delete, because
"not a single opaque row that loses the breakdown" was stated as plainly as the rest.

`useSavedMealSummaries` supplies the name and the photo. **Local-first, because `saved_meals` is a
local-first domain**: every write goes to the on-device store and the outbox, so a UI reading only
the API would show a meal renamed offline under its old name until the next sync — the exact
inversion CLAUDE.md forbids. It shares the `saved-meals` cache key with the library sheet and the
plan picker (a second key for one endpoint is how this app has produced blank first paints before),
seeds synchronously so the rows do not appear loose for a frame and then regroup, and re-reads on
invalidation so renaming a meal or giving it a photo changes the diary without a remount.

## Verification

Ten unit tests on the grouping rule: a plain food untouched, a meal folded in its first-appearance
order, a group whose rows are not adjacent, **two servings staying two rows**, pre-BF-39 rows loose,
a deleted meal's rows loose, a one-row group not nested, and a row carrying only one of the two
columns not being a group.

Three e2e tests in `e2e/diary-nested-meal.spec.ts`: the meal is one row reading `3 ingredients` and
450 kcal with its ingredients **not** in the DOM; tapping expands it to all three plus the group's
own macro split; two `meal_group_id`s are two rows; and rows with the columns nulled render loose.
**Proved both ways:** group on `saved_meal_id` instead and the two-servings test fails.

Full unit suite **5,656 passed** / 674 files. `pnpm check:rules` — **Ran 62 of 62**. Typecheck and
lint clean. The neighbouring nutrition e2e set — swipe-delete, day navigation, tail order, logging
complete — **12 passed**.

## Not exercised

- **The device**, which is BF-39's remaining `Keep:`. In particular the group's name **offline**:
  `getLocalStore` returns null in the sandbox, so the hook's API fallback ran every time and its
  local-first branch never did.
- **A real logged meal.** The fixtures write `food_logs` rows directly with the two columns set;
  `logMealItems` stamping them is the engine half's own coverage, not re-proved here.
- **A meal with a photo in the diary.** `MealThumb` draws the placeholder when `imageDataUri` is
  null and the fixture meal has none, so the picture path is structurally exercised and visually
  unseen.
