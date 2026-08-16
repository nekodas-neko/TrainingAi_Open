> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Workout Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 7-step AI-powered workout program wizard that generates a complete block-periodization program from user inputs (equipment, frequency, time, muscles, goal, phase structure), with an interactive review screen for exercise swaps and AI chat refinement before saving.

**Architecture:** Two new API routes (`/api/generate-program`, `/api/builder-chat`) call Gemini to create and refine program JSON. Two new components (`BuilderWizard`, `BuilderReview`) implement the wizard and review screens. The generated program saves via the existing `/api/workout-templates` endpoint. Data layer gets an `equipment` column on `exercise_library` and phase set renames via migrations.

**Tech Stack:** Next.js 15, TypeScript, React 19, Drizzle ORM, PostgreSQL, Gemini 3.1 Flash Lite (`@ai-sdk/google` + `ai` v5), Zod v4, Tailwind v4, shadcn/ui Sheets

**Branch:** `claude/project-review-brainstorm-SoBBa`

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Create | `lib/data/postgres/migrations/030_exercise_equipment.sql` | Add `equipment TEXT[]` column + populate all 51 exercises |
| Create | `lib/data/postgres/migrations/031_rename_phase_sets.sql` | Rename Default→Phase-Based Progression, Re-baseline→Baselining |
| Modify | `lib/data/postgres/schema.ts` | Add `equipment` field to `exerciseLibrary` table definition |
| Modify | `lib/types/program.ts` | Add `equipment: string[]` to `ExerciseLibraryEntry` |
| Modify | `lib/data/postgres/adapter.ts` | Return `equipment` from `listExerciseLibrary`; update `upsertUser` seed names |
| Create | `lib/types/builder.ts` | `GeneratedProgram`, `GeneratedSession`, `GeneratedExercise`, `BuilderInputs` types |
| Create | `app/api/generate-program/route.ts` | POST: Gemini generates initial program from inputs |
| Create | `app/api/builder-chat/route.ts` | POST: Gemini refines program from user chat message |
| Create | `components/workout-builder/builder-wizard.tsx` | 7-step wizard form |
| Create | `components/workout-builder/builder-review.tsx` | Review screen with swaps + chat + save |
| Modify | `components/config-screen.tsx` | Add "Build Program" button that opens the wizard Sheet |

---

## Task 1: DB Migrations

**Files:**
- Create: `lib/data/postgres/migrations/030_exercise_equipment.sql`
- Create: `lib/data/postgres/migrations/031_rename_phase_sets.sql`

- [ ] **Step 1: Create migration 030 — add equipment column and populate all 51 exercises**

Create `/home/user/TrainingAI/lib/data/postgres/migrations/030_exercise_equipment.sql`:

```sql
-- 030_exercise_equipment.sql
-- Adds equipment array to exercise_library and populates all 51 seeded exercises.

ALTER TABLE exercise_library ADD COLUMN IF NOT EXISTS equipment TEXT[] DEFAULT '{}';

-- Chest
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Bench Press';
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Incline Bench Press';
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Decline Bench Press';
UPDATE exercise_library SET equipment = ARRAY['dumbbell']                             WHERE name = 'Chest Fly';
UPDATE exercise_library SET equipment = ARRAY['cable']                                WHERE name = 'Cable Fly';
UPDATE exercise_library SET equipment = ARRAY['machine']                              WHERE name = 'Pec Deck';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']                           WHERE name = 'Push-Up';
UPDATE exercise_library SET equipment = ARRAY['bodyweight', 'machine']                WHERE name = 'Dip';

-- Shoulders
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell']                  WHERE name = 'Overhead Press';
UPDATE exercise_library SET equipment = ARRAY['dumbbell']                             WHERE name = 'Arnold Press';
UPDATE exercise_library SET equipment = ARRAY['dumbbell', 'cable', 'kettlebell']      WHERE name = 'Lateral Raise';
UPDATE exercise_library SET equipment = ARRAY['dumbbell', 'barbell', 'kettlebell']    WHERE name = 'Front Raise';
UPDATE exercise_library SET equipment = ARRAY['cable']                                WHERE name = 'Face Pull';
UPDATE exercise_library SET equipment = ARRAY['dumbbell', 'cable']                    WHERE name = 'Reverse Fly';
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell', 'cable']         WHERE name = 'Upright Row';

-- Traps
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell']                  WHERE name = 'Shrug';

-- Triceps
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Close Grip Bench';
UPDATE exercise_library SET equipment = ARRAY['cable', 'machine']                     WHERE name = 'Tricep Pushdown';
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell']                  WHERE name = 'Skull Crusher';
UPDATE exercise_library SET equipment = ARRAY['dumbbell', 'cable']                    WHERE name = 'Overhead Tricep Ext';

-- Biceps
UPDATE exercise_library SET equipment = ARRAY['dumbbell', 'kettlebell']               WHERE name = 'Dumbbell Curl';
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Barbell Curl';
UPDATE exercise_library SET equipment = ARRAY['dumbbell', 'kettlebell']               WHERE name = 'Hammer Curl';
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell', 'machine']       WHERE name = 'Preacher Curl';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']                           WHERE name = 'Chin-Up';

-- Forearms
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell']                  WHERE name = 'Wrist Curl';

-- Back
UPDATE exercise_library SET equipment = ARRAY['bodyweight']                           WHERE name = 'Pull-Up';
UPDATE exercise_library SET equipment = ARRAY['cable', 'machine']                     WHERE name = 'Lat Pulldown';
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Barbell Row';
UPDATE exercise_library SET equipment = ARRAY['dumbbell', 'kettlebell']               WHERE name = 'Dumbbell Row';
UPDATE exercise_library SET equipment = ARRAY['cable']                                WHERE name = 'Cable Row';
UPDATE exercise_library SET equipment = ARRAY['cable', 'machine']                     WHERE name = 'Seated Row';
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'T-Bar Row';

-- Lower Body
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Deadlift';
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell']                  WHERE name = 'Romanian Deadlift';
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Good Morning';
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Squat';
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Front Squat';
UPDATE exercise_library SET equipment = ARRAY['machine']                              WHERE name = 'Hack Squat';
UPDATE exercise_library SET equipment = ARRAY['machine']                              WHERE name = 'Leg Press';
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell', 'kettlebell']    WHERE name = 'Bulgarian Split Squat';
UPDATE exercise_library SET equipment = ARRAY['machine']                              WHERE name = 'Leg Extension';
UPDATE exercise_library SET equipment = ARRAY['machine']                              WHERE name = 'Leg Curl';
UPDATE exercise_library SET equipment = ARRAY['barbell', 'machine']                   WHERE name = 'Hip Thrust';
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell', 'bodyweight', 'kettlebell'] WHERE name = 'Glute Bridge';
UPDATE exercise_library SET equipment = ARRAY['machine', 'barbell', 'dumbbell', 'kettlebell']    WHERE name = 'Calf Raise';
UPDATE exercise_library SET equipment = ARRAY['machine']                              WHERE name = 'Adductor Machine';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']                           WHERE name = 'Hip Flexor Raise';

-- Core
UPDATE exercise_library SET equipment = ARRAY['bodyweight']                           WHERE name = 'Plank';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']                           WHERE name = 'Ab Wheel';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']                           WHERE name = 'Crunch';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']                           WHERE name = 'Leg Raise';
```

- [ ] **Step 2: Create migration 031 — rename phase sets**

Create `/home/user/TrainingAI/lib/data/postgres/migrations/031_rename_phase_sets.sql`:

```sql
-- 031_rename_phase_sets.sql
-- Renames the two built-in phase sets to their new display names.
-- 'Default' (is_default=true) becomes 'Phase-Based Progression'.
-- 'Re-baseline' becomes 'Baselining'.

UPDATE phase_sets SET name = 'Phase-Based Progression' WHERE name = 'Default' AND is_default = true;
UPDATE phase_sets SET name = 'Baselining'               WHERE name = 'Re-baseline';
```

- [ ] **Step 3: Verify migrations are syntactically valid**

Run: `pnpm run build`
Expected: Compiles successfully (migrations are SQL-only; build validates TS, not SQL)

---

## Task 2: Schema, Types, and Adapter Updates

**Files:**
- Modify: `lib/data/postgres/schema.ts`
- Modify: `lib/types/program.ts`
- Modify: `lib/data/postgres/adapter.ts`

- [ ] **Step 1: Add `equipment` column to schema.ts**

In `lib/data/postgres/schema.ts`, find the `exerciseLibrary` table definition (the table with columns `id`, `name`, `muscles`) and add the `equipment` column:

```typescript
// Find this table definition and add the equipment line:
export const exerciseLibrary = pgTable('exercise_library', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  muscles: jsonb('muscles').default([]),
  equipment: text('equipment').array().default([]),   // ADD THIS LINE
})
```

- [ ] **Step 2: Add `equipment` to ExerciseLibraryEntry type**

In `lib/types/program.ts`, update lines 6-10:

```typescript
export interface ExerciseLibraryEntry {
  id: string
  name: string
  muscles: MuscleAssignment[]
  equipment: string[]   // ADD THIS LINE
}
```

- [ ] **Step 3: Return `equipment` from listExerciseLibrary in adapter**

In `lib/data/postgres/adapter.ts`, find the `listExerciseLibrary` method (around line 1266). It maps rows to objects. Update the map to include equipment:

```typescript
return rows.map(r => ({
  id: r.id,
  name: r.name,
  muscles: (r.muscles as MuscleAssignment[]) ?? [],
  equipment: (r.equipment as string[]) ?? [],   // ADD THIS LINE
}))
```

- [ ] **Step 4: Update phase set seed names in upsertUser**

In `lib/data/postgres/adapter.ts`:

At **line 150**, change `name: 'Default'` to `name: 'Phase-Based Progression'`:
```typescript
// Before:
await this.db.insert(s.phaseSets).values({ id: phaseSetId, userId: returnedUser.id, name: 'Default', isDefault: true })

// After:
await this.db.insert(s.phaseSets).values({ id: phaseSetId, userId: returnedUser.id, name: 'Phase-Based Progression', isDefault: true })
```

At **line 203**, change `name: 'Re-baseline'` to `name: 'Baselining'`:
```typescript
// Before:
{
  name: 'Re-baseline',
  phases: [

// After:
{
  name: 'Baselining',
  phases: [
```

- [ ] **Step 5: Verify build passes**

Run: `pnpm run build`
Expected: Compiled successfully with no type errors

- [ ] **Step 6: Commit**

```bash
git checkout -b claude/project-review-brainstorm-SoBBa 2>/dev/null || git checkout claude/project-review-brainstorm-SoBBa
git add lib/data/postgres/migrations/030_exercise_equipment.sql \
        lib/data/postgres/migrations/031_rename_phase_sets.sql \
        lib/data/postgres/schema.ts \
        lib/types/program.ts \
        lib/data/postgres/adapter.ts
git commit -m "feat: add equipment column to exercise library, rename phase sets"
```

---

## Task 3: Shared Builder Types

**Files:**
- Create: `lib/types/builder.ts`

- [ ] **Step 1: Create builder types file**

Create `/home/user/TrainingAI/lib/types/builder.ts`:

```typescript
export interface GeneratedExercise {
  name: string
  exerciseRole: 'primary' | 'secondary' | 'accessory'
  mainMuscles: string[]
  secondaryMuscles: string[]
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
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}
```

- [ ] **Step 2: Verify build passes**

Run: `pnpm run build`
Expected: Compiled successfully

---

## Task 4: Generate Program API Route

**Files:**
- Create: `app/api/generate-program/route.ts`

- [ ] **Step 1: Create the route**

Create `/home/user/TrainingAI/app/api/generate-program/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import { z } from 'zod'
import type { GeneratedProgram } from '@/lib/types/builder'

const RequestSchema = z.object({
  programName: z.string().min(1).max(100),
  equipment: z.array(z.string()).min(1),
  sessionsPerWeek: z.number().int().min(1).max(7),
  timePerSessionMinutes: z.number().int().min(30).max(180).nullable(),
  musclesToFocus: z.array(z.string()).min(1),
  goal: z.enum(['hypertrophy', 'strength', 'strength+hypertrophy']),
  phaseStructureName: z.enum(['Linear Progression', 'Baselining', 'Phase-Based Progression']),
})

const EQUIPMENT_LABEL: Record<string, string> = {
  barbell: 'Barbell', dumbbell: 'Dumbbells', cable: 'Cables',
  kettlebell: 'Kettlebells', machine: 'Machines', bodyweight: 'Bodyweight',
}

function buildEquipmentSet(selected: string[]): Set<string> {
  const set = new Set<string>(['bodyweight'])
  if (selected.includes('full_gym')) {
    ['barbell','dumbbell','cable','kettlebell','machine','bodyweight'].forEach(e => set.add(e))
  } else {
    selected.forEach(e => set.add(e))
  }
  return set
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const limited = rateLimit(userId, 'generate-program', 5, 60 * 60 * 1000)
  if (!limited.ok) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })

  const body = await req.json().catch(() => null)
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })

  const inputs = parsed.data
  const repo = await getRepositoryAsync()

  const allExercises = await repo.listExerciseLibrary()
  const equipmentSet = buildEquipmentSet(inputs.equipment)
  const focusSet = new Set(inputs.musclesToFocus.map(m => m.toLowerCase()))

  const filteredExercises = allExercises.filter(ex => {
    const hasEquipment = ex.equipment.length === 0 || ex.equipment.some(e => equipmentSet.has(e))
    const muscleNames = ex.muscles.map(m => m.muscle.toLowerCase())
    const relevant = muscleNames.some(m => focusSet.has(m)) || focusSet.has('full body')
    return hasEquipment && relevant
  })

  const exerciseList = filteredExercises.map(ex => ({
    name: ex.name,
    muscles: ex.muscles.map(m => `${m.muscle} (${m.role})`).join(', '),
    equipment: ex.equipment.map(e => EQUIPMENT_LABEL[e] ?? e).join(', '),
  }))

  const timeNote = inputs.timePerSessionMinutes
    ? `${inputs.timePerSessionMinutes} minutes per session. Estimate 2.5 min/set for hypertrophy (work + 60s rest + transition) or 3.5 min/set for strength (work + 120s rest + transition). Adjust exercise count to fit.`
    : `No time constraint. Aim for maximum recommended weekly volume: hypertrophy ~20 sets/muscle/week, strength ~25 sets/muscle/week, strength+hypertrophy ~20 sets/muscle/week.`

  const systemPrompt = `You are an expert strength and conditioning coach. Generate a structured workout program as JSON. Return ONLY valid JSON — no markdown, no code fences, no extra text.`

  const userPrompt = `Design a workout program with these constraints:
- Program name: "${inputs.programName}"
- Available equipment: ${inputs.equipment.map(e => EQUIPMENT_LABEL[e] ?? e).join(', ')}
- Training days per week: ${inputs.sessionsPerWeek}
- Time budget: ${timeNote}
- Muscles to focus on: ${inputs.musclesToFocus.join(', ')}
- Goal: ${inputs.goal}
- Phase structure: ${inputs.phaseStructureName}

Rules:
1. Choose a split type matching frequency and muscle focus (e.g. 3 days = Push/Pull/Legs, 2 days = Upper/Lower, 1 day = Full Body, 5+ days = specialised).
2. Use ONLY exercises from the list below. Match exercise names exactly.
3. Assign each exercise a role: "primary" (main compound), "secondary" (secondary compound), or "accessory" (isolation/single-joint).
4. Keep 1–2 accessory exercises per session; primaries and secondaries should dominate.
5. Balance weekly volume across targeted muscles.
6. Pick a session icon emoji matching the session focus.

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
          "mainMuscles": string[],
          "secondaryMuscles": string[]
        }
      ]
    }
  ],
  "reasoning": string
}`

  let programJson: GeneratedProgram
  try {
    const { text } = await generateText({
      model: google('gemini-3.1-flash-lite'),
      system: systemPrompt,
      prompt: userPrompt,
    })
    const raw = JSON.parse(text)

    const validNames = new Set(filteredExercises.map(e => e.name))
    for (const session of raw.sessions ?? []) {
      session.exercises = (session.exercises ?? []).filter((ex: { name: string }) => validNames.has(ex.name))
    }

    const phaseSets = await repo.listPhaseSets(userId)
    const phaseSet = phaseSets.find(ps => ps.name === inputs.phaseStructureName)
    if (!phaseSet) return NextResponse.json({ error: 'Phase set not found' }, { status: 400 })

    programJson = {
      ...raw,
      phaseStructureName: inputs.phaseStructureName,
      phaseSetId: phaseSet.id,
    }
  } catch (err) {
    console.error('[generate-program] Gemini error:', err)
    return NextResponse.json({ error: 'Failed to generate program. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ program: programJson })
}
```

- [ ] **Step 2: Verify build passes**

Run: `pnpm run build`
Expected: Compiled successfully

- [ ] **Step 3: Commit**

```bash
git add lib/types/builder.ts app/api/generate-program/route.ts
git commit -m "feat: add generate-program API route"
```

---

## Task 5: Builder Chat API Route

**Files:**
- Create: `app/api/builder-chat/route.ts`

- [ ] **Step 1: Create the route**

Create `/home/user/TrainingAI/app/api/builder-chat/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { rateLimit } from '@/lib/rate-limit'
import { getRepositoryAsync } from '@/lib/data'
import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import { z } from 'zod'
import type { GeneratedProgram, ChatMessage } from '@/lib/types/builder'

const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
})

const RequestSchema = z.object({
  message: z.string().min(1).max(1000),
  program: z.any(),
  chatHistory: z.array(ChatMessageSchema).max(20),
  equipment: z.array(z.string()),
})

const EQUIPMENT_LABEL: Record<string, string> = {
  barbell: 'Barbell', dumbbell: 'Dumbbells', cable: 'Cables',
  kettlebell: 'Kettlebells', machine: 'Machines', bodyweight: 'Bodyweight',
}

function buildEquipmentSet(selected: string[]): Set<string> {
  const set = new Set<string>(['bodyweight'])
  if (selected.includes('full_gym')) {
    ['barbell','dumbbell','cable','kettlebell','machine','bodyweight'].forEach(e => set.add(e))
  } else {
    selected.forEach(e => set.add(e))
  }
  return set
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const limited = rateLimit(userId, 'builder-chat', 20, 60 * 60 * 1000)
  if (!limited.ok) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })

  const body = await req.json().catch(() => null)
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const { message, program, chatHistory, equipment } = parsed.data
  const repo = await getRepositoryAsync()

  const allExercises = await repo.listExerciseLibrary()
  const equipmentSet = buildEquipmentSet(equipment)
  const availableExercises = allExercises
    .filter(ex => ex.equipment.length === 0 || ex.equipment.some(e => equipmentSet.has(e)))
    .map(ex => ({
      name: ex.name,
      muscles: ex.muscles.map(m => `${m.muscle} (${m.role})`).join(', '),
      equipment: ex.equipment.map(e => EQUIPMENT_LABEL[e] ?? e).join(', '),
    }))

  const historyText = chatHistory
    .map((m: ChatMessage) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n')

  const systemPrompt = `You are a fitness coach helping a user refine their workout program. The user may ask to swap exercises, add/remove exercises, change sessions, or adjust volume. When you make changes, return the complete updated program JSON. Return your response as JSON with two fields: "response" (your conversational reply, 1-3 sentences) and "program" (the complete updated program object). Return ONLY valid JSON, no markdown.`

  const userPrompt = `Current program:
${JSON.stringify(program, null, 2)}

Available exercises (filtered by user's equipment):
${JSON.stringify(availableExercises, null, 2)}

Previous conversation:
${historyText || '(none)'}

User message: ${message}

Return JSON: { "response": string, "program": <updated program object with same structure as current program> }`

  try {
    const { text } = await generateText({
      model: google('gemini-3.1-flash-lite'),
      system: systemPrompt,
      prompt: userPrompt,
    })
    const raw = JSON.parse(text)
    return NextResponse.json({
      response: raw.response ?? 'Done!',
      program: raw.program as GeneratedProgram,
    })
  } catch (err) {
    console.error('[builder-chat] Gemini error:', err)
    return NextResponse.json({ error: 'Failed to process request. Please try again.' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify build passes**

Run: `pnpm run build`
Expected: Compiled successfully

- [ ] **Step 3: Commit**

```bash
git add app/api/builder-chat/route.ts
git commit -m "feat: add builder-chat API route"
```

---

## Task 6: BuilderWizard Component

**Files:**
- Create: `components/workout-builder/builder-wizard.tsx`

- [ ] **Step 1: Create the wizard component**

Create `/home/user/TrainingAI/components/workout-builder/builder-wizard.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Wand2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BuilderInputs, GeneratedProgram } from '@/lib/types/builder'
import BuilderReview from './builder-review'

const EQUIPMENT_OPTIONS = [
  { id: 'dumbbell',  label: 'Dumbbells' },
  { id: 'barbell',   label: 'Barbell' },
  { id: 'cable',     label: 'Cables' },
  { id: 'kettlebell', label: 'Kettlebell' },
  { id: 'full_gym',  label: 'Full Gym' },
]

const MUSCLE_GROUPS = [
  'Chest', 'Lats', 'Upper Back', 'Lower Back', 'Traps',
  'Shoulders', 'Biceps', 'Triceps', 'Forearms',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core',
]

const PHASE_STRUCTURES = [
  { name: 'Linear Progression',     description: 'Steady 8-week build, add weight each week' },
  { name: 'Baselining',             description: '8 weeks to re-establish your 1RMs after time off' },
  { name: 'Phase-Based Progression', description: '4 weeks accumulation → 3 weeks strength → 2 weeks peak → 1 week deload' },
]

const INITIAL_INPUTS: BuilderInputs = {
  programName: '',
  equipment: [],
  sessionsPerWeek: 3,
  timePerSessionMinutes: 60,
  musclesToFocus: [],
  goal: 'hypertrophy',
  phaseStructureName: 'Phase-Based Progression',
}

function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]
}

export default function BuilderWizard({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [step, setStep] = useState(1)
  const [inputs, setInputs] = useState<BuilderInputs>(INITIAL_INPUTS)
  const [generating, setGenerating] = useState(false)
  const [program, setProgram] = useState<GeneratedProgram | null>(null)

  const totalSteps = 7

  function canAdvance(): boolean {
    switch (step) {
      case 1: return inputs.programName.trim().length > 0
      case 2: return inputs.equipment.length > 0
      case 3: return inputs.sessionsPerWeek >= 1
      case 4: return true
      case 5: return inputs.musclesToFocus.length > 0
      case 6: return true
      case 7: return inputs.phaseStructureName.length > 0
      default: return true
    }
  }

  async function handleGenerate() {
    setGenerating(true)
    try {
      const res = await fetch('/api/generate-program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputs),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Generation failed'); return }
      setProgram(data.program)
      setStep(8)
    } catch {
      toast.error('Failed to generate program. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  function handleNext() {
    if (step === totalSteps) { handleGenerate(); return }
    setStep(s => s + 1)
  }

  if (step === 8 && program) {
    return (
      <BuilderReview
        program={program}
        inputs={inputs}
        onBack={() => setStep(7)}
        onSaved={onSaved}
        onProgramChange={setProgram}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <button onClick={step === 1 ? onClose : () => setStep(s => s - 1)} className="p-2 -ml-2 text-muted-foreground">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="text-xs text-muted-foreground">Step {step} of {totalSteps}</p>
        <div className="w-9" />
      </div>

      {/* Progress bar */}
      <div className="px-4 mb-4">
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-brand rounded-full transition-all duration-300"
            style={{ width: `${(step / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">

        {/* Step 1: Program Name */}
        {step === 1 && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold">Name your program</h2>
            <input
              type="text"
              value={inputs.programName}
              onChange={e => setInputs(i => ({ ...i, programName: e.target.value }))}
              placeholder="e.g. Push-Pull-Legs"
              className="w-full rounded-xl bg-muted px-4 py-3 text-sm outline-none focus:ring-2 ring-brand"
              maxLength={100}
              autoFocus
            />
          </div>
        )}

        {/* Step 2: Equipment */}
        {step === 2 && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold">What equipment do you have?</h2>
            <p className="text-sm text-muted-foreground">Select all that apply</p>
            <div className="grid grid-cols-2 gap-2">
              {EQUIPMENT_OPTIONS.map(opt => {
                const isFullGym = opt.id === 'full_gym'
                const allEquip = ['dumbbell', 'barbell', 'cable', 'kettlebell']
                const selected = isFullGym
                  ? allEquip.every(e => inputs.equipment.includes(e))
                  : inputs.equipment.includes(opt.id)
                return (
                  <button
                    key={opt.id}
                    onClick={() => {
                      if (isFullGym) {
                        const allSelected = allEquip.every(e => inputs.equipment.includes(e))
                        setInputs(i => ({
                          ...i,
                          equipment: allSelected ? [] : allEquip,
                        }))
                      } else {
                        setInputs(i => ({ ...i, equipment: toggle(i.equipment, opt.id) }))
                      }
                    }}
                    className={cn(
                      'rounded-xl border px-4 py-3 text-sm font-semibold text-left transition',
                      selected ? 'bg-brand text-white border-brand' : 'bg-muted border-transparent'
                    )}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Step 3: Training Frequency */}
        {step === 3 && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold">How many days per week?</h2>
            <div className="grid grid-cols-4 gap-2">
              {[1,2,3,4,5,6,7].map(n => (
                <button
                  key={n}
                  onClick={() => setInputs(i => ({ ...i, sessionsPerWeek: n }))}
                  className={cn(
                    'rounded-xl border py-3 text-sm font-bold transition',
                    inputs.sessionsPerWeek === n ? 'bg-brand text-white border-brand' : 'bg-muted border-transparent'
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 4: Time Budget */}
        {step === 4 && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold">How long per session?</h2>
            <div className="space-y-2">
              {[
                { label: '30 minutes', value: 30 },
                { label: '45 minutes', value: 45 },
                { label: '60 minutes', value: 60 },
                { label: '90 minutes', value: 90 },
                { label: 'No time constraint', value: null },
              ].map(opt => (
                <button
                  key={String(opt.value)}
                  onClick={() => setInputs(i => ({ ...i, timePerSessionMinutes: opt.value }))}
                  className={cn(
                    'w-full rounded-xl border px-4 py-3 text-sm font-semibold text-left transition',
                    inputs.timePerSessionMinutes === opt.value ? 'bg-brand text-white border-brand' : 'bg-muted border-transparent'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 5: Muscles */}
        {step === 5 && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold">Which muscles do you want to focus on?</h2>
            <p className="text-sm text-muted-foreground">Select all that apply</p>
            <div className="flex flex-wrap gap-2">
              {MUSCLE_GROUPS.map(muscle => (
                <button
                  key={muscle}
                  onClick={() => setInputs(i => ({ ...i, musclesToFocus: toggle(i.musclesToFocus, muscle) }))}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm font-medium transition',
                    inputs.musclesToFocus.includes(muscle) ? 'bg-brand text-white border-brand' : 'bg-muted border-transparent'
                  )}
                >
                  {muscle}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 6: Goal */}
        {step === 6 && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold">What is your training goal?</h2>
            <div className="space-y-2">
              {[
                { value: 'hypertrophy',           label: 'Hypertrophy', description: 'Build muscle size — moderate weight, higher reps' },
                { value: 'strength',              label: 'Strength',    description: 'Build max strength — heavy weight, lower reps' },
                { value: 'strength+hypertrophy',  label: 'Strength + Hypertrophy', description: 'Balanced approach — alternates size and strength phases' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setInputs(i => ({ ...i, goal: opt.value as BuilderInputs['goal'] }))}
                  className={cn(
                    'w-full rounded-xl border px-4 py-3 text-left transition',
                    inputs.goal === opt.value ? 'bg-brand/10 border-brand' : 'bg-muted border-transparent'
                  )}
                >
                  <p className="text-sm font-semibold">{opt.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 7: Phase Structure */}
        {step === 7 && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold">Choose your phase structure</h2>
            <div className="space-y-2">
              {PHASE_STRUCTURES.map(ps => (
                <button
                  key={ps.name}
                  onClick={() => setInputs(i => ({ ...i, phaseStructureName: ps.name }))}
                  className={cn(
                    'w-full rounded-xl border px-4 py-3 text-left transition',
                    inputs.phaseStructureName === ps.name ? 'bg-brand/10 border-brand' : 'bg-muted border-transparent'
                  )}
                >
                  <p className="text-sm font-semibold">{ps.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{ps.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-safe-or-4 pt-3 border-t border-border/40">
        <button
          onClick={handleNext}
          disabled={!canAdvance() || generating}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold bg-brand text-white disabled:opacity-50 transition"
        >
          {generating ? (
            <>
              <span className="animate-spin">⏳</span>
              Generating…
            </>
          ) : step === totalSteps ? (
            <>
              <Wand2 className="h-4 w-4" />
              Generate Program
            </>
          ) : (
            <>
              Next
              <ChevronRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build passes**

Run: `pnpm run build`
Expected: Compiled successfully

---

## Task 7: BuilderReview Component

**Files:**
- Create: `components/workout-builder/builder-review.tsx`

- [ ] **Step 1: Create the review component**

Create `/home/user/TrainingAI/components/workout-builder/builder-review.tsx`:

```typescript
'use client'

import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronDown, Send, Loader2, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GeneratedProgram, GeneratedExercise, BuilderInputs, ChatMessage } from '@/lib/types/builder'
import type { ExerciseLibraryEntry } from '@/lib/types/program'

interface Props {
  program: GeneratedProgram
  inputs: BuilderInputs
  onBack: () => void
  onSaved: () => void
  onProgramChange: (p: GeneratedProgram) => void
}

const ROLE_BADGE: Record<string, string> = {
  primary: 'bg-brand/20 text-brand',
  secondary: 'bg-amber-500/20 text-amber-400',
  accessory: 'bg-muted text-muted-foreground',
}

export default function BuilderReview({ program, inputs, onBack, onSaved, onProgramChange }: Props) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: `Your program is ready! ${program.reasoning} Use the dropdowns to swap any exercise, or chat with me below to make changes.` },
  ])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exerciseLibrary, setExerciseLibrary] = useState<ExerciseLibraryEntry[]>([])
  const [swapOpen, setSwapOpen] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/exercise-library')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.exercises) setExerciseLibrary(data.exercises) })
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  function buildEquipmentSet(selected: string[]): Set<string> {
    const set = new Set<string>(['bodyweight'])
    if (selected.includes('full_gym')) {
      ['barbell','dumbbell','cable','kettlebell','machine','bodyweight'].forEach(e => set.add(e))
    } else {
      selected.forEach(e => set.add(e))
    }
    return set
  }

  function getAlternatives(exercise: GeneratedExercise): ExerciseLibraryEntry[] {
    const equipmentSet = buildEquipmentSet(inputs.equipment)
    const mainMuscles = new Set(exercise.mainMuscles.map(m => m.toLowerCase()))
    return exerciseLibrary
      .filter(ex => {
        if (ex.name === exercise.name) return false
        const hasEquip = ex.equipment.length === 0 || ex.equipment.some(e => equipmentSet.has(e))
        const sharesMain = ex.muscles.some(m => m.role === 'main' && mainMuscles.has(m.muscle.toLowerCase()))
        return hasEquip && sharesMain
      })
      .slice(0, 8)
  }

  function swapExercise(sessionIdx: number, exerciseIdx: number, newExercise: ExerciseLibraryEntry) {
    const updated: GeneratedProgram = {
      ...program,
      sessions: program.sessions.map((session, si) =>
        si !== sessionIdx ? session : {
          ...session,
          exercises: session.exercises.map((ex, ei) =>
            ei !== exerciseIdx ? ex : {
              name: newExercise.name,
              exerciseRole: ex.exerciseRole,
              mainMuscles: newExercise.muscles.filter(m => m.role === 'main').map(m => m.muscle),
              secondaryMuscles: newExercise.muscles.filter(m => m.role === 'secondary').map(m => m.muscle),
            }
          ),
        }
      ),
    }
    onProgramChange(updated)
    setSwapOpen(null)
  }

  async function handleChat() {
    const msg = chatInput.trim()
    if (!msg || chatLoading) return
    setChatInput('')
    const userMsg: ChatMessage = { role: 'user', content: msg }
    setChatMessages(prev => [...prev, userMsg])
    setChatLoading(true)
    try {
      const res = await fetch('/api/builder-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          program,
          chatHistory: chatMessages,
          equipment: inputs.equipment,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Chat failed'); return }
      onProgramChange(data.program)
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.response }])
    } catch {
      toast.error('Chat request failed. Please try again.')
    } finally {
      setChatLoading(false)
    }
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      const sessionId = () => crypto.randomUUID()
      const exerciseId = () => crypto.randomUUID()
      const programId = crypto.randomUUID()

      const programSessions = program.sessions.map((session, si) => {
        const sid = sessionId()
        return {
          id: sid,
          programId,
          name: session.name,
          position: si,
          icon: session.icon,
          exercises: session.exercises.map((ex, ei) => ({
            id: exerciseId(),
            sessionId: sid,
            exerciseName: ex.name,
            muscleGroups: [...ex.mainMuscles, ...ex.secondaryMuscles],
            position: ei,
            exerciseRole: ex.exerciseRole,
          })),
        }
      })

      const res = await fetch('/api/workout-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          program: {
            id: programId,
            userId: '',
            name: program.name,
            isActive: false,
            sessions: programSessions,
            createdAt: new Date(),
            updatedAt: new Date(),
            phaseMode: 'automatic',
            phaseSetId: program.phaseSetId,
          },
        }),
      })
      if (!res.ok) { toast.error('Failed to save program'); return }
      toast.success('Program saved!')
      onSaved()
    } catch {
      toast.error('Failed to save program. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border/40">
        <button onClick={onBack} className="p-2 -ml-2 text-muted-foreground">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm truncate">{program.name}</p>
          <p className="text-xs text-muted-foreground">{program.sessions.length} sessions · {program.phaseStructureName}</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold bg-brand text-white disabled:opacity-50 transition shrink-0"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Save
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Sessions */}
        <div className="px-4 py-3 space-y-4">
          {program.sessions.map((session, si) => (
            <div key={si} className="rounded-xl bg-muted p-3 space-y-2">
              <p className="font-bold text-sm">{session.icon} {session.name}</p>
              {session.exercises.map((ex, ei) => {
                const swapKey = `${si}-${ei}`
                const alts = getAlternatives(ex)
                return (
                  <div key={ei}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{ex.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={cn('text-[10px] font-semibold rounded-full px-2 py-0.5 capitalize', ROLE_BADGE[ex.exerciseRole])}>
                            {ex.exerciseRole}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{ex.mainMuscles.join(', ')}</span>
                        </div>
                      </div>
                      {alts.length > 0 && (
                        <button
                          onClick={() => setSwapOpen(swapOpen === swapKey ? null : swapKey)}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0 py-1"
                        >
                          Swap <ChevronDown className={cn('h-3 w-3 transition-transform', swapOpen === swapKey && 'rotate-180')} />
                        </button>
                      )}
                    </div>
                    {swapOpen === swapKey && (
                      <div className="mt-1 rounded-lg bg-background border border-border/40 overflow-hidden">
                        {alts.map(alt => (
                          <button
                            key={alt.id}
                            onClick={() => swapExercise(si, ei, alt)}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition border-b border-border/20 last:border-0"
                          >
                            <span className="font-medium">{alt.name}</span>
                            <span className="text-muted-foreground ml-2">
                              {alt.muscles.filter(m => m.role === 'main').map(m => m.muscle).join(', ')}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Chat */}
        <div className="px-4 pb-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Chat with AI</p>
          <div className="rounded-xl bg-muted p-3 space-y-2 max-h-48 overflow-y-auto">
            {chatMessages.map((msg, i) => (
              <div key={i} className={cn('text-xs', msg.role === 'user' ? 'text-right' : '')}>
                <span className={cn(
                  'inline-block px-2.5 py-1.5 rounded-xl',
                  msg.role === 'user' ? 'bg-brand text-white' : 'bg-background text-foreground'
                )}>
                  {msg.content}
                </span>
              </div>
            ))}
            {chatLoading && (
              <div className="text-xs">
                <span className="inline-block px-2.5 py-1.5 rounded-xl bg-background">
                  <Loader2 className="h-3 w-3 animate-spin inline" />
                </span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="flex gap-2">
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleChat()}
              placeholder="Ask me to change an exercise, adjust volume…"
              className="flex-1 rounded-xl bg-muted px-3 py-2 text-xs outline-none focus:ring-2 ring-brand"
              disabled={chatLoading}
            />
            <button
              onClick={handleChat}
              disabled={!chatInput.trim() || chatLoading}
              className="rounded-xl px-3 py-2 bg-brand text-white disabled:opacity-50 transition"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build passes**

Run: `pnpm run build`
Expected: Compiled successfully

- [ ] **Step 3: Commit**

```bash
git add components/workout-builder/builder-wizard.tsx \
        components/workout-builder/builder-review.tsx
git commit -m "feat: add BuilderWizard and BuilderReview components"
```

---

## Task 8: Wire into Config Screen + Final Build

**Files:**
- Modify: `components/config-screen.tsx`

- [ ] **Step 1: Import BuilderWizard and add state**

In `components/config-screen.tsx`, add the import near the top (after existing imports):

```typescript
import BuilderWizard from '@/components/workout-builder/builder-wizard'
```

In the component body, add a state variable for the builder sheet (near the other `useState` declarations):

```typescript
const [builderOpen, setBuilderOpen] = useState(false)
```

- [ ] **Step 2: Add the "Build Program" button next to the existing "New" button**

In `components/config-screen.tsx`, find lines 949-957 (the `flex justify-end mb-3` div with the "New" button):

```typescript
// Before:
<div className="flex justify-end mb-3">
  <button
    onClick={openNewProgram}
    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-brand text-white hover:opacity-90 transition"
  >
    <Plus className="h-3.5 w-3.5" />
    New
  </button>
</div>

// After:
<div className="flex justify-end gap-2 mb-3">
  <button
    onClick={() => setBuilderOpen(true)}
    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold border border-brand text-brand hover:bg-brand/10 transition"
  >
    <Wand2 className="h-3.5 w-3.5" />
    Build
  </button>
  <button
    onClick={openNewProgram}
    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-brand text-white hover:opacity-90 transition"
  >
    <Plus className="h-3.5 w-3.5" />
    New
  </button>
</div>
```

Also add `Wand2` to the lucide-react import at the top of config-screen.tsx. Find the line:
```typescript
import { ..., Plus, ... } from 'lucide-react'
```
And add `Wand2` to it.

- [ ] **Step 3: Add the BuilderWizard Sheet at the bottom of the component's JSX**

In `components/config-screen.tsx`, find the closing tag of the outermost container (just before the final `return` closes). Add the Sheet alongside the existing edit sheets:

```typescript
{/* Builder Wizard Sheet */}
<Sheet open={builderOpen} onOpenChange={setBuilderOpen}>
  <SheetContent side="bottom" className="h-[92dvh] p-0 flex flex-col">
    <BuilderWizard
      onClose={() => setBuilderOpen(false)}
      onSaved={() => {
        setBuilderOpen(false)
        fetch('/api/workout-templates')
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (data?.programs) setPrograms(data.programs) })
      }}
    />
  </SheetContent>
</Sheet>
```

- [ ] **Step 4: Run final build**

Run: `pnpm run build`
Expected: ✓ Compiled successfully

If there are type errors:
- Check that `Wand2` is imported from `lucide-react`
- Check that `Sheet`, `SheetContent` are imported (already used in config-screen for phase editor sheets)
- Check `builderOpen` state is declared

- [ ] **Step 5: Commit and push**

```bash
git add components/config-screen.tsx
git commit -m "feat: wire workout builder into config screen"
git push -u origin claude/project-review-brainstorm-SoBBa
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ 7-step wizard (Steps 1–7: name, equipment, frequency, time, muscles, goal, phase structure)
- ✅ Multi-select equipment with Full Gym option
- ✅ 1–7 day frequency range
- ✅ "No time constraint" option → `null` value
- ✅ Goal: hypertrophy / strength / strength+hypertrophy
- ✅ Phase structure shown as descriptive cards (not experience level labels)
- ✅ Equipment column added to exercise_library (migration 030)
- ✅ Phase set renaming (migration 031 + adapter update)
- ✅ `/api/generate-program` with Gemini, equipment filtering, exercise validation
- ✅ `/api/builder-chat` for refinement
- ✅ Review screen with exercise swap dropdowns
- ✅ AI chat in review screen
- ✅ Save via existing `/api/workout-templates`
- ✅ Entry point: "Build" button in Config > Workouts section
- ✅ Rate limiting on both API routes
- ✅ Auth guard on both API routes

**Type consistency:**
- `GeneratedProgram` defined in `lib/types/builder.ts`, used in wizard, review, both API routes
- `BuilderInputs` defined in `lib/types/builder.ts`, used in wizard and review
- `ChatMessage` defined in `lib/types/builder.ts`, used in review and builder-chat route
- Equipment set builder (`buildEquipmentSet`) duplicated in generate-program and builder-chat routes — acceptable duplication for two isolated API routes

**No placeholders:** All code is complete. No TODOs or TBDs.
