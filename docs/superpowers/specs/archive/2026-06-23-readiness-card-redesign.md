# Readiness Card Redesign

**Date:** 2026-06-23  
**Status:** Approved

## Problem

The current readiness card is too tall (~120px) for the information density it provides. It uses emojis instead of icons, and does not surface Oura's four core pillars (Readiness, Sleep, Activity, HR) in a scannable way. The ACWR penalty is also incorrectly applied during the first 28 days of a new program when chronic load data doesn't reflect the new program's volume.

## Goal

A compact, tappable readiness card that:
- Takes up ~52px collapsed (vs ~120px today)
- Shows all four Oura pillars as icon+value chips
- Uses Lucide icons — no emojis anywhere
- Expands on tap to show full scoring breakdown and contributor bars
- Skips ACWR adjustment for the first 28 days of a new program

---

## Collapsed State

Single horizontal row inside a rounded card. Tappable anywhere to expand.

**Layout (left to right):**

1. **Score arc** — 44×44px SVG ring. Stroke filled proportionally to score (0–100). Color by label:
   - High (≥70): green (`#22c55e`)
   - Moderate (45–69): amber (`#f59e0b`)
   - Low (<45): red (`#ef4444`)
   - Score number centered inside arc, same color, `text-sm font-bold tabular-nums`

2. **Label block** — flush right of arc:
   - `"READINESS"` in 9px uppercase tracking label, muted
   - `"Moderate"` (label value) in 13px semibold, same color as arc

3. **Vertical divider** — 1px, 28px tall, muted

4. **Metric chips** — three chips in a row, each: `Icon + value` in a small pill with muted background:
   - `MoonIcon` + Oura sleep score (e.g. `83`)
   - `ZapIcon` + Oura activity score (e.g. `71`)
   - `HeartIcon` + most recent HR bpm (e.g. `68`)
   - If a value is null: icon + `—` in muted style (placeholder, not hidden)

5. **Chevron** — `ChevronDownIcon` at far right, rotates 180° when expanded

---

## Expanded State

Slides open below the collapsed row using a smooth height transition. Divided into sections with `border-t` separators.

### Section 1 — Score Breakdown

How the blended readiness score was derived. Small table layout:

| Row | Icon | Label | Value |
|-----|------|-------|-------|
| Always | `CircleDotIcon` | Oura base | e.g. `80` |
| If ACWR adj ≠ 0 | `ZapIcon` | Load (ACWR) | e.g. `−12` (amber if negative, green if positive) |
| If temp dev ≠ 0 | `ThermometerIcon` | Temp deviation | e.g. `−3` (amber) |
| Always | — | **Final** | `65` (bold, color-coded) |

### Section 2 — Readiness Contributors

Bars for each key in `readinessContributors`. All contributors shown (not just flagged ones). Color by value:
- ≥70: green
- 45–69: amber
- <45: red

Thin 4px bars. Key names formatted: `snake_case` → `Title Case`.

### Section 3 — Sleep Contributors

Same bar format using `sleepContributors` JSONB from `oura_daily`. Only rendered if data exists.

### Section 4 — Activity Contributors

Same bar format using `activityContributors` JSONB from `oura_daily`. Only rendered if data exists.

### Section 5 — Heart Rate Today

Four stat tiles in a 2×2 grid:
- Current (most recent reading)
- Min
- Avg
- Max

Each: small label above, `bpm` value in semibold. Null if no data for today.

### Section 6 — Early Deload Warning

Only shown if `earlyDeloadRecommended === true`. Amber `AlertTriangleIcon` + one-line message: `"High training load — consider a deload week"`.

---

## Backend — Readiness Score API Changes

**File:** `app/api/readiness-score/route.ts`

### New response fields

```ts
activityScore: number | null        // ouraToday?.activityScore ?? null
activityContributors: Record<string, number | null> | null
hrCurrent: number | null            // most recent bpm today
hrMin: number | null
hrAvg: number | null
hrMax: number | null
```

### HR computation

Call `repo.getHrForWindow(userId, todayMidnight, tomorrowMidnight)`.  
From the returned rows: `hrCurrent` = last row's bpm, `hrMin/Avg/Max` = aggregate over all rows.  
If no rows: all four null.

### ACWR grace period

After fetching `program` (already fetched for `earlyDeloadRecommended`), compute:

```ts
const programAgeMs = program?.startedAt
  ? todayMid.getTime() - new Date(program.startedAt).getTime()
  : Infinity
const acwr = hasEnoughHistory && chronicAvg > 100 && programAgeMs >= 28 * 86_400_000
  ? acuteLoad / chronicAvg
  : null
```

No change to response shape — `acwr` is internal. Effect: load defaults to neutral `5/10` and no ACWR modifier is applied to the blended score during the first 28 days of a new program.

---

## Component Structure

### New file: `components/readiness-card.tsx`

Props: `{ readiness: ReadinessScoreResponse }`

Internal state: `expanded: boolean` (default false).

Sub-components (within same file, not exported):
- `ScoreArc` — SVG ring + centered number
- `MetricChip` — icon + value pill
- `ContributorBars` — section header + bar list for a contributors object
- `HrStats` — 2×2 grid of Current/Min/Avg/Max

### Updated file: `components/overview-screen.tsx`

Replace the inline readiness block (lines 277–332) with:
```tsx
{readiness && <ReadinessCard readiness={readiness} />}
```

Add import for `ReadinessCard`. No other changes to this file.

---

## Icons Used (all Lucide)

| Metric | Icon |
|--------|------|
| Sleep | `MoonIcon` |
| Activity | `ZapIcon` |
| Heart Rate | `HeartIcon` |
| Oura base score | `CircleDotIcon` |
| ACWR / Load | `ZapIcon` |
| Temperature | `ThermometerIcon` |
| Deload warning | `AlertTriangleIcon` |
| Expand/collapse | `ChevronDownIcon` |

---

## Out of Scope

- Garmin Body Battery metric (noted as future interest, not designed here)
- HR time series chart in expanded view (current/min/avg/max tiles only)
- Clicking individual contributor bars for detail
- ACWR display in the collapsed chip row (adjustment only shown in expanded breakdown)
