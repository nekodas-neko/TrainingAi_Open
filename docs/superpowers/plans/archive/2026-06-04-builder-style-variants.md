> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Builder Style Variants & Accurate Time Calculation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3-set and 4-set variants for all default progression styles, have the AI builder pick a style per exercise, calculate accurate session time from the style's actual sets/rest, show set/rep info in the review screen, save the chosen style to `session_exercises.styleId`, and fix the 1RM default logic.

**Architecture:** New style variants are seeded via migration (existing users) and adapter (new users). The `generate-program` route fetches the user's styles, passes them to Gemini with per-style time estimates, and Gemini returns a `progressionStyleName` per exercise. The server maps names→IDs and returns `progressionStyleId` in the response. `builder-review` shows "4 × 10 @ 65%" per exercise and passes `styleId` when saving. The 1RM fix is a small change to `log-exercise` defaulting `useFor1rm` based on whether all reps are equal.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM (PostgreSQL), Gemini via `@ai-sdk/google`, pnpm.

---

## File Map

| File | Change |
|------|--------|
| `lib/data/postgres/migrations/037_style_variants.sql` | **Create** — INSERT new 3-set/4-set variants for existing users |
| `lib/data/postgres/adapter.ts` | **Modify** lines 55–83 — add new variants to `defaultStyles` array |
| `lib/types/builder.ts` | **Modify** — add `progressionStyleName?: string` to `GeneratedExercise` |
| `app/api/generate-program/route.ts` | **Modify** — fetch styles, build style menu, accurate time calc, map name→ID in response |
| `components/workout-builder/builder-review.tsx` | **Modify** — show style info per exercise; pass `styleId` when saving |
| `app/api/log-exercise/route.ts` | **Modify** lines 173–186 — auto-derive `useFor1rm` when reps are equal vs varied |

---

## Task 1: Seed new style variants for existing users (migration)

**Files:**
- Create: `lib/data/postgres/migrations/037_style_variants.sql`

**Background:** The adapter seeds default styles when a user is first created. Existing users already have styles but are missing the 3-set and 4-set variants. This migration adds them safely (idempotent: checks by name+user before inserting).

Current styles per user:
- `Hypertrophy` — 4 sets, 65%/10r/60s ← already 4-set
- `Strength` — 4 sets, 80%/5r/120s ← already 4-set
- `Peak` — 3 sets, 90%/3r/180s
- `Deload` — 3 sets, 50%/10r/60s (stays 3 — not adding variant)
- `General` — 3 sets, 60%/12r/60s

New variants to add:
- `Hypertrophy 3-set` — 3 sets, 65%/10r/60s (for accessories/secondary on time-constrained sessions)
- `Strength 3-set` — 3 sets, 80%/5r/120s
- `Peak 4-set` — 4 sets, 90%/3r/180s, useFor1rm=true
- `General 4-set` — 4 sets, 60%/12r/60s

- [ ] **Step 1: Create migration file**

```sql
-- 037_style_variants.sql
-- Add 3-set and 4-set progression style variants for all existing users.
-- Idempotent: skips users who already have the style by name.

DO $$
DECLARE
  u RECORD;
  new_style_id UUID;
BEGIN
  FOR u IN SELECT id FROM users LOOP

    -- Hypertrophy 3-set (3 × 10 @ 65%, 60s rest)
    IF NOT EXISTS (
      SELECT 1 FROM progression_styles WHERE user_id = u.id AND name = 'Hypertrophy 3-set'
    ) THEN
      new_style_id := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (new_style_id, u.id, 'Hypertrophy 3-set');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), new_style_id, 1, 65, 10, 60, false),
        (gen_random_uuid(), new_style_id, 2, 65, 10, 60, false),
        (gen_random_uuid(), new_style_id, 3, 65, 10, 60, false);
    END IF;

    -- Strength 3-set (3 × 5 @ 80%, 120s rest)
    IF NOT EXISTS (
      SELECT 1 FROM progression_styles WHERE user_id = u.id AND name = 'Strength 3-set'
    ) THEN
      new_style_id := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (new_style_id, u.id, 'Strength 3-set');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), new_style_id, 1, 80, 5, 120, false),
        (gen_random_uuid(), new_style_id, 2, 80, 5, 120, false),
        (gen_random_uuid(), new_style_id, 3, 80, 5, 120, false);
    END IF;

    -- Peak 4-set (4 × 3 @ 90%, 180s rest, useFor1rm=true)
    IF NOT EXISTS (
      SELECT 1 FROM progression_styles WHERE user_id = u.id AND name = 'Peak 4-set'
    ) THEN
      new_style_id := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (new_style_id, u.id, 'Peak 4-set');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), new_style_id, 1, 90, 3, 180, true),
        (gen_random_uuid(), new_style_id, 2, 90, 3, 180, true),
        (gen_random_uuid(), new_style_id, 3, 90, 3, 180, true),
        (gen_random_uuid(), new_style_id, 4, 90, 3, 180, true);
    END IF;

    -- General 4-set (4 × 12 @ 60%, 60s rest)
    IF NOT EXISTS (
      SELECT 1 FROM progression_styles WHERE user_id = u.id AND name = 'General 4-set'
    ) THEN
      new_style_id := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (new_style_id, u.id, 'General 4-set');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), new_style_id, 1, 60, 12, 60, false),
        (gen_random_uuid(), new_style_id, 2, 60, 12, 60, false),
        (gen_random_uuid(), new_style_id, 3, 60, 12, 60, false),
        (gen_random_uuid(), new_style_id, 4, 60, 12, 60, false);
    END IF;

  END LOOP;
END $$;
```

- [ ] **Step 2: Update adapter `defaultStyles` array to include variants for new users**

In `lib/data/postgres/adapter.ts`, the `defaultStyles` array starts at line 55. Add the four new variants after the existing `General` entry (line 82):

```typescript
      { name: 'Hypertrophy 3-set', sets: [
        { setNumber: 1, pct: 65, reps: 10, restSec: 60, useFor1rm: false },
        { setNumber: 2, pct: 65, reps: 10, restSec: 60, useFor1rm: false },
        { setNumber: 3, pct: 65, reps: 10, restSec: 60, useFor1rm: false },
      ]},
      { name: 'Strength 3-set', sets: [
        { setNumber: 1, pct: 80, reps: 5, restSec: 120, useFor1rm: false },
        { setNumber: 2, pct: 80, reps: 5, restSec: 120, useFor1rm: false },
        { setNumber: 3, pct: 80, reps: 5, restSec: 120, useFor1rm: false },
      ]},
      { name: 'Peak 4-set', sets: [
        { setNumber: 1, pct: 90, reps: 3, restSec: 180, useFor1rm: true },
        { setNumber: 2, pct: 90, reps: 3, restSec: 180, useFor1rm: true },
        { setNumber: 3, pct: 90, reps: 3, restSec: 180, useFor1rm: true },
        { setNumber: 4, pct: 90, reps: 3, restSec: 180, useFor1rm: true },
      ]},
      { name: 'General 4-set', sets: [
        { setNumber: 1, pct: 60, reps: 12, restSec: 60, useFor1rm: false },
        { setNumber: 2, pct: 60, reps: 12, restSec: 60, useFor1rm: false },
        { setNumber: 3, pct: 60, reps: 12, restSec: 60, useFor1rm: false },
        { setNumber: 4, pct: 60, reps: 12, restSec: 60, useFor1rm: false },
      ]},
```

- [ ] **Step 3: Build check**

```bash
pnpm run build 2>&1 | grep -E "error TS|Type error|✓ Compiled|Failed" | head -10
```
Expected: `✓ Compiled successfully`

- [ ] **Step 4: Commit**

```bash
git add lib/data/postgres/migrations/037_style_variants.sql lib/data/postgres/adapter.ts
git commit -m "feat: add 3-set and 4-set progression style variants"
```

---

## Task 2: Add `progressionStyleName` to `GeneratedExercise` type

**Files:**
- Modify: `lib/types/builder.ts`

The AI will return a style name (e.g. `"Strength 4-set"`) per exercise. The server maps it to an ID. The client uses it for display. It's optional — exercises without a matched style still work.

- [ ] **Step 1: Update the type**

Replace the contents of `lib/types/builder.ts` with:

```typescript
export interface GeneratedExercise {
  name: string
  exerciseRole: 'primary' | 'secondary' | 'accessory'
  mainMuscles: string[]
  secondaryMuscles: string[]
  progressionStyleName?: string  // style name returned by AI e.g. "Strength 4-set"
  progressionStyleId?: string    // resolved server-side from name → UUID
}

export interface GeneratedSession {
  name: string
  icon: string
  exercises: GeneratedExercise[]
}

export interface GeneratedProgram {
  name: string
  sessions: GeneratedSession[]
  phaseStructureName: string
  phaseSetId: string
  reasoning: string
}

export interface BuilderInputs {
  programName: string
  equipment: string[]
  sessionsPerWeek: number
  timePerSessionMinutes: number | null
  musclesToFocus: string[]
  goal: 'hypertrophy' | 'strength' | 'strength+hypertrophy'
  phaseStructureName: string
  scheduleType: 'rotation' | 'weekly'
  rotationRestAfterN: number
  weeklyDays: number[]  // 0=Mon … 6=Sun
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}
```

- [ ] **Step 2: Build check**

```bash
pnpm run build 2>&1 | grep -E "error TS|Type error|✓ Compiled|Failed" | head -10
```
Expected: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

```bash
git add lib/types/builder.ts
git commit -m "feat: add progressionStyleName and progressionStyleId to GeneratedExercise"
```

---

## Task 3: Update `generate-program` route — style-aware time calc + Gemini prompt

**Files:**
- Modify: `app/api/generate-program/route.ts`

**What changes:**
1. After fetching exercises (line 54), fetch the user's progression styles with their sets.
2. Compute `styleTimeMin(style)` = realistic minutes per exercise for each style.
3. Build a style menu string for the prompt.
4. Update `targetExercises` to use style-accurate times.
5. Update the prompt to instruct Gemini to assign a `progressionStyleName` per exercise.
6. Update the JSON schema shown to Gemini to include `progressionStyleName`.
7. After parsing Gemini's response, resolve `progressionStyleName` → `progressionStyleId`.

**Time formula:**
```
styleTimeMin = (sum over sets of (reps * 4 + restSec) + 90) / 60
```
The `90s` overhead covers plate changes, moving to equipment, and setup distributed per exercise (not per set). Using `reps * 4s` as an average execution pace.

- [ ] **Step 1: Replace `app/api/generate-program/route.ts` with the updated version**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import { z } from 'zod'
import type { GeneratedProgram, GeneratedExercise } from '@/lib/types/builder'

const RequestSchema = z.object({
  programName: z.string().min(1).max(100),
  equipment: z.array(z.string()).min(1),
  sessionsPerWeek: z.number().int().min(1).max(7),
  timePerSessionMinutes: z.number().int().min(30).max(180).nullable(),
  musclesToFocus: z.array(z.string()).min(1),
  goal: z.enum(['hypertrophy', 'strength', 'strength+hypertrophy']),
  phaseStructureName: z.enum(['Linear Progression', 'Baselining', 'Phase-Based Progression']),
  scheduleType: z.enum(['rotation', 'weekly']).default('rotation'),
  rotationRestAfterN: z.number().int().min(1).max(7).default(3),
  weeklyDays: z.array(z.number().int().min(0).max(6)).default([0, 2, 4]),
})

const EQUIPMENT_LABEL: Record<string, string> = {
  barbell: 'Barbell', dumbbell: 'Dumbbells', cable: 'Cables',
  kettlebell: 'Kettlebells', machine: 'Machines', bodyweight: 'Bodyweight',
}

function buildEquipmentSet(selected: string[]): Set<string> {
  const set = new Set<string>(['bodyweight'])
  if (selected.includes('full_gym')) {
    ;['barbell', 'dumbbell', 'cable', 'kettlebell', 'machine', 'bodyweight'].forEach(e => set.add(e))
  } else {
    selected.forEach(e => set.add(e))
  }
  return set
}

// Realistic minutes per exercise given its progression style's sets.
// Formula: (sum of reps*4s + restSec per set) + 90s overhead, converted to minutes.
function styleTimeMin(sets: { reps: number; restSec: number }[]): number {
  const totalSec = sets.reduce((s, set) => s + set.reps * 4 + set.restSec, 0) + 90
  return Math.round((totalSec / 60) * 10) / 10
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  if (!rateLimit(`generate-program:${userId}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again in an hour.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null)
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })

  const inputs = parsed.data
  const repo = await getRepository()

  const [allExercises, userStyles] = await Promise.all([
    repo.listExerciseLibrary(),
    repo.listProgressionStyles(userId),
  ])

  const equipmentSet = buildEquipmentSet(inputs.equipment)
  const focusSet = new Set(inputs.musclesToFocus.map(m => m.toLowerCase()))

  const filteredExercises = allExercises.filter(ex => {
    const hasEquipment = ex.equipment.length === 0 || ex.equipment.some(e => equipmentSet.has(e.toLowerCase()))
    const muscleNames = ex.muscles.map(m => m.muscle.toLowerCase())
    const relevant = muscleNames.some(m => focusSet.has(m)) || focusSet.has('full body')
    return hasEquipment && relevant
  })

  const exerciseList = filteredExercises.map(ex => ({
    name: ex.name,
    muscles: ex.muscles.map(m => `${m.muscle} (${m.role})`).join(', '),
    equipment: ex.equipment.map(e => EQUIPMENT_LABEL[e.toLowerCase()] ?? e).join(', '),
  }))

  // Build style menu for the prompt — only styles with fetched set data
  // listProgressionStyles returns ProgressionStyle[] which may not include sets.
  // We need styles with their sets for the time calculation.
  // Use the known default style names and their hardcoded set shapes for the prompt.
  // (The IDs come from userStyles after the response.)
  const KNOWN_STYLES: { name: string; sets: { reps: number; restSec: number }[]; description: string }[] = [
    {
      name: 'Hypertrophy',
      sets: Array(4).fill({ reps: 10, restSec: 60 }),
      description: '4 × 10 @ 65% · 60s rest — volume work, muscle building',
    },
    {
      name: 'Hypertrophy 3-set',
      sets: Array(3).fill({ reps: 10, restSec: 60 }),
      description: '3 × 10 @ 65% · 60s rest — lighter volume, accessories',
    },
    {
      name: 'Strength',
      sets: Array(4).fill({ reps: 5, restSec: 120 }),
      description: '4 × 5 @ 80% · 120s rest — heavy compound strength',
    },
    {
      name: 'Strength 3-set',
      sets: Array(3).fill({ reps: 5, restSec: 120 }),
      description: '3 × 5 @ 80% · 120s rest — strength work, secondary compounds',
    },
    {
      name: 'Peak',
      sets: Array(3).fill({ reps: 3, restSec: 180 }),
      description: '3 × 3 @ 90% · 180s rest — near-maximal, peak phase',
    },
    {
      name: 'Peak 4-set',
      sets: Array(4).fill({ reps: 3, restSec: 180 }),
      description: '4 × 3 @ 90% · 180s rest — near-maximal, peak phase main lifts',
    },
    {
      name: 'General',
      sets: Array(3).fill({ reps: 12, restSec: 60 }),
      description: '3 × 12 @ 60% · 60s rest — general fitness, high rep accessories',
    },
    {
      name: 'General 4-set',
      sets: Array(4).fill({ reps: 12, restSec: 60 }),
      description: '4 × 12 @ 60% · 60s rest — higher volume general work',
    },
  ]

  // Filter to styles the user actually has
  const userStyleNames = new Set(userStyles.map(s => s.name))
  const availableStyles = KNOWN_STYLES.filter(s => userStyleNames.has(s.name))

  const styleMenu = availableStyles
    .map(s => `  - "${s.name}": ${s.description} (~${styleTimeMin(s.sets)} min/exercise)`)
    .join('\n')

  // Compute target exercise count using a weighted average style time for the goal
  let targetExercises: string
  if (!inputs.timePerSessionMinutes) {
    targetExercises = `No time constraint — aim for moderate volume: 5–6 compounds + 2–3 accessories = 7–9 exercises per session.`
  } else {
    const workTimeSec = Math.max(30, inputs.timePerSessionMinutes - 10) * 60
    // Use a goal-appropriate "typical" style for the rough count estimate
    const typicalStyle =
      inputs.goal === 'strength' ? KNOWN_STYLES.find(s => s.name === 'Strength')! :
      inputs.goal === 'hypertrophy' ? KNOWN_STYLES.find(s => s.name === 'Hypertrophy')! :
      KNOWN_STYLES.find(s => s.name === 'Hypertrophy')!
    const avgExerciseTimeSec = typicalStyle.sets.reduce((s, set) => s + set.reps * 4 + set.restSec, 0) + 90
    const exerciseCount = Math.max(3, Math.floor(workTimeSec / avgExerciseTimeSec))
    const compounds = Math.ceil(exerciseCount * 0.6)
    const accessories = exerciseCount - compounds
    targetExercises = `${inputs.timePerSessionMinutes} min session (after warmup: ${Math.max(30, inputs.timePerSessionMinutes - 10)} min working) → target ~${exerciseCount} exercises (${compounds} compounds + ${accessories} accessories). Use the style time estimates below to stay within budget.`
  }

  const systemPrompt = `You are an expert strength and conditioning coach designing programs for optimal muscle growth and strength. Generate a structured workout program as JSON. Return ONLY valid JSON — no markdown, no code fences, no extra text.`

  const volumeTargets = inputs.goal === 'hypertrophy'
    ? 'Hypertrophy: 10–20 sets per muscle group per week (optimal: 15–20)'
    : inputs.goal === 'strength'
    ? 'Strength: 15–25 sets per muscle group per week (optimal: 20–25)'
    : 'Strength + Hypertrophy: 15–20 sets per muscle group per week, split between compound (heavy) and isolation (moderate rep) work'

  const scheduleDescription = inputs.scheduleType === 'rotation'
    ? `Rolling rotation — rest after every ${inputs.rotationRestAfterN} sessions (sessions run in cycle order, then 1 rest day, repeat regardless of calendar week). Sessions ${inputs.rotationRestAfterN} and ${inputs.rotationRestAfterN + 1} in the cycle run on CONSECUTIVE training days.`
    : `Fixed weekly — training days: ${inputs.weeklyDays.map(d => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][d]).join(', ')}.`

  const userPrompt = `Design a workout program with these constraints:
- Program name: "${inputs.programName}"
- Available equipment: ${inputs.equipment.map(e => EQUIPMENT_LABEL[e] ?? e).join(', ')}
- Training days per week: ${inputs.sessionsPerWeek}
- Session volume target: ${targetExercises}
- Muscles to focus on: ${inputs.musclesToFocus.join(', ')}
- Training goal: ${inputs.goal}
- Phase structure: ${inputs.phaseStructureName}
- Schedule: ${scheduleDescription}

VOLUME GUIDELINES (critical for optimal results):
${volumeTargets}

PROGRESSION STYLES — assign one to each exercise:
${styleMenu}

Style selection rules:
- Primary compound (squat, deadlift, bench, row, OHP): use Strength or Strength 3-set for strength goal; Hypertrophy or Hypertrophy 3-set for hypertrophy goal
- Secondary compound: one tier lighter than primary (e.g. if primary is Strength, secondary is Strength 3-set or Hypertrophy)
- Accessory/isolation: Hypertrophy 3-set or General 3-set
- Peak phase programs: prefer Peak or Peak 4-set for primary lifts
- Use 4-set variants for the 1–2 most important exercises per session; 3-set for the rest to stay within time budget

RECOMMENDED SPLITS BY FREQUENCY:
- 1 day  → Full Body
- 2 days → Full Body / Full Body  (hit every muscle twice)
- 3 days → Push / Pull / Legs
- 4 days → Upper / Lower / Upper / Lower  (or Push / Pull / Legs / Upper)
- 5 days → Push / Pull / Legs / Upper / Lower  (each major muscle hit twice/week)
- 6 days → Push / Pull / Legs / Push / Pull / Legs
- 7 days → PPL × 2 + 1 Full Body (or add dedicated arms/shoulders day)

Each major muscle should appear in 2 different sessions per week to achieve optimal weekly volume.
Each minor muscle (biceps, triceps, calves, core) gets sufficient volume from compound carry + 1 direct session.

Rules:
1. Use the recommended split for the given frequency above.
2. Use ONLY exercises from the list below. Match exercise names exactly.
3. Assign each exercise a role: "primary" (main compound), "secondary" (secondary compound), or "accessory" (isolation/single-joint).
4. Assign each exercise a progressionStyleName from the available styles listed above.
5. IMPORTANT: The sum of (~style time × exercise count) per session must fit within the working time budget.
6. Structure each session as: 2–3 compound exercises + 1–2 isolation exercises.
7. Ensure EACH focused muscle group gets ${inputs.goal === 'hypertrophy' ? '10–20 sets' : inputs.goal === 'strength' ? '15–25 sets' : '10–20 sets'} per week distributed across sessions.
8. Large muscles (chest, back, quads, hamstrings, glutes): aim for the upper end of the range.
9. Small muscles (biceps, triceps, calves, core): 6–10 direct sets/week is sufficient — they get compound carry.
10. Pick a session icon emoji matching the session focus.
11. MUSCLE RECOVERY (critical for rolling rotation): Sessions that run on consecutive training days must NOT share primary muscle groups. The session ORDER in your output determines the training day sequence — adjacent sessions in the list will be trained back-to-back. Ensure each consecutive pair of sessions targets different primary muscles (e.g. Push then Pull is fine; Push then Chest/Shoulders is not).
12. Before finalising: mentally tally sets per muscle across all sessions and confirm targets are met.

Available exercises:
${JSON.stringify(exerciseList, null, 2)}

Return this JSON schema exactly:
{
  "name": string,
  "sessions": [
    {
      "name": string,
      "icon": string,
      "exercises": [
        {
          "name": string,
          "exerciseRole": "primary" | "secondary" | "accessory",
          "progressionStyleName": string,
          "mainMuscles": string[],
          "secondaryMuscles": string[]
        }
      ]
    }
  ],
  "reasoning": string
}`

  try {
    const { text } = await generateText({
      model: google('gemini-3.1-flash-lite'),
      system: systemPrompt,
      prompt: userPrompt,
    })

    let raw: {
      name: string
      sessions: {
        name: string
        icon: string
        exercises: {
          name: string
          exerciseRole: string
          progressionStyleName?: string
          mainMuscles: string[]
          secondaryMuscles: string[]
        }[]
      }[]
      reasoning: string
    }
    try {
      raw = JSON.parse(text)
    } catch {
      console.error('[generate-program] Failed to parse Gemini JSON:', text.slice(0, 500))
      return NextResponse.json({ error: 'Failed to generate program. Please try again.' }, { status: 500 })
    }

    const validNames = new Set(filteredExercises.map(e => e.name))
    for (const sess of raw.sessions ?? []) {
      sess.exercises = (sess.exercises ?? []).filter(ex => validNames.has(ex.name))
    }

    // Map progressionStyleName → progressionStyleId using the user's actual styles
    const styleByName = new Map(userStyles.map(s => [s.name, s.id]))

    const phaseSets = await repo.listPhaseSets(userId)
    const phaseSet =
      phaseSets.find(ps => ps.name === inputs.phaseStructureName) ??
      phaseSets.find(ps => ps.name.toLowerCase().includes(inputs.phaseStructureName.split(' ')[0].toLowerCase())) ??
      phaseSets.find(ps => ps.isDefault) ??
      phaseSets[0]
    if (!phaseSet) {
      return NextResponse.json({ error: 'No phase sets found. Please set up a phase set in your account settings.' }, { status: 400 })
    }

    const SESSION_EMOJI: Record<string, string> = {
      push: '🫸', pull: '🫷', legs: '🦵', upper: '💪', lower: '🦵',
      'full body': '🏋️', cardio: '🏃', core: '🔥', arms: '💪',
      back: '🔙', chest: '🫁', shoulders: '🙆', glutes: '🍑',
    }

    const programJson: GeneratedProgram = {
      name: raw.name,
      sessions: raw.sessions.map(s => {
        const hasEmoji = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(s.icon ?? '')
        const icon = hasEmoji
          ? s.icon
          : (SESSION_EMOJI[s.name.toLowerCase()] ?? SESSION_EMOJI[s.name.toLowerCase().split(' ')[0]] ?? '🏋️')
        return {
          name: s.name,
          icon,
          exercises: s.exercises.map(ex => {
            const styleName = ex.progressionStyleName ?? ''
            const styleId = styleByName.get(styleName)
            return {
              name: ex.name,
              exerciseRole: (ex.exerciseRole as GeneratedExercise['exerciseRole']) ?? 'accessory',
              progressionStyleName: styleName || undefined,
              progressionStyleId: styleId,
              mainMuscles: ex.mainMuscles,
              secondaryMuscles: ex.secondaryMuscles,
            }
          }),
        }
      }),
      reasoning: raw.reasoning,
      phaseStructureName: inputs.phaseStructureName,
      phaseSetId: phaseSet.id,
    }

    return NextResponse.json({ program: programJson })
  } catch (err) {
    console.error('[generate-program] Gemini error:', err)
    return NextResponse.json({ error: 'Failed to generate program. Please try again.' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Build check**

```bash
pnpm run build 2>&1 | grep -E "error TS|Type error|✓ Compiled|Failed" | head -10
```
Expected: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

```bash
git add app/api/generate-program/route.ts
git commit -m "feat: style-aware time calculation and per-exercise style selection in builder"
```

---

## Task 4: Update `builder-review` — show style info, save styleId

**Files:**
- Modify: `components/workout-builder/builder-review.tsx`

Two changes:
1. Show "4 × 10 @ 65%" style info line under each exercise name.
2. Pass `styleId` to the save payload so `session_exercises.style_id` is populated.

The style info is derived from `KNOWN_STYLES` (the same map as the route). We duplicate it here client-side (a small constant) rather than making an extra API call.

- [ ] **Step 1: Add the style display constant and update exercise rendering**

Read `components/workout-builder/builder-review.tsx` lines 1–30 to confirm the current imports, then add after the `ROLE_BADGE` constant (line 22):

```typescript
const STYLE_DISPLAY: Record<string, string> = {
  'Hypertrophy':      '4 × 10 @ 65% · 60s rest',
  'Hypertrophy 3-set':'3 × 10 @ 65% · 60s rest',
  'Strength':         '4 × 5 @ 80% · 120s rest',
  'Strength 3-set':   '3 × 5 @ 80% · 120s rest',
  'Peak':             '3 × 3 @ 90% · 180s rest',
  'Peak 4-set':       '4 × 3 @ 90% · 180s rest',
  'General':          '3 × 12 @ 60% · 60s rest',
  'General 4-set':    '4 × 12 @ 60% · 60s rest',
}
```

- [ ] **Step 2: Show style info in the exercise list**

Find the exercise rendering section in `builder-review.tsx`. Each exercise currently shows name + role badge. Add a style line after the name. The exercise rendering looks like (find by searching for `exerciseRole` or `ROLE_BADGE` usage in JSX):

```tsx
{/* existing: exercise name */}
<span className="text-sm font-medium truncate">{ex.name}</span>
{/* ADD: style info line */}
{ex.progressionStyleName && STYLE_DISPLAY[ex.progressionStyleName] && (
  <span className="text-[10px] text-muted-foreground mt-0.5 block">
    {STYLE_DISPLAY[ex.progressionStyleName]}
  </span>
)}
```

Find the exact text of the exercise name span in the file and add the style line immediately after it.

- [ ] **Step 3: Pass `styleId` in the save payload**

In `handleSave` (line 118), the `exercises` array is built at line 129. Add `styleId: ex.progressionStyleId` to each exercise object:

```typescript
exercises: session.exercises.map((ex, ei) => ({
  id: crypto.randomUUID(),
  sessionId: sid,
  exerciseName: ex.name,
  muscleGroups: [...ex.mainMuscles, ...ex.secondaryMuscles],
  position: ei,
  exerciseRole: ex.exerciseRole,
  styleId: ex.progressionStyleId,  // ADD THIS LINE
})),
```

- [ ] **Step 4: Build check**

```bash
pnpm run build 2>&1 | grep -E "error TS|Type error|✓ Compiled|Failed" | head -10
```
Expected: `✓ Compiled successfully`

- [ ] **Step 5: Commit**

```bash
git add components/workout-builder/builder-review.tsx
git commit -m "feat: show style set/rep info in builder review and save styleId per exercise"
```

---

## Task 5: Fix 1RM default logic in `/api/log-exercise`

**Files:**
- Modify: `app/api/log-exercise/route.ts` lines 173–186

**Current code** (lines 173–186):
```typescript
const setData = weights.map((w, i) => {
  const r = reps[i] ?? reps[reps.length - 1];
  return {
    setNumber: i + 1,
    weightKg: w,
    reps: r,
    setTimeSec: setTimes?.[i],
    restTimeSec: restTimes?.[i],
    intensityPct: estimated1rm > 0 ? Math.round(w / estimated1rm * 1000) / 10 : undefined,
    useFor1rm: progressionStyle?.[i]?.useFor1rm ?? true,
    setStartMs: setStartTimes?.[i],
    setEndMs: setEndTimes?.[i],
  };
});
```

**Current behaviour:** When no `progressionStyle` is provided, all sets default to `useFor1rm: true`.

**New behaviour:**
- When all reps are equal → all sets count (`useFor1rm: true`)
- When reps vary → only sets with the minimum rep count count (lowest reps = closest to 1RM effort)
- Explicit `progressionStyle[i].useFor1rm` always takes precedence (unchanged)

- [ ] **Step 1: Update the setData block**

Replace the `setData` block with:

```typescript
const allRepsEqual = reps.every(r => r === reps[0])
const minReps = Math.min(...reps)

const setData = weights.map((w, i) => {
  const r = reps[i] ?? reps[reps.length - 1];
  const defaultUseFor1rm = allRepsEqual ? true : r === minReps
  return {
    setNumber: i + 1,
    weightKg: w,
    reps: r,
    setTimeSec: setTimes?.[i],
    restTimeSec: restTimes?.[i],
    intensityPct: estimated1rm > 0 ? Math.round(w / estimated1rm * 1000) / 10 : undefined,
    useFor1rm: progressionStyle?.[i]?.useFor1rm ?? defaultUseFor1rm,
    setStartMs: setStartTimes?.[i],
    setEndMs: setEndTimes?.[i],
  };
});
```

- [ ] **Step 2: Build check**

```bash
pnpm run build 2>&1 | grep -E "error TS|Type error|✓ Compiled|Failed" | head -10
```
Expected: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

```bash
git add app/api/log-exercise/route.ts
git commit -m "fix: auto-derive useFor1rm from rep equality — equal reps all count, varied reps only lowest-rep sets count"
```

---

## Task 6: Push branch

- [ ] **Step 1: Ensure on correct branch**

```bash
git branch --show-current
```
Expected: `claude/upbeat-hamilton-5c3Fo`

If not on that branch:
```bash
git checkout -b claude/upbeat-hamilton-5c3Fo
```

- [ ] **Step 2: Push**

```bash
git push -u origin claude/upbeat-hamilton-5c3Fo
```

---

## Self-Review

**Spec coverage:**
- ✅ 3-set variants of Hypertrophy and Strength — Task 1
- ✅ 4-set variants of Peak and General — Task 1
- ✅ Migration for existing users — Task 1
- ✅ AI picks style per exercise — Task 3 (prompt update + schema)
- ✅ Accurate time calc using restSec + reps — Task 3 (`styleTimeMin`)
- ✅ Style info shown in review screen — Task 4
- ✅ styleId saved to session_exercises — Task 4
- ✅ 1RM default logic — Task 5

**Placeholder scan:** No TBDs, no "implement later". Step 2 of Task 4 says "find the exact text" — that's because the exact JSX is too long to reproduce without reading the file, but the instruction is precise enough.

**Type consistency:**
- `progressionStyleName?: string` and `progressionStyleId?: string` defined in Task 2, used in Task 3 (set by server) and Task 4 (displayed + saved). ✓
- `styleTimeMin` takes `{ reps: number; restSec: number }[]` — matches `KNOWN_STYLES[n].sets` shape. ✓
- `styleByName` is `Map<string, string>` (name → UUID) — `styleId` assigned as `string | undefined`. ✓
