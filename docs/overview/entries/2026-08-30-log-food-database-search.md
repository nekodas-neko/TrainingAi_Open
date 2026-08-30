# Log Food reaches the food database (BF-48)

**Branch:** `fix/log-food-database-search` · **Lane B**

## What the report was

Owner, device pass N7: *"When I try add a food via the 'single food' section; it only searches
saved/history food - its not checking the food data base. So its not useful."*

It was exactly right, and the placeholder said so out loud — `Search your foods`, over an empty
state reading *"Single foods land here once you have logged them."* The screen for adding one food
could only find foods you had already eaten. The database search existed the whole time, in
`app/api/nutrition/food-search`, reachable **only** from inside the meal builder's ingredient
picker — so putting one new food in the diary meant building a meal around it.

## What shipped

The debounced Open Food Facts query moved out of `ingredient-picker.tsx` into
`lib/hooks/use-food-database-search.ts`, and the results section out of `ingredient-search.tsx` into
`components/nutrition/food-database-results.tsx`. Both screens now call the same two things. That
was the entry's own instruction — *"reuse `ingredient-search.tsx`'s call and its mismatch warning
rather than writing a second search"* — and the half most worth not duplicating is the warning: a
product's fields are filled in by different contributors, so it can state 96 kcal beside macros that
come to 122, and below the sanitiser's rewrite threshold that lands as-is. A second copy of that
threshold is a second place for a row to start looking verified when it is not.

`food-list.tsx` gained the section on its foods tab, plus the `useCallback`-stable
`addExternalFood`, which mints the food through the shared `createFoodItem` — the same two moves the
meal builder makes, so a food found here and the same food found there are the same row afterwards —
and hands it to the assign step.

**The search box on the foods tab is now unconditional.** It had been gated on the list being
non-empty, which is a defensible rule for filtering a list you own and exactly wrong once the box
also reaches a database: it hid the control in the state where it is most useful, and that is the
state the report was made from.

## Verification

`e2e/single-foods-database-search.spec.ts`, two tests, both run locally against `pnpm dev`:

- a stubbed product never logged before is found from Log Food → Single foods, shows the mismatch
  sentence, and tapping it opens the portion step;
- a one-character query does **not** reach the route, and a real one does — the 700 ms debounce is
  load-bearing, since OFF rate-limits to roughly ten searches a minute.

**Proved by mutation, not assumed.** With `dbVisible` forced false the first test fails and the
other three pass, which is the shape that says the guard is anchored to the fix rather than to the
screen merely rendering. The stub is deliberate: a live run would assert on a third party's uptime,
and this route measurably 503s.

`pnpm check:rules` — Ran 62 of 62. Typecheck and lint clean.

## Not exercised

- **The S25 APK.** This is JS-only, so it reaches the device through the Railway deploy with no
  rebuild — but the tap was not made on the phone, and the local store is null in the web sandbox,
  so `createFoodItem`'s **device** branch (local upsert + outbox + `findDuplicateFoodItem`) ran
  nowhere in this session. The web fallback POST is what the e2e exercised.
- **A live Open Food Facts response.** Every database row in the tests is stubbed. The route itself
  is unchanged, and its relevance filtering was not re-measured.
- **Offline.** The database section cannot appear offline, so there is no row to tap; the own-foods
  half is untouched.

## Left behind on purpose

Q-406's owed device press now has a shorter path — its `Keep:` line says so. The check itself is
still owed and stays on that entry rather than being claimed here: nothing about the amber caution
line was seen on the S25 in this session either.

## One line paid for elsewhere

`projectOverview.md` sits on a shrink-only ratchet and this entry's status paragraph put it two
lines over. Rather than raise the baseline, two lines of meta-narration came out of the section's
closing note — it was explaining *why* 157 old status notes were archived on 2026-08-17, which is
the archive's own business, not the index's. Net zero; baseline untouched at 8367.
