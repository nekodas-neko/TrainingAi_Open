# BF-11 Part 2 — the library-first Meal Planner

**Status:** plan · **Date:** 2026-08-24 · **Author:** planning session (owner-directed, from BugFix)
**Backlog entries:** BF-11e · BF-11f · BF-11g · BF-11h
**Design:** [`2026-08-24-meal-creator-and-planner-design.md`](../specs/2026-08-24-meal-creator-and-planner-design.md) items 6–12
**Depends on Part 1:** [`2026-08-24-meal-creator.md`](2026-08-24-meal-creator.md). The owner's
sequencing is binding — the creator ships first, on its own merits.

This plan resolves the three questions the design left to planning (§3), and records two live
defects the trace found in the path it is about to change (§2).

---

## 1. Re-verification against `main` @ `3034169` (2026-08-24)

| Design claim | Verified |
|---|---|
| `keepSavedMealIds` capped at 6 | ✅ `generate/route.ts:47` |
| Macros split into slots **before** meal selection | ✅ `splitMacrosAcrossMeals`, line 250 |
| Non-kept slots are always fresh AI generation | ✅ nothing reads the library for a slot |
| `scaleWithTopUp` exists and does the resize+top-up | ✅ `lib/nutrition/meal-top-up.ts:88` |
| Reroll always calls the AI | ✅ `askForMeal`, `meal-plan-review-step.tsx:39` |

**Two findings that change the shape of the work, both good news:**

### 1.1 The ranking function already exists — do not write a second one

`fitDistance(actual, target)` in `packages/shared/src/nutrition/meal-macro-fit.ts` reduces a macro
comparison to one comparable number: relative rather than absolute (10 g short on a 20 g fat target
is a worse miss than 10 g short on a 200 g carb target), the three macros weighted equally, and
calories deliberately excluded because they are a function of the macros and counting them again
would double-weight whichever macro is furthest off.

That is exactly "which saved meal best fits this slot." **Item 6 does not need a new scoring
function — it needs to call `fitDistance` over library candidates.** That file is already the
One-Formula-One-Place for this question and says so in its own header; a second threshold copied
into the generator is precisely what it exists to prevent.

`mealFit(...).allOnTarget` and `MEAL_FIT_TOLERANCE_FRACTION` (0.1, with absolute floors of 50 kcal /
5 g) give the "is this close enough to use at all" gate for free, in the same file.

### 1.2 `MEAL_COUNT_MAX = 6` — the existing cap is not arbitrary

`packages/shared/src/nutrition/meal-split.ts:45`. The `keepSavedMealIds.max(6)` cap **equals the
maximum number of slots in a day.** You cannot force-include seven meals into a six-slot day. The
cap is correct for what it does and must stay. This settles open call §3.3.

---

## 2. Two live defects in the path this plan rewrites

Found while tracing, not reported. **Both are in the current `mealCount` vs `kept.length`
arithmetic**, both fire in the same situation, and the second is silent data loss of a user choice.

**How to reach it:** the wizard's step order is
`['Stores','Avoid','Skip','Meals','Yours','Training','Review']` — step 3 (*Meals*) picks the count,
step 4 (*Yours*) picks the meals. Going forward, `MyMealsPicker` enforces
`maxKeepable = mealCount - 1` (`my-meals-picker.tsx:82`) so you cannot over-pick. **Nothing
re-enforces it when you go back and lower the count.** Pick 4 meals at `mealCount: 5`, go back, set
`mealCount: 3`, continue.

**Defect 1 — a negative number reaches the prompt.** Line 197:

```
`Meals: exactly ${mealCount - kept.length}.`     →   "Meals: exactly -1."
```

**Defect 2 — a kept meal is silently discarded.** Lines 235–243 build `names` as
`[...kept, ...generated]` where `generatedNeeded = Math.max(0, mealCount - kept.length)` = 0, so
`names.length` is 4. Then `slots` has `mealCount` = 3 entries and line 261 maps
`slots.map((slot, i) => … names[i] …)`. **`names[3]` is never read.** The fourth meal the user
explicitly chose to keep is dropped, with no error and nothing in the response saying so.

This is the mechanism behind the owner's *"it's gotta prompt you somewhere"* — it is not only a
missing prompt, it is a live silent drop. **BF-11h owns the fix** (§6.4), and it should be verified
as a regression test rather than by inspection, because the failure is invisible from the UI.

---

## 3. The three open calls, resolved

The design left three to the planning session. All three are decidable inside the agreed direction.
**None needs the owner** — the reasoning is recorded so it is not re-litigated.

### 3.1 Item 9 — no-library-match fallback: **fall through to AI, and say so**

**Decision: AI fallback, labelled.** Not prompt-to-create.

- **Prompt-to-create is structurally bad here, not merely less nice.** The wizard is one linear flow
  inside a bottom sheet that ends in a plan. Sending the user to Build a Meal mid-flow means either
  losing the draft or stacking a sheet on a sheet, and returning to a half-built wizard is a state
  nothing in this codebase currently keeps.
- **AI fallback is today's behaviour**, so a library with no matches degrades to exactly the plan the
  user gets now, rather than to a dead end. That is the correct failure direction.
- **The owner already described it:** *"it prefers meals already in the planner and adds other meals
  around it."* "Adds other meals around it" is the fallback.
- **The useful half of prompt-to-create survives at zero cost.** Item 10 puts a reason on each
  library-matched slot; its natural inverse — *"no saved meal fitted this slot, so this one is
  generated"* — tells the user exactly where their library has a gap without blocking them. Build
  that line; it is the feature the rejected option was really after.

**Reversal cost: one branch in one function.** If the owner later wants a nudge, it is a line of copy
on a slot that already knows it fell through.

### 3.2 Item 12 — meal-count change: **re-run the split; ask only when a pin would be dropped**

**Half of this question dissolves once the arithmetic is read.**

`splitMacrosAcrossMeals` derives every slot from the **day's** totals, not from the sum of the slots.
Dropping a slot does not orphan its calories — the day total is unchanged and the split
redistributes across fewer, larger slots on its own. **So there is nothing to "transfer."** What the
user actually stands to lose is a *meal choice*, not calories, and that is what the prompt must be
about.

This is also precisely why `MealTypeReassignDialog` is the wrong mechanism to copy: that dialog
exists because `food_logs.meal_type_id` is `ON DELETE RESTRICT` and real logged rows would be
orphaned. Here nothing is orphaned and nothing is persisted yet.

**The rule:**

- Reducing `N → M` with `K` pinned meals, **`K ≤ M − 1`** (the picker's own `maxKeepable`): keep every
  pin, re-run the split, **no prompt**. Nothing was lost.
- **`K > M − 1`**: the only case that needs an interaction. Name the pins that no longer fit and ask
  the user to choose which to keep — a checkbox list capped at `M − 1`, pre-ticked with the first
  `M − 1` in their current order so the safe path is one tap. Do **not** silently truncate, which is
  defect 2 above.
- The forward direction needs nothing new: the count is chosen before the meals are picked, and the
  picker's existing cap already holds there.

**The server must not depend on the client getting this right.** BF-11g adds the guard in the route
too (§5.5) — a client that skips the prompt must get a coherent plan, not a silent drop.

### 3.3 Item 7 — "select all": **a boolean, not a list, and no cap needed**

**Decision: `useLibrary: boolean` on the request. Keep `keepSavedMealIds.max(6)` exactly as it is.**

- The two are **different mechanisms**, which the design already spotted: pins are meals that
  *occupy* slots; candidates are meals that *compete* for them. The `max(6)` cap is right for pins
  because it equals `MEAL_COUNT_MAX` (§1.2) — seven pins cannot fit a six-slot day at any setting.
- **Candidates need not cross the wire at all.** The route already calls
  `repo.listSavedMeals(userId)` (line 124), server-side and user-scoped. So "use all my saved meals"
  is a flag, not a payload: **zero bytes, no cap to choose, and no way to name another user's meal**
  because the lookup never takes ids from the client.
- The existing checkbox picker stays as the explicit-pin path, unchanged.
- **A partial candidate pool is not built.** Nothing in the owner's ask needs "some of my library as
  candidates," and a `candidateSavedMealIds` array would be a second, cappable, spoofable mechanism
  for a requirement nobody has. Add it if it is ever actually wanted.

One real consequence to handle rather than discover: `listSavedMeals` is currently fetched **only
when pins exist** (`input.keepSavedMealIds?.length ? … : Promise.resolve([])`). With `useLibrary` it
must be fetched when either is set — and the query is unbounded, so a very large library is a
latency question for §5.4, not a semantics question.

---

## 4. Build order

```
BF-11e  Lane A   SavedMeal ↔ MealType tag join        (migration + sync + local SQLite)
BF-11f  Lane B   tag editing in Build a Meal          Needs: BF-11e
BF-11g  Lane A   library-first generation             Needs: BF-11e
BF-11h  Lane B   wizard + review-step surface         Needs: BF-11f, BF-11g
```

`BF-11f` and `BF-11g` are independent of each other and may run in parallel — different lanes,
different files. BF-11g works with zero tagged meals (the filter is a no-op), it just picks worse,
which is the whole reason BF-11f must land before BF-11h surfaces the feature.

**Never batch BF-11e** — it carries a migration, and §3 of the agents contract is explicit that a
migration's revert is a corrective migration rather than a `git revert`.

---

## 5. The phases

### 5.1 BF-11e — the tag join (Lane A)

Reuse `MealType` as the tag vocabulary rather than inventing a parallel "category" concept. The
user already names and configures their own meal types, each with a time window, and a meal can be
eligible for several (a protein shake is plausibly Breakfast *and* Post-Workout).

**A join table, `saved_meal_meal_types`** — `(saved_meal_id, meal_type_id)`, both FK, composite PK.
`saved_meal_id` cascades (it already does for `saved_meal_items`).

**Do not take a migration number in this plan.** Lane A claims it against the directory *and* open
PRs when it builds — the tree already carries four collided pairs, and `migrate.js` applies in plain
filename sort order.

**Three constraints the trace found, none of them obvious:**

1. **`meal_types` soft-deletes** (`deletedAt`, Q-179 — `food_logs.meal_type_id` is `ON DELETE
   RESTRICT`, so a hard delete fails while any log points at it). A join row can therefore point at
   a soft-deleted type. Decide it explicitly: **filter soft-deleted types on read** rather than
   deleting join rows, so restoring a type restores its tags.
2. **Saved meals reach the device via `hydrateSavedMeals(serverMeals)`, not `getSyncDelta`**
   (`sqlite-backend.ts:2486`, called from `saved-meals-sheet.tsx:122`). So the tags ride the existing
   `listSavedMeals` response — there is no pull-delta branch to add. Confirm this before building;
   it is the difference between a small change and a sync-domain change.
3. **The push side does have a branch** (`adapter.ts:4175`, `domain === 'saved_meals'`). Per
   CLAUDE.md's sync rule the web route and the push branch must not drift: if the web save accepts
   tags, the outbox payload, the `pushMutations` branch and the local table all take them **in the
   same PR**.

Local SQLite: a new table, registered in `RECONCILE_TABLES` **in the same commit** (`reconcileSchema`
is the real authority after a partial upgrade), and a version bump. `ADD COLUMN` idempotency does not
apply to a new table, but `CREATE TABLE IF NOT EXISTS` reaching only fresh installs does — see
`check-local-column-upgrade-path.js` and the rule it enforces.

`SavedMeal` gains `mealTypeIds: string[]`. Every `rowToX`/SELECT mapper that builds a `SavedMeal`
updates in the same PR — a missed mapper fails silently as "tags don't save."

### 5.2 BF-11f — tag editing (Lane B)

Chips in the build/edit form listing the user's live meal types, multi-select, defaulting to none.
An untagged meal is **eligible for every slot** — not for none — or the feature would silently
shrink everyone's library to zero on the day it ships.

Reuse the existing `ChipGroup` the wizard already uses rather than drawing a fourth chip.

### 5.3 BF-11g — library-first generation (Lane A)

The core of Part 2. `generate/route.ts` today: split macros into slots → pin kept meals to the first
slots → AI-generate the rest. The new order, per slot with no pin:

1. **Filter** the library to meals whose tags include this slot's meal type, plus every untagged
   meal. A slot's meal type comes from the slot's `timeMinutes`/`timingRole` against the user's meal
   types' `timeStartHour`/`timeEndHour` — those windows already exist and already define this.
2. **Rank** the survivors by `fitDistance(savedMealTotals, slotTarget)` — §1.1, do not write a second
   metric.
3. **Take the best if it is good enough**, gate on `mealFit(...)` rather than a fresh threshold.
4. **Otherwise fall through to AI generation** — §3.1 — and mark the slot so the client can say so.
5. Either way the chosen ingredients go through `scaleWithTopUp` exactly as a pinned meal does today.
   That path is unchanged and must stay unchanged: it already handles "a saved recipe is a finished
   dish, not a balanced slot."

**No meal may be used twice in a day.** Track what has been consumed across slots — the existing
"genuinely DIFFERENT food" instruction only constrains the *model*, and a library search does not go
near the model. This is a new failure mode created by this change, not an existing one.

**`matchReason` on the response** (item 10): which macro drove the pick, or that nothing fitted. It
is not decoration — item 11's library-swap and the existing AI edit both need it, and the design
records the owner saying so.

**Guard the `kept.length > mealCount` case** (§2, §3.2) so a client that skips the prompt still gets a
coherent plan: cap the pins the server honours at the slot count and **report what was dropped** in
the response rather than silently truncating.

`useLibrary: boolean` on `RequestSchema` (§3.3). Note #407 made the sibling `keepMeals` `.strict()`;
match whatever the schema style is at build time.

### 5.4 Cost, and the one thing to measure before assuming

Library search is a DB read plus arithmetic — **no model call**, so a slot filled from the library is
strictly cheaper and faster than one generated. `scaleWithTopUp` may still make one call when a macro
is short, exactly as today.

`listSavedMeals` is unbounded and now runs on more requests (§3.3). It reads `saved_meals` plus a
join to `saved_meal_items` and `food_items`. **Measure it against a realistic library before adding a
limit** — a cap chosen on a hunch is how a library-first feature quietly stops seeing half the
library.

### 5.5 BF-11h — the surface (Lane B)

Four things, one screen pair, one verification pass:

- **"Use all my saved meals"** toggle in the wizard's *Yours* step, sending `useLibrary`. The
  existing per-meal checkboxes stay and keep meaning *pin*, so the copy has to distinguish them:
  ticking a meal forces it in, the toggle lets the planner choose.
- **"Why this meal"** on library-matched slots, from `matchReason`, and its inverse on fallback
  slots — §3.1.
- **Reroll offers a library swap first** (item 11), AI-generate as the second option. `askForMeal`
  keeps its current behaviour behind the AI option; the per-meal route is untouched.
- **The meal-count reduction prompt** — §3.2. Only fires when `K > M − 1`.

---

## 6. Q-407 overlap — read that entry before starting BF-11h

Q-407 reworks the **whole wizard** into a coach conversation. It does not touch scanning location or
planner matching, so it is not a duplicate — but BF-11h and Q-407 edit the same two files
(`meal-plan-setup-sheet.tsx`, and the widget surface that would replace it).

- **If BF-11h lands first**, Q-407 inherits the toggle and the reduction prompt as behaviours its
  conversation must preserve, not as a stepper it is deleting.
- **If Q-407 lands first**, its Meals step should be designed as a **picker over saved meals** from
  the start, per BF-11's design — and the `useLibrary` flag becomes a widget answer rather than a
  toggle.

Either way **the server half (BF-11e, BF-11g) is untouched by Q-407**, which is the main reason the
engine phases lead. They cannot be invalidated by whichever way the wizard goes.

Q-407 also carries an instruction worth honouring here: *"Do not delete the stepper in this PR."*

---

## 7. Verification

- **BF-11e** — a meal saves with two tags and round-trips; a soft-deleted meal type disappears from
  a meal's tags and returns when restored; a fresh local DB and an upgraded one both carry the table
  (`check-reconcile.js`, `check-local-column-upgrade-path.js`).
- **BF-11f** — tags save, an untagged meal stays eligible everywhere.
- **BF-11g** — the highest-value tests, and they are pure functions, so write them as unit tests
  rather than route tests: a library containing an obvious fit is picked over AI; a library with
  nothing suitable falls through; a breakfast-tagged meal is not offered a dinner slot; **no meal
  appears twice in one day**; `kept.length > mealCount` returns a coherent plan and reports the drop.
- **BF-11h** — a plan generated with the toggle on, reasons visible; a reroll offering a library
  swap; and the **§2 regression**: pick the maximum meals, go back, lower the count, and confirm the
  prompt fires and nothing is silently dropped.

**Not exercisable in the sandbox, and must be said plainly:** the S25 pass (safe-area under the
wizard footer — `SheetFooter` owns the bottom inset and this repo's most repeated on-device
regression lives there), and any real-library latency, since the seeded local DB holds a handful of
meals rather than a real one.

**One standing rule this plan must not weaken:** a meal plan never claims to be allergen-safe.
Library-first changes *where a meal comes from*, not whether the restriction filtering can be
trusted — and a meal the user saved themselves is not thereby allergen-checked either. No badge, no
tick, no automatic action depending on it.
