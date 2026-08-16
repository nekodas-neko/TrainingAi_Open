# Program Wizard — Design Spec

**Date:** 2026-06-02
**Branch:** `claude/project-review-brainstorm-SoBBa`
**Status:** Approved — ready for implementation planning
**Depends on:** Block periodization (`docs/superpowers/specs/2026-06-01-block-periodization-design.md`) must be shipped first — the wizard output assumes `phaseMode`, `program_phases`, and `exerciseRole` are available in the DB.

---

## Overview

A guided creation wizard at `/program-wizard` that lets users build a complete training program by answering 6 questions. The wizard filters exercises from the library by muscle group and equipment (rule-based), calculates evidence-based volume targets, then sends the user's selections to Gemini for a review pass that validates balance, assigns progression styles, and generates a block periodization phase sequence. The resulting program is pre-loaded in the existing config screen for fine-tuning before saving.

The existing manual program builder in the config screen is unchanged — the wizard is an additional creation path, not a replacement.

---

## Prerequisites Already Completed

- `equipment TEXT[]` column added to `exercise_library` via migration `021_exercise_equipment.sql` with all 68 exercises populated
- `ExerciseLibraryEntry.equipment: string[]` added to TypeScript type and adapter mapper

---

## Architecture

```
/program-wizard                     (new route)
  └── wizard-content.tsx            (client component — full step state machine)
        ├── step-goal.tsx
        ├── step-schedule.tsx
        ├── step-muscles.tsx
        ├── step-equipment.tsx
        ├── step-exercises.tsx
        └── step-review.tsx

lib/wizard-engine.ts                (pure functions — session splitting, volume calc, filtering)
lib/__tests__/wizard-engine.test.ts (vitest tests)

app/api/program-wizard/generate/route.ts   (Gemini review call)

-- Save reuses existing endpoints:
POST /api/program-phases            (save phases + phaseMode/startedAt)
-- Program saved via existing saveProgram repo method
```

The config screen gains a single "Create with Wizard" button that navigates to `/program-wizard`. No other changes to config screen.

---

## Schema Changes

### Migration `022_style_rep_ranges.sql`

```sql
-- Add rep range columns to style_sets (backwards compatible — existing rows keep reps, min/max stay null)
ALTER TABLE style_sets
  ADD COLUMN reps_min INTEGER,
  ADD COLUMN reps_max INTEGER;

-- Make rest_sec nullable — NULL means "calculate dynamically from pct at runtime"
ALTER TABLE style_sets
  ALTER COLUMN rest_sec DROP NOT NULL,
  ALTER COLUMN rest_sec DROP DEFAULT;
```

**Backwards compatibility:** existing style sets with a numeric `rest_sec` are unaffected — they use the stored value as-is. New styles created by the wizard leave `rest_sec` NULL, enabling dynamic calculation. The `reps` column stays for existing styles; new styles use `reps_min`/`reps_max` instead.

### Updated `StyleSet` type

```typescript
export interface StyleSet {
  id: string
  styleId: string
  setNumber: number
  pct: number           // % of 1RM (e.g. 72 = 72%)
  reps: number          // exact reps — used when repsMin/repsMax are null
  repsMin?: number      // lower end of rep range (e.g. 8)
  repsMax?: number      // upper end of rep range (e.g. 12) — shown as "8–12"
  restSec?: number      // override rest in seconds; null = dynamic from pct
  useFor1rm: boolean
}
```

### Dynamic rest lookup (runtime, no DB column needed)

When `restSec` is null, the workout UI calculates rest from the set's `pct`:

| pct range | Rest |
|-----------|------|
| < 65% | 45s |
| 65–74% | 75s |
| 75–84% | 120s |
| 85–92% | 210s |
| ≥ 93% | 300s |

The user can override rest per-exercise during a workout — this writes a session-level `restSec` override to the set log but does not modify the style definition.

---

## Default Progression Styles

Six default styles are seeded into every new user account at `upsertUser` time (the user creation path in `lib/data/postgres/adapter.ts`). These use `reps_min`/`reps_max` and null `rest_sec` (dynamic rest).

| Style name | Sets | pct range | Rep range | useFor1rm |
|------------|------|-----------|-----------|-----------|
| Compound — Accumulation | 4 | 68–72% | 10–12 | last set |
| Compound — Intensification | 4 | 77–82% | 5–7 | last set |
| Compound — Peak | 3 | 87–92% | 2–4 | last set |
| Accessory — Volume | 3 | 63–68% | 12–15 | false |
| Accessory — Strength | 3 | 75–80% | 6–8 | false |
| Full Body | 3 | 65–70% | 10–12 | last set |

"pct range" means set 1 uses the lower end and the final set uses the upper end, with intermediate sets interpolated linearly. For example Compound — Accumulation (4 sets, 68–72%): set 1 → 68%, set 2 → 69%, set 3 → 71%, set 4 → 72%. Each set is stored as a separate `style_sets` row with its interpolated `pct` value.

These are the user's own styles — they can rename, edit, or delete them. Existing users without these styles are not retroactively seeded (no migration required for existing accounts).

---

## Step Flow

### Step 1 — Goal & Experience

```
Primary goal:   [ Strength ]  [ Hypertrophy ]  [ General Fitness ]  [ Cut ]
Experience:     [ Beginner ]  [ Intermediate ]  [ Advanced ]
```

These two answers drive: target %1RM range, weekly set targets, and which default styles the AI recommends.

### Step 2 — Schedule

```
Training days per week:  [ 2 ]  [ 3 ]  [ 4 ]  [ 5 ]  [ 6 ]
Session duration:        [ 30 min ]  [ 45 min ]  [ 60 min ]  [ 75 min+ ]
```

Days/week determines the session template (see Session Splitting). Duration determines the max working sets cap per session.

### Step 3 — Muscle Groups

Multi-select chips:

```
Upper:  [ Chest ]  [ Back ]  [ Shoulders ]  [ Biceps ]  [ Triceps ]  [ Forearms ]
Lower:  [ Quads ]  [ Hamstrings ]  [ Glutes ]  [ Calves ]
Core:   [ Core ]
```

Minimum one selection required. Selections determine which muscles are trained and which session template is used.

### Step 4 — Equipment

Multi-select chips:

```
[ Barbell ]  [ Dumbbells ]  [ Cable ]  [ Machine ]  [ Bodyweight ]
```

"Bodyweight" is always included by default (pull-ups, push-ups, etc. are always available). Selecting "Barbell" + "Dumbbells" + "Cable" + "Machine" is equivalent to "Full Gym."

### Step 5 — Exercise Selection (rule-based)

Session cards shown, one per session in the split. Each card lists pre-selected exercises. User can swap any exercise.

**Exercise filtering logic (in `lib/wizard-engine.ts`):**
1. Filter library: `exercise.muscles` contains at least one of the user's selected muscle groups
2. Filter library: `exercise.equipment` overlaps with the user's selected equipment
3. Sort by: primary muscle match first, then secondary
4. Pre-select first N exercises per session based on duration cap (see below)
5. Remaining filtered exercises are available as swap candidates

**Swap UI:** tapping an exercise opens a bottom sheet showing all filtered alternatives for that muscle slot. The user picks one to replace it.

### Step 6 — AI Review & Summary

Sends one POST to `/api/program-wizard/generate`. Shows a loading state ("Reviewing your program…") then renders three collapsible sections:
- **Your sessions** — exercise order, suggested styles, set counts
- **Phase plan** — AI-generated block periodization sequence
- **Flags** — imbalance warnings, duration warnings (amber, not blockers)

Actions: **Save program** or **Regenerate** (max 3 regenerates per wizard session, enforced client-side).

On save: calls `saveProgram` + `PUT /api/program-phases`, then navigates to `/config?programId=<id>` where the new program is pre-loaded for fine-tuning.

---

## Session Splitting (Pure Functions in `lib/wizard-engine.ts`)

Rule-based mapping of `(daysPerWeek, muscleGroups)` → session names + muscle assignments:

```typescript
type SessionTemplate = { name: string; muscles: string[] }[]

function buildSessionTemplate(days: number, muscles: string[]): SessionTemplate
```

| Days | Has legs muscles? | Sessions |
|------|------------------|---------|
| 2 | any | Full Body A, Full Body B |
| 3 | yes | Push, Pull, Legs |
| 3 | no | Upper A, Upper B, Arms |
| 4 | yes | Upper A, Lower A, Upper B, Lower B |
| 4 | no | Push A, Pull A, Push B, Arms |
| 5 | yes | Push, Pull, Legs, Upper, Lower |
| 5 | no | Push A, Pull A, Push B, Pull B, Shoulders |
| 6 | yes | Push A, Pull A, Legs A, Push B, Pull B, Legs B |
| 6 | no | Push A, Pull A, Arms A, Push B, Pull B, Arms B |

"Has legs muscles" = user selected any of: Quads, Hamstrings, Glutes, Calves.

Muscle → session mapping (used to assign exercises to sessions):
- **Push:** Chest, Shoulders, Triceps
- **Pull:** Back (Lats, Upper Back), Biceps
- **Legs:** Quads, Hamstrings, Glutes, Calves
- **Full Body:** all selected muscles
- **Upper:** Push + Pull muscles
- **Lower:** Legs muscles
- **Arms:** Biceps, Triceps, Forearms

---

## Volume Targeting (Pure Functions in `lib/wizard-engine.ts`)

### Weekly set targets by goal + experience

```typescript
const WEEKLY_SET_TARGETS: Record<Goal, Record<Experience, number>> = {
  strength:        { beginner: 7,  intermediate: 9,  advanced: 11 },
  hypertrophy:     { beginner: 11, intermediate: 14, advanced: 18 },
  generalFitness:  { beginner: 9,  intermediate: 11, advanced: 13 },
  cut:             { beginner: 9,  intermediate: 11, advanced: 13 },
}
```

### Sets per session per muscle

```typescript
function setsPerSessionForMuscle(
  targetWeekly: number,
  sessionsPerWeekHittingMuscle: number,
): number {
  return Math.round(targetWeekly / sessionsPerWeekHittingMuscle)
}
```

Divide those sets across the exercises targeting that muscle in the session (distribute evenly, round up on the primary compound).

### Session duration cap

Time per working set varies by goal (execution + rest at that %1RM):

```typescript
const MINS_PER_SET: Record<Goal, number> = {
  cut:            2.0,
  generalFitness: 2.2,
  hypertrophy:    2.6,
  strength:       4.0,
}

function maxWorkingSets(durationMin: number, exerciseCount: number, goal: Goal): number {
  const available = durationMin - 5 - exerciseCount   // subtract warm-up + transitions
  return Math.floor(available / MINS_PER_SET[goal])
}
```

If the volume target exceeds the duration cap, set counts are reduced proportionally and a flag is added: *"Volume target for [muscle] reduced to fit your [X]-min session."*

---

## Exercise Role Auto-Assignment

The wizard assigns `exerciseRole` to each exercise before sending to the AI. The AI review can suggest corrections.

```typescript
function autoAssignRole(exerciseName: string, muscles: MuscleAssignment[]): ExerciseRole {
  const mainMuscles = muscles.filter(m => m.role === 'main').map(m => m.muscle)
  if (PRIMARY_COMPOUNDS.has(exerciseName)) return 'primary'
  if (mainMuscles.some(m => COMPOUND_MUSCLES.has(m)) && muscles.length >= 2) return 'secondary'
  return 'accessory'
}

const PRIMARY_COMPOUNDS = new Set([
  'Bench Press', 'Barbell Bench Press', 'Squat', 'Deadlift',
  'Overhead Press', 'Pull-Up', 'Chin-Up', 'Barbell Row',
  'Bent Over Barbell Row', 'Front Squat',
])

// Multi-joint muscles — exercises with 2+ entries in MuscleAssignment[] that hit these
// are classified as secondary compounds rather than accessories
const COMPOUND_MUSCLES = new Set([
  'Chest', 'Lats', 'Upper Back', 'Quads', 'Hamstrings', 'Glutes',
  'Shoulders', 'Lower Back',
])
// Single-joint movements (Biceps, Triceps, Calves, Core, Forearms as sole target) = accessory
```

**How roles affect phase cycling (from block periodization spec):**

| Role | Phase behaviour |
|------|----------------|
| `primary` | Full cycling: Accumulation → Intensification → Peak → Deload |
| `secondary` | Skips Peak: holds at Intensification style during peak phase |
| `accessory` | Fixed style throughout all phases; only deload halves sets |

---

## AI Review Layer (`/api/program-wizard/generate`)

### Request

```typescript
interface WizardGenerateRequest {
  goal: 'strength' | 'hypertrophy' | 'generalFitness' | 'cut'
  experience: 'beginner' | 'intermediate' | 'advanced'
  daysPerWeek: number
  sessionDurationMin: number
  sessions: {
    name: string
    exercises: {
      name: string
      muscleGroups: string[]
      equipment: string[]
      exerciseRole: 'primary' | 'secondary' | 'accessory'
      setCount: number
    }[]
  }[]
  volumePlan: {
    targetSetsPerMusclePerWeek: Record<string, number>
    durationCapSets: number
  }
  availableStyles: { id: string; name: string; pctMin: number; pctMax: number }[]
}
```

`availableStyles` is passed with the pct range so Gemini can reason about intensity without touching UUIDs. The API resolves style names → UUIDs before saving.

### Gemini prompt structure

```
System: You are a certified strength and conditioning coach reviewing a training program.
        Respond ONLY with valid JSON matching the schema provided. No prose.

User: [JSON of request]

Schema: [WizardGenerateResponse JSON schema as a string]
```

Temperature: 0.3 (low — we want consistent, evidence-based suggestions, not creative variation).

The route must validate the incoming request body with Zod before passing to Gemini (consistent with the input validation applied to other AI routes in Phase 0). Key bounds: `daysPerWeek` 2–6, `sessionDurationMin` 20–120, session array max 6, exercises per session max 10, `availableStyles` max 20.

The route must also apply rate limiting using the existing `rateLimit()` helper: `rateLimit(userId, 'program-wizard', { limit: 5, windowMs: 60_000 })`. The 3-regenerate client-side cap means a single wizard session costs at most 4 calls (initial + 3 regenerates), well within 5/min.

### Response

```typescript
interface WizardGenerateResponse {
  programName: string
  sessions: {
    name: string
    exercises: {
      name: string
      suggestedStyleName: string | null   // matched against availableStyles[].name
      setCount: number
      exerciseRole: 'primary' | 'secondary' | 'accessory'
      notes?: string
    }[]
  }[]
  phases: {
    name: string
    durationCycles: number
    phaseType: 'normal' | 'peak' | 'deload'
    primaryStyleName: string | null
    secondaryStyleName: string | null
  }[]
  flags: string[]
  durationWarning?: string
}
```

### Style name → UUID resolution (in the API route)

```typescript
const styleMap = new Map(availableStyles.map(s => [s.name.toLowerCase(), s.id]))

function resolveStyleId(name: string | null): string | undefined {
  if (!name) return undefined
  return styleMap.get(name.toLowerCase())
}
```

Any style name Gemini returns that doesn't match (including punctuation or capitalisation differences) is silently dropped and results in `styleId: undefined` — the user assigns manually in config. The prompt must include the exact style names from `availableStyles` as a list so Gemini returns them verbatim.

### New user edge case (no styles)

`availableStyles` is empty → Gemini skips style assignments, all `suggestedStyleName` fields return `null`. Flag added: *"No progression styles found. Default styles are seeded when your account is created — if you see this, create progression styles in the config screen and re-run the wizard."*

---

## Wizard State Persistence

Answers from Steps 1–4 are persisted to `localStorage` under key `ta_wizard_draft` on every change:

```typescript
interface WizardDraft {
  step?: number         // last completed step (1–5); wizard restores to this step on mount
  goal?: string
  experience?: string
  daysPerWeek?: number
  sessionDurationMin?: number
  muscleGroups?: string[]
  equipment?: string[]
  savedAt: string       // ISO date string — draft expires after 7 days
}
```

On wizard mount: if draft exists and `savedAt` is within 7 days, restore to the last completed step. Draft is deleted on successful save. Step 5 exercises are not persisted — they are re-derived from the library on mount (fast, deterministic).

---

## Config Screen Integration

Two changes to the config screen:

1. A "Create with Wizard" button/link in the "New Program" area that navigates to `/program-wizard`.
2. On mount, read the `programId` query param (`useSearchParams`) and if present, pre-select that program in the program list so the user immediately sees their newly created program for fine-tuning.

The config screen is already large — the wizard is fully isolated at its own route. Both changes are small and surgical.

---

## Schedule Output

The wizard always produces a **rotation schedule** (`type: 'rotation'`, `restAfterN = daysPerWeek`). This matches the existing schedule system and is the most flexible default — the user can switch to a weekly (fixed-day) schedule in config if preferred.

The wizard also sets `sessionsPerCycle = daysPerWeek` on the program — the number of sessions that make up one complete rotation. This is required by the block periodization phase engine (`countSessionsSinceStart` uses it to track phase progress). `startedAt` is set to `todayInTz()` at save time.

---

## Deferred / Out of Scope

- **Intra-phase set progression** (e.g. starting at 3 sets in week 1, adding 1 set per 2 cycles) — valid advanced technique, not needed for launch
- **RPE/RIR-based loading** (auto-regulation based on perceived effort) — requires a different input model; future enhancement
- **Existing user style seeding** — default styles are only seeded for new accounts. Existing users without styles can create them manually or will see the "no styles" flag in the wizard review

---

## Scope Note

This feature is its own spec and plan, executed **after** block periodization ships. It depends on:
- `exerciseRole` column on `session_exercises` (block periodization Task 1)
- `program_phases` table and `phaseMode` on `programs` (block periodization Task 1)
- `lib/phase-engine.ts` (block periodization Task 6)
- `/api/program-phases` PUT endpoint (block periodization Task 9)

The equipment column prerequisite (`021_exercise_equipment.sql`) is already committed and will apply when block periodization ships.
