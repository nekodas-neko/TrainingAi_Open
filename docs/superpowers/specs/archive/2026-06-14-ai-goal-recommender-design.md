# AI Nutrition & Activity Goal Recommender — Design Spec

**Date:** 2026-06-14
**Status:** Approved, ready for implementation plan

## Overview

Add a feature where the user enters baseline body/lifestyle stats (activity
level, fitness goal) and an AI (Gemini 3.1 Flash Lite, same as the morning
briefing / program generator) recommends a weekly step-count goal and daily
calorie/macro/water targets. The user reviews the suggestion and approves
which parts to apply — nothing is changed automatically. The recommendation
also surfaces narrative "insights" (e.g. sleep-vs-mood patterns, recent PRs)
when there's enough data.

Available both on-demand (Profile tab) and via a bi-weekly pop-up "goals
check-in" card on the home screen.

## Goals

- New `activityLevel` and `fitnessGoal` profile fields drive a deterministic
  baseline calorie/macro/step/water calculation (Mifflin-St Jeor TDEE).
- An AI call refines the baseline using recent trends (weight, steps, RHR,
  HRV, sleep, mood, workout frequency, PRs) and explains its reasoning.
- AI can also suggest correcting `activityLevel` itself if logged training
  frequency doesn't match the user's current selection — and bases the rest
  of its numbers on the corrected level for internal consistency.
- User reviews suggested vs. current values per metric, picks which to apply.
- Every suggestion (applied or dismissed) is recorded for history.
- Scheduled pop-up re-surfaces every 14 days once the user has completed
  the required profile fields.
- Existing TDEE display (`health-content.tsx`) switches from a hardcoded
  1.4x activity multiplier to the user's actual `activityLevel`.

## Out of Scope

- Training/workout program review — the existing AI program builder already
  generates routines for N weeks; no periodic review of the program itself.
- Auto-applying recommendations — suggest-only, always requires user approval.
- Lean-mass-based protein dosing (using `bodyFatPct`) — deferred; protein is
  dosed per total bodyweight for v1.
- A consolidated "Goals" screen — the entry point lives in the Profile tab
  for v1; existing scattered goal fields (steps/water/sleep goals on `users`,
  macro targets in `nutrition_targets`) are not restructured.
- Improving the existing crude per-workout "Est. kcal" heuristic on the
  workout done-screen — unrelated; TDEE's activity multiplier already
  accounts for training burn at the daily level.
- Per-field application history — `goal_recommendations` tracks one overall
  status (`pending`/`applied`/`dismissed`), not which individual checkboxes
  were ticked.

---

## 1. Data Model

New migration `068_goal_recommendations.sql`:

```sql
ALTER TABLE users ADD COLUMN activity_level TEXT;
ALTER TABLE users ADD COLUMN fitness_goal TEXT;
ALTER TABLE users ADD COLUMN last_goal_review_at TIMESTAMPTZ;

CREATE TABLE goal_recommendations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source                      TEXT NOT NULL,        -- 'on_demand' | 'scheduled'
  recommended_steps_goal      INTEGER,
  recommended_calories        INTEGER,
  recommended_protein_g       DOUBLE PRECISION,
  recommended_carbs_g         DOUBLE PRECISION,
  recommended_fat_g           DOUBLE PRECISION,
  recommended_water_ml        INTEGER,
  recommended_activity_level  TEXT,
  reasoning                   TEXT,
  insights                    TEXT,
  data_quality_note           TEXT,
  status                      TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'applied' | 'dismissed'
  applied_at                  TIMESTAMPTZ,
  dismissed_at                TIMESTAMPTZ
);

CREATE INDEX idx_goal_recommendations_user ON goal_recommendations(user_id, created_at DESC);
```

App-level enums (text columns, matching the existing convention for `sex` etc.):

| Field | Values |
|---|---|
| `users.activity_level` | `sedentary` \| `light` \| `moderate` \| `active` \| `extra_active` |
| `users.fitness_goal` | `lose_weight` \| `maintain` \| `build_muscle` \| `recomp` |
| `goal_recommendations.source` | `on_demand` \| `scheduled` |
| `goal_recommendations.status` | `pending` \| `applied` \| `dismissed` |

UI label for `recomp`: **"Lose fat & build muscle (recomp)"**.

---

## 2. Calculation Engine — `lib/nutrition/goal-recommendation.ts`

Pure functions, no DB/AI access. Single source of truth shared between this
feature and the TDEE display on the Health page.

```ts
export const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, extra_active: 1.9,
} as const

const STEP_GOAL_BY_ACTIVITY = {
  sedentary: 7000, light: 8500, moderate: 10000, active: 12000, extra_active: 12000,
} as const

const CALORIE_ADJUSTMENT_BY_GOAL = {
  lose_weight: -500, maintain: 0, build_muscle: +300, recomp: -200,
} as const

const PROTEIN_G_PER_KG_BY_GOAL = {
  lose_weight: 1.8, maintain: 1.6, build_muscle: 2.0, recomp: 2.2,
} as const
```

`calculateBaseline({ weightKg, heightCm, ageYears, sex, activityLevel, fitnessGoal })`:

1. **BMR** (Mifflin-St Jeor, same formula as `health-content.tsx`):
   `10 * weightKg + 6.25 * heightCm - 5 * ageYears + sexOffset`
   (`sexOffset`: male `+5`, female `-161`, other `-78`)
2. **TDEE** = `round(BMR * ACTIVITY_MULTIPLIERS[activityLevel])`
3. **Calories** = `TDEE + CALORIE_ADJUSTMENT_BY_GOAL[fitnessGoal]`
4. **Protein (g)** = `round(weightKg * PROTEIN_G_PER_KG_BY_GOAL[fitnessGoal])`
5. **Fat (g)** = `round(calories * 0.25 / 9)`
6. **Carbs (g)** = `round(max(0, calories - protein*4 - fat*9) / 4)`
7. **Water (ml)** = `round(weightKg * 33) + activityBump`, where `activityBump`
   is `0` for sedentary/light, `250` for moderate, `400` for active, `600`
   for extra_active.
8. **Steps** = `STEP_GOAL_BY_ACTIVITY[activityLevel]`

`weightGoalKg` (if set) is **not** part of the formula — it's passed through
as extra context for the AI's `reasoning`/`insights` (e.g. "at -500kcal/day
you'd reach your 75kg goal in ~16 weeks").

### Safety bounds (`clampRecommendation`)

Applied to the AI's output before it's persisted or returned, so a bad AI
response can never produce a dangerous suggestion even though the user still
approves manually:

- `recommendedCalories`: clamp to `[max(1200, BMR), baselineCalories * 1.2]`
- `recommendedProteinG`: clamp to `[1.0, 2.5] g/kg * weightKg`
- `recommendedFatG`: clamp to `>= 0.6 g/kg * weightKg` and `<= 40%` of calories
- `recommendedCarbsG`: recomputed as remainder after clamped protein/fat (never negative)
- `recommendedWaterMl`: clamp to `[1500, 6000]`
- `recommendedStepsGoal`: clamp to `[3000, 20000]`
- `recommendedActivityLevel`: must be one of the 5 valid values or `null`

Any field that gets clamped is noted in `dataQualityNote`.

---

## 3. AI Recommendation Route — `app/api/nutrition-goals/recommend/route.ts`

`POST`, body `{ source: 'on_demand' | 'scheduled' }`. Auth required. Rate
limited per-user (same pattern/limits as `/api/morning-briefing`).

1. Load profile: `heightCm`, `dateOfBirth`, `sex`, `activityLevel`,
   `fitnessGoal`, `weightGoalKg`, `timezone`.
2. If `heightCm`, `dateOfBirth`, `sex`, `activityLevel`, or `fitnessGoal` is
   missing → `400 { error: 'profile_incomplete', missing: [...] }`.
3. Load latest weight from `body_metrics`. If none ever logged →
   `400 { error: 'no_weight_data' }`.
4. Load a 14-day window: `listBodyMetrics` (weight, steps, restingHeartRate,
   hrvMs), `listSleepSessions`, `listMoodLogs` (new), `getWorkoutSessionsFrom`,
   `listRecentPersonalRecords` (new). Load current `getUserGoals` +
   `getNutritionTargets` for diffing.
5. `calculateBaseline(...)`.
6. Build a context string for Gemini: profile stats, baseline numbers +
   what formula produced them, current goals/targets, 14-day trends (weight
   delta, avg steps, avg RHR/HRV if present, workout session count, paired
   sleep-duration/mood-energy data points, PRs achieved), and how many of the
   14 days actually have logged data (data-completeness signal).
7. `generateObject` (Gemini 3.1 Flash Lite) with a Zod response schema:
   `recommendedStepsGoal, recommendedCalories, recommendedProteinG,
   recommendedCarbsG, recommendedFatG, recommendedWaterMl,
   recommendedActivityLevel (nullable enum), reasoning, insights,
   dataQualityNote`.

   Prompt instructions:
   - Stay close to the baseline; only deviate meaningfully when trend data
     justifies it, and explain why in `reasoning`.
   - Only suggest a different `recommendedActivityLevel` if logged workout
     frequency clearly doesn't match the current selection (e.g. ≥4
     sessions/week while set to `sedentary`/`light`). If suggesting a change,
     base all other numbers on the **new** activity level's TDEE.
   - `insights`: look for sleep-duration vs mood/energy patterns and mention
     PRs achieved in the window. If there's too little data (e.g. <3 days
     logged), say so explicitly instead of guessing.
8. `clampRecommendation(...)` the AI output against the safety bounds. If
   `recommendedActivityLevel` is present and differs from the current value,
   bounds for calories/protein/fat/water/steps are computed against a second
   `calculateBaseline(...)` call using that new activity level (not the
   user's current one), so a legitimate higher-activity recommendation isn't
   clamped against the old, lower baseline.
9. Insert a `goal_recommendations` row (`status: 'pending'`).
10. Return `{ id, current: {...}, recommended: {...}, reasoning, insights,
    dataQualityNote }`.

---

## 4. Repository Additions

`lib/data/repository.ts` + `lib/data/postgres/adapter.ts`:

- `listMoodLogs(userId, from, to): Promise<MoodLog[]>` — range query on
  `mood_logs.log_date`, same shape as `listSleepSessions`.
- `listRecentPersonalRecords(userId, from, to): Promise<{ exerciseName, estimated1rm, achievedAt }[]>`
  — range query on `personal_records.achieved_at`.
- Extend the existing user profile read/update methods to cover
  `activityLevel`, `fitnessGoal`, `lastGoalReviewAt`.
- `createGoalRecommendation(userId, data)`, `getGoalRecommendation(userId, id)`,
  `updateGoalRecommendationStatus(userId, id, status: 'applied' | 'dismissed')`.
- `touchLastGoalReviewAt(userId)` — sets `users.last_goal_review_at = now()`.

---

## 5. UI

### Profile — "Activity & Goals" section

New component `components/profile/activity-goals-section.tsx` (keeps
`edit-profile-sheet.tsx` from growing further):

- Activity level picker (5 options, short description each).
- Fitness goal picker (4 options, including "Lose fat & build muscle (recomp)").
- "Get AI Recommendation" button — disabled (with hint) until activity level,
  fitness goal, height, DOB, and sex are all set.
- On click: `POST /api/nutrition-goals/recommend` with `source: 'on_demand'`,
  opens the review sheet on success; surfaces `profile_incomplete` /
  `no_weight_data` errors inline with guidance on what to fill in first.

### Review sheet — `components/profile/goal-recommendation-sheet.tsx`

Modeled on the generate-program review pattern (`builder-review.tsx`):

- `dataQualityNote` shown at the top if present.
- One row per metric (Steps goal, Calories, Protein, Carbs, Fat, Water),
  each showing current vs. suggested value with a checkbox (default checked).
- An extra "Activity level: X → Y" row, shown only when
  `recommendedActivityLevel` differs from the current value.
- `reasoning` block (why these numbers).
- `insights` block (sleep/mood/PR observations), only rendered when non-empty.
- All AI-recommended values (steps, calories, water) are **daily** figures.
  For display and apply, any metric whose `*GoalType` (`stepsGoalType`,
  `calorieGoalType`, `waterGoalType`) is currently `'weekly'` is multiplied
  by 7 — both the "current" and "suggested" values shown in that row use the
  same unit, and the goal type itself is left unchanged.
- **Apply Selected**: for each checked row, write to `/api/user/goals`
  (steps/calorie/water goal fields, in the unit determined above) and/or
  `/api/nutrition/targets` (protein/carbs/fat/calories) and/or the profile's
  `activityLevel`. Then `updateGoalRecommendationStatus(..., 'applied')` and
  `touchLastGoalReviewAt`.
- **Dismiss**: `updateGoalRecommendationStatus(..., 'dismissed')` and
  `touchLastGoalReviewAt`. No values changed.

### Scheduled pop-up — home screen (session-select)

- On load, if `activityLevel` and `fitnessGoal` are both set, and
  `lastGoalReviewAt` is `null` or more than 14 days ago, show a dismissible
  card: "Time for a goals check-in".
- **Review now** → `POST /api/nutrition-goals/recommend` with
  `source: 'scheduled'`, opens the same review sheet.
- **Remind me later** → `touchLastGoalReviewAt` only (no AI call), dismiss card.

### TDEE calc update — `app/health/health-content.tsx`

Replace the hardcoded `1.4` multiplier:

```ts
const tdee = Math.round(bmr * (ACTIVITY_MULTIPLIERS[user.activityLevel] ?? 1.4))
```

importing `ACTIVITY_MULTIPLIERS` from `lib/nutrition/goal-recommendation.ts`
(fallback `1.4` preserves current behaviour for users who haven't set
`activityLevel` yet).

---

## 6. Cache Invalidation

New group in `lib/cache-groups.ts`, `invalidateGoalRecommendations()`:
invalidates `'nutrition-targets'`, `'body-metadata'` (TDEE display depends on
weight + activity level), and the cache key(s) covering steps/water goals.
Called after applying a recommendation and after editing activity
level/fitness goal directly in Profile.

---

## 7. Edge Cases & Safety

- **Missing profile fields** → `400 profile_incomplete`; Profile UI shows
  which fields are missing and links into the relevant inputs.
- **No weight ever logged** → `400 no_weight_data`; UI prompts to log a body
  weight entry first.
- **Sparse trend data** (new user, <3 days logged in the 14-day window) →
  `dataQualityNote` states the recommendation is baseline-only; `insights`
  explicitly says there isn't enough data yet rather than fabricating a trend.
- **AI returns out-of-bounds numbers** → clamped server-side per §2; any
  clamped field is mentioned in `dataQualityNote`.
- **Rate limiting** — per-user limit on the recommend route (reuses
  `lib/rate-limit.ts`), bounding repeated on-demand AI calls.
- **Partial application** — only checked rows are written; the
  `goal_recommendations` row still moves to `status: 'applied'` and retains
  the full original suggestion regardless of which subset was applied.
