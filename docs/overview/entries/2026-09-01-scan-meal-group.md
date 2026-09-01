# 2026-09-01 · Lane A — a scanned meal gets a group, and a name (BF-97, engine half)

Branch `lane-a/scan-meal-group`. Migration **252** (`food_logs.meal_group_name`) plus **253**, the
`claude_ro` regeneration the new column requires. Local SQLite **v33**. No native change.
**Not device-verified**, and **nothing looks different yet** — see the last section, which is the
point rather than a caveat.

## The bug is a rule that was right, meeting a case it did not cover

BF-39 shipped diary grouping for **saved meals**: the rows share a `meal_group_id` and the group is
named from the `saved_meal_id` they also carry. The owner's report is that scans do not group, and
`groupDiaryEntries` says why in its own words — it refuses to head a group it cannot name, because
*"heading them 'Meal' would be inventing a name the app does not have"*. A scan has no saved meal,
so it has no name, so it cannot group. Eight ingredients, eight rows.

The entry offered three ways out and recommended the first, which is what this builds: **a group may
carry its own name instead of a saved meal.** The two rejected options are worth restating because
they are the tempting ones — having a scan create a saved meal puts a row in the user's library to
satisfy a display rule, and grouping on the id alone reintroduces exactly the unnameable group the
existing rule exists to refuse.

## `meal_group_name`, denormalised, for the reason `meal_group_id` already is

There is no group table: a group **is** the rows sharing an id. Adding one would mean a new synced
domain, an outbox domain, a local table and a pull mapping — for one string — and the local store
would then need a join it does not have to draw a header offline. So the name sits on every row of
the group, the same shape as the id beside it.

The write path mints **only alongside a name**, and only for more than one entry:

```ts
const mealGroupName = entries.length > 1 ? normalizeMealGroupName(groupName) : null
const mealGroupId = mealGroupName ? crypto.randomUUID() : null
```

Both halves are asserted, and both are negatives. A group of one is collapsed back to a plain row by
`groupDiaryEntries` anyway, so an id there would make a row render as a meal for one frame and then
not. And a batch with no usable name must mint nothing, or the diary is handed the un-nameable group
its own rule refuses — the bug, rebuilt one layer down.

## One normaliser, three writers, and it truncates rather than rejecting

`packages/shared/src/nutrition/meal-group-name.ts` is the only place that decides what a group name
is. Three surfaces write one: the web route, the `pushMutations` branch, and `logFoodEntries` on the
device — the exact shape the sibling-surface rule is about, and the value is model-authored text from
a photo scan, so "the client already trimmed it" is not a guarantee any of the three may lean on.

**It truncates at 120 characters instead of refusing.** An over-long name reaches the push branch
inside an outbox mutation, and a 4xx there is a poison pill the outbox quarantines — losing the whole
food log over a display string. Nothing about a long name makes the log wrong.

## Five mutations, five caught

The chain a new column on a synced table normally half-finishes, tested by breaking each link:

| mutation | caught by |
|---|---|
| mint a group for a single entry too | *mints nothing for a single entry* |
| drop the name from the outbox payload | *queues the grouping in the outbox payload* |
| drop the name from the push branch's write | the two push-branch storage cases |
| `?? null` in the upsert's conflict arm | *does not strip an existing name* |
| drop the column from the sync delta select | *carries the name in the sync delta* |

The `?? null` one is BF-39's lesson re-run rather than restated: it reads as equivalent and is not —
it would make every id-bearing upsert that knows nothing about groups strip the name off a row that
had one.

**What is NOT tested here:** the local SQLite half. The column, the v33 upgrade, the reconcile row,
the two upsert arms and the offline read are written by the same rules as their BF-39 siblings and
are verified by reading, not by running — native SQLite does not exist in this sandbox. That is the
device check the entry now carries.

## Nothing looks different yet, deliberately

`groupDiaryEntries` still requires a `savedMealId`, so a scan renders exactly as it did before this
PR. The ids and names are being written; the rendering rule that reads them is Lane B's half and is
what the backlog entry now holds. An engine half that changed the screen halfway would be the worse
outcome — this one cannot.

One call site in a Lane B file changed with it: `food-logger-sheet.tsx` passes the dish name the user
just confirmed. Writing the column without it would have shipped a column nothing populates, which is
the failure mode the entry itself names.
