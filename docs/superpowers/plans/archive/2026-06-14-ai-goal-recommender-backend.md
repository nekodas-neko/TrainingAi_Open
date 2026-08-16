> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# AI Nutrition & Activity Goal Recommender — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data model, pure calculation engine, repository methods, cache
invalidation group, and AI recommendation route for the AI Nutrition & Activity Goal
Recommender, per `docs/superpowers/specs/2026-06-14-ai-goal-recommender-design.md`.

**Architecture:** Migration 068 adds `users.activity_level` / `users.fitness_goal` /
`users.last_goal_review_at` plus a new `goal_recommendations` history table. A pure,
fully-tested calculation module (`lib/nutrition/goal-recommendation.ts`) computes a
deterministic baseline (Mifflin-St Jeor TDEE → calories/macros/water/steps) and clamps
AI output to safety bounds. New repository methods expose mood logs, recent PRs, profile
fields, and `goal_recommendations` CRUD. `POST /api/nutrition-goals/recommend` gathers a
14-day trend window, calls Gemini via `generateObject` + a Zod schema, clamps the result,
and persists it as `status: 'pending'`. Two small routes let the UI move a recommendation
to `applied`/`dismissed` or just bump `last_goal_review_at` ("remind me later").

**Tech Stack:** Next.js 15 API routes, Drizzle ORM / PostgreSQL, `@ai-sdk/google` +
`ai`'s `generateObject` (new pattern — first use of structured output in this codebase),
Zod v4, Vitest for pure-function unit tests.

---

### Task 1: Migration 068 + Drizzle schema

**Files:**
- Create: `lib/data/postgres/migrations/068_goal_recommendations.sql`
- Modify: `lib/data/postgres/schema.ts`

- [ ] **Step 1: Write the migration SQL**

```sql
-- AI Nutrition & Activity Goal Recommender — adds the profile fields that drive the
-- deterministic baseline calculation (lib/nutrition/goal-recommendation.ts) and the
-- goal_recommendations history table that records every AI suggestion (applied or
-- dismissed) for the Profile "Activity & Goals" review flow.

ALTER TABLE users ADD COLUMN IF NOT EXISTS activity_level TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fitness_goal TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_goal_review_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS goal_recommendations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source                      TEXT NOT NULL,
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
  status                      TEXT NOT NULL DEFAULT 'pending',
  applied_at                  TIMESTAMPTZ,
  dismissed_at                TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_goal_recommendations_user ON goal_recommendations(user_id, created_at DESC);
```

- [ ] **Step 2: Add the new `users` columns to the Drizzle schema**

In `lib/data/postgres/schema.ts`, the `users` table ends with `friendCode`/`equippedTitle`
(around line 32-33). Add three new fields right after `equippedTitle`:

```ts
export const users = pgTable('users', {
  // ... existing columns unchanged ...
  friendCode:       text('friend_code').unique(),
  equippedTitle:    text('equipped_title'),
  activityLevel:    text('activity_level'),
  fitnessGoal:      text('fitness_goal'),
  lastGoalReviewAt: timestamp('last_goal_review_at', { withTimezone: true }),
})
```

- [ ] **Step 3: Add the `goalRecommendations` table to the Drizzle schema**

Add a new table definition after `personalRecords` (around line 268) in
`lib/data/postgres/schema.ts`:

```ts
export const goalRecommendations = pgTable('goal_recommendations', {
  id:                       uuid('id').primaryKey().defaultRandom(),
  userId:                   uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt:                timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  source:                   text('source').notNull(),
  recommendedStepsGoal:     integer('recommended_steps_goal'),
  recommendedCalories:      integer('recommended_calories'),
  recommendedProteinG:      doublePrecision('recommended_protein_g'),
  recommendedCarbsG:        doublePrecision('recommended_carbs_g'),
  recommendedFatG:          doublePrecision('recommended_fat_g'),
  recommendedWaterMl:       integer('recommended_water_ml'),
  recommendedActivityLevel: text('recommended_activity_level'),
  reasoning:                text('reasoning'),
  insights:                 text('insights'),
  dataQualityNote:          text('data_quality_note'),
  status:                   text('status').notNull().default('pending'),
  appliedAt:                timestamp('applied_at', { withTimezone: true }),
  dismissedAt:              timestamp('dismissed_at', { withTimezone: true }),
})
```

All column helpers used (`text`, `integer`, `doublePrecision`, `timestamp`, `uuid`) are
already imported at the top of `schema.ts` — no import changes needed.

- [ ] **Step 4: Apply the migration to the local dev DB**

Run: `pnpm db:local`

Expected: script reports migrations applied, including `068_goal_recommendations.sql`,
with no errors. Verify with:

```bash
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d trainingai_dev -c "\d goal_recommendations"
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d trainingai_dev -c "\d users" | grep -E "activity_level|fitness_goal|last_goal_review"
```

Expected: `goal_recommendations` table listed with all columns from Step 1, and the three
new `users` columns present.

All three new `users` columns are nullable with no default, so every existing user gets
`activity_level = NULL`, `fitness_goal = NULL`, `last_goal_review_at = NULL` — no
backfill needed. This is intentional: the Profile "Activity & Goals" section (UI plan
Task 2/3) shows a "Complete your profile first" hint listing these as missing fields
until the user picks them, and the scheduled check-in card (UI plan Task 4) simply never
appears for a user until both are set.

- [ ] **Step 5: Commit**

```bash
git add lib/data/postgres/migrations/068_goal_recommendations.sql lib/data/postgres/schema.ts
git commit -m "Add goal_recommendations table and activity/fitness profile columns"
```

---

### Task 2: Shared types

**Files:**
- Modify: `lib/types/user.ts`
- Create: `lib/types/goal-recommendation.ts`
- Modify: `lib/types/index.ts`

- [ ] **Step 1: Add `ActivityLevel`/`FitnessGoal` enums and new `User` fields**

In `lib/types/user.ts`, add the two enum const arrays + types above the `User`
interface, and three new optional fields at the end of `User`:

```ts
export const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'active', 'extra_active'] as const
export type ActivityLevel = typeof ACTIVITY_LEVELS[number]

export const FITNESS_GOALS = ['lose_weight', 'maintain', 'build_muscle', 'recomp'] as const
export type FitnessGoal = typeof FITNESS_GOALS[number]

export interface User {
  id: string
  oauthSub?: string   // null for email/password accounts
  email: string
  name?: string
  isActive: boolean
  isAdmin: boolean
  createdAt: Date
  displayName?: string
  heightCm?: number
  dateOfBirth?: string   // 'YYYY-MM-DD'
  weightGoalKg?: number
  avatar?: string        // base64 data URL
  timezone: string       // IANA timezone, e.g. 'Australia/Brisbane'
  sex?: string | null    // 'male' | 'female' | 'other' | null
  friendCode?: string | null
  equippedTitle?: string | null
  activityLevel?: ActivityLevel | null
  fitnessGoal?: FitnessGoal | null
  lastGoalReviewAt?: Date | null
}
```

- [ ] **Step 2: Create `lib/types/goal-recommendation.ts`**

```ts
import type { ActivityLevel } from './user'

export const GOAL_RECOMMENDATION_SOURCES = ['on_demand', 'scheduled'] as const
export type GoalRecommendationSource = typeof GOAL_RECOMMENDATION_SOURCES[number]

export const GOAL_RECOMMENDATION_STATUSES = ['pending', 'applied', 'dismissed'] as const
export type GoalRecommendationStatus = typeof GOAL_RECOMMENDATION_STATUSES[number]

export interface GoalRecommendation {
  id: string
  userId: string
  createdAt: Date
  source: GoalRecommendationSource
  recommendedStepsGoal?: number
  recommendedCalories?: number
  recommendedProteinG?: number
  recommendedCarbsG?: number
  recommendedFatG?: number
  recommendedWaterMl?: number
  recommendedActivityLevel?: ActivityLevel | null
  reasoning?: string
  insights?: string
  dataQualityNote?: string
  status: GoalRecommendationStatus
  appliedAt?: Date
  dismissedAt?: Date
}
```

- [ ] **Step 3: Export the new module from `lib/types/index.ts`**

```ts
export * from './user'
export * from './progression'
export * from './program'
export * from './log'
export * from './body'
export * from './mood'
export * from './goal-recommendation'
```

- [ ] **Step 4: Typecheck**

Run: `pnpm tsc --noEmit`

Expected: no new errors (the `User` additions are all optional, so nothing currently
constructing a `User` breaks).

- [ ] **Step 5: Commit**

```bash
git add lib/types/user.ts lib/types/goal-recommendation.ts lib/types/index.ts
git commit -m "Add ActivityLevel/FitnessGoal enums and GoalRecommendation type"
```

---

### Task 3: Calculation engine — `calculateBaseline`

**Files:**
- Create: `lib/nutrition/goal-recommendation.ts`
- Test: `lib/nutrition/__tests__/goal-recommendation.test.ts`

- [ ] **Step 1: Write the failing tests for `calculateBaseline`**

```ts
import { describe, it, expect } from 'vitest'
import { calculateBaseline, ACTIVITY_MULTIPLIERS } from '../goal-recommendation'

describe('ACTIVITY_MULTIPLIERS', () => {
  it('has all five activity levels', () => {
    expect(ACTIVITY_MULTIPLIERS).toEqual({
      sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, extra_active: 1.9,
    })
  })
})

describe('calculateBaseline', () => {
  it('computes baseline for a male maintaining weight at moderate activity', () => {
    const result = calculateBaseline({
      weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
      activityLevel: 'moderate', fitnessGoal: 'maintain',
    })
    expect(result).toEqual({
      bmr: 1780, tdee: 2759, calories: 2759,
      proteinG: 128, carbsG: 389, fatG: 77,
      waterMl: 2890, stepsGoal: 10000,
    })
  })

  it('applies the lose_weight calorie deficit and higher protein target', () => {
    const result = calculateBaseline({
      weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
      activityLevel: 'moderate', fitnessGoal: 'lose_weight',
    })
    expect(result.calories).toBe(2259)
    expect(result.proteinG).toBe(144)
    expect(result.fatG).toBe(63)
    expect(result.carbsG).toBe(279)
  })

  it('applies the build_muscle calorie surplus and protein target', () => {
    const result = calculateBaseline({
      weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
      activityLevel: 'moderate', fitnessGoal: 'build_muscle',
    })
    expect(result.calories).toBe(3059)
    expect(result.proteinG).toBe(160)
    expect(result.fatG).toBe(85)
    expect(result.carbsG).toBe(414)
  })

  it('applies the recomp deficit with the highest protein target', () => {
    const result = calculateBaseline({
      weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
      activityLevel: 'moderate', fitnessGoal: 'recomp',
    })
    expect(result.calories).toBe(2559)
    expect(result.proteinG).toBe(176)
    expect(result.fatG).toBe(71)
    expect(result.carbsG).toBe(304)
  })

  it('computes baseline for a female at light activity (no water bump)', () => {
    const result = calculateBaseline({
      weightKg: 65, heightCm: 165, ageYears: 28, sex: 'female',
      activityLevel: 'light', fitnessGoal: 'maintain',
    })
    expect(result).toEqual({
      bmr: 1380, tdee: 1898, calories: 1898,
      proteinG: 104, carbsG: 251, fatG: 53,
      waterMl: 2145, stepsGoal: 8500,
    })
  })

  it('computes baseline for sex "other" at sedentary activity', () => {
    const result = calculateBaseline({
      weightKg: 70, heightCm: 170, ageYears: 25, sex: 'other',
      activityLevel: 'sedentary', fitnessGoal: 'maintain',
    })
    expect(result).toEqual({
      bmr: 1560, tdee: 1872, calories: 1872,
      proteinG: 112, carbsG: 239, fatG: 52,
      waterMl: 2310, stepsGoal: 7000,
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run lib/nutrition/__tests__/goal-recommendation.test.ts`

Expected: FAIL — `lib/nutrition/goal-recommendation.ts` does not exist / has no export
named `calculateBaseline`.

- [ ] **Step 3: Implement `calculateBaseline`**

Create `lib/nutrition/goal-recommendation.ts`:

```ts
import type { ActivityLevel, FitnessGoal } from '@/lib/types/user'

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, extra_active: 1.9,
}

const STEP_GOAL_BY_ACTIVITY: Record<ActivityLevel, number> = {
  sedentary: 7000, light: 8500, moderate: 10000, active: 12000, extra_active: 12000,
}

const WATER_BUMP_BY_ACTIVITY: Record<ActivityLevel, number> = {
  sedentary: 0, light: 0, moderate: 250, active: 400, extra_active: 600,
}

const CALORIE_ADJUSTMENT_BY_GOAL: Record<FitnessGoal, number> = {
  lose_weight: -500, maintain: 0, build_muscle: 300, recomp: -200,
}

const PROTEIN_G_PER_KG_BY_GOAL: Record<FitnessGoal, number> = {
  lose_weight: 1.8, maintain: 1.6, build_muscle: 2.0, recomp: 2.2,
}

const SEX_OFFSET: Record<string, number> = { male: 5, female: -161, other: -78 }

export interface BaselineInput {
  weightKg: number
  heightCm: number
  ageYears: number
  sex: string
  activityLevel: ActivityLevel
  fitnessGoal: FitnessGoal
}

export interface BaselineResult {
  bmr: number
  tdee: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  waterMl: number
  stepsGoal: number
}

export function calculateBaseline(input: BaselineInput): BaselineResult {
  const sexOffset = SEX_OFFSET[input.sex] ?? SEX_OFFSET.other
  const bmr = Math.round(10 * input.weightKg + 6.25 * input.heightCm - 5 * input.ageYears + sexOffset)
  const tdee = Math.round(bmr * ACTIVITY_MULTIPLIERS[input.activityLevel])
  const calories = tdee + CALORIE_ADJUSTMENT_BY_GOAL[input.fitnessGoal]
  const proteinG = Math.round(input.weightKg * PROTEIN_G_PER_KG_BY_GOAL[input.fitnessGoal])
  const fatG = Math.round(calories * 0.25 / 9)
  const carbsG = Math.round(Math.max(0, calories - proteinG * 4 - fatG * 9) / 4)
  const waterMl = Math.round(input.weightKg * 33) + WATER_BUMP_BY_ACTIVITY[input.activityLevel]
  const stepsGoal = STEP_GOAL_BY_ACTIVITY[input.activityLevel]
  return { bmr, tdee, calories, proteinG, carbsG, fatG, waterMl, stepsGoal }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run lib/nutrition/__tests__/goal-recommendation.test.ts`

Expected: PASS — all 6 `calculateBaseline`/`ACTIVITY_MULTIPLIERS` tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/nutrition/goal-recommendation.ts lib/nutrition/__tests__/goal-recommendation.test.ts
git commit -m "Add calculateBaseline TDEE/macro/water/step calculation"
```

---

### Task 4: Calculation engine — `clampRecommendation`

**Files:**
- Modify: `lib/nutrition/goal-recommendation.ts`
- Modify: `lib/nutrition/__tests__/goal-recommendation.test.ts`

This task adds safety-bound clamping for AI output, per spec §2. The baseline used for
all 14 cases below is `{ bmr: 1600, tdee: 2000, calories: 1800, proteinG: 130, carbsG:
180, fatG: 50, waterMl: 2500, stepsGoal: 10000 }` with `weightKg: 80`, giving bounds:
calories `[1600, 2160]`, protein `[80, 200]`, water `[1500, 6000]`, steps `[3000,
20000]`, fat `>= 48` and `<= floor(calories * 0.4 / 9)`.

- [ ] **Step 1: Write the failing tests for `clampRecommendation`**

Append to `lib/nutrition/__tests__/goal-recommendation.test.ts`:

```ts
import { clampRecommendation, type RawRecommendation, type BaselineResult } from '../goal-recommendation'

describe('clampRecommendation', () => {
  const baseline: BaselineResult = {
    bmr: 1600, tdee: 2000, calories: 1800,
    proteinG: 130, carbsG: 180, fatG: 50,
    waterMl: 2500, stepsGoal: 10000,
  }
  const weightKg = 80

  function raw(overrides: Partial<RawRecommendation> = {}): RawRecommendation {
    return {
      recommendedStepsGoal: 10000,
      recommendedCalories: 1900,
      recommendedProteinG: 140,
      recommendedCarbsG: 999, // always recomputed — value here should be ignored
      recommendedFatG: 60,
      recommendedWaterMl: 2500,
      recommendedActivityLevel: null,
      dataQualityNote: '',
      ...overrides,
    }
  }

  it('passes through a fully valid recommendation, recomputing carbs', () => {
    const result = clampRecommendation(raw({ dataQualityNote: 'Looks good' }), baseline, weightKg)
    expect(result).toEqual({
      recommendedStepsGoal: 10000,
      recommendedCalories: 1900,
      recommendedProteinG: 140,
      recommendedCarbsG: 200,
      recommendedFatG: 60,
      recommendedWaterMl: 2500,
      recommendedActivityLevel: null,
      dataQualityNote: 'Looks good',
    })
  })

  it('clamps calories below the minimum', () => {
    const result = clampRecommendation(raw({ recommendedCalories: 1400 }), baseline, weightKg)
    expect(result.recommendedCalories).toBe(1600)
    expect(result.recommendedCarbsG).toBe(158)
    expect(result.dataQualityNote).toBe('Calories adjusted to safe minimum (1600).')
  })

  it('clamps calories above the maximum', () => {
    const result = clampRecommendation(raw({ recommendedCalories: 2400, recommendedFatG: 80 }), baseline, weightKg)
    expect(result.recommendedCalories).toBe(2160)
    expect(result.recommendedFatG).toBe(80)
    expect(result.recommendedCarbsG).toBe(230)
    expect(result.dataQualityNote).toBe('Calories adjusted to safe maximum (2160).')
  })

  it('clamps protein below the minimum', () => {
    const result = clampRecommendation(raw({ recommendedProteinG: 50 }), baseline, weightKg)
    expect(result.recommendedProteinG).toBe(80)
    expect(result.recommendedCarbsG).toBe(260)
    expect(result.dataQualityNote).toBe('Protein adjusted to minimum (80g).')
  })

  it('clamps protein above the maximum', () => {
    const result = clampRecommendation(raw({ recommendedProteinG: 250 }), baseline, weightKg)
    expect(result.recommendedProteinG).toBe(200)
    expect(result.recommendedCarbsG).toBe(140)
    expect(result.dataQualityNote).toBe('Protein adjusted to maximum (200g).')
  })

  it('clamps fat below the minimum', () => {
    const result = clampRecommendation(raw({ recommendedFatG: 30 }), baseline, weightKg)
    expect(result.recommendedFatG).toBe(48)
    expect(result.recommendedCarbsG).toBe(227)
    expect(result.dataQualityNote).toBe('Fat adjusted to minimum (48g).')
  })

  it('clamps fat above the maximum', () => {
    const result = clampRecommendation(raw({ recommendedFatG: 120 }), baseline, weightKg)
    expect(result.recommendedFatG).toBe(84)
    expect(result.recommendedCarbsG).toBe(146)
    expect(result.dataQualityNote).toBe('Fat adjusted to maximum (84g).')
  })

  it('caps the weight-based fat minimum at the calorie-derived maximum for heavy/low-calorie cases', () => {
    // weightKg=150 -> naive fatMin = round(0.6*150) = 90, but calories=1877 -> fatMax = floor(1877*0.4/9) = 83.
    // Without capping fatMin at fatMax, fatG would be pushed to 90g (43% of calories), violating the <=40% bound.
    const tightBaseline: BaselineResult = {
      bmr: 1877, tdee: 1877, calories: 1877,
      proteinG: 150, carbsG: 150, fatG: 60,
      waterMl: 2500, stepsGoal: 10000,
    }
    const result = clampRecommendation(raw({ recommendedCalories: 1877, recommendedProteinG: 150, recommendedFatG: 60 }), tightBaseline, 150)
    expect(result.recommendedFatG).toBe(83)
    expect(result.recommendedCarbsG).toBe(133)
    expect(result.dataQualityNote).toBe('Fat adjusted to minimum (83g).')
  })

  it('clamps water below the minimum', () => {
    const result = clampRecommendation(raw({ recommendedWaterMl: 1000 }), baseline, weightKg)
    expect(result.recommendedWaterMl).toBe(1500)
    expect(result.dataQualityNote).toBe('Water adjusted to minimum (1500ml).')
  })

  it('clamps water above the maximum', () => {
    const result = clampRecommendation(raw({ recommendedWaterMl: 7000 }), baseline, weightKg)
    expect(result.recommendedWaterMl).toBe(6000)
    expect(result.dataQualityNote).toBe('Water adjusted to maximum (6000ml).')
  })

  it('clamps steps goal below the minimum', () => {
    const result = clampRecommendation(raw({ recommendedStepsGoal: 2000 }), baseline, weightKg)
    expect(result.recommendedStepsGoal).toBe(3000)
    expect(result.dataQualityNote).toBe('Steps goal adjusted to minimum (3000).')
  })

  it('clamps steps goal above the maximum', () => {
    const result = clampRecommendation(raw({ recommendedStepsGoal: 25000 }), baseline, weightKg)
    expect(result.recommendedStepsGoal).toBe(20000)
    expect(result.dataQualityNote).toBe('Steps goal adjusted to maximum (20000).')
  })

  it('passes through a valid recommended activity level', () => {
    const result = clampRecommendation(raw({ recommendedActivityLevel: 'active' }), baseline, weightKg)
    expect(result.recommendedActivityLevel).toBe('active')
    expect(result.dataQualityNote).toBe('')
  })

  it('discards an invalid recommended activity level', () => {
    const result = clampRecommendation(raw({ recommendedActivityLevel: 'super_active' }), baseline, weightKg)
    expect(result.recommendedActivityLevel).toBeNull()
    expect(result.dataQualityNote).toBe('Suggested activity level was invalid and has been ignored.')
  })

  it('combines multiple clamp notes with the AI note', () => {
    const result = clampRecommendation(raw({
      recommendedCalories: 2500, recommendedProteinG: 250, recommendedFatG: 60,
      dataQualityNote: 'Based on baseline.',
    }), baseline, weightKg)
    expect(result.recommendedCalories).toBe(2160)
    expect(result.recommendedProteinG).toBe(200)
    expect(result.recommendedFatG).toBe(60)
    expect(result.recommendedCarbsG).toBe(205)
    expect(result.dataQualityNote).toBe(
      'Based on baseline. Calories adjusted to safe maximum (2160). Protein adjusted to maximum (200g).'
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run lib/nutrition/__tests__/goal-recommendation.test.ts`

Expected: the new `clampRecommendation` tests FAIL — no export named `clampRecommendation`
(the `calculateBaseline` tests from Task 3 still pass).

- [ ] **Step 3: Implement `clampRecommendation`**

Append to `lib/nutrition/goal-recommendation.ts`:

```ts
import { ACTIVITY_LEVELS } from '@/lib/types/user'

export interface RawRecommendation {
  recommendedStepsGoal: number
  recommendedCalories: number
  recommendedProteinG: number
  recommendedCarbsG: number
  recommendedFatG: number
  recommendedWaterMl: number
  recommendedActivityLevel: string | null
  dataQualityNote: string
}

export interface ClampedRecommendation {
  recommendedStepsGoal: number
  recommendedCalories: number
  recommendedProteinG: number
  recommendedCarbsG: number
  recommendedFatG: number
  recommendedWaterMl: number
  recommendedActivityLevel: ActivityLevel | null
  dataQualityNote: string
}

export function clampRecommendation(
  ai: RawRecommendation,
  baseline: BaselineResult,
  weightKg: number,
): ClampedRecommendation {
  const notes: string[] = []

  const calorieMin = Math.max(1200, baseline.bmr)
  const calorieMax = Math.round(baseline.calories * 1.2)
  let calories = ai.recommendedCalories
  if (calories < calorieMin) {
    calories = calorieMin
    notes.push(`Calories adjusted to safe minimum (${calorieMin}).`)
  } else if (calories > calorieMax) {
    calories = calorieMax
    notes.push(`Calories adjusted to safe maximum (${calorieMax}).`)
  }

  const proteinMin = Math.round(1.0 * weightKg)
  const proteinMax = Math.round(2.5 * weightKg)
  let proteinG = ai.recommendedProteinG
  if (proteinG < proteinMin) {
    proteinG = proteinMin
    notes.push(`Protein adjusted to minimum (${proteinMin}g).`)
  } else if (proteinG > proteinMax) {
    proteinG = proteinMax
    notes.push(`Protein adjusted to maximum (${proteinMax}g).`)
  }

  const fatMax = Math.floor(calories * 0.4 / 9)
  // For very heavy + short + older users, the weight-based floor can exceed the
  // calorie-derived ceiling — cap it so fatMin never exceeds fatMax.
  const fatMin = Math.min(Math.round(0.6 * weightKg), fatMax)
  let fatG = ai.recommendedFatG
  if (fatG < fatMin) {
    fatG = fatMin
    notes.push(`Fat adjusted to minimum (${fatMin}g).`)
  } else if (fatG > fatMax) {
    fatG = fatMax
    notes.push(`Fat adjusted to maximum (${fatMax}g).`)
  }

  const carbsG = Math.round(Math.max(0, calories - proteinG * 4 - fatG * 9) / 4)

  let waterMl = ai.recommendedWaterMl
  if (waterMl < 1500) {
    waterMl = 1500
    notes.push('Water adjusted to minimum (1500ml).')
  } else if (waterMl > 6000) {
    waterMl = 6000
    notes.push('Water adjusted to maximum (6000ml).')
  }

  let stepsGoal = ai.recommendedStepsGoal
  if (stepsGoal < 3000) {
    stepsGoal = 3000
    notes.push('Steps goal adjusted to minimum (3000).')
  } else if (stepsGoal > 20000) {
    stepsGoal = 20000
    notes.push('Steps goal adjusted to maximum (20000).')
  }

  let activityLevel: ActivityLevel | null = null
  if (ai.recommendedActivityLevel != null) {
    if ((ACTIVITY_LEVELS as readonly string[]).includes(ai.recommendedActivityLevel)) {
      activityLevel = ai.recommendedActivityLevel as ActivityLevel
    } else {
      notes.push('Suggested activity level was invalid and has been ignored.')
    }
  }

  const dataQualityNote = [ai.dataQualityNote, ...notes].filter(n => n.length > 0).join(' ')

  return {
    recommendedStepsGoal: stepsGoal,
    recommendedCalories: calories,
    recommendedProteinG: proteinG,
    recommendedCarbsG: carbsG,
    recommendedFatG: fatG,
    recommendedWaterMl: waterMl,
    recommendedActivityLevel: activityLevel,
    dataQualityNote,
  }
}
```

Also update the top-level import in `lib/nutrition/goal-recommendation.ts` to pull in
`ACTIVITY_LEVELS` alongside the existing type-only import:

```ts
import { ACTIVITY_LEVELS, type ActivityLevel, type FitnessGoal } from '@/lib/types/user'
```

(remove the separate `import { ACTIVITY_LEVELS } from '@/lib/types/user'` added above —
combine into the single import at the top of the file).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run lib/nutrition/__tests__/goal-recommendation.test.ts`

Expected: PASS — all `calculateBaseline` and `clampRecommendation` tests green (21
tests total).

- [ ] **Step 5: Commit**

```bash
git add lib/nutrition/goal-recommendation.ts lib/nutrition/__tests__/goal-recommendation.test.ts
git commit -m "Add clampRecommendation safety-bound clamping for AI goal output"
```

---

### Task 5: Repository — profile fields (activityLevel/fitnessGoal/lastGoalReviewAt)

**Files:**
- Modify: `lib/data/repository.ts`
- Modify: `lib/data/postgres/adapter.ts`
- Modify: `app/api/user/profile/route.ts`

- [ ] **Step 1: Extend the `updateUserProfile` interface and add `touchLastGoalReviewAt`**

In `lib/data/repository.ts`, change line 48 from:

```ts
  updateUserProfile(userId: string, profile: Partial<Pick<User, 'displayName' | 'heightCm' | 'dateOfBirth' | 'weightGoalKg' | 'timezone' | 'sex'>>): Promise<User>
```

to:

```ts
  updateUserProfile(userId: string, profile: Partial<Pick<User, 'displayName' | 'heightCm' | 'dateOfBirth' | 'weightGoalKg' | 'timezone' | 'sex' | 'activityLevel' | 'fitnessGoal'>>): Promise<User>
  touchLastGoalReviewAt(userId: string): Promise<void>
```

- [ ] **Step 2: Update `rowToUser` and `updateUserProfile` in the adapter**

In `lib/data/postgres/adapter.ts`, add `ActivityLevel` and `FitnessGoal` to the existing
type-only import from `@/lib/types` (line 7-12):

```ts
import type {
  User, Program, ProgramSession, SessionExercise, Schedule, ScheduleDay,
  ProgressionStyle, StyleSet,
  WorkoutSession, ExerciseLog, SetLog,
  BodyMetrics, ActivityLog, ActivityType, SleepSession, NextSessionRecommendation,
  ActivityLevel, FitnessGoal, MoodLog,
} from '@/lib/types'
```

(`MoodLog` is added here too, in preparation for Task 6.)

In `rowToUser` (around line 26-45), add three fields after `equippedTitle`:

```ts
  private rowToUser(r: typeof s.users.$inferSelect): User {
    return {
      id: r.id,
      oauthSub: r.oauthSub ?? undefined,
      email: r.email,
      name: r.name ?? undefined,
      isActive: r.isActive,
      isAdmin: r.isAdmin,
      createdAt: r.createdAt,
      displayName: r.displayName ?? undefined,
      heightCm: r.heightCm ?? undefined,
      dateOfBirth: r.dateOfBirth ?? undefined,
      weightGoalKg: r.weightGoalKg ?? undefined,
      avatar: r.avatar ?? undefined,
      timezone: r.timezone ?? DEFAULT_TZ,
      sex: r.sex ?? undefined,
      friendCode: r.friendCode ?? null,
      equippedTitle: r.equippedTitle ?? null,
      activityLevel: (r.activityLevel as ActivityLevel | null) ?? undefined,
      fitnessGoal: (r.fitnessGoal as FitnessGoal | null) ?? undefined,
      lastGoalReviewAt: r.lastGoalReviewAt ?? undefined,
    }
  }
```

In `updateUserProfile` (around line 409-423), extend the interface signature and add the
two new conditional fields following the existing `'sex' in profile` pattern:

```ts
  async updateUserProfile(userId: string, profile: Partial<Pick<User, 'displayName' | 'heightCm' | 'dateOfBirth' | 'weightGoalKg' | 'timezone' | 'sex' | 'activityLevel' | 'fitnessGoal'>>): Promise<User> {
    const set: Record<string, unknown> = {
      displayName: profile.displayName ?? null,
      heightCm: profile.heightCm ?? null,
      dateOfBirth: profile.dateOfBirth ?? null,
      weightGoalKg: profile.weightGoalKg ?? null,
    }
    if (profile.timezone) set.timezone = profile.timezone
    if ('sex' in profile) set.sex = profile.sex ?? null
    if ('activityLevel' in profile) set.activityLevel = profile.activityLevel ?? null
    if ('fitnessGoal' in profile) set.fitnessGoal = profile.fitnessGoal ?? null
    const [r] = await this.db.update(s.users)
      .set(set)
      .where(eq(s.users.id, userId))
      .returning()
    return this.rowToUser(r)
  }
```

- [ ] **Step 3: Implement `touchLastGoalReviewAt`**

Add a new method to the adapter, near `updateUserProfile`:

```ts
  async touchLastGoalReviewAt(userId: string): Promise<void> {
    await this.db.update(s.users).set({ lastGoalReviewAt: new Date() }).where(eq(s.users.id, userId))
  }
```

- [ ] **Step 4: Extend the `/api/user/profile` PATCH route**

In `app/api/user/profile/route.ts`, add the import and extend the destructure + the
`updateUserProfile` call:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { ACTIVITY_LEVELS, FITNESS_GOALS } from '@/lib/types/user'

// ... GET unchanged ...

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { displayName, heightCm, dateOfBirth, weightGoalKg, timezone, sex, activityLevel, fitnessGoal } = body

  const repo = await getRepository()
  const user = await repo.updateUserProfile(session.user.id, {
    displayName: displayName ?? undefined,
    heightCm: heightCm ?? undefined,
    dateOfBirth: dateOfBirth ?? undefined,
    weightGoalKg: weightGoalKg ?? undefined,
    timezone: timezone ?? undefined,
    sex: sex !== undefined ? sex : undefined,
    activityLevel: activityLevel !== undefined
      ? (ACTIVITY_LEVELS.includes(activityLevel) ? activityLevel : null)
      : undefined,
    fitnessGoal: fitnessGoal !== undefined
      ? (FITNESS_GOALS.includes(fitnessGoal) ? fitnessGoal : null)
      : undefined,
  })
  return NextResponse.json({ user })
}
```

- [ ] **Step 5: Typecheck and manually verify**

Run: `pnpm tsc --noEmit`

Expected: no errors.

Then with the dev server running (`pnpm dev`) and logged in as `test@local.dev` /
`testpass123`, verify the PATCH round-trip:

```bash
curl -s -X PATCH http://localhost:3000/api/user/profile \
  -H "Content-Type: application/json" -H "Cookie: <session-cookie>" \
  -d '{"activityLevel":"moderate","fitnessGoal":"build_muscle"}' | jq '.user.activityLevel, .user.fitnessGoal'
```

Expected: `"moderate"` and `"build_muscle"`.

- [ ] **Step 6: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts app/api/user/profile/route.ts
git commit -m "Add activityLevel/fitnessGoal/lastGoalReviewAt to user profile"
```

---

### Task 6: Repository — `listMoodLogs` and `listRecentPersonalRecords`

**Files:**
- Modify: `lib/data/repository.ts`
- Modify: `lib/data/postgres/adapter.ts`

- [ ] **Step 1: Add the two methods to the repository interface**

In `lib/data/repository.ts`, add two methods. Place `listMoodLogs` near
`listSleepSessions` (line 112) and `listRecentPersonalRecords` near
`upsertPersonalRecordIfBetter` (line 120):

```ts
  listSleepSessions(userId: string, from: string, to: string): Promise<SleepSession[]>
  listMoodLogs(userId: string, from: string, to: string): Promise<MoodLog[]>
```

```ts
  upsertPersonalRecordIfBetter(userId: string, exerciseName: string, estimated1rm: number): Promise<boolean>
  listRecentPersonalRecords(userId: string, from: Date, to: Date): Promise<{ exerciseName: string; estimated1rm: number; achievedAt: Date }[]>
```

Add `MoodLog` to the type-only import at the top of `lib/data/repository.ts`:

```ts
import type {
  User, Program, ProgressionStyle,
  WorkoutSession, ExerciseLog,
  BodyMetrics, ActivityLog, ActivityType, SleepSession, MoodLog,
  NextSessionRecommendation,
} from '@/lib/types'
```

- [ ] **Step 2: Implement `listMoodLogs` in the adapter**

In `lib/data/postgres/adapter.ts`, add this method near `listSleepSessions` (line
1938-1957), following the same date-range pattern:

```ts
  async listMoodLogs(userId: string, from: string, to: string): Promise<MoodLog[]> {
    const rows = await this.db.select().from(s.moodLogs)
      .where(and(
        eq(s.moodLogs.userId, userId),
        gte(s.moodLogs.logDate, from),
        lte(s.moodLogs.logDate, to),
      ))
      .orderBy(desc(s.moodLogs.logDate))
    return rows.map(r => ({
      id: r.id, userId: r.userId, logDate: r.logDate,
      energyLevel: r.energyLevel as import('@/lib/types/mood').EnergyLevel,
      sleepQuality: r.sleepQuality as import('@/lib/types/mood').SleepQuality,
      bodyState: (r.bodyState ?? []) as import('@/lib/types/mood').BodyState[],
      soreMuscles: r.soreMuscles ?? [],
      createdAt: r.createdAt,
    }))
  }
```

- [ ] **Step 3: Implement `listRecentPersonalRecords` in the adapter**

Add this method near `upsertPersonalRecordIfBetter` (line 2097-2113):

```ts
  // personal_records holds one row per exercise (the all-time best). This returns
  // exercises whose all-time-best estimated1rm was achieved within the window —
  // not every workout set logged in that window.
  async listRecentPersonalRecords(userId: string, from: Date, to: Date): Promise<{ exerciseName: string; estimated1rm: number; achievedAt: Date }[]> {
    return this.db
      .select({
        exerciseName: s.personalRecords.exerciseName,
        estimated1rm: s.personalRecords.estimated1rm,
        achievedAt: s.personalRecords.achievedAt,
      })
      .from(s.personalRecords)
      .where(and(
        eq(s.personalRecords.userId, userId),
        gte(s.personalRecords.achievedAt, from),
        lte(s.personalRecords.achievedAt, to),
      ))
      .orderBy(desc(s.personalRecords.achievedAt))
  }
```

- [ ] **Step 4: Typecheck**

Run: `pnpm tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "Add listMoodLogs and listRecentPersonalRecords repository methods"
```

---

### Task 7: Repository — `goal_recommendations` CRUD

**Files:**
- Modify: `lib/data/repository.ts`
- Modify: `lib/data/postgres/adapter.ts`

- [ ] **Step 1: Add the CRUD methods to the repository interface**

In `lib/data/repository.ts`, add a new section near the end of the interface (after the
nutrition methods, around line 178):

```ts
  // ── Goal Recommendations ───────────────────────────────────────────────────
  createGoalRecommendation(userId: string, data: Omit<GoalRecommendation, 'id' | 'userId' | 'createdAt' | 'status' | 'appliedAt' | 'dismissedAt'>): Promise<GoalRecommendation>
  getGoalRecommendation(userId: string, id: string): Promise<GoalRecommendation | null>
  updateGoalRecommendationStatus(userId: string, id: string, status: 'applied' | 'dismissed'): Promise<void>
```

Add `GoalRecommendation` to the type-only import at the top of `lib/data/repository.ts`
(same import block edited in Task 6):

```ts
import type {
  User, Program, ProgressionStyle,
  WorkoutSession, ExerciseLog,
  BodyMetrics, ActivityLog, ActivityType, SleepSession, MoodLog,
  NextSessionRecommendation, GoalRecommendation,
} from '@/lib/types'
```

- [ ] **Step 2: Add `goalRecommendations` to the adapter's schema import and type import**

In `lib/data/postgres/adapter.ts`, add `GoalRecommendation` to the `@/lib/types`
type-only import (same block edited in Task 5):

```ts
import type {
  User, Program, ProgramSession, SessionExercise, Schedule, ScheduleDay,
  ProgressionStyle, StyleSet,
  WorkoutSession, ExerciseLog, SetLog,
  BodyMetrics, ActivityLog, ActivityType, SleepSession, NextSessionRecommendation,
  ActivityLevel, FitnessGoal, MoodLog, GoalRecommendation,
} from '@/lib/types'
```

- [ ] **Step 3: Implement `rowToGoalRecommendation` and the three CRUD methods**

Add a private mapper near `rowToUser`, and the three methods near
`upsertNutritionTargets`:

```ts
  private rowToGoalRecommendation(r: typeof s.goalRecommendations.$inferSelect): GoalRecommendation {
    return {
      id: r.id,
      userId: r.userId,
      createdAt: r.createdAt,
      source: r.source as GoalRecommendation['source'],
      recommendedStepsGoal: r.recommendedStepsGoal ?? undefined,
      recommendedCalories: r.recommendedCalories ?? undefined,
      recommendedProteinG: r.recommendedProteinG ?? undefined,
      recommendedCarbsG: r.recommendedCarbsG ?? undefined,
      recommendedFatG: r.recommendedFatG ?? undefined,
      recommendedWaterMl: r.recommendedWaterMl ?? undefined,
      recommendedActivityLevel: (r.recommendedActivityLevel as ActivityLevel | null) ?? null,
      reasoning: r.reasoning ?? undefined,
      insights: r.insights ?? undefined,
      dataQualityNote: r.dataQualityNote ?? undefined,
      status: r.status as GoalRecommendation['status'],
      appliedAt: r.appliedAt ?? undefined,
      dismissedAt: r.dismissedAt ?? undefined,
    }
  }

  async createGoalRecommendation(userId: string, data: Omit<GoalRecommendation, 'id' | 'userId' | 'createdAt' | 'status' | 'appliedAt' | 'dismissedAt'>): Promise<GoalRecommendation> {
    const [r] = await this.db.insert(s.goalRecommendations)
      .values({
        userId,
        source: data.source,
        recommendedStepsGoal: data.recommendedStepsGoal ?? null,
        recommendedCalories: data.recommendedCalories ?? null,
        recommendedProteinG: data.recommendedProteinG ?? null,
        recommendedCarbsG: data.recommendedCarbsG ?? null,
        recommendedFatG: data.recommendedFatG ?? null,
        recommendedWaterMl: data.recommendedWaterMl ?? null,
        recommendedActivityLevel: data.recommendedActivityLevel ?? null,
        reasoning: data.reasoning ?? null,
        insights: data.insights ?? null,
        dataQualityNote: data.dataQualityNote ?? null,
      })
      .returning()
    return this.rowToGoalRecommendation(r)
  }

  async getGoalRecommendation(userId: string, id: string): Promise<GoalRecommendation | null> {
    const [r] = await this.db.select().from(s.goalRecommendations)
      .where(and(eq(s.goalRecommendations.id, id), eq(s.goalRecommendations.userId, userId)))
      .limit(1)
    return r ? this.rowToGoalRecommendation(r) : null
  }

  async updateGoalRecommendationStatus(userId: string, id: string, status: 'applied' | 'dismissed'): Promise<void> {
    const set: Record<string, unknown> = { status }
    if (status === 'applied') set.appliedAt = new Date()
    if (status === 'dismissed') set.dismissedAt = new Date()
    await this.db.update(s.goalRecommendations)
      .set(set)
      .where(and(eq(s.goalRecommendations.id, id), eq(s.goalRecommendations.userId, userId)))
  }
```

- [ ] **Step 4: Typecheck**

Run: `pnpm tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "Add goal_recommendations CRUD repository methods"
```

---

### Task 8: Cache invalidation group

**Files:**
- Modify: `lib/cache-groups.ts`

- [ ] **Step 1: Add `invalidateGoalRecommendations`**

Append to `lib/cache-groups.ts`:

```ts
/** Caches that derive from goals/activity-level/nutrition targets — invalidate after
 *  applying a goal recommendation or editing activity level/fitness goal in Profile. */
export async function invalidateGoalRecommendations(): Promise<void> {
  await Promise.all([
    invalidateCache('nutrition-targets'),
    invalidateCache('body-metadata'),
  ])
}
```

(Steps/water goals are read from `/api/user/goals` directly via `cachedFetch` keyed by
`'body-metadata'` in most screens — no separate cache key exists for them beyond
`body-metadata`, which already covers the TDEE display's dependency on weight + activity
level.)

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/cache-groups.ts
git commit -m "Add invalidateGoalRecommendations cache group"
```

---

### Task 9: AI recommendation route

**Files:**
- Create: `app/api/nutrition-goals/recommend/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { google } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { z } from 'zod'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, toAestDay } from '@/lib/date-utils'
import { ACTIVITY_LEVELS } from '@/lib/types/user'
import { calculateBaseline, clampRecommendation, type BaselineResult } from '@/lib/nutrition/goal-recommendation'
import type { BodyMetrics, SleepSession, MoodLog, NutritionTargets } from '@/lib/types'
import type { UserGoals } from '@/lib/data/repository'

const recommendationSchema = z.object({
  recommendedStepsGoal: z.number(),
  recommendedCalories: z.number(),
  recommendedProteinG: z.number(),
  recommendedCarbsG: z.number(),
  recommendedFatG: z.number(),
  recommendedWaterMl: z.number(),
  recommendedActivityLevel: z.enum(ACTIVITY_LEVELS).nullable(),
  reasoning: z.string(),
  insights: z.string(),
  dataQualityNote: z.string(),
})

interface ContextInput {
  sex: string
  ageYears: number
  heightCm: number
  weightGoalKg?: number
  activityLevel: string
  fitnessGoal: string
  latestWeight: number
  baseline: BaselineResult
  userGoals: UserGoals
  nutritionTargets: NutritionTargets | null
  bodyMetrics: BodyMetrics[]
  sleepSessions: SleepSession[]
  moodLogs: MoodLog[]
  workoutSessionCount: number
  personalRecords: { exerciseName: string; estimated1rm: number; achievedAt: Date }[]
}

function buildContext(c: ContextInput, tz: string): string {
  const weighIns = c.bodyMetrics.filter(m => m.weightKg != null).sort((a, b) => a.date.localeCompare(b.date))
  const weightDelta = weighIns.length >= 2
    ? weighIns[weighIns.length - 1].weightKg! - weighIns[0].weightKg!
    : null

  const stepsValues = c.bodyMetrics.filter(m => m.steps != null).map(m => m.steps!)
  const avgSteps = stepsValues.length > 0
    ? Math.round(stepsValues.reduce((a, b) => a + b, 0) / stepsValues.length)
    : null

  const rhrValues = c.bodyMetrics.filter(m => m.restingHeartRate != null).map(m => m.restingHeartRate!)
  const avgRhr = rhrValues.length > 0
    ? Math.round(rhrValues.reduce((a, b) => a + b, 0) / rhrValues.length)
    : null

  const hrvValues = c.bodyMetrics.filter(m => m.hrvMs != null).map(m => m.hrvMs!)
  const avgHrv = hrvValues.length > 0
    ? Math.round(hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length)
    : null

  const daysWithData = new Set(c.bodyMetrics.map(m => m.date)).size

  const sleepByDate = new Map(c.sleepSessions.map(sess => [sess.date, sess]))
  const sleepMoodPairs = c.moodLogs
    .filter(m => sleepByDate.get(m.logDate)?.durationHours != null)
    .map(m => `${m.logDate}: ${sleepByDate.get(m.logDate)!.durationHours!.toFixed(1)}h sleep, energy=${m.energyLevel}, sleep quality=${m.sleepQuality}`)

  const prLines = c.personalRecords.map(pr => `${pr.exerciseName}: ${pr.estimated1rm}kg est. 1RM on ${toAestDay(pr.achievedAt, tz)}`)

  const lines: (string | null)[] = [
    `Profile: sex=${c.sex}, age=${c.ageYears}, height=${c.heightCm}cm, current weight=${c.latestWeight}kg${c.weightGoalKg ? `, goal weight=${c.weightGoalKg}kg` : ''}.`,
    `Current activity level: ${c.activityLevel}. Fitness goal: ${c.fitnessGoal}.`,
    `Baseline (Mifflin-St Jeor, activity level "${c.activityLevel}"): BMR ${c.baseline.bmr} kcal, TDEE ${c.baseline.tdee} kcal, baseline calorie target ${c.baseline.calories} kcal, protein ${c.baseline.proteinG}g, carbs ${c.baseline.carbsG}g, fat ${c.baseline.fatG}g, water ${c.baseline.waterMl}ml, steps goal ${c.baseline.stepsGoal}.`,
    `Current goals: steps ${c.userGoals.stepsGoal ?? 'unset'} (${c.userGoals.stepsGoalType ?? 'daily'}), calories ${c.userGoals.calorieGoal ?? 'unset'} (${c.userGoals.calorieGoalType ?? 'daily'}), water ${c.userGoals.waterGoalMl ?? 'unset'}ml (${c.userGoals.waterGoalType ?? 'daily'}).`,
    `Current nutrition targets: ${c.nutritionTargets ? `${c.nutritionTargets.calories ?? '—'} kcal, protein ${c.nutritionTargets.proteinG ?? '—'}g, carbs ${c.nutritionTargets.carbsG ?? '—'}g, fat ${c.nutritionTargets.fatG ?? '—'}g` : 'none set'}.`,
    `14-day data completeness: ${daysWithData}/14 days with logged body metrics.`,
    weightDelta != null ? `Weight change over the last 14 days: ${weightDelta >= 0 ? '+' : ''}${weightDelta.toFixed(1)}kg.` : 'Not enough weigh-ins to compute a weight trend.',
    avgSteps != null ? `Average daily steps: ${avgSteps}.` : 'No step data logged.',
    avgRhr != null ? `Average resting heart rate: ${avgRhr} bpm.` : null,
    avgHrv != null ? `Average HRV: ${avgHrv} ms.` : null,
    `Workout sessions in the last 14 days: ${c.workoutSessionCount}.`,
    sleepMoodPairs.length > 0 ? `Sleep/mood data points:\n${sleepMoodPairs.join('\n')}` : 'No paired sleep+mood data in this window.',
    prLines.length > 0 ? `Personal records achieved in this window:\n${prLines.join('\n')}` : 'No new personal records in this window.',
  ]

  return lines.filter((l): l is string => l != null).join('\n')
}

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`${userId}:goal-recommend`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: { source?: string } = {}
  try { body = await req.json() } catch { /* default to on_demand */ }
  const source = body.source === 'scheduled' ? 'scheduled' : 'on_demand'

  const repo = await getRepository()
  const user = await repo.getUserById(userId)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const missing: string[] = []
  if (!user.heightCm) missing.push('heightCm')
  if (!user.dateOfBirth) missing.push('dateOfBirth')
  if (!user.sex) missing.push('sex')
  if (!user.activityLevel) missing.push('activityLevel')
  if (!user.fitnessGoal) missing.push('fitnessGoal')
  if (missing.length > 0) {
    return NextResponse.json({ error: 'profile_incomplete', missing }, { status: 400 })
  }

  const tz = user.timezone ?? DEFAULT_TZ
  const todayIso = todayInTz(tz)
  const windowStart = new Date(todayMidnightUtc(tz).getTime() - 14 * 86_400_000)
  const fromIso = toAestDay(windowStart, tz)

  const [bodyMetrics, sleepSessions, moodLogs, workoutSessions, personalRecords, userGoals, nutritionTargets] = await Promise.all([
    repo.listBodyMetrics(userId, fromIso, todayIso),
    repo.listSleepSessions(userId, fromIso, todayIso),
    repo.listMoodLogs(userId, fromIso, todayIso),
    repo.getWorkoutSessionsFrom(userId, windowStart),
    repo.listRecentPersonalRecords(userId, windowStart, new Date()),
    repo.getUserGoals(userId),
    repo.getNutritionTargets(userId),
  ])

  const latestWeight = bodyMetrics.find(m => m.weightKg != null)?.weightKg
  if (latestWeight == null) {
    return NextResponse.json({ error: 'no_weight_data' }, { status: 400 })
  }

  const ageYears = Math.floor((Date.now() - new Date(user.dateOfBirth!).getTime()) / (365.25 * 24 * 3600 * 1000))

  const baseline = calculateBaseline({
    weightKg: latestWeight,
    heightCm: user.heightCm!,
    ageYears,
    sex: user.sex!,
    activityLevel: user.activityLevel!,
    fitnessGoal: user.fitnessGoal!,
  })

  const context = buildContext({
    sex: user.sex!,
    ageYears,
    heightCm: user.heightCm!,
    weightGoalKg: user.weightGoalKg,
    activityLevel: user.activityLevel!,
    fitnessGoal: user.fitnessGoal!,
    latestWeight,
    baseline,
    userGoals,
    nutritionTargets,
    bodyMetrics,
    sleepSessions,
    moodLogs,
    workoutSessionCount: workoutSessions.length,
    personalRecords,
  }, tz)

  let ai: z.infer<typeof recommendationSchema>
  let clamped: ReturnType<typeof clampRecommendation>
  let rec: { id: string }
  try {
    const result = await generateObject({
      model: google('gemini-3.1-flash-lite'),
      schema: recommendationSchema,
      prompt: `You are a sports nutrition and training coach. Based on the data below, recommend DAILY targets for steps, calories, protein, carbs, fat, and water.

${context}

Instructions:
- Stay close to the baseline numbers; only deviate meaningfully when the trend data justifies it, and explain why in "reasoning".
- Only suggest a different "recommendedActivityLevel" if the logged workout frequency clearly doesn't match the current activity level (e.g. 4+ sessions/week while set to "sedentary" or "light"). Otherwise set it to null. If you do suggest a change, base all the other numbers on the new activity level's TDEE, not the current one.
- "insights": look for sleep-duration vs mood/energy patterns and mention any personal records achieved in this window. If there's too little data (fewer than 3 days logged), say so explicitly instead of guessing — do not fabricate trends.
- "dataQualityNote": briefly note if the recommendation is baseline-only due to sparse data, otherwise return an empty string.
- All step/calorie/water values must be DAILY figures, not weekly.`,
    })
    ai = result.object

    let clampBaseline = baseline
    if (ai.recommendedActivityLevel && ai.recommendedActivityLevel !== user.activityLevel) {
      clampBaseline = calculateBaseline({
        weightKg: latestWeight,
        heightCm: user.heightCm!,
        ageYears,
        sex: user.sex!,
        activityLevel: ai.recommendedActivityLevel,
        fitnessGoal: user.fitnessGoal!,
      })
    }

    clamped = clampRecommendation(ai, clampBaseline, latestWeight)

    rec = await repo.createGoalRecommendation(userId, {
      source,
      recommendedStepsGoal: clamped.recommendedStepsGoal,
      recommendedCalories: clamped.recommendedCalories,
      recommendedProteinG: clamped.recommendedProteinG,
      recommendedCarbsG: clamped.recommendedCarbsG,
      recommendedFatG: clamped.recommendedFatG,
      recommendedWaterMl: clamped.recommendedWaterMl,
      recommendedActivityLevel: clamped.recommendedActivityLevel,
      reasoning: ai.reasoning,
      insights: ai.insights,
      dataQualityNote: clamped.dataQualityNote,
    })
  } catch {
    // Covers NoObjectGeneratedError (Gemini output failed schema validation) and any
    // DB error from createGoalRecommendation — no row is persisted and the rate-limit
    // slot is still consumed, so report failure clearly rather than throwing a raw 500.
    return NextResponse.json({ error: 'recommendation_failed' }, { status: 500 })
  }

  return NextResponse.json({
    id: rec.id,
    current: {
      stepsGoal: userGoals.stepsGoal,
      stepsGoalType: userGoals.stepsGoalType,
      calorieGoal: userGoals.calorieGoal ?? nutritionTargets?.calories ?? null,
      calorieGoalType: userGoals.calorieGoalType,
      waterGoalMl: userGoals.waterGoalMl,
      waterGoalType: userGoals.waterGoalType,
      proteinG: nutritionTargets?.proteinG ?? null,
      carbsG: nutritionTargets?.carbsG ?? null,
      fatG: nutritionTargets?.fatG ?? null,
      activityLevel: user.activityLevel,
    },
    recommended: {
      stepsGoal: clamped.recommendedStepsGoal,
      calories: clamped.recommendedCalories,
      proteinG: clamped.recommendedProteinG,
      carbsG: clamped.recommendedCarbsG,
      fatG: clamped.recommendedFatG,
      waterMl: clamped.recommendedWaterMl,
      activityLevel: clamped.recommendedActivityLevel,
    },
    reasoning: ai.reasoning,
    insights: ai.insights,
    dataQualityNote: clamped.dataQualityNote,
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Manual verification against the local dev DB**

With `pnpm dev` running and logged in as `test@local.dev` / `testpass123`:

1. First confirm the `profile_incomplete` path — before setting `activityLevel`/
   `fitnessGoal` (Task 5's PATCH not yet exercised for this user), call:
   ```bash
   curl -s -X POST http://localhost:3000/api/nutrition-goals/recommend \
     -H "Content-Type: application/json" -H "Cookie: <session-cookie>" \
     -d '{"source":"on_demand"}' | jq
   ```
   Expected: `{"error":"profile_incomplete","missing":[...]}` listing whichever of
   `heightCm`/`dateOfBirth`/`sex`/`activityLevel`/`fitnessGoal` are unset for the seed
   user.

2. Set the missing fields via `/api/user/profile` PATCH (heightCm, dateOfBirth, sex,
   activityLevel, fitnessGoal), confirm the seed user has at least one `body_metrics` row
   with `weight_kg` set (seed data includes 1-2 weeks of body metrics per
   `scripts/local-db/seed.sql`), then re-run the recommend call.

   Expected: `200` with `{id, current, recommended, reasoning, insights,
   dataQualityNote}`. `recommended.calories`/`proteinG`/`carbsG`/`fatG`/`waterMl`/
   `stepsGoal` should all be within the safety bounds from Task 4 relative to the
   baseline for the seed user's stats.

3. Verify persistence:
   ```bash
   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d trainingai_dev \
     -c "SELECT id, source, status, recommended_calories, recommended_activity_level FROM goal_recommendations ORDER BY created_at DESC LIMIT 1;"
   ```
   Expected: one row with `status='pending'` and the same `recommended_calories` as the
   API response.

- [ ] **Step 4: Commit**

```bash
git add app/api/nutrition-goals/recommend/route.ts
git commit -m "Add AI nutrition/activity goal recommendation route"
```

---

### Task 10: Apply/dismiss and remind-later routes

**Files:**
- Create: `app/api/nutrition-goals/[id]/route.ts`
- Create: `app/api/nutrition-goals/touch-review/route.ts`

- [ ] **Step 1: Write the status-update route**

```ts
// app/api/nutrition-goals/[id]/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  let body: { status?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (body.status !== 'applied' && body.status !== 'dismissed') {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const repo = await getRepository()
  const existing = await repo.getGoalRecommendation(userId, id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await repo.updateGoalRecommendationStatus(userId, id, body.status)
  await repo.touchLastGoalReviewAt(userId)

  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Write the "remind me later" route**

```ts
// app/api/nutrition-goals/touch-review/route.ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function POST() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  await repo.touchLastGoalReviewAt(userId)

  return NextResponse.json({ success: true })
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Manual verification**

Using the `id` returned from Task 9's recommend call and a valid session cookie:

```bash
curl -s -X PATCH http://localhost:3000/api/nutrition-goals/<id> \
  -H "Content-Type: application/json" -H "Cookie: <session-cookie>" \
  -d '{"status":"dismissed"}' | jq
```

Expected: `{"success":true}`. Then:

```bash
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d trainingai_dev \
  -c "SELECT status, dismissed_at FROM goal_recommendations WHERE id='<id>';"
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d trainingai_dev \
  -c "SELECT last_goal_review_at FROM users WHERE email='test@local.dev';"
```

Expected: `status='dismissed'` with `dismissed_at` set, and `users.last_goal_review_at`
updated to roughly now.

Also verify `/api/nutrition-goals/touch-review`:

```bash
curl -s -X POST http://localhost:3000/api/nutrition-goals/touch-review \
  -H "Cookie: <session-cookie>" | jq
```

Expected: `{"success":true}`, and `users.last_goal_review_at` updated again.

- [ ] **Step 5: Commit**

```bash
git add app/api/nutrition-goals/
git commit -m "Add goal recommendation status and remind-later routes"
```

---

## Summary of new/changed files

- `lib/data/postgres/migrations/068_goal_recommendations.sql` (new)
- `lib/data/postgres/schema.ts` (users columns + `goalRecommendations` table)
- `lib/types/user.ts` (`ActivityLevel`, `FitnessGoal`, new `User` fields)
- `lib/types/goal-recommendation.ts` (new)
- `lib/types/index.ts` (export new module)
- `lib/nutrition/goal-recommendation.ts` (new — `calculateBaseline`, `clampRecommendation`)
- `lib/nutrition/__tests__/goal-recommendation.test.ts` (new)
- `lib/data/repository.ts` (interface additions)
- `lib/data/postgres/adapter.ts` (implementations)
- `app/api/user/profile/route.ts` (PATCH extension)
- `lib/cache-groups.ts` (`invalidateGoalRecommendations`)
- `app/api/nutrition-goals/recommend/route.ts` (new)
- `app/api/nutrition-goals/[id]/route.ts` (new)
- `app/api/nutrition-goals/touch-review/route.ts` (new)

This plan produces a fully working, testable backend. The companion plan
`docs/superpowers/plans/2026-06-14-ai-goal-recommender-ui.md` builds the Profile UI,
review sheet, scheduled pop-up, and TDEE display update on top of these APIs.
