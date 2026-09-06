# 2026-09-06 — BF-120 / OR-101: a meal section with one loose food shows its macros again

**Branch:** `fix/bf-120-lone-row-macros` · **Lane B** · v1.436.18

The owner, twice, from two device checks: *"1 meal doesnt show the calorie total; but 2 meals do"*
and *"No double; but not even a single one on my last logged meal."* A section holding one loose food
printed no protein, carbs or fat anywhere, while the section above it printed all three.

## The gate was a count and the question is a kind

`meal-card.tsx` suppressed the totals footer on `entries.length > 1`, and stated the reason twice —
at `:87` and `:148`:

> *"a single row already states its own macros, so a footer would repeat it"*

**True of a group row, false of a loose one.** `diary-meal-group.tsx` renders calories *and* P/C/F;
`food-row.tsx` renders name, a grey secondary line, calories, chevron — and nothing else, ever since
**Q-406** moved the per-item macros into the detail sheet so one row component could serve the diary,
the library and both search lists. The file holds the true statement and the false one that depends
on it, ten lines apart.

The decision moved to `components/nutrition/meal-card-footer.ts` as `mealFooter(kinds)`, which asks
what the only entry *is* rather than how many there are.

## Two reports, one defect, and the disagreement is worth keeping

BF-120 and OR-101 (filed by another session in the still-open #875) describe the same screen and
**disagree about the cause**. BF-120: *"This is a consequence of BF-98, not an unrelated
regression."* OR-101: *"It is not a regression from BF-98 — and that is the useful half."*

**OR-101 is right, and it is checkable.** BF-98's own case table lists *"one loose row → no footer
(unchanged)"*. It moved the gate from `logs.length` to `entries.length` to stop a single **group**
drawing its macros twice, which it did correctly and still does — asserted by the first test in
`diary-nested-meal.spec.ts`, which passes before and after this change. This case never had a footer.

**BF-120 is the better statement of the fix**, though, and is what shipped: render the macro row for
any section with content, keep the calorie total gated at two or more. With one entry the section
total *is* that row's number and the header prints it already, so a footer repeating it is the
redundancy BF-98 set out to remove.

## A third shape neither report names

`groupDiaryEntries` **demotes a group holding exactly one log back to a `'log'`** (`diary-groups.ts`
`:86`). So a saved meal with one ingredient arrives as a loose row and is treated as one — correctly,
because that is what gets rendered and it states no macros. "One saved meal" is not reliably a
`'meal'` entry, which is why the gate follows what is rendered rather than what was logged.

## Verified

`diary-nested-meal.spec.ts` gains the one-loose-food case, as BF-120 asked (*"extend that spec to the
one-loose-item case, which is the shape now visibly wrong and is reproducible"*). **6 passed**,
including the three pre-existing tests that pin BF-98.

The assertion is `toHaveCount(1)` on each macro rather than `toBeVisible`, because the count fails on
**0** (this defect) *and* on **2** (BF-98's duplication), so one assertion holds both directions.
Mutation-tested: restoring the old count gate fails the new test and leaves the other three passing.

Ten unit cases on `mealFooter`, two of which guard the **premises** rather than the behaviour — that
`food-row.tsx` still renders no macros, and that `diary-meal-group.tsx` still does. If macros ever
return to the diary row this footer becomes the duplication it was written to avoid, and the guard
fails instead of the screen.

**BF-98's own source guard failed, and updating it was the point.** It pinned the literal
`{entries.length > 1 && <MealTotals`, which this change replaces — so it caught the edit exactly as
intended. It now asserts the mechanism (`mealFooter(entries.map(e => e.kind))`) plus the *behaviour*
BF-98 protects, by calling the helper: one `'meal'` entry gets no footer. A guard on an expression
goes stale when the expression is refactored; a guard on the outcome does not.

Gates: `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 68 of 68** · lint clean ·
`check-doc-links` OK · full unit suite **6,562 passed / 0 failed**.

## Two environment findings, both of which cost time

**`zero-data.setup.ts` fails only on a cold `.next`.** It dies with a React Server Components manifest
error (*"Could not find the module … global-error.js#default"*) on the first run after the build cache
is cleared, and passes in **8.9 s** on the next. It presents as a broken sign-in page — the form never
renders, so `getByRole('button', …)` finds nothing — which is nothing like the cause. Worth knowing
while diagnosing a red E2E (LB-55).

**A dev server that survives many branch checkouts serves 500s with empty bodies.** After ~10
checkouts in one session, `/api/nutrition/meal-types` answered `200` with **0 bytes**, then `500` with
an FK violation. Restarting it fixed the first symptom; the second was a session cookie minted against
a different local database.

## Not exercised

**Not verified on device.** The change is a rendering condition, so the e2e run at 412 dp is close to
the real check — but the report came from the S25 and that is where it should be confirmed. Recorded
in `projectOverview.md`.

## Left behind

**#875 merged while this branch was open**, so OR-101 reached the queue as a live entry and is
removed here on shipping — which is tidier than the alternative this entry first proposed (closing
#875 as superseded). The queue now records that the defect was filed twice, from two device checks,
and fixed once.

**RV-49 was re-laned to A** on picking it up. The entry says Lane B, but the whole fix is in
`lib/cache-groups.ts`, which CLAUDE.md's path list names as Lane A's *and* which the lane rule
independently sends there — it is reached from `app/api/coach/apply/`. The call site the entry also
names needs no change, so there is no Lane B half to ship first.
