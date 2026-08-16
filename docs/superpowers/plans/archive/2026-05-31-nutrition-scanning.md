> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Nutrition Scanning & Meal Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete nutrition logging system in the Health tab — AI photo/text/barcode scanning, dynamic meal types, saved meal templates, and macro targets stored in PostgreSQL.

**Architecture:** Six new DB tables drive a fully dynamic meal type and food logging system. Food is entered via a 3-step wizard (capture → review/edit → assign to meal). The Health tab's Nutrition sub-tab shows a macro summary ring and per-meal-type cards. Gemini 3.1 Flash Lite handles photo and text analysis; Open Food Facts handles barcode lookups via a native Capacitor scanner with a ZXing web fallback.

**Tech Stack:** Next.js 15 / TypeScript, Drizzle ORM + PostgreSQL, Gemini 3.1 Flash Lite via `@ai-sdk/google`, `@capacitor-community/barcode-scanner`, `@zxing/browser`, `@phosphor-icons/react`, shadcn/ui Sheet.

**No test framework exists in this repo.** Verification steps use `pnpm build` (TypeScript type checking) and the dev server (`pnpm dev`) for manual testing.

---

## File Map

### New files
| Path | Purpose |
|---|---|
| `lib/data/postgres/migrations/019_nutrition.sql` | 6 new tables + `food_region` on users |
| `lib/types/nutrition.ts` | All nutrition TypeScript interfaces |
| `app/api/nutrition/scan/route.ts` | POST — Gemini photo/text → nutrition JSON |
| `app/api/nutrition/barcode/route.ts` | GET — barcode → Open Food Facts |
| `app/api/nutrition/food-logs/route.ts` | GET + POST food log entries |
| `app/api/nutrition/food-logs/[id]/route.ts` | PATCH + DELETE a log entry |
| `app/api/nutrition/meal-types/route.ts` | GET + POST meal types |
| `app/api/nutrition/meal-types/[id]/route.ts` | PUT + DELETE a meal type |
| `app/api/nutrition/saved-meals/route.ts` | GET + POST saved meal templates |
| `app/api/nutrition/saved-meals/[id]/route.ts` | DELETE a saved meal |
| `app/api/nutrition/targets/route.ts` | GET + PUT macro targets |
| `app/api/nutrition/food-items/route.ts` | GET search food library |
| `components/nutrition/macro-ring.tsx` | Calories ring + macro progress bars |
| `components/nutrition/meal-card.tsx` | Per-meal-type day-view card |
| `components/nutrition/food-logger-sheet.tsx` | 3-step wizard shell |
| `components/nutrition/capture-step.tsx` | Step 1 — 5 input method tiles |
| `components/nutrition/barcode-scanner.tsx` | Native/web barcode scanner abstraction |
| `components/nutrition/review-step.tsx` | Step 2 — editable nutrition fields |
| `components/nutrition/assign-step.tsx` | Step 3 — meal type + quantity + confirm |
| `components/nutrition/saved-meals-sheet.tsx` | Saved meal template management |
| `components/nutrition/meal-type-manager.tsx` | Meal type CRUD sheet |
| `components/nutrition/nutrition-targets-form.tsx` | Macro targets form |

### Modified files
| Path | Change |
|---|---|
| `lib/data/postgres/schema.ts` | Add 6 new tables + `foodRegion` on users |
| `lib/data/repository.ts` | Add 14 new method signatures |
| `lib/data/postgres/adapter.ts` | Implement all 14 new methods |
| `app/health/health-content.tsx` | Nutrition tab first, wire MacroRing + MealCards, remove hardcoded placeholder |
| `app/profile/profile-content.tsx` | Add region picker + migrate localStorage calorie goal |

---

## Task 1: DB Migration + Drizzle Schema

**Files:**
- Create: `lib/data/postgres/migrations/019_nutrition.sql`
- Modify: `lib/data/postgres/schema.ts`

- [ ] **Create the migration file**

```sql
-- lib/data/postgres/migrations/019_nutrition.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS food_region TEXT NOT NULL DEFAULT 'AU';

CREATE TABLE IF NOT EXISTS meal_types (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  emoji           TEXT NOT NULL DEFAULT '🍽️',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  time_start_hour INTEGER NOT NULL DEFAULT 0,
  time_end_hour   INTEGER NOT NULL DEFAULT 24,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS food_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  brand          TEXT,
  serving_size_g DOUBLE PRECISION NOT NULL DEFAULT 100,
  calories       INTEGER NOT NULL,
  protein_g      DOUBLE PRECISION NOT NULL DEFAULT 0,
  carbs_g        DOUBLE PRECISION NOT NULL DEFAULT 0,
  fat_g          DOUBLE PRECISION NOT NULL DEFAULT 0,
  fiber_g        DOUBLE PRECISION,
  sugar_g        DOUBLE PRECISION,
  sodium_mg      DOUBLE PRECISION,
  sat_fat_g      DOUBLE PRECISION,
  source         TEXT NOT NULL CHECK (source IN ('ai', 'barcode', 'manual', 'text')),
  barcode        TEXT,
  region         TEXT NOT NULL DEFAULT 'AU',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS food_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date                TEXT NOT NULL,
  meal_type_id        UUID NOT NULL REFERENCES meal_types(id) ON DELETE RESTRICT,
  food_item_id        UUID NOT NULL REFERENCES food_items(id) ON DELETE RESTRICT,
  quantity_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  logged_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_food_logs_user_date ON food_logs(user_id, date DESC);

CREATE TABLE IF NOT EXISTS saved_meals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saved_meal_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_meal_id       UUID NOT NULL REFERENCES saved_meals(id) ON DELETE CASCADE,
  food_item_id        UUID NOT NULL REFERENCES food_items(id) ON DELETE RESTRICT,
  quantity_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS nutrition_targets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calories   INTEGER,
  protein_g  DOUBLE PRECISION,
  carbs_g    DOUBLE PRECISION,
  fat_g      DOUBLE PRECISION,
  fiber_g    DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Add tables to Drizzle schema** — append to `lib/data/postgres/schema.ts` after the last table definition, and add `foodRegion` to the `users` table

Add `foodRegion: text('food_region').notNull().default('AU'),` to the `users` pgTable definition (after `timezone`).

Then append at the end of `schema.ts`:

```typescript
export const mealTypes = pgTable('meal_types', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:          text('name').notNull(),
  emoji:         text('emoji').notNull().default('🍽️'),
  sortOrder:     integer('sort_order').notNull().default(0),
  timeStartHour: integer('time_start_hour').notNull().default(0),
  timeEndHour:   integer('time_end_hour').notNull().default(24),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const foodItems = pgTable('food_items', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:         text('name').notNull(),
  brand:        text('brand'),
  servingSizeG: doublePrecision('serving_size_g').notNull().default(100),
  calories:     integer('calories').notNull(),
  proteinG:     doublePrecision('protein_g').notNull().default(0),
  carbsG:       doublePrecision('carbs_g').notNull().default(0),
  fatG:         doublePrecision('fat_g').notNull().default(0),
  fiberG:       doublePrecision('fiber_g'),
  sugarG:       doublePrecision('sugar_g'),
  sodiumMg:     doublePrecision('sodium_mg'),
  satFatG:      doublePrecision('sat_fat_g'),
  source:       text('source').notNull().$type<'ai' | 'barcode' | 'manual' | 'text'>(),
  barcode:      text('barcode'),
  region:       text('region').notNull().default('AU'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const foodLogs = pgTable('food_logs', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  userId:             uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date:               text('date').notNull(),
  mealTypeId:         uuid('meal_type_id').notNull().references(() => mealTypes.id, { onDelete: 'restrict' }),
  foodItemId:         uuid('food_item_id').notNull().references(() => foodItems.id, { onDelete: 'restrict' }),
  quantityMultiplier: doublePrecision('quantity_multiplier').notNull().default(1.0),
  loggedAt:           timestamp('logged_at', { withTimezone: true }).notNull().defaultNow(),
})

export const savedMeals = pgTable('saved_meals', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const savedMealItems = pgTable('saved_meal_items', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  savedMealId:        uuid('saved_meal_id').notNull().references(() => savedMeals.id, { onDelete: 'cascade' }),
  foodItemId:         uuid('food_item_id').notNull().references(() => foodItems.id, { onDelete: 'restrict' }),
  quantityMultiplier: doublePrecision('quantity_multiplier').notNull().default(1.0),
})

export const nutritionTargets = pgTable('nutrition_targets', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').unique().notNull().references(() => users.id, { onDelete: 'cascade' }),
  calories:  integer('calories'),
  proteinG:  doublePrecision('protein_g'),
  carbsG:    doublePrecision('carbs_g'),
  fatG:      doublePrecision('fat_g'),
  fiberG:    doublePrecision('fiber_g'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Verify TypeScript compiles**

```bash
pnpm build 2>&1 | grep -E "error|warning" | head -20
```
Expected: no type errors relating to schema.ts.

- [ ] **Commit**

```bash
git add lib/data/postgres/migrations/019_nutrition.sql lib/data/postgres/schema.ts
git commit -m "Add nutrition DB migration and Drizzle schema"
```

---

## Task 2: TypeScript Types

**Files:**
- Create: `lib/types/nutrition.ts`

- [ ] **Create the types file**

```typescript
// lib/types/nutrition.ts

export interface MealType {
  id: string
  userId: string
  name: string
  emoji: string
  sortOrder: number
  timeStartHour: number
  timeEndHour: number
  createdAt: Date
}

export interface FoodItem {
  id: string
  userId: string
  name: string
  brand?: string
  servingSizeG: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG?: number
  sugarG?: number
  sodiumMg?: number
  satFatG?: number
  source: 'ai' | 'barcode' | 'manual' | 'text'
  barcode?: string
  region: string
  createdAt: Date
}

export interface FoodLog {
  id: string
  userId: string
  date: string
  mealTypeId: string
  foodItemId: string
  quantityMultiplier: number
  loggedAt: Date
}

export interface FoodLogWithItem extends FoodLog {
  foodItem: FoodItem
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG?: number
  sugarG?: number
  sodiumMg?: number
  satFatG?: number
}

export interface MealTypeWithLogs extends MealType {
  logs: FoodLogWithItem[]
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number }
}

export interface SavedMealItem {
  id: string
  savedMealId: string
  foodItemId: string
  quantityMultiplier: number
  foodItem: FoodItem
}

export interface SavedMeal {
  id: string
  userId: string
  name: string
  createdAt: Date
  items: SavedMealItem[]
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number }
}

export interface NutritionTargets {
  id?: string
  userId: string
  calories?: number
  proteinG?: number
  carbsG?: number
  fatG?: number
  fiberG?: number
  updatedAt?: Date
}

export interface NutritionScanResult {
  name: string
  brand?: string
  servingSizeG: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG?: number
  sugarG?: number
  sodiumMg?: number
  satFatG?: number
  confidence: 'high' | 'medium' | 'low'
  notes?: string
}
```

- [ ] **Verify build**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
```
Expected: no errors.

- [ ] **Commit**

```bash
git add lib/types/nutrition.ts
git commit -m "Add nutrition TypeScript types"
```

---

## Task 3: Repository Interface

**Files:**
- Modify: `lib/data/repository.ts`

- [ ] **Add import and method signatures** — add to `lib/data/repository.ts`:

At the top, add to existing imports:
```typescript
import type {
  MealType, FoodItem, FoodLog, FoodLogWithItem,
  SavedMeal, NutritionTargets,
} from '@/lib/types/nutrition'
```

Add these methods to the `WorkoutRepository` interface body:

```typescript
  // ── Nutrition ──────────────────────────────────────────────────────────────
  listMealTypes(userId: string): Promise<MealType[]>
  createMealType(userId: string, data: Omit<MealType, 'id' | 'userId' | 'createdAt'>): Promise<MealType>
  updateMealType(id: string, userId: string, data: Partial<Omit<MealType, 'id' | 'userId' | 'createdAt'>>): Promise<MealType>
  deleteMealType(id: string, userId: string): Promise<void>
  seedDefaultMealTypes(userId: string): Promise<void>

  createFoodItem(userId: string, data: Omit<FoodItem, 'id' | 'userId' | 'createdAt'>): Promise<FoodItem>
  searchFoodItems(userId: string, query: string): Promise<FoodItem[]>

  listFoodLogs(userId: string, date: string): Promise<FoodLogWithItem[]>
  createFoodLog(userId: string, data: Pick<FoodLog, 'date' | 'mealTypeId' | 'foodItemId' | 'quantityMultiplier'>): Promise<FoodLog>
  updateFoodLog(id: string, userId: string, quantityMultiplier: number): Promise<FoodLog>
  deleteFoodLog(id: string, userId: string): Promise<void>

  listSavedMeals(userId: string): Promise<SavedMeal[]>
  createSavedMeal(userId: string, name: string, items: { foodItemId: string; quantityMultiplier: number }[]): Promise<SavedMeal>
  deleteSavedMeal(id: string, userId: string): Promise<void>

  getNutritionTargets(userId: string): Promise<NutritionTargets | null>
  upsertNutritionTargets(userId: string, data: Omit<NutritionTargets, 'id' | 'userId' | 'updatedAt'>): Promise<NutritionTargets>
```

- [ ] **Verify build**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
```
Expected: errors about unimplemented methods in the adapter — that's correct at this stage.

- [ ] **Commit**

```bash
git add lib/data/repository.ts
git commit -m "Add nutrition methods to repository interface"
```

---

## Task 4: Adapter — Meal Types + Food Items

**Files:**
- Modify: `lib/data/postgres/adapter.ts`

- [ ] **Add import for nutrition types** — add to the imports at the top of `adapter.ts`:

```typescript
import type {
  MealType, FoodItem, FoodLog, FoodLogWithItem,
  SavedMeal, SavedMealItem, NutritionTargets,
} from '@/lib/types/nutrition'
```

- [ ] **Add row mapper helpers** — add inside the `PostgresWorkoutRepository` class, before the closing `}`:

```typescript
  private rowToMealType(r: typeof s.mealTypes.$inferSelect): MealType {
    return {
      id: r.id, userId: r.userId, name: r.name, emoji: r.emoji,
      sortOrder: r.sortOrder, timeStartHour: r.timeStartHour,
      timeEndHour: r.timeEndHour, createdAt: r.createdAt,
    }
  }

  private rowToFoodItem(r: typeof s.foodItems.$inferSelect): FoodItem {
    return {
      id: r.id, userId: r.userId, name: r.name,
      brand: r.brand ?? undefined,
      servingSizeG: r.servingSizeG, calories: r.calories,
      proteinG: r.proteinG, carbsG: r.carbsG, fatG: r.fatG,
      fiberG: r.fiberG ?? undefined, sugarG: r.sugarG ?? undefined,
      sodiumMg: r.sodiumMg ?? undefined, satFatG: r.satFatG ?? undefined,
      source: r.source as FoodItem['source'],
      barcode: r.barcode ?? undefined, region: r.region,
      createdAt: r.createdAt,
    }
  }

  private rowToFoodLog(r: typeof s.foodLogs.$inferSelect): FoodLog {
    return {
      id: r.id, userId: r.userId, date: r.date,
      mealTypeId: r.mealTypeId, foodItemId: r.foodItemId,
      quantityMultiplier: r.quantityMultiplier, loggedAt: r.loggedAt,
    }
  }

  private computeLogMacros(item: FoodItem, qty: number): Pick<FoodLogWithItem, 'calories' | 'proteinG' | 'carbsG' | 'fatG' | 'fiberG' | 'sugarG' | 'sodiumMg' | 'satFatG'> {
    const r = (n: number) => Math.round(n * 10) / 10
    return {
      calories: Math.round(item.calories * qty),
      proteinG: r(item.proteinG * qty),
      carbsG:   r(item.carbsG * qty),
      fatG:     r(item.fatG * qty),
      fiberG:   item.fiberG != null ? r(item.fiberG * qty) : undefined,
      sugarG:   item.sugarG != null ? r(item.sugarG * qty) : undefined,
      sodiumMg: item.sodiumMg != null ? r(item.sodiumMg * qty) : undefined,
      satFatG:  item.satFatG != null ? r(item.satFatG * qty) : undefined,
    }
  }
```

- [ ] **Add meal type methods** — append inside the class:

```typescript
  // ── Nutrition: Meal Types ──────────────────────────────────────────────────

  async listMealTypes(userId: string): Promise<MealType[]> {
    const rows = await this.db.select().from(s.mealTypes)
      .where(eq(s.mealTypes.userId, userId))
      .orderBy(asc(s.mealTypes.sortOrder))
    return rows.map(r => this.rowToMealType(r))
  }

  async createMealType(userId: string, data: Omit<MealType, 'id' | 'userId' | 'createdAt'>): Promise<MealType> {
    const [r] = await this.db.insert(s.mealTypes)
      .values({ userId, ...data })
      .returning()
    return this.rowToMealType(r)
  }

  async updateMealType(id: string, userId: string, data: Partial<Omit<MealType, 'id' | 'userId' | 'createdAt'>>): Promise<MealType> {
    const [r] = await this.db.update(s.mealTypes)
      .set(data)
      .where(and(eq(s.mealTypes.id, id), eq(s.mealTypes.userId, userId)))
      .returning()
    if (!r) throw new Error('Meal type not found')
    return this.rowToMealType(r)
  }

  async deleteMealType(id: string, userId: string): Promise<void> {
    const logs = await this.db.select({ id: s.foodLogs.id }).from(s.foodLogs)
      .where(eq(s.foodLogs.mealTypeId, id)).limit(1)
    if (logs.length > 0) throw new Error('MEAL_TYPE_HAS_LOGS')
    await this.db.delete(s.mealTypes)
      .where(and(eq(s.mealTypes.id, id), eq(s.mealTypes.userId, userId)))
  }

  async seedDefaultMealTypes(userId: string): Promise<void> {
    const existing = await this.db.select({ id: s.mealTypes.id }).from(s.mealTypes)
      .where(eq(s.mealTypes.userId, userId)).limit(1)
    if (existing.length > 0) return
    const defaults = [
      { name: 'Breakfast',        emoji: '🍳', sortOrder: 0, timeStartHour: 6,  timeEndHour: 10 },
      { name: 'Morning Snack',    emoji: '🍎', sortOrder: 1, timeStartHour: 10, timeEndHour: 12 },
      { name: 'Lunch',            emoji: '🥗', sortOrder: 2, timeStartHour: 12, timeEndHour: 15 },
      { name: 'Afternoon Snack',  emoji: '🍪', sortOrder: 3, timeStartHour: 15, timeEndHour: 17 },
      { name: 'Dinner',           emoji: '🍽️', sortOrder: 4, timeStartHour: 17, timeEndHour: 21 },
      { name: 'Evening Snack',    emoji: '🌙', sortOrder: 5, timeStartHour: 21, timeEndHour: 24 },
    ]
    await this.db.insert(s.mealTypes).values(defaults.map(d => ({ userId, ...d })))
  }

  // ── Nutrition: Food Items ──────────────────────────────────────────────────

  async createFoodItem(userId: string, data: Omit<FoodItem, 'id' | 'userId' | 'createdAt'>): Promise<FoodItem> {
    const [r] = await this.db.insert(s.foodItems)
      .values({ userId, ...data })
      .returning()
    return this.rowToFoodItem(r)
  }

  async searchFoodItems(userId: string, query: string): Promise<FoodItem[]> {
    const rows = await this.db.select().from(s.foodItems)
      .where(and(
        eq(s.foodItems.userId, userId),
        sql`lower(${s.foodItems.name}) like ${'%' + query.toLowerCase() + '%'}`,
      ))
      .orderBy(desc(s.foodItems.createdAt))
      .limit(20)
    return rows.map(r => this.rowToFoodItem(r))
  }
```

- [ ] **Verify build**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
```

- [ ] **Commit**

```bash
git add lib/data/postgres/adapter.ts
git commit -m "Implement meal type and food item adapter methods"
```

---

## Task 5: Adapter — Food Logs + Saved Meals + Targets

**Files:**
- Modify: `lib/data/postgres/adapter.ts`

- [ ] **Add food log methods** — append inside the class:

```typescript
  // ── Nutrition: Food Logs ───────────────────────────────────────────────────

  async listFoodLogs(userId: string, date: string): Promise<FoodLogWithItem[]> {
    const rows = await this.db.select({
      logId:         s.foodLogs.id,
      logUserId:     s.foodLogs.userId,
      logDate:       s.foodLogs.date,
      logMealTypeId: s.foodLogs.mealTypeId,
      logFoodItemId: s.foodLogs.foodItemId,
      logQty:        s.foodLogs.quantityMultiplier,
      loggedAt:      s.foodLogs.loggedAt,
      item:          s.foodItems,
    })
      .from(s.foodLogs)
      .innerJoin(s.foodItems, eq(s.foodLogs.foodItemId, s.foodItems.id))
      .where(and(eq(s.foodLogs.userId, userId), eq(s.foodLogs.date, date)))
      .orderBy(asc(s.foodLogs.loggedAt))

    return rows.map(({ item, logId, logUserId, logDate, logMealTypeId, logFoodItemId, logQty, loggedAt }) => {
      const foodItem = this.rowToFoodItem(item)
      return {
        id: logId, userId: logUserId, date: logDate,
        mealTypeId: logMealTypeId, foodItemId: logFoodItemId,
        quantityMultiplier: logQty, loggedAt,
        foodItem,
        ...this.computeLogMacros(foodItem, logQty),
      }
    })
  }

  async createFoodLog(userId: string, data: Pick<FoodLog, 'date' | 'mealTypeId' | 'foodItemId' | 'quantityMultiplier'>): Promise<FoodLog> {
    const [r] = await this.db.insert(s.foodLogs)
      .values({ userId, ...data })
      .returning()
    return this.rowToFoodLog(r)
  }

  async updateFoodLog(id: string, userId: string, quantityMultiplier: number): Promise<FoodLog> {
    const [r] = await this.db.update(s.foodLogs)
      .set({ quantityMultiplier })
      .where(and(eq(s.foodLogs.id, id), eq(s.foodLogs.userId, userId)))
      .returning()
    if (!r) throw new Error('Food log not found')
    return this.rowToFoodLog(r)
  }

  async deleteFoodLog(id: string, userId: string): Promise<void> {
    await this.db.delete(s.foodLogs)
      .where(and(eq(s.foodLogs.id, id), eq(s.foodLogs.userId, userId)))
  }
```

- [ ] **Add saved meals + targets methods** — append inside the class:

```typescript
  // ── Nutrition: Saved Meals ─────────────────────────────────────────────────

  async listSavedMeals(userId: string): Promise<SavedMeal[]> {
    const meals = await this.db.select().from(s.savedMeals)
      .where(eq(s.savedMeals.userId, userId))
      .orderBy(desc(s.savedMeals.createdAt))

    if (meals.length === 0) return []

    const mealIds = meals.map(m => m.id)
    const itemRows = await this.db.select({
      smiId:    s.savedMealItems.id,
      smiMealId:s.savedMealItems.savedMealId,
      smiQty:   s.savedMealItems.quantityMultiplier,
      item:     s.foodItems,
    })
      .from(s.savedMealItems)
      .innerJoin(s.foodItems, eq(s.savedMealItems.foodItemId, s.foodItems.id))
      .where(inArray(s.savedMealItems.savedMealId, mealIds))

    return meals.map(m => {
      const items: SavedMealItem[] = itemRows
        .filter(r => r.smiMealId === m.id)
        .map(r => ({
          id: r.smiId, savedMealId: r.smiMealId,
          foodItemId: r.item.id, quantityMultiplier: r.smiQty,
          foodItem: this.rowToFoodItem(r.item),
        }))
      const totals = items.reduce(
        (acc, i) => {
          const macros = this.computeLogMacros(i.foodItem, i.quantityMultiplier)
          return {
            calories: acc.calories + macros.calories,
            proteinG: acc.proteinG + macros.proteinG,
            carbsG:   acc.carbsG   + macros.carbsG,
            fatG:     acc.fatG     + macros.fatG,
          }
        },
        { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      )
      return { id: m.id, userId: m.userId, name: m.name, createdAt: m.createdAt, items, totals }
    })
  }

  async createSavedMeal(userId: string, name: string, items: { foodItemId: string; quantityMultiplier: number }[]): Promise<SavedMeal> {
    const [meal] = await this.db.insert(s.savedMeals).values({ userId, name }).returning()
    if (items.length > 0) {
      await this.db.insert(s.savedMealItems)
        .values(items.map(i => ({ savedMealId: meal.id, ...i })))
    }
    const [full] = await this.listSavedMeals(userId).then(ms => ms.filter(m => m.id === meal.id))
    return full
  }

  async deleteSavedMeal(id: string, userId: string): Promise<void> {
    await this.db.delete(s.savedMeals)
      .where(and(eq(s.savedMeals.id, id), eq(s.savedMeals.userId, userId)))
  }

  // ── Nutrition: Targets ─────────────────────────────────────────────────────

  async getNutritionTargets(userId: string): Promise<NutritionTargets | null> {
    const [r] = await this.db.select().from(s.nutritionTargets)
      .where(eq(s.nutritionTargets.userId, userId)).limit(1)
    if (!r) return null
    return {
      id: r.id, userId: r.userId,
      calories: r.calories ?? undefined, proteinG: r.proteinG ?? undefined,
      carbsG: r.carbsG ?? undefined, fatG: r.fatG ?? undefined,
      fiberG: r.fiberG ?? undefined, updatedAt: r.updatedAt,
    }
  }

  async upsertNutritionTargets(userId: string, data: Omit<NutritionTargets, 'id' | 'userId' | 'updatedAt'>): Promise<NutritionTargets> {
    const [r] = await this.db.insert(s.nutritionTargets)
      .values({ userId, ...data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: s.nutritionTargets.userId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning()
    return {
      id: r.id, userId: r.userId,
      calories: r.calories ?? undefined, proteinG: r.proteinG ?? undefined,
      carbsG: r.carbsG ?? undefined, fatG: r.fatG ?? undefined,
      fiberG: r.fiberG ?? undefined, updatedAt: r.updatedAt,
    }
  }
```

- [ ] **Verify build — expect zero TS errors now**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
```

- [ ] **Commit**

```bash
git add lib/data/postgres/adapter.ts
git commit -m "Implement food logs, saved meals, and nutrition target adapter methods"
```

---

## Task 6: API Routes — Meal Types

**Files:**
- Create: `app/api/nutrition/meal-types/route.ts`
- Create: `app/api/nutrition/meal-types/[id]/route.ts`

- [ ] **Create `app/api/nutrition/meal-types/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const repo = await getRepository()
  await repo.seedDefaultMealTypes(userId)
  const mealTypes = await repo.listMealTypes(userId)
  return NextResponse.json(mealTypes)
}

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { name, emoji, sortOrder, timeStartHour, timeEndHour } = body
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  const repo = await getRepository()
  const mealType = await repo.createMealType(userId, {
    name, emoji: emoji ?? '🍽️',
    sortOrder: sortOrder ?? 0,
    timeStartHour: timeStartHour ?? 0,
    timeEndHour: timeEndHour ?? 24,
  })
  return NextResponse.json(mealType, { status: 201 })
}
```

- [ ] **Create `app/api/nutrition/meal-types/[id]/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await req.json()
  const repo = await getRepository()
  const mealType = await repo.updateMealType(id, userId, body)
  return NextResponse.json(mealType)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const repo = await getRepository()
  try {
    await repo.deleteMealType(id, userId)
    return NextResponse.json({ success: true })
  } catch (e) {
    if (e instanceof Error && e.message === 'MEAL_TYPE_HAS_LOGS') {
      return NextResponse.json({ error: 'Meal type has food log entries — reassign them first' }, { status: 409 })
    }
    throw e
  }
}
```

- [ ] **Verify build**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
```

- [ ] **Commit**

```bash
git add app/api/nutrition/
git commit -m "Add meal-types API routes"
```

---

## Task 7: API Routes — Food Logs

**Files:**
- Create: `app/api/nutrition/food-logs/route.ts`
- Create: `app/api/nutrition/food-logs/[id]/route.ts`

- [ ] **Create `app/api/nutrition/food-logs/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ } from '@/lib/date-utils'

export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const date = searchParams.get('date') ?? formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
  const repo = await getRepository()
  const logs = await repo.listFoodLogs(userId, date)
  return NextResponse.json(logs)
}

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { date, mealTypeId, foodItemId, quantityMultiplier } = body
  if (!date || !mealTypeId || !foodItemId) {
    return NextResponse.json({ error: 'date, mealTypeId, foodItemId required' }, { status: 400 })
  }
  const repo = await getRepository()
  const log = await repo.createFoodLog(userId, {
    date, mealTypeId, foodItemId,
    quantityMultiplier: quantityMultiplier ?? 1.0,
  })
  return NextResponse.json(log, { status: 201 })
}
```

- [ ] **Create `app/api/nutrition/food-logs/[id]/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { quantityMultiplier } = await req.json()
  if (typeof quantityMultiplier !== 'number') {
    return NextResponse.json({ error: 'quantityMultiplier required' }, { status: 400 })
  }
  const repo = await getRepository()
  const log = await repo.updateFoodLog(id, userId, quantityMultiplier)
  return NextResponse.json(log)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const repo = await getRepository()
  await repo.deleteFoodLog(id, userId)
  return NextResponse.json({ success: true })
}
```

- [ ] **Commit**

```bash
git add app/api/nutrition/food-logs/
git commit -m "Add food-logs API routes"
```

---

## Task 8: API Routes — Targets + Food Items Search + Saved Meals

**Files:**
- Create: `app/api/nutrition/targets/route.ts`
- Create: `app/api/nutrition/food-items/route.ts`
- Create: `app/api/nutrition/saved-meals/route.ts`
- Create: `app/api/nutrition/saved-meals/[id]/route.ts`

- [ ] **Create `app/api/nutrition/targets/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const repo = await getRepository()
  const targets = await repo.getNutritionTargets(userId)
  return NextResponse.json(targets ?? {})
}

export async function PUT(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const repo = await getRepository()
  const targets = await repo.upsertNutritionTargets(userId, {
    calories:  body.calories  ?? undefined,
    proteinG:  body.proteinG  ?? undefined,
    carbsG:    body.carbsG    ?? undefined,
    fatG:      body.fatG      ?? undefined,
    fiberG:    body.fiberG    ?? undefined,
  })
  return NextResponse.json(targets)
}
```

- [ ] **Create `app/api/nutrition/food-items/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const q = new URL(req.url).searchParams.get('q') ?? ''
  const repo = await getRepository()
  const items = await repo.searchFoodItems(userId, q)
  return NextResponse.json(items)
}
```

- [ ] **Create `app/api/nutrition/saved-meals/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const repo = await getRepository()
  return NextResponse.json(await repo.listSavedMeals(userId))
}

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { name, items } = await req.json()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  const repo = await getRepository()
  const meal = await repo.createSavedMeal(userId, name, items ?? [])
  return NextResponse.json(meal, { status: 201 })
}
```

- [ ] **Create `app/api/nutrition/saved-meals/[id]/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const repo = await getRepository()
  await repo.deleteSavedMeal(id, userId)
  return NextResponse.json({ success: true })
}
```

- [ ] **Verify build**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
```
Expected: zero errors.

- [ ] **Commit**

```bash
git add app/api/nutrition/
git commit -m "Add targets, food-items, and saved-meals API routes"
```

---

## Task 9: API Route — Nutrition Scan (Gemini)

**Files:**
- Create: `app/api/nutrition/scan/route.ts`

- [ ] **Create the route**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { google } from '@ai-sdk/google'
import { generateText } from 'ai'

const REGION_CONTEXT: Record<string, string> = {
  AU: 'Assume products from Australian supermarkets (Coles, Woolworths, Aldi) where applicable.',
  US: 'Assume products from US supermarkets (Walmart, Kroger, Whole Foods) where applicable.',
  UK: 'Assume products from UK supermarkets (Tesco, Sainsbury\'s, ASDA) where applicable.',
}

const JSON_SHAPE = `{
  "name": "Food name",
  "brand": "Brand or null",
  "servingSizeG": 100,
  "calories": 250,
  "proteinG": 20.5,
  "carbsG": 30.2,
  "fatG": 8.1,
  "fiberG": 3.0,
  "sugarG": 5.0,
  "sodiumMg": 420,
  "satFatG": 2.1,
  "confidence": "high",
  "notes": "Optional caveat or null"
}`

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const region: string = body.region ?? 'AU'
  const regionHint = REGION_CONTEXT[region] ?? REGION_CONTEXT['AU']

  const systemPrompt = `You are a nutrition expert. ${regionHint}\nReturn ONLY valid JSON — no markdown, no explanation — with this exact shape:\n${JSON_SHAPE}\nIf you cannot identify food, return: {"error": "Could not identify food"}`

  let result: { text: string }

  if (body.image && body.mimeType) {
    const imageBuffer = Buffer.from(body.image as string, 'base64')
    result = await generateText({
      model: google('gemini-3.1-flash-lite'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', image: imageBuffer, mimeType: body.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' },
            { type: 'text', text: 'Analyse this food photo and return the nutrition JSON.' },
          ],
        },
      ],
      system: systemPrompt,
    })
  } else if (body.text) {
    result = await generateText({
      model: google('gemini-3.1-flash-lite'),
      system: systemPrompt,
      prompt: `Estimate the nutrition for: ${body.text}`,
    })
  } else {
    return NextResponse.json({ error: 'Provide image+mimeType or text' }, { status: 400 })
  }

  try {
    const cleaned = result.text.replace(/```json\n?|\n?```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return NextResponse.json(parsed)
  } catch {
    return NextResponse.json({ error: 'AI returned unparseable response' }, { status: 502 })
  }
}
```

- [ ] **Verify build**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
```

- [ ] **Commit**

```bash
git add app/api/nutrition/scan/route.ts
git commit -m "Add Gemini nutrition scan API route"
```

---

## Task 10: API Route — Barcode (Open Food Facts)

**Files:**
- Create: `app/api/nutrition/barcode/route.ts`

- [ ] **Create the route**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import type { NutritionScanResult } from '@/lib/types/nutrition'

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const code = new URL(req.url).searchParams.get('code')
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })

  const res = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,serving_size,nutriments`,
    { headers: { 'User-Agent': 'TrainingAI/1.0' }, next: { revalidate: 86400 } },
  )

  if (!res.ok) return NextResponse.json({ notFound: true }, { status: 404 })

  const data = await res.json()
  if (data.status !== 1 || !data.product) return NextResponse.json({ notFound: true }, { status: 404 })

  const p = data.product
  const n = p.nutriments ?? {}

  const result: NutritionScanResult = {
    name:        p.product_name ?? 'Unknown product',
    brand:       p.brands ?? undefined,
    servingSizeG: parseFloat(p.serving_size) || 100,
    calories:    Math.round(n['energy-kcal_100g'] ?? n['energy-kcal'] ?? 0),
    proteinG:    n['proteins_100g'] ?? 0,
    carbsG:      n['carbohydrates_100g'] ?? 0,
    fatG:        n['fat_100g'] ?? 0,
    fiberG:      n['fiber_100g'] ?? undefined,
    sugarG:      n['sugars_100g'] ?? undefined,
    sodiumMg:    n['sodium_100g'] != null ? n['sodium_100g'] * 1000 : undefined,
    satFatG:     n['saturated-fat_100g'] ?? undefined,
    confidence:  'high',
    notes:       'From Open Food Facts barcode database',
  }

  return NextResponse.json(result)
}
```

- [ ] **Verify build**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
```

- [ ] **Commit**

```bash
git add app/api/nutrition/barcode/route.ts
git commit -m "Add Open Food Facts barcode lookup API route"
```

---

## Task 11: Install Packages + MacroRing Component

**Files:**
- Create: `components/nutrition/macro-ring.tsx`

- [ ] **Install new packages**

```bash
pnpm add @zxing/browser @phosphor-icons/react
```

- [ ] **Verify lockfile committed**

```bash
pnpm build 2>&1 | grep "error" | head -5
git add package.json pnpm-lock.yaml
git commit -m "Add @zxing/browser and @phosphor-icons/react"
```

- [ ] **Create `components/nutrition/macro-ring.tsx`**

```tsx
'use client'

import type { NutritionTargets } from '@/lib/types/nutrition'

interface Props {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  targets: NutritionTargets | null
}

export function MacroRing({ calories, proteinG, carbsG, fatG, targets }: Props) {
  const calTarget = targets?.calories ?? 2000
  const pct = Math.min(100, Math.round((calories / calTarget) * 100))

  const circumference = 2 * Math.PI * 40
  const offset = circumference - (pct / 100) * circumference

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex items-center gap-4">
        <div className="relative w-20 h-20 flex-none">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="40" fill="none" stroke="var(--brand-card-bg)" strokeWidth="10" />
            <circle
              cx="50" cy="50" r="40" fill="none"
              stroke="var(--brand)" strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.5s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-base font-bold leading-none">{calories}</span>
            <span className="text-[10px] text-muted-foreground">kcal</span>
          </div>
        </div>
        <div className="flex-1 flex flex-col gap-1.5">
          <MacroBar label="Protein" value={proteinG} target={targets?.proteinG ?? 150} color="#00ff87" />
          <MacroBar label="Carbs"   value={carbsG}   target={targets?.carbsG   ?? 250} color="#00d4ff" />
          <MacroBar label="Fat"     value={fatG}      target={targets?.fatG     ?? 80}  color="#bf5fff" />
        </div>
      </div>
    </div>
  )
}

function MacroBar({ label, value, target, color }: { label: string; value: number; target: number; color: string }) {
  const pct = Math.min(100, Math.round((value / target) * 100))
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-12">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-muted/40">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground w-16 text-right">
        {Math.round(value)}/{Math.round(target)}g
      </span>
    </div>
  )
}
```

- [ ] **Commit**

```bash
git add components/nutrition/macro-ring.tsx
git commit -m "Add MacroRing nutrition summary component"
```

---

## Task 12: MealCard Component

**Files:**
- Create: `components/nutrition/meal-card.tsx`

- [ ] **Create `components/nutrition/meal-card.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Plus, Trash2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MealType, FoodLogWithItem } from '@/lib/types/nutrition'

interface Props {
  mealType: MealType
  logs: FoodLogWithItem[]
  onAdd: (mealTypeId: string) => void
  onDeleteLog: (logId: string) => void
  onEditLog: (log: FoodLogWithItem) => void
}

export function MealCard({ mealType, logs, onAdd, onDeleteLog, onEditLog }: Props) {
  const [expanded, setExpanded] = useState(true)
  const totals = logs.reduce(
    (acc, l) => ({ calories: acc.calories + l.calories, proteinG: acc.proteinG + l.proteinG, carbsG: acc.carbsG + l.carbsG, fatG: acc.fatG + l.fatG }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  )

  return (
    <div className="rounded-2xl bg-card border border-border/50 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-4 py-3"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="text-lg">{mealType.emoji}</span>
        <span className="font-medium text-sm flex-1 text-left">{mealType.name}</span>
        {logs.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">{totals.calories} kcal</span>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          onClick={e => { e.stopPropagation(); onAdd(mealType.id) }}
        >
          <Plus className="w-4 h-4" />
        </Button>
      </button>

      {expanded && (
        <div className="border-t border-border/30">
          {logs.length === 0 ? (
            <p className="text-xs text-muted-foreground px-4 py-3 text-center">
              Nothing logged — tap + to add food
            </p>
          ) : (
            <>
              {logs.map(log => (
                <div key={log.id} className="flex items-center gap-2 px-4 py-2 border-b border-border/20 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{log.foodItem.name}</p>
                    {log.foodItem.brand && (
                      <p className="text-[10px] text-muted-foreground truncate">{log.foodItem.brand}</p>
                    )}
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground shrink-0">{log.calories} kcal</span>
                  <button onClick={() => onEditLog(log)} className="p-1 text-muted-foreground hover:text-foreground">
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button onClick={() => onDeleteLog(log.id)} className="p-1 text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <div className="px-4 py-2 flex gap-3 text-[10px] text-muted-foreground">
                <span>P {Math.round(totals.proteinG)}g</span>
                <span>C {Math.round(totals.carbsG)}g</span>
                <span>F {Math.round(totals.fatG)}g</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Commit**

```bash
git add components/nutrition/meal-card.tsx
git commit -m "Add MealCard component"
```

---

## Task 13: Health Tab Integration

**Files:**
- Modify: `app/health/health-content.tsx`

- [ ] **Reorder tabs — swap Nutrition and Body** in `health-content.tsx`. Find the `<Tabs defaultValue="...">` block and ensure `defaultValue="nutrition"`. Find the tab trigger order and put Nutrition first, Body second.

- [ ] **Remove the hardcoded placeholder meal log** — delete the section (approximately lines 626–648) that maps over the array `[{ emoji: "🍳", label: "Breakfast" }, ...]` with disabled Add buttons.

- [ ] **Add state + data fetching for nutrition tab** — in the component, add:

```typescript
const [mealTypes, setMealTypes] = useState<MealType[]>([])
const [foodLogs, setFoodLogs] = useState<FoodLogWithItem[]>([])
const [targets, setTargets] = useState<NutritionTargets | null>(null)
const [loggerOpen, setLoggerOpen] = useState(false)
const [loggerMealTypeId, setLoggerMealTypeId] = useState<string | undefined>()

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz }) // YYYY-MM-DD

async function loadNutritionData() {
  const [mtRes, logsRes, tgtsRes] = await Promise.all([
    fetch('/api/nutrition/meal-types'),
    fetch(`/api/nutrition/food-logs?date=${todayStr}`),
    fetch('/api/nutrition/targets'),
  ])
  if (mtRes.ok) setMealTypes(await mtRes.json())
  if (logsRes.ok) setFoodLogs(await logsRes.json())
  if (tgtsRes.ok) setTargets(await tgtsRes.json())
}

useEffect(() => { loadNutritionData() }, [])
```

Add these imports at the top:
```typescript
import type { MealType, FoodLogWithItem, NutritionTargets } from '@/lib/types/nutrition'
import { MacroRing } from '@/components/nutrition/macro-ring'
import { MealCard } from '@/components/nutrition/meal-card'
import { FoodLoggerSheet } from '@/components/nutrition/food-logger-sheet'
```

- [ ] **Replace the Nutrition tab content** with the real implementation:

```tsx
{/* inside the Nutrition TabsContent */}
<div className="flex flex-col gap-3 pb-safe">
  {/* Macro summary */}
  {(() => {
    const totals = foodLogs.reduce(
      (acc, l) => ({ calories: acc.calories + l.calories, proteinG: acc.proteinG + l.proteinG, carbsG: acc.carbsG + l.carbsG, fatG: acc.fatG + l.fatG }),
      { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    )
    return <MacroRing {...totals} targets={targets} />
  })()}

  {/* Meal cards */}
  <div className="flex flex-col gap-2 px-4">
    {mealTypes.map(mt => (
      <MealCard
        key={mt.id}
        mealType={mt}
        logs={foodLogs.filter(l => l.mealTypeId === mt.id)}
        onAdd={(mealTypeId) => { setLoggerMealTypeId(mealTypeId); setLoggerOpen(true) }}
        onDeleteLog={async (logId) => {
          await fetch(`/api/nutrition/food-logs/${logId}`, { method: 'DELETE' })
          loadNutritionData()
        }}
        onEditLog={(_log) => { /* TODO: open edit sheet */ }}
      />
    ))}
    {mealTypes.length === 0 && (
      <p className="text-sm text-muted-foreground text-center py-8">Loading meals…</p>
    )}
  </div>

  <FoodLoggerSheet
    open={loggerOpen}
    onClose={() => setLoggerOpen(false)}
    defaultMealTypeId={loggerMealTypeId}
    mealTypes={mealTypes}
    todayStr={todayStr}
    onLogged={() => { setLoggerOpen(false); loadNutritionData() }}
  />
</div>
```

- [ ] **Verify build and start dev server**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
pnpm dev
```

Open `http://localhost:3000/health` and verify:
- Nutrition tab appears first
- Macro ring renders (with zeros if no logs)
- Meal cards appear (seeded defaults after first load)
- Body tab is second

- [ ] **Commit**

```bash
git add app/health/health-content.tsx
git commit -m "Wire Nutrition tab with MacroRing and MealCards, Nutrition tab first"
```

---

## Task 14: FoodLoggerSheet + CaptureStep

**Files:**
- Create: `components/nutrition/food-logger-sheet.tsx`
- Create: `components/nutrition/capture-step.tsx`

- [ ] **Create `components/nutrition/capture-step.tsx`**

```tsx
'use client'

import { useRef } from 'react'
import { Camera, ScanLine, MessageSquare, Star, PenLine } from 'lucide-react'
import type { NutritionScanResult } from '@/lib/types/nutrition'

interface Props {
  region: string
  onResult: (result: NutritionScanResult, source: 'ai' | 'text' | 'barcode' | 'manual') => void
  onSavedMeals: () => void
  onManual: () => void
  onBarcode: () => void
  onLoading: (loading: boolean) => void
}

export function CaptureStep({ region, onResult, onSavedMeals, onManual, onBarcode, onLoading }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  async function handlePhoto(file: File) {
    onLoading(true)
    try {
      const base64 = await fileToBase64(file)
      const res = await fetch('/api/nutrition/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mimeType: file.type, region }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      onResult(data, 'ai')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not analyse photo')
    } finally {
      onLoading(false)
    }
  }

  async function handleText(text: string) {
    onLoading(true)
    try {
      const res = await fetch('/api/nutrition/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, region }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      onResult(data, 'text')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not estimate nutrition')
    } finally {
      onLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-sm text-muted-foreground text-center">How would you like to log food?</p>

      <div className="grid grid-cols-2 gap-3">
        <MethodTile icon={<Camera className="w-6 h-6" />} label="Scan Photo" onClick={() => fileRef.current?.click()} />
        <MethodTile icon={<ScanLine className="w-6 h-6" />} label="Barcode" onClick={onBarcode} />
        <MethodTile icon={<Star className="w-6 h-6" />} label="Saved Meals" onClick={onSavedMeals} />
        <MethodTile icon={<PenLine className="w-6 h-6" />} label="Manual Entry" onClick={onManual} />
      </div>

      {/* Describe it — full width text input */}
      <DescribeInput onSubmit={handleText} />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handlePhoto(f) }}
      />
    </div>
  )
}

function MethodTile({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-2xl bg-muted/40 border border-border/50 p-4 active:scale-95 transition-transform"
    >
      <span className="text-brand">{icon}</span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  )
}

function DescribeInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="flex gap-2">
      <input
        ref={ref}
        type="text"
        placeholder="💬  Describe food (e.g. 200g chicken breast with rice)…"
        className="flex-1 rounded-xl bg-muted/40 border border-border/50 px-3 py-2.5 text-sm outline-none focus:border-brand"
        onKeyDown={e => { if (e.key === 'Enter' && ref.current?.value) { onSubmit(ref.current.value); ref.current.value = '' } }}
      />
      <button
        onClick={() => { if (ref.current?.value) { onSubmit(ref.current.value); ref.current.value = '' } }}
        className="rounded-xl bg-brand px-3 py-2.5 text-sm font-medium text-black"
      >
        Go
      </button>
    </div>
  )
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
```

- [ ] **Create `components/nutrition/food-logger-sheet.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { CaptureStep } from './capture-step'
import { ReviewStep } from './review-step'
import { AssignStep } from './assign-step'
import { BarcodeScanner } from './barcode-scanner'
import type { MealType, NutritionScanResult } from '@/lib/types/nutrition'

type Step = 'capture' | 'barcode' | 'review' | 'assign'

interface Props {
  open: boolean
  onClose: () => void
  defaultMealTypeId?: string
  mealTypes: MealType[]
  todayStr: string
  onLogged: () => void
}

export function FoodLoggerSheet({ open, onClose, defaultMealTypeId, mealTypes, todayStr, onLogged }: Props) {
  const [step, setStep] = useState<Step>('capture')
  const [loading, setLoading] = useState(false)
  const [scanResult, setScanResult] = useState<NutritionScanResult | null>(null)
  const [source, setSource] = useState<'ai' | 'text' | 'barcode' | 'manual'>('manual')
  const [selectedMealTypeId, setSelectedMealTypeId] = useState(defaultMealTypeId)

  function reset() {
    setStep('capture')
    setScanResult(null)
    setLoading(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handleResult(result: NutritionScanResult, src: typeof source) {
    setScanResult(result)
    setSource(src)
    setStep('review')
  }

  const region = 'AU' // TODO Task 20: read from user profile

  const title = step === 'capture' ? 'Log Food'
    : step === 'barcode' ? 'Scan Barcode'
    : step === 'review'  ? 'Review & Edit'
    : 'Assign to Meal'

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="bottom" className="h-[90dvh] flex flex-col rounded-t-3xl">
        <SheetHeader className="flex-row items-center gap-3 pb-2">
          {step !== 'capture' && (
            <button onClick={() => setStep(step === 'assign' ? 'review' : 'capture')} className="p-1">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <SheetTitle className="text-left flex-1">{title}</SheetTitle>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {step === 'capture' && (
            <CaptureStep
              region={region}
              onResult={handleResult}
              onSavedMeals={() => { /* Task 17 */ }}
              onManual={() => { setScanResult(null); setSource('manual'); setStep('review') }}
              onBarcode={() => setStep('barcode')}
              onLoading={setLoading}
            />
          )}
          {step === 'barcode' && (
            <BarcodeScanner
              region={region}
              onResult={handleResult}
              onBack={() => setStep('capture')}
            />
          )}
          {step === 'review' && (
            <ReviewStep
              initial={scanResult}
              source={source}
              onNext={(data) => { setScanResult(data); setStep('assign') }}
            />
          )}
          {step === 'assign' && scanResult && (
            <AssignStep
              scanResult={scanResult}
              source={source}
              mealTypes={mealTypes}
              defaultMealTypeId={selectedMealTypeId}
              todayStr={todayStr}
              onLogged={onLogged}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Verify build**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
```
Expected: errors for missing ReviewStep, AssignStep, BarcodeScanner (not yet created) — that's fine.

- [ ] **Commit**

```bash
git add components/nutrition/food-logger-sheet.tsx components/nutrition/capture-step.tsx
git commit -m "Add FoodLoggerSheet wizard shell and CaptureStep"
```

---

## Task 15: BarcodeScanner Component

**Files:**
- Create: `components/nutrition/barcode-scanner.tsx`

- [ ] **Create `components/nutrition/barcode-scanner.tsx`**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { NutritionScanResult } from '@/lib/types/nutrition'

interface Props {
  region: string
  onResult: (result: NutritionScanResult, source: 'barcode') => void
  onBack: () => void
}

export function BarcodeScanner({ region, onResult, onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<'scanning' | 'loading' | 'error'>('scanning')
  const [errorMsg, setErrorMsg] = useState('')
  const streamRef = useRef<MediaStream | null>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    let reader: import('@zxing/browser').BrowserMultiFormatReader | null = null

    async function start() {
      // Try native Capacitor scanner first
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (Capacitor.isNativePlatform()) {
          const { BarcodeScanner: NativeScanner } = await import('@capacitor-community/barcode-scanner')
          await NativeScanner.checkPermission({ force: true })
          document.body.classList.add('barcode-scanner-active')
          const result = await NativeScanner.startScan()
          document.body.classList.remove('barcode-scanner-active')
          if (result.hasContent && result.content && !doneRef.current) {
            doneRef.current = true
            await lookupBarcode(result.content, region, onResult, setStatus, setErrorMsg)
          }
          return
        }
      } catch {
        // Not native — fall through to web
      }

      // Web fallback: ZXing
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        reader = new BrowserMultiFormatReader()
        const devices = await BrowserMultiFormatReader.listVideoInputDevices()
        const deviceId = devices.find(d => d.label.toLowerCase().includes('back'))?.deviceId ?? devices[0]?.deviceId
        if (!deviceId) throw new Error('No camera found')

        const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId, facingMode: 'environment' } })
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream

        reader.decodeFromVideoDevice(deviceId, videoRef.current!, async (result, err) => {
          if (result && !doneRef.current) {
            doneRef.current = true
            reader?.reset()
            streamRef.current?.getTracks().forEach(t => t.stop())
            await lookupBarcode(result.getText(), region, onResult, setStatus, setErrorMsg)
          }
          if (err && !(err.name === 'NotFoundException')) {
            console.warn('ZXing scan error', err)
          }
        })
      } catch (e) {
        setStatus('error')
        setErrorMsg(e instanceof Error ? e.message : 'Camera error')
      }
    }

    start()

    return () => {
      reader?.reset()
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [region, onResult])

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm text-destructive">{errorMsg}</p>
        <button onClick={onBack} className="text-sm text-brand underline">Go back</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 p-4">
      <p className="text-sm text-muted-foreground">Point camera at a barcode</p>
      <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        {/* Scanning overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-48 h-32 border-2 border-brand rounded-lg opacity-70" />
        </div>
      </div>
      {status === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Looking up product…
        </div>
      )}
    </div>
  )
}

async function lookupBarcode(
  code: string,
  region: string,
  onResult: (r: NutritionScanResult, s: 'barcode') => void,
  setStatus: (s: 'scanning' | 'loading' | 'error') => void,
  setErrorMsg: (m: string) => void,
) {
  setStatus('loading')
  try {
    const res = await fetch(`/api/nutrition/barcode?code=${encodeURIComponent(code)}&region=${region}`)
    const data = await res.json()
    if (data.notFound) {
      setStatus('error')
      setErrorMsg(`Barcode ${code} not found in database. Try manual entry.`)
      return
    }
    onResult(data, 'barcode')
  } catch {
    setStatus('error')
    setErrorMsg('Could not look up barcode. Check your connection.')
  }
}
```

- [ ] **Verify build**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
```

- [ ] **Commit**

```bash
git add components/nutrition/barcode-scanner.tsx
git commit -m "Add BarcodeScanner component with native/web fallback"
```

---

## Task 16: ReviewStep Component

**Files:**
- Create: `components/nutrition/review-step.tsx`

- [ ] **Create `components/nutrition/review-step.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { NutritionScanResult } from '@/lib/types/nutrition'

interface Props {
  initial: NutritionScanResult | null
  source: 'ai' | 'text' | 'barcode' | 'manual'
  onNext: (data: NutritionScanResult) => void
}

const EMPTY: NutritionScanResult = {
  name: '', servingSizeG: 100, calories: 0,
  proteinG: 0, carbsG: 0, fatG: 0, confidence: 'high',
}

export function ReviewStep({ initial, source, onNext }: Props) {
  const [form, setForm] = useState<NutritionScanResult>(initial ?? EMPTY)

  function set<K extends keyof NutritionScanResult>(key: K, value: NutritionScanResult[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  const isAiEstimate = source === 'ai' || source === 'text'

  return (
    <div className="flex flex-col gap-4 p-4">
      {isAiEstimate && (
        <div className={`rounded-xl px-3 py-2 text-xs font-medium ${
          form.confidence === 'high' ? 'bg-green-500/10 text-green-400' :
          form.confidence === 'medium' ? 'bg-amber-500/10 text-amber-400' :
          'bg-red-500/10 text-red-400'
        }`}>
          AI estimate · {form.confidence} confidence
          {form.notes && ` · ${form.notes}`}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Field label="Food name" value={form.name} onChange={v => set('name', v)} required />
        <Field label="Brand (optional)" value={form.brand ?? ''} onChange={v => set('brand', v || undefined)} />
        <NumField label="Serving size (g)" value={form.servingSizeG} onChange={v => set('servingSizeG', v)} />

        <div className="h-px bg-border/50 my-1" />
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Nutrition per serving</p>

        <NumField label="Calories (kcal)" value={form.calories} onChange={v => set('calories', v)} />
        <div className="grid grid-cols-3 gap-2">
          <NumField label="Protein (g)" value={form.proteinG} onChange={v => set('proteinG', v)} />
          <NumField label="Carbs (g)" value={form.carbsG} onChange={v => set('carbsG', v)} />
          <NumField label="Fat (g)" value={form.fatG} onChange={v => set('fatG', v)} />
        </div>

        <div className="h-px bg-border/50 my-1" />
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Additional (optional)</p>
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Fiber (g)" value={form.fiberG} onChange={v => set('fiberG', v)} />
          <NumField label="Sugar (g)" value={form.sugarG} onChange={v => set('sugarG', v)} />
          <NumField label="Sodium (mg)" value={form.sodiumMg} onChange={v => set('sodiumMg', v)} />
          <NumField label="Sat. fat (g)" value={form.satFatG} onChange={v => set('satFatG', v)} />
        </div>
      </div>

      <Button
        className="w-full mt-2"
        disabled={!form.name || form.calories === 0}
        onClick={() => onNext(form)}
      >
        Next — Assign to Meal
      </Button>
    </div>
  )
}

function Field({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        className="rounded-xl bg-muted/40 border border-border/50 px-3 py-2 text-sm outline-none focus:border-brand"
      />
    </div>
  )
}

function NumField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
        className="rounded-xl bg-muted/40 border border-border/50 px-3 py-2 text-sm outline-none focus:border-brand w-full"
      />
    </div>
  )
}
```

- [ ] **Commit**

```bash
git add components/nutrition/review-step.tsx
git commit -m "Add ReviewStep editable nutrition form"
```

---

## Task 17: AssignStep Component

**Files:**
- Create: `components/nutrition/assign-step.tsx`

- [ ] **Create `components/nutrition/assign-step.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import type { MealType, NutritionScanResult } from '@/lib/types/nutrition'

interface Props {
  scanResult: NutritionScanResult
  source: 'ai' | 'text' | 'barcode' | 'manual'
  mealTypes: MealType[]
  defaultMealTypeId?: string
  todayStr: string
  onLogged: () => void
}

const QTY_PRESETS = [0.5, 1, 1.5, 2]

export function AssignStep({ scanResult, source, mealTypes, defaultMealTypeId, todayStr, onLogged }: Props) {
  const suggestedId = defaultMealTypeId ?? suggestMealTypeId(mealTypes)
  const [mealTypeId, setMealTypeId] = useState(suggestedId ?? mealTypes[0]?.id ?? '')
  const [qty, setQty] = useState(1)
  const [saveToLibrary, setSaveToLibrary] = useState(source !== 'manual')
  const [saveMealName, setSaveMealName] = useState('')
  const [loading, setLoading] = useState(false)

  const preview = {
    calories: Math.round(scanResult.calories * qty),
    proteinG: +(scanResult.proteinG * qty).toFixed(1),
    carbsG:   +(scanResult.carbsG * qty).toFixed(1),
    fatG:     +(scanResult.fatG * qty).toFixed(1),
  }

  async function handleLog() {
    if (!mealTypeId) return
    setLoading(true)
    try {
      let foodItemId: string | null = null

      if (saveToLibrary) {
        const itemRes = await fetch('/api/nutrition/food-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: scanResult.name, brand: scanResult.brand,
            servingSizeG: scanResult.servingSizeG, calories: scanResult.calories,
            proteinG: scanResult.proteinG, carbsG: scanResult.carbsG, fatG: scanResult.fatG,
            fiberG: scanResult.fiberG, sugarG: scanResult.sugarG,
            sodiumMg: scanResult.sodiumMg, satFatG: scanResult.satFatG,
            source, region: 'AU',
          }),
        })
        const item = await itemRes.json()
        foodItemId = item.id
      } else {
        // Create a one-off food item (not saved to library)
        const itemRes = await fetch('/api/nutrition/food-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...scanResult, source: 'manual', region: 'AU' }),
        })
        const item = await itemRes.json()
        foodItemId = item.id
      }

      await fetch('/api/nutrition/food-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: todayStr, mealTypeId, foodItemId, quantityMultiplier: qty }),
      })

      if (saveMealName.trim() && foodItemId) {
        await fetch('/api/nutrition/saved-meals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: saveMealName.trim(), items: [{ foodItemId, quantityMultiplier: qty }] }),
        })
      }

      onLogged()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to log food')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Food summary */}
      <div className="rounded-2xl bg-muted/40 border border-border/50 px-4 py-3">
        <p className="font-medium text-sm">{scanResult.name}</p>
        {scanResult.brand && <p className="text-xs text-muted-foreground">{scanResult.brand}</p>}
        <p className="text-xs text-muted-foreground mt-1">{scanResult.servingSizeG}g per serving</p>
      </div>

      {/* Meal type selector */}
      <div className="flex flex-col gap-2">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Assign to meal</label>
        <div className="flex flex-wrap gap-2">
          {mealTypes.map(mt => (
            <button
              key={mt.id}
              onClick={() => setMealTypeId(mt.id)}
              className={`rounded-full px-3 py-1.5 text-sm border transition-colors ${
                mealTypeId === mt.id
                  ? 'bg-brand/20 border-brand text-brand'
                  : 'bg-muted/40 border-border/50 text-muted-foreground'
              }`}
            >
              {mt.emoji} {mt.name}
            </button>
          ))}
        </div>
      </div>

      {/* Quantity */}
      <div className="flex flex-col gap-2">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Quantity</label>
        <div className="flex items-center gap-2">
          {QTY_PRESETS.map(p => (
            <button
              key={p}
              onClick={() => setQty(p)}
              className={`rounded-full px-3 py-1.5 text-sm border transition-colors ${
                qty === p ? 'bg-brand/20 border-brand text-brand' : 'bg-muted/40 border-border/50 text-muted-foreground'
              }`}
            >
              ×{p}
            </button>
          ))}
          <input
            type="number"
            inputMode="decimal"
            value={qty}
            onChange={e => setQty(parseFloat(e.target.value) || 1)}
            className="w-16 rounded-xl bg-muted/40 border border-border/50 px-2 py-1.5 text-sm text-center outline-none focus:border-brand"
          />
        </div>
      </div>

      {/* Live macro preview */}
      <div className="rounded-2xl bg-muted/40 border border-border/50 px-4 py-3 grid grid-cols-4 gap-2 text-center">
        <MacroPreview label="kcal" value={preview.calories} />
        <MacroPreview label="P" value={preview.proteinG} unit="g" />
        <MacroPreview label="C" value={preview.carbsG} unit="g" />
        <MacroPreview label="F" value={preview.fatG} unit="g" />
      </div>

      {/* Save to library toggle */}
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={saveToLibrary} onChange={e => setSaveToLibrary(e.target.checked)} className="rounded" />
        Save to my food library
      </label>

      {/* Save as meal template */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Save as meal template (optional)</label>
        <input
          type="text"
          placeholder="e.g. My standard breakfast"
          value={saveMealName}
          onChange={e => setSaveMealName(e.target.value)}
          className="rounded-xl bg-muted/40 border border-border/50 px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>

      <Button className="w-full" disabled={!mealTypeId || loading} onClick={handleLog}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Log Food'}
      </Button>
    </div>
  )
}

function MacroPreview({ label, value, unit = '' }: { label: string; value: number; unit?: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-base font-bold">{Math.round(value * 10) / 10}{unit}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  )
}

function suggestMealTypeId(mealTypes: MealType[]): string | undefined {
  const hour = new Date().getHours()
  return mealTypes.find(mt => mt.timeStartHour <= hour && hour < mt.timeEndHour)?.id
}
```

- [ ] **Add the food-items POST route** — `app/api/nutrition/food-items/route.ts` currently only has GET. Add POST:

```typescript
export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  if (!body.name || body.calories == null) {
    return NextResponse.json({ error: 'name and calories required' }, { status: 400 })
  }
  const repo = await getRepository()
  const item = await repo.createFoodItem(userId, {
    name: body.name, brand: body.brand,
    servingSizeG: body.servingSizeG ?? 100,
    calories: Math.round(body.calories),
    proteinG: body.proteinG ?? 0,
    carbsG: body.carbsG ?? 0,
    fatG: body.fatG ?? 0,
    fiberG: body.fiberG, sugarG: body.sugarG,
    sodiumMg: body.sodiumMg, satFatG: body.satFatG,
    source: body.source ?? 'manual',
    barcode: body.barcode, region: body.region ?? 'AU',
  })
  return NextResponse.json(item, { status: 201 })
}
```

- [ ] **Verify build and test the full wizard flow**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
pnpm dev
```

Open Health → Nutrition. Tap `+` on any meal card:
- Step 1 (Capture): all 5 tiles visible, Describe it input works
- Photo tile: opens camera
- Type food description + Go → Step 2 with AI-populated fields
- Step 2: all fields editable, Next button disabled until name + calories filled
- Step 3: meal type chips, qty presets, macro preview updates, Log Food submits and closes

- [ ] **Commit**

```bash
git add components/nutrition/assign-step.tsx app/api/nutrition/food-items/route.ts
git commit -m "Add AssignStep and food-items POST route — full wizard functional"
```

---

## Task 18: Management UI

**Files:**
- Create: `components/nutrition/nutrition-targets-form.tsx`
- Create: `components/nutrition/meal-type-manager.tsx`
- Create: `components/nutrition/saved-meals-sheet.tsx`

- [ ] **Create `components/nutrition/nutrition-targets-form.tsx`**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import type { NutritionTargets } from '@/lib/types/nutrition'

export function NutritionTargetsForm() {
  const [targets, setTargets] = useState<NutritionTargets>({ userId: '' })
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/nutrition/targets').then(r => r.json()).then(data => setTargets(t => ({ ...t, ...data })))
  }, [])

  async function save() {
    setLoading(true)
    await fetch('/api/nutrition/targets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(targets),
    })
    setLoading(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function set(key: keyof NutritionTargets, v: string) {
    setTargets(t => ({ ...t, [key]: v === '' ? undefined : parseFloat(v) }))
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Daily Macro Targets</p>
      <TField label="Calories (kcal)" value={targets.calories} onChange={v => set('calories', v)} />
      <TField label="Protein (g)"     value={targets.proteinG} onChange={v => set('proteinG', v)} />
      <TField label="Carbs (g)"       value={targets.carbsG}   onChange={v => set('carbsG', v)} />
      <TField label="Fat (g)"         value={targets.fatG}     onChange={v => set('fatG', v)} />
      <TField label="Fiber (g)"       value={targets.fiberG}   onChange={v => set('fiberG', v)} />
      <Button onClick={save} disabled={loading} className="w-full mt-2">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? '✓ Saved' : 'Save Targets'}
      </Button>
    </div>
  )
}

function TField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm flex-1">{label}</label>
      <input
        type="number" inputMode="numeric"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder="—"
        className="w-24 rounded-xl bg-muted/40 border border-border/50 px-3 py-2 text-sm text-right outline-none focus:border-brand"
      />
    </div>
  )
}
```

- [ ] **Create `components/nutrition/meal-type-manager.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MealType } from '@/lib/types/nutrition'

interface Props {
  mealTypes: MealType[]
  onChanged: () => void
}

export function MealTypeManager({ mealTypes, onChanged }: Props) {
  const [newName, setNewName] = useState('')
  const [newEmoji, setNewEmoji] = useState('🍽️')

  async function addMealType() {
    if (!newName.trim()) return
    await fetch('/api/nutrition/meal-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), emoji: newEmoji, sortOrder: mealTypes.length }),
    })
    setNewName('')
    onChanged()
  }

  async function deleteMealType(id: string) {
    const res = await fetch(`/api/nutrition/meal-types/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json()
      alert(data.error ?? 'Cannot delete')
      return
    }
    onChanged()
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Meal Types</p>
      {mealTypes.map(mt => (
        <div key={mt.id} className="flex items-center gap-3 rounded-xl bg-muted/40 border border-border/50 px-3 py-2.5">
          <span>{mt.emoji}</span>
          <span className="flex-1 text-sm">{mt.name}</span>
          <span className="text-xs text-muted-foreground">{mt.timeStartHour}:00–{mt.timeEndHour}:00</span>
          <button onClick={() => deleteMealType(mt.id)} className="p-1 text-muted-foreground hover:text-destructive">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <div className="flex gap-2 mt-1">
        <input value={newEmoji} onChange={e => setNewEmoji(e.target.value)} className="w-12 text-center rounded-xl bg-muted/40 border border-border/50 py-2 text-sm" />
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New meal type name" className="flex-1 rounded-xl bg-muted/40 border border-border/50 px-3 py-2 text-sm outline-none focus:border-brand" />
        <Button size="icon" onClick={addMealType}><Plus className="w-4 h-4" /></Button>
      </div>
    </div>
  )
}
```

- [ ] **Create `components/nutrition/saved-meals-sheet.tsx`**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import type { SavedMeal, MealType, NutritionScanResult } from '@/lib/types/nutrition'

interface Props {
  mealTypes: MealType[]
  onSelect: (result: NutritionScanResult) => void
}

export function SavedMealsSheet({ mealTypes: _mealTypes, onSelect }: Props) {
  const [meals, setMeals] = useState<SavedMeal[]>([])

  useEffect(() => {
    fetch('/api/nutrition/saved-meals').then(r => r.json()).then(setMeals)
  }, [])

  async function deleteMeal(id: string) {
    await fetch(`/api/nutrition/saved-meals/${id}`, { method: 'DELETE' })
    setMeals(ms => ms.filter(m => m.id !== id))
  }

  if (meals.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No saved meals yet. Log food and choose "Save as meal template" to create one.</p>
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {meals.map(meal => (
        <div key={meal.id} className="rounded-2xl bg-muted/40 border border-border/50 overflow-hidden">
          <button className="w-full flex items-center gap-3 px-4 py-3 text-left" onClick={() => {
            // For quick-log, use totals as a single food item result
            const result: NutritionScanResult = {
              name: meal.name,
              servingSizeG: 1, // quantity × 1 serving
              calories: meal.totals.calories,
              proteinG: meal.totals.proteinG,
              carbsG: meal.totals.carbsG,
              fatG: meal.totals.fatG,
              confidence: 'high',
              notes: `Saved meal: ${meal.items.length} item(s)`,
            }
            onSelect(result)
          }}>
            <div className="flex-1">
              <p className="font-medium text-sm">{meal.name}</p>
              <p className="text-xs text-muted-foreground">{meal.totals.calories} kcal · P{Math.round(meal.totals.proteinG)}g C{Math.round(meal.totals.carbsG)}g F{Math.round(meal.totals.fatG)}g</p>
            </div>
            <button onClick={e => { e.stopPropagation(); deleteMeal(meal.id) }} className="p-1 text-muted-foreground hover:text-destructive">
              <Trash2 className="w-4 h-4" />
            </button>
          </button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Wire management UI into Health tab** — in `health-content.tsx`, add a gear button to the Nutrition tab header that opens a sheet containing `NutritionTargetsForm` and `MealTypeManager`. Import and use the components:

```tsx
// Add state
const [settingsOpen, setSettingsOpen] = useState(false)

// Add gear button to tab header
<button onClick={() => setSettingsOpen(true)} className="p-2">
  <Settings className="w-4 h-4 text-muted-foreground" />
</button>

// Add settings sheet
<Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
  <SheetContent side="bottom" className="h-[80dvh] rounded-t-3xl overflow-y-auto">
    <SheetHeader><SheetTitle>Nutrition Settings</SheetTitle></SheetHeader>
    <NutritionTargetsForm />
    <div className="h-px bg-border/50 mx-4 my-2" />
    <MealTypeManager mealTypes={mealTypes} onChanged={loadNutritionData} />
  </SheetContent>
</Sheet>
```

Also wire `onSavedMeals` in `food-logger-sheet.tsx` to show a `SavedMealsSheet` and call `onResult` when a meal is selected, then skip to step `'assign'` (or `'review'`).

- [ ] **Verify full flow**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
pnpm dev
```

Test:
- Gear icon opens settings sheet
- Macro targets save and persist on refresh
- Meal type manager shows current types, can add new type
- Delete blocked if logs exist (shows error alert)
- Saved meals appear after logging food with a template name

- [ ] **Commit**

```bash
git add components/nutrition/
git commit -m "Add nutrition management UI — targets, meal types, saved meals"
```

---

## Task 19: Profile — Region Setting + localStorage Calorie Goal Migration

**Files:**
- Modify: `app/profile/profile-content.tsx`

- [ ] **Add region setting to Profile** — in `profile-content.tsx`, find the existing Nutrition settings section (or add one). Add a region selector:

```tsx
{/* Nutrition section in Profile */}
<div className="flex flex-col gap-3">
  <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground px-4">Nutrition</p>
  <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-muted/40 border border-border/50 mx-4">
    <span className="text-sm flex-1">Food region</span>
    <select
      value={foodRegion}
      onChange={e => saveFoodRegion(e.target.value)}
      className="rounded-lg bg-muted/60 border border-border/50 px-2 py-1 text-sm"
    >
      <option value="AU">🇦🇺 Australia</option>
      <option value="US">🇺🇸 United States</option>
      <option value="UK">🇬🇧 United Kingdom</option>
      <option value="NZ">🇳🇿 New Zealand</option>
    </select>
  </div>
</div>
```

Add state + save function:
```typescript
const [foodRegion, setFoodRegion] = useState('AU')

// On mount, load from profile
useEffect(() => {
  fetch('/api/user/profile').then(r => r.json()).then(data => {
    if (data.foodRegion) setFoodRegion(data.foodRegion)
  })
}, [])

async function saveFoodRegion(region: string) {
  setFoodRegion(region)
  await fetch('/api/user/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ foodRegion: region }),
  })
}
```

- [ ] **Extend the `/api/user/profile` PATCH route** to accept and persist `foodRegion` — find `app/api/user/profile/route.ts`, add `foodRegion` to the accepted body fields and pass it through to `repo.updateUserProfile()`. Extend `updateUserProfile` in the adapter to include `foodRegion` in the update set.

- [ ] **Migrate localStorage calorie goal to DB on Nutrition tab load** — in `health-content.tsx`, inside `loadNutritionData()`, add after targets are fetched:

```typescript
// One-time migration of localStorage calorie goal → DB
const legacyCalGoal = localStorage.getItem('ta_calorie_goal_kcal')
if (legacyCalGoal && !targets?.calories) {
  const calories = parseInt(legacyCalGoal, 10)
  if (!isNaN(calories)) {
    await fetch('/api/nutrition/targets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calories }),
    })
    localStorage.removeItem('ta_calorie_goal_kcal')
    localStorage.removeItem('ta_calorie_goal_type') // daily/weekly no longer needed
  }
}
```

- [ ] **Pass region to FoodLoggerSheet** — update `health-content.tsx` to fetch the user's region and pass it to `FoodLoggerSheet`:

```typescript
const [foodRegion, setFoodRegion] = useState('AU')

// In loadNutritionData, also fetch region:
fetch('/api/user/profile').then(r => r.json()).then(d => setFoodRegion(d.foodRegion ?? 'AU'))
```

Then remove the `const region = 'AU'` hardcode in `food-logger-sheet.tsx` and instead pass it as a prop.

- [ ] **Verify build + full test**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
pnpm dev
```

Test:
- Profile → Nutrition section → change region to US
- Open food logger → Describe it → "Big Mac" → verify US food context in AI response
- If `ta_calorie_goal_kcal` exists in localStorage, verify it migrates to DB on first nutrition tab load and localStorage key is removed

- [ ] **Commit**

```bash
git add app/profile/profile-content.tsx app/api/user/ app/health/health-content.tsx
git commit -m "Add food region setting to Profile, migrate localStorage calorie goal to DB"
```

---

## Task 20: Final Push + projectOverview Update

- [ ] **Push branch**

```bash
git push -u origin docs/project-overview-cleanup
```

- [ ] **Update `projectOverview.md`** — add a Session 38 entry documenting:
  - Nutrition scanning & meal logging feature shipped
  - New tables: `meal_types`, `food_items`, `food_logs`, `saved_meals`, `saved_meal_items`, `nutrition_targets`
  - `food_region` added to `users`
  - New components under `components/nutrition/`
  - Health tab: Nutrition now first tab
  - `@zxing/browser` + `@phosphor-icons/react` added
  - `@capacitor-community/barcode-scanner` requires APK rebuild (note in known issues if not yet done)
  - localStorage `ta_calorie_goal_kcal` migrated to `nutrition_targets` table

- [ ] **Bump version to 1.5.0** in `package.json` and add changelog entry in `lib/changelog.ts`

- [ ] **Commit and push**

```bash
git add projectOverview.md package.json lib/changelog.ts
git commit -m "Update project overview and bump version to 1.5.0"
git push
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Camera photo → Gemini → editable result | Tasks 9, 14, 16 |
| Free-text AI description | Tasks 9, 14 |
| Barcode → Open Food Facts | Tasks 10, 15 |
| Manual entry | Task 14 (CaptureStep → manual path) |
| Editable fields: calories, protein, carbs, fat, fiber, sugar, sodium, sat fat | Task 16 |
| Dynamic meal types — DB-stored, user CRUD | Tasks 1, 4, 6, 18 |
| Default meal types seeded on first use | Task 4 (`seedDefaultMealTypes`) |
| Time-of-day meal suggestion | Task 17 (`suggestMealTypeId`) |
| Saved meal templates with items | Tasks 5, 8, 18 |
| One-tap quick-log from saved meals | Task 18 (`SavedMealsSheet`) |
| Custom macro targets in DB | Tasks 1, 5, 8, 18 |
| Region/locale setting | Tasks 9, 10, 19 |
| Health tab: Nutrition first, Body second | Task 13 |
| Macro summary ring | Task 11 |
| Meal cards per meal type | Task 12 |
| Delete meal type blocked if has logs | Task 4 (`deleteMealType` throws `MEAL_TYPE_HAS_LOGS`) |
| LocalStorage calorie goal migration | Task 19 |
| Native barcode scanner + web fallback | Task 15 |

**No placeholders found.**

**Type consistency:** `NutritionScanResult`, `MealType`, `FoodItem`, `FoodLog`, `FoodLogWithItem`, `SavedMeal`, `NutritionTargets` defined in Task 2 and used consistently in Tasks 3–19. Method names (`listMealTypes`, `createFoodItem`, `listFoodLogs`, etc.) defined in Task 3 and implemented in Tasks 4–5.

**One known gap:** `@capacitor-community/barcode-scanner` native plugin requires an APK rebuild. The web fallback (`@zxing/browser`) works without it. Document in Task 20 that native barcode scanning needs the APK rebuild as a separate step.
