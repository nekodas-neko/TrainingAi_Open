# 2026-08-15 — Log Food, and a deferred decision that was already made (Q-257)

**Branch:** `claude/trainingai-backlog-v0abea` · **Version:** v1.316.0

Q-237 shipped the Nutrition action row as **Water · Saved Meals**. The IA plan's target row was
**Log Food · Water · Saved Meals**, and the third was deferred into Q-257 because a global "Log Food"
has to pick a meal type, and food is only ever logged per meal today.

The entry framed that as an open product decision — clock time, next unlogged meal, first meal type,
or a picker — and asked someone to check whether `meal_types` even carries the windows.

## The decision already existed, twice

`mealTypeForHour(mealTypes, hour)` picks by **clock time against the user's configured meal-type
windows**, falling back to the first bucket rather than refusing, because *"a gap in the user's
configured hours should not lose a log"*. It is used by `saved-meals-sheet.tsx` and by `logPlanMeal`,
and its doc comment says it is shared **precisely so the two cannot drift** when meal-type hours
change.

So a third surface inventing its own rule would be the drift that helper exists to prevent. This was
a build, not a decision — and the entry's open question resolves with it: **`meal_types` does carry
the windows.** Confirmed against the live route rather than the schema: `Breakfast 6-10 · Morning
Snack 10-12 · Lunch 12-15 · Afternoon Snack 15-17 · Dinner 17-21 · Evening Snack 21-24`.

**Device hour, like both existing callers.** "Which meal am I eating right now" is about where the
user physically is, and this is not a key that has to match server bucketing. Stated deliberately
rather than copied silently — a third unremarked `getHours()` is how a convention becomes an
accident.

## The size rule forced the right shape

Adding the button took `nutrition-content.tsx` to **803 lines**, over the 800 limit. The rule asks
for extraction rather than appending, so the row moved to
`components/nutrition/nutrition-action-row.tsx` — which it should arguably have been at Q-237, since
an action row is a self-contained thing rather than a fragment of the screen's state. The gate found
that, not review.

## Verified

`pnpm build` · `tsc --noEmit` clean · lint 0 errors · `pnpm check:rules` **35 of 35** · full suite
**3,911 tests** under the TCP `DATABASE_URL`.

Live meal-type windows confirmed as above, and `/nutrition` returns 200.

**What the live check could NOT show, and the control that proved it:** the button does not appear in
the fetched HTML. Neither do **Water** or **Saved Meals**, which already work — the whole row is
client-gated on `selectedDate === todayStr`, which is client state. So "not in the HTML" is not
evidence of a bug; it is evidence the row is client-rendered. The new button sits in the same
conditional as its two working siblings.

**Not exercised: the S25, and the button actually opening the logger.** That needs a rendered client,
which a fetch of the page cannot provide. What is proven is the bucket rule, its inputs, and that the
row compiles and ships in the same conditional as two known-good actions.
