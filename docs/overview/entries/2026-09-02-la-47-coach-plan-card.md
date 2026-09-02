## 2026-09-02 — AI Coach draws the meal plan, and one button puts every meal in My Foods (LA-47)

**Branch:** `claude/implementation-agent-lane-a-a5ih6n` · **Lane:** A, with Lane B's renderer in the
same PR · **v1.432.0.**

LA-47's second piece shipped 2026-08-31 (the named nutrition scope). This is the first: the plan
widget, which is what the owner's review was actually asking for — *"I want it to make the meal plan;
then add each item to the saved meals/my foods"*. The conversation is finished when every meal is a
row in `My Foods`, and until now nothing in a Coach thread could put one there.

### One PR across two lanes, because the split does not compile

The entry had already established this and it holds: `components/coach/widget-registry.tsx` narrows
by early return and falls through to `widget.patch.domain`, so a new union member is a **type error**
until a branch handles it. A branch rendering `null` would be worse than none — `widgets.ts` says so
about the chart — because the provider refuses a request containing an unanswered client-side tool
call, and the thread wedges permanently rather than for one turn. So the schema, the tool, the
registry branch and the component are one change.

### What it carries: a title, and nothing else

`showMealPlan`'s whole input is `{ kind, title, planId? }`. The card reads each meal, its calories
and its ingredient count from the plan the app already holds, for the reason `CHOICE_SOURCES` exists
— a nine-meal plan typed out by the model is several hundred output tokens transcribing a database,
and output tokens are essentially all of Coach's latency.

**The honesty argument turned out to be the stronger one.** A model that can write the meals can
write *different* meals from the ones stored, and nothing downstream would notice: a rounded calorie
figure, a dropped meal, or a set of numbers quietly reconciled to a target nobody asked it to hit.
There is nowhere to put them, and a test asserts that `meals` and `targetCalories` are stripped from
a payload that supplies them.

### The two buttons are not a new result type

`save_all` and `redo` resolve as ordinary `chose` results with fixed ids in `PLAN_CARD_ACTIONS` — a
card with two buttons is a choice list with a rich body. A fourth `WidgetResultSchema` status would
have made every consumer handle a shape that says nothing the label does not.

Save-all calls `savePlanMealsToLibrary` (Q-398, on `main` since 2026-08-24), which skips a meal that
already carries a `savedMealId`, so pressing it twice is a no-op and a saved meal shows a tick
instead of an offer. The `chose` label is the honest count — `Saved 2 of 3 meals` when a copy fails,
because that string is both the user's bubble and what the model reads back.

### The no-plan case resolves itself rather than hanging

A card with nothing to show would otherwise sit unanswered until the user typed past it. It sends
`{ status: 'stale', detail }` once the fetch has actually answered — never while `data` is still
undefined, which would cancel every plan card before its rows arrived. Exercised: with the plan
deactivated the thread read *"There is no active meal plan yet."* and the model carried on.

### Verified with a real Gemini turn, and the numbers checked in the database

`pnpm dev`, a seeded three-meal plan, nutrition scope. The model called `getMealPlan`, then
`showMealPlan` with a title and no meals. Clicking Save-all wrote three `saved_meals` rows with 3, 3
and 2 items and stamped all three `meal_plan_meals.saved_meal_id` values. Re-rendering showed three
ticks and a disabled button. Both action ids were fed back as follow-up turns: `save_all` got a
one-sentence confirmation and no repeated widget, `redo` got an offer to rebuild. A general-scope
swap turn still opens with `renderChoiceList` `source: "exercises"`, so the sixth widget tool cost
nothing there.

**Not device-verified.** `getLocalStore` returns null in the web sandbox, so the save took the API
fallback and the local SQLite write plus outbox mutation were not executed from this surface —
Known-Issues row in `projectOverview.md`.

### One correction to the design while building

The model titles the card with the plan's own name, so printing `plan.name` in the subtitle too gave
*"Lean bulk — 3 meals / Lean bulk — 3 meals · 2,600 kcal · 3 meals"*, which reads as a rendering bug.
The name is now named only when it differs from the title. Found by screenshotting at 412×891, not by
reading the JSX.

### What this unblocks

**Q-407's `Needs: LA-47` is cleared** and it is now Lane B's third READY item. What remains there is
the *conversation* — answers as widgets replacing the seven-step sheet, and pointing the Nutrition
tab at `/coach` with `scope: "nutrition"`, which the route already reads and nothing yet sends. The
plan card is built; do not rebuild it.
