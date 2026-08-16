# Nutrition Scanning & Meal Logging — Design Spec

**Date:** 2026-05-31  
**Status:** Approved  

---

## Overview

A full nutrition logging system integrated into the Health tab. Users can log food via AI photo scan, barcode scan, free-text AI description, saved meal templates, or manual entry. Daily intake is displayed as meal cards grouped by user-defined meal types. Macro targets are user-configurable and stored in the database.

---

## Scope

### In scope
- Camera photo → Gemini 3.1 Flash Lite vision analysis → editable nutrition result
- Free-text description → Gemini 3.1 Flash Lite → editable nutrition result
- Barcode scan → Open Food Facts lookup (native Capacitor plugin + ZXing web fallback)
- Manual entry (no AI)
- Editable review screen for all input methods (calories, protein, carbs, fat, fiber, sugar, sodium, saturated fat)
- Meal type management — fully dynamic, user-defined, DB-stored, seeded with sensible defaults
- Time-of-day auto-suggestion for meal type when logging
- Saved meal templates — collections of food items with quantity multipliers
- One-tap quick-log from saved meal templates
- Custom macro targets (calories, protein, carbs, fat, fiber) stored in DB
- Region/locale setting (default AU) — biases Gemini prompts toward local brands
- Health tab reordered: Nutrition tab first, Body tab second
- Nutrition tab shows daily macro summary ring + meal cards

### Out of scope
- Micronutrients beyond the standard Australian nutrition panel (vitamins, minerals)
- Calorie burn / TDEE calculation
- Recipe management (multi-ingredient cooking)
- Food photo storage (photos are processed in-memory and discarded immediately)
- Social / sharing features

---

## Data Model

### New tables (migration `019_nutrition.sql`)

```sql
-- User-defined meal types
CREATE TABLE meal_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🍽️',
  sort_order INTEGER NOT NULL DEFAULT 0,
  time_start_hour INTEGER NOT NULL DEFAULT 0,  -- 0–23
  time_end_hour INTEGER NOT NULL DEFAULT 24,   -- 1–24
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Food item library (per user, built up over time)
CREATE TABLE food_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  brand TEXT,
  serving_size_g DOUBLE PRECISION NOT NULL DEFAULT 100,
  calories INTEGER NOT NULL,
  protein_g DOUBLE PRECISION NOT NULL DEFAULT 0,
  carbs_g DOUBLE PRECISION NOT NULL DEFAULT 0,
  fat_g DOUBLE PRECISION NOT NULL DEFAULT 0,
  fiber_g DOUBLE PRECISION,
  sugar_g DOUBLE PRECISION,
  sodium_mg DOUBLE PRECISION,
  sat_fat_g DOUBLE PRECISION,
  source TEXT NOT NULL CHECK (source IN ('ai', 'barcode', 'manual', 'text')),
  barcode TEXT,
  region TEXT NOT NULL DEFAULT 'AU',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual food log entries
CREATE TABLE food_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  meal_type_id UUID NOT NULL REFERENCES meal_types(id) ON DELETE RESTRICT,
  food_item_id UUID NOT NULL REFERENCES food_items(id) ON DELETE RESTRICT,
  quantity_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_food_logs_user_date ON food_logs(user_id, date DESC);

-- Saved meal templates
CREATE TABLE saved_meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Items within a saved meal template
CREATE TABLE saved_meal_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_meal_id UUID NOT NULL REFERENCES saved_meals(id) ON DELETE CASCADE,
  food_item_id UUID NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
  quantity_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0
);

-- Per-user macro targets
CREATE TABLE nutrition_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calories INTEGER,
  protein_g DOUBLE PRECISION,
  carbs_g DOUBLE PRECISION,
  fat_g DOUBLE PRECISION,
  fiber_g DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Existing tables — no changes
`body_metrics` is unchanged. It continues to receive Health Connect aggregate data (weight, steps, HRV, etc.) and its `calories/protein_g/carbs_g/fat_g` columns remain for HC compatibility. The Nutrition tab sources its data exclusively from `food_logs`.

### Region setting — users table
A new column `food_region TEXT NOT NULL DEFAULT 'AU'` is added to `users` via the same migration.

---

## Default Meal Types

Seeded per user on first visit to the Nutrition tab (only if `meal_types` has no rows for that user):

| Name | Emoji | Hours |
|---|---|---|
| Breakfast | 🍳 | 06:00–10:00 |
| Morning Snack | 🍎 | 10:00–12:00 |
| Lunch | 🥗 | 12:00–15:00 |
| Afternoon Snack | 🍪 | 15:00–17:00 |
| Dinner | 🍽️ | 17:00–21:00 |
| Evening Snack | 🌙 | 21:00–24:00 |

These are regular DB rows — the user can rename, reorder, add, or delete them freely.

---

## Time-of-Day Meal Suggestion

When the food logger opens, the current local hour is compared against `meal_types` rows for that user. The meal type whose `time_start_hour ≤ hour < time_end_hour` is pre-selected. If the user opened the logger from a specific meal card's `+` button, that meal type is pre-selected instead, overriding the time-based suggestion.

---

## UI Layout

### Health tab reorder
Nutrition becomes the first tab, Body becomes the second. The tab order in `health-content.tsx` is updated accordingly.

### Nutrition tab — day view
```
┌─────────────────────────────────┐
│  Today · Sat 31 May        ⚙️  │  ← gear opens targets + meal type mgmt
│                                 │
│  [Macro summary ring]           │  ← calories consumed / target
│  Protein ██░░░ 142 / 180g      │
│  Carbs   ████░ 210 / 250g      │
│  Fat     ███░░  68 / 80g       │
│                                 │
│  ┌─ 🍳 Breakfast ─────── + ─┐  │
│  │  Oats with banana  350kcal │  │
│  │  Protein shake     150kcal │  │
│  │  Total: 500kcal  P:40 C:55 │  │
│  └───────────────────────────┘  │
│                                 │
│  ┌─ 🥗 Lunch ─────────── + ─┐  │
│  │  (empty)                   │  │
│  └───────────────────────────┘  │
│  ... etc for each meal type     │
└─────────────────────────────────┘
```

Meal cards are ordered by `sort_order`. Tapping a food item in a card opens an edit sheet (change quantity or delete). Tapping `+` opens the food logger wizard.

### Food logger — 3-step wizard (bottom sheet)

**Step 1 — Capture**

Five input method tiles arranged in a 2×3 grid:

```
┌──────────┐ ┌──────────┐
│ 📷       │ │ 🔲       │
│ Scan     │ │ Barcode  │
│ Photo    │ │          │
└──────────┘ └──────────┘
┌──────────┐ ┌──────────┐
│ 💬       │ │ ⭐       │
│ Describe │ │ Saved    │
│ it       │ │ Meals    │
└──────────┘ └──────────┘
┌──────────┐
│ ✏️       │
│ Manual   │
│ Entry    │
└──────────┘
```

- **Scan Photo**: triggers `<input type="file" capture="environment">`, sends base64 to `/api/nutrition/scan`
- **Barcode**: opens native scanner (Capacitor) or ZXing video stream (web), sends code to `/api/nutrition/barcode`
- **Describe it**: shows a single text input + send button; submits text to `/api/nutrition/scan`
- **Saved Meals**: opens saved meals sheet → selecting one skips to Step 3
- **Manual Entry**: skips to Step 2 with all fields blank

**Step 2 — Review & Edit**

Editable form showing the AI/barcode result. Fields:
- Food name (text)
- Brand (text, optional)
- Serving size (g)
- Calories (kcal)
- Protein (g), Carbohydrates (g), Fat (g)
- Fiber (g), Sugar (g), Sodium (mg), Saturated fat (g)

For AI results: confidence badge shown ("AI estimate · medium confidence"). User can adjust any field. A "Save to my food library" toggle (on by default for barcode/AI results) saves the item to `food_items` for future quick-add.

**Step 3 — Assign & Confirm**

- Meal type selector — chips for each of the user's meal types; pre-selected by time of day or tapped card
- Quantity control: ×0.5 / ×1 / ×1.5 / ×2 presets + free numeric input
- Live macro preview updates as quantity changes
- "Save as meal template" option (names the template, adds to `saved_meals`)
- Confirm button logs the entry to `food_logs`

---

## API Routes

All routes under `/api/nutrition/`, all auth-gated.

| Route | Method | Purpose |
|---|---|---|
| `/api/nutrition/scan` | POST | Image (base64) or text → Gemini 3.1 Flash Lite → nutrition JSON |
| `/api/nutrition/barcode` | GET `?code=` | Barcode string → Open Food Facts → nutrition JSON |
| `/api/nutrition/food-logs` | GET `?date=` | List food logs for a date with computed macros |
| `/api/nutrition/food-logs` | POST | Add a food log entry |
| `/api/nutrition/food-logs/[id]` | PATCH | Update quantity multiplier |
| `/api/nutrition/food-logs/[id]` | DELETE | Remove a log entry |
| `/api/nutrition/meal-types` | GET | List user's meal types |
| `/api/nutrition/meal-types` | POST | Create a new meal type |
| `/api/nutrition/meal-types/[id]` | PUT | Update name/emoji/hours/sort_order |
| `/api/nutrition/meal-types/[id]` | DELETE | Delete meal type (blocked if any food_logs reference it) |
| `/api/nutrition/saved-meals` | GET | List saved meal templates with items |
| `/api/nutrition/saved-meals` | POST | Create a saved meal template |
| `/api/nutrition/saved-meals/[id]` | DELETE | Delete a saved meal |
| `/api/nutrition/targets` | GET | Get user's macro targets |
| `/api/nutrition/targets` | PUT | Update macro targets |
| `/api/nutrition/food-items` | GET `?q=` | Search user's food library |

---

## Gemini Integration

### Endpoint: `POST /api/nutrition/scan`

Accepts either:
```json
{ "image": "<base64>", "mimeType": "image/jpeg", "region": "AU" }
```
or:
```json
{ "text": "200g chicken breast with white rice", "region": "AU" }
```

The image is never written to disk or stored — it's passed in-memory to the Gemini API and discarded.

### Prompt (both image and text paths)

```
You are a nutrition expert. The user is in {region}.
{if region === 'AU': "Assume products from Australian supermarkets (Coles, Woolworths, Aldi) where applicable."}

{if image: "Analyse this food photo."}
{if text: "Estimate the nutrition for: {text}"}

Return ONLY valid JSON with this exact shape — no markdown, no explanation:
{
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
  "confidence": "high" | "medium" | "low",
  "notes": "Optional clarification or caveat"
}
```

If the AI cannot identify food, it returns `{ "error": "Could not identify food" }` and the app shows an error state on Step 2.

---

## Barcode Scanning

**Native path (Capacitor APK):**
1. `@capacitor-community/barcode-scanner` opens a native scanner overlay
2. On scan: barcode string passed to `GET /api/nutrition/barcode?code=XXXX`
3. Route calls Open Food Facts: `https://world.openfoodfacts.org/api/v2/product/{code}.json`
4. Extracts `nutriments` fields, maps to our nutrition schema, returns JSON
5. On no match: returns `{ "notFound": true }` → app falls back to Step 2 with only the barcode pre-filled and a "Not found — fill manually" message

**Web/PWA fallback:**
- `@zxing/browser` renders a `<video>` camera stream in the sheet
- `BrowserMultiFormatReader` detects barcode from video frames
- Same API call flow from Step 2 onward

**Detection:** `Capacitor.isNativePlatform()` determines which path to use.

---

## Component Structure

All new components under `components/nutrition/`:

| Component | Purpose |
|---|---|
| `macro-ring.tsx` | Top-of-tab calories ring + macro progress bars |
| `meal-card.tsx` | Expandable card for one meal type showing its food logs |
| `food-logger-sheet.tsx` | 3-step wizard shell (manages step state) |
| `capture-step.tsx` | Step 1 — 5 input method tiles |
| `review-step.tsx` | Step 2 — editable nutrition fields |
| `assign-step.tsx` | Step 3 — meal type selector + quantity + confirm |
| `barcode-scanner.tsx` | Native/web barcode scanner abstraction |
| `saved-meals-sheet.tsx` | List + manage saved meal templates |
| `meal-type-manager.tsx` | CRUD UI for meal types (from gear menu) |
| `nutrition-targets-form.tsx` | Set macro targets (from gear menu) |

`health-content.tsx` becomes a thin orchestrator for the Nutrition tab — it renders `MacroRing` and a list of `MealCard`s. All logic lives in the sub-components.

---

## Region Setting

- Stored as `food_region TEXT NOT NULL DEFAULT 'AU'` on the `users` table (added in `019_nutrition.sql`)
- Editable in Profile → new "Nutrition" settings section
- Passed as `region` in every `/api/nutrition/scan` request body
- Open Food Facts queries are not filtered by region (it has global coverage); region only affects the Gemini prompt

---

## Settings & Management

Accessed via the ⚙️ gear icon in the Nutrition tab header. Opens a sheet with two sections:

**Macro Targets** — numeric inputs for daily calories, protein, carbs, fat, fiber. Saved to `nutrition_targets` table. These drive the progress bars on the summary ring.

**Meal Types** — list of the user's meal types with drag-to-reorder (`@dnd-kit`), edit (name/emoji/hours), and delete. Add new meal type button at the bottom. Delete is blocked (with a warning) if any `food_logs` reference that meal type — the user is prompted to reassign those entries to another meal type first. The `food_logs.meal_type_id` FK uses `ON DELETE RESTRICT` at the DB level to enforce this.

---

## Macro Computation

Macros are never stored redundantly. All computed at query time:

```
actual_calories = food_item.calories × quantity_multiplier
actual_protein  = food_item.protein_g × quantity_multiplier
... etc
```

Daily totals are the sum across all `food_logs` for that `user_id` and `date`.

---

## Error States

| Scenario | Handling |
|---|---|
| AI returns low confidence | Yellow badge on Step 2, user prompted to verify fields |
| AI cannot identify food | Error message on Step 2, all fields blank for manual entry |
| Barcode not in Open Food Facts | "Not found" message, fields blank for manual entry |
| No camera permission | Toast with instruction to enable camera in Android settings |
| Network offline | Toast error; manual entry always available offline |

---

## Migration Checklist

- `019_nutrition.sql` — creates all 6 new tables + `food_region` column on `users`
- Auto-applied by `ensureSchema()` on next cold start
- No data migration needed — all new tables start empty
- `body_metrics` unchanged

---

## Open Questions / Future Work

- **Calorie goal migration**: currently stored in localStorage (`ta_calorie_goal_kcal`). Once `nutrition_targets` exists, Profile should migrate the localStorage value to the DB on first load and clear the localStorage key.
- **Food item search**: a "search my library" input on Step 1 could replace manual entry for repeat foods — scoped to a future iteration.
- **Hydration tracking**: noted in projectOverview as a future data source — the meal type system could accommodate a "Water" food item but a dedicated hydration log is deferred.
