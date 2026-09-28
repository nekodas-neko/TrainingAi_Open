# Meal-Plan Tracking — Phase A: the `estimated` answer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a planned meal's window passes with nothing logged and no decline recorded, the app records an `estimated` answer carrying that slot's target macros, and the day's totals count it — visibly marked, and without a single invented calorie entering `food_logs`.

**Architecture:** `plan_meal_answers` is a **declines-only** table (Q-187 phase 2). Phase A adds exactly one new `answer` state, `estimated`, plus the macros that estimate carries. Estimates are **materialised on read** — there is no cron layer in this app (`docs/module-map.md` §0) — and merged into day totals at `lib/health/energy-balance-service.ts`, the one server-side assembly. `food_logs` is not touched.

**Tech Stack:** PostgreSQL + Drizzle, local SQLite mirror (`lib/sqlite/migrations.ts`), Next.js route handlers, Vitest.

**Read first:** [`docs/superpowers/specs/2026-09-26-meal-plan-tracking-design.md`](../specs/2026-09-26-meal-plan-tracking-design.md) — especially §3 (the measurements) and §5 (why the estimate is not a `food_logs` row).

---

## Ground rules for this phase

- **A migration ships alone.** CLAUDE.md forbids batching a migration with anything else — its revert is a corrective migration. Task 1 is its own PR.
- **`'yes'` is never stored.** "I ate it" is derivable from the food log. Confirming an estimate (Phase B) writes the log and clears the estimate.
- **Every migration adding a column ships its regenerated `claude_ro` twin in the same PR**, and the two tests that catch a missed twin need a TCP `DATABASE_URL` — see Task 2.
- Local dev DB: `postgresql://postgres:postgres@localhost:5433/trainingai_dev`.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `lib/data/postgres/migrations/284_plan_meal_answer_estimated.sql` | Add estimate columns + widen the answer check | Create |
| `lib/data/postgres/migrations/285_claude_ro_views_plan_meal_estimates.sql` | Regenerated read-only twin | Create |
| `lib/data/postgres/schema.ts` | Drizzle definition for the new columns | Modify |
| `lib/sqlite/migrations.ts` | Local mirror of the same columns | Modify |
| `packages/shared/src/nutrition/meal-estimate.ts` | **Pure** decision: which plan meals are due an estimate, and at what macros | Create |
| `lib/data/postgres/slices/meal-plans.ts` | Read/write the `estimated` answer | Modify |
| `lib/health/energy-balance-service.ts` | Merge estimated answers into the day's totals | Modify |

`meal-estimate.ts` is deliberately a pure module with no I/O: it is the piece Phase C's corrector will call, and the piece that is cheap to test at window boundaries.

---

### Task 1: The migration and its `claude_ro` twin

**Files:**
- Create: `lib/data/postgres/migrations/284_plan_meal_answer_estimated.sql`
- Create: `lib/data/postgres/migrations/285_claude_ro_views_plan_meal_estimates.sql`
- Modify: `lib/data/postgres/schema.ts`

- [ ] **Step 1: Write the migration**

```sql
-- 284_plan_meal_answer_estimated.sql
-- BF-203 phase A. `plan_meal_answers` was declines-only (Q-187 phase 2). It gains ONE new state,
-- `estimated`: the window passed, nothing was logged, nothing was declined, so the planned macros
-- are assumed. `'yes'` is deliberately NOT a state -- "I ate it" stays derivable from the food log.
ALTER TABLE plan_meal_answers
  ADD COLUMN IF NOT EXISTS est_calories   integer,
  ADD COLUMN IF NOT EXISTS est_protein_g  double precision,
  ADD COLUMN IF NOT EXISTS est_carbs_g    double precision,
  ADD COLUMN IF NOT EXISTS est_fat_g      double precision,
  ADD COLUMN IF NOT EXISTS est_bias_kcal  integer,
  ADD COLUMN IF NOT EXISTS est_basis      text;

-- An estimate must carry its macros; a decline must not.
ALTER TABLE plan_meal_answers
  ADD CONSTRAINT plan_meal_answers_estimate_shape CHECK (
    (answer = 'estimated' AND est_calories IS NOT NULL)
    OR (answer <> 'estimated' AND est_calories IS NULL)
  );
```

- [ ] **Step 2: Apply it locally and confirm the constraint bites**

Run:
```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev' node scripts/local-db/migrate.js
psql 'postgresql://postgres:postgres@localhost:5433/trainingai_dev' -c \
  "INSERT INTO plan_meal_answers (id,user_id,plan_meal_id,log_date,answer) VALUES (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'2026-09-26','estimated');"
```
Expected: the `INSERT` FAILS with `violates check constraint "plan_meal_answers_estimate_shape"`. That is the point of the step — an estimate with no macros must be impossible.

- [ ] **Step 3: Add the columns to the Drizzle schema**

In `lib/data/postgres/schema.ts`, inside `planMealAnswers`, after `answeredAt`:

```ts
  // BF-203. Set only when `answer = 'estimated'`; the DB constraint enforces the pairing.
  estCalories:  integer('est_calories'),
  estProteinG:  doublePrecision('est_protein_g'),
  estCarbsG:    doublePrecision('est_carbs_g'),
  estFatG:      doublePrecision('est_fat_g'),
  // The bias applied when this estimate was written, and which window produced it, so a stored
  // estimate can be explained months later rather than re-derived against a changed model.
  estBiasKcal:  integer('est_bias_kcal'),
  estBasis:     text('est_basis'),
```

- [ ] **Step 4: Regenerate the `claude_ro` twin**

Run (the owner's uuid comes from the environment — it must NOT appear in the output, per Q-456):
```bash
CLAUDE_RO_OWNER_USER_ID=<uuid> node scripts/generate-claude-ro-views.js \
  > lib/data/postgres/migrations/285_claude_ro_views_plan_meal_estimates.sql
diff <(git show HEAD:lib/data/postgres/migrations/283_claude_ro_views_acwr.sql) \
     lib/data/postgres/migrations/285_claude_ro_views_plan_meal_estimates.sql
```
Expected: the diff shows **only** the six new `plan_meal_answers` columns. Anything else moving means the generator picked up an unrelated schema change — stop and find out why.

- [ ] **Step 5: Run the two tests that catch a missed twin**

These skip under the full suite because they need a **TCP** `DATABASE_URL`, so run them directly:
```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev' \
  npx vitest run lib/data/postgres/__tests__/claude-ro-readonly-role.test.ts \
                 lib/export/__tests__/db-snapshot-integration.test.ts
```
Expected: PASS, **none skipped**. If they report "skipped", the URL is a Unix socket and the test silently reconnected as superuser — fix the URL, do not proceed.

- [ ] **Step 6: Commit — this migration ships as its own PR**

```bash
git add lib/data/postgres/migrations/284_plan_meal_answer_estimated.sql \
        lib/data/postgres/migrations/285_claude_ro_views_plan_meal_estimates.sql \
        lib/data/postgres/schema.ts
git commit -m "Add the estimated answer state to plan_meal_answers

An estimate carries the macros it assumed; a decline carries none, and a check
constraint enforces the pairing so a macro-less estimate cannot be written. No
yes state - I ate it stays derivable from the food log, per Q-187 phase 2."
```

---

### Task 2: Mirror the columns in the local store

**Files:**
- Modify: `lib/sqlite/migrations.ts`

- [ ] **Step 1: Add the columns to the local table**

In `lib/sqlite/migrations.ts`, extend `CREATE_PLAN_MEAL_ANSWERS`:

```ts
const CREATE_PLAN_MEAL_ANSWERS = `CREATE TABLE IF NOT EXISTS plan_meal_answers (
  id            TEXT PRIMARY KEY,
  plan_meal_id  TEXT NOT NULL,
  log_date      TEXT NOT NULL,
  answer        TEXT NOT NULL DEFAULT 'no',
  answered_at   TEXT,
  est_calories  INTEGER,
  est_protein_g REAL,
  est_carbs_g   REAL,
  est_fat_g     REAL,
  est_bias_kcal INTEGER,
  est_basis     TEXT,
  deleted_at    TEXT,
  updated_at    TEXT,
  sync_status   TEXT NOT NULL DEFAULT 'pending'
)`;
```

- [ ] **Step 2: Add the upgrade statements for existing installs**

A `CREATE TABLE IF NOT EXISTS` does not alter a table that already exists, so installed devices need explicit `ALTER`s in the version upgrade list — **without PRAGMAs**, which the Custom Rules gate forbids in upgrade statements. Add beside the other upgrades:

```ts
  `ALTER TABLE plan_meal_answers ADD COLUMN est_calories INTEGER`,
  `ALTER TABLE plan_meal_answers ADD COLUMN est_protein_g REAL`,
  `ALTER TABLE plan_meal_answers ADD COLUMN est_carbs_g REAL`,
  `ALTER TABLE plan_meal_answers ADD COLUMN est_fat_g REAL`,
  `ALTER TABLE plan_meal_answers ADD COLUMN est_bias_kcal INTEGER`,
  `ALTER TABLE plan_meal_answers ADD COLUMN est_basis TEXT`,
```

- [ ] **Step 3: Verify the columns reach an upgraded device, not just a fresh one**

Run: `pnpm check:rules`
Expected: the step named **"Local columns reach upgraded devices"** passes. That check exists precisely for this mistake — a column added only to the `CREATE` and never to the upgrade list works on a clean install and is missing on every real phone.

- [ ] **Step 4: Commit**

```bash
git add lib/sqlite/migrations.ts
git commit -m "Mirror the estimate columns into the local store

Added to the upgrade list as well as the CREATE, so installed devices get them
rather than only fresh installs."
```

---

### Task 3: The pure decision — which meals are due an estimate

**Files:**
- Create: `packages/shared/src/nutrition/meal-estimate.ts`
- Test: `packages/shared/src/nutrition/__tests__/meal-estimate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { dueForEstimate } from '../meal-estimate'

const slot = (id: string, endHour: number, kcal: number) => ({
  planMealId: id,
  mealTypeId: `mt-${id}`,
  timeEndHour: endHour,
  targetCalories: kcal,
  targetProteinG: 30,
  targetCarbsG: 40,
  targetFatG: 10,
})

describe('dueForEstimate', () => {
  it('returns a slot whose window has closed with nothing logged and nothing declined', () => {
    const out = dueForEstimate({
      slots: [slot('a', 11, 400)],
      loggedPlanMealIds: new Set<string>(),
      answeredPlanMealIds: new Set<string>(),
      localHour: 12,
      biasKcal: 0,
    })
    expect(out).toEqual([
      { planMealId: 'a', calories: 400, proteinG: 30, carbsG: 40, fatG: 10, biasKcal: 0 },
    ])
  })

  it('does not estimate a slot whose window is still open', () => {
    const out = dueForEstimate({
      slots: [slot('a', 11, 400)],
      loggedPlanMealIds: new Set(), answeredPlanMealIds: new Set(),
      localHour: 10, biasKcal: 0,
    })
    expect(out).toEqual([])
  })

  it('does not estimate a slot that already has food logged against it', () => {
    const out = dueForEstimate({
      slots: [slot('a', 11, 400)],
      loggedPlanMealIds: new Set(['a']), answeredPlanMealIds: new Set(),
      localHour: 12, biasKcal: 0,
    })
    expect(out).toEqual([])
  })

  it('does not estimate a slot the user declined', () => {
    const out = dueForEstimate({
      slots: [slot('a', 11, 400)],
      loggedPlanMealIds: new Set(), answeredPlanMealIds: new Set(['a']),
      localHour: 12, biasKcal: 0,
    })
    expect(out).toEqual([])
  })

  it('applies the bias per slot, proportionally to the slot calories', () => {
    // +200 kcal/day of bias over two slots of 400 and 600 -> +80 and +120.
    const out = dueForEstimate({
      slots: [slot('a', 11, 400), slot('b', 15, 600)],
      loggedPlanMealIds: new Set(), answeredPlanMealIds: new Set(),
      localHour: 16, biasKcal: 200,
    })
    expect(out.map(o => o.calories)).toEqual([480, 720])
  })

  it('never returns a negative calorie estimate', () => {
    const out = dueForEstimate({
      slots: [slot('a', 11, 300)],
      loggedPlanMealIds: new Set(), answeredPlanMealIds: new Set(),
      localHour: 12, biasKcal: -5000,
    })
    expect(out[0].calories).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/shared/src/nutrition/__tests__/meal-estimate.test.ts`
Expected: FAIL — `Failed to resolve import "../meal-estimate"`.

- [ ] **Step 3: Write the module**

```ts
// BF-203 phase A. The pure half of the estimate: given today's plan slots, what has been logged,
// what has been declined, and the local hour, decide which slots are owed an estimate and at what
// macros. No I/O, no clock, no timezone maths -- the caller resolves the user-local hour and passes
// it in, which is what makes the window boundary testable at 23:59 and 00:01.
export interface EstimateSlot {
  planMealId: string
  mealTypeId: string
  /** `meal_types.timeEndHour`. The window is closed once the local hour is at or past this. */
  timeEndHour: number
  targetCalories: number
  targetProteinG: number
  targetCarbsG: number
  targetFatG: number
}

export interface EstimateDue {
  planMealId: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  biasKcal: number
}

export function dueForEstimate(input: {
  slots: readonly EstimateSlot[]
  loggedPlanMealIds: ReadonlySet<string>
  answeredPlanMealIds: ReadonlySet<string>
  /** Hour 0-24 in the USER's timezone, resolved by the caller. */
  localHour: number
  /** kcal/day from Phase C. Zero until that ships. */
  biasKcal: number
}): EstimateDue[] {
  const { slots, loggedPlanMealIds, answeredPlanMealIds, localHour, biasKcal } = input
  const due = slots.filter(
    s => localHour >= s.timeEndHour
      && !loggedPlanMealIds.has(s.planMealId)
      && !answeredPlanMealIds.has(s.planMealId),
  )
  // Spread the day's bias across the slots being estimated, in proportion to their size, so a
  // large dinner absorbs more of it than a small snack.
  const total = due.reduce((sum, s) => sum + s.targetCalories, 0)
  return due.map(s => {
    const share = total > 0 ? (s.targetCalories / total) * biasKcal : 0
    return {
      planMealId: s.planMealId,
      calories: Math.max(0, Math.round(s.targetCalories + share)),
      proteinG: s.targetProteinG,
      carbsG: s.targetCarbsG,
      fatG: s.targetFatG,
      biasKcal,
    }
  })
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/shared/src/nutrition/__tests__/meal-estimate.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/nutrition/meal-estimate.ts \
        packages/shared/src/nutrition/__tests__/meal-estimate.test.ts
git commit -m "Decide which plan meals are owed an estimate

Pure, clock-free and timezone-free: the caller resolves the user-local hour and
passes it in, which is what makes the window boundary testable directly."
```

---

### Task 4: The window boundary, in the user's timezone

**Files:**
- Test: `packages/shared/src/nutrition/__tests__/meal-estimate-boundary.test.ts`

The repo's date rules require a boundary test at 23:59/00:01 user-local, and forbid a fixture that only fires during a particular real-world window. `dueForEstimate` takes the hour as a parameter, so this tests the *caller's* contract without waiting for a clock.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'
import { dueForEstimate } from '../meal-estimate'

// A fixed-offset zone whose local hour we can state exactly, so this fires on every CI run
// rather than only between certain UTC hours.
const TZ = 'Etc/GMT-10' // UTC+10, the owner's offset

const slot = {
  planMealId: 'dinner', mealTypeId: 'mt-dinner', timeEndHour: 21,
  targetCalories: 700, targetProteinG: 40, targetCarbsG: 60, targetFatG: 20,
}

function localHourIn(tz: string, iso: string): number {
  return Number(formatInTimeZone(new Date(iso), tz, 'H'))
}

describe('estimate window boundary', () => {
  it('is closed at 23:59 local on the same day', () => {
    const hour = localHourIn(TZ, '2026-09-26T13:59:00Z') // 23:59 in UTC+10
    expect(hour).toBe(23)
    expect(dueForEstimate({
      slots: [slot], loggedPlanMealIds: new Set(), answeredPlanMealIds: new Set(),
      localHour: hour, biasKcal: 0,
    })).toHaveLength(1)
  })

  it('is open again at 00:01 local, because that is a new day with a fresh plan', () => {
    const hour = localHourIn(TZ, '2026-09-26T14:01:00Z') // 00:01 next local day
    expect(hour).toBe(0)
    expect(dueForEstimate({
      slots: [slot], loggedPlanMealIds: new Set(), answeredPlanMealIds: new Set(),
      localHour: hour, biasKcal: 0,
    })).toHaveLength(0)
  })

  it('treats the closing hour itself as closed', () => {
    expect(dueForEstimate({
      slots: [slot], loggedPlanMealIds: new Set(), answeredPlanMealIds: new Set(),
      localHour: 21, biasKcal: 0,
    })).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run packages/shared/src/nutrition/__tests__/meal-estimate-boundary.test.ts`
Expected: PASS, 3 tests. If the first two fail, the caller contract is wrong: the hour must come from `formatInTimeZone(now, userTz, 'H')`, never from `new Date().getHours()`.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/nutrition/__tests__/meal-estimate-boundary.test.ts
git commit -m "Pin the estimate window to the user's local hour

Uses a fixed-offset zone so the boundary case runs on every CI pass instead of
only during a particular band of UTC hours."
```

---

### Task 5: Persist an estimate, and widen the answer type

**Files:**
- Modify: `lib/data/postgres/slices/meal-plans.ts`
- Test: `lib/data/postgres/__tests__/bf203-estimated-answers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { upsertEstimatedAnswers, getPlanMealAnswers } from '../slices/meal-plans'

const USER = '9f0b6f6e-bf20-4c2a-9a10-bf203a000001' // unique to this file, per the shared-uuid rule
const PLAN_MEAL = '9f0b6f6e-bf20-4c2a-9a10-bf203a000002'

describe('estimated plan-meal answers', () => {
  it('writes an estimate carrying its macros', async () => {
    await upsertEstimatedAnswers(USER, '2026-09-26', [
      { planMealId: PLAN_MEAL, calories: 480, proteinG: 30, carbsG: 40, fatG: 10, biasKcal: 80 },
    ])
    const rows = await getPlanMealAnswers(USER, '2026-09-26')
    expect(rows).toHaveLength(1)
    expect(rows[0].answer).toBe('estimated')
    expect(rows[0].estCalories).toBe(480)
    expect(rows[0].estBiasKcal).toBe(80)
  })

  it('is idempotent — a second pass on the same day does not duplicate', async () => {
    await upsertEstimatedAnswers(USER, '2026-09-26', [
      { planMealId: PLAN_MEAL, calories: 480, proteinG: 30, carbsG: 40, fatG: 10, biasKcal: 80 },
    ])
    expect(await getPlanMealAnswers(USER, '2026-09-26')).toHaveLength(1)
  })

  it('never overwrites a decline with an estimate', async () => {
    await declinePlanMeal(USER, PLAN_MEAL, '2026-09-27')
    await upsertEstimatedAnswers(USER, '2026-09-27', [
      { planMealId: PLAN_MEAL, calories: 480, proteinG: 30, carbsG: 40, fatG: 10, biasKcal: 0 },
    ])
    const rows = await getPlanMealAnswers(USER, '2026-09-27')
    expect(rows[0].answer).toBe('no')
    expect(rows[0].estCalories).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev' npx vitest run lib/data/postgres/__tests__/bf203-estimated-answers.test.ts`
Expected: FAIL — `upsertEstimatedAnswers is not exported`.

- [ ] **Step 3: Widen the answer type**

In `lib/data/postgres/slices/meal-plans.ts`, change the interface — the literal `'no'` is the current type and it must admit the new state:

```ts
export type PlanMealAnswerValue = 'no' | 'estimated'

export interface PlanMealAnswer {
  id: string
  planMealId: string
  logDate: string
  answer: PlanMealAnswerValue
  answeredAt: string
  estCalories: number | null
  estProteinG: number | null
  estCarbsG: number | null
  estFatG: number | null
  estBiasKcal: number | null
  estBasis: string | null
}
```

- [ ] **Step 4: Write the upsert**

```ts
/**
 * Record the estimates for one local day. Idempotent by `(plan_meal_id, log_date)` and it will
 * NEVER convert a decline into an estimate -- the user saying "I did not eat this" outranks the
 * app's assumption that they did, which is why the conflict target does nothing when a row exists.
 */
export async function upsertEstimatedAnswers(
  userId: string,
  logDate: string,
  estimates: readonly EstimateDue[],
): Promise<void> {
  if (estimates.length === 0) return
  await db.insert(planMealAnswers).values(
    estimates.map(e => ({
      userId,
      planMealId: e.planMealId,
      logDate,
      answer: 'estimated' as const,
      estCalories: e.calories,
      estProteinG: e.proteinG,
      estCarbsG: e.carbsG,
      estFatG: e.fatG,
      estBiasKcal: e.biasKcal,
      estBasis: 'planA',
    })),
  ).onConflictDoNothing({ target: [planMealAnswers.planMealId, planMealAnswers.logDate] })
}
```

- [ ] **Step 5: Add the unique index the conflict target needs**

`onConflictDoNothing` requires a matching unique constraint. Append to `284_plan_meal_answer_estimated.sql`:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS plan_meal_answers_meal_day_uniq
  ON plan_meal_answers (plan_meal_id, log_date)
  WHERE deleted_at IS NULL;
```

Re-run the migration, then re-run Step 2's command.

- [ ] **Step 6: Run the tests**

Run: `DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev' npx vitest run lib/data/postgres/__tests__/bf203-estimated-answers.test.ts`
Expected: PASS, 3 tests. The third is the important one — a decline must survive the estimator running over it.

- [ ] **Step 7: Commit**

```bash
git add lib/data/postgres/slices/meal-plans.ts \
        lib/data/postgres/__tests__/bf203-estimated-answers.test.ts \
        lib/data/postgres/migrations/284_plan_meal_answer_estimated.sql
git commit -m "Persist estimated answers, idempotently and never over a decline

A decline outranks the app's assumption, so the upsert does nothing where a row
already exists rather than replacing it."
```

---

### Task 5b: The three reads Task 8 needs

**Files:**
- Modify: `lib/data/postgres/slices/meal-plans.ts`

Task 8 calls three helpers. They are defined here so nobody has to invent them mid-wiring. Each is a
single query; none of them is clever.

- [ ] **Step 1: Write them**

```ts
/** Today's plan slots, in the shape `dueForEstimate` consumes. Joins the active plan's variant to
 *  the meal types that carry the window hours. */
export async function getTodayPlanSlots(userId: string, logDate: string): Promise<EstimateSlot[]> {
  const rows = await db
    .select({
      planMealId: mealPlanMeals.id,
      mealTypeId: mealPlanMeals.mealTypeId,
      timeEndHour: mealTypes.timeEndHour,
      targetCalories: mealPlanMeals.targetCalories,
      targetProteinG: mealPlanMeals.targetProteinG,
      targetCarbsG: mealPlanMeals.targetCarbsG,
      targetFatG: mealPlanMeals.targetFatG,
    })
    .from(mealPlanMeals)
    .innerJoin(mealPlanVariants, eq(mealPlanVariants.id, mealPlanMeals.variantId))
    .innerJoin(mealPlans, eq(mealPlans.id, mealPlanVariants.mealPlanId))
    .innerJoin(mealTypes, eq(mealTypes.id, mealPlanMeals.mealTypeId))
    .where(and(eq(mealPlans.userId, userId), isNull(mealPlans.deletedAt), eq(mealPlans.isActive, true)))
  return rows.filter((r): r is EstimateSlot => r.mealTypeId != null)
}

/** Plan meals that already have food logged against them today. A food log carries `mealTypeId`,
 *  so the match is by meal type -- a slot counts as satisfied when its meal type has any food. */
export async function getLoggedPlanMealIds(userId: string, logDate: string): Promise<Set<string>> {
  const slots = await getTodayPlanSlots(userId, logDate)
  const logged = await db
    .selectDistinct({ mealTypeId: foodLogs.mealTypeId })
    .from(foodLogs)
    .where(and(eq(foodLogs.userId, userId), eq(foodLogs.date, logDate), isNull(foodLogs.deletedAt)))
  const types = new Set(logged.map(l => l.mealTypeId))
  return new Set(slots.filter(s => types.has(s.mealTypeId)).map(s => s.planMealId))
}

/** Plan meals with ANY answer row today -- a decline, or an estimate already written. Both mean
 *  "do not estimate this again". */
export async function getAnsweredPlanMealIds(userId: string, logDate: string): Promise<Set<string>> {
  const rows = await db
    .select({ planMealId: planMealAnswers.planMealId })
    .from(planMealAnswers)
    .where(and(
      eq(planMealAnswers.userId, userId),
      eq(planMealAnswers.logDate, logDate),
      isNull(planMealAnswers.deletedAt),
    ))
  return new Set(rows.map(r => r.planMealId))
}
```

- [ ] **Step 2: Confirm the assumption these rest on**

`getLoggedPlanMealIds` matches by **meal type**, because `food_logs` has no `plan_meal_id`. That is
the right call for now — a slot is satisfied when its meal type has food — but it means two plan
meals sharing one meal type are satisfied together. Check whether that is possible:

```bash
psql 'postgresql://postgres:postgres@localhost:5433/trainingai_dev' -c   "SELECT meal_type_id, count(*) FROM meal_plan_meals GROUP BY 1 HAVING count(*) > 1;"
```
Expected: no rows. **If rows come back, stop** — the plan supports two meals in one meal type and the
match must be narrowed (most likely by adding `plan_meal_id` to `food_logs` in Phase B) before this
ships, or one logged snack will silently satisfy two slots.

- [ ] **Step 3: Commit**

```bash
git add lib/data/postgres/slices/meal-plans.ts
git commit -m "Add the three day reads the estimator needs

Logged-slot matching is by meal type because food_logs has no plan_meal_id; the
plan records why and what would force that to change."
```

---

### Task 6: Count estimates in the day's totals — in exactly one place

**Files:**
- Modify: `lib/health/energy-balance-service.ts`
- Test: `lib/health/__tests__/bf203-estimates-in-balance.test.ts`

The domain index calls this *"the one server-side assembly — the route and the AI tool both call it"*. That single home is the whole reason the estimate is not a `food_logs` row.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { assembleEnergyBalance } from '../energy-balance-service'

describe('estimated meals in the day total', () => {
  it('adds estimated calories to intake and reports them separately', async () => {
    const out = await assembleEnergyBalance({
      loggedKcal: 1200,
      estimatedAnswers: [{ estCalories: 480, estProteinG: 30, estCarbsG: 40, estFatG: 10 }],
    } as never)
    expect(out.intakeKcal).toBe(1680)
    expect(out.estimatedKcal).toBe(480)
    expect(out.confirmedKcal).toBe(1200)
  })

  it('reports zero estimated when nothing was assumed', async () => {
    const out = await assembleEnergyBalance({ loggedKcal: 1200, estimatedAnswers: [] } as never)
    expect(out.intakeKcal).toBe(1200)
    expect(out.estimatedKcal).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run lib/health/__tests__/bf203-estimates-in-balance.test.ts`
Expected: FAIL — `out.estimatedKcal` is `undefined`.

- [ ] **Step 3: Merge estimates into the assembly**

In `lib/health/energy-balance-service.ts`, where intake is computed:

```ts
  // BF-203. Estimated answers are the ONLY invented calories in the app and they are added here,
  // in the single server-side assembly, rather than in `food_logs` -- so the maintenance estimator
  // and adaptive TDEE, which read the logs, cannot see them. `estimatedKcal` is reported beside the
  // total so every surface can mark the assumed portion instead of presenting one opaque number.
  const estimatedKcal = estimatedAnswers.reduce((sum, a) => sum + (a.estCalories ?? 0), 0)
  const confirmedKcal = loggedKcal
  const intakeKcal = confirmedKcal + estimatedKcal
```

Return `estimatedKcal` and `confirmedKcal` alongside `intakeKcal`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/health/__tests__/bf203-estimates-in-balance.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/health/energy-balance-service.ts lib/health/__tests__/bf203-estimates-in-balance.test.ts
git commit -m "Count estimated meals in the day total, in the one assembly

Reported as estimatedKcal beside confirmedKcal so a surface can mark the assumed
part rather than showing one number that hides it."
```

---

### Task 7: Prove estimates cannot reach the models that set the goal

**Files:**
- Test: `lib/health/__tests__/bf203-estimates-excluded-from-learners.test.ts`

This is the structural guarantee from the spec, asserted rather than trusted. It is the test that stops the feedback loop the design exists to avoid.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The maintenance estimator and adaptive TDEE derive intake from `food_logs`. If either ever
// learns to read `plan_meal_answers`, the app starts training on its own guesses: estimate ->
// TDEE -> calorie goal -> plan target -> estimate. Nothing outside that loop could catch the drift.
const LEARNERS = [
  'lib/health/maintenance-estimator.ts',
  'lib/health/adaptive-tdee.ts',
]

describe('estimated meals never feed the energy models', () => {
  for (const file of LEARNERS) {
    it(`${file} does not read plan_meal_answers`, () => {
      const src = readFileSync(file, 'utf8')
      expect(src).not.toMatch(/plan_?[Mm]eal_?[Aa]nswers/)
      expect(src).not.toMatch(/estCalories|est_calories/)
    })
  }
})
```

- [ ] **Step 2: Confirm the paths are real before trusting the test**

Run: `ls lib/health/maintenance-estimator.ts lib/health/adaptive-tdee.ts`
Expected: both exist. **If either path is wrong the test passes while asserting nothing** — correct `LEARNERS` to the real module paths before continuing. A green test over a missing file is worse than no test.

- [ ] **Step 3: Run it**

Run: `npx vitest run lib/health/__tests__/bf203-estimates-excluded-from-learners.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/health/__tests__/bf203-estimates-excluded-from-learners.test.ts
git commit -m "Assert the energy models cannot see estimated meals

The feedback loop this design exists to prevent is estimate -> TDEE -> goal ->
plan -> estimate, and nothing outside it would catch the drift."
```

---

### Task 8: Materialise on app open

**Files:**
- Modify: `app/api/nutrition/plan-meal-answers/route.ts`

- [ ] **Step 1: Wire the pure decision to the day's data**

In the GET handler, before returning the day's answers:

```ts
  // BF-203. There is no cron layer (module-map §0), so estimates materialise when the day is read.
  // The hour is resolved in the USER's timezone -- never `new Date().getHours()`, which is the
  // server's.
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const localHour = Number(formatInTimeZone(new Date(), tz, 'H'))
  const today = todayInTz(tz)

  if (logDate === today) {
    const due = dueForEstimate({
      slots: await getTodayPlanSlots(userId, today),
      loggedPlanMealIds: await getLoggedPlanMealIds(userId, today),
      answeredPlanMealIds: await getAnsweredPlanMealIds(userId, today),
      localHour,
      biasKcal: 0, // Phase C supplies this; zero means "estimate at the plan's targets".
    })
    await upsertEstimatedAnswers(userId, today, due)
  }
```

- [ ] **Step 2: Exercise it on the dev server**

Run `pnpm dev`, then with a plan whose first window has closed:
```bash
curl -s 'http://localhost:3000/api/nutrition/plan-meal-answers?date=<today>' | jq
```
Expected: an `estimated` row per closed-window slot with no log, carrying the slot's target macros. Call it twice — the second call must return the **same** rows, not duplicates.

- [ ] **Step 3: Confirm a past date is untouched**

```bash
curl -s 'http://localhost:3000/api/nutrition/plan-meal-answers?date=<yesterday>' | jq
```
Expected: no new estimates. Estimates are written for **today only** — back-filling history would invent meals for days the owner never saw the prompt for.

- [ ] **Step 4: Commit**

```bash
git add app/api/nutrition/plan-meal-answers/route.ts
git commit -m "Materialise estimates when the day is read

No cron layer, so the day's read is the trigger. Today only - back-filling would
invent meals for days the prompt never appeared on."
```

---

### Task 9: Full gate, then open the PR

- [ ] **Step 1: Run the gates with real exit codes**

```bash
pnpm check:rules > /tmp/rules.log 2>&1; echo "check:rules exit=$?"; tail -2 /tmp/rules.log
DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev' pnpm test > /tmp/test.log 2>&1; echo "tests exit=$?"; tail -5 /tmp/test.log
```
Expected: both exit 0. Quote the `Ran N of N` count from `check:rules` rather than the word "pass". **Do not pipe a gate into `tail` and chain a commit off it** — the pipeline reports `tail`'s status, not the gate's.

Run the suite **with `DATABASE_URL` set**: without it roughly 190 DB-backed files skip silently and a green run proves much less than it appears to.

- [ ] **Step 2: Fold in the journal and backlog updates**

Write `docs/overview/entries/<today>-bf203a-estimated-answers.md`, and strike **BF-203a** from `docs/implementation-backlog.md` — in this same PR, per the end-of-session rule.

- [ ] **Step 3: Re-merge main and open the PR**

```bash
git fetch origin main && git merge origin/main
pnpm check:rules > /tmp/rules.log 2>&1; echo "exit=$?"
git push -u origin lane-a/bf203a-estimated-answers
```

---

## Verification for the phase

- An estimate appears only after its window closes, only today, and only where nothing is logged and nothing declined
- Re-reading the day does not duplicate it
- A decline is never converted into an estimate
- The day's ring includes estimated calories, and `estimatedKcal` is available so the UI can mark them
- `food_logs` contains no row this feature wrote — check directly: `SELECT count(*) FROM food_logs WHERE ...` is unchanged across a day of estimates
- **Device pass owed:** materialisation happens on the APK with the local store, not just in the web sandbox, since `getLocalStore` returns null there

## Not in this phase

- The resolve sheet — Phase B
- The corrector; `biasKcal` is hardcoded to 0 until Phase C
- Any change to how the calorie target is derived
