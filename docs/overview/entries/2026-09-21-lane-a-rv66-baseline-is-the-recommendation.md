# RV-66 — the model was inventing numbers beside a function that had already computed them

**Branch:** `lane-a/rv66-baseline-is-the-recommendation` · **Lane A** · v1.463.0 · no migration, no
native change.

`/api/nutrition-goals/recommend` computed a full baseline — Katch-McArdle/Mifflin, a *measured* RMR,
goal offsets, lean-mass protein dosing, activity-scaled water and steps — quoted it to the model, and
then asked the model to return its **own** `recommendedCalories`, `ProteinG`, `CarbsG`, `FatG`,
`WaterMl`, `StepsGoal`. Those numbers were displayed as the recommendation and written into the
user's goals on Apply.

CLAUDE.md forbids precisely that, twice over: *no LLM self-reported number may gate an automatic
action **or be shown to the user as fact***. It was both.

**The model no longer returns any number.** The six fields are gone from the response schema, and the
recommendation is the computed baseline.

## The entry's unknown, measured — and it is worse than "strays inside the band"

RV-66 left open *"how far the model typically strays inside that band in practice is unmeasured"*,
because stored rows were never diffed against the baseline they came from. **They cannot be: the
baseline is not persisted alongside the recommendation.** So it was reconstructed instead — the
owner's profile on the day of the last applied recommendation (2026-09-14: 70.35 kg, 25.7% body fat,
measured RMR 1,325 kcal @ 51.5 kg FFM, recomp, moderate) run through the shipped `calculateBaseline`:

| field | computed baseline | model, stored **and applied** |
|---|---|---|
| calories | 1,410 | 1,618 (+15%) |
| protein g | 115 | 150 (+30%) |
| fat g | 39 | 55 (+41%) |
| water ml | 2,572 | 2,600 |
| **steps** | **10,000** | **5,000 (−50%)** |

**`clampRecommendation` altered none of it** — every value passed the safety band untouched, which is
the entry's *"a safety band, not a derivation"* confirmed rather than argued.

**The step goal is the cleanest evidence, because it needs no body-composition maths at all.**
`STEP_GOAL_BY_ACTIVITY` is a lookup that can only ever return 7,000 / 8,500 / 10,000 / 12,000. The
owner is `moderate` → 10,000. The model returned **5,000** while also returning
`recommendedActivityLevel: 'moderate'`, i.e. explicitly *not* proposing a different level. It halved
the step goal and the sheet wrote it in. Across all 13 stored rows the model produced six distinct
step goals — 5,000 / 6,000 / 7,000 / 7,500 / 8,000 / 8,500 — of which **four are values the formula
cannot produce**.

**Honest limit on the table above:** `body_fat_calibration` has no `claude_ro` view, so
`correctBodyFatPct` could not be reproduced and the raw 25.7% was used. That shifts lean mass and so
calories, protein and fat. **Steps and water do not depend on body fat at all**, so those two rows
hold regardless. Filed as LA-127.

## What stayed, and why it is not the same thing

`recommendedActivityLevel` stays. It is a **category**, not a number, and the figures that follow from
it are recomputed in code by a second `calculateBaseline` call on the new level. "Your logged
frequency says `active`, not `light`" is the question a model is actually equipped to answer; the
TDEE that follows is not. The prompt was rewritten to match: the model explains the figures, may
quote them exactly, and is told outright that it does not set them.

## Three findings this turned up, all filed rather than fixed here

- **LA-126 (owner-gated, LIVE).** The owner's live `nutrition_targets` are **1,660 / 150 / 141 / 55**
  — exactly the **2026-08-31** recommendation row. Model-invented numbers are in force right now,
  **+250 kcal and +35 g protein** over the formula. RV-66 stops future ones; it deliberately does not
  touch what is stored, because rewriting a user's goals is a production data write and the owner has
  been eating to those numbers for three weeks. **Not run for him.**
- **LA-125.** `calculateBaseline` sets fat at 25% of calories (39 g here); `clampRecommendation`
  floors it at 0.6 g/kg (42 g). So the recommendation is *the baseline made safe*, not the baseline
  byte-for-byte, and carbs come out at 143 rather than 150. The One Formula, One Place win this entry
  promised holds for calories, protein, water and steps and **not** for fat and carbs. The clamp
  cannot simply be deleted to close it — see below.
- **LA-127.** `claude_ro.user_goals` and `claude_ro.body_fat_calibration` do not exist, so the steps
  goal could not be read at all and the body-fat correction could not be reproduced.

## Why `clampRecommendation` was kept

It reads like a no-op once the input is a computed baseline, and it is not. `CALORIE_ADJUSTMENT_BY_GOAL`
subtracts **500** for `lose_weight`, and `bmr × 1.2 − 500 < bmr` for any BMR under **2,500** — which
is most people. Without the floor, every cutting user is shown a sub-resting-rate calorie target:
computed honestly, and still wrong to display. There is now a test for exactly that case, because I
had asserted it in a comment before asserting it in code.

## Verification

- **6 new tests**, behavioural and handler-importing, in the route's own `__tests__/`.

  **A correction worth carrying, because it changed what this PR had to do.** I first concluded the
  route's only test was a source-grep over its own text (`prompt-tdee-not-activity-scaled.test.ts`),
  on the strength of looking only under `app/api/nutrition-goals/**`. That was wrong: PS-39 had
  already written a 22-case behavioural suite at **`lib/__tests__/nutrition-goals-recommend-route.ts`**,
  under the heading *"the model never sets a number"* — the exact property this entry is about. It
  surfaced as **8 failures in the full suite**, not in any targeted run I had done.

  Those 8 are correct failures. That suite pinned the property via `clampRecommendation`: the model's
  number reached the route and was bounded. It no longer reaches the route, so every
  "model said 400 kcal → clamped to 1,780" case now reads "model said 400 kcal → 2,136, the
  baseline". **The property survived and the mechanism moved one layer earlier**, so the block was
  rewritten rather than deleted — the fixtures still hand back the old numeric shape on purpose, as
  proof the route ignores it.
  - the response equals the computed baseline, not the figures that were actually shipped;
  - **numeric fields are ignored even when the model volunteers them** (the load-bearing one: a
    schema is exactly what a later edit re-adds "for completeness");
  - the *persisted* row carries the baseline, since the sheet applies what was stored;
  - a suggested activity level recomputes every figure from the formula rather than being taken at
    its word;
  - the `lose_weight` calorie floor fires and says so in `dataQualityNote`;
  - the fat/carb clamp disagreement, pinned as current-behaviour-not-endorsed (LA-125).
- **Mutation pass — three mutations, one control.** Model numbers back in the schema and preferred →
  2 failed. Suggested activity level ignored when recomputing → 1 failed. `clampRecommendation`
  dropped entirely → 2 failed. The deliberately equivalent control (destructuring `clampBaseline`
  first) → **6 passed**.
  - **One mutation had to be thrown away and rerun**, which is worth recording: the first attempt at
    "skip the clamp" set `bmr: 0`, which only lowers the calorie floor to 1,200 — below this
    fixture's 1,410, so it was an *equivalent* mutation wearing a wrong-looking diff. It passed, I
    read that as a coverage gap, and the gap was real but different: nothing tested the floor. The
    floor test came from that, and only then did a real "drop the clamp" mutation fail.
- **PS-39's 22-case suite rewritten, not dropped**, plus one case in its "failure and context"
  block that used the protein clamp ceiling as a proxy for *which logged weight was used*: the
  property is unchanged, the proxy is now the baseline's own dosing, and it is derived from
  `calculateBaseline` and checked against the two weights it must not have picked so it cannot pass
  by coincidence.
- Response and stored-row shapes are unchanged, so `goal-recommendation-sheet.tsx` needs no change —
  checked, not assumed.
- Full suite, `check:rules` and `check-test-typecheck` below.

## A gotcha this item explained, belonging to no item

Earlier today RV-83's entry recorded `pnpm check:rules` failing once on `memo() call sites pass
stable props`, while the full suite ran concurrently, and filed it as unexplained. It is explained,
and the explanation was sitting in this run's working tree: `set-card.tsx` showed as modified with a
`// const X = memo(Y); <X style={{a:1}} />` line appended that I had not written.

`scripts/__tests__/check-comment-blindness.test.ts` proves each rule script actually *detects* its
violation by **appending that violation to a REAL source file** and restoring it in a `finally`.
Two files are used, `components/workout/set-card.tsx` and `app/api/user/goals/route.ts`. Run
`check:rules` inside that window and it reads a genuine violation the suite planted seconds earlier.

**So: do not run `pnpm check:rules` concurrently with the full suite.** It also explains the rule
script output that turns up inside vitest logs, which reads alarmingly like real violations in files
you never touched. RV-83's entry has been amended rather than left saying "unexplained".

## Not exercised

- **The model was never called.** `generateObject` is mocked throughout; what a real Gemini response
  looks like against the new schema and prompt is unverified. The schema is now four fields, three of
  them strings, so the failure mode if it drifts is a `NoObjectGeneratedError` caught by the existing
  try/catch into a 500 — not a wrong number.
- **No device check and no sheet render.** The sheet's own display of these figures was not exercised
  at the S25 viewport.
- **Production was read, not written**, and `claude_ro` is row-scoped to the owner: the 13 stored
  recommendations and the live targets are his, not a claim about every account.
