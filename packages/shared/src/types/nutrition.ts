export interface MealType {
  id: string
  userId: string
  name: string
  emoji: string
  sortOrder: number
  timeStartHour: number
  timeEndHour: number
  remindersEnabled: boolean
  required: boolean
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
  /** BF-35. A capped base64 thumbnail, not a URL — `food_items` is read local-first and a URL
   *  renders nothing offline. Absent is the normal case; BF-32's placeholder tile covers it. */
  imageDataUri?: string | null
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
  /** BF-39. The saved meal this row came from, when it came from one. WHAT was eaten. */
  savedMealId?: string | null
  /** BF-39. One id per logging OCCASION. Two servings of the same meal on one day share
   *  `savedMealId` and differ here, which is why the diary groups on this and not on that. */
  mealGroupId?: string | null
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
  /** Portions the recipe makes. `totals` is the WHOLE recipe; divide by this for one portion. */
  servings: number
  /** A small WebP thumbnail as a base64 data URI, or null. Capped — see `nutrition/meal-image.ts`. */
  imageDataUri: string | null
  createdAt: Date
  /**
   * When this meal was last EATEN — `max(food_logs.logged_at)` for it, or null if never.
   *
   * Derived on read, never stored: a "last used" column needs a write on every log and an un-write
   * on every delete, and it is wrong forever the first time either is missed (CLAUDE.md, Stored
   * Counters). Absent from a payload that predates BF-39, so treat `undefined` as unknown rather
   * than as never-used.
   */
  lastUsedAt?: Date | null
  /**
   * Meal types this meal is eligible for (BF-11e), so a planner does not put pancakes at dinner.
   *
   * Soft-deleted meal types are filtered out on read, not deleted from the join table — restoring a
   * type restores its tags. An empty array therefore means "no tags", never "tags we could not
   * resolve". On a WRITE, `undefined` means "not mentioned, leave the stored tags alone" and `[]`
   * means "clear them" — the same distinction `imageDataUri` draws, and load-bearing for the same
   * reason: a save from a surface that has no tag picker must not wipe tags set elsewhere.
   */
  mealTypeIds: string[]
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

export interface NutritionIngredient {
  name: string
  weightG: number
  caloriesPer100g: number
  proteinPer100g: number
  carbsPer100g: number
  fatPer100g: number
  // Client-only stable identity for editable-list rendering (never sent to/from the
  // server) — a refine/new scan replaces the whole array, and keying by index carries
  // stale input/focus state into the wrong row when the ingredient count changes.
  clientId?: string
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
  ingredients?: NutritionIngredient[]
  /** BF-35. Set by the barcode/search routes when Open Food Facts had a thumbnail and it fetched
   *  cleanly. Always optional: a picture must never be able to fail a nutrition lookup. */
  imageDataUri?: string | null
}

// ── Meal Plan (Q-186) ──────────────────────────────────────────────────────────

/** 'all' when one set of macros covers every day; otherwise a 'training'/'rest' pair. */
export type MealPlanDayType = 'all' | 'training' | 'rest'

export type DietaryCategory = 'allergen' | 'diet_pattern' | 'dislike'
export type DietarySeverity = 'avoid' | 'allergy'

export interface DietaryRestriction {
  id: string
  code: string
  label: string
  category: DietaryCategory
  /** Also matched by search, so "milk" finds Dairy and "shellfish" finds Crustacean. */
  synonyms: string[]
  sortOrder: number
}

export interface UserDietaryRestriction {
  restrictionId: string
  code: string
  label: string
  category: DietaryCategory
  severity: DietarySeverity
}

export interface MealPlanMeal {
  id: string
  variantId: string
  mealTypeId: string | null
  savedMealId: string | null
  position: number
  name: string
  notes: string | null
  targetCalories: number
  targetProteinG: number
  targetCarbsG: number
  targetFatG: number
  /** What the meal is actually made of, snapshotted at save time (Q-192). Empty for older plans. */
  ingredients: NutritionIngredient[]
  /** 'HH:MM' local, from the training-time split. Null on plans saved before this was stored. */
  suggestedTime: string | null
}

export interface MealPlanVariant {
  id: string
  mealPlanId: string
  dayType: MealPlanDayType
  targetCalories: number
  targetProteinG: number
  targetCarbsG: number
  targetFatG: number
  meals: MealPlanMeal[]
}

export interface MealPlan {
  id: string
  userId: string
  name: string
  isActive: boolean
  mealsPerDay: number
  targetCalories: number
  targetProteinG: number
  targetCarbsG: number
  targetFatG: number
  /** 'HH:MM' local, or null when the user has no usual training time. */
  trainingTime: string | null
  stores: string[]
  excludedFoods: string[]
  /** The restriction set as it stood at generation time, so an old plan explains itself. */
  restrictionsSnapshot: { code: string; label: string; severity: DietarySeverity }[]
  /** Optional free-text hint, secondary to the structured picker — never a guaranteed filter. */
  avoidNote: string | null
  generatedAt: Date
  lastReviewedAt: Date | null
  createdAt: Date
  updatedAt: Date
  variants: MealPlanVariant[]
}
