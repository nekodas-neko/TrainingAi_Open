# RV-177 — two routes anyone could call as often as they liked

**Branch:** `fix/rv177-rate-limits` · **Lane A** · `[platform][nutrition]`

Two more of RV-177's nine gaps. Two remain, neither re-verified.

## The meal PATCH reaches a model

`PATCH /api/nutrition/meal-plans/meals/[mealId]` has a `scaleToTarget` branch that calls
`scaleWithTopUp`, which is a `generateObject` call against the real model. It had no cap, while both
its siblings have one — `meal-plans/generate` at 10/h and `generate/meal` at 40/h.

Limited at **40/h**, matching `generate/meal` because it is the same per-meal granularity, and
placed **inside the branch** rather than at the top of the handler. The same route serves a plain
rename or reorder, which costs nothing; throttling those to protect a model call would be the wrong
trade.

## The calendar route had neither a limit nor a schema

`POST /api/log-calendar-event` writes to Google Calendar. Its body was an untyped cast guarded by
`if (!sessionType || !startMs || !endMs)` — which passes **any truthy value**. So a string, a float
or `1e20` went straight into `new Date(startMs).toISOString()`, which throws `RangeError` on
anything outside the Date range: a client error surfacing as a bodiless 500.

It now takes a `.strict()` Zod body with `startMs`/`endMs` bounded to 2000–2100 rather than to
Date's own ±8.64e15 (which would still accept the year 200000), a refinement that `endMs` cannot
precede `startMs`, and a 30/h limit. Thirty is far above real use — a handful of sessions a day —
but it bounds a client stuck in a retry loop, which is what the rule asks for.

## Verification

11 cases in `app/api/__tests__/rv177-rate-limits.test.ts`, including a control that a valid body
reaches the external call, so the 400 cases are known to be about the body rather than about
anything upstream. Run together with `lib/__tests__/feedback-calendar-scale-routes.test.ts`, which
pins the truncation property from the other side — 30 cases in total.

| mutation | killed |
|---|---|
| raise the calendar limit past what the loop spends | 1 of 30 |
| raise the meal PATCH limit past its loop | 1 of 30 |
| `.max(50)` on the exercise array (the regression below) | 2 of 30 |
| drop `.strict()` from the calendar body | 1 of 30 |
| `startMs` loses its bounds | 5 |
| drop the `endMs >= startMs` refinement | 3 |
| **control:** `MAX_EXERCISES` 500 → 400, both far above any body sent | **0 — survived, as intended** |

**Two process failures worth recording, because both produce a false green.**

The first mutation pass reported all four surviving. It hadn't run: the shell helper never passed
its arguments to python, so every "mutation" was a no-op. The assert inside it turned that into a
loud `IndexError` rather than a quiet pass — which is the only reason it was caught. This is the
**third** time in one session that a mutation silently failed to apply. A mutation that does not
assert its match count is not a mutation.

The meal-PATCH case then failed for a reason that had nothing to do with the limit: the ingredient
fixture used `grams`/`calories` where `NutritionIngredientSchema` wants `weightG`/`caloriesPer100g`,
so every request 400ed before reaching the rate limiter and no 429 ever arrived. Probing the real
status and body settled it in one run; guessing would not have.

Gates (real exit codes): `tsc` 0 · `typecheck:tests` 0 · `check:rules` 0, **79 of 79** · pointers 0 ·
doc-size 0 · full suite green.

## Not exercised

Server-side only — no schema change, no migration, no local-store change, no device path. The
calendar route's **actual Google write was never exercised**: the test's refresh token is fake, so
the valid-body control asserts only that validation passed and the external call was reached. A real
event has still never been created from a test, and that is the same gap OR-166's `Keep:` records.

## Two things the full suite caught that the file's own tests did not

**The schema turned truncation into rejection.** The first draft capped the exercise array at
`.max(50)`. The route has always *truncated* a long session into the calendar description, and
`feedback-calendar-scale-routes.test.ts` pins that — so a 60-exercise body went from an accepted
event to a 400. The cap is now `MAX_EXERCISES = 500` on the body (well past any real session; the
16 kB body limit is the binding one) with the description still sliced at 50, and the property is
pinned from inside this file too. A validation schema added to a route that already had *behaviour*
can remove behaviour, and only the pre-existing test saw it.

**The file passed once and then failed for the rest of the hour.** Two cases deliberately spend the
hourly budget, and this corrects a claim written in the first draft of this entry: `rateLimit` is
**not** an in-process store. It flushes into a shared Postgres `rate_limits` table and treats the
DB count as authoritative (`flushKey`, `lib/rate-limit.ts`), so a spent budget outlives the process
and poisons the next run — a case unrelated to limits (`refuses an unknown key`) came back 429
instead of 400. The file now clears both halves in `beforeAll`, the pattern
`weekly-review/month-window` already uses; it is green on two consecutive runs. The multi-replica
caveat the first draft drew from that wrong reading does not hold either: the shared table is what
makes the limit hold across replicas.
