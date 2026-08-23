# 2026-08-23 — The AI-usage screen's top row was an artefact of its own fingerprint

**Branch:** `fix/ai-fingerprint-granularity` · **Lane A** · Q-471

The double-trip metric on More → Developer → AI usage calls a request redundant when
`(user_id, section, fingerprint)` repeats inside 120 s. Three meal-plan sections fingerprinted on a
**rounded calorie target and nothing else**, so a deliberate reroll — tap reroll, dislike it, tap
again — was indistinguishable from the same call firing twice. It was the screen's top row:
**32 redundant · 4 distinct**, most plausibly four slots rerolled about eight times each.

## The fix

`lib/ai/instrument.ts` gains `contentKey(...parts)`: an 8-hex digest that turns free text into a
key, so it can enter a fingerprint without breaking that module's own rule — *"pass ids/dates/keys
only, never raw prompt text or health data"*. Empty in, empty out, so `stores: []` and no stores at
all still fingerprint alike.

| section | was | now also carries |
|---|---|---|
| `meal-plan-generate-meal` | rounded kcal | `avoidNames` — which includes the meal being replaced, so it changes on every reroll |
| `meal-plan-edit-meal` | rounded kcal | the instruction, and the meal it applies to |
| `meal-plan-generate` | `mealCount:dayTypes` | the kept meals, stores, excluded foods |
| `meal-plan-top-up` | rounded kcal | the meal name and what it is short of |

## Measured, on the real routes

`pnpm dev` against the local database, signed in, three POSTs to
`/api/nutrition/meal-plans/generate/meal` — two identical, one a reroll — and then the screen's own
query over `ai_call_log`:

```
meal-plan-generate-meal | 22ec3d34c81a5a06   ← call 1
meal-plan-generate-meal | 17744a6cdce1b8ec   ← call 2, one more name in avoidNames
meal-plan-generate-meal | 22ec3d34c81a5a06   ← call 3, identical to call 1

redundant_calls: 1   distinct_fingerprints: 2
```

Under the old fingerprint all three were `d98c061bfba1b3cc` — **2 redundant of 3, 1 distinct**. The
one redundancy that survives is the genuinely identical repeat, which is what the metric is for.

`/api/nutrition/meal-plans/generate` was driven twice, differing only by `stores`, and produced two
fingerprints where the old form gave one.

## One correction to the entry

It proposed fingerprinting `generate-meal` on "the meal `position` plus `avoidNames`". **There is no
`position` in that request** — the schema has no such field. `avoidNames` alone does the work, and
its own schema comment says why: *"Meals already in the plan — including the one being replaced — so
the reroll differs."*

## What this deliberately does not touch

The reroll UI. `meal-plan-review-step.tsx` already sets `rerolling` before the fetch and disables
every control on it; there is no tap-spam, and the entry exists partly to stop someone being sent to
that file by a misleading screen. **44 of the 89 redundant calls were this artefact. The other 45
are real** and belong to Q-470 and Q-469, which are now readable.

## Also in this PR

Q-545 is gated on the device. Its engine half is complete — the rollup reaches zero server-only
modules — and every remaining task (the drain wiring, the WASM instantiation check, the soak, the
single-writer flip) needs the S25, so it is not startable from a sandbox.

## Verification

Full suite **544 files / 4,488 tests** green · `pnpm check:rules` → **51 of 51** · typecheck and
lint 0 errors. `contentKey`'s determinism, empty-in-empty-out, order sensitivity and part separation
are pinned in `lib/ai/__tests__/instrument.test.ts`, alongside three cases stating the reroll-vs-
double-trip distinction directly.

**Not exercised:** `meal-plan-top-up` did not fire in the dev pass — it only runs when a meal cannot
reach its targets by scaling, and neither generated plan was short. It composes its fingerprint the
same way and is covered by the unit tests. Nothing here is device-dependent.
