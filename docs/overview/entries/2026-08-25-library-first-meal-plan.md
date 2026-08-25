# 2026-08-25 — the planner looks in your library before asking the AI (BF-11g)

**Branch:** `feat/library-first-meal-plan` · **Lane A** · engine half. Nothing user-visible yet —
`useLibrary` is off for every real request until BF-11h turns it on.

The owner's ask: *"it prefers meals already in the planner and adds other meals around it."* Today
every unpinned slot is a fresh AI recipe and nothing reads the library at all.

## What it does

Per unpinned slot, in order: filter the library to meals tagged for that slot's meal type (plus
every untagged meal) → rank by `fitDistance` → take the best if `mealFit` says it is close enough →
otherwise fall through to the model. Either way the chosen ingredients go through `scaleWithTopUp`
exactly as a pinned meal already does.

`useLibrary: boolean`, not a list of ids — the route already lists the library server-side, so "use
all my saved meals" costs zero payload and cannot name another user's meal.

## The design decision the plan did not settle, and why it matters

The plan says rank by `fitDistance(savedMealTotals, slotTarget)`. **Judging the saved totals is the
wrong question**, and reading `scaleIngredientsToTargets` is what showed it: the scaler moves each
macro **group** independently and clamps each to `PORTION_SCALE_MIN`–`PORTION_SCALE_MAX`. So the
meal's *size* is the one thing portioning always fixes, and ranking raw totals would reject a
perfectly-shaped meal for being half a portion.

**Every candidate is run through the real scaler before it is ranked or gated** — the meal is judged
on what it will *become*, moments later, by the same function that will make it. No second metric
and no fresh threshold, which is what the plan actually protects: `fitDistance` still ranks and
`mealFit` still gates.

**I nearly got this wrong in the other direction too.** My first instinct was to normalise candidates
to the slot's calories before comparing — which would have been wrong for the same reason, because a
uniform scale is not what the scaler does. Reading it settled both.

The gate earns its keep either way: a meal with **no fat source** cannot reach a fat target however
it is portioned, and the scaler has nothing to move. There is a test for exactly that.

## Also fixed: pins the server could not honour

More pins than slots used to be truncated **silently** — `kept` took the first slots and the rest
vanished with no word to the client, which reads as a bug in pinning rather than a limit. The server
now caps at the slot count and reports `droppedPins`.

## New failure mode this creates, and closed

**A meal used twice in one day.** The "genuinely DIFFERENT food" instruction constrains the *model*,
and a library search never reaches the model. Picks are deduped across slots, library picks join the
prompt's already-in-the-plan list so the model does not duplicate them either, and they are added to
the AI-call fingerprint — without that, a plan whose library filled three slots would fingerprint
identically to one that filled none, which is the Q-471 shape one input later.

## Verified

- `library-match.test.ts` — **15 passed**, pure and synchronous, which is the reason the ranking
  lives in `packages/shared` rather than in the route: behind an AI call it is untestable.
- **End to end through `pnpm dev`, against a real model**, with a seeded chicken-and-rice meal:

  | request | result |
  |---|---|
  | no `useLibrary` | 3 AI meals, `libraryMatchCount: 0`, every `matchReason` null |
  | `useLibrary`, meal tagged **Lunch** | slot **1** is `library`, slots 0 and 2 `ai` with *"No saved meal fitted this slot."* |
  | same meal **untagged** | slot **0** is `library` — an A/B on one variable, so the tag filter is what placed it |
  | 4 pins, 3 slots | `droppedPins: ["BF11g Pin C"]` instead of a silent truncation |

  And the pick is *better*, not merely present: the library meal landed **P 55.1 / C 82.3 / F 20.4**
  against a target of 55 / 82.3 / 20.3, while the two AI meals in the same plan came in at **37.9**
  and **27.8 g fat** against that 20.3.
- `tsc --noEmit` clean, `pnpm check:rules` **Ran 56 of 56**.

## Not exercised

- **No UI sets `useLibrary`**, so this changes nothing for the owner until BF-11h. Everything above
  was driven by curl.
- **Nothing on the device.**
- **The `splitTrainingRest` path was not driven with the library on.** The match runs once against
  the unshifted slots by design — the same ingredient list serves both variants and is rescaled per
  variant, exactly as a pinned meal already is — but only the single-variant path was exercised live.
- **One model, one afternoon.** The fit numbers above are one run; the gate and ranking are
  deterministic, but which AI meals it is compared against are not.
