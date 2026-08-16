# Health Screen Reorder + Expanded Home Widgets

**Date:** 2026-06-23
**Status:** Approved

---

## Overview

Two related improvements:

1. **Health screen cards become draggable and reorderable** — long-press to enter edit mode, drag to reorder, per tab. Hide/show controlled from Settings, not from edit mode.
2. **Home screen card widgets expand** — all 19 health card types become available as home screen card widgets, organised into groups. Settings controls visibility on both screens from one place.

---

## 1. Health Screen Edit Mode

### Trigger
Long-press any card on the health screen (Body, Training, or Progress tab) to enter edit mode. Long-press again, or tap outside any card, to exit.

### Visual state in edit mode
- Each card gets a subtle brand-tinted border/background overlay (same colour shift as home screen section edit mode today)
- A drag handle (`⠿`) appears on the left edge of each card
- No pin icon, no hide button — edit mode is reorder-only

### Drag behaviour
- Uses `@dnd-kit/react` with `PointerSensor`, matching the existing home screen implementation
- 300ms long-press activation delay, 8px tolerance
- Cards snap back smoothly on drop

### Persistence
Order saved to localStorage immediately on drop, one key per tab:
- `ta_health_body_order` — string[] of card keys for the Body tab
- `ta_health_training_order` — string[] of card keys for the Training tab
- `ta_health_progress_order` — string[] of card keys for the Progress tab

On first load, if no order key exists, cards render in their current default top-to-bottom order.

### Hidden cards
Cards toggled off in Settings are excluded from rendering but their position is preserved in the saved order array. If a card is re-enabled it returns to its previous position; if it was never in the order array it appends to the end.

---

## 2. Home Screen Card Widgets — Expanded

### New card keys
Extend `CardWidgetKey` in `session-select-content.tsx` with all 19 health card types:

```
// Existing
"weightSparkline" | "nutritionDonut" | "sleepWidget" | "stepsWidget" | "moodWidget"

// New — body
"bodyFatWidget" | "leanMassWidget" | "bmiWidget" | "weightTrendWidget"

// New — daily
"distanceWidget" | "waterWidget" | "caloriesBurnedWidget" | "energyBalanceWidget"

// New — recovery
"rhrWidget" | "hrvWidget" | "spo2Widget" | "ouraIndicatorsWidget" | "ouraSectionWidget"

// New — performance
"trainingLoadWidget" | "sleepPerfWidget" | "injuryWidget"
```

Note: `weightSparkline` (existing) shows body weight + sparkline and maps to the health screen's **Body Weight** card. `weightTrendWidget` (new) is a separate card showing the kg/week linear regression trend.

### Home screen rendering
Each new key gets an inline `case` in the existing switch statement in `session-select-content.tsx`, following the exact same pattern as the existing cards:
- Compact card layout: title, primary value, optional sparkline or bar
- Taps navigate to the relevant tab on the health screen
- Color picker shown in edit mode via `ColorSwatchPicker`
- Data fetched inside the home screen component (new `useEffect` calls for data not already available)

Cards that duplicate data already fetched (e.g. `rhrWidget` can use the body metrics already loaded for `weightSparkline`) reuse that existing state.

### Default colors
Each new card gets a sensible default in `CARD_DEFAULT_COLORS`:

| Key | Color |
|-----|-------|
| bodyFatWidget | #f43f5e |
| leanMassWidget | #22c55e |
| bmiWidget | #a78bfa |
| distanceWidget | #2dd4bf |
| waterWidget | #38bdf8 |
| caloriesBurnedWidget | #f97316 |
| energyBalanceWidget | #00d4ff |
| rhrWidget | #ef4444 |
| hrvWidget | #f97316 |
| spo2Widget | #06b6d4 |
| ouraIndicatorsWidget | #8b5cf6 |
| ouraSectionWidget | #6366f1 |
| trainingLoadWidget | #f59e0b |
| sleepPerfWidget | #8b5cf6 |
| injuryWidget | #ef4444 |

---

## 3. Settings — Home Widgets: Card Widgets (grouped)

The existing flat pill list of card widgets in **Settings → Home Widgets → Card Widgets** is replaced with a grouped layout. Same outlined pill toggle style, same color swatch next to each active card. Groups:

### Home only
Nutrition · Mood

### Body
Weight Trend · Body Fat · Lean Mass · BMI

### Daily
Steps · Distance · Water · Calories Burned · Energy Balance

### Recovery
Sleep · Resting HR · HRV · SpO₂ · Oura Indicators · Oura Section

### Performance
Training Load · Sleep vs Performance · Injury

Group headers are small uppercase labels (same style as "Home Sections" label today). A `reset` link resets all card widgets to the default empty set, same as now.

---

## 4. Settings — Health Screen (new section)

A new expandable row **"Health Screen"** added to the SETTINGS group in `app/more/more-content.tsx` (below Home Widgets), subtitle: _"Manage visible cards"_.

When expanded, shows the same five groups as above with the same pill toggle style. Hidden cards are stored in:

```
ta_health_hidden: string[]   // list of hidden card keys
```

The health screen reads this on mount and excludes hidden cards from rendering and from the drag order.

Group headers, card names, and pill style exactly match the Card Widgets section for visual consistency.

---

## 5. Card Key Reference

All 19 health screen card keys (used in both the health order arrays and `ta_health_hidden`):

**Body tab**
| Key | Label |
|-----|-------|
| `bodyWeight` | Body Weight |
| `bodyFat` | Body Fat % |
| `leanMass` | Lean Mass |
| `bmi` | BMI |
| `weightTrend` | Weight Trend |
| `steps` | Steps |
| `distance` | Distance |
| `ouraIndicators` | Oura Indicators |
| `waterIntake` | Water Intake |
| `caloriesBurned` | Calories Burned |
| `energyBalance` | Energy Balance |
| `rhr` | Resting HR |
| `hrv` | HRV |
| `spo2` | SpO₂ |
| `trainingLoad` | Training Load |
| `sleepVsPerformance` | Sleep vs Performance |
| `injury` | Injury |
| `ouraSection` | Oura Section |

| `sleep` | Sleep |

**Training tab** — keys TBD from health-content.tsx Training tab inspection during implementation

**Progress tab** — keys TBD from health-content.tsx Progress tab inspection during implementation

---

## 6. Data Dependencies for New Home Widgets

Some new home screen widgets need data not currently fetched by the home screen. New fetches required:

| Widget | Data source | Notes |
|--------|-------------|-------|
| bodyFat, leanMass, bmi, weightTrend | `/api/body-metadata` | Already fetched — extend existing state |
| distance, caloriesBurned | `/api/body-metadata` | Same call, additional fields |
| rhr, hrv, spo2 | `/api/body-metadata` | Same call |
| waterIntake | `/api/body-metadata` | Same call |
| energyBalance | `/api/body-metadata` + `/api/nutrition-log` | Nutrition already fetched |
| ouraIndicators, ouraSectionWidget | `/api/oura/stats` | New fetch, cache TTL_SHORT |
| trainingLoad | `/api/readiness-score` | Already fetched |
| sleepVsPerformance | `/api/health/sleep-vs-performance` | New fetch, may be slow — show skeleton |
| injury | `/api/injuries` | New fetch |

Where a new fetch is needed, it only fires when that widget is active (`activeCardWidgets.includes(key)`).

---

## 7. Out of Scope

- Training and Progress tab card keys are enumerated during implementation (not pre-defined here)
- No per-card color picker on health screen cards (health screen edit mode is reorder-only; color pickers remain a home screen concept)
- No animated transition when entering/exiting health screen edit mode (plain colour overlay is sufficient)
- No drag-and-drop on the Settings pill lists themselves (pills are toggle-only, order is drag-controlled from the health/home screens)
