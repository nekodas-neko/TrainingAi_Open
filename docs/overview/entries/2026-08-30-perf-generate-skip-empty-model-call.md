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
