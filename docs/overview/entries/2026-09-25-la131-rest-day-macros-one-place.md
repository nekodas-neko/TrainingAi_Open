# LA-131 — what a rest day means, in one place

**Branch:** `fix/rest-day-macros-one-place` · **Lane A** · `[nutrition][platform]`

## What was duplicated

`REST_DAY_CARB_REDUCTION = 0.15` was declared in two files, and so were the three lines deriving
from it — `carbShift = round(carbs × reduction)`, `carbs − carbShift`, `calories − carbShift × 4`.
The two files are `app/api/nutrition/meal-plans/generate/route.ts` and
`app/api/nutrition/meal-plans/[id]/structure/route.ts`: the **generate** and **restructure** paths
for the same plan.

The copies agreed — 0.15, identical arithmetic, verified again against `main` before touching
anything. That is what made this cheap now and expensive later: tune one and a restructure silently
re-targets every rest-day meal against a different definition of a rest day than the one that
generated it, and **neither number looks wrong**. The structure route's own comment said
*"matches the generate route"*, so the duplication was known and written down rather than accidental,
which is the part a grep would not have told you.

## What shipped

`packages/shared/src/nutrition/rest-day-macros.ts` exports `REST_DAY_CARB_REDUCTION` and
`macrosForDayType(daily, dayType)`, returning the adjusted targets plus `carbShiftG`. Both routes
import it. `grep -rn REST_DAY_CARB_REDUCTION app/` now returns **nothing** — the only remaining
mention in `app/` is a comment in a test.

## One thing the entry did not name, and it was a latent divergence

Review sweep 59 correctly found a **third** use in the generate route: the prompt line at what is
now `:305` passed `dailyCarbs * REST_DAY_CARB_REDUCTION` to `restDayCarbLine` — the **unrounded**
product — while the variant targets used `Math.round(...)`. So the sentence shown to the model
described a slightly different shift from the one actually applied.

It never produced a wrong string, because `restDayCarbLine` rounds internally and rounding is
idempotent. It is fixed anyway: the prompt line now takes `macrosForDayType(...).carbShiftG`, the
same number the targets used. That is why the helper returns `carbShiftG` alongside the macros
rather than only the adjusted totals.

## Verification

`packages/shared/src/nutrition/__tests__/rest-day-macros.test.ts`, 7 cases. The load-bearing one is
an **equivalence test**: the code that stood in both routes is transcribed into the test file and
compared against the helper across 401 carbohydrate values × 3 day types. A refactor that stops
being a refactor fails there.

Mutation pass:

| mutation | killed |
|---|---|
| drop the rounding, carry the fraction into the calories | 2 of 7 |
| the reduction drifts to 0.20 — the exact failure this entry exists to prevent | 5 of 7 |
| apply the shift on a training day too | 2 of 7 |
| **control:** `carbShiftG * 4` written as four additions | **0 — survived, as intended** |

Behaviour preserved: `app/api/nutrition` + `packages/shared/src/nutrition`, **50 files / 539 tests
passed, exit 0**, including `use-library-wiring.test.ts`, which asserts the 15% rest-day reduction
end-to-end through the generate route.

Gates: `tsc --noEmit` clean · lint 0 errors · **Ran 79 of 79 Custom Rules steps** · full suite green.

## Not exercised

Pure refactor of server-side domain math — no schema change, no local-store change, no migration, no
device path, and no user-visible behaviour, so no version or changelog bump. The two routes were not
driven by hand on `pnpm dev`; their own 50-file suite covers them and the equivalence test pins the
arithmetic directly, which is a stronger check than one manual pass would have been.
