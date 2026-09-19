# 2026-09-19 — the cache bust he asked for is already there; the refetch is not

**BugFix intake.** Docs-only. Owner: *"The kcal left in the top right; doesnt load on the same page:
it requires page switching to show. Probs needs some sort of cache bust after logging food so it
updates"*. Filed as **BF-177**.

## The hypothesis was half right, and the half that is wrong is the useful part

`logFoodEntries` already calls `invalidateNutritionWrite()`, and that group already clears
`energy-balance:`. The key is evicted on every food log. Adding another invalidation would change
nothing — this is the Q-402 shape CLAUDE.md already names: *"Invalidating a key and re-rendering the
component that reads it are two different things."*

## What actually happens

`onLogged(log)` lands in `handleFoodLogged`, whose optimistic branch appends to `logs` and returns.
Only the `else` branch calls `fetchData`, which is what refetches `energy-balance`. So `logs`
updates — the ring and macro grams move — while `energyBalance` still holds the object fetched
before the meal.

And the card prefers that payload over the two live numbers it already has:

```ts
const remaining = b ? b.remainingKcal : goal != null ? Math.round(goal - calories) : null
```

`remainingKcal` is `budgetKcal − intakeKcal` computed server-side — the same subtraction, against
the server's snapshot of intake. Switching tabs re-runs `fetchData`, the key is now a miss, and the
fresh payload carries the new number. That is the "page switching" he describes.

## The one-line fix is a trap, and the entry says so

Deriving `remaining` from `goal − calories` looks obvious. But `remainingKcal` is `-deviationKcal`,
and **`zoneLabel`, `zoneColor` and the bar all come off that same `deviationKcal`**. Make the number
live without the rest and the card reads "871 kcal left" beside a "Well under so far" band that has
not moved — one visible disagreement traded for a subtler one, against a file whose own comment says
every "left"/"over" reading comes off one number (LB-100).

The fix is to refetch the balance in the optimistic branch — **the balance alone, not `fetchData`**,
which would also reload the food list that was just appended to optimistically.

## Accepted consequence

The ring updates instantly and "kcal left" lands a round trip later. That is correct, because the
budget half genuinely comes from the server, and it is a far smaller gap than one that persists
until the tab changes.

## What was not exercised

Nothing on the S25. The path was traced in source — write → invalidation → callback → render — and
not reproduced at runtime. The device look is owed because the optimistic-append timing is what
decides whether the round trip reads as instant.
