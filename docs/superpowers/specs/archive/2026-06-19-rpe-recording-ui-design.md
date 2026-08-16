# RPE Recording UI — Design Spec

**Date:** 2026-06-19  
**Status:** Approved

---

## Overview

Add RPE (Rate of Perceived Exertion) recording to the active set card during a workout. The athlete selects their perceived effort (5–10) before or after logging each set. The value is stored per set in the database alongside weight, reps, and timing data, enabling future correlation with rest time, muscle soreness, and progression.

---

## Set Card Layout Change

The active set card (non-bodyweight) is restructured from two zones to three:

| Zone | Old width | New width | Contents |
|------|-----------|-----------|----------|
| Weight | 55% | ~42% | WeightDial scroll wheel — unchanged |
| Reps | 45% | ~33% | +/number/− column; `intensityPct` moves from floating corner badge to small muted label directly below the rep number |
| RPE strip | — | ~25% | New vertical tap strip — see below |

The `×` separator remains between Weight and Reps. No separator between Reps and RPE — visual distinction via color is sufficient.

---

## RPE Strip

A narrow vertical column of 6 tappable segments inside the card's right zone.

**Values:** 5, 6, 7, 8, 9, 10 — stacked bottom-to-top (5 at bottom, 10 at top).

**Colors (bottom → top):**
- 5 → green (`#22c55e`)
- 6 → lime (`#84cc16`)
- 7 → yellow (`#eab308`)
- 8 → amber (`#f59e0b`)
- 9 → orange (`#f97316`)
- 10 → red (`#ef4444`)

**Segment states:**
- **Unselected:** faint transparent tint of the segment color, dim number
- **Selected:** full opaque colored fill, white bold number, subtle color-matched glow

**Header:** small `RPE` label above the strip.

**Interaction:** tap any segment to select. No drag required.

**Bodyweight exercises:** strip is shown the same way — no pct reference, so defaults to RPE 7.

---

## Default RPE Calculation

Uses the RTS (Reactive Training Systems) 1-rep RPE chart, derived from `intensityPct`:

| intensityPct | Default RPE |
|---|---|
| ≥ 100% | 10 |
| ≥ 94% | 9 |
| ≥ 88% | 8 |
| ≥ 82% | 7 |
| ≥ 76% | 6 |
| < 76% | 5 |
| not available | 7 |

Fallback when no `intensityPct` is available (bodyweight exercise, no 1RM on file yet): **RPE 7** — a neutral middle-of-scale default for a working set.

The default is applied when the exercise loads (rpeValues initialized in the store). The athlete can override any set's RPE before or after tapping "Log Set".

---

## Completed Set Cards

Done set cards (already logged) gain a small coloured RPE badge alongside the existing set time / rest time display. The badge uses the same color scale as the strip — e.g. a green pill for RPE 5, a red pill for RPE 10. Only shown if an RPE value was recorded for that set.

---

## Data Model

**New DB column:**
```sql
ALTER TABLE set_logs ADD COLUMN rpe integer;
```
Nullable — historical sets have no RPE value, which is valid.

**Drizzle schema** (`lib/data/postgres/schema.ts`):
```ts
rpe: integer('rpe'),
```

**Migration file:** `lib/data/postgres/migrations/077_rpe_set_logs.sql`

---

## Data Flow

```
workout-store.rpeValues[]
  → workout-screen (reads snapshot on log)
    → active-workout-screen (passes rpeValues + onRpeChange)
      → SetCard (displays strip, calls onRpeChange on tap)
  → /api/log-exercise (rpeValues array in POST body)
    → set_logs.rpe (persisted per set)
  → writeLocalWorkout (offline payload includes rpe per set)
```

---

## Store Changes (`lib/stores/workout-store.ts`)

**New state:**
```ts
rpeValues: number[]   // one per set, initialized with RTS defaults on exercise load
```

**New action:**
```ts
setRpeValue: (setIdx: number, value: number) => void
```

**Initialization:** when `setReps` / `setSets` / `setPerSetWeights` is called (exercise loads), `rpeValues` is reset to an array of defaults derived from each set's `intensityPct` via the RTS chart.

---

## API Changes (`app/api/log-exercise/route.ts`)

New optional field in `LogExerciseSchema`:
```ts
rpeValues: z.array(z.number().int().min(5).max(10)).optional()
```

Threaded into `setData` per index:
```ts
rpe: rpeValues?.[i],
```

---

## Repository Changes

**`lib/data/repository.ts`** — `SetLogData` type gains:
```ts
rpe?: number
```

**`lib/data/postgres/adapter.ts`** — `logExerciseAndSets` passes `rpe` through to the `set_logs` insert.

---

## Files Changed

| File | Change |
|------|--------|
| `lib/data/postgres/migrations/077_rpe_set_logs.sql` | New — adds `rpe` column |
| `lib/data/postgres/schema.ts` | Add `rpe: integer('rpe')` to `setLogs` |
| `lib/data/repository.ts` | Add `rpe?: number` to `SetLogData` |
| `lib/data/postgres/adapter.ts` | Pass `rpe` in set insert |
| `lib/stores/workout-store.ts` | Add `rpeValues` state + `setRpeValue` action |
| `app/api/log-exercise/route.ts` | Accept + thread `rpeValues` |
| `components/workout/set-card.tsx` | New RPE strip zone, pct below reps, RPE badge on done cards |
| `components/workout/active-workout-screen.tsx` | Pass `rpeValues` + `onRpeChange` to SetCard |
| `components/workout-screen.tsx` | Subscribe to store `rpeValues`, initialize defaults, include in API payload |

---

## Out of Scope

- RPE analytics / charts (future session)
- RPE on bodyweight AddedWeightToggle path (same strip, different layout — included as-is)
- Editing RPE on historical set logs
