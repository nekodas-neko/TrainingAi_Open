> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Phase Sets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-program inline phase editing with reusable named Phase Sets; add a Testing phase type (rep-max to failure); group Progression Styles and Phase Sets under a collapsible "Advanced Settings" section in Config.

**Architecture:** New `phase_sets` table owned by user. `program_phases` gains a `phase_set_id` FK alongside the existing `program_id` (kept for safety, just unused). Programs gain a `phase_set_id` FK. A "Default" phase set (6 phases including Testing) is seeded per user in `upsertUser`. Config screen gets an "Advanced Settings" collapsible. The program editor shows a Phase Set selector instead of an inline PhaseEditor.

**Tech Stack:** Next.js 15, TypeScript, PostgreSQL/Drizzle ORM, React 19, Tailwind CSS v4, Radix UI Sheets.

---

## Files Overview

| File | Action |
|------|--------|
| `lib/data/postgres/migrations/021_phase_sets.sql` | Create |
| `lib/types/program.ts` | Modify — add 'testing' phaseType, PhaseSet types |
| `lib/data/postgres/schema.ts` | Modify — add phaseSets table, phaseSetId columns |
| `lib/data/repository.ts` | Modify — add 5 new method signatures |
| `lib/data/postgres/adapter.ts` | Modify — implement new methods, update seeding |
| `app/api/phase-sets/route.ts` | Create — GET + POST |
| `app/api/phase-sets/[id]/route.ts` | Create — PUT + DELETE |
| `app/api/workout-templates/route.ts` | Modify — pass phaseSetId through to saveProgram |
| `app/api/program-phases/route.ts` | Modify — GET updated (reads via phase_set_id), PUT retired |
| `components/config/phase-editor.tsx` | Modify — add 'testing' type button |
| `components/config-screen.tsx` | Modify — Advanced Settings collapsible, Phase Sets UI, program editor selector |
| `app/api/weekly-stats/route.ts` | Modify — exclude testing, add isTesting flag |
| `app/api/training-load/route.ts` | Modify — exclude testing from chronic window |
| `components/stats/weekly-stats-hub.tsx` | Modify — render purple "T" badge |

---

## Task 1: DB Migration

**Files:**
- Create: `lib/data/postgres/migrations/021_phase_sets.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 021_phase_sets.sql

-- 1. phase_sets table
CREATE TABLE IF NOT EXISTS phase_sets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

-- 2. Add phase_set_id to program_phases (nullable; program_id kept for safe rollback)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'program_phases' AND column_name = 'phase_set_id'
  ) THEN
    ALTER TABLE program_phases
      ADD COLUMN phase_set_id UUID REFERENCES phase_sets(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3. Fix duration_cycles constraint to allow 0 (Accessory phase uses 0)
DO $$ BEGIN
  ALTER TABLE program_phases DROP CONSTRAINT IF EXISTS program_phases_duration_cycles_check;
  ALTER TABLE program_phases
    ADD CONSTRAINT program_phases_duration_cycles_check CHECK (duration_cycles >= 0);
EXCEPTION WHEN others THEN NULL;
END $$;

-- 4. Extend phase_type check to include 'testing'
DO $$ BEGIN
  ALTER TABLE program_phases DROP CONSTRAINT IF EXISTS program_phases_phase_type_check;
  ALTER TABLE program_phases
    ADD CONSTRAINT program_phases_phase_type_check
    CHECK (phase_type IN ('normal', 'peak', 'deload', 'accessory', 'testing'));
EXCEPTION WHEN others THEN NULL;
END $$;

-- 5. Migrate existing block-periodization programs: create Default phase set per user
--    and point their program_phases rows at it
DO $$
DECLARE
  r      RECORD;
  set_id UUID;
BEGIN
  FOR r IN
    SELECT DISTINCT p.user_id, p.id AS program_id
    FROM programs p
    WHERE p.phase_mode = 'automatic'
      AND EXISTS (
        SELECT 1 FROM program_phases pp WHERE pp.program_id = p.id
      )
  LOOP
    SELECT id INTO set_id
    FROM phase_sets
    WHERE user_id = r.user_id AND is_default = true
    LIMIT 1;

    IF set_id IS NULL THEN
      INSERT INTO phase_sets (id, user_id, name, is_default)
      VALUES (gen_random_uuid(), r.user_id, 'Default', true)
      RETURNING id INTO set_id;
    END IF;

    UPDATE program_phases
    SET phase_set_id = set_id
    WHERE program_id = r.program_id AND phase_set_id IS NULL;
  END LOOP;
END $$;

-- 6. Add phase_set_id to programs
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'programs' AND column_name = 'phase_set_id'
  ) THEN
    ALTER TABLE programs
      ADD COLUMN phase_set_id UUID REFERENCES phase_sets(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 7. Wire programs.phase_set_id to the migrated Default sets
UPDATE programs p
SET phase_set_id = ps.id
FROM phase_sets ps
WHERE ps.user_id = p.user_id
  AND ps.is_default = true
  AND p.phase_mode = 'automatic'
  AND p.phase_set_id IS NULL;
```

- [ ] **Step 2: Verify migration runs without error (build check)**

```bash
pnpm run build 2>&1 | tail -5
```
Expected: build succeeds (migration is not run by Next.js build, but this confirms no TS errors were introduced yet).

- [ ] **Step 3: Commit**

```bash
git add lib/data/postgres/migrations/021_phase_sets.sql
git commit -m "Add phase_sets migration: new table, phase_set_id FK on program_phases + programs"
```

---

## Task 2: Types and Drizzle Schema

**Files:**
- Modify: `lib/types/program.ts`
- Modify: `lib/data/postgres/schema.ts`

- [ ] **Step 1: Update `lib/types/program.ts`**

Add `'testing'` to the `phaseType` union, change `ProgramPhase.programId` → `phaseSetId`, and add the two new interfaces.

Replace the entire file content with:

```typescript
export interface MuscleAssignment {
  muscle: string
  role: 'main' | 'secondary'
}

export interface ExerciseLibraryEntry {
  id: string
  name: string
  muscles: MuscleAssignment[]
}

export type ExerciseRole = 'primary' | 'secondary' | 'accessory'

export type ProgramPhaseType = 'normal' | 'peak' | 'deload' | 'accessory' | 'testing'

export interface ProgramPhase {
  id: string
  phaseSetId: string
  position: number
  name: string
  durationCycles: number
  phaseType: ProgramPhaseType
  primaryStyleId?: string
  secondaryStyleId?: string
}

export interface PhaseSet {
  id: string
  name: string
  isDefault: boolean
}

export interface PhaseSetWithPhases extends PhaseSet {
  phases: ProgramPhase[]
}

export interface SessionExercise {
  id: string
  sessionId: string
  exerciseName: string
  styleId?: string
  muscleGroups: string[]
  position: number
  exerciseRole: ExerciseRole
}

export interface ProgramSession {
  id: string
  programId: string
  name: string
  position: number
  icon?: string
  exercises: SessionExercise[]
}

export interface ScheduleDay {
  dayOfWeek: number
  sessionId?: string
}

export interface Schedule {
  id: string
  programId: string
  type: 'rotation' | 'weekly'
  restAfterN?: number
  days?: ScheduleDay[]
}

export interface NextSessionRecommendation {
  isRestDay: boolean
  session?: ProgramSession
  reason: string
}

export interface Program {
  id: string
  userId: string
  name: string
  isActive: boolean
  sessions: ProgramSession[]
  schedule?: Schedule
  createdAt: Date
  updatedAt: Date
  phaseMode: 'manual' | 'automatic'
  phaseSetId?: string
  startedAt?: string
  sessionsPerCycle?: number
  earlyDeloadWeekStart?: string
}
```

- [ ] **Step 2: Update `lib/data/postgres/schema.ts`**

Add the `phaseSets` table definition and add the new columns to `programPhases` and `programs`. Find the existing `programPhases` and `programs` table definitions and add the indicated lines.

Add this block **before** the `programPhases` table definition:

```typescript
export const phaseSets = pgTable('phase_sets', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.name)])
```

Update the `programPhases` table — add `phaseSetId` column after `id`:

```typescript
export const programPhases = pgTable('program_phases', {
  id:               uuid('id').primaryKey().defaultRandom(),
  programId:        uuid('program_id').references(() => programs.id, { onDelete: 'cascade' }),
  phaseSetId:       uuid('phase_set_id').references(() => phaseSets.id, { onDelete: 'cascade' }),
  position:         integer('position').notNull(),
  name:             text('name').notNull(),
  durationCycles:   integer('duration_cycles').notNull(),
  phaseType:        text('phase_type').notNull().default('normal'),
  primaryStyleId:   uuid('primary_style_id').references(() => progressionStyles.id, { onDelete: 'set null' }),
  secondaryStyleId: uuid('secondary_style_id').references(() => progressionStyles.id, { onDelete: 'set null' }),
}, t => [unique().on(t.programId, t.position)])
```

Update the `programs` table — add `phaseSetId` after `earlyDeloadWeekStart`:

```typescript
export const programs = pgTable('programs', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  userId:               uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:                 text('name').notNull(),
  isActive:             boolean('is_active').notNull().default(false),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  phaseMode:            text('phase_mode').notNull().default('manual'),
  startedAt:            date('started_at', { mode: 'string' }),
  sessionsPerCycle:     integer('sessions_per_cycle'),
  earlyDeloadWeekStart: date('early_deload_week_start', { mode: 'string' }),
  phaseSetId:           uuid('phase_set_id').references(() => phaseSets.id, { onDelete: 'set null' }),
}, t => [unique().on(t.userId, t.name)])
```

- [ ] **Step 3: Verify build**

```bash
pnpm run build 2>&1 | tail -5
```
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add lib/types/program.ts lib/data/postgres/schema.ts
git commit -m "Add PhaseSet types, testing phaseType, phaseSets Drizzle schema"
```

---

## Task 3: Repository Interface

**Files:**
- Modify: `lib/data/repository.ts`

- [ ] **Step 1: Add new method signatures**

Find the block of Block Periodization methods in `lib/data/repository.ts` (around the `listProgramPhases` signature) and replace it with:

```typescript
// ── Block Periodization ────────────────────────────────────────────────────
listProgramPhases(programId: string): Promise<ProgramPhase[]>
listPhaseSets(userId: string): Promise<PhaseSetWithPhases[]>
createPhaseSet(userId: string, name: string, phases: Omit<ProgramPhase, 'id' | 'phaseSetId'>[]): Promise<PhaseSetWithPhases>
updatePhaseSet(phaseSetId: string, userId: string, name: string, phases: Omit<ProgramPhase, 'id' | 'phaseSetId'>[]): Promise<PhaseSetWithPhases>
deletePhaseSet(phaseSetId: string, userId: string): Promise<void>
updateProgramPhaseSettings(programId: string, userId: string, settings: {
  phaseMode?: 'manual' | 'automatic'
  startedAt?: string | null
  sessionsPerCycle?: number | null
  phaseSetId?: string | null
}): Promise<void>
countSessionsSinceStart(userId: string, programId: string, startedAt: string): Promise<number>
confirmEarlyDeload(userId: string, programId: string, today: string): Promise<void>
```

Also add `PhaseSetWithPhases` to the imports at the top of `repository.ts`. Find the line importing from `@/lib/types/program` and add `PhaseSetWithPhases` to it.

- [ ] **Step 2: Verify build**

```bash
pnpm run build 2>&1 | grep -E "error|Error" | head -10
```
Expected: TypeScript errors saying the adapter doesn't implement the new methods yet — that's correct, we'll fix in Task 4.

- [ ] **Step 3: Commit**

```bash
git add lib/data/repository.ts
git commit -m "Add PhaseSet repository interface methods"
```

---

## Task 4: Adapter Implementation

**Files:**
- Modify: `lib/data/postgres/adapter.ts`

- [ ] **Step 1: Add `PhaseSetWithPhases` to imports at the top of the file**

Find the line that imports from `@/lib/types/program` and add `PhaseSetWithPhases` and `ProgramPhaseType`:

```typescript
import type { ..., PhaseSetWithPhases, ProgramPhaseType } from '@/lib/types/program'
```

Also add `s.phaseSets` will be used — make sure `import * as s from './schema'` is present (it already should be).

- [ ] **Step 2: Update `upsertUser` — seed Testing style and Default phase set**

In `upsertUser`, after the loop that seeds 5 default styles, add:

```typescript
  // Seed Testing progression style (3 sets: ramp + AMRAP)
  const testingExists = await this.db
    .select()
    .from(s.progressionStyles)
    .where(and(eq(s.progressionStyles.userId, returnedUser.id), eq(s.progressionStyles.name, 'Testing')))
    .limit(1)

  if (testingExists.length === 0) {
    const testingStyleId = randomUUID()
    await this.db.insert(s.progressionStyles).values({
      id: testingStyleId,
      userId: returnedUser.id,
      name: 'Testing',
    })
    const testingSets = [
      { setNumber: 1, pct: 55, reps: 5,  restSec: 90,  useFor1rm: false },
      { setNumber: 2, pct: 70, reps: 3,  restSec: 120, useFor1rm: false },
      { setNumber: 3, pct: 87, reps: 5,  restSec: 180, useFor1rm: true  },
    ]
    for (const set of testingSets) {
      await this.db.insert(s.styleSets).values({
        id: randomUUID(),
        styleId: testingStyleId,
        ...set,
      })
    }
  }

  // Seed Default phase set if none exists
  const existingDefaultSet = await this.db
    .select()
    .from(s.phaseSets)
    .where(and(eq(s.phaseSets.userId, returnedUser.id), eq(s.phaseSets.isDefault, true)))
    .limit(1)

  if (existingDefaultSet.length === 0) {
    const userStyles = await this.db
      .select()
      .from(s.progressionStyles)
      .where(eq(s.progressionStyles.userId, returnedUser.id))
    const find = (name: string) => userStyles.find(st => st.name === name)?.id ?? null

    const phaseSetId = randomUUID()
    await this.db.insert(s.phaseSets).values({
      id: phaseSetId,
      userId: returnedUser.id,
      name: 'Default',
      isDefault: true,
    })

    const defaultPhases = [
      { position: 0, name: 'Accumulation',    durationCycles: 4, phaseType: 'normal',    primaryStyleId: find('Hypertrophy'), secondaryStyleId: find('Hypertrophy') },
      { position: 1, name: 'Intensification', durationCycles: 3, phaseType: 'normal',    primaryStyleId: find('Strength'),    secondaryStyleId: find('Strength') },
      { position: 2, name: 'Peak',            durationCycles: 2, phaseType: 'peak',      primaryStyleId: find('Peak'),        secondaryStyleId: null },
      { position: 3, name: 'Testing',         durationCycles: 1, phaseType: 'testing',   primaryStyleId: find('Testing'),     secondaryStyleId: find('Testing') },
      { position: 4, name: 'Deload',          durationCycles: 1, phaseType: 'deload',    primaryStyleId: find('Deload'),      secondaryStyleId: null },
      { position: 5, name: 'Accessory',       durationCycles: 0, phaseType: 'accessory', primaryStyleId: find('General'),     secondaryStyleId: null },
    ]

    for (const phase of defaultPhases) {
      await this.db.insert(s.programPhases).values({
        phaseSetId: phaseSetId,
        position: phase.position,
        name: phase.name,
        durationCycles: phase.durationCycles,
        phaseType: phase.phaseType,
        primaryStyleId: phase.primaryStyleId,
        secondaryStyleId: phase.secondaryStyleId,
      })
    }
  }
```

- [ ] **Step 3: Update `listProgramPhases` — read via phase_set_id**

Replace the existing `listProgramPhases` implementation:

```typescript
async listProgramPhases(programId: string): Promise<ProgramPhase[]> {
  const [prog] = await this.db
    .select({ phaseSetId: s.programs.phaseSetId })
    .from(s.programs)
    .where(eq(s.programs.id, programId))
    .limit(1)
  if (!prog?.phaseSetId) return []

  const rows = await this.db
    .select()
    .from(s.programPhases)
    .where(eq(s.programPhases.phaseSetId, prog.phaseSetId))
    .orderBy(asc(s.programPhases.position))

  return rows.map(r => ({
    id: r.id,
    phaseSetId: r.phaseSetId!,
    position: r.position,
    name: r.name,
    durationCycles: r.durationCycles,
    phaseType: r.phaseType as ProgramPhaseType,
    primaryStyleId: r.primaryStyleId ?? undefined,
    secondaryStyleId: r.secondaryStyleId ?? undefined,
  }))
}
```

- [ ] **Step 4: Update `updateProgramPhaseSettings` — add phaseSetId support**

Find `updateProgramPhaseSettings` and add `phaseSetId` handling:

```typescript
async updateProgramPhaseSettings(
  programId: string,
  userId: string,
  settings: {
    phaseMode?: 'manual' | 'automatic'
    startedAt?: string | null
    sessionsPerCycle?: number | null
    phaseSetId?: string | null
  },
): Promise<void> {
  const set: Record<string, unknown> = {}
  if (settings.phaseMode !== undefined) set.phaseMode = settings.phaseMode
  if (settings.startedAt !== undefined) set.startedAt = settings.startedAt
  if (settings.sessionsPerCycle !== undefined) set.sessionsPerCycle = settings.sessionsPerCycle
  if (settings.phaseSetId !== undefined) set.phaseSetId = settings.phaseSetId
  if (!Object.keys(set).length) return
  await this.db.update(s.programs)
    .set(set)
    .where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))
}
```

- [ ] **Step 5: Add `listPhaseSets`**

Add after `listProgramPhases`:

```typescript
async listPhaseSets(userId: string): Promise<PhaseSetWithPhases[]> {
  const sets = await this.db
    .select()
    .from(s.phaseSets)
    .where(eq(s.phaseSets.userId, userId))
    .orderBy(asc(s.phaseSets.createdAt))

  const result: PhaseSetWithPhases[] = []
  for (const set of sets) {
    const phases = await this.db
      .select()
      .from(s.programPhases)
      .where(eq(s.programPhases.phaseSetId, set.id))
      .orderBy(asc(s.programPhases.position))
    result.push({
      id: set.id,
      name: set.name,
      isDefault: set.isDefault,
      phases: phases.map(r => ({
        id: r.id,
        phaseSetId: set.id,
        position: r.position,
        name: r.name,
        durationCycles: r.durationCycles,
        phaseType: r.phaseType as ProgramPhaseType,
        primaryStyleId: r.primaryStyleId ?? undefined,
        secondaryStyleId: r.secondaryStyleId ?? undefined,
      })),
    })
  }
  return result
}
```

- [ ] **Step 6: Add `createPhaseSet`**

```typescript
async createPhaseSet(
  userId: string,
  name: string,
  phases: Omit<ProgramPhase, 'id' | 'phaseSetId'>[],
): Promise<PhaseSetWithPhases> {
  return this.db.transaction(async tx => {
    const setId = randomUUID()
    await tx.insert(s.phaseSets).values({ id: setId, userId, name, isDefault: false })

    const saved: ProgramPhase[] = []
    for (const phase of phases) {
      const [r] = await tx.insert(s.programPhases).values({
        phaseSetId: setId,
        position: phase.position,
        name: phase.name,
        durationCycles: phase.durationCycles,
        phaseType: phase.phaseType,
        primaryStyleId: phase.primaryStyleId ?? null,
        secondaryStyleId: phase.secondaryStyleId ?? null,
      }).returning()
      saved.push({
        id: r.id,
        phaseSetId: setId,
        position: r.position,
        name: r.name,
        durationCycles: r.durationCycles,
        phaseType: r.phaseType as ProgramPhaseType,
        primaryStyleId: r.primaryStyleId ?? undefined,
        secondaryStyleId: r.secondaryStyleId ?? undefined,
      })
    }
    return { id: setId, name, isDefault: false, phases: saved }
  })
}
```

- [ ] **Step 7: Add `updatePhaseSet`**

```typescript
async updatePhaseSet(
  phaseSetId: string,
  userId: string,
  name: string,
  phases: Omit<ProgramPhase, 'id' | 'phaseSetId'>[],
): Promise<PhaseSetWithPhases> {
  const [existing] = await this.db
    .select()
    .from(s.phaseSets)
    .where(and(eq(s.phaseSets.id, phaseSetId), eq(s.phaseSets.userId, userId)))
    .limit(1)
  if (!existing) throw new Error('Phase set not found')

  return this.db.transaction(async tx => {
    if (!existing.isDefault) {
      await tx.update(s.phaseSets).set({ name }).where(eq(s.phaseSets.id, phaseSetId))
    }
    await tx.delete(s.programPhases).where(eq(s.programPhases.phaseSetId, phaseSetId))

    const saved: ProgramPhase[] = []
    for (const phase of phases) {
      const [r] = await tx.insert(s.programPhases).values({
        phaseSetId,
        position: phase.position,
        name: phase.name,
        durationCycles: phase.durationCycles,
        phaseType: phase.phaseType,
        primaryStyleId: phase.primaryStyleId ?? null,
        secondaryStyleId: phase.secondaryStyleId ?? null,
      }).returning()
      saved.push({
        id: r.id,
        phaseSetId,
        position: r.position,
        name: r.name,
        durationCycles: r.durationCycles,
        phaseType: r.phaseType as ProgramPhaseType,
        primaryStyleId: r.primaryStyleId ?? undefined,
        secondaryStyleId: r.secondaryStyleId ?? undefined,
      })
    }
    return { id: phaseSetId, name: existing.isDefault ? existing.name : name, isDefault: existing.isDefault, phases: saved }
  })
}
```

- [ ] **Step 8: Add `deletePhaseSet`**

```typescript
async deletePhaseSet(phaseSetId: string, userId: string): Promise<void> {
  const [existing] = await this.db
    .select()
    .from(s.phaseSets)
    .where(and(eq(s.phaseSets.id, phaseSetId), eq(s.phaseSets.userId, userId)))
    .limit(1)
  if (!existing) throw new Error('Phase set not found')
  if (existing.isDefault) throw new Error('Cannot delete the default phase set')

  const using = await this.db
    .select({ name: s.programs.name })
    .from(s.programs)
    .where(eq(s.programs.phaseSetId, phaseSetId))
  if (using.length > 0) {
    throw new Error(`In use by: ${using.map(p => p.name).join(', ')}`)
  }
  await this.db.delete(s.phaseSets).where(eq(s.phaseSets.id, phaseSetId))
}
```

- [ ] **Step 9: Update `rowToProgram` / program SELECT to include phaseSetId**

Find where programs are read from the DB (the `listPrograms` and `saveProgram` methods). Ensure `phaseSetId` is included in the returned `Program`. In the `listPrograms` select and mapping, add:

```typescript
phaseSetId: p.phaseSetId ?? undefined,
```

And in `saveProgram`'s returned object and the INSERT/UPDATE `.set({...})` calls, add `phaseSetId` where `phaseMode` is set. Specifically, in `saveProgram`, add `phaseSetId: program.phaseSetId ?? null` to the `.values(...)` and `.set({...})` objects for both INSERT and UPDATE branches.

- [ ] **Step 10: Verify build**

```bash
pnpm run build 2>&1 | tail -10
```
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 11: Commit**

```bash
git add lib/data/postgres/adapter.ts
git commit -m "Implement phase set CRUD in adapter; seed Testing style and Default phase set"
```

---

## Task 5: API Routes for Phase Sets

**Files:**
- Create: `app/api/phase-sets/route.ts`
- Create: `app/api/phase-sets/[id]/route.ts`
- Modify: `app/api/workout-templates/route.ts`
- Modify: `app/api/program-phases/route.ts`

- [ ] **Step 1: Create `app/api/phase-sets/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import type { EditablePhase } from '@/components/config/phase-editor'

async function getUserId() {
  const session = await auth()
  return session?.user?.id
}

export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const phaseSets = await repo.listPhaseSets(userId)
  return NextResponse.json({ phaseSets })
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { name: string; phases: EditablePhase[] }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const repo = await getRepository()
  const phaseSet = await repo.createPhaseSet(
    userId,
    body.name.trim(),
    (body.phases ?? []).map((p, i) => ({
      position: i,
      name: p.name,
      durationCycles: p.durationCycles,
      phaseType: p.phaseType,
      primaryStyleId: p.primaryStyleId,
      secondaryStyleId: p.secondaryStyleId,
    })),
  )
  return NextResponse.json({ phaseSet })
}
```

- [ ] **Step 2: Create `app/api/phase-sets/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import type { EditablePhase } from '@/components/config/phase-editor'

async function getUserId() {
  const session = await auth()
  return session?.user?.id
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json() as { name: string; phases: EditablePhase[] }

  const repo = await getRepository()
  try {
    const phaseSet = await repo.updatePhaseSet(
      id,
      userId,
      body.name?.trim() ?? '',
      (body.phases ?? []).map((p, i) => ({
        position: i,
        name: p.name,
        durationCycles: p.durationCycles,
        phaseType: p.phaseType,
        primaryStyleId: p.primaryStyleId,
        secondaryStyleId: p.secondaryStyleId,
      })),
    )
    return NextResponse.json({ phaseSet })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const repo = await getRepository()
  try {
    await repo.deletePhaseSet(id, userId)
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    const status = msg.includes('default') ? 403 : msg.includes('In use') ? 400 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
```

- [ ] **Step 3: Update `app/api/workout-templates/route.ts` — pass phaseSetId through**

The POST handler spreads `body.program` into `saveProgram`. Because `Program` now includes `phaseSetId`, no change is needed to the route itself — the spread already picks it up. However, add explicit phaseMode and phase settings handling after saving:

Replace the POST handler body:

```typescript
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { program: Program }
  if (!body.program?.name) {
    return NextResponse.json({ error: 'Invalid program' }, { status: 400 })
  }

  const repo = await getRepository()
  const saved = await repo.saveProgram(userId, {
    ...body.program,
    userId,
    id: body.program.id ?? '',
    createdAt: body.program.createdAt ?? new Date(),
    updatedAt: new Date(),
  })

  // Persist phaseMode, sessionsPerCycle, and phaseSetId if provided
  if (body.program.phaseMode) {
    await repo.updateProgramPhaseSettings(saved.id, userId, {
      phaseMode: body.program.phaseMode,
      sessionsPerCycle: body.program.sessionsPerCycle ?? null,
      phaseSetId: body.program.phaseSetId ?? null,
    })
  }

  return NextResponse.json({ ok: true, program: saved })
}
```

- [ ] **Step 4: Update `app/api/program-phases/route.ts` — keep GET, retire PUT**

Replace the entire file:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

async function getUserId() {
  const session = await auth()
  return session?.user?.id
}

// GET still used by workout-data flow to fetch phases for active program
export async function GET(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const programId = new URL(req.url).searchParams.get('programId')
  if (!programId) return NextResponse.json({ error: 'Missing programId' }, { status: 400 })

  const repo = await getRepository()
  const programs = await repo.listPrograms(userId)
  if (!programs.some(p => p.id === programId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const phases = await repo.listProgramPhases(programId)
  return NextResponse.json({ phases })
}
```

- [ ] **Step 5: Verify build**

```bash
pnpm run build 2>&1 | tail -10
```
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add app/api/phase-sets/route.ts app/api/phase-sets/[id]/route.ts \
        app/api/workout-templates/route.ts app/api/program-phases/route.ts
git commit -m "Add phase-sets API routes; retire program-phases PUT"
```

---

## Task 6: PhaseEditor — Add Testing Type

**Files:**
- Modify: `components/config/phase-editor.tsx`

The PhaseEditor currently renders three type buttons: `normal | peak | deload`. We need to add `testing` alongside them. Also update the local `PhaseType` type definition.

- [ ] **Step 1: Update `PhaseType` and `EditablePhase` in the file**

At the top of `components/config/phase-editor.tsx`, change:

```typescript
type PhaseType = 'normal' | 'peak' | 'deload' | 'accessory'
```

to:

```typescript
type PhaseType = 'normal' | 'peak' | 'deload' | 'accessory' | 'testing'
```

Also update the `EditablePhase` type to use `ProgramPhaseType` and `phaseSetId` instead of `programId`. Change:

```typescript
export type EditablePhase = Omit<ProgramPhase, 'id' | 'programId'> & { localId: string }
```

to:

```typescript
export type EditablePhase = Omit<ProgramPhase, 'id' | 'phaseSetId'> & { localId: string }
```

- [ ] **Step 2: Add 'testing' button to the type selector row**

Find the type buttons array:

```typescript
{(['normal', 'peak', 'deload'] as PhaseType[]).map(t => (
```

Change it to:

```typescript
{(['normal', 'peak', 'deload', 'testing'] as PhaseType[]).map(t => (
```

- [ ] **Step 3: Update the deload style-hiding logic to also hide styles for testing is NOT needed**

Testing phases DO show style selectors (unlike deload). No change needed to the `{phase.phaseType !== 'deload' && ...}` block — testing phases will show the style selectors correctly.

- [ ] **Step 4: Verify build**

```bash
pnpm run build 2>&1 | tail -10
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/config/phase-editor.tsx
git commit -m "Add testing phase type to PhaseEditor"
```

---

## Task 7: Config Screen — Advanced Settings UI

**Files:**
- Modify: `components/config-screen.tsx`

This is the largest UI change. The goal is:
1. Add `advancedOpen` collapsible state
2. Load `phaseSets` alongside `styles` on mount
3. Add phase set editor sheet state
4. Add `selectedPhaseSetId` to program form state
5. Replace the top-level "Progression Styles" section + "Block Periodization Phases" section with a single "Advanced Settings" collapsible containing both
6. Replace the inline PhaseEditor in the program creation form with a Phase Set selector

- [ ] **Step 1: Add new state variables**

After the existing state declarations (around line 86–92 in the current file), add:

```typescript
const [advancedOpen, setAdvancedOpen] = useState(false)
const [phaseSets, setPhaseSets] = useState<PhaseSetWithPhases[]>([])
const [phaseSetSheetOpen, setPhaseSetSheetOpen] = useState(false)
const [editingPhaseSet, setEditingPhaseSet] = useState<PhaseSetWithPhases | null>(null)
const [phaseSetEditPhases, setPhaseSetEditPhases] = useState<EditablePhase[]>([])
const [phaseSetEditName, setPhaseSetEditName] = useState('')
const [phaseSetSaving, setPhaseSetSaving] = useState(false)
const [selectedPhaseSetId, setSelectedPhaseSetId] = useState('')
```

- [ ] **Step 2: Add `PhaseSetWithPhases` to imports**

At the top of the file, find the import from `@/lib/types` and add `PhaseSetWithPhases`:

```typescript
import type { ProgressionStyle, Program, PhaseSetWithPhases } from "@/lib/types";
```

(If `@/lib/types` re-exports it, this works; if not, import from `@/lib/types/program` directly.)

- [ ] **Step 3: Load phase sets on mount alongside styles**

In the `useEffect` / `useLayoutEffect` that loads styles (around line 116–130), add phase sets loading:

```typescript
// After the styles cachedFetch, add:
cachedFetch<{ phaseSets: PhaseSetWithPhases[] }>(
  'phase-sets', '/api/phase-sets', TTL_LONG,
  (data) => setPhaseSets(data.phaseSets ?? []),
)
```

Also set default `selectedPhaseSetId` when phase sets load:
```typescript
(data) => {
  setPhaseSets(data.phaseSets ?? [])
  if (!selectedPhaseSetId && data.phaseSets?.length) {
    setSelectedPhaseSetId(data.phaseSets.find(ps => ps.isDefault)?.id ?? data.phaseSets[0].id)
  }
}
```

- [ ] **Step 4: Add `openPhaseSetEditor` and `savePhaseSet` handlers**

After the style CRUD handlers, add:

```typescript
function openPhaseSetEditor(ps: PhaseSetWithPhases | null) {
  if (ps) {
    setEditingPhaseSet(ps)
    setPhaseSetEditName(ps.name)
    setPhaseSetEditPhases(ps.phases.map(p => ({ ...p, localId: `local-${p.id}` })))
  } else {
    setEditingPhaseSet(null)
    setPhaseSetEditName('')
    // Default new set to the Default set's phases as a starting point
    const defaultSet = phaseSets.find(ps => ps.isDefault)
    setPhaseSetEditPhases(
      (defaultSet?.phases ?? []).map((p, i) => ({ ...p, localId: `new-${i}` }))
    )
  }
  setPhaseSetSheetOpen(true)
}

async function savePhaseSet() {
  if (!phaseSetEditName.trim() && !editingPhaseSet?.isDefault) return
  setPhaseSetSaving(true)
  try {
    const url = editingPhaseSet ? `/api/phase-sets/${editingPhaseSet.id}` : '/api/phase-sets'
    const method = editingPhaseSet ? 'PUT' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: phaseSetEditName, phases: phaseSetEditPhases }),
    })
    if (!res.ok) { toast.error('Failed to save phase set'); return }
    const data = await res.json()
    setPhaseSets(prev =>
      editingPhaseSet
        ? prev.map(ps => ps.id === editingPhaseSet.id ? data.phaseSet : ps)
        : [...prev, data.phaseSet]
    )
    await invalidateCache('phase-sets')
    toast.success('Phase set saved')
    setPhaseSetSheetOpen(false)
  } finally {
    setPhaseSetSaving(false)
  }
}

async function deletePhaseSet(ps: PhaseSetWithPhases) {
  const res = await fetch(`/api/phase-sets/${ps.id}`, { method: 'DELETE' })
  if (!res.ok) {
    const data = await res.json()
    toast.error(data.error ?? 'Failed to delete')
    return
  }
  setPhaseSets(prev => prev.filter(p => p.id !== ps.id))
  await invalidateCache('phase-sets')
  toast.success('Phase set deleted')
}
```

- [ ] **Step 5: Replace top-level sections with Advanced Settings collapsible**

In the render section, find:

```tsx
{/* ── Progression Styles ── */}
<section>
  ...
</section>

{/* ── Phase Setup (Block Periodization) ── */}
{programEditId && phaseMode === 'automatic' && (
  <section>
    ...
  </section>
)}
```

Replace both sections with:

```tsx
{/* ── Advanced Settings ── */}
<section>
  <button
    type="button"
    onClick={() => setAdvancedOpen(o => !o)}
    className="flex items-center justify-between w-full mb-3"
  >
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      Advanced Settings
    </h2>
    <ChevronRight className={cn(
      "h-4 w-4 text-muted-foreground transition-transform",
      advancedOpen && "rotate-90"
    )} />
  </button>

  {advancedOpen && (
    <div className="space-y-6">
      {/* Progression Styles — moved here */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Progression Styles</h3>
          <button
            onClick={openNewStyle}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-brand text-white hover:opacity-90 transition"
          >
            <Plus className="h-3.5 w-3.5" />
            New Style
          </button>
        </div>
        {styles.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No styles yet. Create one to get started.
          </p>
        ) : (
          <div className="space-y-2">
            {styles.map(style => (
              <div
                key={style.id}
                className="flex items-center justify-between rounded-xl bg-muted px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm">{style.name}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    <span className="text-[10px] rounded-full bg-brand/15 text-brand border border-brand/20 px-2 py-0.5 font-medium">
                      {style.sets.length} set{style.sets.length !== 1 ? "s" : ""}
                    </span>
                    {(() => {
                      const reps = style.sets.map(s => s.reps);
                      const minR = Math.min(...reps); const maxR = Math.max(...reps);
                      return (
                        <span className="text-[10px] rounded-full bg-muted border border-border px-2 py-0.5 text-muted-foreground font-medium">
                          {minR === maxR ? `${minR} reps` : `${minR}–${maxR} reps`}
                        </span>
                      );
                    })()}
                    {(() => {
                      const pcts = style.sets.map(s => s.pct);
                      const minP = Math.min(...pcts); const maxP = Math.max(...pcts);
                      return (
                        <span className="text-[10px] rounded-full bg-muted border border-border px-2 py-0.5 text-muted-foreground font-medium">
                          {minP === maxP ? `${minP}%` : `${minP}–${maxP}%`}
                        </span>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex gap-1 ml-3 flex-none">
                  <button
                    onClick={() => openEditStyle(style)}
                    className="rounded-lg p-2 text-muted-foreground hover:bg-background transition"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => deleteStyle(style)}
                    disabled={deleting === `style:${style.id}`}
                    className="rounded-lg p-2 text-muted-foreground hover:text-destructive hover:bg-background transition disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Phase Sets */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Phase Sets</h3>
          <button
            onClick={() => openPhaseSetEditor(null)}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-brand text-white hover:opacity-90 transition"
          >
            <Plus className="h-3.5 w-3.5" />
            New Set
          </button>
        </div>
        {phaseSets.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No phase sets yet.
          </p>
        ) : (
          <div className="space-y-2">
            {phaseSets.map(ps => (
              <div
                key={ps.id}
                className="flex items-center justify-between rounded-xl bg-muted px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{ps.name}</p>
                    {ps.isDefault && (
                      <span className="text-[10px] rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/20 px-2 py-0.5 font-medium">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {ps.phases.length} phase{ps.phases.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex gap-1 ml-3 flex-none">
                  <button
                    onClick={() => openPhaseSetEditor(ps)}
                    className="rounded-lg p-2 text-muted-foreground hover:bg-background transition"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {!ps.isDefault && (
                    <button
                      onClick={() => deletePhaseSet(ps)}
                      disabled={deleting === `phaseset:${ps.id}`}
                      className="rounded-lg p-2 text-muted-foreground hover:text-destructive hover:bg-background transition disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )}
</section>
```

Add `ChevronRight` to the lucide-react import at the top of the file.

- [ ] **Step 6: Replace inline PhaseEditor in program creation with Phase Set selector**

Find the Block Periodization section in the program editor form (around line 1065):

```tsx
{phaseMode === 'automatic' && (
  <div className="space-y-2">
    <div className="flex items-center justify-end gap-2">
      <span className="text-xs text-muted-foreground">avg sessions/week</span>
      ...avgSessionsPerWeek buttons...
    </div>
    <PhaseEditor
      phases={phases}
      ...
    />
  </div>
)}
```

Replace with:

```tsx
{phaseMode === 'automatic' && (
  <div className="space-y-2">
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-20 shrink-0">Phase Set</span>
      <select
        value={selectedPhaseSetId}
        onChange={e => setSelectedPhaseSetId(e.target.value)}
        className="text-xs border rounded px-2 py-1 bg-background flex-1"
      >
        {phaseSets.map(ps => (
          <option key={ps.id} value={ps.id}>{ps.name}</option>
        ))}
      </select>
    </div>
    <p className="text-xs text-muted-foreground">
      Edit phase sets in Advanced Settings above.
    </p>
  </div>
)}
```

- [ ] **Step 7: Pass `selectedPhaseSetId` when saving a program**

In the program save handler (where the form is submitted), ensure `phaseSetId: selectedPhaseSetId` is included in the program body sent to `/api/workout-templates`:

```typescript
const programBody = {
  ...formData,
  phaseMode,
  phaseSetId: phaseMode === 'automatic' ? selectedPhaseSetId : undefined,
  sessionsPerCycle: Math.max(1, programSessions.filter(s => s.name.trim()).length),
}
```

- [ ] **Step 8: Add Phase Set editor sheet**

At the end of the JSX, after the existing style editor sheet and before the closing tag, add:

```tsx
{/* ── Phase Set editor sheet ─────────────────────────────────────────── */}
<Sheet open={phaseSetSheetOpen} onOpenChange={setPhaseSetSheetOpen}>
  <SheetContent side="bottom" className="h-[90vh] overflow-y-auto">
    <SheetHeader className="mb-4">
      <SheetTitle>{editingPhaseSet ? 'Edit Phase Set' : 'New Phase Set'}</SheetTitle>
    </SheetHeader>
    <div className="space-y-4 pb-8">
      {(!editingPhaseSet || !editingPhaseSet.isDefault) && (
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">
            Name
          </label>
          <Input
            value={phaseSetEditName}
            onChange={e => setPhaseSetEditName(e.target.value)}
            placeholder="e.g. Strength Focus"
          />
        </div>
      )}
      {editingPhaseSet?.isDefault && (
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold">Default</span> — name cannot be changed.
        </p>
      )}
      <PhaseEditor
        phases={phaseSetEditPhases}
        styleOptions={styles.map(s => ({ id: s.id, name: s.name }))}
        sessionsPerCycle={3}
        sessionNames={[]}
        avgSessionsPerWeek={3}
        onChange={setPhaseSetEditPhases}
      />
      <button
        onClick={savePhaseSet}
        disabled={phaseSetSaving}
        className="w-full rounded-xl bg-brand text-white py-3 font-semibold text-sm disabled:opacity-50"
      >
        {phaseSetSaving ? 'Saving…' : 'Save Phase Set'}
      </button>
    </div>
  </SheetContent>
</Sheet>
```

- [ ] **Step 9: Verify build**

```bash
pnpm run build 2>&1 | tail -10
```
Expected: build succeeds.

- [ ] **Step 10: Commit**

```bash
git add components/config-screen.tsx components/config/phase-editor.tsx
git commit -m "Add Advanced Settings collapsible with Phase Sets UI; replace inline PhaseEditor with selector"
```

---

## Task 8: Stats Routes — Testing Phase Exclusion and Badge

**Files:**
- Modify: `app/api/weekly-stats/route.ts`
- Modify: `app/api/training-load/route.ts`
- Modify: `components/stats/weekly-stats-hub.tsx`

- [ ] **Step 1: Update `isDeloadSession` in `app/api/weekly-stats/route.ts`**

Find:
```typescript
function isDeloadSession(ws: WorkoutSession): boolean {
  return ws.isEarlyDeload || ws.phaseType === 'deload';
}
```

Replace with:
```typescript
function isDeloadSession(ws: WorkoutSession): boolean {
  return ws.isEarlyDeload || ws.phaseType === 'deload' || ws.phaseType === 'testing';
}

function isTestingSession(ws: WorkoutSession): boolean {
  return ws.phaseType === 'testing';
}
```

Find the `days.push(...)` call and add `isTesting` to the day object:

```typescript
const isDeload = daySessions.length > 0 && daySessions.every(ws => isDeloadSession(ws));
const isTesting = !isDeload && daySessions.length > 0 && daySessions.some(ws => isTestingSession(ws));
days.push({ dateKey, label: DAY_LABELS[d], sessions: [...new Set(sessionNames)], volume, isDeload, isTesting });
```

Also update the `WeeklyStatsResponse` type definition in the same file to include `isTesting: boolean` on each day.

- [ ] **Step 2: Update `isDeloadSession` in `app/api/training-load/route.ts`**

Find:
```typescript
function isDeloadSession(ws: WorkoutSession): boolean {
  return ws.isEarlyDeload || ws.phaseType === 'deload'
}
```

Replace with:
```typescript
function isDeloadSession(ws: WorkoutSession): boolean {
  return ws.isEarlyDeload || ws.phaseType === 'deload' || ws.phaseType === 'testing'
}
```

- [ ] **Step 3: Add `isTesting` badge in `components/stats/weekly-stats-hub.tsx`**

Find the deload badge:
```tsx
{day.isDeload && (
  <span className="text-[8px] font-bold text-amber-500 leading-none">D</span>
)}
```

Add the testing badge immediately after:
```tsx
{day.isDeload && (
  <span className="text-[8px] font-bold text-amber-500 leading-none">D</span>
)}
{day.isTesting && (
  <span className="text-[8px] font-bold text-purple-500 leading-none">T</span>
)}
```

Also update the TypeScript type for the day object in the component props to include `isTesting?: boolean`.

- [ ] **Step 4: Verify build**

```bash
pnpm run build 2>&1 | tail -10
```
Expected: build succeeds with zero errors.

- [ ] **Step 5: Run tests**

```bash
pnpm test 2>&1 | tail -20
```
Expected: all existing tests pass (no tests cover these routes directly; this confirms no regressions).

- [ ] **Step 6: Commit**

```bash
git add app/api/weekly-stats/route.ts app/api/training-load/route.ts \
        components/stats/weekly-stats-hub.tsx
git commit -m "Exclude testing phases from stats aggregates; add purple T badge on chart"
```

- [ ] **Step 7: Push to main**

```bash
git push -u origin main
```

---

## Self-Review

**Spec coverage check:**
- ✅ `phase_sets` table created
- ✅ `program_phases` gains `phase_set_id` FK
- ✅ `programs` gains `phase_set_id` FK
- ✅ Migration data-migrates existing block-periodization programs
- ✅ `'testing'` added to phaseType union
- ✅ Testing progression style seeded (55%×5 / 70%×3 / 87%×AMRAP)
- ✅ Default phase set seeded with 6 phases including Testing
- ✅ `GET/POST /api/phase-sets` implemented
- ✅ `GET/PUT/DELETE /api/phase-sets/[id]` implemented
- ✅ Default set: name locked, cannot be deleted
- ✅ Delete blocked if any program references the set
- ✅ Advanced Settings collapsible in config screen
- ✅ Progression Styles moved inside collapsible
- ✅ Phase Sets list with edit/delete/new
- ✅ Phase Set editor sheet reuses PhaseEditor
- ✅ Program editor: inline PhaseEditor replaced by Phase Set selector
- ✅ `phaseSetId` passed through workout-templates route → saveProgram → DB
- ✅ `/api/program-phases` GET updated (reads via phase_set_id JOIN), PUT retired
- ✅ Testing phases excluded from weekly-stats volume/sets/duration aggregates
- ✅ Testing phases excluded from training-load chronic window
- ✅ Purple "T" badge on weekly stats chart
- ✅ `resolveStyleForExercise` requires no changes (testing falls through to standard primary/secondary handling)
