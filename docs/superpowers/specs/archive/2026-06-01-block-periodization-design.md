# Block Periodization — Design Spec

**Date:** 2026-06-01  
**Status:** Approved — ready for implementation planning

---

## Overview

Adds optional **block periodization** to the program system. Programs can define an ordered phase sequence (e.g. Accumulation → Intensification → Peak → Deload). The app tracks the current phase, applies the correct progression style per exercise automatically, and handles deload weeks either on schedule or when fatigue data triggers one early.

### Two modes

- **Manual** (current behaviour) — each exercise has one fixed progression style. No phases, no cycling. Nothing changes for existing users.
- **Automatic** (new) — program has a phase sequence. The app advances through phases cycle-by-cycle and applies the correct style to each exercise automatically.

---

## Exercise Roles

Each exercise in a program session is assigned one of three roles. Role governs phase cycling behaviour.

| Role | Phase cycling | Peak phase | Deload behaviour |
|---|---|---|---|
| **Primary compound** | Full — all phases | ✅ Yes | 50% sets, 60% 1RM |
| **Secondary compound** | Partial — skips Peak (stays on preceding non-Peak phase style) | ❌ No | 50% sets, 60% 1RM |
| **Accessory / Isolation** | None — fixed style always | ❌ No | 50% sets, same weight |

Default role: `primary`. User changes it per exercise in the program editor.

---

## Data Model

### New table: `program_phases`

```sql
CREATE TABLE program_phases (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id          UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  position            INTEGER NOT NULL,
  name                TEXT NOT NULL,
  duration_cycles     INTEGER NOT NULL CHECK (duration_cycles >= 1),
  phase_type          TEXT NOT NULL DEFAULT 'normal' CHECK (phase_type IN ('normal', 'deload')),
  primary_style_id    UUID REFERENCES progression_styles(id) ON DELETE SET NULL,
  secondary_style_id  UUID REFERENCES progression_styles(id) ON DELETE SET NULL,
  -- Both null on deload phases — auto-deload logic applies instead
  -- secondary_style_id falls back to primary_style_id when null
  UNIQUE (program_id, position)
);
```

**Why cycles, not weeks:** A calendar week is ambiguous for rotation-based schedules. A 3-on/1-off rotation can produce 3–6 sessions in a single 7-day window depending on where the week falls in the cycle. One cycle (one complete rotation through all program sessions) is the correct atomic unit — it represents the same training stimulus regardless of calendar time.

### Changes to existing tables

**`programs`** — 4 new columns:
- `phase_mode TEXT NOT NULL DEFAULT 'manual'` — `'manual'` or `'automatic'`
- `started_at DATE` — when the current block started; null in manual mode. **Always defaults to today when Automatic mode is first enabled — never auto-populated from historical workout dates.** User can manually backdate if desired.
- `sessions_per_cycle INTEGER` — snapshot of `COUNT(program_sessions)` taken when `started_at` is set. Frozen for the duration of the block so adding/removing sessions mid-block does not retroactively alter cycle counts. Recalculated only when the user explicitly starts a new block. If the program later has a different session count, the editor shows: *"This block uses N sessions per cycle (snapshotted at start). Changes take effect next block."*
- `early_deload_week_start DATE` — set when user confirms a data-driven early deload. Any session logged within the **7-day window starting from this date** is treated as a deload. **Never deleted — the phase engine treats it as cleared when `today > early_deload_week_start + 7 days`.** "Calendar week" language is avoided — the window is always exactly 7 days from the confirmation date regardless of day-of-week.

**`session_exercises`** — 1 new column:
- `exercise_role TEXT NOT NULL DEFAULT 'primary'` — `'primary'`, `'secondary'`, or `'accessory'`

**`workout_sessions`** — 2 new columns:
- `phase_id UUID REFERENCES program_phases(id) ON DELETE SET NULL` — which phase was active when this session was logged; null in manual mode. `ON DELETE SET NULL` means editing or removing a phase sequence does not delete historical session records — sessions simply lose their phase reference.
- `is_early_deload BOOLEAN NOT NULL DEFAULT FALSE` — stamped true at log time when an early deload week is active; used for historical metric exclusions

No changes to `set_logs` or `exercise_logs`. Deload exclusions are derived via `workout_sessions.phase_id → program_phases.phase_type` or `workout_sessions.is_early_deload = true`.

---

## Phase Engine

**New file: `lib/phase-engine.ts`** — pure utility functions, no DB calls. Takes the phase array, session counts, and today as inputs.

### Inputs

The phase engine receives from the calling API route (no DB calls inside the engine):
- `phases: ProgramPhase[]` — ordered phase array
- `sessionsPerCycle: number` — frozen snapshot from `programs.sessions_per_cycle` (set at block start, not live session count)
- `sessionsLoggedSinceStart: number` — count of `workout_sessions` logged after `programs.started_at`, **excluding sessions where `is_early_deload = true`**. Query join path: `workout_sessions.program_session_id → program_sessions.id → programs.id`, filtered to the active program and `started_at` date.
- `today: Date` — for approximate week display only
- `avgSessionsPerWeek: number` — computed by the calling API route as `sessionsLoggedSinceStart / daysSinceStart * 7`, used only in `approxWeeksRemaining`. Falls back to `sessionsPerCycle` (one cycle per week) if fewer than 7 days have elapsed.

**Deload phase sessions DO count toward their phase's cycle progression.** Sessions logged during a scheduled deload phase (`phase_type === 'deload'`) are included in `sessionsLoggedSinceStart` — the user still trains (at reduced load) and needs to complete those cycles before the next phase begins. Only `is_early_deload` unscheduled sessions are excluded.

### Current phase calculation

```ts
completedCycles = floor(sessionsLoggedSinceStart / sessionsPerCycle)
sessionInCurrentCycle = sessionsLoggedSinceStart % sessionsPerCycle

// Walk phases in order, accumulating duration_cycles
// current phase = first phase where accumulated cycles > completedCycles
// cycleInPhase = completedCycles - cyclesBeforeThisPhase + 1  (1-indexed for display)
```

A cycle completes every time the user has logged `sessionsPerCycle` sessions since the block started. Skipped sessions do not advance the cycle — phases advance based on actual work done, not time elapsed.

**Display convention:** `cycleInPhase` is 1-indexed. `completedCyclesInThisPhase = 0` → display "Cycle 1 of N". `completedCyclesInThisPhase = 3` → display "Cycle 4 of N".

**End-of-program behaviour:** When `completedCycles >= totalProgramCycles`, the phase engine returns the final phase indefinitely and sets `blockComplete: true`. The block progress card on the home screen is replaced by a completion card:

```
🏆 Block complete!
You finished your 16-cycle program.
Ready to start a new block?

[ Start new block ]   [ Dismiss ]
```

"Start new block" resets `programs.started_at` to today and re-snapshots `sessions_per_cycle`. "Dismiss" stores a `localStorage` key so the card collapses but the option remains accessible via the config screen. The card re-appears on every session open until dismissed or a new block is started. The program does not restart automatically. Minimum `duration_cycles` per phase is 1; the editor enforces this with the `[ − ]` stepper floored at 1.

### Style resolution per exercise

**Important — early deload must be checked at call site, not inside this function.** `resolveStyleForExercise` only checks `phase.phase_type`. During an early deload (`is_early_deload`), the current phase is still a normal phase — `phase.phase_type` is `'normal'` and the function would return the wrong style. The `workout-data` API route must call `isDeloadActive` first and short-circuit to deload params before ever calling `resolveStyleForExercise`:

```ts
// In workout-data API route — for each exercise:
if (isDeloadActive(currentPhase, program, today)) {
  return applyDeloadParams(exercise)   // 50% sets, 60% 1RM or own weight
}
return resolveStyleForExercise(currentPhase, phases, exercise)
```

```
resolveStyleForExercise logic (only reached when NOT in deload):

if exercise_role === 'accessory':
  → always use exercise's own style_id

if exercise_role === 'primary':
  → use phase.primary_style_id

if exercise_role === 'secondary':
  → if current phase is Peak type:
      → use most recent preceding non-Peak phase's secondary_style_id
        (falls back to primary_style_id if no preceding secondary style found)
  → otherwise:
      → use phase.secondary_style_id ?? phase.primary_style_id
```

### Exports

```ts
getCurrentPhase(phases, sessionsPerCycle, sessionsLoggedSinceStart): {
  phase,
  cycleInPhase,       // 1-indexed: completedCyclesInThisPhase + 1
  totalPhaseCycles,   // phase.duration_cycles
  completedCycles,    // total cycles completed across all phases so far
  totalProgramCycles, // sum of all phase duration_cycles
  blockComplete,      // true when completedCycles >= totalProgramCycles
  approxWeeksRemaining(avgSessionsPerWeek: number): number  // display hint only
}
resolveStyleForExercise(phase, phases, exercise): StyleId | 'deload' | 'own'
isDeloadActive(phase, program, today): boolean  // checks phase_type OR (early_deload_week_start within last 7 days)
```

---

## Program Editor UI

Changes are confined to `components/config-screen.tsx`.

### Program-level additions (below program name field)

**Mode toggle:**
```
Training Mode:  [ Manual ]  [ Automatic ]
```
Manual = no new UI shown. Automatic = reveals phase editor and start date.

**Program start date** (Automatic only):
- Date picker defaulting to **today** always. Never auto-populated from historical workout history — the user must consciously choose a start date.
- User can backdate manually (e.g. "I started 3 weeks ago").
- When the date is confirmed, `sessions_per_cycle` is snapshotted from the current session count. A warning is shown if the user tries to change it after sessions have already been logged: *"Changing the start date will recalculate your block progress."*
- **Validation:** Automatic mode cannot be enabled if the program has zero sessions defined. The toggle shows an inline error: *"Add at least one session before enabling Automatic mode."* This prevents division-by-zero in the cycle engine (`sessions_per_cycle = 0`).

**Phase sequence editor** (Automatic only):
- Ordered list of phase cards, drag-to-reorder via existing `@dnd-kit`.
- `+ Add Phase` button appends a new card.
- Running total below list: `Total: 16 cycles  (~13 weeks based on your rotation)`.
- The approximate week estimate is derived from the user's recent training frequency (sessions logged per 7 days over the last 28 days), recalculated on load.

Each phase card:
```
┌─────────────────────────────────────────┐
│ ≡  [Phase name input]      [ ✕ remove ] │
│                                         │
│ Duration:  [ − ] 4 cycles [ + ]         │
│            ≈ 3 weeks                    │
│ Type:      [ Normal ]  [ Deload ]       │
│                                         │
│ Primary style:    [ Hypertrophy ▾ ]     │  ← hidden on Deload type
│ Secondary style:  [ Strength ▾ ]        │  ← hidden on Deload type
│                                         │
│ (Deload shown instead):                 │
│ Auto: 50% sets · 60% 1RM compounds      │
│       50% sets · same weight accessories│
└─────────────────────────────────────────┘
```

**Validation:** Normal-type phases must have a Primary style selected before the program can be saved. An inline error is shown on any Normal phase card missing a Primary style: *"Select a progression style for this phase."* Saving is blocked until resolved. This prevents `null` style lookups in the phase engine at workout time.

"1 cycle = 1 complete Push / Pull / Legs rotation" shown as a static helper below the editor header, dynamically using the actual session names from the program.

### Per-exercise role selector (inside each session's exercise list)

Below each exercise's style dropdown, a compact 3-way pill:
```
[ Primary ]  [ Secondary ]  [ Accessory ]
```
- Defaults to Primary.
- Accessory exercises show a note: `"Fixed style — no phase cycling."`

---

## Deload Detection

### Scheduled

Derived automatically by the phase engine. When `currentPhase.phase_type === 'deload'`, the week is a scheduled deload. No extra logic needed.

### Data-driven early trigger

Added to the existing `/api/readiness-score` route. New field in response: `earlyDeloadRecommended: boolean`.

**Trigger conditions — ALL must be true:**
1. `phase_mode === 'automatic'`
2. Current phase is NOT a deload phase
3. Sufficient baseline data: ACWR ≥ 28 days of training history, HRV ≥ 5 readings
4. Readiness score < 45 on **3 of the last 5 days** (tolerant of sync gaps and rest days — strict consecutive would break on a missed Health Connect sync)
5. ACWR > 1.2

**When triggered:** Recommendation card on home screen (alongside morning briefing / readiness cards):

```
⚠️ Fatigue detected
Your readiness has been low for 3 days and your
training load is elevated. Consider taking a
deload week now.

[ Take deload week now ]   [ Dismiss ]
```

**"Take deload week now":** Two actions fire together:
1. Sets `programs.early_deload_week_start = today` — opens a 7-day deload window from today. Any session logged within `[today, today + 7 days)` is treated as a deload.
2. Retroactively stamps `is_early_deload = true` on any `workout_sessions` already logged today (handles the case where the user trained before seeing the recommendation).

The programmed phase sequence is NOT shifted — the schedule resumes normally the following week. Dismiss stores a `localStorage` key (`ta_early_deload_dismissed_YYYY-WW`) so the card doesn't re-appear during the same calendar week.

**Graceful fallback:** If baseline data doesn't exist, the trigger is silently inactive. Scheduled deloads still function normally. No UI shown, no error state.

---

## Workout Screen Changes

### During any deload week (scheduled or early)

**Pre-workout screen:**
- Amber banner at top — two variants depending on deload source:
  - **Scheduled deload phase:** `"Deload — [phase.name] · Cycle X of Y"`
  - **Early deload (`is_early_deload`):** `"Recovery Week — Fatigue detected · [current phase name] paused"`
- Set counts halved for all exercises (round up: 3→2, 4→2, 5→3)
- Weight dial pre-filled to deload target:
  - Primary/Secondary compounds: 60% of current 1RM estimate
  - Accessories: unchanged from their normal style target
- User can adjust weight dial as normal

### During normal automatic phases

- Subtle phase indicator below session title on pre-workout screen: `"Accumulation · Cycle 3 of 4"`
- Set/rep/weight targets are computed from the phase's progression style via the existing workout-data API — no other UI changes needed

---

## Metric Exclusions

Sessions where `phase_type === 'deload'` OR `is_early_deload = true`:

| Metric | Treatment |
|---|---|
| 1RM updates / personal records | **Excluded** — deload sets must not drag down estimates or overwrite PRs |
| Exercise history sparklines | **Dimmed** — point shown but visually muted; does not skew trend line |
| Weekly stats volume totals | **Excluded** — deload volume not counted in training load bars |
| ACWR chronic load (28-day) | **Excluded** — deload week not counted in chronic load calculation |
| ACWR acute load (7-day) | **Included** — reduced deload volume naturally brings ACWR down (this is the point) |
| Body weight / nutrition / sleep | **Always included** — unaffected by training phase |

Sessions in normal (non-deload) automatic phases are excluded from nothing — Intensification and Peak sets should update 1RM and count toward load.

---

## Phase Progress Display

### Home screen
Near the readiness / morning briefing cards:
```
Block Progress
Accumulation · Cycle 3 of 4
████████████████░░░  Cycle 11 of 16  (~9 weeks in)

Next: Intensification in 1 cycle  (~1 week)
```
Hidden when `phase_mode === 'manual'` or `started_at` is null.
Approximate week labels are display-only hints derived from recent training frequency — the progress bar and phase advancement are driven by cycle count only.

### Workout select screen
Small phase badge beneath session name on the session card:
```
Push
Accumulation · Cycle 3/4
```

### Stats page
Deload days marked on the training load bar chart — muted colouring or a small `D` label on any day column that contains at least one session where `phase_type = 'deload'` OR `is_early_deload = true`. The chart is calendar-day-based, not phase-based, so the implementation queries session flags per date rather than per phase period. Reduced volume on deload days then reads as intentional rather than missed training.

---

## Files Touched

| File | Change |
|---|---|
| `lib/data/postgres/migrations/020_block_periodization.sql` | New migration — `program_phases` table + new columns |
| `lib/data/postgres/schema.ts` | Drizzle schema for `program_phases`, new columns |
| `lib/types/program.ts` | `ProgramPhase`, `ExerciseRole` types; update `Program`, `SessionExercise` |
| `lib/data/repository.ts` | `listProgramPhases`, `saveProgramPhases` interface methods |
| `lib/data/postgres/adapter.ts` | Implement new repository methods |
| `lib/phase-engine.ts` | New — pure phase calculation utility |
| `components/config-screen.tsx` | Mode toggle, phase sequence editor, per-exercise role picker; warn if a phase's style was deleted (`primary_style_id` is null on a Normal phase) |
| `app/api/workout-data/route.ts` | Apply phase engine to resolve styles + set counts per exercise |
| `app/api/readiness-score/route.ts` | Add `earlyDeloadRecommended` to response |
| `app/api/log-exercise/route.ts` | Stamp `phase_id` on workout sessions at session creation; skip 1RM/PR update when deload |
| `app/api/sync-workout/route.ts` | Stamp `phase_id` on offline-synced workout sessions; stamp `is_early_deload` when applicable |
| `components/workout/pre-workout-screen.tsx` | Deload banner, phase indicator, halved set display |
| `app/session-select/session-select-content.tsx` | Block progress card, early deload recommendation card |
| `app/workout-select/workout-select-content.tsx` | Phase badge on session card |
| `components/stats/weekly-stats-hub.tsx` | Deload week marker on training load bars |
| `app/api/exercise-history/route.ts` | Filter / flag deload sessions in history |
| `app/api/weekly-stats/route.ts` | Exclude deload weeks from volume totals |
| `app/api/training-load/route.ts` | Exclude deload from chronic ACWR load |

---

## Out of Scope (this build)

- Per-exercise phase overrides (different styles for different exercises within the same phase) — future enhancement
- Phase templates (pre-built 12-week programs) — future enhancement  
- Pushing/shifting the phase schedule when an early deload is taken — keep simple, schedule resumes next week
- Exercise library compound/isolation tagging for automatic role suggestions — future enhancement
- Configurable block-complete behaviour (auto-restart vs hold) — hold + prompt is the first-build default
