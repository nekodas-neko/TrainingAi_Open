# Home Widget Customisation + Nutrition UX + Builder Cycle Length Design

**Date:** 2026-06-07  
**Status:** Approved

---

## Overview

Three independent subsystems:

1. **Home Widget Customisation** — card widget drag-reorder + colour pickers in edit mode, plus scroll-lock bug fix
2. **Nutrition UX** — saved meals management section, food logger tabs, "add new food" escape hatch in meal builder
3. **Builder Cycle Length** — total-weeks wizard step + per-phase editable cycle counts on review screen

---

## Subsystem 1: Home Widget Customisation

### What exists today

- **Metric tiles** (`WIDGET_DEFS`): long-hold drag works via `@dnd-kit/react` + `HomeSortableSection`. Colour picker in edit mode stored in `ta_pill_colors` localStorage.
- **Card widgets** (`CARD_WIDGET_DEFS`, keys: `weightSparkline`, `nutritionDonut`, `sleepWidget`, `stepsWidget`, `moodWidget`): toggleable in Profile but NOT draggable. No colour pickers.
- **Edit mode** (grid icon on home screen): activates drag for metric tiles. Currently locks scroll — pointer sensor captures all events.
- **Profile → Home Widgets**: three subsections — Home Sections toggles, Card Widget toggles, Metric Tile colour+toggle.

### Design

#### Scroll lock fix
Add `activationConstraint: { delay: 250, tolerance: 5 }` to the `PointerSensor` config in `session-select-content.tsx`. This means a pointer must hold still for 250 ms before drag activates — taps and scrolls pass through normally.

#### Card widget drag
Card widgets already render inside `HomeSortableSection`. The drag isn't working because they likely lack the `useSortable` hook or the correct `id` prop that `@dnd-kit/react` requires. Fix: ensure each card section component receives a sortable `id` matching its key, and that it's within the same `DragDropProvider` context as metric tiles.

#### Card widget colour picker
- New localStorage key: `ta_card_colors` — `Record<CardWidgetKey, string>`
- Default colours per card widget key (defined alongside `CARD_WIDGET_DEFS`):
  - `weightSparkline`: `#a78bfa` (purple)
  - `nutritionDonut`: `#34d399` (green)
  - `sleepWidget`: `#60a5fa` (blue)
  - `stepsWidget`: `#fb923c` (orange)
  - `moodWidget`: `#f472b6` (pink)
- In edit mode (grid icon active), each card shows a coloured dot overlay in the top-right corner. Tapping the dot opens a native `<input type="color">` picker.
- The card background applies the same `accentCardStyle(color)` tint used by metric tiles.
- In Profile → Home Widgets → Card Widgets section: add colour dot + picker + reset link next to each card widget toggle, same pattern as metric tiles.

#### Data flow
`session-select-content.tsx`:
- Add `loadCardColors()` helper and `cardColors` state (same pattern as `pillColors`).
- Re-read from localStorage on `visibilitychange` so changes made in Profile are picked up on return.
- Pass `cardColors[key]` to each card section render; apply `accentCardStyle(cardColors[key] ?? defaultColor)`.

`profile-content.tsx`:
- Add `cardColors` state (same pattern).
- Render colour dot + `<input type="color">` + reset link next to each card widget toggle.

---

## Subsystem 2: Nutrition UX

### What exists today

- **Food logger sheet**: single view, searches `food_items` filtered by `userId`. No way to create new items or access saved meals.
- **`searchFoodItems`**: filters by `userId` — only shows items you personally created.
- **`POST /api/nutrition/food-items`**: creates a new food item. Exists but no UI in logger.
- **`saved_meals` + `saved_meal_items` tables**: exist. `POST /api/nutrition/saved-meals` exists.
- **`MealBuilderSheet`**: new component. Searches food items, sets quantities, saves. Lives in Nutrition tab below MacroRing — not prominent.
- **No "Saved Meals" section** on Nutrition tab.

### Design

#### Nutrition tab — Saved Meals section

Add a collapsible "Saved Meals" section at the top of the Nutrition tab content (above MacroRing), containing:
- A list of the user's saved meal templates (name + total kcal/P)
- Tap a meal → logs all its food items to today's food log in one action (client loops over items, each POSTed to `/api/nutrition/food-logs`)
- Long-press → delete option
- "Build meal" button moved here as the primary CTA for this section (replaces the standalone button below MacroRing)

New API needed: `GET /api/nutrition/saved-meals` — returns user's saved meals with items and computed macros.

#### Food logger sheet — tabs

The food logger sheet gets a tab bar at the top with three tabs:

**Recent** (default): existing behaviour — shows previously logged food items filtered by userId, searchable.

**Saved Meals**: lists saved meal templates. Tapping one logs the whole meal (same action as the Nutrition tab section). Shows name, total kcal, macros summary.

**Add Food**: a form to create a new food item:
- Name (required)
- Calories per serving (required)
- Protein / Carbs / Fat (optional)
- Serving size in grams (optional, default 100g)
- On submit → `POST /api/nutrition/food-items` → item is created and immediately selectable in Recent tab

#### Meal builder — "Add new food" escape hatch

In `MealBuilderSheet`, when search returns zero results, show:
```
No results for "{query}".  [+ Add "{query}" as new food]
```
Tapping the link opens an inline mini-form (name pre-filled, calories + macros inputs). On submit: `POST /api/nutrition/food-items`, then immediately adds the new item as an ingredient in the current meal being built.

---

## Subsystem 3: Builder Cycle Length

### What exists today

- Phase cycle lengths are stored as `durationCycles` on `program_phases` rows, which belong to a `phase_set`. Programs reference a `phase_set` via `phaseSetId`.
- The default S+H phase set: Accumulation(4) + Intensification(3) + Peak(2) + Testing(1) + Deload(1) = 11 cycles.
- Cycle counts are never exposed in the wizard — fully hardcoded per phase set.
- Linear programs: no phases, so no cycle concept currently.

### Design

#### BuilderInputs additions

```typescript
totalWeeks: number   // default: sum of durationCycles from selected phase set (e.g. 11 for S+H)
```

#### Wizard — Program Length step

New wizard step inserted between the Phase Structure step and the Schedule step.

UI: heading "How long should the program run?", preset quick-select buttons (8 / 10 / 12 / 14 / 16 / 20 weeks), plus a custom number input. Below the presets, show the recommended length in small text: "Recommended for [S+H Progression]: 11 weeks".

The recommended default is derived from the sum of `durationCycles` for the selected phase set (read from `PHASE_STRUCTURES` data or fetched from the API). For linear mode, default is 12 weeks.

#### Review screen — per-phase cycle editor

In `builder-review.tsx`, within the Phase Progression section (only shown for phase-based programs):

Each phase row gains inline `−` / value / `+` controls for its `durationCycles`. A live "Total: N weeks" counter updates as values change, displayed at the top of the Phase Progression section.

State: `phaseCycles: Record<number, number>` (keyed by phase position), initialised from `program.phases`.

#### On save — phase set cloning

In `handleSave`, compare `phaseCycles` against the original phase set's `durationCycles`. If any differ:
1. Clone the phase set via a new `POST /api/phase-sets/clone` endpoint — sends the phase set ID + overridden `durationCycles` per phase position; returns a new user-owned phase set ID with the modified values.
2. Use the cloned phase set ID in place of the original when saving the program.

If nothing changed, save with the original phase set ID as today.

For **linear programs**: `totalWeeks` is stored on the program as a metadata field. A new `totalWeeks` column is added to the `programs` table (migration). The workout screen uses this to know when the program "ends" (informational only — no automatic phase switching for linear).

#### Prompt update

Pass `totalWeeks` to the generate-program API prompt:
- Phase-based: "Total program length: ${totalWeeks} weeks. Distribute this across phases as you see fit — you may adjust the exact ratios but must keep the same phase order."
- Linear: "Total program length: ${totalWeeks} weeks."

---

## Implementation Order

1. **Subsystem 1** (Home Widget Customisation) — all client-side, no DB, no new API. Scroll fix is a bug.
2. **Subsystem 2** (Nutrition UX) — needs two new API endpoints (`GET /api/nutrition/saved-meals`, bulk log); no migrations (tables exist).
3. **Subsystem 3** (Builder Cycle Length) — needs one DB migration (`programs.totalWeeks`), one new API endpoint (phase set clone), and wizard + review UI changes.

---

## Known Constraints

- `program_phases` belongs to `phase_sets`, not programs. Customising per-program cycles requires cloning the phase set. Cloned sets are user-owned (not shared).
- `searchFoodItems` is user-scoped by design (no global food DB). The "Add Food" tab covers the gap — users build their own library incrementally.
- Card widget colour applies `accentCardStyle` tint — same visual treatment as metric tiles. Both use a soft translucent background derived from the accent hex.
- Linear programs set `phaseMode: 'manual'` and `phaseSetId: null` on save — no phase cycling applies.
