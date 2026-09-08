# 2026-09-08 — the three routes that decide what a nutrition day means (PS-39, 58 → 55)

**Branch:** `test/nutrition-day-completion-routes` · **No product change.**

25 cases over `food-logging-complete`, `nutrition/plan-meal-answers` and
`nutrition/dietary-restrictions`, batched because each answers a different half of the same
question — *is this day's food record finished, and what was deliberately not eaten*.

## What each case decides

**`food-logging-complete` writes one field into a row it does not own.** `saveDayCheckin` overwrites
every column it is handed a value for, so the route reads the evening check-in first and passes all
fourteen of its fields back through. Dropping any one silently erases a wellness answer the user
typed, and the response — which reports only the date and the flag — looks correct either way.
`complete: false` has to reach **null** rather than a falsy date, because the maintenance
calibration reads null as EXCLUDED; that is the Undo the owner asked for, and without it a day
marked by accident poisons the estimate permanently. The response reports what was **stored**, not
what was asked for, so a write the repository refused cannot read back as done.

**`plan-meal-answers`** answers 404 identically whether the meal is not yours or does not exist, and
the test asserts the body does not echo the id — that is what stops the route being an id oracle.

**`dietary-restrictions` PUT replaces the whole set**, so its `max(60)` cap is all that stands
between a picker bug and an unbounded write; an empty set is accepted, because otherwise the last
restriction would be permanent.

## The fixture trap, twice more

The passthrough fixture gives **every field a different value**. Equal scales would make a swapped
read — `hydration` where `mentalDrain` was meant — produce an identical call, and both `*Touched`
booleans are `true` because the route writes `existing?.x ?? false`, which a `false` fixture cannot
distinguish from the fallback.

The mutation pass then found the same trap in a form I had written myself. **`normalizeDateParam`
returns the SLASH form** (`YYYY/MM/DD`) — only its `…Iso` sibling converts to dashes — so a fixture
sending `2026/03/05` normalises to itself, and removing the normalisation from the POST and DELETE
handlers changed nothing. Both now send dashes in and assert slashes out, which is the only
direction where the two answers differ.

## A latent inconsistency, recorded rather than changed

The **web route** stores plan-meal answers under the slash form; the **sync-push branch** for the
same domain calls the identical slice function after `logDate.replace(/\//g, '-')`. The two agree
today only because `plan_meal_answers.log_date` is a Postgres `date`, so either literal is cast on
the way in and read back as dashes. It is not a live defect and is pinned as-is: changing it would
be a behaviour change, not a test fix. Worth knowing before anyone converts that column to text.

## Mutation pass

**28 of 28 caught**, after the two fixture fixes above. Deliberately included: dropping each kind of
passthrough (evening scale, morning scale, `illnessContext`, `soreMuscles`, `journal`, a `*Touched`
boolean), reading the wrong check-in phase, ignoring the user's timezone, removing the rate limit,
dash-only date regexes on both routes, dropping `.strict()` at three levels, raising the set cap,
widening the severity enum, collapsing 413 into 400, and reading another user's selections.

## Not exercised

Web/Node only — no device, no native, no safe-area, gesture or notification surface. The repository
is mocked, so the two-level ownership join inside `savePlanMealAnswer` is not exercised here; only
that the route answers 404 when it refuses. No live database.
