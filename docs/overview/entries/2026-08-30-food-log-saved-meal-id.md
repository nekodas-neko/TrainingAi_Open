# 2026-08-30 — A logged meal stops being a meal

**Lane A · branch `feat/food-log-saved-meal-id` · BF-39, engine half · migrations 238 + 239 · SQLite v31**

The owner's report is literal: *"when I add a meal from ai; it breaks it down into its components
and floods the list. we need to be able to create an over arching food and have the ingredients and
macro break down inside of it."* The screenshot is one AI-logged breakfast rendered as **eight**
diary rows — flour, protein powder, baking powder, salt, milk, eggs, butter, bacon.

Logging a saved meal writes one `food_logs` row per ingredient, and **nothing recorded that they
came from a meal**. Its identity was gone the moment it was logged.

## Two ids, not one

`saved_meal_id` is **what** was eaten. `meal_group_id` is **which time**.

That is the whole design and it is worth stating plainly: two servings of the same meal on the same
day share a `saved_meal_id`, so grouping on that would merge them and the second serving would
vanish into the first. The diary groups on the group; the group is named from the meal.

## The shape the entry recommended, and the one it rejected

**Built: one row per ingredient plus a grouping key.** Additive — a log row is still a log row, and
`food_logs` is read by the diary, the energy balance, the adaptive-TDEE window, the sync delta and
the local store, none of which changes.

**Not built: one row per meal.** The owner reached for it (*"maybe it needs to stay as a whole
item"*), and the entry's own reasoning is why it lost: it would introduce a second row shape into a
table five consumers read, and editing one ingredient of a logged meal would mean decomposing it
anyway. The owner's phrasing asks for the outcome, not the storage — one thing eaten shows as one
entry, which grouping delivers.

## The whole offline chain, in one change

CLAUDE.md's rule is that a new column on a synced table lands on the local table, the queued
payload, the push branch and the pull mapping together, because that is exactly where it gets
half-done. All of it:

`logMealItems` (one group id per **call**, both the local and the web-fallback path) → the outbox
payload → `pushMutations` → `createFoodLog` → `getSyncDelta` → `pullDelta` → `applyDelta` → the
local `getFoodLogsWithItems` read. Local SQLite **v31** adds both columns in the `CREATE TABLE` body
*and* an `ALTER`, with `RECONCILE_COLUMNS` rows — the body alone reaches fresh installs only, which
is the trap `check-local-column-upgrade-path.js` exists for.

## Three decisions worth not re-litigating

**`ON DELETE SET NULL`, and it is load-bearing.** `deleteSavedMeal` is a **hard** delete, so the
default `NO ACTION` would make a saved meal permanently undeletable the moment it had been eaten
once. A log is a record of having eaten something; deleting the recipe afterwards must neither erase
that nor be blocked by it. The rows keep their `meal_group_id`, so a diary can still group them once
the meal is gone. There is a test for exactly this.

**`savedMealId` is ownership-checked on both write paths.** It is a client-supplied row id like
`mealTypeId` and `foodItemId`, and a log naming someone else's meal would render their name and
picture in this user's diary. `foodLogRefsValid` takes it as an optional fourth argument; the web
route and the push branch both pass it.

**The push branch types the fields rather than `String()`-coercing them.** `String(undefined)` is
the literal `"undefined"`, which a uuid column rejects at the driver — and a driver error inside the
push loop is a poison pill the outbox quarantines, costing a whole log over an optional field.

## What mutation testing changed about the code

Ten mutations with asserted anchors, **eight caught**. The two survivors were both informative
rather than gaps:

- **A no-op of my own making.** `const mealGroupId` → `let` changes nothing until something
  reassigns it; the reassignment variant was caught immediately. Reported as malformed, not as a
  coverage hole.
- **The upsert arm is inert with today's callers** — the only id-bearing caller is the offline push,
  and a replay carries the payload it carried the first time, so nothing there changes a value.
  Kept anyway, for the reason CLAUDE.md gives about inert cache invalidations: it becomes
  load-bearing the moment a caller updates a grouping, and the alternative is finding out then.

**One mutation changed the code rather than the tests.** The arm was first written as
`savedMealId: rest.savedMealId ?? null`, which reads as equivalent to setting it only when supplied
and is not: it makes **every id-bearing upsert that does not know about meals silently strip the
grouping off a row that had one**. Now it sets each column only when the caller provided it, and a
test pins that a later quantity-only upsert leaves the grouping alone.

## Verification

- Full suite green; `pnpm check:rules` **Ran 62 of 62**; `tsc` clean; lint 0 errors (120
  pre-existing warnings, unchanged).
- 14 DB-backed cases covering both columns, the ownership refusals, the FK-after-delete, the sync
  delta, the replay, and three push-branch cases — including a plain single-food push with no meal
  fields, which is the shape that would break at the driver.
- Migration 239 regenerates the `claude_ro` views so the two columns are readable. **A new file, not
  an edit to 236:** `ensureSchema` tracks by filename, so an edited already-applied migration is
  skipped forever and the change would silently never land.

**No version bump.** Nothing renders differently — the diary grouping is Lane B and is not built, so
there is no user-visible change to describe. The columns are stored and read by nothing yet.

**Not exercised: the S25.** The local-store half (v31, `upsertFoodLog`, `applyDelta`, the grouped
local read) does not run in `pnpm dev` or Playwright. The v31 upgrade is the specific risk — this
project has had the local DB silently dead twice from migration bugs, and both times every local
read returned empty.

## Owed, and recorded on the entry

- **Lane B:** one collapsed parent row per group with the meal's name and photo, expanding to the
  ingredients. Both halves, per the re-report.
- **Lane A (small):** true MRU for My Foods — `max(logged_at)` per `saved_meal_id`, which
  `idx_food_logs_saved_meal_recent` exists for. Q-395c filed the absence as a constraint; it was
  this column.
- **Nothing back-fills.** Meals logged before today have both columns NULL and will keep rendering
  as loose ingredients. Which rows belonged together is not recoverable.
