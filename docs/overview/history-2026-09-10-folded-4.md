# Session journal — batch folded 2026-09-10

Entries folded out of `docs/overview/entries/` by `scripts/fold-journal-entries.js`,
oldest-first. **Unlike earlier sweeps, entries cited by a durable doc were folded too** — every
citation was repointed here, at the `<a id="…">` anchor named after the entry's old filename.

<a id="2026-08-30-fix-pending-weighin-numeric-id"></a>

# 2026-08-30 — the weigh-in buttons work now (BF-53), Lane A

**Branch:** `fix/pending-weighin-numeric-id` · **Lane A** · no migration · user-visible fix, patch
version bump.

## What was wrong

`scale_raw_samples.id` is a `bigserial`, and both pending-reading routes ran `invalidUuidResponse`
over it. A decimal id can never match a UUID regex, so **every** press of "Not me" or "Yes, that's
me" returned `400 Invalid id` — the whole pending weigh-in triage was dead in production. A reading
that was not the owner's could not be dismissed; one that was could not be confirmed into
`body_metrics`.

The correct `Number.isInteger` check sat unreachable on the next line, which is the tell: whoever
wrote these knew the key was numeric, and the sweep that added `invalidUuidResponse` across the 30
dynamic `[id]` routes (Q-482) applied the UUID guard over the top of it.

**The client is why it survived.** `dismissReading` was `if (res.ok) setPending(…)` with no `else` —
no toast, no log — so a 400 was indistinguishable from a button doing nothing, which is exactly how
the owner reported it: *"the 'not me' button for weigh in's doesnt actually remove it or do
anything."*

## The fix

`numericRouteId` in `lib/api/route-errors.ts`, beside `invalidUuidResponse` and for the same reason
that one exists: so the **next** sweep over `[id]` routes finds a numeric key already guarded, by a
name that says so. It returns `{ ok, id }` so a caller cannot forget to parse.

It uses `/^\d+$/` rather than `Number.isInteger(Number(x))`. The latter — the guard that sat
unreachable underneath — accepts `'1e3'`, `'0x10'`, `' 41 '` and `'0'` as ids, none of which a
`bigserial` column ever produces.

Both handlers in `scale-pairing.tsx` now report a failed press through the error line the component
already renders. That half stands on its own: the route bug is fixed, and a future one will not be
invisible.

## The sweep, complete

`invalidUuidResponse` is used by 29 route files. Ten tables in `schema.ts` have a non-uuid primary
key, and five repository methods take `id: number`. Cross-referencing them: **these two routes were
the only pair**, and no other dynamic route reaches a non-uuid table.

`numeric-route-id-guards.test.ts` freezes that — it derives the number-keyed methods from
`repository.ts` (never a hand-list) and fails if any route calls one behind `invalidUuidResponse`.

## Verified

23 tests. The route tests are **DB-backed against real `bigserial` ids**, which is the point: a test
posting a UUID would have passed the old guard and 404'd, and read as correct. That is why the
existing coverage could not have caught this.

`pnpm dev`, against the same real pending row:

| | pre-fix | post-fix |
|---|---|---|
| `POST …/349/dismiss` | **400 Invalid id**, row untouched | `{"status":"dismissed"}`, row `dismissed` |
| `POST …/350/confirm` | **400 Invalid id**, row untouched | `{"status":"confirmed","weightKg":73.9}`, 73.9 kg in `body_metrics` |
| `abc` / `1e3` / `0` / `-1` | 400 | 400 |
| id that is not there | — | 404 |

Mutation-proven, anchors asserted first — five mutations, all killed: the loose
`Number.isInteger` guard restored, `0` accepted as an id, the UUID guard restored on dismiss (fails
7 cases, including the sweep test), the silent `if (res.ok)` restored on the client, and the file
clobber below.

## A mistake worth recording, because the tests did not catch it and the app would have

Mid-session the mutation-testing harness backed files up as `/tmp/$(basename $f).bak`. **Every Next
route file is named `route.ts`**, so `confirm/route.ts` and `dismiss/route.ts` collided on one
backup path and the restore wrote confirm's contents over dismiss. The two files went byte-identical.

The symptom on the dev server was `POST …/dismiss` returning `{"status":"confirmed"}` and flipping
the row to `confirmed` — **"Not me" confirming the reading**, which is strictly worse than the bug
being fixed. It took four measurements to attribute, because the obvious readings (a stale dev
server, a Turbopack routing bug, a duplicate process) all had to be ruled out first; the Next dev log
showed it compiling the right file, which made it look like a framework fault rather than a
self-inflicted one.

Two things came out of it. The DB-backed route test **does** catch it — but it skips in CI, so a
source-level case now asserts that dismiss calls `dismissScaleSample`, that it does not call
`confirmScaleSample`, and that the two files differ. And the general lesson: in this repo a backup
path keyed on a basename is unsafe, because `route.ts`, `page.tsx` and `layout.tsx` are all
non-unique by design.

## Not exercised

- **The device.** BF-53 stays in the queue with a `Keep:` for the S25 pass: a pending reading
  dismisses and disappears, a confirmed one reaches the weight card, both stay gone across a screen
  swap. The APK reaches this through a Railway deploy — no new build.
- **Production data.** The dev check ran against locally seeded pending rows, removed afterwards.
- **The BLE staging path** that creates a pending row was not exercised; the rows were inserted
  directly, which is what makes the ids realistic `bigserial` values.

<a id="2026-08-30-food-item-duplicate-create"></a>

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

<a id="2026-08-30-food-log-saved-meal-id"></a>

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

<a id="2026-08-30-food-log-swipe-delete"></a>

# A logged food swipes to Delete, and Delete still asks (BF-45 ⑤)

**Branch:** `feat/food-log-swipe-delete` · **Lane B**

Owner: *"for logging food; we could possibly add the option to swipe and delete it (with
confirmation) like we do in the other screen."* The meal library has had the gesture since BF-29;
the diary — where a mistyped entry is most likely to need removing — had only the bin behind a tap.

## Shape

`DiaryRow` wraps its `FoodRow` in the existing `SwipeActions`, with **one** action rather than the
meal list's three: label and edit belong to a saved meal, and a logged row's edit is the tap it
already has. The tray routes to `requestDeleteLog`, which is the same confirmation dialog the edit
sheet's bin raises, and **the bin stays** — a swipe is an accelerator for a thumb that knows it is
there, never the only route to a destructive action. That is `SwipeActions`' own rule, and the third
test pins it.

## Two things the meal list did not need

**The screen already owned the horizontal axis, and both gestures ran from one touch.**
`nutrition-content.tsx`'s scroll container carries a `useDrag` that steps the *day*. A row swipe fed
it too, so revealing a Delete also moved the list out from under the thumb. `SwipeActions` now marks
its root `[data-swipe-actions]` and the day handler defers to it — the same shape as the exclusion
`tab-swipe-navigator.tsx` already applies to a carousel, and it covers every future call site rather
than this one.

**This is invisible on today.** The day handler refuses to step past today, so on the current day the
second gesture is a no-op and the bug does not exist. It reproduces on any past day. Both e2e tests
therefore run on *yesterday*, and the guard is proved both ways: with the deferral removed, the
tray-opens-without-stepping test fails.

**The row surface has to be opaque**, or the tray shows through its own text. `SwipeActions`
hardcoded `bg-card`, which suits the meal list — an unpainted container — and is two steps darker
than the `bg-muted/60` meal card the diary rows sit in, so it would have drawn a band around them.
The primitive takes a `surfaceClassName` now, defaulted to what it always did.

## What the harness cost, which is most of the time this took

Three failures that all read as "the feature is not wired" and were none of them that:

- **The row's natural position is under the bottom tab bar.** Every touch point landed on a nav icon;
  the tray never moved and the tap never opened the sheet. Printing `document.elementFromPoint` at
  the tap coordinate is what found it — the target was an `<svg>`. Both helpers centre the row first.
- **The Next.js dev overlay.** `<nextjs-portal>` sits over the bottom-left corner; a coordinate tap
  that clips it opens its Route/Turbopack menu, which then covers the screen. `fixtures.ts` already
  works around this portal intercepting `locator.tap()`; this spec hides it instead.
- **`deleteFoodLog` writes a tombstone.** `SELECT 1 FROM food_logs WHERE food_item_id = …` counts a
  deleted row forever, so a working delete read as a failure. The count is `deleted_at IS NULL`, and
  that is the interesting direction: written the other way round, the assertion would have *passed*
  on a broken delete.

## Verification

Three e2e tests in `e2e/food-log-swipe-delete.spec.ts`, driving a real CDP touch drag (the technique
`meal-detail-artboard-parity.spec.ts` established): the tray reveals Delete and Delete raises the
confirmation **with the row still in the database**; the drag does not step the day; and the bin
inside the edit sheet still reaches the same confirmation. Asserting on the database rather than on
the row disappearing is the point — this app removes the row optimistically before the request
resolves, so a tray wired straight to the delete would look identical for the first frame.

**Proved both ways, twice.** Remove the `SwipeActions` wrapper and the first test fails; remove the
`[data-swipe-actions]` deferral and the second does.

Full unit suite **5,612 passed** / 669 files. `pnpm check:rules` — **Ran 62 of 62**. Typecheck and
lint clean. The nutrition e2e set — this spec plus `nutrition-day-navigation`, `nutrition-tail-order`
and `food-logging-complete` — **12 passed** on the merged branch.

## Not exercised

- **The device, which is where this actually has to work.** The sandbox renders at desktop width with
  a mouse-driven touch emulation; a real thumb on a 6.9" screen is the only test of whether the drag
  competes with vertical scrolling. BF-45's remaining `Keep:` is that check.
- **The offline delete path.** `getLocalStore` returns null in `pnpm dev` and in Playwright, so the
  confirmation's local-store branch — and BF-47's fix behind it — took the web fallback here every
  time. That is why BF-45 and BF-47 are checked in one pass on the S25.
- **A row that is mid-swipe when the list re-renders.** `AnimatePresence` removes the row on delete
  and `SwipeActions` unregisters its closer on unmount, but nothing here forces that race.

<a id="2026-08-30-log-food-database-search"></a>

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

<a id="2026-08-30-meal-label-style-gate"></a>

# The meal-label style gate was reading the previous style, every iteration (LB-19)

**Branch:** `fix/meal-label-repaint-signal` · **Lane B**

## What it looked like, and what it was

`meal-label.spec.ts` failed about one run in five with *"Ingredients · centred's code must decode off
the rendered label"* — a zxing decode returning null — and passed on a re-run. It had been filed as a
timeout, then re-filed as a repaint race. It is the second, and it is worse than intermittent.

The gate after clicking a style radio was:

```ts
await expect.poll(inkFraction, { timeout: 20_000 }).toBeGreaterThan(0.01)
```

The canvas already carries the **previous** style's ink at that moment. So the condition is true
before anything repaints — **a precondition satisfied by the state it is meant to replace cannot
fail.** The same shape as `goal-invalidation.spec.ts`'s seed assumption, which is the other half of
this entry, and the third instance of it this week.

## The measurement

Ink fraction at the instant the old gate released, against what it settled to:

| style | at gate | settled | previous style's settled |
|---|---|---|---|
| Ingredients · centred | 0.092238 | 0.080699 | 0.092238 |
| Black band | 0.080699 | 0.134665 | 0.080699 |
| Plaque | 0.134665 | 0.092238 | 0.134665 |
| Big code | 0.092238 | 0.174037 | 0.092238 |

`at gate` is the **previous** style's settled value, four times out of four. The decode loop was
decoding the previous style's label on every iteration — and passing, because **every style encodes
the same meal**, so the token matched regardless. The layout check that loop exists for had
effectively never run for three of its four styles. The null decode was the same defect on the runs
where the read landed mid-draw instead of on a complete stale frame.

## The fix, and why one signal is not enough

`selectStyle()` waits on two things.

The **`mm at N×N modules` line** the sheet reports is derived from the style, so it says the sheet has
switched. Probed: all six distinct — centred 18.5, black band 16.4, editorial 16.9, deli 17.7, plaque
20.9, big code 20.1. Its poll message names the previous style's figure, so a future style that
collides reports *"this signal cannot tell the two apart"* rather than hanging for twenty seconds.

**Then the ink must settle** — two identical consecutive reads. The sheet's text can update a frame
before the draw, and a repaint passes through a cleared canvas, so "ink changed" on its own can fire
on a blank one. Only a settled canvas says the paint is finished.

With the fix, `at gate` equals `settled` and equals that style's own value, four times out of four.

**Canvas dimensions were the other candidate the entry named, and they are not usable:** probed the
same day, every style renders **1179×1179**. Recorded so nobody measures it again.

## What was not achieved

**A deterministic reproduction of the original null decode.** Holding the previous paint for 900 ms
made the old gate read the stale canvas — that is how the table above was produced — but the decode
still **passed**, because a stale frame is a complete, valid label for the same meal. Clearing the
canvas early did not defeat the old gate either: it correctly waits out a blank one. The null variant
needs a read landing mid-draw, and that window would not open on demand. So the fix is justified by
what the old gate demonstrably *read*, not by a reproduction of the symptom that was reported.

Nothing the loop checks was weakened. It remains the closest the sandbox gets to the print test still
owed; it now runs against the style it names.

## Verification

`e2e/meal-label.spec.ts` — **5 passed, twice consecutively**, 4.3 min each. Typecheck and lint clean.
`pnpm check:rules` — Ran 62 of 62.

**Not exercised:** the printed label. Everything here is canvas pixels in a headless browser; ink
spread on paper is the check this spec explicitly cannot make, and it is still owed.

<a id="2026-08-30-meal-photo-data-url-fetch"></a>

# The meal photo was blocked by the app's own CSP (BF-46 ①b)

**Branch:** `feat/meal-photo-and-quantity-editor` · **Lane B**

Three reports across five days, all the same sentence: *"the photo still doesnt get added from this
screen at the top. not saving."* · *"Meal photo tile shows; but its always the default cant add a
custom picture."* The entry called it a save failure that *"does not reproduce in source"*. It does
reproduce in source — just not on any path a test in this repo can run.

## What it was

`MealPhotoTile.handlePick`, native branch only:

```ts
const photo = await CapCamera.getPhoto({ resultType: CameraResultType.DataUrl, … })
const blob = await (await fetch(photo.dataUrl)).blob()   // ← rejects
```

**A `fetch()` of a `data:` URL is governed by `connect-src`, not `img-src`.** This app's CSP
(`lib/security/csp.ts`) lists nine hosts and `wss:`/`ws:` there and no `data:`, so Chrome refuses
the call with a bare `TypeError`. It landed in:

```ts
} catch {
  // Cancelling the picker throws, and a cancel is not an error worth a toast.
}
```

So the picker opened, the user chose a picture, and the app did nothing and said nothing.

## Why three reports and a held rebuild did not find it

**The web branch never fetches.** `Capacitor.isNativePlatform()` is false in a browser, so the tile
clicks a hidden `<input type=file>` and hands the resulting `File` straight to the downscaler.
`e2e/meal-photo-picker.spec.ts` drives exactly that, asserts the stored bytes in Postgres, and
passes — it has passed on every run since Q-327. The one line that fails is on the branch no harness
in this repo executes.

That also explains the shape of the previous session's investigation, which instrumented the *web*
path, found the file arriving correctly, and concluded the component never received it. It was
looking at the half that works.

## The fix

`CameraResultType.Base64` and `dataUrlToBlob` — no fetch. `capture-actions.tsx`, the food scanner
the owner uses daily on the same device, already asks for `Base64`; the two paths now agree, and
the one that worked is the one that was copied.

**The catch is the other half, and arguably the more important one.** It swallowed every failure,
not just cancels. A picker cancellation is now matched on the plugin's message and everything else
toasts. If this fix is wrong, the next report will at least say *what* went wrong.

`lib/media/__tests__/no-data-url-fetch.test.ts` is a source scan: it asserts the CSP still has no
`data:` in `connect-src` — the fact that makes the rule necessary — and that no file under `app/`,
`components/` or `lib/` fetches a data URL. Comment lines are skipped, or the rule would flag its
own explanation. Proved both ways: reinstating the old line fails it, naming the file and the line.

## Verification

Full unit suite **5,633 passed** / 672 files (14 in `lib/media`, 8 of them new).
`pnpm check:rules` — **Ran 62 of 62**. Typecheck and lint clean. `meal-photo-picker.spec.ts` still
passes, which matters as a *non*-regression: the web path is unchanged and it is what proves the
downscale, the cap and the round-trip.

## Not exercised — and this one cannot be, here

**The device, which is the only place the fixed line runs.** The diagnosis is checkable from source
(the CSP has no `data:`; a data-URL `fetch` is a `connect-src` request; the replacement is the shape
that already works on the same device), and the outcome is not. **On the S25: Edit Meal → pick a
photo → save → reopen.** BF-46's `Keep:` carries it.

Also untouched: **(a), the placement** — one picker, at the top, at hero scale, and the removal of
the meal detail sheet's *Add a photo*, which calls `onEdit` and picks nothing. That is a layout
change with a held rebuild behind it and it is not what the three reports were about.

<a id="2026-08-30-meal-photo-one-picker"></a>

# One photo picker per screen, and the held rebuild's failure explained (BF-46 ①a)

**Branch:** `feat/meal-photo-one-picker` · **Lane B**

Owner: *"Yes I found the photo picker; its in two locations; once at the top of the page and once at
the bottom. I only want the one at the top."* Two things said *Add a photo* and **only one of them
was a picker**: the meal's own screen called `onEdit`, dropping you into the builder to find a 64 px
tile below `Add ingredient` at the bottom of a scroll.

## What shipped

Both are real pickers now, each at the top of its own screen, at the size the artboard gives a
meal's photo. The meal's own screen writes through the parent's `saveMealToLibrary` — the same
function the builder calls — so there is **one write path** to `image_data_uri`, which is what the
old comment there argued for and achieved by having no picker at all.

`MealPhotoTile` grew a `variant="hero"` rather than a `MealPhotoHero` being built beside it. That is
the load-bearing choice: the previous attempt built the separate component *with its own acquisition
hook* and could not make a picked image reach it, while this component's `<input>` path is what
`meal-photo-picker.spec.ts` has exercised on every run since Q-327. Growing a size is a smaller
change than growing a second implementation.

## The held rebuild's failure, explained

Rebuilt, the same failure reproduced exactly: `handleFile` fires with the file, `accept` runs with a
valid 4,247-character data URI and `reject=null`, `onChange` is called — and the builder's state
never moves.

**Instrumenting the parent settled it in one run.** A log on the builder's `onChange` prop *never
fired*, while the tile's own "calling onChange" did. So the tile that received the file was **the
other instance** — the meal's own screen, which is still in the DOM while it closes. Both pickers
carried the same accessible name, and the spec waited for that name before picking. It was already
satisfied by the screen it was leaving.

*A precondition satisfied by the state it is meant to replace cannot fail.* That is the third time
this shape has cost real time in a day — the meal-label ink gate, this file's `Ingredients` marker,
and now this. The spec waits for `Update Meal`, which exists only in the builder.

**So the app was right and the harness was wrong**, and the previous session's conclusion —
"the picture reaches nothing" — was a true observation with the wrong subject. Worth stating plainly
because that entry told the next person to start from the instrumentation rather than the layout,
and the instrumentation was measuring the wrong component.

## The cost of a second file input, which CI found

Moving the picker to the top of the builder put a **second `input[type="file"]`** on that screen,
ahead of the recipe-picture button's in DOM order. `recipe-image-to-meal.spec.ts` fed its picture
with the selector `input[type="file"]`, so the recipe went to the photo picker instead, silently,
and its ingredient rows never appeared. Reproduced locally before fixing.

Both inputs are **named** now — `meal-photo` and `recipe-picture` — and both specs select by name.
That is the same failure `meal-photo-picker.spec.ts` already carried a note about from the other
direction (*"the naive first-match silently fed the photo to the food scanner"*), so `name` retires
a hazard this screen had before this change rather than one it introduced. `pickPhoto`'s "exactly
one live input" guard stays: `name` says which control, aria-hidden says which layer.

## Verification

`e2e/meal-photo-picker.spec.ts`, now three tests. The two that existed still pass unchanged in
substance — a photo-sized JPEG is downscaled below `SAVED_MEAL_IMAGE_MAX_BYTES`, stored as WebP, and
a save that never touches the tile keeps it. The new one picks from **the meal's own screen** and
asserts the stored row, which is the affordance that was fake. **Proved both ways:** point that
hero's `onChange` back at `onEdit` and it fails.

Its readiness gate is `Log this meal`, which exists only on that screen — the same discipline the
first test now uses, and for the same reason.

`recipe-image-to-meal.spec.ts` passes again with the named selector; both files, **7 passed**.

Full unit suite **5,640 passed** / 672 files. `pnpm check:rules` — **Ran 62 of 62**. Typecheck and
lint clean.

## Not exercised

- **The device.** Nothing here is native — the acquisition path is unchanged, and BF-46 ①(b)'s CSP
  fix (v1.400.0) is what makes the *native* branch work at all. But no photo was picked on the S25,
  and BF-46's `Keep:` is that check.
- **A meal saved while offline.** `setMealPhoto` takes `saveMealToLibrary`'s local-first branch like
  every other meal write, but the sandbox has no local store, so the web fallback ran every time.
- **Two pickers genuinely co-visible.** They are on different screens and one closes as the other
  opens; what was measured is that both are briefly *mounted*, not that both are ever usable.

<a id="2026-08-30-module-map-shared-paths"></a>

# 2026-08-30 — The map that stops you re-implementing things was wrong 108 times

**Lane A · branch `fix/module-map-shared-paths` · LA-35 · filed and fixed the same day**

`CLAUDE.md` names this trap under **One Formula, One Place**:

> Most of it is in `packages/shared/src/`, not `lib/` — the monorepo extraction moved it and this
> rule kept saying `lib/` for months (Q-153). Check `docs/module-map.md` for where a given formula
> actually is rather than guessing a directory.

The map it sends you to was wrong the same way. **108 paths across 8 orientation documents** — 92
files and 16 directories — named `lib/<x>` for something living at `packages/shared/src/<x>`. The
filed figure of 34 counted only the distinct `lib/health/*.ts`; the sweep found the rest.

## Why it survived a check written to catch exactly this

`scripts/check-index-doc-paths.js` exists (Q-554) so an orientation doc cannot name a path that does
not exist. Its `resolves()` ended with:

```js
'packages/shared/src/' + p.replace(/^lib\//, '')
```

So a `lib/` path resolved whenever the file turned out to live under `packages/shared/src/`, and all
108 reported OK. That is not a lenient edge case — it is **the** error class the map exists to
prevent, whitelisted inside its own guard.

**The sibling check never had this bug, and the difference is one line.**
`scripts/check-claude-md-paths.js` uses the same string only to build an error *hint* —
`-> moved to packages/shared/src/…` — and fails anyway. That is the right shape: it makes the
failure actionable without accepting it. The index check now does the same, so a wrong path both
fails and tells you where the file went.

## What shipped

- **108 path corrections**, applied programmatically and each verified with `existsSync` against
  both the old and the new location — nothing was renamed on a guess.
- **The fallback deleted** from `resolves()`, with the reason recorded beside the deletion.
- **The hint added**, ported from `check-claude-md-paths.js`.
- `scripts/__tests__/index-doc-paths-no-shared-fallback.test.ts` — four cases pinning that the
  fallback is gone from `resolves()`, that `packages/shared` appears nowhere in that function, that
  the reason survives with it, and that the failure message **does** still name the moved location.

**The test's first version was wrong, and its own failure said how.** It asserted over the whole
file, so adding the hint turned it red — which would have argued for dropping the hint rather than
the fallback, exactly backwards. Scoping the two prohibitions to `resolves()` and adding a fourth
case that *requires* the string in the error message is what encodes the real rule: **where** it
appears is the whole distinction.

That last one is the point of the test. Restoring the fallback makes the check **pass more**, which
is the direction nobody investigates, and a shorter list with no explanation reads as an oversight
somebody would helpfully "fix".

## Verification

- `check-index-doc-paths` — **963 paths across 12 orientation docs**, all exist, with the fallback
  gone.
- `check-module-map-symbols` — 163 `path → symbol` claims still resolve after the rewrite, which is
  what says the corrections landed on the right files rather than merely on existing ones.
- `pnpm check:rules` — Ran 62 of 62. Full suite green.
- **3 mutations, all caught**: restoring the fallback, deleting the reason, and reverting one
  corrected path to `lib/`.

**Nothing user-visible; no version bump.** Docs and one CI script.

**A note on the 🟢 row this does not contradict.** `projectOverview.md` records the module map's
`path → symbol` claims as holding, 110 of 110. That check
(`check-module-map-symbols.js`) verifies a symbol is attributed to the right *file*; it never
verified the file was in the right *directory*. Both were true at once.

<a id="2026-08-30-nutrition-ui-uplift"></a>

# Nutrition UI uplift: eight fixes shipped, two built and held (BF-45, BF-50, BF-51)

**Branch:** `feat/nutrition-ui-uplift` · **Lane B** · batch `nutrition-ui-uplift`

Two device passes (N4, N5) plus BF-45's screenshots. Eight items shipped; two were built, measured,
and deliberately not shipped — the measurements are on their entries and are the more useful half.

## Shipped

**The macro ring started at 9 o'clock, at all three call sites (BF-45 ④).** `conic-gradient(from
-90deg, …)`. In CSS a conic gradient already starts at 12 o'clock — 0deg is the top. `from -90deg`
is the **SVG/canvas** idiom, where 0° is at 3 o'clock and you subtract 90° to reach the top; carried
into CSS it rotates the start a quarter turn counter-clockwise. Home's ring had it identically and
nobody had reported it. The fix is dropping the clause.

**A collapsed meal kept its calories and lost its macros (BF-45 ②).** The totals footer lives inside
`CollapsibleContent`, so it left with the rows. The collapsed card now carries the same line below
its header — the shape the owner corrected to on the device (*"it should still show the total
calories and total macros below it"*), not the macro-trio-in-the-header the entry first proposed.
One `MealTotals` component serves both states, so they cannot report different numbers for one meal.
It shows from **one** log where the expanded footer needs two: open, a single row already states its
own macros; collapsed, nothing does.

**`My Meals` spans both columns (BF-45 ①)** — three buttons in a two-column grid left it beside dead
space. The diff says outright that the span is a *consequence* of the empty slot, so a fourth action
takes it back.

**Bottom-sheet gutters are 16 px (BF-45 ③ / BF-51 ④) — and not where the entry said to put them.**
It called for `SheetContent`'s bottom variant, "fix it once". Measured first: **26 of 48** bottom
sheets set their own `px-*` or `p-0`, and of the remaining 22 most already pad their inner content at
16 px (`water-log-sheet`, `time-picker-sheet`, `log-value-sheet`). A shared outer gutter would have
doubled theirs — a nutrition entry regressing the whole app. The nutrition sheets were the outliers
at `px-1` (4 px) against artboards that specify 16; those are what moved, plus the meal builder's
footer, which is a *sibling* of the scroll body rather than a child and so ran its Save button to
the sheet edge while the ingredients sat 16 px in.

**The Log Food capture row (BF-50 ①②③④).** Tiles are 62 px, from the artboard rather than a number
invented here — `min-h`, because "Describe or enter" wraps to two lines in a third of 412 dp. The
describe pane fills the sheet it is in (it had no `flex-1`, so an 80 px box sat at the top of a 90vh
sheet). Photo opens the camera directly — `CameraSource.Camera`, not `Prompt` — with the gallery
kept as its own text-weight control, because nothing can add a button to Android's camera UI and the
entry said explicitly not to drop it. And `Select` on the Meals tab is now `Delete meals`: deleting
is all it has ever done, and multi-log is a screen (a meal type and a portion per meal), not a label.

## Built, measured, held — and why that is the right outcome

**The two photo controls (BF-46 ①(a), BF-51 ②).** Built in full: `useMealPhotoPicker` for the
acquisition, `MealPhotoHero` for the band, the builder's tile lifted to the top, the meal's own
screen's *Add a photo* made a real picker writing through the same `saveMealToLibrary`,
`MealPhotoTile` deleted. Then the picker stopped working, and instrumenting it says the file arrives
(`size=442985`), the re-encode succeeds (**4,247 chars**), the cap passes (`reject=null`) — and the
component never receives it. That is close enough to BF-46 ①(b)'s *"I saved it; and it didnt show"*
that it is probably the same defect, and (b) says to reproduce on the device first. Full measurement
is on BF-46.

**The builder as its own back surface (BF-51 ①).** One line —
`useSheetBackDismiss(open && tab === 'build', backToMeals)` — gives exactly the asked-for behaviour
and makes `meal-photo-picker.spec.ts` fail at `page.goto` with `net::ERR_ABORTED`. Reproducible;
passes on `main`; passes here with that line disabled. The popped history entry is what every other
sheet does, so the app may be right and the spec merely first to navigate straight after a
button-close of a nested surface — but `sheet-back-stack.ts`'s three previous bugs were **all** found
on a device, and "it destabilises a spec" is not a diagnosis. Held rather than shipped, and
explicitly not resolved by loosening the spec.

## What the sandbox could not judge

Every one of these is a **layout or gesture** change on a phone, and none was seen on the S25. The
web sandbox renders safe-area insets as 0, so ③'s gutters are unverified there by construction;
a ring's start angle, a 62 px tile and a collapsed summary line are all size judgements at 412 dp.
`CameraSource.Camera` and the gallery route are **native**, so neither ran at all — the web path
falls back to a file input. Treat all eight as shipped-but-unverified until the device pass.

## Verification that did run

`pnpm check:rules` — Ran 62 of 62. Full unit suite: **5,482 passed**, 660 files. The meal and
library e2e specs (photo picker, empty library, both artboard-parity specs, edit-meal footer,
shared food row, meal thumb) — **13 passed** on the final tree, after the two holds.

A note on method that cost real time: **every e2e result taken while editing files was unreliable.**
Fast Refresh left the browser on a mixed build, and one run "passed" a change that could not work.
Every measurement quoted here was re-taken against a cold dev server, and the passing run that
disagreed is recorded on BF-46 as the artefact it was.

<a id="2026-08-30-pending-delete-resurrection"></a>

# 2026-08-30 — The deleted food came back, and the filed trace was not why

**Lane A · branch `fix/pending-delete-resurrection` · BF-47 · v1.395.5**

From device pass N1: *"Delete worked; when I click delete the item vanishes then re-appears; then
when you swap screens - it dissapears."*

## The entry's trace does not survive reading

BF-47 said the loader "renders the local copy first and then does this, **unconditionally**" — the
server fetch — so the authoritative render puts the row back. That is not what the loader does. In
the happy path it feeds the server copy to `applyDelta` and then **re-reads locally**, and all three
links in that chain hold:

- `handleConfirmDelete` really does call `store.deleteFoodLog(id)` before queueing.
- `getFoodLogsWithItems` filters `deleted_at IS NULL`.
- `applyDelta`'s `food_logs` arm is gated `WHERE food_logs.sync_status = 'synced'`, so a server row
  cannot overwrite a pending local one.

On that path the row should not come back. Two mechanisms do fit the report:

1. **The `catch` branch.** If `applyDelta` or the local re-read throws, the loader falls back to
   `applyLogs(server)` — the raw server copy, deleted row included.
2. **The local row was never there.** A log created on web or another device and not yet pulled
   means `deleteFoodLog`'s `UPDATE` matches **zero rows**, so nothing is tombstoned and nothing is
   pending locally, and `applyDelta` inserts the server row fresh as `'synced'`.

**The difference decides where the fix goes**, which is why it was worth chasing rather than
implementing the entry as written. Mechanism 2 is a local re-insert, so a filter applied *after*
`applyDelta` would still write the row back onto the device — it would fix the flicker and leave the
part that survives a screen swap. The shipped filter runs **before both uses**, and a source-order
test pins that.

## What shipped

`pendingDeletedIds` / `withoutPendingDeletes` (`packages/shared/src/sync/pending-deletes.ts`, pure)
and `getQueuedMutationsForDomain` on the local store. The loader drops queued deletes from the
server copy before it hydrates from it or renders it.

**The store read deliberately has no `next_retry_at` clause and no status filter**, unlike
`getPendingMutations` beside it. A delete waiting out a retry backoff is still a delete the user
made, and a read path that forgets it during that window puts the row back on screen — which would
have reproduced the same report, less often, from a different cause.

This is the screen-level twin of the `sync_status = 'synced'` gate `applyDelta` already applies to
pulls. That read path had no such gate.

**Not done: inverting the authority.** The entry warns against it and the warning is right — the
server-copy fallback is itself a fix, for logged food that *"vanished on reload"* when a local read
threw. Both failures are real and a naive swap trades one for the other.

## The sibling sweep has a measured answer: one

The entry asked for a sweep of "any local-first domain whose loader re-fetches a server aggregate
right after an optimistic write". `grep -rn 'applyDelta(' app components lib packages` returns
**exactly one** call site outside the sync engine — this loader. It is the only screen-level read
that hydrates the local store from its own server fetch, which is the shape that can resurrect a
row.

The three named siblings were checked rather than assumed:

- **mood / body-metric / activity deletes** read `day-log:` through `cachedFetch` — a
  server-assembled aggregate that never writes to the local store. A queued delete shows briefly
  stale there and self-corrects on push: a flicker, not a resurrection.
- **`session-select-content.tsx`** reads `store.getActivityLogs` local-first, where the tombstone
  already excludes it.

## Verification

- Full suite green; `pnpm check:rules` **Ran 62 of 62**; `tsc` clean; lint 0 errors.
- **8 mutations, every anchor asserted, all 8 caught** — including removing the filter, moving it
  after the hydrate, applying it to the fallback only, filtering adds and edits as well as deletes,
  reading every domain's deletes, and inverting the empty-set short-circuit.
- **One of those mutations found a hole in my own test.** The first version asserted
  `SRC.toContain('withoutPendingDeletes')`, which an import line satisfies — so deleting the *call*
  and leaving the import survived. It now asserts the call: `withoutPendingDeletes(server,`.

**Not exercised: the S25, and the fix is reasoned rather than reproduced.** `getLocalStore` returns
null in `pnpm dev` and in Playwright, so neither mechanism has a sandbox analogue; the hook cannot
even be rendered, because both vitest projects are `environment: 'node'` with no
`@testing-library/react`. The rule is unit-tested and its placement is pinned at source, and neither
of those is a device. Recorded as a Known-Issues row with the smoke step.

<a id="2026-08-30-perf-generate-skip-empty-model-call"></a>

# 2026-08-30 — a meal plan that needs no model no longer fails when the model is down (LA-38)

**Branch:** `perf/generate-skip-empty-model-call` · **Lane A** · no migration · user-visible fix on a
path that previously 502'd, so a patch version bump rides with it.

## What this is

LA-38, filed a few hours earlier while writing LB-21's wiring test — which found it by falsifying
LB-21's own premise. `app/api/nutrition/meal-plans/generate` called `generateObject`
**unconditionally**, before `generatedNeeded` was computed. Pin three meals into a three-meal plan,
or let the library fill all three, and the route still sent the full generate prompt saying
`Meals: exactly 0.`

The call was unconditional because the plan's **name** came out of it.

## Tokens were the smaller half

The `catch` around that call does not know the call was unnecessary. So a plan that needed nothing
from the model returned **`502 "Could not generate a plan right now. Try again shortly."`** whenever
the model was unavailable — a plan whose every meal the user had already chosen.

Reproduced and then fixed on `pnpm dev` **with no API key set at all**, which is the sharpest version
of the test:

| Request | pre-fix | post-fix |
|---|---|---|
| 2 meals, both pinned | **502** | **200**, `planName: "Morning shake and Evening bowl"` |
| 2 meals, both filled from the library | 502 | 200, `libraryMatchCount: 2`, both `matchReason` set |
| 3 meals, 2 pinned — one slot genuinely needs the model | 502 | **502**, correctly |

## The fix

`generatedNeeded` moves above the call. When it is zero the route builds the draft itself:

- **`planName`** from the meals in hand, which are all already named —
  `planNameFromMeals` in the new `packages/shared/src/nutrition/plan-naming.ts`. Up to three names
  listed, the rest as "and N more", capped at 120 chars against the plan `name` column's 200. A plan
  name is read in a list, and six dish names run together is not a name.
- **`restDayAdjustment`** from the shift the code **actually applies** (`REST_DAY_CARB_REDUCTION`,
  15 %) — `restDayCarbLine`. Nothing renders this field today, but it is in the response contract and
  answering `''` to a caller that asked for a training/rest split would be a silent break.
  **The AI path's prose version is deliberately not reconciled with it**; that is a separate
  question and was not in scope.

The model call moved into a local `askModel()` closure rather than being wrapped in an `else`. Same
behaviour, and it keeps the ~60-line prompt block at its existing indentation — the diff is 36 added
and 9 removed rather than a whitespace shift nobody can review.

## Verified

Mutation-proven, anchors asserted first — eight mutations, all killed:

| Mutation | Cases failed |
|---|---|
| the skip never fires (the pre-fix behaviour) | 4 |
| the skip fires even when meals are needed | 2 |
| rest-day line always empty | 1 |
| plan named from an empty list | 2 |
| `planNameFromMeals` allowed to return `''` | 1 |
| no tail cap — every name listed | 1 |
| no length cap | 2 |
| carb line not rounded | 3 |

LB-21's file gains five cases and its old one is **inverted in place** — it pinned the unconditional
call, and the reason it was written is the reason the call must not come back. One of the five is the
model-unavailable case, which is what says the bug is fixed rather than the tokens saved.

A mock-hygiene note worth keeping: `vi.clearAllMocks()` clears calls, not implementations, and the
fix means a rejection queued with `mockRejectedValueOnce` may **never be consumed** — the route no
longer calls the model on a full plan. The implementation is therefore re-set in `beforeEach`, which
is the difference between one failing case and a rejection leaking into whichever test runs next.

Full suite green; `pnpm check:rules` Ran 62 of 62; `tsc --noEmit` clean; eslint clean.

## Not exercised

- **No device pass.** Nothing native, offline-first, safe-area or gesture-related changed; the route
  reaches the phone through a Railway deploy with no APK. The wizard screen that calls it
  (`meal-plan-setup-sheet.tsx`) is untouched.
- **Production data.** The dev check ran against the local seed with saved meals inserted for it and
  removed afterwards.
- **The AI path's own output** is unchanged and was not re-measured — the model is mocked in tests and
  had no key on the dev server, which is why the third row of the table above is a 502 and correct.

<a id="2026-08-30-preferences-read-sites"></a>

# Preferences survive a fresh install now (Q-392)

**Branch:** `feat/preferences-read-sites` · **Lane B**

The owner's report: *"when i do a new install or open on computer - it loses all the saved
preferences. We need to make it persist across installs/etc."*

The engine for this shipped separately — `users.preferences` as a JSONB bag, `GET`/`PATCH
/api/user/preferences` reading and merging it — and **no read site called it**. Nothing
user-visible had changed, so the report was still true in full. This connects them.

## Shape

`lib/user/preferences-sync.ts`, two functions and one rule.

**`hydrateUserPreferences(bag)`** seeds every device key from the server, driven by
`PREFERENCE_STORAGE` rather than transcribed. It is warmed in `sync-provider.tsx`'s `CACHE_TASKS`
beside `hydrateGoalSeeds`, which is the same shape of problem solved the same way (Q-241).

**`savePreference(name, value)`** / **`savePreferences(patch)`** write the device copy and PATCH the
server. `null` clears a key, which is the route's own contract.

**The conflict rule is one-directional: the server wins.** `localStorage` is a seed written *from*
the server, never the reverse, so hydration overwrites without comparing. **But it does not clear a
key the bag lacks** — see below, that took two attempts.

**Seeding rather than reading through** is what keeps first paint synchronous. Every one of these
surfaces reads its `localStorage` key during render; making them await a fetch would trade a fixed
bug for a flash of defaults on every launch.

## The rule that was wrong, and how CI found it

The first version cleared a key the bag did not carry — absent means "never set", and a stale local
value is the "my setting came back" bug. That is right for a **settled** system and wrong in the
window that matters.

`savePreference` writes locally and PATCHes in the background, so between the tap and the
acknowledgement the bag legitimately lacks a key the user has just chosen. **`meal-label.spec.ts`
caught it**: pick a label style, reload, and hydration wiped the choice. It failed and passed on
retry — the signature of a race, not a broken assertion. **Offline it is worse than a race**: the
PATCH never lands, so the setting is reverted on the next launch, every time.

I had already caught the extreme version while writing up `backgroundSettings` — a key whose writes
*never* reach the server, so the clear fires on every launch — and treated it as one key needing an
exclusion. It was the general rule that was wrong, and **the narrow fix would have left the race in
place for every other key.** That is the part worth carrying: an exclusion list is what you reach for
when you have mistaken a rule's failure for a single key's.

Hydration now writes what the bag has and deletes nothing. The server *could* distinguish "cleared"
from "never set" by storing a null, but `mergePreferences` deletes the key, so the GET cannot tell
them apart — and changing that is a server change (Lane A). Not deleting is the right client
behaviour either way.

What that gives up is a key cleared on another device lingering here. The app clears exactly one
thing — the mutually-exclusive brand preset / custom hue pair — and `EXCLUSIVE_GROUPS` resolves it:
when the bag carries one member, the others go locally. Without it a stale hue would override a
preset chosen elsewhere, the same ordering bug `savePreferences` prevents one layer out.

## The second thing CI found: a mirror effect is not a free write any more

`goals-progress-card.tsx` held the shape this whole change walks into:

```ts
useEffect(() => { localStorage.setItem(GOALS_VIEW_KEY, view) }, [view])
```

Converting that line to `savePreference` looks like a one-to-one swap and is not. The old write was
free and idempotent; the new one is **a network PATCH on every mount**, and this card renders inside
Health's launch burst — roughly twenty-five requests in the first seven seconds.

**One extra request there is enough to break the page.** Instrumented on a cold dev server: the
PATCH and a `GET /api/user/preferences` behind it stayed *pending* past sixty seconds while nothing
else was in flight, so `page.goto(…, { waitUntil: 'networkidle' })` never resolved. That failed
**nine e2e specs** — `card-429-error-state` (×4), `health-tabs-instant-paint` (×3),
`tabs-instant-paint` Health, and this branch's own `preferences-survive-reinstall` — none of which
mention preferences. Reverting that single line took `card-429` from a 45 s timeout to a 21.5 s
pass; the same PATCH fired on its own, after the burst settles, answers in **340 ms**.

**Why the requests hang rather than queue is NOT explained here**, and it is the more interesting
half: the app is evidently at a capacity cliff during launch where one more request can strand
several. Filed as its own entry rather than guessed at — it is engine-side (pool, `FOR UPDATE`
transaction, dev-server concurrency), not a preferences bug.

The fix is `usePersistedPreference(name, value)`: write the device copy on mount, PATCH only when
the value *changes*. Every other converted site is already inside a tap handler and needed nothing.

**And the obvious guard for it is wrong, which is worth more than the fix.** A `firstRun` ref does
not work: React StrictMode invokes an effect twice on mount, so the guard is spent by the second
invocation and it PATCHes anyway. Measured — that version failed `card-429` identically to no guard
at all. The test has to be the **value**, not the run count.

## Three decisions worth keeping

**`savePreferences` exists because of the theme picker.** A brand preset and a custom hue are
mutually exclusive — setting one clears the other. As two `savePreference` calls that is two PATCHes
that can land out of order and leave both set, which renders as the hue winning a choice the user
made for the preset. One patch cannot do that.

**The PATCH is fire-and-forget and deliberately not an outbox domain.** Losing one costs a toggle
that reverts on the next device, not data, and every caller is a tap that must feel instant. Queuing
it would add a synced domain, a local table and a push branch for a value the next write replaces
wholesale. The local write happens first and unconditionally, so an offline change still applies
here and is simply not carried onward.

**The encodings are the part that bites**, which is why `PREFERENCE_STORAGE` drives the loop rather
than a hand-written list: `ta_ss_widgets` is JSON, `ta_weight_lookback` a bare number, and the
reminder toggles `String(boolean)` compared at their read sites against the literal `'false'`. A
value seeded in the wrong shape reads as the default — the setting looks lost anyway, which is the
same bug wearing a different hat.

## Verification

**`e2e/preferences-survive-reinstall.spec.ts` is the owner's sentence as a test.** It PATCHes three
preferences of three different encodings, calls `localStorage.clear()` — which *is* a fresh install
from the only angle that matters, since every surface reads its key during render — reloads, and
asserts all three come back in the right shapes: `'30'`, `'arc'`, and the literal `'false'`.

**Proved both ways.** With the hydration replaced by a no-op and nothing else changed, it fails.

**It blocks the service worker, and that part is NOT proved.** The spec failed on CI twice with
`page.goto: net::ERR_ABORTED` before any assertion ran, with the SW active in both attempt windows
(`GET /sw.js 200`, `GET /offline 200`). The abort does not reproduce in the sandbox with the SW on,
so blocking it removes the one actor the log implicates rather than a demonstrated cause — said here
because a "fix" that cannot be reproduced is a hypothesis with a commit message. `page.reload()` is
not the alternative: measured, it aborts the navigation on every local run.

Thirteen unit tests cover each encoding, an absent key being **left alone** (the regression above,
pinned), the exclusive partner being cleared, a `null` server response not touching the device, every
key in the map being covered so a new preference cannot be seeded under no name, `null` meaning clear
on a save, a failed PATCH not throwing, the exclusive pair going out as one request, and `writePreferenceLocally` writing the device copy while sending **nothing**.

Full unit suite **5,625 passed** / 670 files. `pnpm check:rules` — Ran 62 of 62. Typecheck and lint
clean. `session-select-content.tsx` is **net zero lines** — it is a baselined hotspot.

## Not exercised

- **A second real device.** The test wipes `localStorage` in one browser, which proves hydration.
  It does not prove two devices converge, and it cannot: the sandbox has one session.
- **`backgroundSettings`' write path.** It is a Zustand `persist` envelope the background store owns
  and no write site sends, so the bag never carries it and hydration leaves it alone. It syncs on
  neither read nor write, exactly as before. Connecting that store's write path is what changes it.
- **The APK.** Nothing here is native, so it reaches the device through a Railway deploy — but no
  preference was toggled on the S25.

<a id="2026-08-30-quantity-editor-option-a"></a>

# The quantity editor is Option A, and an ingredient stopped claiming servings (BF-46 ② ③)

**Branch:** `feat/meal-quantity-editor-option-a` · **Lane B**

Two things the owner settled from drawings at 412 dp on the app's own dark tokens. One component
carries both sheets — BF-26 converged the diary's and the builder's onto `quantity-editor.tsx` — so
this lands in both places at once.

## ③ Option A, and the one place the build departs from the drawing

The owner's sentence: *"the grams/serve could be smaller and to the right of the − x + button then
the other buttons could be enlarged and spread to match the width it has: more distinct macro and
total calorie buttons."* Moving the toggle out of its own full-width row is what frees that width;
everything else follows from it.

Top to bottom now: the serving line, the stepper with the unit toggle stacked in a narrow column to
its right, four presets in equal columns spanning the width, the calorie total alone at the largest
type on the sheet, then three macro tiles.

**The drawing puts the toggle at the stepper's height, and that is not buildable here.** Every
`button` in this app carries a 48 dp floor (`globals.css`, a rule with ten regressions behind it),
so a stacked two-option toggle is **96 px** and cannot shrink to meet a 56 px stepper. The escape
hatch is `.tap-dense`, which the CSS reserves for inline text buttons — a unit toggle is a real
control and taking it below the floor would be the exact thing `touch-target-size.spec.ts` exists to
catch. **So the stepper grew to 96 px instead**, which the drawing's own intent supports: the value
is meant to be the tallest, heaviest thing there. A food with no serving size has no toggle at all
and keeps the short row.

`SegmentedTabs` gained `orientation="vertical"` rather than a second copy of the same two buttons —
it is the primitive eight call sites already use, and the floor it applies per segment is exactly
what made the height decision above.

The macros are **named** — Protein · Carbs · Fat — not `P`/`C`/`F`. That is what the drawing shows,
and it takes colour off being the only thing carrying the meaning, which the colour-only-state rule
asks for anyway. BF-26's earned constraints are kept: the macro colours stay, and the grams chip is
still hidden when there is no serving size to divide by.

## ② A serving inside a serving

A row read `8 servings · 1000 g` while the meal it belongs to is measured in *portions*, so
"serving" meant two different things one line apart. The owner: *"just the weight would be fine for
the meals. Only portions are really needed when making serving sizes for the meals."*

The rule moved to `ingredientAmountLabel` in `saved-meal-qty.ts` — out of the hook, so it is
testable in `node` at all, which is the same reason `qtyFromInput` and `steppedQty` already live
there. It takes no unit any more: a parameter it ignored would read as a switch that still works.

**Servings survive for a food with no serving size**, which has no gram equivalent to show instead.
That is the one case where the word is the only thing available rather than a competing unit.

## Verification

`e2e/quantity-editor-option-a.spec.ts`, two tests. The first asserts an ingredient row carries
`1000 g` and does not match `/serving/i` at all. The second drives the sheet and asserts the macro
names, the calorie total standing alone, and — the part that matters — the toggle's **geometry**:
its left edge past the stepper's right edge, its top above the stepper's bottom, and both segments
at ≥ 48 px. "Beside the stepper" is the whole of the owner's request and is invisible to a
text-only check; the same two buttons in a row above would satisfy every other assertion.

**Proved both ways, twice.** Putting the toggle back in a full-width row below fails the geometry
assertion by name; restoring the old label fails the row assertion by name.

**It was flaky first and the fix is worth carrying.** Three sheets open in sequence here, each
covering the control that opened it, so a tap that misses cannot simply be repeated. Each step now
retries against its own effect — and the marker for "the builder is open" had to be its `Update
Meal` button, **not** its `Ingredients` heading: the meal's detail sheet stays mounted underneath
and has a heading by that name, so the heading was already visible before Edit was tapped. A
precondition satisfied by the state it is meant to replace cannot fail, which is a shape this repo
has now hit three times. Three consecutive clean runs after.

Full unit suite **5,630 passed** / 671 files. `pnpm check:rules` — **Ran 62 of 62**. Typecheck and
lint clean.

## Not exercised

- **The S25, which is where a 96 px stepper is either right or too tall.** The sandbox renders at
  desktop width; the entry already warns Option A is the tallest of the three and may scroll on a
  long food name. If it does, tighten the gaps — **do not** merge the total and the macros back into
  one block, which is option B and a settled question.
- **Safe-area and the gesture bar.** Both sheets' footers are unchanged, but nothing here was seen
  on a device, and `env(safe-area-inset-*)` renders 0 in the sandbox.
- **BF-46 ①(a)**, the photo picker's placement, is untouched and stays queued. ①(b)'s root cause
  shipped separately (v1.400.0).

<a id="2026-08-30-queue-reference-entries"></a>

# 2026-08-30 — `feat/queue-reference-entries` (LB-22) — a map entry stops heading the work list

**Lane B · test-only tooling.** `scripts/`, the queue file, and the two docs that describe the
field. No product code.

The queue holds two kinds of thing. Most rows are work; a few are **maps that other entries read** —
BF-28 carries the twelve artboards and the three parity rules six entries follow, and BF-11 is the
spec its eight phases read. They belong in the queue: deleting them would scatter rules that six
entries would then re-derive. But they said so only in prose, and `next-item.js` had no notion of
it, so **BF-28 printed as READY #1** under a header that reads *"top of the list is next"*.

## The decision the entry said to make first

LB-22 asked whether the marker should be a **field** or a grep of two English phrases, and named the
argument itself: `Lane:`, `Needs:` and `Gate:` are fields *because* prose-detection loses. The
codebase already agrees in a place the entry did not cite — `next-item.js` treats the `⛔` prose
marker as an **unmigrated** state and reports it as such, which is the same conclusion reached once
already.

So it is `- **Reference:** <why>`, parsed by `scripts/lib/reference.js` beside `keep.js` and
`lane.js`, and enforced by `check-backlog-pointers.js`: an entry may keep the sentence for its
detail, but the field has to be there beside it. Without that ratchet the next map entry gets
written with a third phrasing and the tool silently mis-sorts it again.

## The ordering question, which was not in the entry

A Reference is **checked last**, after gates, unmet `Needs:` and `Keep:`. Those three say something
is **owed**; `Reference:` only says there is nothing to **build**.

That distinction is not theoretical — it is BF-11. Its eight phases shipped and the S25 walk it
defines did not, so it carries a `Keep:`. A first cut checked `reference` first and moved BF-11 out
of KEEP, **hiding a device obligation behind "not a work item"**. Reference now cannot hide anything:
BF-11 stays in KEEP where its residue is visible, and BF-28 — which owes nothing — is the only
REFERENCE row.

## The checker caught its own weakness immediately

The first `hasProseMarker` was a substring match and flagged **LB-22 itself** — the entry that
*proposes* the field quotes both markers while describing them. An entry discussing the convention is
not claiming it, and a checker that cannot tell those apart is precisely the prose-detection failure
the field exists to end.

It is anchored at the start of a bullet now. Both real cases write it there
(`- **⚑ Not implementable on its own.**`, `- **Not a work item.**`); a quotation mid-sentence does
not match. Six unit tests pin it, including the two LB-22 shapes that produced the false positive.

## Driven, not inspected

Deleting BF-28's `Reference:` field does two things together, which is the whole claim:
`check-backlog-pointers.js` **fails** with the message naming the fix, and `next-item.js` puts BF-28
back at **READY #1**. Restoring it returns the checker to OK and READY to 46 with BF-28 in a
REFERENCE section of one.

`pnpm check:rules` **Ran 61 of 61**, all passed.

## Lane

`scripts/**` is reached by neither half of the path rule, and LB-22 said so — *"arguably the
Orchestrator's the way LB-12's sweep is. Decide before starting."* Taken by **Lane B** under the
ambiguity rule: Lane B filed it, and Lane B is the tool's user. LB-12 is genuinely different and
stays the Orchestrator's — that is a sweep over *entry content*, this is the tool's output shape.

## Not exercised

- No product code, so nothing to verify on device.
- Only two entries carry the marker today, so the field has been exercised on a population of two.
  The ratchet is what covers the third.

<a id="2026-08-30-saved-meal-last-used"></a>

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

<a id="2026-08-30-sparkline-primitive-props"></a>

# The sparkline primitive can draw the charts that were bypassing it (Q-154)

**Branch:** `refactor/sparkline-primitive-props` · **Lane B**

Three files hand-rolled a `<polyline>` rather than using `components/ui/sparkline.tsx`. That was not
laziness and "replace on touch" would have been a bug: the primitive genuinely could not draw them.
Q-154 spent three sessions establishing what was missing and one owner decision clearing the design
question. This is the conversion.

## What the primitive gained

Six props, all defaulted, so the twenty call sites that predate them render byte-identically:

| prop | why |
|---|---|
| `pad` | uniform inset on both axes; the two callers inset by one number and the default's percentage y-band cannot express that |
| `valuePadding` | the default 0.5 is headroom; `0` is exact min/max |
| `strokeWidth` | hardcoded `1.5`; both callers draw at `2` |
| `gridLines` | three faint rules — `exercise-history-sheet` draws them |
| `emphasizeLast` | a larger final dot |
| `valueLabel` | already-formatted text above the last point; units and rounding stay with the caller |

**`valuePadding` is the one that matters and it is not cosmetic.** At 0.5, a 0.5 kg body-weight
spread renders at *half* its true amplitude — the chart says something different from the data. That
is why a blind conversion was refused twice, and it is now pinned by a test rather than a comment.

## The visual change, and whose call it was

The owner decided this on 2026-08-25, shown the three states rendered at true size: **option 2 — the
halo goes.** `exercise-history-sheet`'s decorative `r=7` ring around the final dot is removed, and
the non-final dots stop being dimmed (0.45 and 0.4 at the two callers).

The reasoning is worth keeping: a `haloLastDot` prop asks a shared primitive to draw one caller's
specific art, and a primitive that grows a prop per caller is a wrapper over a config object rather
than a unification. That is the same call Q-406 made when it declined a warning slot on `FoodRow`.
Everything else the callers needed — the inset, exact scaling, stroke width, grid lines, the
emphasized dot — are general wants any caller could have, so they became props rather than
compromises. *"Option 2" never meant "make the callers accept the primitive as it is today."*

## Two convertible, not three

`workout/active-workout-screen.tsx` stays inline **and is no longer a to-do.** It wants asymmetric
padding, uniform dots, no fill, a dimmed stroke and an end-anchored label — four more props no other
caller would use. `scripts/check-sparkline-primitive.js` now lists one grandfathered copy rather than
three, with that reason written into it.

The three time-axis charts (`day-sections`, `exercise-review-sheet`, `body-battery-card`) remain
EXEMPT: they project x by *time* and the primitive projects by *index*, so converting them would move
every unevenly-spaced point. (The primitive does have `times`/`timeDomain` now, but those three carry
their own domain semantics — a fixed whole-day axis, a duration axis — and are not the same thing.)

## Verification

The projection moved to `components/ui/sparkline-geometry.ts` → `sparklinePoints`, **so it can be
tested at all**: both vitest projects run in `node`, where a JSX-only component cannot be driven.
`fitWithin` in `downscale-image.ts` is split out for the same reason.

Seven tests, and the first is the point: the default padding *is asserted* to halve a 0.5 kg spread,
so the hazard is a fixture rather than a warning. The others pin exact scaling filling the inner
height, `pad` insetting both axes, the un-padded default still spanning full width at the original
10%/80% band (which is what says the twenty existing call sites are unchanged), a flat series not
dividing by zero, time projection, and a mismatched `times` array falling back to index.

Full unit suite **5,560 passed** / 664 files. Health e2e specs (instant paint, day-detail sheets,
score-band, first-run empty states) — **11 passed**. `pnpm check:rules` — Ran 62 of 62. Typecheck and
lint clean.

## Not exercised

**Neither converted chart was looked at.** The two sheets are reached through navigation no e2e spec
covers today, and a smoke check of `/health` found no polyline on the landing tab — so the geometry
is proven by unit test and the *rendering* is not. On top of that, this is a deliberate visual change
on a user-facing chart at 412 dp, which is a device judgement by nature. Both sheets want a look on
the S25: the 1RM trend in the exercise-history sheet and the metric trend in the health-metric sheet.

<a id="2026-08-30-touch-target-gate"></a>

# 2026-08-30 — `feat/ci-accessibility-scan` (Q-282) — the scanner that would have passed a 12 px button

**Lane B · test-only.** One spec, no dependency, no product code. Q-282 closed; **LB-26** filed.

Q-282 asked for automated accessibility scanning of the running app — the half a linter cannot do:
**touch-target size and contrast**. Its own note said the Q-250 emulator dependency had expired and
`@axe-core/playwright` against the existing E2E job would do it.

**I installed axe, measured it, and removed it again.** It would not have worked, and the way it
fails is worth more than the feature.

## `target-size` cannot fail on this app

WCAG 2.5.8 exempts an undersized control that has clear space around it. So the mutation:

- Home's Refresh button, given `.tap-dense` so it escaped the CSS floor, and `style={{width:12,height:12}}`.
- `boundingBox()` confirmed **12×12**.
- axe reported it as a **pass**.

A gate that green-lights a 12 px button reads as coverage and is not. That is the guard-that-cannot-
fail shape from LB-19, one PR earlier, and it would have been shipped as an accessibility feature.

## `color-contrast` cannot judge this app at all

Measured on the same pass, per screen: `Could not parse color string oklab(0.0499998 -4.88013e-7
0.00000116974 / 0.95)` — the theme's tokens are `oklch`, which axe-core 4.13 does not parse — plus
`background color could not be determined because it is overlapped by another element` from the
dynamic-background layers. Counts of `incomplete` were **1 · 5 · 8 · 34 · 10** across the five tabs,
and **on Home `color-contrast` evaluated no nodes at all**.

So `projectOverview.md`'s "contrast that could NOT be measured" stands. It now has a reason rather
than an absence, which is the difference between an open question and an unexamined one.

## What shipped instead

`e2e/touch-target-size.spec.ts` measures rendered geometry from the DOM and enforces **this repo's
48 dp bar**, not WCAG's 24 px. On the same mutation axe passed, it fails with
`button 12×12 "Refresh"`.

It covers what `app/globals.css` cannot. That floor is `button, [role="button"]` — `<a>` is excluded
**on purpose**, because 48 px on an inline prose link would wreck paragraph layout — and `role="tab"`,
`role="radio"`, `role="switch"` are not in it either. Those are measured by nothing today.

The two documented opt-outs are honoured rather than fought: `.tap-target-44` and `.tap-target-dot`
give a small control an invisible hit box, and `globals.css` explains why each is sized as it is (a
hit area wider than the clearance steals a neighbour's taps). A control carrying one has made that
trade deliberately.

## What the measurement found

Across the five tabs, exactly **one** control is undersized with nothing compensating: Home's
*Download Android App* banner link, at **258×33**, an `<a>`. Filed as **LB-26** and allowlisted
shrink-only — removing the entry from `ALLOWED` is part of that fix, and the spec then fails until
the size is right.

Everything else that is small is deliberate and compensated: the three **7×7** workout carousel dots
(`tap-target-dot`, 24×44 box, sized to a 15 px pitch) and More's **32×32** photo control
(`tap-target-44`).

That is a good result for the app, and it explains the zero: the global floor is doing the work, and
a scanner would have taken the credit.

## Both scans assert what they examined

Each screen asserts a non-zero count of interactive elements before asserting zero violations. A
query that matched nothing would otherwise report no violations and pass — the same trap the ink
poll fell into in LB-19, written down here because it is now twice in two days.

## Not exercised

- No product code changed. The `session-select-content.tsx` edit was the mutation, reverted.
- Five tab screens only. Takeover routes (`/health/day`, `/workout?session=…`) and open sheets are
  not scanned; a sheet's controls are measured only if it happens to be open, and none is.
- Nothing device-verified. The DOM box is not the WebView's hit region, and native insets are
  outside this entirely — the Espresso route stays the answer for those if Q-250 ever lands.

<a id="2026-08-30-voice-plugin-proxy-thenable"></a>

# 2026-08-30 — The Voice button was not broken on the APK, it was absent

**Lane A · branch `fix/voice-plugin-proxy-thenable` · LA-37 · found in `error_events`**

The session-start `error_events` read returned one fault from 02:06 that morning, source `client`,
on the workout screen:

    "SpeechRecognition.then()" is not implemented on android

## The cause, and the part that makes it nasty

`components/workout/voice-log-button.tsx`:

```ts
async function getNativeSpeech() {
  try {
    const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
    return SpeechRecognition          // the raw registerPlugin() Proxy
  } catch { return null }
}
```

`registerPlugin()` returns a Proxy whose `get` trap (`node_modules/@capacitor/core`) special-cases
`$$typeof`, `toJSON`, `addListener` and `removeListener` and sends **every other key — `then`
included** — to `createPluginMethodWrapper`. So resolving this async function's promise with the
proxy makes the promise-resolution algorithm read `.then`, find a function, and call it across the
bridge as a plugin method that does not exist.

**It does not reject. It hangs.** Capacitor's wrapper ignores the `resolve`/`reject` the algorithm
handed it and returns a rejected promise instead, so nothing ever settles the outer promise and the
bridge error escapes as an unhandled rejection — which is exactly how it reached `error_events`
while the code that was awaiting simply never continued. `available` therefore stayed `null` and
`if (available === null) return null` meant **the Voice button did not render on the APK at all**.
The owner would have seen no button rather than a broken one, which is why it was never reported.

The function's own `try/catch` cannot help either way: the body has already returned.

**I got this wrong first and the test caught me.** The first draft of
`lib/__tests__/capacitor-plugin-thenable.test.ts` asserted `rejects.toThrow(...)`; it failed, with an
unhandled rejection beside it. `lib/oura-ble/plugin.ts` had said *"permanently hanging this promise
instead of resolving"* all along — the comment was right and my paraphrase of it was not. The
comments in the fix and in the check now say hang.

## The convention already existed and could not see this file

`lib/oura-ble/plugin.ts:125` describes this footgun in full, and all four **locally registered**
plugins return `{ plugin }` because of it — `oura-ble`, `scale-ble`, `polar-ble`,
`media/save-to-gallery`. It did not protect the voice button because that plugin comes from a
**community package**, so the file never contains the word `registerPlugin` and no grep for the
convention reaches it.

That is the argument for a check rather than another paragraph, and for keying it on the **shape**
(an async function resolving to a binding from a `@capacitor*` import) rather than on the call.

## What shipped

- `getNativeSpeech` returns `{ plugin } | null`, matching `getOuraBle`. `runNative` destructures it,
  and its `await` moves inside the `try` — **defensive, not load-bearing**: once the wrapper is in,
  the function's own catch covers both dynamic imports and it can no longer reject at all.
- `scripts/check-plugin-proxy-thenable.js`, wired into Custom Rules (now **62** steps). The scanner
  is pure, in `scripts/lib/plugin-proxy-scan.js`, so the rule is testable against fixtures instead
  of only against whatever the tree happens to contain.
- `lib/__tests__/capacitor-plugin-thenable.test.ts` — the invariant, executable: a faithful
  reproduction of Capacitor's `get` trap, asserting that the bare return **never settles** and leaks
  the bridge error, and that the wrapped form resolves and touches `then` not at all.

## The precision that matters: the hazard is the proxy, not the plugin

A sweep found three `return <plugin>` sites. Two are **correct** and a careless rule would have
broken them: `lib/colmi-ble/ble.ts` and `lib/live-hr/chest-strap-source.ts` both `return BleClient`,
and `@capacitor-community/bluetooth-le` exports `BleClient = new BleClientClass()` — a plain
instance whose `.then` is `undefined`. That is why the Colmi connector works while voice logging did
not, despite identical-looking code. The check exempts `BleClient` **by name with the reason
recorded**, and a test asserts the reason is there.

## Verification

- Full suite green; `pnpm check:rules` **Ran 62 of 62**; `tsc` clean; lint 0 errors (120
  pre-existing warnings, unchanged).
- **5 mutations, every anchor asserted, all 5 caught**: reinstating the shipped bug (caught by the
  new check), removing `BleClient`'s exemption (the two safe sites get flagged), the off-by-one line
  number, dropping the "imported binding only" guard, and making the fake bridge special-case `then`
  so the hazard disappears.
- **The off-by-one was real and the test found it**, not the other way round: the scanner anchored on
  the newline *before* `return`, so it reported the import line — sending a reader to the line where
  the fix does not go.

**Not exercised: the S25.** This is a WebView-only failure with no sandbox analogue —
`Capacitor.isNativePlatform()` is false in `pnpm dev` and in Playwright, so the native branch never
runs there and the bug was invisible to every green check this repo has. The fix is JS, so it
reaches the device on the next Railway deploy with **no APK rebuild**; what is owed is pressing the
button on the phone.

## What this says about the other `error_events` reads

This fault was **one row**, on one day, from one tap. It had been shipping a completely dead feature
on the canonical runtime, and no test, no lint rule and no local run could have seen it. That table
prunes at 30 days.

<a id="2026-08-31-barcode-image-chain"></a>

# 2026-08-31 — BF-70: the barcode thumbnail is fetched, and now it survives the trip

**Branch:** `lane-a/next` · **Lane A** (with the form-model half the entry places in the same change)
· JS/server only, no APK.

The barcode route has fetched the Open Food Facts thumbnail since BF-35, and every layer between it
and the stored row threw it away. The entry named four; there were **five**.

## The fifth layer

`log-food.ts`'s own `createFoodItem` — the web fallback that POSTs to `/api/nutrition/food-items` —
built a body of twelve fields and not the image. The route has accepted and stored `imageDataUri`
since BF-35, so even with the four filed sites fixed, the web path would still have dropped it. It
is not visible from any of the four; you only see it by following the value rather than the list.

## Why the dead line typechecked, which is the part worth keeping

`create-food-item.ts:68` read `imageDataUri: s.imageDataUri ?? null` where `s` is
`sanitiseNutrition(...)`'s return. That compiles because **`RawNutrition` declares the field** —
and resolves to `undefined` on every call because every caller builds that argument from numeric
fields alone. So the line that dropped the picture read as the line that carried it, and its comment
said so outright.

The fix is not only to read from `input`. It is to **delete the declaration**, so the same mistake
becomes a compile error. `scripts/check-sanitiser-no-image-field.js` (Custom Rules, now **65**)
keeps it deleted.

**A `@ts-expect-error` in a test cannot hold this, and finding out why is worth recording:**
`tsconfig.json` excludes `**/__tests__/**`, so **no test file is typechecked at all**. A type-level
assertion written there is inert while reading as a guard. The mutation that proved it: re-add the
field, run `tsc` — exit 0.

*(And the first attempt at that assertion went into `RawNutrition` instead of `NutritionScanResult`,
because both declare `imageDataUri` and only one is real. That is the same confusion the bug is made
of.)*

## The source label, and why the entry's suggested mechanism was the wrong one

`handleConfirm` set `source: scanResult?.confidence ? 'ai' : 'manual'`, so every barcode scan stored
as `'ai'` — which is why BF-38 measured **3 rows of 221** carrying `'barcode'`.

The entry suggested following the barcode route's `notes` stamp. Two measurements say not to:

- `offProductToNutrition` sets `confidence: 'high'` for **both** OFF routes and the photo scan sets
  one too, so "has a confidence" means "came from a scan" and nothing more.
- `notes` on the photo path is **model-authored prose** (`scan/route.ts:89`), so keying behaviour off
  it would be gating on LLM output — which this repo's own AI rule forbids.

So `NutritionScanResult` gains an explicit `origin: 'barcode' | 'search' | 'photo'`, set by the route
that knows, and `scanOriginToSource` maps it. **`'search'` still maps to `'ai'`**, which is a wrong
label: `food_items.source` has no value for an Open Food Facts text lookup and adding one is a
migration. That is pinned by a test so it reads as a stated compromise rather than an oversight.

## Verified

- 6 unit tests; **3 mutations killed** (the old confidence rule, the missing `origin` on the shared
  OFF mapper, and — after the check was written — the re-added dead field, plus its two failure
  modes and the false positive of the prose that names it).
- Full suite **684 files / 5,744 tests** · `pnpm check:rules` **Ran 65 of 65** · `tsc` clean.
- **Exercised against the real Open Food Facts API** on `pnpm dev`, barcode `9310072030821`:

  | Step | Result |
  |---|---|
  | `GET /api/nutrition/barcode` | `Shapes Vegemite & Cheese`, `origin: 'barcode'`, a real 5,359-char data URI |
  | `POST /api/nutrition/food-items` | 201 |
  | the stored row | `source = barcode`, `image_data_uri` **stored, 5,359 chars** |

  Before this change that row would have been `source = ai` with a null image.

## Not exercised

The React half — `scanToEditable` → form → `handleConfirm` — is covered by `tsc` and by the unit test
on `scanOriginToSource`, not by a run: the flow starts at the camera scanner, which does not exist
headless. Device, safe-area and WebView paths do not apply; no APK needed.

## Also removed from the queue

**BF-2's entry, which this session shipped four steps of and then left in the queue.** It read as
READY at position 3. Its own protocol says a finished entry must not still be there; the completion
words the checker looks for were in its body, not its heading, so nothing caught it. Nothing is owed
— the display half is LA-45 and the entry surface was BF-71.

Four references to BF-70 elsewhere in the backlog went stale the moment it was struck, including
BF-35's *"blocked by BF-70"* and BF-38's batch line. All four are rewritten rather than left.

<a id="2026-08-31-bf-71-clinical-entry"></a>

# BF-71 — the routes shipped, the way in did not

**Branch:** `feat/bf-71-clinical-entry` · **Lane B** · v1.406.0

## What was wrong

The owner asked *"is it using the value from the RMR scan + our sedentary level?"* The answer was no,
and the reason was not a missing feature. `app/api/measured-rmr` and `app/api/dexa-scans` both
shipped complete — schema, bounds, repository methods — and `nutrition-goals/recommend` already read
`getLatestMeasuredRmr`. `grep -rn "api/measured-rmr\|api/dexa-scans"` outside `app/api/` returned
nothing. **No client code called either route**, so `measured_rmr` and `dexa_scans` were both empty
in production, the owner's 2026-08-27 results sat in a markdown file for four days, and every resting
rate the app quoted stayed predicted.

**Nothing was going to catch this.** The routes were correct. The reads were correct. An empty table
is a valid state, and no test fails because a table nobody writes to has no rows in it.

## What shipped

`app/more/clinical/` behind a new **Health → DEXA & RMR results** row in More, with the two forms in
`components/more/clinical/`. No schema moved and no route changed: this is the missing half of work
that was otherwise finished.

**The stored values sit above the forms**, because the question the screen has to answer is "did my
1,325 land, and is the app using it" — a form that saves into silence cannot answer it, and that
readback is also what makes **BF-42** runnable at all (its verification needs a measurement to
exist).

## The number, measured rather than estimated

The entry predicted the gap from the owner's own results before the feature existed. With 1,325 kcal
and 51.46 kg fat-free mass stored, `calculateBaseline` returns:

| | Predicted | With the measured test | Δ |
|---|---|---|---|
| BMR | 1485 | **1328** | −157 |
| TDEE | 1782 | **1594** | **−188** |

The entry forecast **~188 kcal/day**. That is now a measurement.

**The recommendation route is a worse instrument for this and was not used as one.** It runs an LLM,
so its `calories` moved 1950 → 1850 across the same change — a real difference that a single pair of
calls cannot attribute, because the model varies run to run. `calculateBaseline` is the deterministic
half and is where the claim above comes from.

## Two decisions worth keeping

**Only two DEXA fields are load-bearing, and the form says so with its layout.**
`getBodyFatCalibration` selects exactly `scannedOn` and `pctFat`. Those two plus weight are the first
screen; the other ~30 scalars are the owner's clinical record, read by nothing yet, and are collapsed
rather than absent. The **twelve per-region bone rows are not here at all** — 36 hand-typed fields
for data nothing reads, which is what BF-41's extraction path is for. The route makes `regions`
optional for exactly this reason.

**Mass fields echo themselves in kilograms.** The schema stores grams and bounds them 0..500,000, and
its own comment names the mistake it cannot catch: "grams entered as kilograms is the likely one".
The printout reads `Fat 20,547.5 g`; typing `20.5` is inside the bound, saves cleanly, and is wrong
by a factor of a thousand in the column BF-2's calibration reads. A tighter bound is not the fix —
the route is right that the real range spans children and adults. Showing `= 20.55 kg` under the
field is: at 20.5 g it reads `= 0.02 kg`, which is obviously not a person's fat mass.

**No invalidation group, and that is deliberate.** `lib/cache-groups.ts` is where one would go, and a
hand-rolled key list at the write site is CI-blocked. Neither key needs one: `cachedFetch` paints the
cached value and then always revalidates, neither read passes `freshWithinTtl`, and neither is
seed-only — so the entry is a first-paint accelerator, and clearing it would swap a briefly-stale
paint for a blank one. The freshly-saved record is held in state instead, which is both instant and
true.

## Verified

`tsc --noEmit` clean · `pnpm check:rules` **Ran 63 of 63** · full suite **524 files / 4773 passed**.

End-to-end against the local database, driven through the UI rather than the API: navigate from
More, enter the **real** 2026-08-27 values, and assert the columns hold them —
`measured_rmr` one row at 1325 / 51.46, `dexa_scans` one row at 28.5 % / 20547.5 g /
`source='manual'`. Real values rather than round fixtures, because a fixture of round numbers would
not have exercised the grams hazard. Three consecutive green runs.

All four unit guards are **mutation-tested**, and one of them was wrong when first written: the
caller regex `fetch\(['"]/api/dexa-scans` still matched `/api/dexa-scans-DISABLED`, so the guard
passed while the form posted nowhere. It only showed up by mutating the URL and watching the test
stay green. The terminator is now part of the pattern.

The e2e spec also caught a real flake in itself: the More row navigates through the client router, so
a tap dispatched before hydration is swallowed and the page silently stays on More. It waits for the
route boundary and asserts the URL now.

## Not exercised

- **The device, and specifically the two controls the form is built from.** `<input type="date">` is
  the picker most likely to render differently in Samsung's WebView, and every number field asks for
  `inputMode="decimal"` because several values are fractional (BMD 1.046, T-score −1.6) — a keypad
  with no decimal point would make them untypeable. Neither has been seen on the S25. BF-71 stays
  queued on that check alone.
- **Offline.** There is no outbox domain behind either route, so a save with no connection fails
  visibly rather than queueing. That is the standing rule's second branch, chosen deliberately —
  adding the first would need a local table and a sync domain, which is Lane A's. The failure path
  itself was not exercised.
- **A second measurement.** Everything here was verified with one row in each table. The routes
  return lists and BF-2's calibration explicitly wants a series; how the screen reads with several is
  unknown.

<a id="2026-08-31-coach-nutrition-scope"></a>

# 2026-08-31 · Lane A — Coach gets a named nutrition scope, made of what it never receives (LA-47)

Branch `lane-a/coach-nutrition-scope`. JS/server only — reaches the device through a Railway
deploy, no APK.

## What shipped: piece 2 of the entry, the scope record

`lib/coach/scopes.ts` is a named record — read tools, widget tools, choice sources, patch domains,
prompt section — and `/api/coach` takes an optional `scope` on the body. The Nutrition tab will
open Coach in `nutrition`; everything else stays `general`, which withholds nothing, so every
existing caller is byte-for-byte unchanged.

**The enforcement is the point, and it is not the prompt.** The entry's own line — *scope by
withholding tools, not by instructing* — is implemented three ways, all of which the model cannot
argue with:

1. The training read tools are simply absent from the tool set.
2. `renderChoiceList`'s `source` enum is **rebuilt per request** from the scope's sources, so a
   nutrition-scoped Coach naming `source: "sessions"` fails schema validation and the SDK retries
   it — it never becomes a request the options route has to refuse.
3. `proposeChange`/`askForNumber`'s `domain` enum is narrowed the same way, so this scope
   structurally cannot propose a change to a program session.

The prompt section is still there and is not a contradiction: withholding decides what is
*possible*, prose decides what is *idiomatic*. A scope with the nutrition tools and no hint about
meal planning would be reachable and useless.

**Verified live, both directions.** The same question — *"which session should I do today? show me
my program sessions"* — calls `getReadinessExplanation` unscoped and produces a `handOff` widget
under `nutrition`. A nutrition question under `nutrition` calls `getNutritionDay` +
`getEnergyBalance` as it should.

## A bug my own test caught, which review would not have

`isCoachScopeId` used `value in COACH_SCOPES`. `in` walks the prototype chain, so a client sending
`scope: "toString"` matched, and `coachScope` then returned `Object.prototype.toString` **as a
scope** — where `readTools` is `undefined`, which is not `null`, so `pickTools` would
`new Set(undefined)` and take the request down. `Object.hasOwn` now, with the case pinned at both
the unit and route level.

## What did NOT ship, and why the entry was wrong about it

LA-47's piece 1 is the plan widget, and the entry proposes splitting it: *"Add a member to the union
and a row in `WIDGET_TOOL_NAMES`; the registry row and the component are Lane B's half."* **That
split does not compile.** `components/coach/widget-registry.tsx` narrows by early return and falls
through to `change_preview`, so a new union member is a type error until a branch handles it. And a
branch rendering `null` is worse than none: `widgets.ts` says so itself — a client-side tool call
with no result **wedges the whole thread**, because the provider refuses a request containing an
unanswered tool call. So piece 1 is one change across two lanes, not two changes.

Rather than half-build a card, the settled design went into the backlog entry so whoever pairs on it
does not re-derive it: the widget carries `{ kind, title, planId? }` and **no meals** — the client
renders from the plan it already holds, for exactly the reason `CHOICE_SOURCES` exists — and the two
actions resolve as ordinary `chose` results with fixed ids, needing no new `WidgetResultSchema`
member. Save-all calls `savePlanMealsToLibrary`, which already ships and is already idempotent.

## Not exercised

Native SQLite / Capacitor plugins, safe-area, Samsung WebView, the APK path — untouched. The scope
was exercised against a real Gemini turn on `pnpm dev`; the unit and route tests mock the model, so
what they pin is the tool set and schemas it receives, which is precisely the claim.

<a id="2026-08-31-deload-temp-gate"></a>

# 2026-08-31 · Lane A — the deload banner stops firing off a broken temperature baseline (TN-18)

Branch `lane-a/deload-temp-gate`. One condition, plus the read it needed. JS/server only.

## The finding, in one frame

The owner's 2026-08-31 06:43 screenshot held both halves of a broken baseline for the same night:

| path | value | verdict |
|---|---|---|
| readiness contributor | `tempZ` = 0.303 | **80/100** — temperature is fine |
| deload banner | `temp_dev_c` = 0.519 °C | **"Body temp elevated — rest or deload recommended"** |

Same number, opposite answers. The z is small because the baseline sd is inflated —
`temp_baseline_dev_x8` reads 1.714 °C against a true nightly sd of ~0.14 °C, and 0.519 / 1.714 =
0.303 to three decimals. Q-506's inflated sd and TN-6's low mean, failing in opposite directions at
once.

**TN-6a shipped the suspension and its own entry said it "must cover all three consumers". It
covered one** — and it was the readiness ladder, the path the owner does not read. The banner is
the surface behind the report that started all of this: *"its often triggering deload days. its not
trustable yet."*

## The fix, and the thing it is not

`computeDeloadStrength` takes a `temperatureTrusted` flag; the adapter computes it with
`isTemperatureBaselineCentred` — **imported, not re-derived**, because two answers to "is
temperature trustworthy" is exactly what produced the disagreement above. An absent flag suppresses,
matching how an absent `temperatureBaselineDays` already behaves: both unknowns fail the same way.

**The threshold is untouched.** Raising `TEMP_ALERT_THRESHOLD_C` is the Q-504 mistake and would have
been the fourth *"the threshold is right, the input is wrong"* in this pillar.

The suspension is one condition on one alert, not a mute: a fever still deloads (different branch),
and so does a stressful day. Both pinned.

## The hazard the fix introduced, which is the part worth reading

Judging centredness needs the *trailing* deviations, and the adapter read only today's summary. So
the query widened to the same 28-day window readiness uses — and that quietly turned
`summaryRows[0]` from **today** into **the oldest of 28 nights**. A month-stale deviation and
baseline count feeding a deload banner is a worse bug than the one being fixed.

**The first version of the new test file passed with it in place**, because every case there judged
the *window*, which is centred either way. `todaySummary` is found by date now, with its own case
asserting the deviation and the baseline count come from today.

Two other mutations survived first drafts and forced better tests: the adapter simply not passing
the flag into the engine (the tests read the flag out of `signals` and never checked the alert), and
the trust flag defaulting to `true`. Four mutations, four tests.

## Not verified

The pass test is a morning where the banner stays quiet on an over-threshold night, and that is the
owner's to observe — the entry's own acceptance. Nothing here touches native SQLite, Capacitor,
safe-area or the APK path. The third consumer TN-18 names (`tempZ` / the illness radar) was
deliberately **not** touched: it is not firing wrongly, it cannot fire at all while the sd is 12×
too wide, and that is TN-6's subject.

<a id="2026-08-31-dexa-body-fat-calibration"></a>

# 2026-08-31 — BF-2 steps 1–2: the DEXA correction exists, and nothing reads it yet

**Branch:** `feat/dexa-body-fat-calibration` · **Lane A** · JS/server only, no APK needed.
**No behaviour changed** — that is deliberate and is the point of the split.

Steps 1 and 2 of [the plan](../superpowers/plans/2026-08-31-dexa-filter.md): the calibration as a
pure function, and the one repository read that derives it. Steps 3 (the sweep of the consumers) and
4 (the payload field) are **not** built, so no calorie goal, protein dose, RMR or panel has moved.

## No table, no migration — the pairs are derived

The entry assumed a stored set of `(scan, scale)` pairs. Both halves are already first-class rows —
`dexa_scans.scanned_on`/`pct_fat` and `body_metrics.date`/`body_fat_pct`, keyed by
`source_map->>'body_fat_pct'` — so a stored pair is a **stored counter wearing a different hat**, and
every one of those in this project has drifted. `getBodyFatCalibration` reads both sides and pairs
them in TS.

The pairing is in TS rather than SQL for a specific reason: the rule that has to be tested is the
rule (±3 days, nearest wins, each row used once), and it is testable as a pure function only if it
lives in one. Neither side is large — a handful of scans against one row per day.

## Offset, not ratio, and the reason is about the future

At n = 1 the two forms agree exactly on the observed point and diverge everywhere else. A ratio
asserts the bias scales with the reading — at 5 % it would imply a gap of 0.6 points. An offset
asserts only the gap that was measured. One pair supports neither, so prefer the one that makes no
claim about readings never observed.

The property that says the form fits its own measurement is pinned as a test: re-correcting the very
reading the calibration came from lands **exactly** on the DEXA's 28.5 %.

## Two distinctions the code refuses to collapse

**`null` calibration is not a zero offset.** `deriveBodyFatCalibration([])` returns `null`, and
`CorrectedBodyFat.corrected` is set from *whether a calibration applied*, never from
`pct !== rawPct` — an offset can legitimately round to zero, and "not corrected" and "corrected by
0.0" are different claims that the UI says differently. Both are mutation-proven.

**An unknown instrument is not this one.** A reading whose `source_map->>'body_fat_pct'` is `null`
reads uncorrected, which is **two-thirds of the owner's history**: measured in production, the three
instruments occupy contiguous eras — no provenance 2026-05-07 → 06-23 (40 rows), `health_connect` to
08-01 (11), `scale_ble` from 07-29 (31). Those 40 rows are *probably* the same scale, and "probably"
is exactly how a calibration reaches an instrument it was never measured on, which the owner's own
refinement ("per measurement system, not global") rules out.

## Verified

- **19 unit tests + 6 DB-backed tests. Thirteen mutations, all killed:** the source check, a `null`
  source treated as a match, the plausibility refusal, empty-pairs-as-zero-offset, `corrected`
  inferred from the value, the ±window, nearest-vs-first, one reading pairing twice, the source
  filter in pairing, the candidate sort (order dependence), and — on the adapter — each of the two
  `user_id` predicates and the `source_map` key path.
- **Exercised against production-shaped rows** on the dev server: three contiguous instrument eras
  seeded as production has them, one DEXA on 2026-08-27. Result: offset **+3.2**, **3 of 11**
  readings corrected, the scan day landing on exactly 28.5, every other era untouched with
  `corrected: false`.
- Full suite **679 files / 5,723 tests** green · `pnpm check:rules` **Ran 63 of 63** · `tsc` clean.

## What step 3 has to decide, and the number that decides it

`listBodyMetrics` has **22 call sites**. That makes correcting *inside* the read attractive — a missed
consumer becomes impossible, which is what the sibling-surface rule actually wants — and dangerous,
because a read-then-write path would persist a corrected value into the raw column, and the whole
design rests on `body_metrics.body_fat_pct` staying archival. **Measure which of the 22 write back
before choosing.** That measurement was not done here, which is why step 3 is not in this PR rather
than being in it half-considered.

`personalRmr` is the consumer that must not be missed when step 3 lands: feeding it the uncorrected
scale number re-scales a measured RMR's residual onto **+45 kcal/day** of fat-free mass the owner
does not have.

## Not exercised

No runtime surface — nothing calls the new code yet, so there was no route or screen to exercise on
`pnpm dev`. Device, safe-area, native SQLite and WebView paths do not apply. The production reads
behind the era table are **row-scoped to one user**, so the counts are *the owner's*.

<a id="2026-08-31-dexa-chain-end-to-end"></a>

# 2026-08-31 — LA-44 was built by someone else while it sat in the queue, so the work became verifying the seam

**Branch:** `feat/dexa-correction-consumers` · **Lane A** · no code changed; docs plus an end-to-end
verification run.

LA-44 was taken off the queue to be built. Merging `main` first turned up **#681 — BF-71: the DEXA
and RMR routes shipped without a way in, so both tables were empty**, landed hours earlier by another
agent. It is the same finding and the same fix.

## Checked before striking, not assumed

BF-71 ships `app/more/clinical/` with `dexa-scan-form.tsx` and `measured-rmr-form.tsx`, reachable
from `profile-tab.tsx`, plus an e2e spec and a reachability test. Against what LA-44 specified:

| LA-44 asked for | BF-71 |
|---|---|
| the load-bearing DEXA fields (`scanned_on`, `pct_fat`, `weight_kg`, `fat_g`, `lean_plus_bmc_g`) | all of them, plus `leanG` and `totalBmcG` |
| the RMR fields `personalRmr` needs | `rmrKcal`, `ffmKgAtTest`, `measuredOn` |
| **no `bytea`** — do not start storing the source document | no file input anywhere in the flow |

Superseded, so the entry is removed with a note rather than reimplemented, per the rule that a plan
which no longer matches reality gets reconciled instead of forced through.

## The work that was actually left, and nobody had done it

BF-71 and BF-2 landed as separate, independently-green PRs. **Nothing verified the combination** —
which is the exact gap `main`'s own LB-31 entry describes: `ci.yml` has no `push: [main]` trigger, so
after several green PRs land together there is no signal that the whole is sound.

So the seam was run by hand: seed a scale reading, POST the payload BF-71's form builds, and read the
consumers with no other action.

| | before | after one scan | after a second |
|---|---|---|---|
| `energy-balance` → `restingBaseKcal` | 1832 | **1773** | — |
| `nutrition-goals/recommend` → calories | 1961 | **1889** | — |
| `body-metadata` → `bodyFatCorrected` | 25.3 | **28.5** | **27.9** |
| `bodyFatCalibration.offsetPct` | null | **3.2** (`pairCount` 1) | **2.6** (`pairCount` 2) |
| `body_metrics.body_fat_pct` | 25.3 | **25.3** | **25.3** |

**The second scan is the interesting row.** It re-derived the calibration with no entry step for the
pair — offset 3.2 → 2.6 as the mean of (28.5−25.3) and (27.0−25.0). That is the owner's own
refinement working: *"This value needs to be able to accept more (i.e another dexa scan later on) so
it can work together to build a correct filter."* It is also the property that justified deriving
pairs from `dexa_scans` × `body_metrics` rather than storing them — a stored pair would have needed
its own write, and nothing was going to make that write happen.

And the raw column is unchanged after all of it, which is the invariant the whole design rests on.

## What this does not settle

**No screen shows any of it (LA-45).** The Health card renders `bodyFat` — the raw 25.3 — while the
calorie goal is computed from 28.5. Everything above is true of the data and invisible in the app.

**Nothing here ran on the device.** BF-71's forms are a Lane B surface on the canonical runtime and
carry their own device-verification row; this session exercised the routes behind them, not the
screens.

**One pair is still one pair.** `pairCount: 2` above is a fixture, not the owner's history — they
have one real scan, so an offset and a ratio remain the same number until a second real DEXA exists.

<a id="2026-08-31-dexa-corrected-payload"></a>

# 2026-08-31 — BF-2 step 4: the corrected body fat reaches the payload, raw and all

**Branch:** `feat/dexa-correction-consumers` (folded into the step-3 PR) · **Lane A** · server only.

Step 4 finishes BF-2's engine. `/api/body-metadata` and `/api/day-log` now carry the DEXA-corrected
reading **beside** the raw one, per reading, plus the calibration itself once per response. No screen
reads any of it yet — that is **LA-45**, Lane B.

## Three fields, not one, and each earns its place

```
bodyFat:             25.3      // RAW. What the scale said. Seeds the log sheet's input.
bodyFatCorrected:    28.5      // What to DISPLAY.
bodyFatIsCorrected:  true      // Whether a calibration applied.
```

**`bodyFat` stays raw because a screen writes it back.** `openLog` (`health-content.tsx:493`) and
`log-value-sheet.tsx:32` pre-fill the body-fat input from this field and POST it at source `manual`,
a rank that outranks `scale_ble`. Return a corrected value here and saving an untouched field
overwrites the measurement, and the next calibration pairs the DEXA against an already-corrected
number.

**`bodyFatIsCorrected` is a third field rather than `bodyFatCorrected !== bodyFat`** because an
offset can legitimately round to zero. "Corrected by 0.0" and "not corrected" are different claims,
and a chart that infers the second from the first marks the wrong boundary.

`body-metadata` also returns `bodyFatCalibration: { offsetPct, pairCount, source } | null` — the
owner asked to be shown the offset, and `pairCount` is what says how far to trust it. At one pair an
offset and a ratio are the same number, so a screen must not present it as settled.

## The check caught its own exemption going stale

Once `body-metadata` and `day-log` started handling the calibration, their entries in
`scripts/check-body-fat-correction.js` became claims that were no longer true — and the script could
not see it, because it tested the exemption list *before* the import. It now tests the import first
and **fails on a file that imports the calibration while still listed as exempt**. Both were flagged
immediately and removed.

What the exemptions were carrying — *`bodyFat` specifically must stay raw* — is not something a
file-level check can express, so it moved to a test rather than being dropped.

## Verified

- **6 DB-backed tests** (2 new): the display payload carrying a corrected value with the raw one
  untouched, and an uncalibrated instrument reporting `corrected: false`.
- Full suite **682 files / 5,734 tests** · `pnpm check:rules` **Ran 64 of 64** · `tsc` clean.
- **Exercised live on `pnpm dev`** across two instrument eras:

  | Route / row | `bodyFat` | `bodyFatCorrected` | `bodyFatIsCorrected` |
  |---|---|---|---|
  | `body-metadata` today (`scale_ble`) | 25.3 | **28.5** | true |
  | `body-metadata` 2026-08-25 (`health_connect`) | 22.8 | 22.8 | **false** |
  | `day-log` today | 25.3 | **28.5** | true |
  | `day-log` 2026-08-25 | 22.8 | 22.8 | **false** |

  `bodyFatCalibration` came back `{ offsetPct: 3.2, pairCount: 1, source: 'scale_ble' }`, and
  `body_metrics.body_fat_pct` still reads 25.3 after every one of those calls.

- **Before the scan existed**, `bodyFatCorrected` equalled `bodyFat` with the flag false and the
  calibration null — so a user with no DEXA sees exactly what they see today.

## The gap this leaves, deliberately

The engine corrects and no screen shows it: the Health card renders 25.3 while the calorie goal is
already computed from 28.5. **Two numbers disagreeing on screen is worse than neither being
corrected**, so LA-45 is filed rather than left implicit, and it carries the seeding rule
(display `bodyFatCorrected`, seed the input from `bodyFat`) because getting that backwards is the
one way to lose the archive.

## Not exercised

Server-side only — no APK, and the device, safe-area, native-SQLite and WebView paths do not apply.
The route wiring is verified against the running dev server rather than in vitest: importing an API
route there pulls in next-auth, which does not load under the test runner.

<a id="2026-08-31-dexa-correction-consumers"></a>

# 2026-08-31 — BF-2 step 3: the correction reaches the numbers, and cannot reach the archive

**Branch:** `feat/dexa-correction-consumers` · **Lane A** · JS/server only, no APK.

Step 3 of [the plan](../superpowers/plans/2026-08-31-dexa-filter.md). The DEXA correction now
feeds every derived number. Step 4 (the per-reading `corrected` flag in the payload) is not built.

## The design question, and the measurement that answered it the other way

The plan left step 3 open with a number attached: `listBodyMetrics` has **22 call sites**, so
correcting *inside* that read would make a missed consumer impossible — the thing the sibling-surface
rule actually wants — but a read-then-write path would then persist a corrected value into the raw
column.

**On the server there is no such path.** Of the 22 callers, zero write body metrics back;
`body-metadata/route.ts` is the only file containing both, and they are different handlers — the GET
reads, the POST writes from the request body. Every writer (`sync-health`, `health-connect/ingest`,
`scale-ble/apply-reading`, the Oura rollup) writes from its own input.

**The client has one, and it is worse.** `health-content.tsx:493` and
`session-select/components/log-value-sheet.tsx:32` both seed their log field from
`metaToday[field]` — for body fat, `m.bodyFatPct` straight out of `/api/body-metadata`. So:

1. Health → Body Fat → Log pre-fills with the **corrected** 28.4.
2. Save without editing.
3. POST at source `manual`, which **outranks `scale_ble`** in `HEALTH_SOURCES`.
4. The corrected number overwrites the raw reading permanently, and the next calibration pairs the
   DEXA against an already-corrected value, collapsing the offset toward zero.

A self-corrupting loop that destroys the archive the whole design rests on. **So the correction is
applied per consumer**, and the answer to "how do we not forget one" is a CI check rather than a
convenient place to put it.

## What corrects, what stays raw, and why each

| Corrected | Reaches |
|---|---|
| `lib/health/energy-balance-service.ts` | BMR → resting burn → TDEE |
| `app/api/nutrition-goals/recommend/route.ts` | calorie goal, protein dose, and **`personalRmr`'s current fat-free mass** |
| `persistBodyCompFromMetrics` (`slices/oura.ts`) | the `oura_daily_derived.body_comp` snapshot, per row |

| Stays raw | Because |
|---|---|
| `app/api/body-metadata/route.ts` | it seeds the edit sheet — the laundering path above. This one *must* stay raw |
| `app/api/day-log/route.ts`, `app/health/health-sections.tsx` | display; a corrected number without the `corrected` flag beside it is unexplained, and that flag is step 4 |
| `build-day-audit.ts` | an **audit** reports what was stored; correcting it would make it disagree with the row it audits |
| `app/api/progress-summary/route.ts` | `getBodyMetricsBaseline` is the first reading ever, which predates `source_map` and carries no provenance |

`persistBodyCompFromMetrics` takes the calibration as a **required** parameter, not a defaulted one.
A default would be a silent no-op: the backfill would run, report a write count, and quietly persist
uncorrected snapshots. Both callers — the adapter and the rollup — now fetch it.

## The check is the answer to "one site will be missed"

`scripts/check-body-fat-correction.js` (Custom Rules, now **64 of 64**) has two rules, because there
are two ways to consume a stored reading: *derive* from it (`bodyComposition`/`bodyCompSnapshot`/
`cunninghamBmr`), or *pass it on* (read `bodyFatPct` off a `listBodyMetrics` result). **Rule 1 alone
would have missed the calorie goal**, which never calls a deriver — it feeds `calculateBaseline`.

Rule 2 also found a consumer this session had not enumerated: `build-day-audit.ts`. Every exemption
states why in prose, and a **stale** exemption fails too — a file listed as considered that no longer
consumes anything reads as a decision and gets trusted.

## Verified

- **4 DB-backed consumer tests**, each proving a consumer *moves*: the `body_comp` snapshot, the
  energy-balance resting burn, an uncalibrated instrument staying untouched all the way through, and
  the stored column staying raw with its provenance beside it.
- **Four mutations on the check**, all killed: rule 1 dropped, rule 2 dropped, the goal route reverted
  to raw, and a stale exemption.
- Full suite **680 files / 5,728 tests** · `pnpm check:rules` **Ran 64 of 64** · `tsc` clean.
- **Exercised live on `pnpm dev`**, seeding the owner's real pair (71.7 kg, 25.3 % scale, 28.5 % DEXA):

  | Route | Without the scan | With it |
  |---|---|---|
  | `/api/nutrition/energy-balance` → `restingBaseKcal` | 1832 | **1773** (−59 kcal/day) |
  | `/api/nutrition-goals/recommend` → calories | 1961 | **1889** |
  | `/api/body-metadata` → `today.bodyFat` | 25.3 | **25.3** (raw, as required) |
  | `body_metrics.body_fat_pct` | 25.3 | **25.3** (archive intact) |

  −59 kcal/day is exactly the predicted `3.2 points × 71.7 kg × 0.216 × 1.2`.

- **Protein: be precise about which number moves.** The deterministic baseline shifts as predicted —
  BMR 1528 → 1478, calories 1634 → 1574, protein **118 → 113 g**, lean mass 53.6 → 51.3 kg. The
  *recommended* protein came back 160 both ways, because the model picks that on top of the baseline.
  The plan's "≈5 g/day on the protein goal" is a claim about the baseline, and this is what it looks
  like measured.

## Not exercised

Device, safe-area, native SQLite and WebView paths — server-side only, so no APK. The Lane B display
surfaces are unchanged by design and were not run; `health-sections.tsx` still derives from the raw
payload and is exempt in the check with that reason, pending step 4.

<a id="2026-08-31-diary-nested-meal-rows"></a>

# 2026-08-31 — a logged meal is one diary row, and the hold was the spec (BF-39, LB-30)

**Branch:** `feat/diary-nested-meal-rows` · **Lane B**

## What shipped

BF-39's render half, unchanged from the version built on 2026-08-30 and held that evening: a food
log carrying a `meal_group_id` whose meal still resolves draws as **one row** headed by the meal's
name and picture, and opens to its ingredient rows. Two helpings of the same meal on one day stay
two rows — they share the meal and not the group. Rows logged before the columns existed, and a
deleted meal's rows, stay loose, because nothing back-fills and heading them *Meal* would invent a
name the app does not have. A one-row group is not nested at all.

The meal's name and photo come from `useSavedMealSummaries`, a local-first read on the shared
`saved-meals` key. That was the open question the hold left — a join into the food-log read would
have been Lane A's, and a seed-only read goes stale (the Q-260 shape). The hook is the Lane B
answer and the cheapest to reverse: one file, one consumer.

## Why it was held, and what it actually was

The hold was real: the meal library's swipe tray stopped opening, deterministically, on both CI
attempts and locally, and four measurements narrowed it without closing it. The entry recorded the
conclusion as *"something in opening a meal invalidates `saved-meals`, and a subscriber re-rendering
a sibling subtree drops an in-flight `useDrag`"*, and set the next session's task as establishing
**re-render versus remount**.

**It is neither.** Instrumenting `SwipeActions` with mount/unmount/render logging and the drag
handler with a per-event log, and running the failing pair:

- `SwipeActions` **mounts once** (twice, with StrictMode's discard) and never unmounts. Not a remount.
- The drag handler is **never invoked at all** — not one `first: true`. There is no in-flight gesture
  to drop.
- `notifyInvalidated` logged **nothing** for the whole run. No `saved-meals` invalidation ever fired.

A document-level touch listener showed every `touchstart`/`touchmove`/`touchend` landing on
`DIV.flex-1 overflow-y-auto` — the sheet's scroll container, **beneath** the row. Sampling the row's
rect every frame explained why: it was still moving. `toBeVisible()` passes the instant the sheet
mounts, `boundingBox()` returned **y=605**, and by the time the CDP touch was dispatched the row sat
at **y=503**. `getAnimations({ subtree: true })` on the dialog at that moment: `["enter:running"]`.

So BF-39 never touched the gesture. It added enough work behind the sheet that its open animation
had not settled by the time the spec measured — which is also why disabling the summaries hook
"fixed" it, why moving the hook into a memoised child fixed one spec and not the other, and why both
specs passed when run alone. **Every one of the four measurements was real and every conclusion
drawn from them was wrong**, because each of them changed how much work the page did, and that is
the variable the failure was actually sensitive to.

## The fix, and the rule it produces

`swipeRowLeft` moved into `e2e/fixtures.ts` and now waits for two `boundingBox()` reads a frame
apart to agree before it measures. The three specs that hand-rolled a CDP swipe —
`meal-detail-artboard-parity`, `my-meals-artboard-parity`, `food-log-swipe-delete` — all go through
it; the third copy is what the extraction rule exists to prevent, and it had already been written.

**`Input.dispatchTouchEvent` does none of the actionability checks `locator.tap()` does**, stability
included. That is the whole rule. `toBeInViewport()` — which `openSavedMeal` uses — does not cover
it either: it is satisfied the moment a pixel of the sheet crosses the fold, several hundred
milliseconds before it lands.

Verified twice, in full, with the grouping shipped: 13/13 across the four spec files, including the
pair that had failed together on every previous attempt.

## Not done

- **LB-30** — 46 `boundingBox()` reads across 27 spec files have the same latent race. Only the ones
  feeding a coordinate tap are exposed, and they fail loudly rather than passing silently, so it is
  filed rather than swept.
- **Not device-verified.** The grouped diary row and the swipe tray have not been exercised on the
  S25; the e2e harness drives the web build, where `getLocalStore` returns null and
  `useSavedMealSummaries` takes its API fallback. The local-first branch of that hook has therefore
  **never run** in any test.
- `projectOverview.md`'s Current Status carried three duplicated `**Version:**` lines and a stray
  `v1.398.0` block mid-section — merge debris from parallel PRs, collapsed here.

<a id="2026-08-31-exercise-clip-ready-screen"></a>

# 2026-08-31 — the movement, on the screen where you are about to do it (BF-65)

**Branch:** `claude/implementation-agent-lane-b-43nmep` · **Lane B** · v1.405.0

## The ask

The owner, with the ready screen and the warm-up screen side by side: *"id like the exercise gif in
the pre session screen so it shows you what movement you will be doing."* The warm-up screen renders
the clip at 40 px; the ready screen — name, last session, bar load, ramp-up, set targets — had no
picture and no route to one, because `ExerciseStatsSheet` carries the gif and is mounted only on the
pre-workout screen.

## The fetch was the real work

The same `fetch('/api/exercise-gif?name=…')` → `{gifUrl, imageUrl}` was hand-rolled in **four**
places: `warmup-screen`, `exercise-stats-sheet`, `config/exercise-preview-sheet` and
`workout-builder/builder-review`. This would have been the fifth, which is two past the point the
extract-before-a-third-copy rule fires. `lib/hooks/use-exercise-media.ts` is now the only fetch, and
all four sites are converted in this PR rather than left as a follow-up.

**The cache key is what makes the feature instant.** `WarmupScreen` fetches media for every exercise
in the session moments earlier, then unmounts on the mode change and the map goes with it. Going
through `exercise-media:<name>` means the ready screen's synchronous seed answers from what the
warm-up screen already fetched — no spinner for a file the app downloaded sixty seconds ago.
`prefetchBinaries` (warm-up only) still pulls the files so the service worker holds them offline.

`freshWithinTtl` is deliberately not set. The seed already gives the instant paint; skipping the
revalidation would trade a one-paint staleness for a six-hour one on a regenerated clip.

## The layout question answered itself

The entry called the layout "a real decision, not a drop-in", because the owner's screenshot already
had `SET TARGETS` cut off behind the action row and a full-width media block would push the bar-load
number — the thing actually being read — further down. So the clip renders at **64 px beside the
name**, tappable into a full-width strip.

Measured rather than assumed: with the collapsed thumbnail in place, **`SET TARGETS` is now fully
visible above the action row**, which it was not in the screenshot that prompted the entry. The
expand exists for a proper look; the movement is legible without it, which is what the owner asked
for.

## What else ships

- `components/workout/exercise-media-panel.tsx` — memoised, taking the name and fetching its own
  media, so the one prop is a scalar no call site can destabilise and the media arriving re-renders
  this and nothing else.
- The warm-up screen's dumbbell fallback, for the bodyweight and unmatched exercises the route
  answers with two nulls. A defined state, not a gap where the layout expects a picture.
- `aria-expanded` on the toggle, and a 64 px target — over the 48 dp floor.
- **The stats sheet's skeleton stopped waiting on a picture.** Its history and gif shared one
  `Promise.all().finally(setLoading(false))`, so a seeded history — which is meant to paint on the
  first frame — still sat behind the media. The skeleton and the error line both name the history;
  now so does the flag. A media failure still raises the same error state, via `onError`.

## Two guard tests, both mutation-checked

Neither hook is testable as React here (both vitest projects are `environment: 'node'`, no
`@testing-library/react`), so the tests guard where this defect class actually lives: **a fifth
fetch copy re-appearing**, and **a `<Image>` losing `unoptimized`**. Removing `unoptimized` from the
panel fails the second; adding a bare `fetch('/api/exercise-gif…')` fails the first; both pass on
the real tree.

## Verification, and the substitution it required

`tsc` clean · ESLint clean (three warnings in these files are pre-existing, confirmed against a
stashed tree) · `pnpm check:rules` **Ran 63 of 63** · 74/74 across `components/workout`, `lib/hooks`
and `components/config`.

Driven in a browser at 412 dp: a real workout from Start Workout through the warm-up to exercise 1's
ready screen and on to exercise 2's, asserting `naturalWidth > 0` rather than the `src` attribute —
**a src is not a picture** — and that exercise 2's clip is not exercise 1's, which is the mis-keyed
fetch the entry warns about.

**That needed a substituted image, and the reason matters.** The dataset's clips live on
`raw.githubusercontent.com`, which this sandbox's egress proxy drops — so every clip renders as a
blank white box here, **including the warm-up screen's own long-standing thumbnails**, which this
change does not touch. The blankness is the environment, not the code; it was confirmed by seeing the
untouched screen fail identically, and CSP was ruled out (the host is in both `img-src` and
`connect-src`). The local `exercise_gif_cache` rows were pointed at same-origin SVGs for the run and
restored afterwards.

## Not exercised

- **The device, and the one thing that matters most on it: whether the clip MOVES.** `unoptimized`
  is what decides that, a guard test holds the prop, and a passing prop is not a moving picture — a
  screenshot cannot tell them apart either. Nothing animated was rendered at any point in this work.
- **Offline playback.** The warm-up prefetch is unchanged, but the service-worker path was never
  exercised; the sandbox could not fetch the binaries in the first place.
- Samsung WebView rendering, and the real dataset's aspect ratios in the 64 px `object-cover` box
  and the 208 px `object-contain` strip.

<a id="2026-08-31-fix-generate-program-name-resolution"></a>

# 2026-08-31 — LA-43: `generate-program` resolves exercise names instead of dropping paraphrases

**Branch:** `fix/generate-program-name-resolution` · **Lane A** · JS/server half only — reaches the
device through a Railway deploy, no APK needed.

## The premise moved, and the real bug was worse than the filed one

LA-43 was filed against `route.ts:330`:

```ts
mainMuscles: libraryMuscles?.mainMuscles ?? ex.mainMuscles ?? [],
```

— three lines below a comment saying the model's muscle output is *"never trusted"*. The entry read
that as a live contradiction: a name the library did not hold would fall through to the model's own
guess.

**It could not.** Sixty lines above, the route already did this:

```ts
const validNames = new Set(filteredExercises.map(e => e.name))
for (const sess of raw.sessions) {
  sess.exercises = sess.exercises.filter(ex => validNames.has(ex.name))
}
```

`validNames` and `exerciseMuscleLookup` are built from the same array, so every surviving name was
guaranteed to resolve and both `??` arms were dead code. The contradiction was real but inert.

**What that filter did instead is the actual defect.** It *silently deleted* every paraphrase. The
prompt's rule 2 says "Use ONLY exercises from the list below. Match exercise names exactly"; the
model writes "Barbell Deadlifts", "Press Dumbbell Incline", "Pull-Ups" anyway. Each one was removed
without a trace — so a session came back short of the exercise count the time budget was computed
from, and nothing in the logs, in `error_events`, or in the response said why.

## What shipped

**`packages/shared/src/workout/exercise-name-resolver.ts`** (new). `buildExerciseNameResolver` indexes
the library in three widening tiers — exact, normalised, word-order — and `resolveAgainstLibrary`
returns each exercise under the **library's** name with the **library's** muscles, plus the names it
could not resolve.

Three decisions worth not re-litigating:

- **It reuses `normalizeExerciseName`** from `exercise-gif-matcher.ts` rather than growing a second
  normaliser (One Formula, One Place). Two things are added locally instead of editing it: hyphens
  and slashes are split to spaces (that file *deletes* punctuation, and its `DIRECT_URL_OVERRIDES`
  keys are stored in its output, so changing it has GIF-matching blast radius), and a trailing `s`
  is stripped per word.
- **It stops at word order.** A subset or edit-distance tier would reach "Back Squat" from "Barbell
  Back Squat" — and would equally reach "Bench Press" from "Incline Bench Press". `personal_records`
  and `exercise_estimates` are unique on `(user_id, exercise_name)`, so a wrong merge writes one
  lift's PR onto another's and there is no way back, while a miss costs one exercise. Under-merging
  is the safe direction, the same call `food-item-identity.ts` makes. A test pins the limit.
- **An ambiguous widened key resolves to null**, never to whichever entry was indexed last.

**`app/api/generate-program/route.ts`.** The exact-match filter is replaced by the resolver; a name
the library genuinely does not hold is still dropped (one lost accessory should not cost a whole
generation) but is now **reported to `error_events`**; a session left with **no** exercises returns
**502** with a named error rather than shipping a program that cannot be started. Both `??` arms are
gone — after resolution they are unreachable, and leaving them would keep the contradiction alive.

## Measured, not assumed

Against the real 142-row catalogue, pinned as a DB-backed test
(`lib/data/postgres/__tests__/exercise-name-resolution-library.test.ts`):

| Query shape | Rows that fail to resolve |
|---|---|
| The name itself | **0 of 142** — the exact tier is unchanged, so nothing that resolved before stopped |
| Lowercase variant | **0 of 142** |
| Reversed word order | **0 of 142** |
| Plural (before de-pluralising) | **49 of 121** |
| Plural (after) | **0 of 121** |

That 49 is what justified de-pluralising at all — "Deadlifts", "Pull-Ups", "Planks", "Lat Pulldowns"
were every one of them unreachable, and they are exactly what a model writes.

**The `depluralise` guards were written and then measured away.** An "ss" exception (so "Press" does
not become "Pres") and a length floor both survived every mutation and changed nothing against the
real catalogue — because the transform is applied to the library name and the query alike, so a word
it mangles is mangled on both sides and still matches. They were removed rather than kept as clauses
that read like protection while providing none. The one condition left is structural: never emit an
empty token.

## Verification

- **9 mutations, all killed** except two that were removed as a result (above): punctuation split,
  ambiguity handling, each of the three tiers independently, an *added* subset tier (proving the
  under-merge pin is load-bearing), the name rewrite, the muscle override, and de-pluralisation.
  Removing the normalised tier initially survived — the word-order tier subsumes it — so a case only
  it can answer was added (two library entries differing **only** in word order, where the wider tier
  is ambiguous and the narrower one is not); it then failed.
- **Full suite green:** 677 files / 5,699 tests. `pnpm check:rules` **Ran 63 of 63**. `tsc` clean.
- **Exercised end-to-end on `pnpm dev` against real Gemini**, including a temporary fault injection
  (reverted) that paraphrased the model's output inside the route:

  | Injected | Resolved to | Tier |
  |---|---|---|
  | `barbell bench presss` | `Barbell Bench Press` | case + plural |
  | `Press Dumbbell Incline` | `Incline Dumbbell Press` | word order |
  | `Deadlift Romanian Barbell` | `Barbell Romanian Deadlift` | word order |
  | `Zercher Good Morning Push` | *dropped, and reported* | genuine miss |

  Before this change all four were dropped, six of twelve exercises in that run. An all-unresolvable
  session returned the 502 with `"no usable exercises for: Push"`. Clean runs after reverting the
  injection produced **zero** drops and correct library muscles on every exercise.

## Not exercised

The APK, safe-area, native SQLite and Samsung WebView paths — this is a server route with no device
surface, so the device-verification gate does not apply. The client already toasts `data.error` on
any non-ok status (`components/workout-builder/builder-wizard.tsx`), so the new 502 needs no Lane B
change; that toast was read, not run. Phase-mode generation could not be exercised locally — the
seeded test user has no phase sets, which is a fixture gap, not a regression.

<a id="2026-08-31-lane-a-sleep-provisional"></a>

# 2026-08-31 · Lane A — a night that is still filling, and a builder that knows you are injured

Branch `lane-a/sleep-provisional`. Three items, no migration and no sync-push change, so the whole
batch reaches the device through a Railway deploy — **no APK needed**.

## BF-83 — the engine half: `provisional` on every sleep row

The owner sent two screenshots of the **same night four minutes apart**: 6 h 15 m at 6:44 and
7 h 40 m at 6:48, with every derived number moving, including the 30-night average it was being
compared against. Nothing distinguished the first reading from a finished one.

**The entry listed two candidate mechanisms and the answer was a third.** It proposed either "the
night was still draining" or "the client painted a stale cache", and said `updated_at` could not
separate them. The client half was already ruled out from code. Production settled the rest: the
batch covering 4:46 → 6:38 was **recorded at 6:42**, two minutes before the 6:44 screenshot. The raw
data was there; the *row* was stale, because the rollup had not re-derived from it yet.

That reversed the design. The obvious measure — is the newest ingested sample close to this night's
end? — would have called that night settled four minutes before it grew by 85 minutes.
`getSleepCoverageEnd` reads the **rollup watermark** instead, resolved through the clock anchors:
it only advances when a run *completes*, so it answers "how far has the derivation reached" rather
than "how far has ingest reached", and covers both mechanisms.

- `lib/sleep/provisional.ts` — `isNightProvisional(sleepEndMs, coverageEndMs)`.
  `PROVISIONAL_COVERAGE_MARGIN_MS` is **imported from the sensing-span bridge gap**, not chosen: a
  night can still grow while coverage sits within one bridgeable gap of its end, and a hardcoded
  60 minutes would silently stop being right if that constant moved.
- `getSleepCoverageEnd` on the repository; `/api/sleep-sessions` returns `provisional` per row.
- Computed per request, never stored — the thing it describes changes without the row changing, so
  a stored flag would be stale exactly when it mattered.

Measured against production: last night sat **97 minutes** past coverage and every older night
**1516 minutes** or more, so the margin separates them with a wide gap rather than a fine one. On a
normal morning the badge clears roughly half an hour to an hour after wake.

**Lane B owes the badge and — the half worth not forgetting — excluding a provisional night from
the recent-nights average it is compared against.** That moving baseline is in the owner's
screenshots.

## BF-68 — the program builder now knows you are injured

`injur` appeared **zero times** in the entire builder path: a `.strict()` 13-field wizard payload
with no injury data and no free-text field, so a sore lower back could not reach it.

The important choice is *where* the constraint is applied. Both routes now filter the **candidate
list** with `excludeInjuredExercises`, extracted out of `injurySafeAlternatives` — so the builder
uses the same predicate the mid-workout swap sheet substitutes by, and cannot program an exercise
the swap sheet would then offer to replace. An exercise that is not in the list is one the model
cannot return; an instruction not to program deadlifts is advice. The test that shows the difference
is Good Morning: a hamstring exercise by name, loading the injured back in a secondary role.

`formatInjuryContext` (`packages/shared/src/workout/injury-context.ts`) is the shared line the entry
asked for, exported for **BF-44** to import rather than write a second one.

**Not done, and why.** The builder chat does not *create* an injury record: it is a `generateObject`
route with no tools, and converting it to a tool-calling flow would restructure the builder's whole
response contract. It tells the user to log it under Health → Injuries instead — which is also what
makes the constraint outlive the conversation, the entry's actual complaint. The wizard UI half is
Lane B.

**New behaviour to know about:** when every candidate for the chosen equipment and muscles involves
an injured area, generation **refuses with a 400** naming the muscles rather than programming
through the injury.

## Two findings recorded rather than acted on

- **BF-80** — read the Capacitor source: `BridgeWebViewClient` already forwards
  `onRenderProcessGone`, and `WebViewListener`'s default returns `false`, the documented "kill the
  app" answer. So the missing piece is a listener, not a `WebViewClient`, and the fix is correct
  whether or not the renderer-death hypothesis holds. Left for the next **native** batch — it needs
  an APK, and this one does not.
- **BF-84** — gated on the owner. Its own text says the fact-vs-hint question must be settled before
  scheduling, and the engine half is a row plus a sync domain plus the inference path; that was
  transcribed into a `Gate: owner` field, since `next-item.js` had it at #2 of READY with nothing
  saying it was waiting.

## Tooling

`scripts/lib/keep.js` could not see a `Keep:` stated inside a blockquote banner — neither the match
nor the continuation loop, which *breaks* on a `>`. BF-67 and BF-81 wrote their residue that way and
read as unstarted work at the top of Lane A's READY list the day after they shipped, which is the
exact failure that file exists to prevent.

## Not exercised

Native SQLite / Capacitor plugins, safe-area insets, Samsung WebView rendering, and the on-device
APK path — none of this batch touches them. The sleep flag and both builder routes were exercised
against the local dev Postgres and by prompt-capture tests; **no on-device run**. The Gemini calls
themselves are mocked, so what is pinned is the prompt the model receives, not what it returns.

<a id="2026-08-31-meal-builder-entry-point"></a>

# BF-52 — the entry point, and a test of mine that had run out of time

**Branch:** `feat/meal-builder-entry-point-bf52` · **Lane B** · v1.410.0

Built to [its own plan](../superpowers/plans/2026-08-31-ai-meal-builder-entry-point.md), written
earlier the same day.

## What shipped

A `Recipe photo · Recipe link · Describe it` row in the builder, **above the collapsed ingredient
picker**. That placement is the entry: the three whole-meal inputs used to be *mutually exclusive
renders of one slot* inside a search field you had to open first, chosen by what you had typed — so
the URL option did not exist until you had already pasted the URL.

The engine is untouched. `/api/nutrition/scan` already took `{ image }`, `{ url }` and `{ text }` as
three branches of one handler, and `Describe it` is the third of those reaching the builder for the
first time.

## The instruction the plan declined, shipped as declined

BF-52 says to absorb BF-63's barcode button into the new row. It is not there. These three produce a
**whole ingredient list**; a barcode names **one product**, and under a heading reading *"start this
meal from"* it would promise to build a meal from a packet. It stays beside the ingredient search
with the AI estimate — the other thing that adds one ingredient.

## Two things found while building it

**The URL branch in the search slot stays, and not for convenience.** The plan implied taking both
old affordances out of that slot. Only the photo moved. Without the URL branch a pasted link falls
through to the estimate below — and `ingredient-search.tsx`'s own comment says what that does:
*"running an AI estimate over the text of a URL produces a food called 'https' with invented
macros"*. It is a guard as much as an affordance, and removing it would have reintroduced a known
bad outcome that no test covered.

**`runRecipeImport` came out of `ingredient-picker.tsx` and became testable.** Two callers meant it
could not stay a closure over one component's state. Its own comment said the multi-candidate
branch, the serial minting, the 0.01 floor and the `recipeYield` refusal *"took two entries to get
right"* — four behaviours defended by prose, because exercising them meant rendering a React
component and neither vitest project runs a DOM. They have ten tests now.

## A red e2e that was mine, and predated this branch

`meal-label.spec.ts` failed with a bare 180 s timeout. It failed on **clean `main`** too, so it was
not this change — it was the same spec I lengthened in #692 the same day, which passed in CI there
and sat marginal against its own budget. One test painted seven styles and decoded five.

Split: the share-code assertions are their own test now, with `openLabelSheet` and the style-settle
machinery lifted to module scope. Six tests, each with room, and a failure names which half broke.
**This is the marginal-timeout shape the repo already documents for the Oura rollup tests** — three
of those sat within 20% of the limit and any parallel load tipped them over. A test at its limit is a
test that will fail for reasons unrelated to the code.

## Verified

`tsc --noEmit` clean · `pnpm lint` **0 errors** · `pnpm check:rules` **Ran 65 of 65** · full
`npx vitest run` **692 files / 5,794 passed**, 3 files / 59 skipped · `meal-label` **6 passed**,
and `empty-meal-library` + `builder-barcode-scan` + `nutrition-sheet-surface` **7 passed**.

Every guard is **mutation-tested**, and one of them could not fail when first written: the 0.01-floor
test used a **0.5 g** ingredient, where `ingredientToEntry` already returns 0.01 and `Math.max` is a
no-op — it passed with the floor deleted. It uses **0.4 g** now, which the conversion takes to
exactly 0. Defaulting `recipeYield` to 1, removing the multi-candidate branch, removing the row from
the builder, and neutering the URL guard each fail their own test.

A source guard also matched its own explanatory comment for the **third time today** — a whole-file
grep for "barcode" hit the paragraph explaining why there is no barcode. The assertion slices past
the doc block now.

## Not exercised

- **The device.** *"Describe or enter"*-length labels wrap to two lines in a third of 412 dp; the
  tiles are padding-driven so they grow rather than clip, but whether three tiles plus an expanded
  input read well on the phone is a judgement the sandbox cannot make.
- **The recipe-photo picker on device.** Its Capacitor `CameraSource.Prompt` path is unchanged and
  its named file input is unchanged; only the chrome around it is new. Neither has been on the S25.
- **A multi-dish page through the new row.** The candidate branch is unit-tested and the row wires
  `onCandidates`, but no e2e drives a real two-recipe page.

<a id="2026-08-31-meal-plan-day-fill"></a>

# 2026-08-31 — the meal plan can fill the day, and it stops at the current hour

**Branch:** `feat/meal-plan-day-fill` · **Entry:** Q-187 (step 4) · **Lane:** B · **Version:** v1.412.0

## What was left

Q-187's plan ran in four steps. Three had shipped: the `plan_meal_answers` table with its full sync
path, a one-tap *"I ate this"* per meal, and a per-meal decline. The fourth was the automatic half,
held back deliberately, with its own recommendation attached:

> Only then consider whether prefill should be automatic on day open, or an explicit "fill my day"
> action. **Recommend explicit first** — an automatic prefill that guesses wrong trains the owner to
> ignore it, and the button is one tap.

## What shipped

**`components/nutrition/plan-day-fill.ts`** — a pure module answering *which planned meals a one-tap
log should write*, and holding the one decision that mattered.

**The action is bounded by the clock, and that is the whole design.** The property Q-187 protects is
that the day's totals never count food nobody ate — which is why unconfirmed prefills stay out of
`food_logs` entirely rather than being filtered out of 24 readers. A button that logs the *whole*
day would hand that property straight back: press it at 9am and the macro bars report a full day
eaten, dinner included. The tap is a confirmation, and you cannot confirm a meal you have not had.

So `fillableMeals()` offers, on **today**, only the meals whose hour has come; on a **past** day all
of them, which is the retrospective case; on a **future** day none. It also skips what is already
logged, what was declined, and what has no ingredients to write (plans made before Q-192 stored
names and macros only). An empty result hides the control rather than disabling it.

`planMealHour()` resolves when a meal is meant to happen — `suggestedTime` first, because it is the
more specific answer to *when*, then the meal type's start hour. A meal it cannot place is **not**
offered on today: unlike a past day there is no way to establish it has happened, and the cost of
guessing is logging food nobody ate.

**`app/nutrition/use-plan-meal-logging.ts`** gained `logMeals()`. It is **sequential on purpose**,
which is the opposite of the standing "never await POSTs in a loop" rule and is right here: on the
canonical runtime `logPlanMeal` makes no network call at all — it writes SQLite, queues the outbox
and fires `pushThenRevalidate` behind itself. Running the meals concurrently would interleave those
writes on one connection and start N pushes and N invalidations for no gain. The user waits on none
of it: the button flips synchronously and each meal's rows appear as it lands. One failing meal does
not strand the rest, and the count that failed is reported rather than swallowed. The in-flight
guard is a **ref**, not the state beside it — two taps inside one render both read the old `false`,
which is how this app once turned 5 taps into 4 POSTs.

**`components/nutrition/active-plan-card.tsx`** (new) — the plan card plus the two hooks that drive
it, lifted out of `nutrition-content.tsx`. That orchestrator was at 796 lines and this feature took
it to 813, over the 800-line gate. The seam is a real one rather than a size dodge: logging a planned
meal, declining one and copying one into My Meals are the plan's concerns, and the tab never reads
any of that state. The orchestrator ended at **787 lines — smaller than before the feature.**

## Decisions made here

- **Which meals are fillable is computed inside `MealPlanSection`, not by its caller.** A split plan
  has two variants and `pickVariant` chooses between them; deriving the list outside would let the
  button offer a meal the list below is not showing.
- **An unreadable clock offers nothing on today, rather than everything.** `hourFromTzDatetime`
  returns null on a shape it does not recognise, and the card passes `-1`. A `NaN` would compare
  false against every hour and produce the same outcome by accident; this produces it on purpose.
- **The label says which claim it is making** — *"Log the 3 meals so far"* on today, *"Log all 3
  meals"* otherwise. Only the first is reachable from today's one call site, because the plan card
  renders on today only; the second is the component's honest contract if that gate ever moves.

## Verification

- **Full unit suite green.** `pnpm check:rules` **Ran 65 of 65 Custom Rules steps**, all passed —
  including `check-component-size` (which is what forced the extraction) and
  `check-memo-prop-stability` (91 memoised components, no new defeated call site).
- **19 unit tests** over the selector, and **every guard mutation-checked — 10 mutations, all
  killed**: the future-day guard, the past-day shortcut, the clock bound, the unresolvable-hour
  exclusion, the logged/declined/empty filters, `suggestedTime` winning over the bucket, the bucket
  fallback, and the hour-range check.
- **`e2e/plan-day-fill.spec.ts`** stubs a plan with one meal an hour behind the clock and one an
  hour ahead, then asserts the offer says *one* meal, that pressing it writes that meal and not the
  other, and that the offer then disappears rather than re-proposing it. **Both mutation-checked.**
  The food write is real — `getLocalStore` is null on web, so it took the
  `POST /api/nutrition/food-logs` fallback and the rows landed in the dev database.

**Two things the spec had to be taught, both worth keeping.**

1. **`locator.click()` does nothing on this screen.** The button did not fire — no toast, no
   request, no error. That is **Q-354**, open and measured since 2026-08-17: the date-swipe `useDrag`
   on the Nutrition scroll container swallows mouse input, and mouse is what Playwright sends.
   `tap()` works, and is the faithful input anyway since the canonical runtime is touch-only. The
   backlog entry now records that a spec not looking for this walked into it, because the practical
   cost of leaving it open is a trap for the next spec author, not a user-facing bug.
2. **The spec's meal names are unique per run.** Which planned meals are already logged is derived by
   matching ingredient names against the day's food, and this spec writes real rows — so a second run
   on the same day would find run one's food and correctly offer nothing, failing for a reason that
   has nothing to do with the code. CI provisions a fresh database and would never have shown it.

**Not exercised:** native SQLite and the outbox (`getLocalStore` returns null on web, so the whole
device write path — including the `plan_meal_answers` decline that suppresses a meal from the offer —
went through the API fallback here), safe-area insets, and Samsung's WebView. The new button sits
inside an existing card and anchors nothing, but it has not been seen on the S25.

## Also in this diff

Selecting this item meant applying the path rule to everything above it in Lane B's queue, and five
entries turned out to be Lane A: **Q-275**, **Q-272**, **Q-278**, **Q-279**, **Q-283**. Each now
records its lane and the one-line derivation, which takes Lane B's READY list from 39 to 34. That is
LB-12's problem in miniature — the bulk sweep is still the Orchestrator's, but an entry whose lane
was derived to select against it should not make the next session derive it again.

<a id="2026-08-31-measured-rmr-daily-model"></a>

# 2026-08-31 — BF-42: the daily energy model predicted a resting rate it had been given

**Branch:** `lane-a/next` · **Lane A** · `lib/health/energy-balance-service.ts`. No APK.

BF-33 wired the measured RMR into `calculateBaseline` — the goal wizard. The live daily model is a
third path and was missed: it computed its own Cunningham BMR and never read
`getLatestMeasuredRmr`. Two screens, two resting rates for one person.

**The owner entered the results on the S25 today**, so this stopped being hypothetical while the
entry sat in the queue: `measured_rmr` = **1325 kcal at 51.5 kg FFM**, `dexa_scans` = **28.5 %**,
both dated 2026-08-27 and both confirmed in production.

## It was also the floor, which is the half that silences the calibration

`restingBaseKcal` is `Math.max(round(bmr), round(maintenanceKcal − avgActiveKcal))`. The floor's
comment — *"resting burn can never fall below BMR"* — is sound. The bug is that `bmr` was a
prediction while a measurement existed. For this owner the prediction is **1481** and the
measurement **1325**, so the floor sat **156 kcal above** the measured rate and clamped the
calibrated maintenance up to it. The calibration could not report the truth even when the data said
so.

`bmr` is now the measurement when there is one, so the base and the floor move together.

## The interaction with BF-2, which is the part a direction-only test misses

`personalRmr` re-scales the measurement's Cunningham residual onto **today's** fat-free mass, and
`ffm_kg_at_test` came from the DEXA. So today's has to be the DEXA-**corrected** scale reading, not
the raw one — the two sides must be on one instrument. Passing the raw 25.3 % credits fat-free mass
the owner does not have and reports ~50 kcal/day more than the measurement supports.

**My first test for this did not catch it.** It asserted a *direction* (`personalRmr(raw) >
personalRmr(corrected)`) on the pure function, which is true regardless of what the service does —
the mutation that swaps the service onto the raw value survived it. The test now asserts the exact
expected number through `computeEnergyBalance`:

```ts
expect(res.balance.restingBaseKcal).toBe(Math.round(onCorrected * SEDENTARY_MULTIPLIER))
expect(res.balance.restingBaseKcal).not.toBe(Math.round(onRaw * SEDENTARY_MULTIPLIER))
```

and the mutation dies. Worth recording because the first version *looked* like coverage: it named
the right concept, exercised the right numbers, and could not fail.

## Verified

- 8 DB-backed tests in the consumers file (2 new); **2 mutations killed** — ignoring the measurement
  (the original bug) and re-scaling onto the raw body fat.
- `pnpm check:rules` **Ran 66 of 66** · `tsc` clean · `check-body-fat-correction` OK.

## Not exercised

No runtime pass on `pnpm dev` for this one — the behaviour is covered by the service-level test
above, which calls `computeEnergyBalance` directly with the owner's real numbers. Device,
safe-area and WebView paths do not apply.

---

# BF-67 step 2 — a new program can reference an old one (engine half)

Same branch. `/api/generate-program` takes `referenceProgramId` and puts the referenced program's
structure into the prompt. **Steps 3 (the picker, Lane B) and 4 (the history summary) are not built,
so nothing reaches the owner yet — the parameter has no caller.**

**An id, never a program object.** The structure is read server-side via `listPrograms(userId)` and
the id matched against what that returns, so a program the caller does not own is simply absent with
no separate not-found branch to distinguish the two from outside. Accepting the structure from the
client would be an ownership hole and a prompt-injection surface for nothing the id does not give.

**Bounded at the schema, not by hoping** — 10 sessions × 20 exercises. The note above
`MAX_BODY_BYTES` already records that `equipment` and `musclesToFocus` are unbounded arrays held only
by the byte cap; a program is a larger structure than either. A real five-session program is ~30
names, so the caps do not bite.

## The drift caveat is real, and measured rather than assumed

The plan and the entry both warned that the reference payload must send the library's own names,
because LA-43's resolver deliberately refuses subset matches. Measured against the seeded program:
`Tricep Pushdown` and `Lat Pulldown` resolve, `Front Barbell Squat` → `Barbell Front Squat`, and
**`Bench Press`, `Overhead Press`, `Deadlift`, `Bicep Curl`, `Romanian Deadlift` and `Calf Raises` do
not resolve at all** — the library holds `Barbell Bench Press`, and "Bench Press" is a subset of it.

Those enter the prompt as stored free text. That is the right fallback: the model reads them as
intent, and rule 2 still binds its output to the available list. It is not silently wrong, but it is
weaker than a resolved name, and the entry now says so.

**End-to-end against real Gemini, same inputs with and without the reference:**

| | without | with |
|---|---|---|
| Push #2 | Incline Bench Press | **Barbell Overhead Press** ← referenced |
| Legs #2 | Leg Press | **Barbell Front Squat** ← referenced |

So the steer works through the drift. **My first check said otherwise and was wrong** — it compared
the output against the program's *stored* names, which the route never sends, so the intersection was
empty by construction. Comparing against the resolved names is what shows the effect.

<a id="2026-08-31-no-save-preference-in-effect"></a>

# 2026-08-31 — CI refuses `savePreference` inside a `useEffect` (LB-28)

**Branch:** `fix/no-save-preference-in-effect` · **Lane B**

## The footgun

`useEffect(() => localStorage.setItem(K, v), [v])` is a free write. The same line calling
`savePreference` is a **network PATCH on every mount**, and nothing at the call site says so.

One such site shipped: `goals-progress-card.tsx` mirrored its view mode into a preference from a
mount effect. Inside Health's launch burst that PATCH and a `GET` behind it stayed **pending past
sixty seconds**, and nine e2e specs failed on `waitUntil: 'networkidle'` — none of which mentions
preferences. **The screen a failure like that names is never the screen that caused it**, which is
what makes the rule worth enforcing rather than remembering.

`usePersistedPreference` is the shape a mirror wants: local write on the first settled value, PATCH
only on a genuine change, and its guard compares the **value** rather than counting runs, because
StrictMode invokes an effect twice on mount and spends a `firstRun` ref.

## What ships

- `scripts/lib/save-preference-in-effect.js` — the scanner, separate so it can be driven against
  fixtures. It **blanks comments and string literals before counting parentheses**: an unbalanced
  paren in either would extend an effect's span across the rest of the file and report call sites
  nowhere near an effect. It takes the whole `useEffect(…)` call rather than a braced body, so a
  concise `useEffect(() => savePreference('x', v), [v])` — which has no braces — is caught too.
- `scripts/check-save-preference-in-effect.js`, wired into the Custom Rules job. The gate now runs
  **63 of 63**.
- `scripts/__tests__/save-preference-in-effect.test.ts` — ten cases: the shape that shipped, the fix
  that replaced it, concise bodies, `savePreferences`, handlers beside effects, and both
  span-extension hazards.

**Proved by mutation, on the real file**: restoring `goals-progress-card`'s effect makes the check
fail at that exact line; reverting makes it pass.

## The entry's premise was wrong, and it is worth knowing why

LB-28 said *"there are none today"* about sites needing an exemption. **There are two.** The grep
behind that claim looked for `savePreference` on the same line as `useEffect`, which is a shape
nobody writes — the defect always spans lines.

Both are exempted with the reason written in the script:

- **`lib/user/preferences-sync.ts`** — this *is* `usePersistedPreference`. The effect is the
  mechanism, and its value-comparing guard is what makes the PATCH conditional.
- **`app/session-select/session-select-content.tsx`** — Home reconciling `homeSectionOrder` after a
  card widget is toggled in Profile. It returns early unless the order genuinely changed, so it is
  not a per-mount PATCH; the write is the point of the effect rather than a mirror of state.

An exemption here is not a debt row. It says the rule's shape and the site's shape happen to
coincide, which is why each one has to be argued in the diff.

## Not done

- **The second exemption sits next to LB-29 and is not covered by it.** That effect can write during
  the window before hydration settles — a preference overwrite race — which is LB-29's subject, still
  open and still waiting on the owner's choice between a dirty mark and seed-if-absent.
- The rule is deliberately narrow: one helper whose cost is invisible in its name. It is **not** "no
  fetch in an effect", which is most of this codebase and which `check-fetch-once-effects.js`
  already ratchets from a different angle.

<a id="2026-08-31-nutrition-batch-bf60-63"></a>

# 2026-08-31 — the swipe tray's first tap, a scan in the builder, a tab called Search, and real clearance (BF-60/61/62/63)

**Branch:** `feat/nutrition-batch-bf60-63` · **Lane B** · batch `nutrition-ui-uplift`

Four owner reports from one device pass, shipped as one PR because they share one screen and one
device check.

## BF-61 — Delete needed two presses

The row carries `transition: transform 0.22s`, and hit-testing follows the **animated** transform.
For those 220 ms the row is still physically over part of the tray, so a tap lands on the row, which
swallows it; the second tap, after the settle, reaches the button. The owner confirmed the cause
himself — *"if I wait a second it works."* The tray now stacks above the row while open.

**Shortening the animation was explicitly not the fix**: a window that swallows input at 220 ms
still swallows it at 100 ms, only less reportably.

### The regression test took three attempts, and the failures are the useful part

1. **A long drag proves nothing.** 200 px rubber-bands past the resting offset, so the row animates
   back **rightwards** and never covers the tray. Measured at −97 px against a −64 px rest.
2. **A short flick snaps closed.** `@use-gesture` derives velocity from the interval, and a
   CDP-paced drag with `waitForTimeout(16)` lands under `FLICK_VELOCITY` — so `shouldRestOpen` fell
   through to its distance rule, which a 20 px drag also fails. The probe showed
   `trayHidden=true`: the tray never opened at all, and the test was failing for the wrong reason.
3. **A tap at the tray's centre is uncovered almost at once.** The tray uncovers from its **right
   edge** first, so a point 32 px in is clear within a frame of release.

What reproduces it: a **36 px** drag (rests open on distance, leaving the row short of its offset), a
tap **52 px** into the tray, and the transition stretched to **6 s** so the window is wider than one
protocol round-trip. Only the duration is changed; the fix is duration-independent. Without the
stretch the tap sometimes lands after the settle and the test passes whether or not the bug exists —
**a false green, which the first version of this test actually was.**

## BF-62 — the fix is not the one the entry proposed

The entry's hypothesis was `h-[92vh]` overshooting under edge-to-edge. It is not that, and the real
answer was already written down in this repo: `SheetContent side="bottom"` bakes `.pb-safe-action`,
which is the inset against a **0.75rem** floor, and the comment beside `.pb-safe-action-lg` in
`globals.css` records the on-device measurement — under Capacitor's edge-to-edge the WebView is
drawn behind the nav bar, so **the inset reports the bar's own height**. Padding by
`max(inset, 0.75rem)` therefore pads by exactly the bar and leaves a primary button flush on it.
That is *"the safe space is still a little off"*, and the height was never involved.

`SheetContent` and `SheetFooter` — the two places that bake the bottom inset — take
`bottomInset="takeover"`, and five takeover-height nutrition sheets pass it. **The class is chosen,
not appended**, because tailwind-merge cannot see these custom classes and the two would stack, which
is the same fact CLAUDE.md records about `p-0` not stripping the baked padding.

## BF-60 — `Single foods` → `Search`

The label was right when written and BF-48 made it wrong by giving that tab the food database. Meals
keeps a box of its own, so the two are worded to carry the distinction the label now rests on: Meals
**filters** a list you own, this **searches** past it (`Filter your meals`). Five specs selected the
tab by its old name and were swept with it.

## BF-63 — a packet can be scanned instead of typed

Log Food has had `Photo · Barcode · Describe` since it shipped; the builder, one screen further into
the same sheet, had only the text field.

**Not `CaptureActions`, though it holds the same scanner.** Its hit routes into the food logger and
lands on today's diary — reusing it would have silently logged breakfast while the user was writing a
recipe. A scan inside a builder is `addExternalFood` with `source: 'barcode'` instead of `'text'`,
which is the distinction that file's own comment already asked for.

A printed meal label scans as a 22-character token; inside a builder that would mean nesting a meal
as an ingredient, which does not exist, so it is recognised and refused rather than handed to a
product lookup that can only 400 it.

**The code itself is not stored, and that is a decision rather than an omission.** `barcode` is NULL
on every `food_items` row in production, including the three already marked `'barcode'`: the route
does not return what it looked up and `NewFoodItem` has no field for it. Threading it is the route,
the shared create path, the local table and the outbox payload — all **Lane A**, all BF-38's subject.
This defers rather than becoming a fourth writer of NULL.

## Not done

- **Nothing here is device-verified**, and three of the four entries stay in the queue for exactly
  that. BF-62 needs **both** navigation modes: the inset differs, and checking one is what lets this
  class through. BF-61 needs the fast tap on **both** trays — BF-29's pass on 2026-08-30 was the meal
  list, tapped slowly. BF-63's scan needs a camera, which no harness here has; its spec asserts the
  affordance and that it reaches the scanner, and stops there.
- `components/activity/exercise-review-sheet.tsx` (`h-[85vh]`) was left alone: no bottom-anchored
  action row, another domain, nothing reported.

<a id="2026-08-31-nutrition-sheet-surface"></a>

# BF-75 — the sheets carry the tab's palette, and the obvious fix could never have worked

**Branch:** `feat/nutrition-sheet-surface-bf75` · **Lane B** · v1.409.0

The owner: *"just the fact that it's a plain black screen on every nutrition pull-up screen; if we
could have a good background for these pages it would be good. Maybe we need a theme for nutrition of
sorts."*

**A nutrition theme already existed** — `--screen-palette-nutrition`, rendered behind the tab. Every
sheet opted out of it, because `SheetContent`'s base class list starts with `bg-background`.

## The obvious fix is wrong, and knowing why decided the design

Make the sheet translucent and let the wallpaper through. It cannot work: the wallpaper is
`fixed inset-0 z-[-1]` while `SheetOverlay` **and** `SheetContent` are both `z-50`. A transparent
sheet reveals the overlay's `bg-black/50` — a black panel, which is what was already there. Turning
the overlay off instead would take away the dimming that separates a modal from the page, and on a
sheet of macro numbers and ingredient rows that dimming is part of what keeps small grey text
readable.

So the palette is **painted inside** the sheet: an `absolute inset-0` layer carrying
`screenPaletteVar(key)` plus the same `ScrimLayer` the DetailHero pattern uses, behind an opt-in
`surface="page"` prop. Opt-in because `SheetContent` is the app-wide primitive — every sheet in every
tab renders through it, and a default here is the *"no global element-selector styling"* hazard
wearing a component's clothes. Five nutrition sheets pass it; a test asserts nothing else does.

## The thing that would have shipped broken

`SheetContent` is `fixed z-50`, so it **establishes a stacking context**. Inside one, an `absolute`
child with no z-index paints *above* the non-positioned content — the gradient would have covered
every row of every sheet it was added to. `-z-10` is what puts it above the sheet's own background
and below its children.

**A hit test cannot see that, and this was measured rather than assumed.** The first version of the
e2e assertion used `document.elementFromPoint` at the centre of a tab, on the reasoning that a
covering layer would be the topmost node there. It is not: the layer is `pointer-events-none`, so
hit-testing skips it whatever its paint order — **the spec passed with `-z-10` deleted.** It reads
the computed `z-index` now, which fails on that mutation and is also stronger than asserting the
class, since a class survives ceasing to be a real utility.

## Two findings the entry did not have

**The dynamic background ships `enabled: false`.** So this is invisible to anyone who has not turned
wallpapers on — deliberately, since a sheet painting a gradient over a plain page is worse than the
opaque sheet it replaced. The owner's own screenshots show the warm brown behind the day screen, so
they have it on. It also means the sandbox shows nothing by default, which is why the e2e has to
switch it on before it can assert anything at all — the "passes because the feature is off" trap.

**`pathnameToSection` and `pathnameToPaletteKey` were private to `dynamic-background.tsx`.** The
sheet and the wallpaper behind it must agree on which palette a route has; two copies would disagree
the first time a route moved, and the failure is a sheet in one colour over a page in another. They
moved to `lib/background/pathname-routing.ts` — which also made them testable for the first time,
since a `usePathname` hook and a weather fetch previously stood between them and any assertion.

## Verified

`tsc --noEmit` clean · `pnpm lint` **0 errors** · `pnpm check:rules` **Ran 65 of 65** · full
`npx vitest run` **690 files / 5,779 passed**, 3 files / 59 skipped.

`e2e/nutrition-sheet-surface.spec.ts` seeds the persisted store through `addInitScript` — before the
first paint, since writing it after `goto` races the render being tested — and asserts the layer
mounts, carries `--screen-palette-nutrition` rather than another screen's, resolves to a negative
z-index, and leaves the sheet usable. A second test asserts that with the wallpaper **off** no layer
mounts at all.

Every guard is **mutation-tested**: dropping `-z-10`, removing the `ScrimLayer`, removing the
wallpaper-off gate, and taking `surface="page"` off one call site each fail their own test — and the
z-index mutation fails the **e2e**, which is the one that matters.

## Not exercised

- **The contrast check, which is the whole of what BF-75 still owes.** Body and secondary text over
  the gradient plus scrim has to hold ≥4.5:1 on the S25, and the dense sheets are where it will fail
  if it does. The sandbox renders the palette but is not the device.
- **How it looks beside an unchanged sheet.** That Health, Workout and More do not opt in is held by
  a test; whether the difference reads as deliberate is a judgement for the phone.
- **Anything about the wallpaper itself.** It is off by default here, so every visual claim above is
  about a state the e2e forced on.

<a id="2026-08-31-nutrition-uplift"></a>

# The nutrition uplift batch — BF-72, BF-73, BF-74, BF-76

**Branch:** `feat/nutrition-uplift-bf72-76` · **Lane B** · v1.407.0 · four entries, one PR, because
they are verified the same way: one device pass over the same two screens.

## BF-72 — the diary's own hydration wiped the grouping it had just drawn

The owner's report was the diagnosis: *"when I add my saved meal it starts as the meal with the
image, then breaks into its ingredients."* The optimistic write is right; something after it is
wrong.

`use-food-logs-loader.ts` re-hydrates the local store from the server response and then immediately
re-reads and renders it. Its `foodLogs` payload omitted `savedMealId` and `mealGroupId` — and a local
upsert **overwrites every column it is given**, writing `record.savedMealId ?? null`. So the screen
destroyed its own grouping and then displayed the damage.

**The sweep the entry demanded is now evidence rather than an assumption.** There are exactly two
`applyDelta` callers. The sync engine's mapping already carries both ids, under a BF-39 comment
saying why it must. This screen-level hydrate was the one site that audit did not reach.

**Extracted to `food-log-hydration.ts` rather than fixed in place**, because the defect is a *missing
field in an object literal* — the shape no type error catches, since every field is optional going
in. As a named function it has a test that lists the columns.

**The entry's second finding was measured and is inert.** It flagged `syncStatus: 'synced'` as
possibly handing the pull-clobber guard a value it did not earn. `applyDelta`'s food-logs arm
hardcodes `'synced'` in both its VALUES and its SET, never reads the payload's field, and gates on
`WHERE food_logs.sync_status='synced'` — so a row with a mutation still in the outbox is protected by
its *stored* status regardless. Changing it would have looked like a fix and been none. Decided
rather than inherited, which is what the entry asked for.

## BF-73 — and the finding that came out of it

Tiles **60 px → 79 px** (measured), icons `h-5` → `h-7`, label to `text-xs`. `New` is now 324×48
filling the row with a 48×48 bin beside it — the hierarchy the owner asked for, since creating a
meal is frequent and deleting several is rare.

**The mechanism was not the one anyone assumed.** `min-h-[Npx]` **does nothing on a `<button>` in
this app**: `globals.css` sets a bare `button, [role="button"] { min-height: 48px }` and it beats the
utility. Measured — a button with `min-h-[84px]` computes `48px`; the same class on a `<div>`
computes `84px`.

So **BF-50 ①'s `min-h-[62px]` never applied**, and its comment — *"62 px, from the artboard's capture
tiles"* — describes a tile that actually measured **60**. The height has always come from padding and
icon size. The inert class is removed rather than left implying a floor it does not set, and the
general case is filed as **LB-32**: 46 of the app's `min-h-[Npx]` uses are `44px` and 26 are `48px`,
all at or under the floor and therefore over-satisfied, so only a handful can lose anything.

The bin is icon-only but its accessible name is `Delete meals`, not `Delete`. Those words are the fix
BF-50 ④ shipped for *"you cant do anything with it except delete"*, and the accessible name is now
the only thing carrying them.

## BF-74 — a destructive control in the dismiss corner

`meal-detail-sheet` passes `hideCloseButton`, so the photo's ✕ at `right-0 top-0` was the **only** ✕
on the screen, in the one corner a user reads as "close this". A reach for dismiss deleted the photo.
That is a wrong-meaning problem, not a small-target one — which is why making it bigger would have
made it easier to hit by accident.

It is a **bin at the bottom-right** now, 44 dp, and removal is **undoable**. Undo rather than a
confirm because re-picking is already one tap: the toast spares the gallery round-trip without
putting a dialog in front of the common case.

**The sibling sweep found one shape, not two:** `MealPhotoTile` has a `tile` variant, but both call
sites pass `hero`, so `tile` has no callers at all.

## BF-76 — the sweep, and why nothing changed

**The entry's leading hypothesis is wrong, and that is the useful output.** It proposed
`h-[92vh]` → `dvh`, reasoning that `vh` overshoots the WebView viewport. But a bottom sheet is
`fixed inset-x-0 bottom-0`, so its height moves only its **top** edge — the bottom clearance is
entirely the baked `pb-safe-*` class. Swapping the unit would change where a sheet clips at the top
and nothing about the gesture bar.

Measured in a browser with the real class strings (the sandbox reports the inset as 0):
`pb-safe-action` = 12 px, `pb-safe-action-lg` = 64 px, and `p-0` does **not** strip either — both
`p-0` sheets compute 12 px, so the repo's standing tailwind-merge claim holds.

| clearance below the bottom control | sheets |
|---|---|
| 64 px — the BF-62 reference | `meal-detail`, `saved-meals` (declared once, on the content) |
| **76 px web / 88 px device — declared twice** | `meal-plan-setup`, `meal-plan-manage`, `meal-plan-edit` |
| 12 px web / 24 px device, content-sized, no bottom control | the other seven |

**Nothing is under-padded. Three are over-padded** — the opposite of what was expected. Those three
declare the inset on the `SheetContent` (default `action`) *and* on a `SheetFooter` (`takeover`), and
the two add.

**No code changed, and that is the decision rather than an omission.** The primitive cannot express
the fix: `SheetContent side="bottom"` and `SheetFooter` each always emit a `pb-safe-*` class, so the
options are 76 px (today), 80 px (move it to the content), or a `"none"` escape hatch whose failure
mode is a sheet with no bottom inset at all. Trading a 12–24 px cosmetic gap for that footgun is a bad
deal, and every candidate sits within ~24 px of the reference.

## Verified

`tsc --noEmit` clean · `pnpm check:rules` **Ran 64 of 64** (the count moved with #676's new check, re-run after merging it) · full suite **526 files / 4783 passed** ·
`meal-photo-picker` + `zero-calorie-food` e2e green (7 tests), which is the pair that exercises the
renamed remove control and the capture tiles.

Every guard is **mutation-tested**: reinstating BF-72's exact omission fails 3 of its 6 tests, and
putting the ✕ back in the dismiss corner / renaming the bin to `Delete` / pinning the tile to a fixed
height each fail their own.

Measured at 412 dp in a browser and screenshotted: tiles 79 px, `New` 324×48, bin 48×48.

**One gate failure worth recording, because it was prose rather than code.** The *No nested button
inside a role=button wrapper* rule is a line grep, and it flagged a **comment** in
`capture-actions.tsx` that happened to name both `<button>` and the role attribute on one line. The
comment was reworded rather than the rule weakened — it is doing its job, and the ambiguity was
mine.

## Not exercised

- **The device, for all four.** BF-72's is not a formality: the whole repaired path lives in
  `getLocalStore`, which **returns null in the web sandbox**, so it cannot execute off-device at all.
  What is proven is the mapping function; what is unproven is the owner's own report.
- **BF-74's undo toast against a thumb.** Whether it is reachable before it dismisses is the one
  thing a desktop browser cannot judge.
- **BF-76 entirely.** The sandbox reports `env(safe-area-inset-bottom)` as 0, so every number above
  is the web column; the device column is arithmetic, not measurement.
- **The bin at fewer than two saved meals.** `canSelect` hides it, and the seeded database has none —
  two were inserted to photograph the row and removed again.

<a id="2026-08-31-plan-dexa-filter"></a>

# 2026-08-31 — BF-2 gets a plan, and two shipped engines turn out to have no way in

**Branch:** `plan/dexa-filter` · **Lane A** · docs-only. Nothing implemented.

BF-2 sat at the head of the queue with an owner promotion on it (*"first we need that Dexa scan
filter applied so it shows Body fat on the current scale as per a dexa result"*) and **no plan** —
its own entry said it needed a planning session before implementation. This is that session.

## The finding that changes what "done" means

Re-verifying the entry against production rather than reading it:

| Claim | Status |
|---|---|
| `dexa_scans` + routes exist (BF-41, migration 240) | ✅ |
| The RMR half is split out as BF-33 | ✅ **shipped** — `measured_rmr`, `personalRmr`, `/api/measured-rmr` |
| The scale half of the calibration pair exists | ✅ 2026-08-27, 71.7 kg, 25.3 %, `scale_ble` |
| The scale is *consistent* — the premise the whole design rests on | ✅ twelve consecutive days in **24.9–25.5 %** |
| The DEXA half is stored | ❌ **`dexa_scans` holds zero of the owner's rows** |

**And it cannot be.** `grep -rn "dexa-scans\|measured-rmr" app/ components/ lib/` outside `app/api/`
returns nothing — no screen, no form, no client fetch on either route. `measured_rmr` is empty for
the same reason. Two engines shipped a day and five days ago respectively, both correct, both
unreachable; the owner's real results have been transcribed in `docs/clinical-baseline-2026-08-27.md`
for four days with nowhere to go.

**Nothing was going to catch this.** No test breaks when a table stays empty, no check goes red, and
the routes themselves are fine. The tell is a populated `docs/` transcription with an empty table
behind it. Filed as **LA-44**, which does not block *building* BF-2 — the correction engine is inert
with zero pairs — but does block the owner seeing it, which is what they asked for.

## Two decisions in the plan reverse what the entry assumed

**The pairs are derived, not stored.** The entry says the stored thing is "a set of paired (scan,
scale) observations". Both halves are already first-class rows — `dexa_scans.scanned_on`/`pct_fat`
joined to `body_metrics.date`/`body_fat_pct`, keyed by `source_map->>'body_fat_pct'` — so a stored
pair is a **stored counter wearing a different hat**, and every one of those in this project has
drifted. Deriving means a second DEXA becomes a second pair with no entry step, and it takes the
whole entry off the migration budget: **no new table, no migration number.**

**Offset, not ratio, at n=1.** They are numerically identical with one pair, so this is a choice about
how the correction degrades. A ratio asserts something specific about the bias at readings never
observed — at a scale reading of 5 % it implies a gap of 0.6 points. An offset asserts only what was
measured. Ship the offset and revisit at n = 2.

A third thing is *retired* rather than decided: the entry warns that adding a DEXA source means
editing `health-source.ts` and its inlined SQL `CASE` together or the ladders diverge. Under
read-time correction the DEXA never writes to `body_metrics`, so that edit does not happen at all.

## The consumer that must not be missed, and why it comes for free

`personalRmr` re-scales a measured RMR's Cunningham residual onto **today's** fat-free mass.
`ffm_kg_at_test` comes from the DEXA (51.46 kg); today's comes from the scale. Feed it the
uncorrected scale number and the two are from different instruments — 53.56 vs 51.46 kg, which
re-scales the residual onto **+45 kcal/day** of fat-free mass the owner does not have, permanently
and from the first day.

It needs no patch of its own: `goal-recommendation.ts:178` passes it a `leanMassKg` that
`bodyComposition()` derived from the body-fat input, so correcting **the input** fixes it by
construction. That is precisely why the plan puts the correction at the input boundary rather than at
each consumer — but the plan says to prove it with a test that fails without it, not to assume it.

## The correction reaches a third of the history

The three instruments turn out to occupy **contiguous, near-disjoint date ranges** rather than being
interleaved: no provenance at all from 2026-05-07 to 06-23 (40 rows), `health_connect` to 08-01
(11), `scale_ble` from 07-29 (31). So "fixing previous values" corrects **31 of 82 rows** and leaves
the earlier two-thirds alone — putting a **~3.2-point step in any body-fat chart at 2026-07-29** that
will read as a change in the body rather than a change in the correction.

**Widening the correction to close it is the wrong fix.** The provenance-less rows predate
`source_map` and are *probably* the same scale, but "probably" is exactly how a calibration gets
applied to an instrument it was never measured on — which the owner's own refinement ("the filter is
per measurement system, not global") rules out. The plan closes it by labelling: `corrected` is
carried **per reading**, so the chart can mark where the calibrated span begins.

## What the plan deliberately leaves alone

Only `body_fat_pct` is corrected. `muscle_mass_kg`, `bone_mass_kg`, `body_water_pct` and the rest come
from the same BIA call, and **no pair exists for them** — the DEXA reports lean and lean+BMC, which is
fat-free mass, not Renpho's "muscle mass". Deriving a correction for those from an FFM measurement
would be inventing a calibration nobody took. The panel is therefore internally inconsistent by
construction, and the Lane B half has to label it rather than hide it.

## Also noticed, and filed nowhere else

**The 🔵 marker on seven backlog headings has no legend.** It is on BF-1, BF-2, BF-3, BF-5, BF-7,
BF-9 and PS-7, and `grep -rn '🔵' docs/` finds no definition in the backlog protocol, in
`docs/agents/README.md`, or in `next-item.js`. All seven are large owner-requested features, so it
plausibly means "needs a plan" — but nothing says so, and a marker that has to be inferred is a
marker that will be applied inconsistently. Recorded here rather than guessed at; it is Orchestrator's
to define or remove, being the owner of the queue's conventions.

## Not exercised

Docs only — no code, no tests, no runtime surface. The production reads behind the findings above are
**row-scoped to one user** (`claude_ro`), so "zero rows" means *none of the owner's*; that is the
claim BF-2 needs and it is the only one this endpoint can support.

<a id="2026-08-31-profile-partial-patch"></a>

# 2026-08-31 — BF-78: a PATCH that was a PUT, and the second half the entry did not see

**Branch:** `lane-a/next` · **Lane A** · server + two Lane B call sites the entry places in the same
change. No APK.

`updateUserProfile` wrote display name, height, date of birth and weight goal unconditionally as
`?? null`, so any body omitting them erased them. One caller already sent a one-field body — accepting
an activity-level recommendation — so a single tap would have taken height with it, and height feeds
the BMR fallback, so the loss would have reached the calorie model rather than stopping at the
profile screen.

**Confirmed latent, not an incident.** Production still reads a display name, height, a date of
birth and a weight goal. *(The entry says height 160; it is **158**, which matches the 158.1 cm on
the DEXA printout. Corrected here because I quoted it.)*

## The half the entry missed, and why fixing only its half would have been worse

The entry's fix was "make the four conditional, the same way the other four already are". That is
the adapter. **The route destroys the distinction before the adapter can act on it:**

```ts
heightCm: heightCm ?? undefined,      // an explicit null becomes undefined
sex: sex !== undefined ? sex : undefined,   // …except this one, which is correct
```

So `{"heightCm": null}` and a body that never mentions height arrived identically. Guard the adapter
alone and the result is a route where **no field can ever be cleared** — trading a wipe-everything
bug for a clear-nothing bug. `sex` was already right, and its `!== undefined` test is the shape the
other seven now follow: the route forwards only keys that are actually present, derived from
`ProfileSchema.shape` so the list cannot drift from the schema.

**Timezone is the one column a null must not clear.** It keys every day window in the app; a user
with no timezone has no "today". Absent and null both leave it alone, and that is now stated in code
rather than being a side effect of a truthy check.

**An empty `set` had to be handled too** — Drizzle rejects `.set({})`, so a body naming no known
field returns the current row instead of throwing.

## The workarounds are deleted, not left

Both defensive resends are gone, which is the part that stops the next reader re-deriving the bug:

- `edit-profile-sheet.tsx` sent five fields it does not edit, with a comment explaining that the
  route was not a true partial update. It now sends the three it owns.
- `goals-section.tsx` sent the whole profile. **That one was a second hazard, not just redundancy:**
  it resent `displayName` and `weightGoalKg` from a possibly stale `user` prop, so saving a goal
  could overwrite a name changed elsewhere in the same session.

## Verified

- **5 DB-backed tests**; **3 mutations killed** — restoring the unconditional four (fails 3 of 5),
  weakening the timezone guard to a presence check, and removing the empty-set guard.
- Full suite **687 files / 5,759 tests** · `pnpm check:rules` **Ran 65 of 65** · `tsc` clean.
- **Exercised through the real route** on `pnpm dev`:

  | PATCH body | Result |
  |---|---|
  | `{"activityLevel":"moderate"}` | only `activity_level` changed; name, height, DOB, goal, tz intact |
  | `{"heightCm":null}` | height cleared, everything else intact — **impossible before this change** |
  | `{"timezone":null}` | timezone unchanged |
  | `{}` | 200, no-op, no 500 |

**`check:rules` caught my own test**, which asserted a date with `toISOString().slice(0,10)` — the
banned UTC-slicing pattern. Right to refuse it: the assertion compares an instant now.

## Not exercised

The two edited sheets are Lane B UI and were not run — their change is a smaller request body, and
the route behaviour behind it is covered above. Device, safe-area and WebView paths do not apply.

## Also updated

Three references to BF-78 in the profile-consolidation entry, including its `Needs:` line, which is
now unblocked. Its claim that the split "is what makes BF-78 dangerous" is rewritten: the danger is
gone, the mess it describes is not.

<a id="2026-08-31-recovery-scores-name-their-question"></a>

# 2026-08-31 — Readiness and Body Battery each say which question they answer

**Branch:** `fix/recovery-scores-name-their-question` · **Entry:** Q-276 · **Lane:** B · **Version:** v1.413.0

## The finding, and why it was not a modelling bug

Measured over 31 post-re-key days:

| pair | r | n |
|---|---|---|
| Readiness ↔ Body Battery **anchor** | +0.93 | 31 |
| Readiness ↔ Body Battery **end value** | **+0.12** | 31 |

The anchor correlates at +0.93 because it *is* readiness. By end of day that has decayed to +0.12 —
and the two numbers sit one directly above the other on Home, both read as *"how recovered am I"*.

The owner settled it in 2026-08-19 rather than picking a winner:

> *"Body battery should be more like 'how much energy I have left'. Readiness should just be a
> starting number based on your previous day + sleep, so you can see how your day is typically based
> on data."*

**Two different questions, not one question answered twice.** That makes it a presentation contract,
which is why it was Lane B's rather than Lane A's. And **readiness needed no model change to match
the definition** — all nine `READINESS_WEIGHTS` contributors are overnight or previous-day measures
(`previousNight`, `restingHeartRate`, `hrvBalance`, `temperature`, `sleepBalance`, `checkin`,
`prevDayActivity`, `recoveryIndex`, `activityBalance`). Nothing reads today's activity. It was
already the number the owner described; nothing said so.

## What shipped

**`components/body-battery-card.tsx`** — one line under the collapsed headline: *"Energy left right
now — opens at your readiness and drains as you use it."*

**The card already said this, and better.** The problem was where: the explainer lives in the
expanded body **and renders only when `battery.hasData` is false**. So it is one tap away *and*
gated on the empty state — on any ordinary day, with data, nobody has ever read it. Two reasons
nobody sees a line is one too many.

**`components/health/health-score-detail.tsx`** — a `subtitle` slot under the hero, and
**`app/health/readiness/readiness-content.tsx`** fills it: *"How your day is likely to go, set this
morning from last night's sleep and yesterday. It does not move as you use energy — that is Body
Battery."*

The second sentence is the load-bearing half. *"A morning number"* on its own does not stop a reader
taking it for the live one; saying what it is **not**, and naming what is, does. And it is a checked
property of the model rather than a simplification for the reader.

## Where the framing sits, and why not on Home

The obvious move — a paragraph on Home explaining the pair — was not taken. Home is the densest
screen in the app and the score chip row has **eight** ring-style layouts, three of which (pill,
rail, minimal) have no room for a subtitle at all; adding one would mean touching every layout and
would still fail in half of them.

Instead the battery card carries its own line, and the card sits **directly under the readiness
chip**. So the disambiguation is at the exact point of adjacency Q-276 names, at no cost to the
layout, and readiness's own framing is one tap away on its detail screen — the same distance
Body Battery's used to be, except now it renders.

## Verification

- `pnpm check:rules` **Ran 65 of 65 Custom Rules steps**, all passed. Full unit suite green.
- **`e2e/recovery-scores-name-their-question.spec.ts`**, two cases, **both mutation-checked**: the
  battery line is visible on Home with a **data-carrying** battery (the state whose framing was
  missing — the spec stubs `/api/body-battery` with `hasData: true` precisely so it cannot pass off
  the old empty-state explainer), and the readiness subtitle is visible *including its distinguishing
  clause*. Deleting either line fails its own assertion.
- One thing the spec had to be taught: the chips and the battery card render on **`/`**, not
  `/session-select` — the Workout tab shares the component without them. A spec pointed at the wrong
  tab passes its stub and finds nothing.

**Not exercised:** the S25. This is copy inside an existing card and an existing detail screen, so it
is not in any of the device-gated categories (offline-first, native plugin, safe-area, gestures,
notifications) and does not earn a Known-Issues row — but the two lines have been read at the 412 px
viewport in Chromium only, not on the phone.

## What this does not do

- **It does not change either model.** Q-272 (Body Battery drains 5× faster than it charges) is
  untouched and still open; so is the drain model folded into Q-521.
- **The +0.12 is no longer a defect to fix.** Two numbers answering different questions are not
  required to agree — the original framing assumed they should. What is still worth watching is only
  that the day *starts* at readiness (+0.93) and diverges as energy is spent, which is the intended
  behaviour rather than a drift.

<a id="2026-08-31-renderer-recovery"></a>

# 2026-08-31 · Lane A — a dead WebView renderer is handled instead of fatal (BF-80)

Branch `lane-a/renderer-recovery`. **This one needs an APK** — it touches `android/**`, so unlike
the batch before it, merging is not the delivery.

## What the report was, and why nothing recorded it

The owner: *"when I tab out and tab back into the app the pages often crash and display a blank
page."* Screenshot: status bar, nav bar, nothing between them, **battery 10%**, another app
running. Production's `error_events` held three rows for the owner across three days and **none**
from a blank screen — and `app/error.tsx` exists, so a JS exception during render would have
painted a fallback and filed a row. The silence is the evidence: there is no JS left to throw, and
the reporter dies with the context it would have reported.

## The entry grepped `android/` for `RenderProcess` and found nothing. That was true and misleading.

Reading the pinned Capacitor 8.3.4 source settled it. `BridgeWebViewClient` **already overrides**
`onRenderProcessGone` and forwards it to every registered `WebViewListener` — so the app was never
missing a `WebViewClient`, which is why the grep came back empty while the behaviour persisted.
`WebViewListener`'s own default returns **`false`**, and false is the documented *"the app is
killed"* answer, not *"show nothing"*. The missing piece was a listener, and the behaviour it
replaces is worse than the symptom that was reported.

That is what makes this fix correct **whether or not the renderer-death hypothesis holds**: the
current answer to a dead renderer is process termination, and nothing wanted that.

## What shipped

- `RenderProcessRecovery.java` — returns `true`, stamps the death into SharedPreferences with
  `didCrash`, and **posts** `activity.recreate()`. Posted rather than called: the callback runs on
  the UI thread with the dying WebView on the stack, and `recreate()` tears that WebView down.
  `reload()` is not an option — a WebView whose renderer has gone is permanently unusable, so
  asking it to reload is asking a dead object to work.
- The **marker is the half that makes the hypothesis falsifiable.** The entry could only reason
  about the cause because nothing recorded it; SharedPreferences survives the recreate (the same
  store the ring key lives in), and `lib/renderer-recovery.ts` turns it into an `error_events` row
  on the next boot, via `window.AndroidRenderer`. `didCrash` separates a renderer crash from
  Android reclaiming it under memory pressure — different fixes, so it goes in the message rather
  than being flattened to "renderer died".
- `scripts/check-render-process-recovery.js` (Custom Rules, now **67**) fails on the listener
  going, on `return false`, on the `recreate` call going, or on the registration going. Any one of
  those silently restores the platform default. **Its first version passed a mutation that removed
  the recovery**, because the word `recreate` survived in the log line and a comment — it strips
  comments now, and looks for a call rather than the word.

## Not verified, and it cannot be here

**`Gate: device`.** Nothing about this runs in the sandbox: no Android SDK, and the JVM half is
compile-gated by CI only. The confirmation is on the S25 with a new APK — the app coming back
instead of showing nothing, and then the first `error_events` row reading `renderer reclaimed by
the system`. Until that row exists the diagnosis is still a hypothesis; what changed is that the
next occurrence leaves evidence instead of another blank screen.

<a id="2026-08-31-shared-label-rescan-duplicate"></a>

# 2026-08-31 — a re-scanned label is recognised instead of copied again

**Branch:** `fix/shared-label-rescan-duplicate` · **Entry:** LB-34 · **Lane:** B · **Version:** v1.413.1

## The bug

`saveSharedMealToLibrary` minted a new `saved_meals` row on every scan. A label is a physical
object that gets scanned by whoever picks it up — a partner checking the fridge on Tuesday and
again on Friday ended up with two identical meals, and nothing marked either as the copy. Filed
while building BF-57 rather than folded into it, because the fix is a product question and that PR
was already large.

## What shipped

**`sharedMealTotals()`** (`components/nutrition/save-shared-meal.ts`) — the payload's whole-recipe
macros, which is what `findDuplicateMeal` compares. Summed directly rather than through
`sumIngredients`: that helper takes the per-100 g `NutritionIngredient` shape, and a
`SharedMealIngredient` already carries its macros for its own weight, so routing them through it
would convert twice to arrive back where they started.

**The scan path now asks before it writes.** `findDuplicateMeal` is the same test a save already
uses — a normalised name match **and** macros within `DUPLICATE_MAX_FIT_DISTANCE`, both required —
so two genuinely different recipes that share a name still both save. That two-test shape is why
this was small: no new threshold was invented.

## Three decisions

**The library read is local-first and never touches the network.** A shared label's whole point is
that it works in a kitchen with no signal; a duplicate check that needed a fetch would trade the
feature's main property for a nicety. With no local store and no warm cache the scan just saves —
under-matching is the documented preference here, because a duplicate is a nuisance and a
wrongly-suppressed save is a lost recipe.

**An action, not an Undo — and this departs from what the entry proposed.** LB-34 guessed a toast
with Undo, by analogy with BF-74's photo remove. That analogy holds for an action that already
happened; here nothing has been written, so there is nothing to undo. The toast says the meal is
already saved and offers **Save a copy**, which is the thing a user might still want: two friends
can genuinely cook the same-named dish, and they are the one who knows.

**The duplicate branch returns before the save.** A check that found the duplicate and saved anyway
is the bug with extra steps, so that early return is what the guard below actually asserts.

## Verification

- `pnpm check:rules` **Ran 65 of 65 Custom Rules steps**, all passed. Full unit suite green.
- **Five unit tests** on `sharedMealTotals`, **all four guards mutation-checked**: the NaN guard,
  the calorie rounding, the 1 dp macro rounding, and that the totals are whole-recipe rather than
  per-serving (dividing by `servings` fails).
- **A source-level guard** in `shared-meal-scan-path.test.ts`, **mutation-checked four ways**:
  removing the check, removing the early return so it saves anyway, turning the local read into a
  `fetch`, and removing the escape hatch each fail it. Source-level because both vitest projects run
  `environment: 'node'` — nothing renders — and the branch is reached only from a camera.
- It strips comments before matching. The handler explains the check in prose naming both helpers,
  and a bare-word assertion would pass on the comment documenting its own fix — the shape that has
  slipped through three times in this repo.

**Not exercised:** the scan itself. It needs a camera — the Capacitor plugin on device,
`getUserMedia` on web — so no run of this has decoded a real label. The local-store branch is also
unexercised: `getLocalStore` returns null off-device, so every path here took the cache-seed read
rather than the SQLite one a real scan takes.

## Also in this diff

Two findings, filed rather than folded in.

**LB-37 — `tsc` typechecks nothing under `__tests__`.** Found by noticing that a spec I had just
written used two types it never imported and still passed. `tsconfig.json` excludes
`**/__tests__/**`; appending `const deliberateTypeError: number = "not a number"` to a spec produces
**zero** errors. Every session treats a clean `tsc` as its first gate and CI's Build job runs the
same project, so across ~700 unit-test files a spec can reference a type that does not exist or
assert against an interface that has changed shape, and nothing says so. `e2e/` is not excluded and
is typechecked normally. The entry says to measure what the exclusion is hiding before deleting it.

**LB-38 — the share-code e2e decode fails intermittently on `main`.** It went red on #700, which
does not touch the label renderer, and reproduces on a clean checkout. The entry carries what is
established (six null decodes; failing runs 2.8 min against 50 s passing; the passing canvas decodes
under all four decoder configurations tried), **one hypothesis already falsified** so nobody
re-derives it, and the current unverified one with the single measurement that would settle it.

<a id="2026-08-31-shared-meal-labels"></a>

# BF-57 — the meal goes in the code, and item 1 turned out to be impossible

**Branch:** `feat/shared-meal-labels-bf57` · **Lane B** · v1.408.0

## What was wrong

The owner asked to share meals with a partner (BF-77). The answer was supposed to already exist:
`encodeSharedMeal` / `decodeSharedMeal` / `decodeMealLabelScan` and the QR capacity table shipped on
2026-08-30. **Nothing emitted any of it.** `meal-label-render.ts` still called
`encodeMealLabelToken(meal.id)`, so every printed label carried 22 characters that resolve only
against the *scanning* user's own meals — and a label handed to anyone else fell to *"that saved
meal no longer exists"*, which is wrong twice over: the meal exists, and the real answer is "not
yours".

## Item 1 was reconciled, not implemented — and that is the durable output

The entry's binding item was *"give the QR ~30 mm of the 50 mm label"*, so version 11's 251 bytes —
the whole recipe, nothing rolled — would fit **every** style. It reasoned from a code of
12.2–16.4 mm. That range is pre-Q-411. Measured against the square canvas:

| | code box | budget at 0.49 mm/module |
|---|---|---|
| `inlineCentred` (default) | 18.5 mm | v3 — **42 bytes** |
| `band` · `editorial` · `ticket` | 16.4 · 16.9 · 17.7 mm | v2–v3 |
| `square` · `plaque` | 20.1 · 20.9 mm | v4 — 62 bytes |
| **`share` (new)** | **34.4 mm** | **v11 — 251 bytes** |

**None of the five print styles can grow.** Each is already the largest `codeUnits` that clears its
own content by the 6 units its own comment requires, and 30 mm is 128 of the 171 usable units — the
whole label. Four of the six cannot hold even 62 bytes, and below that `encodeSharedMeal`'s
documented last resort is to **trim the meal's name**. Forcing item 1 would have shipped labels with
eaten titles: a change that renders, scans, and is quietly wrong.

So **two payloads ship**, which is the reconciliation rather than a hedge:

- The five print styles keep the private bookmark. That is the right code for a jar in your own
  kitchen — *scan this to log it* — and its 22 characters are what let those layouts print the
  finest modules in the feature *and* carry the ingredient list.
- **`share`** drops the calorie block and the ingredient list — both of which the code itself
  carries — and spends the label on the code. It is the only style that reaches version 11.

`mealLabelShareBudget` reads the budget off each style's geometry rather than the other way round,
and `meal-label-code-size.test.ts` holds the measurement, so *"why not just share from every
style?"* is answered by CI instead of re-argued.

**`plaque` and `square` clear the 62-byte floor and still carry the token, deliberately.** They
would name about two ingredients and roll the rest — that looks like sharing, produces a visibly
poorer copy than the style built for it, and gives nobody a reason to pick the right one. One
clearly labelled answer beats three partial ones. The sheet says which you are looking at: *"This
code is a private bookmark — it logs the meal on your own phone and does nothing on anyone else's."*

## The scan path

A shared label **saves a copy into the scanner's library**; it does not log the meal. A shared
recipe is something you keep and cook again, and logging it would put a meal in today's diary that
nobody said they had eaten.

**Ingredients are normalised to per-100 g**, exactly as `ingredientToEntry` does for a planned meal,
and that is load-bearing twice: it is what makes `createFoodItem`'s duplicate check find the chicken
breast already in the scanner's library instead of minting a row per scan, and it is the basis every
other food item is stored on — a meal stored per-recipe-weight would read correctly and scale wrongly
the moment anyone edited it. The weight rides in the multiplier, so the totals survive.

`ingredient-picker.tsx` got the same `decodeMealLabelScan` swap in the sibling sweep — it is the
other camera that can reach a meal label, and without it the *newer* labels were the ones falling
through to a product lookup.

## Two decisions worth keeping

**The unresolvable-id message names both causes.** That branch is reached when the owner deleted
their own meal *and* when someone else's pre-BF-57 label is scanned. The old copy asserted the
first; the second is the case that matters now. It says the meal is not in your library, that it was
deleted or printed by someone else, and that a fresh label carries the whole meal.

**A rolled tail is stated on the paper.** `share`'s caption becomes *"Scan to add this meal ·
3 ingredients grouped"*, and the sheet says which ones. A copy whose totals are exact but whose
ingredient rows are fewer than the author's is true, and a surprise if you find out by counting.

## Verified

`tsc --noEmit` clean · `pnpm lint` **0 errors** · `pnpm check:rules` **Ran 65 of 65** (the count moved
with #687's new check, re-run after merging it) · full `npx vitest run` **687 files / 5,763 passed**,
3 files / 59 skipped.

**`e2e/meal-label.spec.ts` decodes the `share` label's real QR out of the rendered canvas and checks
the recipe back.** The fixture is eight ingredients against a 251-byte budget, so it takes the rolled
path — and the totals come back **exactly**: 480 g, 1,920 kcal, 400 P, 32 C, 16 F. That is the
guarantee a scanner cannot check for themselves, since a copy with plausible-looking wrong numbers is
indistinguishable from a correct one. 5 specs green.

Every guard is **mutation-tested**: hardcoding `servings: 1`, sending `mealTypeIds: []`, removing the
zero-weight guard, dropping the weight from the multiplier, shrinking `share` to 100 units, letting
`plaque` carry the recipe, removing the shared-meal scan branch, and restoring the old error message
each fail their own test — and making `share` emit the token again fails the **e2e** decode.

One guard needed sharpening: `decodeMealLabelToken` had to be matched as a **call**, not a word,
because the comment explaining the swap names it. Same shape as the Custom Rules line-grep that
flagged a comment in the previous batch.

## Not exercised

- **The device, and it is the whole of what BF-57 still owes.** The scan path runs through
  `getLocalStore`, which **returns null in the web sandbox**, so none of it executes off-device. What
  is proven is the payload, the arithmetic and the render; what is unproven is a second phone.
- **A printer, which is older than this entry.** No label of any style has been through one, so
  0.49 mm per module — the floor the whole budget is derived from — is a convention, not a
  measurement. If a real print says otherwise, `MIN_MM_PER_MODULE` is the one number to move and the
  budgets follow.
- **`share` against a long meal name.** `fitText` shrinks it and the caption, but only browser
  metrics decide where that stops being readable.
- **Duplicate scans.** Scanning one label twice makes two meals; filed as **LB-34** rather than
  folded in, because what the offer should *say* in a one-tap kitchen flow is a product question.

<a id="2026-08-31-sheet-title-duplication"></a>

# 2026-08-31 — a sheet should say its name once (LB-23)

**Branch:** `claude/implementation-agent-lane-b-43nmep` · **Lane B** · v1.405.1

## What it was

Radix needs a `SheetTitle` for the dialog's accessible name. Next to an already-styled header, the
obvious way to satisfy that is to add an `sr-only` one beside the visible `<h2>` — and three sheets
did: `end-of-day-review`, `morning-checkin-sheet` and `food-logger-sheet`. A screen reader then
reads the name once as the dialog's and again as a heading, and `getByRole('heading', { name })`
matches two nodes, which is why `e2e/day-review-one-door.spec.ts` had to match on the dialog and
leave a comment pointing at this entry.

`<SheetTitle asChild><h2 …>` is the whole fix: one node, which *is* both. `SheetTitle` is typed as
`React.ComponentProps<typeof SheetPrimitive.Title>`, so `asChild` needed no change to
`components/ui/sheet.tsx`. Its own `text-foreground font-semibold` merges with the heading's
`text-base font-semibold` through Radix's Slot — different properties plus one idempotent
duplicate, so nothing is lost.

## `quick-edit-log-sheet` is not a violator, and that distinction is the rule

It has an `sr-only` `SheetTitle` reading "Edit Serving" and a visible header showing the *food's
name* — two different strings, so nothing is said twice. An `sr-only` title on its own stays
perfectly legal. That is why the guard matches on the **text** rather than on the `sr-only` class:
a check that banned the class outright would have failed a correct file.

## Verified, both directions

- `e2e/day-review-one-door.spec.ts` now asserts `getByRole('heading', { name: 'End of Day' })` has
  count **1** and that the dialog's accessible name still carries it — the locator the entry said
  the spec could go back to using. Reverting the fix on that one sheet makes it read **2**, so the
  assertion is load-bearing rather than decorative.
- `components/ui/__tests__/sheet-title-duplication.test.ts` scans `app/` and `components/` for an
  `sr-only` `SheetTitle` whose text also appears inside a heading in the same file. Restoring the
  `morning-checkin` pattern fails it by name; the real tree passes; `quick-edit-log-sheet` is
  untouched by it. It catches an interpolated title (`{STEP_LABELS[step]}`) as well as a literal,
  which is how `food-logger-sheet` said it twice.
- `tsc --noEmit` clean · `pnpm check:rules` **Ran 63 of 63**.

## Not exercised

- **A real screen reader.** The defect is an announcement, and what is proven here is the DOM that
  produces it: one node where there were two, with the dialog's accessible name intact. A TalkBack
  pass is owed and is already on the device queue as a carried item.
- The other two sheets have no e2e assertion of their own — reaching Morning Check-in and Log Food
  costs two more navigations for a property the source guard already holds across all three. The
  guard is the coverage; the e2e assertion exists because one rendered proof beats three static ones.

<a id="2026-08-31-stable-box-coordinate-reads"></a>

# 2026-08-31 — a coordinate is not a promise the element is still there (LB-30)

**Branch:** `claude/implementation-agent-lane-b-43nmep` · **Lane B**

## Where this came from

BF-39's implementation was held for a week as a render-vs-remount question it never was. The real
cause: `toBeVisible()` is satisfied the moment a `SheetContent` mounts, ~500 ms before it lands, so
a `boundingBox()` taken straight after is a position the element is travelling through. Measured on
the meal library — the row read y=605 and sat at y=503 by the time the CDP touch arrived, so every
point of the gesture hit the scroll container beneath it and the drag handler was never invoked.
`swipeRowLeft` got a private `stableBox` then; LB-30 is the audit of everything else.

## The audit, which changes the entry's own numbers

LB-30 said "46 coordinate reads". Classified, they are not one population:

| | count | why |
|---|---|---|
| Coordinate taps inside an `expect(async () => …).toPass()` retry | **21** | Self-healing — a retry re-measures, which is what `openSavedMeal` already relies on. Safe. |
| Coordinate taps with a single measure | **11** | Exposed: nothing re-measures and nothing checks stability. |
| Reads feeding a geometry **assertion** | **6** | Not in the entry's scope at all, and worse than a missed tap — a moving box gives a *wrong verdict*. |

The remaining reads feed neither a tap nor an assertion.

**The 6 assertion reads are the find worth having.** `quantity-editor-option-a.spec.ts:159–160`
compares the toggle's box against the stepper's, and that comparison *is* BF-46 ③'s proof that the
control sits "beside the stepper" — the owner's whole request, and the one thing a text-only check
cannot see. Asserting it against a box read mid-animation is how that proof quietly stops meaning
anything.

## What ships

- **`stableBox` is exported** from `e2e/fixtures.ts` and **`tapCentre(page, locator)`** added beside
  it — measure once still, then dispatch. Both carry the measurement that motivates them.
- The **11 exposed taps** go through `tapCentre`; the **6 assertion reads** call `stableBox`
  directly. `food-log-swipe-delete`'s post-swipe `after` read is included: it is measured
  immediately after the row's slide, which is exactly the shape. Its pre-swipe `box` is deliberately
  left alone — that one wants the *original* right edge, and the comment says so.
- **`diary-nested-meal`'s `waitForTimeout(300)` is deleted.** It stood in this exact spot, guessing
  at the condition `stableBox` now waits for. Six `waitForTimeout` calls remain in the suite; this
  was the one a real condition could replace.

## Be accurate about what was proven

**One of these was measured failing; the rest are cheap prophylaxis, and the entry now says so.**
The proven hazard is a sheet animating over `duration-500`. The app sets no `scroll-behavior:
smooth`, so the `scrollIntoView` that precedes several of these settles immediately — those reads
were probably fine. `stableBox` returns as soon as two reads a frame apart agree, so on a settled
page it costs one frame; that is what makes converting all of them the cheap option rather than an
argument about which are genuinely at risk. It is **not** a sleep, which is the distinction that
lets it replace one.

## Verification

All 12 touched specs run locally against the dev server: `diary-nested-meal`,
`food-log-swipe-delete`, `quantity-editor-option-a`, `food-row-shared`, `zero-calorie-food`,
`food-logging-complete`, `single-foods-database-search`, `builder-barcode-scan`,
`day-review-one-door`, `meal-photo-picker`, `plan-meal-to-saved-meal`, `recipe-url-to-meal` — 39
tests, all passing. `tsc --noEmit` clean.

## Not exercised

- **This cannot be proven green.** It removes a race; a suite that passed before and passes after is
  consistent with the change doing nothing on this run. The evidence it rests on is the BF-39
  measurement, not this run's result. What a green run *does* establish is that no conversion broke
  a working spec, which is the failure mode a mechanical sweep actually risks.
- The 21 taps inside retries are untouched, deliberately — a retry already re-measures, and
  converting them would trade a proven mechanism for a new one.

<a id="2026-08-31-stress-one-producer"></a>

# 2026-08-31 — BF-81: two computations behind one metric, and a recommendation that would have frozen three columns

**Branch:** `lane-a/next` · **Lane A** · JS/server only, no APK.

`oura_daily_derived`'s three daytime-stress scalars and the `oura_daytime_stress_buckets` strip
described the same day and were produced by different code. The rollup built its series from
`latest.rhrLowBpm` + `nightHrvMs`; `/api/body-battery` built its own from `restingHr` + a 28-day HRV
mean, and persisted the scalars from it on every read.

**Re-measured in production before touching anything — and it is worse than filed.** The entry said
five of eight days flipped sign; it is **six**:

| Day | buckets | stored | high-stress min, buckets / stored |
|---|---|---|---|
| 08-31 | −0.19 | **+0.00** | 240 / **0** |
| 08-29 | −0.01 | **+0.08** | 210 / **0** |
| 08-28 | +0.04 | **−0.10** | 120 / 60 |
| 08-27 | +0.05 | **−0.03** | 270 / **0** |
| 08-26 | −0.01 | **+0.07** | 210 / **0** |
| 08-24 | −0.12 | **+0.22** | 240 / **0** |

High-stress minutes differ by 4–8×: the strip says 2–4.5 hours on days the stored number says none.

## The entry's recommendation would have made it worse

It said: *delete the write at `body-battery/route.ts:349`, not the route's computation.* Following
that literally leaves the three columns with **no writer at all** — the rollup only ever persisted
the *buckets*, never the scalars — and `weekly-digest/route.ts:185` reads `stressHighMinutes`. The
strip and the number would have stopped disagreeing by the number ceasing to exist.

So the fix is a deletion **and** an addition: the rollup summarises the same `pts` it turns into
buckets, in the same `try` block, and the route keeps computing a summary for its own response
without storing one. Divergence is now impossible by construction rather than by convention.

**No freshness regression, checked rather than assumed.** The route was write-through on every read,
so removing it could have left today stale. The rollup runs on every BLE sample ingest
(`/api/oura-ble/samples` → `runRollupOffLoop`), and the scalars are written immediately after
`replaceStressBuckets` in the same block — so they update exactly as often as the buckets, which
production shows current to today.

## What was deliberately not done

**The history recompute, because the entry's version would have deepened the artefact it warns
about.** 38 rows carry `daytime_stress_scaled`; only **8** have buckets to re-derive from.
Recomputing those 8 leaves 30 on the old producer — a column that is *more* mixed, not less. Doing
it properly needs a wide rollup pass re-deriving buckets from the packed raw tier for all 38 days,
which is owner/device-gated. Overwriting stored history is irreversible, so it is the owner's call.
This is the Q-304b shape: the authorisation was real and the specified method was wrong.

**`chronic_stress_score` is NULL on all 106 rows, and that is the gate, not a bug.** The entry asked
to check which before treating it as a data problem. `run.ts` answers it: *"the intermediate history
is built from THIS pass's stashed signals, so the first score requires a wide/full rollup pass
covering ≥21 nights of real ring data (owner/device-gated)"*. No code fix applies.

`resilience_daily_stress` sits on 15 of 106 rows — sparse rather than absent, not investigated.

## Verified

- 5 unit tests on the reduction the scalars must be; **2 mutations killed** on the new check —
  the route persisting again, and the rollup losing its write.
- `scripts/check-stress-scalars-one-writer.js` (Custom Rules, now **66**) guards both directions.
  Its first run flagged `adapter.ts`, which is the upsert's plumbing rather than a producer — the
  three repository files every writer passes through are exempt by name, with that reason.
- Full suite **696 files / 5,852 tests** · `pnpm check:rules` **Ran 66 of 66** · `tsc` clean.

## Not exercised

The rollup runs off BLE ingest, which needs the ring — so the new write was not observed executing.
What is verified is the reduction it performs (unit-tested), that it is the only persister (checked),
and that it sits in the same block as a bucket write production shows current to today. **The
corrected values will appear as the ring syncs**; days already stored keep the old producer's numbers
until the recompute question above is answered.

<a id="2026-08-31-voice-filler-words"></a>

# 2026-08-31 — the voice parser stopped disagreeing with what it heard (BF-66)

**Branch:** `claude/implementation-agent-lane-b-43nmep` · **Lane B** · v1.404.2

## The report

Mid-set on Sumo Deadlift, the owner said *"60 for 6"*, the transcript came back exactly right, and
the app printed it in red: *"is that not how to use it?"* That red line is not a mis-hear message —
it is `voice-log-button.tsx`'s **parse-failure** branch, so the app was showing a perfect transcript
back as if the transcript were the problem.

## One character class

`parseVoice` stripped with `[^0-9.\s kgreps×x]` — a denylist that keeps every letter appearing in
`kg`, `reps` and `x`. The `f` and `o` of `for` were dropped; the **`r` survived**, because `reps`
contains it. The final fallback wants two numbers separated by whitespace *and nothing else*, so a
filler word whose letters all fell outside `kgrepsx` vanished and the fallback fired, while one that
left a letter behind blocked it:

| Said | After the strip | Parsed |
|---|---|---|
| `60 for 6` | `60 r 6` | nothing |
| `60 times 6` | `60 es 6` | nothing |
| `60 by 6` | `60 6` | 60 × 6 |
| `60 at 6` | `60 6` | 60 × 6 |

**`by` and `at` worked and `for` and `times` did not**, and no user could derive that rule. Nothing
in the app stated it either — no hint on the button, no first-run text — so the accepted phrasing
was learnable only by failing at it.

## What ships

- **A positive tokenizer replaces the denylist.** `parseVoice` now pulls out only what means
  something — numbers, `kg`/`kilos`/`kilograms`, `reps`/`repetitions`, `sets` — and ignores every
  word between them. Adding `for` to a list of stripped fillers would have fixed this one report and
  left `times`, `pounds` and `press` behind the same wall; this makes each phrasing work by
  construction instead. `x` and `×` need no token at all: unmatched text is skipped, so `80 x 5` and
  `80x5` both reduce to two bare numbers, which is what the shorthand means.
- **Keywords claim their number, loose numbers fill what is left, weight first.** That is what makes
  `5 reps 80` mean 80 kg and `6 reps at 60 kg` work in either order. A number followed by `sets` is
  discarded, so `3 sets of 60 for 6` no longer hands the weight slot to the 3.
- **A lone bare number still parses to nothing.** `60` is as plausibly reps as kilos, and the caller
  asking again beats logging a wrong set silently.
- **The failure message names the failure and an example** — `Didn't understand "…" — try "60 kg 6
  reps"` — and the same example sits under the button whenever it is idle. One exported constant
  (`VOICE_LOG_EXAMPLE`), so the hint and the error cannot drift from each other.

The web branch is untouched, per the Canonical Runtime rule: it feeds the same `parseVoice` and
grows no behaviour the device path lacks.

## Why the existing tests did not catch it

All seven passed, and none of them could have failed. Every case was either adjacent numbers
(`80 x 5`, `5 reps 80`) or an explicit keyword (`80 kilos 5 reps`) — the filler-word gap was
untested by construction. The measured table is now eight `it.each` rows, plus the set-count case,
the either-order case and the lone-number case. 17 tests, from 7.

## Verification

- `voice-log-parse.test.ts` 17/17; the six `components/workout` files 59/59; `tsc --noEmit` clean;
  ESLint clean on the three changed files; `pnpm check:rules` **Ran 63 of 63**.
- Driven in a browser at 412 dp on the local dev server: a real workout to the Set 1 card, where the
  Voice button renders with `Say "60 kg 6 reps"` centred beneath it, above the RPE strip and without
  shifting the button.

## Not exercised

- **The device.** The APK's native `SpeechRecognizer` path never ran — Chromium's
  `webkitSpeechRecognition` is what makes the button render in the sandbox at all, and no transcript
  was ever produced by either. **The parser was proven on strings, not on speech.** What is owed on
  the S25: say each row of the table above into the Voice button and watch the dial move, then say
  something genuinely unparseable and read the new message.
- Samsung WebView rendering of the hint line, and the tap target of the button itself (unchanged).

<a id="2026-08-31-walk-cadence-pacer"></a>

# 2026-08-31 — the guided walk paces you by cadence, and says which signal it is using

**Branch:** `feat/walk-cadence-pacer` · **Entry:** Q-410 · **Lane:** B · **Version:** v1.411.0

## What was asked

Two owner messages, months apart, that turned out to be one feature:

> *"for the walking section I'd it to show the speed and total step count. rather than a HR goal we
> should be looking at a step goal; we should enough data on how to do this."*

> *"Yes a cadence target — like a SPM to indicate a 'walk faster' option"* … *"Should also be able to
> say to slowdown during the slow part. so pacer for speed/steps both ways"*

Plus a review of the drawn version: *"color code the bar based on whether its in the right direction
of the pacer; i.e slower than expected = green … green for in range: orange for slightly out; and
red for way off"*, and *"when no source detected for cadence it still shouldn't be BPM; probably
speed would be good there."*

## What shipped

**`lib/walk/walk-pacer.ts`** — a new pure module, the one place the interval walk decides what to
pace you by and how you are doing against it.

- **`readPacer()` walks a precedence ladder: cadence → speed → heart rate**, and returns the band, a
  mark, a sentence, a bar fill and a `fallbackNote` naming the rung whenever it is not the top one.
  Cadence leads because it responds the instant the legs do; heart rate takes 30–60 s to catch up, so
  a prompt driven by it arrives after the moment it is about. That is the owner's instinct and it is
  correct for a reason worth writing down.
- **`bandFor()` bands by *signed* distance, not absolute error.** On a fast block, `spm ≥ floor` is
  green however far above — faster is the point of a fast block. `BAND_TOLERANCE` (10%) is the amber
  ring around it; beyond that is red. It **calls `classifyZone`** for the green/not-green threshold
  rather than restating it, so there is still one definition of "meeting the target" and this only
  adds the ring.
- **`speedTargetsFromHistory()` derives the speed rung's pair from the walker's own past fast/slow
  segments.** `walk-config.tsx` already fetches `/api/guided-walk/segment-stats`, which aggregates
  `avgPaceSecPerKm` per kind across ~3 years — so the target is "your usual fast block", and the walk
  screen reads the same cache key rather than asking for a third target block to configure. It
  returns null rather than half a pair on a history that is too thin (fewer than 3 segments of a
  kind), has no GPS-derived pace at all (the treadmill-only case), or does not separate.
- **`STOPPED_SPM` / `STOPPED_KMH`.** Without them, standing still is a *perfect* slow block: "under
  the ceiling" is green, and 0 spm is very much under the ceiling. Below the floor the pacer reads
  **Stopped** in neutral — it does not scold a pause at a crossing and it does not congratulate one.

**`components/guided-walk/walk-pacer-bar.tsx`** — the bar, the mark, the sentence and the fallback
note. A leaf that owns its own cadence subscription, for the same reason `CadenceReadout` does: the
strap reports about once a second and this screen renders a route map.

**`components/guided-walk/walk-active.tsx`** — leads with **km/h** and keeps min/km beside it, both
off the one pace series. The old heart-rate-only verdict line is gone, replaced by the pacer.

**`components/guided-walk/walk-config.tsx`** — a *Step-rate targets* card holding the cadence **pair**
(`Fast spm ≥` / `Slow spm ≤`, stepping by 5). A pair rather than one number, because a single cadence
figure cannot express the slow half. The shared `NumberField` gained an optional `step` prop; every
existing caller still steps by 1.

## Decisions made here, so they are not re-litigated

- **km/h leads on the live screen; min/km stays in the summary.** The owner asked for speed by name,
  and it is the natural reading for a walk, but the summary's splits and best efforts are in min/km
  and should stay there. Both come off `currentPaceSecPerKm` — there is no second computation, and
  the e2e spec checks the two agree rather than asserting it in a comment.
- **The stopped threshold was decided, not escalated.** The entry flagged it as "worth deciding
  rather than discovering" and left it open. It is a cheap, reversible tuning constant with an
  obvious right answer, so it is a named constant at 40 spm and this line is the record.
- **The cadence pair is deliberately absent from `DEFAULT_WALK_CONFIG`.** Every device already carries
  a persisted config that predates these fields, so `resolveCadenceTargets` has to supply the default
  anyway; a second copy in the defaults object would be the one that drifts.
- **The ring still cannot pace this.** `RING_CADENCE_VALIDATED = false` holds. The ring's cadence is
  octave-ambiguous, not broken, and shipping it uncorrected gives a number wrong by 2× — worse than
  showing none. Correcting it is Lane A's, in `packages/shared/src/health/cadence.ts`.

## What was NOT done, and where it went

- **Per-segment adherence, steps, and which signal paced the segment** — the numbers this pacer
  *creates*, and the most interesting thing to analyse later. They are additions to
  `activity_logs.segments`, which is a schema edit and therefore Lane A, with the local SQLite
  mirror, the outbox payload, `getSyncDelta` and `applyDelta` moving in the same PR. Filed as
  **LA-48**.
- **The ring octave correction** — Lane A, unchanged, and the harder half by a distance.

## Verification — and the parts of it that did not run

- **Full unit suite green:** 693 files, 5823 tests. `pnpm check:rules` **Ran 65 of 65 Custom Rules
  steps**, all passed — including deleting `components/guided-walk/walk-active.tsx` from the
  hex-literal baseline, since replacing the verdict line removed its last literal.
- **29 unit tests** over the pacer. **Every guard mutation-checked** — 12 mutations, all killed:
  the stopped floors (all three, including that heart rate deliberately has none), both halves of the
  amber ring, the minimum-segment floor, the degenerate-pair guard, the ladder's precedence, the
  zero-target rejections and the progress clamp.
- **`e2e/walk-pacer-speed-rung.spec.ts`** drives a real geolocation series against `pnpm dev` and
  asserts (1) km/h leads and equals the min/km beside it, (2) with no cadence source the pacer falls
  to speed and says so, (3) a history too thin to derive a target from drops the rung instead of
  inventing one. **All three mutation-checked**, each against the code it is about.
- **Exercised in `pnpm dev`:** the config steppers (default 120/95, step 5, persisted across a
  reload, `Sets` still stepping by 1) and the active screen end to end with a driven GPS series.

**What was NOT exercised, and it is most of the feature.** The **cadence rung** and the **heart-rate
rung** have never executed: both need a Polar H10 over BLE, and there is no BLE in the sandbox or in
`pnpm dev`. So the bands moving with the legs, the Stopped state on a real crossing, the strap-drop
fallback, and the band colours at 4.5:1 at arm's length are all verified by reading. **LB-36** holds
that pass. `BAND_TOLERANCE = 0.10` is a proposal, not a measurement.

**Also not exercised:** native SQLite / Capacitor (`getLocalStore` is null on web), safe-area insets,
and Samsung's WebView compositor. The walk config and active screens both grew content; neither
bottom-anchored control changed, but neither was seen on the device.

<a id="2026-09-01-blood-panel-storage"></a>

# 2026-09-01 · Lane A — blood panels, stored (BF-1, engine half)

Branch `lane-a/blood-panel-storage`. Migrations **250** (tables) and **251** (`claude_ro` views).
No native change. **Not device-verified.**

## The schema comes from a real report, and that is the whole method

BF-41's rule is that a schema be written from an actual document rather than a description, and
`docs/clinical-baseline-2026-08-27.md` — the owner's de-identified 2026-04 panel, 58 analytes — is that
document. Four shapes in it break a simpler design, and each one is a column here:

| shape in the report | what a simpler schema does | what this does |
|---|---|---|
| `<0.2` growth hormone | `'<0.2'` as text is uncomparable; `0.2` alone is **wrong** | `value_num` + `value_operator` |
| ranges `2.5–8.0`, `<25`, `>59`, absent | one column and a convention | `ref_low` / `ref_high`, both nullable |
| the date is a **month** | every panel lands on the 1st and lies | `collected_on` + `date_precision` |
| *"Normal (athletic)"* on a creatinine in range | a boolean read off the flag | flag stored verbatim, **verdict derived** |

## The verdict is computed, and `unknown` is a real answer

`rangeVerdict` in `packages/shared/src/health/analyte-keys.ts` decides from the bounds.
CLAUDE.md forbids showing a self-reported judgement as fact, and this report is exactly why: a
creatinine of 109 against 60–130 is flagged *"Normal (athletic)"* and a urea of 9.2 against 2.5–8.0
is *"High (likely protein intake)"*. Those are a clinician's reading. The words are displayed; the
bounds decide the colour.

**And a bounded result against a bound on the same side does not decide.** `>59` with a ceiling of
100 could be 60 or 600, so the answer is `unknown` rather than `in` — returning `in` there would be
the same failure the entry is about, one layer down. Asserted both ways: `<0.2` against a floor of 1
**is** resolved (`low`), because it is below the floor whatever the true value is.

## Six keys were missing and the slug hid it

`ANALYTE_KEYS` named 52 of the report's 58 analytes. The other six — MCHC, RDW, platelets, MPV, WBC,
neutrophils — fell through to `slugAnalyte`, which for those six happens to produce exactly the key
the table would have. Accidental correctness, and indistinguishable from the real thing until one of
them slugged badly. The fix is the six entries; the guard is that the coverage assertion now reads
the labels **out of the report** rather than from a list retyped in the test, because a hand-copied
list moves whenever the table moves and can only ever agree with itself. Verified by deleting a key:
the test names the analyte it can no longer find.

**Found by cross-checking a number, not by reading the code.** Three docs said the panel had 63 rows
and the plan said 41; it has 58. Counting it to correct the prose is what surfaced the gap.

Fifteen rows of the real panel are asserted individually — urea, ALT, cholesterol, LDL, non-HDL and
the total/HDL ratio out; creatinine, eGFR, HDL, triglycerides, glucose and growth hormone in; MCH
low. The plan named creatinine as the one to get right and it is.

## A leaf module, for the reason the last two were

`analyte-keys.ts` imports nothing. `energy-baseline.ts` exists because a client component importing
a constant dragged a node builtin into the bundle and took the Nutrition tab to a 500 — twice, with
two different builtins. A card asking *"is this value out of range"* is exactly that shape of
caller, so the module it asks has no dependencies at all.

## Two guards that fired, and both were right

**The `claude_ro` generator refused to emit a view.** `blood_analytes` has no `user_id`, and the
generator will not guess a scoping path — it fails rather than emitting an unscoped view. The fix is
one line in its `VIA` table, through `blood_panels`, which is the only FK the table has. That is the
fail-closed design doing its job on the first new table since it was written.

**`check-dead-repo-methods` rejected `latestAnalytes`.** It was declared for a consumer this PR does
not contain, and the check exists because that has shipped three times. Removed — it arrives with
the reader that needs it rather than sitting uncalled. Everything left is reached: `saveBloodPanel`
by POST, `listBloodPanels` by GET, `deleteBloodPanel` by DELETE.

## De-identification is a property of the schema

No column here can hold a name, a date of birth or a provider's patient reference, and the route's
body schema is `.strict()` — a body carrying `patientName` is a **400**, verified live, rather than
a field nobody noticed. A test asserts the only identifier-shaped column in either table is
`lab_name`, which is instrument metadata.

This does not replace the crop-before-upload step: extraction sends the document to Google, so
redacting after extraction is too late. That step is Lane B's and is still owed.

## Re-saving replaces

The manual path is the confirm target of a correct-then-save flow: extraction prefills, the owner
fixes a misread decimal, and saves again. Appending would leave the wrong row beside the right one
under the same key, and the unique constraint would then reject the **corrected** one. Asserted.

`saveBloodPanel` branches on an existing row rather than using `onConflictDoUpdate`, because the
unique index is on `COALESCE(lab_name, '')` — a functional index Drizzle cannot name as a conflict
target, and reaching for raw SQL would put the ownership scope in a string.

## What is not built

The extraction route (`POST /api/blood-panel/scan`) and the recommendation consumers are Lane A's
and still owed; the crop step, upload UI and review form are Lane B's. Building the manual write
path first is what makes the extraction call optional rather than load-bearing — the plan says so,
and it is now true.

Verified: full suite **720 files / 6,155 tests**, `pnpm check:rules` **Ran 67 of 67**, and the route
exercised on `pnpm dev` — slash dates normalised, `<0.2` round-tripped with its operator, an unknown
label slugged to `vitamin_d_25_oh` rather than being dropped, `patientName` rejected 400, impossible
date 400, unauthenticated 401, DELETE 200.

**Not exercised:** no UI exists yet, so nothing has been seen on a device; and no image path is built,
so the crop-before-upload rule is stated rather than tested.
