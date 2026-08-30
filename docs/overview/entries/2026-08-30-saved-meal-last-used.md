# 2026-08-30 — My Foods can finally sort by what you actually eat

**Lane A · branch `chore/lane-a-queue-next` · BF-39's small follow-up, unblocked by its own migration**

Q-395c filed this as a constraint rather than a defect: *"`food_logs` carries no `saved_meal_id`, so
a saved meal has no last-used timestamp **at all** … True MRU needs a column that does not exist —
Lane A's to add."* BF-39 added the column this morning; this is the read it exists for.

`listSavedMeals` now returns `lastUsedAt` and orders most-recently-eaten first. A meal never eaten
sorts last, keeping the `createdAt DESC` order it already had — so saving a meal does not drop it out
of sight while it waits to be used for the first time.

## Derived, never stored

A `last_used_at` column would need a write on every log and an un-write on every delete, and it is
wrong forever the first time either is missed. That is the shape of every stored counter this project
has had, and all of them have drifted. `max(food_logs.logged_at)` is the answer at read time, and
`idx_food_logs_saved_meal_recent` (migration 238) is the index it reads.

## Three details that are load-bearing

**One grouped query, not a correlated subquery.** The first version put the same subquery in the
`SELECT` and again in the `ORDER BY`. The ordering worked and the selected value came back `null`,
which is a good illustration of why one formula in two places is a bad trade even when both are
"the same SQL". It is one grouped read and a JS sort now, so the rule that decides the order exists
once.

**The sort depends on `Array.prototype.sort` being stable** (guaranteed since ES2019). Ties keep the
order they arrived in, which is what makes the query's `ORDER BY created_at DESC` the secondary sort
without repeating it in the comparator.

**Scoped `eq(userId)` as well as by meal id.** The foreign key does not stop a row owned by someone
else naming this meal, and matching on the id alone would both mis-sort the list and leak when they
ate. There is a test that inserts exactly that row.

## Verification

- Full suite **655 files / 5419 tests passed**; `pnpm check:rules` **Ran 62 of 62**; `tsc` clean.
- **6 mutations, every anchor asserted, all 6 caught**: dropping the sort, sorting never-eaten first,
  dropping the user scope, counting deleted logs, `min()` instead of `max()`, and not returning the
  field at all.

**Not exercised: the S25.** The ordering is server-side and reaches the phone on the next deploy with
no APK rebuild, but nobody has looked at the list. The visible change is small and safe in the sense
that matters — no data moves, and the worst case is a list in an unexpected order.
