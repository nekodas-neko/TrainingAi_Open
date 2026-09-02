# 2026-09-02 — the recommend prompt claimed an activity-scaled TDEE it never had (LB-50)

**Lane A · branch `lane-a/recommend-prompt-tdee` · no version bump**

`app/api/nutrition-goals/recommend/route.ts` built its baseline line as
*`Baseline (Katch-McArdle, lean mass Xkg, activity level "moderate"): BMR X, TDEE X…`*, which parses
as *this TDEE was computed for a moderate activity level*. It was not.

## The premise, checked rather than taken

`calculateBaseline` computes `tdee = Math.round(bmr * SEDENTARY_MULTIPLIER)`
(`packages/shared/src/nutrition/goal-recommendation.ts:188`) — 1.2, unconditionally. Q-401 deleted
`ACTIVITY_MULTIPLIERS` on purpose, so a self-reported level cannot double-count against the measured
movement the prompt supplies separately as steps and active calories. The level still reaches
`waterMl` and `stepsGoal`, and nothing else.

So the model was being handed a number and a false description of how that number was made, next to
an activity level and a step count — everything it needs to "correct" for a multiplier that is not
there.

This is the first entry of the session whose stated premise survived contact with the code.

## What shipped

The level is out of the baseline parenthesis, and the prompt now says outright that the TDEE is
BMR × 1.2, is not activity-scaled, and must not have a multiplier added. **Saying it beats merely
removing the false claim:** the model is still told the activity level on its own line and still
given steps and active calories, so silence would leave it to infer the relationship — which is what
it was doing wrong in the first place.

## What is deliberately not done

The second half of the entry — exposing the measured activity factor (`maintenanceKcal / bmr` on the
calibrated path) with its window, so BF-102's picker can render *"Calibrated · 1.38×, from your last
14 days"* — is not built. It needs the same not-enough-data state the maintenance figure already has,
and a calibrated factor that silently falls back to a guess is a worse picker than the one it
replaces. The entry stays queued with a `Keep:` naming it. The entry itself says the prompt fix
should ship on its own, and it is a one-string change with no feature attached.

## Verification

- Four assertions, one of which pins the **premise** rather than the fix: if `ACTIVITY_MULTIPLIERS`
  is ever reintroduced, the test fails rather than quietly protecting a statement that has become
  false in reverse. The others check the level is gone from both baseline lines (Katch-McArdle and
  Mifflin-St Jeor), that the correction is stated, and that the level still drives water and steps —
  so the correction is not itself an overstatement.
- **Mutation-tested**: putting the activity level back into the baseline line turns it red.
- `tsc` clean. Source-level assertions because the prompt is assembled inline and the only other way
  to see it is to call the model.

**Not exercised:** no LLM call was made, so this does not demonstrate the model's output changing —
only that it is no longer told something untrue. The APK, safe-area and Samsung WebView are
untouched; this is one string in a server route.
