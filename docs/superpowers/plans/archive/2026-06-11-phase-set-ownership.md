> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Phase Set Ownership & Auto-Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the AI workout builder creates a program with custom phase-cycle overrides, auto-generate a private "owned" phase set clone named `<template> (<program name>)`, linked to the program via a new `owner_program_id` column. Renaming the program cascades to rename its owned clone. Deleting the program always deletes its owned clone (no orphan-cleanup heuristics needed).

**Architecture:** Add `owner_program_id` (FK → `programs.id`, `ON DELETE SET NULL`) and `template_base_name` columns to `phase_sets`. A new adapter method `createOwnedPhaseSetClone` creates the clone named via a shared `buildOwnedPhaseSetName(templateBaseName, programName)` helper at clone time (before the program has an id); a follow-up `linkPhaseSetOwnership(phaseSetId, programId, userId)` sets `owner_program_id` once `saveProgram` returns the new program's id. `saveProgram` cascades the rename on every save (no-op unless the program's name actually changed); `deleteProgram` deletes the program's owned phase set (if any) before deleting the program. The old `(custom-xxxxxxxx)` clone-name + orphan-cleanup heuristic (`deletePhaseSetIfOrphaned`) is removed entirely and superseded by a one-time backfill in the migration.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM, PostgreSQL (local dev on port 5433), TypeScript, vitest.

**Run order:** This plan must land **after** both:
- `2026-06-11-phase-type-snapshot.md` (Plan A) — `deleteProgram`'s "always delete the owned phase set" is only safe for historical analytics because `workout_sessions.phase_type` is a write-time snapshot (Plan A), not derived via a join through `program_phases` that would break once those rows cascade-delete.
- `2026-06-11-program-name-uniqueness.md` (Plan B) — Task 7 below edits `saveProgram` immediately after the `programId = pRow.id` line that Plan B's rewrite introduces. Implement Plan B first.

---

### Task 1: Migration — add phase set ownership columns and backfill existing clones

**Files:**
- Create: `lib/data/postgres/migrations/062_phase_set_ownership.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase sets can be "owned" by the program that auto-generated them (the AI
-- workout builder's per-program phase-cycle clone, named "<template> (<program
-- name>)"). Owned clones are renamed when their program is renamed and deleted
-- when their program is deleted.
ALTER TABLE phase_sets ADD COLUMN IF NOT EXISTS owner_program_id uuid REFERENCES programs(id) ON DELETE SET NULL;
ALTER TABLE phase_sets ADD COLUMN IF NOT EXISTS template_base_name text;

CREATE INDEX IF NOT EXISTS phase_sets_owner_program_id_idx ON phase_sets(owner_program_id);

-- Backfill: link existing customised clones (created by the old "clone on save"
-- flow, named "<template> (custom-xxxxxxxx)") to the single program that
-- references them, and rename to the new "<template> (<program name>)"
-- convention. Supersedes the orphan-cleanup logic from migration 060, which
-- the application no longer runs.
UPDATE phase_sets ps
SET owner_program_id = p.id,
    template_base_name = trim(regexp_replace(ps.name, '\s*\(custom(-[0-9a-f]+)?\)$', '')),
    name = trim(regexp_replace(ps.name, '\s*\(custom(-[0-9a-f]+)?\)$', '')) || ' (' || p.name || ')'
FROM programs p
WHERE p.phase_set_id = ps.id
  AND ps.is_default = false
  AND ps.owner_program_id IS NULL
  AND ps.name ~ '\(custom(-[0-9a-f]+)?\)$'
  AND (SELECT count(*) FROM programs p2 WHERE p2.phase_set_id = ps.id) = 1
  AND NOT EXISTS (
    SELECT 1 FROM phase_sets ps2
    WHERE ps2.user_id = ps.user_id
      AND ps2.id != ps.id
      AND ps2.name = trim(regexp_replace(ps.name, '\s*\(custom(-[0-9a-f]+)?\)$', '')) || ' (' || p.name || ')'
  );
```

- [ ] **Step 2: Apply the migration to the local dev database**

```bash
export DATABASE_URL="postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433"
node scripts/local-db/migrate.js
```

Expected: log line showing `062_phase_set_ownership.sql` applied with no errors.

- [ ] **Step 3: Verify the new columns exist**

```bash
psql "$DATABASE_URL" -c "\d phase_sets"
```

Expected: `owner_program_id` (uuid, FK to `programs.id`) and `template_base_name` (text) columns present.

- [ ] **Step 4: Verify the migration is idempotent**

```bash
node scripts/local-db/migrate.js
```

Expected: re-running succeeds with no errors (the migration runner skips already-applied migrations, and every statement in 062 uses `IF NOT EXISTS` or has a `WHERE owner_program_id IS NULL` guard).

---

### Task 2: Add the new columns to the Drizzle schema

**Files:**
- Modify: `lib/data/postgres/schema.ts:72-78`

- [ ] **Step 1: Update the `phaseSets` table definition**

Replace:

```ts
export const phaseSets = pgTable('phase_sets', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.userId, t.name)])
```

with:

```ts
export const phaseSets = pgTable('phase_sets', {
  id:               uuid('id').primaryKey().defaultRandom(),
  userId:           uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:             text('name').notNull(),
  isDefault:        boolean('is_default').notNull().default(false),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  ownerProgramId:   uuid('owner_program_id').references(() => programs.id, { onDelete: 'set null' }),
  templateBaseName: text('template_base_name'),
}, t => [unique().on(t.userId, t.name)])
```

`programs` is defined earlier in this file (line 57), so the forward reference works the same way `programPhases.programId` already references it.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

---

### Task 3: Extend the `PhaseSet` type

**Files:**
- Modify: `lib/types/program.ts:34-38`

- [ ] **Step 1: Add the new optional fields**

Replace:

```ts
export interface PhaseSet {
  id: string
  name: string
  isDefault: boolean
}
```

with:

```ts
export interface PhaseSet {
  id: string
  name: string
  isDefault: boolean
  ownerProgramId?: string
  templateBaseName?: string
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

---

### Task 4: Add the owned-clone naming helper (TDD)

**Files:**
- Create: `lib/phase-set-naming.ts`
- Create: `lib/__tests__/phase-set-naming.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildOwnedPhaseSetName } from '../phase-set-naming'

describe('buildOwnedPhaseSetName', () => {
  it('combines the template name and program name', () => {
    expect(buildOwnedPhaseSetName('Strength Progression', 'john')).toBe('Strength Progression (john)')
  })

  it('handles program names containing parentheses', () => {
    expect(buildOwnedPhaseSetName('Hypertrophy Progression', 'Push (A)')).toBe('Hypertrophy Progression (Push (A))')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/__tests__/phase-set-naming.test.ts`
Expected: FAIL — `Cannot find module '../phase-set-naming'`

- [ ] **Step 3: Write the implementation**

```ts
export function buildOwnedPhaseSetName(templateBaseName: string, programName: string): string {
  return `${templateBaseName} (${programName})`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/__tests__/phase-set-naming.test.ts`
Expected: PASS (2 tests)

---

### Task 5: Add new repository methods to the interface

**Files:**
- Modify: `lib/data/repository.ts:65-67`

- [ ] **Step 1: Add the two new method signatures**

After `lib/data/repository.ts:67` (`deletePhaseSet(phaseSetId: string, userId: string): Promise<void>`), add:

```ts
  createOwnedPhaseSetClone(userId: string, templateBaseName: string, programName: string, phases: Omit<ProgramPhase, 'id' | 'phaseSetId'>[]): Promise<PhaseSetWithPhases>
  linkPhaseSetOwnership(phaseSetId: string, programId: string, userId: string): Promise<void>
```

`ProgramPhase` and `PhaseSetWithPhases` are already imported at `lib/data/repository.ts:7`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors referencing `createOwnedPhaseSetClone`/`linkPhaseSetOwnership` not implemented on `PostgresAdapter` (fixed in Task 6).

---

### Task 6: Implement `createOwnedPhaseSetClone` and `linkPhaseSetOwnership`, expose ownership fields from `listPhaseSets`

**Files:**
- Modify: `lib/data/postgres/adapter.ts` (imports)
- Modify: `lib/data/postgres/adapter.ts:720-723` (`listPhaseSets` return)
- Modify: `lib/data/postgres/adapter.ts` (after `createPhaseSet`, ~line 748)

- [ ] **Step 1: Import the naming helper**

In `lib/data/postgres/adapter.ts`, after the existing `import { aestMidnight, ... } from '@/lib/date-utils'` line, add:

```ts
import { buildOwnedPhaseSetName } from '@/lib/phase-set-naming'
```

- [ ] **Step 2: Expose ownership fields from `listPhaseSets`**

Replace `lib/data/postgres/adapter.ts:720-723`:

```ts
    return sets.map(set => ({
      id: set.id, name: set.name, isDefault: set.isDefault,
      phases: phasesBySetId.get(set.id) ?? [],
    }))
```

with:

```ts
    return sets.map(set => ({
      id: set.id, name: set.name, isDefault: set.isDefault,
      ownerProgramId: set.ownerProgramId ?? undefined,
      templateBaseName: set.templateBaseName ?? undefined,
      phases: phasesBySetId.get(set.id) ?? [],
    }))
```

- [ ] **Step 3: Add `createOwnedPhaseSetClone` and `linkPhaseSetOwnership`**

Immediately after the closing brace of `createPhaseSet` (the method ending at `lib/data/postgres/adapter.ts:748`, just before `async updatePhaseSet(`), insert:

```ts
  async createOwnedPhaseSetClone(
    userId: string,
    templateBaseName: string,
    programName: string,
    phases: Omit<ProgramPhase, 'id' | 'phaseSetId'>[],
  ): Promise<PhaseSetWithPhases> {
    const name = buildOwnedPhaseSetName(templateBaseName, programName)
    return this.db.transaction(async tx => {
      const setId = randomUUID()
      await tx.insert(s.phaseSets).values({ id: setId, userId, name, isDefault: false, templateBaseName })

      const saved: ProgramPhase[] = []
      for (const phase of phases) {
        const [r] = await tx.insert(s.programPhases).values({
          phaseSetId: setId,
          position: phase.position, name: phase.name,
          durationCycles: phase.durationCycles, phaseType: phase.phaseType,
          primaryStyleId: phase.primaryStyleId ?? null,
          secondaryStyleId: phase.secondaryStyleId ?? null,
        }).returning()
        saved.push(this.rowToPhase(r))
      }
      return { id: setId, name, isDefault: false, templateBaseName, phases: saved }
    })
  }

  async linkPhaseSetOwnership(phaseSetId: string, programId: string, userId: string): Promise<void> {
    await this.db.update(s.phaseSets)
      .set({ ownerProgramId: programId })
      .where(and(eq(s.phaseSets.id, phaseSetId), eq(s.phaseSets.userId, userId)))
  }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors (the `createOwnedPhaseSetClone`/`linkPhaseSetOwnership` errors from Task 5 are now resolved).

---

### Task 7: Cascade-rename a program's owned phase set on save

**Files:**
- Modify: `lib/data/postgres/adapter.ts` (`saveProgram`, immediately after `const programId = pRow.id`)

This task assumes Plan B (`2026-06-11-program-name-uniqueness.md`) has already been implemented, so `saveProgram`'s body starts with the name-uniqueness pre-check followed by the insert/update branch and `const programId = pRow.id`.

- [ ] **Step 1: Insert the rename-cascade block**

Immediately after the line `const programId = pRow.id` (and before the `if (program.isActive) { ... }` block), insert:

```ts

      const [ownedPhaseSet] = await tx.select({
        id: s.phaseSets.id, name: s.phaseSets.name, templateBaseName: s.phaseSets.templateBaseName,
      })
        .from(s.phaseSets)
        .where(and(eq(s.phaseSets.ownerProgramId, programId), eq(s.phaseSets.userId, userId)))
      if (ownedPhaseSet?.templateBaseName) {
        const renamedTo = buildOwnedPhaseSetName(ownedPhaseSet.templateBaseName, program.name)
        if (renamedTo !== ownedPhaseSet.name) {
          await tx.update(s.phaseSets).set({ name: renamedTo }).where(eq(s.phaseSets.id, ownedPhaseSet.id))
        }
      }
```

For a brand-new program (`program.id` falsy), `programId` is freshly generated and no `phase_sets` row can yet have `owner_program_id = programId`, so this is a no-op — the owned clone (if any) is created and linked to the new program by Tasks 9 and 10 below, already named correctly at clone time.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

---

### Task 8: Always delete a program's owned phase set on delete; remove the orphan-cleanup heuristic

**Files:**
- Modify: `lib/data/postgres/adapter.ts:657-660` (`deleteProgram`)
- Modify: `lib/data/postgres/adapter.ts:802-848` (`updateProgramPhaseSettings` + `deletePhaseSetIfOrphaned`)

- [ ] **Step 1: Rewrite `deleteProgram`**

Replace `lib/data/postgres/adapter.ts:657-660`:

```ts
  async deleteProgram(userId: string, programId: string): Promise<void> {
    await this.db.delete(s.programs)
      .where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))
  }
```

with:

```ts
  async deleteProgram(userId: string, programId: string): Promise<void> {
    await this.db.transaction(async tx => {
      const [owned] = await tx.select({ id: s.phaseSets.id })
        .from(s.phaseSets)
        .where(and(eq(s.phaseSets.ownerProgramId, programId), eq(s.phaseSets.userId, userId)))
      if (owned) {
        await tx.delete(s.phaseSets).where(eq(s.phaseSets.id, owned.id))
      }
      await tx.delete(s.programs).where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))
    })
  }
```

Deleting the phase set first lets `program_phases` (FK `ON DELETE CASCADE`) and then `workout_sessions.phase_id` (FK `ON DELETE SET NULL`, with `phase_type` preserved per Plan A) clean up before the program row — and before `programs.phase_set_id`'s own `ON DELETE SET NULL` to `phase_sets.id` would otherwise need to update the very row being deleted in the same statement.

- [ ] **Step 2: Simplify `updateProgramPhaseSettings` and remove `deletePhaseSetIfOrphaned`**

Replace `lib/data/postgres/adapter.ts:802-848`:

```ts
  async updateProgramPhaseSettings(
    programId: string, userId: string,
    settings: { phaseMode?: 'manual' | 'automatic'; startedAt?: string | null; sessionsPerCycle?: number | null; phaseSetId?: string | null },
  ): Promise<void> {
    const set: Record<string, unknown> = {}
    if (settings.phaseMode !== undefined) set.phaseMode = settings.phaseMode
    if ('startedAt' in settings) set.startedAt = settings.startedAt ?? null
    if ('sessionsPerCycle' in settings) set.sessionsPerCycle = settings.sessionsPerCycle ?? null
    if ('phaseSetId' in settings) set.phaseSetId = settings.phaseSetId ?? null
    if (!Object.keys(set).length) return

    let previousPhaseSetId: string | null = null
    if ('phaseSetId' in settings) {
      const [prog] = await this.db.select({ phaseSetId: s.programs.phaseSetId })
        .from(s.programs).where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))
      previousPhaseSetId = prog?.phaseSetId ?? null
    }

    await this.db.update(s.programs).set(set)
      .where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))

    if (previousPhaseSetId && previousPhaseSetId !== settings.phaseSetId) {
      await this.deletePhaseSetIfOrphaned(previousPhaseSetId, userId)
    }
  }

  // Removes a custom (clone-generated, non-default) phase set if no program references it
  // anymore and no logged workout session points at one of its phases. Keeps custom phase
  // sets from accumulating every time the program editor saves with new overrides.
  private async deletePhaseSetIfOrphaned(phaseSetId: string, userId: string): Promise<void> {
    const [phaseSet] = await this.db.select({ name: s.phaseSets.name, isDefault: s.phaseSets.isDefault })
      .from(s.phaseSets)
      .where(and(eq(s.phaseSets.id, phaseSetId), eq(s.phaseSets.userId, userId)))
    if (!phaseSet || phaseSet.isDefault || !/\(custom(-[0-9a-f]+)?\)$/.test(phaseSet.name)) return

    const [referencingProgram] = await this.db.select({ id: s.programs.id })
      .from(s.programs).where(eq(s.programs.phaseSetId, phaseSetId)).limit(1)
    if (referencingProgram) return

    const [referencingSession] = await this.db.select({ id: s.workoutSessions.id })
      .from(s.workoutSessions)
      .innerJoin(s.programPhases, eq(s.workoutSessions.phaseId, s.programPhases.id))
      .where(eq(s.programPhases.phaseSetId, phaseSetId)).limit(1)
    if (referencingSession) return

    await this.db.delete(s.phaseSets).where(eq(s.phaseSets.id, phaseSetId))
  }
```

with:

```ts
  async updateProgramPhaseSettings(
    programId: string, userId: string,
    settings: { phaseMode?: 'manual' | 'automatic'; startedAt?: string | null; sessionsPerCycle?: number | null; phaseSetId?: string | null },
  ): Promise<void> {
    const set: Record<string, unknown> = {}
    if (settings.phaseMode !== undefined) set.phaseMode = settings.phaseMode
    if ('startedAt' in settings) set.startedAt = settings.startedAt ?? null
    if ('sessionsPerCycle' in settings) set.sessionsPerCycle = settings.sessionsPerCycle ?? null
    if ('phaseSetId' in settings) set.phaseSetId = settings.phaseSetId ?? null
    if (!Object.keys(set).length) return

    await this.db.update(s.programs).set(set)
      .where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))
  }
```

A program that switches away from its owned clone (e.g. the user picks a different phase set from the config-screen dropdown) keeps the now-unused owned clone until the program itself is deleted (Task 8 Step 1) — its lifecycle stays tied to the program that created it, rather than being heuristically guessed at on every settings save.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors, and no remaining references to `deletePhaseSetIfOrphaned`.

---

### Task 9: Clone route creates an owned clone named from the program

**Files:**
- Modify: `app/api/phase-sets/clone/route.ts`

- [ ] **Step 1: Rewrite the route**

Replace the entire file with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    phaseSetId: string
    programName: string
    overrides: Record<number, number>  // position → durationCycles
    includeBaseline?: boolean
  }

  if (!body.phaseSetId) {
    return NextResponse.json({ error: 'phaseSetId is required' }, { status: 400 })
  }
  if (!body.programName?.trim()) {
    return NextResponse.json({ error: 'programName is required' }, { status: 400 })
  }

  const repo = await getRepository()
  const phaseSets = await repo.listPhaseSets(userId)
  const source = phaseSets.find(ps => ps.id === body.phaseSetId)

  if (!source) {
    return NextResponse.json({ error: 'Phase set not found' }, { status: 404 })
  }

  let clonedPhases = source.phases.map(p => ({
    position:       body.includeBaseline ? p.position + 1 : p.position,
    name:           p.name,
    durationCycles: (body.overrides ?? {})[p.position] ?? p.durationCycles,
    phaseType:      p.phaseType,
    primaryStyleId: p.primaryStyleId,
  }))

  if (body.includeBaseline) {
    clonedPhases = [
      { position: 0, name: 'Baseline', durationCycles: 1, phaseType: 'baseline', primaryStyleId: undefined },
      ...clonedPhases,
    ]
  }

  const templateBaseName = source.templateBaseName ?? source.name
  try {
    const cloned = await repo.createOwnedPhaseSetClone(userId, templateBaseName, body.programName.trim(), clonedPhases)
    return NextResponse.json({ id: cloned.id, name: cloned.name })
  } catch (err) {
    console.error('[phase-sets/clone] createOwnedPhaseSetClone failed:', err)
    return NextResponse.json({ error: 'Failed to create phase set', detail: String(err) }, { status: 500 })
  }
}
```

This drops the unused `crypto.randomUUID()`-based `(custom-xxxxxxxx)` naming entirely. `templateBaseName` falls back to `source.name` for canonical templates (e.g. "Strength Progression"), or uses `source.templateBaseName` if `source` is itself already an owned clone.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

---

### Task 10: `/api/workout-templates` links ownership after save

**Files:**
- Modify: `app/api/workout-templates/route.ts:23` (body type)
- Modify: `app/api/workout-templates/route.ts:41-50` (POST handler)

- [ ] **Step 1: Extend the request body type**

Replace:

```ts
  const body = await req.json() as { program: Program };
```

with:

```ts
  const body = await req.json() as { program: Program; linkPhaseSetOwnership?: boolean };
```

- [ ] **Step 2: Call `linkPhaseSetOwnership` after a successful save**

Replace `app/api/workout-templates/route.ts:41-50`:

```ts
    const hasPhaseUpdate = body.program.phaseSetId !== undefined || body.program.sessionsPerCycle !== undefined
    if (body.program.phaseMode && hasPhaseUpdate) {
      await repo.updateProgramPhaseSettings(saved.id, userId, {
        phaseMode: body.program.phaseMode,
        ...(body.program.sessionsPerCycle !== undefined ? { sessionsPerCycle: body.program.sessionsPerCycle ?? null } : {}),
        ...(body.program.phaseSetId !== undefined ? { phaseSetId: body.program.phaseSetId || null } : {}),
      });
    }

    return NextResponse.json({ ok: true, program: saved });
```

with:

```ts
    const hasPhaseUpdate = body.program.phaseSetId !== undefined || body.program.sessionsPerCycle !== undefined
    if (body.program.phaseMode && hasPhaseUpdate) {
      await repo.updateProgramPhaseSettings(saved.id, userId, {
        phaseMode: body.program.phaseMode,
        ...(body.program.sessionsPerCycle !== undefined ? { sessionsPerCycle: body.program.sessionsPerCycle ?? null } : {}),
        ...(body.program.phaseSetId !== undefined ? { phaseSetId: body.program.phaseSetId || null } : {}),
      });
    }

    if (body.linkPhaseSetOwnership && saved.phaseSetId) {
      await repo.linkPhaseSetOwnership(saved.phaseSetId, saved.id, userId);
    }

    return NextResponse.json({ ok: true, program: saved });
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

---

### Task 11: Wire the AI workout builder's save flow

**Files:**
- Modify: `components/workout-builder/builder-review.tsx:212-253`

This task assumes Plan B (`2026-06-11-program-name-uniqueness.md`) has already been implemented, so the `if (!res.ok)` block already parses `err.error` from the response (Plan B Task 3).

- [ ] **Step 1: Pass `programName` to the clone call and track whether an owned clone was created**

Replace `components/workout-builder/builder-review.tsx:212-233`:

```ts
      // If any phase cycles were edited, clone the phase set before saving
      let finalPhaseSetId: string | null = inputs.progressionMode === 'linear' ? null : program.phaseSetId
      if (inputs.progressionMode !== 'linear' && program.phaseSetId && program.phases?.length) {
        const anyChanged = program.phases.some((p, i) => phaseCycles[i] !== p.durationCycles)
        if (anyChanged || includeBaseline) {
          const overrides: Record<number, number> = {}
          program.phases.forEach((_, i) => { overrides[i] = phaseCycles[i] ?? program.phases[i].durationCycles })
          const cloneRes = await fetch('/api/phase-sets/clone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phaseSetId: program.phaseSetId, overrides, includeBaseline }),
          })
          if (cloneRes.ok) {
            const cloned = await cloneRes.json()
            finalPhaseSetId = cloned.id
          } else {
            toast.error('Failed to apply phase customisation — please try again.')
            setSaving(false)
            return
          }
        }
      }
```

with:

```ts
      // If any phase cycles were edited, clone the phase set before saving.
      // The clone is "owned" by this program — linked via linkPhaseSetOwnership
      // below once the program has an id, and renamed/deleted alongside it.
      let finalPhaseSetId: string | null = inputs.progressionMode === 'linear' ? null : program.phaseSetId
      let didCloneOwnedPhaseSet = false
      if (inputs.progressionMode !== 'linear' && program.phaseSetId && program.phases?.length) {
        const anyChanged = program.phases.some((p, i) => phaseCycles[i] !== p.durationCycles)
        if (anyChanged || includeBaseline) {
          const overrides: Record<number, number> = {}
          program.phases.forEach((_, i) => { overrides[i] = phaseCycles[i] ?? program.phases[i].durationCycles })
          const cloneRes = await fetch('/api/phase-sets/clone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phaseSetId: program.phaseSetId, overrides, includeBaseline, programName: program.name }),
          })
          if (cloneRes.ok) {
            const cloned = await cloneRes.json()
            finalPhaseSetId = cloned.id
            didCloneOwnedPhaseSet = true
          } else {
            toast.error('Failed to apply phase customisation — please try again.')
            setSaving(false)
            return
          }
        }
      }
```

- [ ] **Step 2: Send `linkPhaseSetOwnership` in the save request**

Replace `components/workout-builder/builder-review.tsx:235-253`:

```ts
      const res = await fetch('/api/workout-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          program: {
            userId: '',
            name: program.name,
            isActive: true,
            sessions: programSessions,
            schedule,
            createdAt: new Date(),
            updatedAt: new Date(),
            phaseMode: inputs.progressionMode === 'linear' ? 'manual' : 'automatic',
            phaseSetId: finalPhaseSetId,
            sessionsPerCycle: programSessions.length,
            totalWeeks: inputs.totalWeeks,
          },
        }),
      })
```

with:

```ts
      const res = await fetch('/api/workout-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          program: {
            userId: '',
            name: program.name,
            isActive: true,
            sessions: programSessions,
            schedule,
            createdAt: new Date(),
            updatedAt: new Date(),
            phaseMode: inputs.progressionMode === 'linear' ? 'manual' : 'automatic',
            phaseSetId: finalPhaseSetId,
            sessionsPerCycle: programSessions.length,
            totalWeeks: inputs.totalWeeks,
          },
          linkPhaseSetOwnership: didCloneOwnedPhaseSet,
        }),
      })
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

---

### Task 12: End-to-end verification against the local dev database

**Files:** none (verification only)

- [ ] **Step 1: Run the unit and lint checks**

```bash
pnpm test
pnpm lint
npx tsc --noEmit
```

Expected: all pass, including the new `lib/__tests__/phase-set-naming.test.ts`.

- [ ] **Step 2: Start the dev server against the local DB**

```bash
export DATABASE_URL="postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433"
pnpm dev
```

Confirm the startup log shows the local Postgres connection (port 5433), not Railway.

- [ ] **Step 3: Find the seeded user and a template phase set to clone**

```bash
psql "$DATABASE_URL" -c "select id, name, is_default from phase_sets where user_id = (select id from users where email = 'test@local.dev') order by name;"
```

Expected: rows including `Strength Progression` (`is_default = t`). Note its `id` as `<templateId>`.

- [ ] **Step 4: Log in and exercise the clone + link flow as the AI builder would**

Log in as `test@local.dev` / `testpass123` in the browser, open devtools console, and run:

```js
// Step 4a: clone "Strength Progression" with an override, named for a new program "john"
const cloneRes = await fetch('/api/phase-sets/clone', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phaseSetId: '<templateId>', overrides: { 0: 8 }, programName: 'john' }),
})
const cloned = await cloneRes.json()
console.log(cloneRes.status, cloned)
```

Expected: `200 { id: '<clonedId>', name: 'Strength Progression (john)' }`.

```js
// Step 4b: save the new program "john", linking ownership of the clone
const saveRes = await fetch('/api/workout-templates', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    program: {
      userId: '', name: 'john', isActive: false, sessions: [],
      createdAt: new Date(), updatedAt: new Date(),
      phaseMode: 'automatic', phaseSetId: cloned.id, sessionsPerCycle: 1,
    },
    linkPhaseSetOwnership: true,
  }),
})
const saved = await saveRes.json()
console.log(saveRes.status, saved)
```

Expected: `200 { ok: true, program: { id: '<johnProgramId>', name: 'john', phaseSetId: '<clonedId>', ... } }`.

- [ ] **Step 5: Confirm ownership linkage and the overridden phase**

```bash
psql "$DATABASE_URL" -c "select id, name, owner_program_id, template_base_name from phase_sets where name = 'Strength Progression (john)';"
psql "$DATABASE_URL" -c "select position, name, duration_cycles from program_phases where phase_set_id = '<clonedId>' order by position;"
```

Expected: `owner_program_id = '<johnProgramId>'`, `template_base_name = 'Strength Progression'`, and `position = 0` row has `duration_cycles = 8` (the override from Step 4a).

- [ ] **Step 6: Editing the clone's contents in place doesn't break the link**

```js
const phasesRes = await fetch('/api/phase-sets')
const { phaseSets } = await phasesRes.json()
const john = phaseSets.find(ps => ps.id === '<clonedId>')
const putRes = await fetch(`/api/phase-sets/${john.id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: john.name, phases: john.phases.map(p => ({ ...p, durationCycles: p.durationCycles + 1 })) }),
})
console.log(putRes.status, await putRes.json())
```

```bash
psql "$DATABASE_URL" -c "select id, name, owner_program_id from phase_sets where id = '<clonedId>';"
```

Expected: `200`, and `id`/`name`/`owner_program_id` unchanged — only the `program_phases` durations changed.

- [ ] **Step 7: Creating a second program named "john" is blocked (Plan B)**

```js
const dupeRes = await fetch('/api/workout-templates', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    program: {
      userId: '', name: 'john', isActive: false, sessions: [],
      createdAt: new Date(), updatedAt: new Date(), phaseMode: 'manual',
    },
  }),
})
console.log(dupeRes.status, await dupeRes.json())
```

Expected: `409 { error: 'A program named "john" already exists. Use a different name.' }`.

- [ ] **Step 8: Renaming "john" → "john2" cascades the phase set rename**

```js
const renameRes = await fetch('/api/workout-templates', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    program: {
      id: '<johnProgramId>', userId: '', name: 'john2', isActive: false, sessions: [],
      createdAt: new Date(), updatedAt: new Date(),
      phaseMode: 'automatic', phaseSetId: '<clonedId>', sessionsPerCycle: 1,
    },
  }),
})
console.log(renameRes.status, await renameRes.json())
```

```bash
psql "$DATABASE_URL" -c "select id, name, owner_program_id, template_base_name from phase_sets where owner_program_id = '<johnProgramId>';"
```

Expected: `200`, and the phase set's `name` is now `Strength Progression (john2)` with `owner_program_id`/`id` unchanged.

- [ ] **Step 9: A new "john" can now be created with its own owned clone**

Repeat Steps 4a–4b with `programName: 'john'` again (a fresh clone + program).

```bash
psql "$DATABASE_URL" -c "select id, name, owner_program_id from phase_sets where name like '%(john%)%' order by name;"
```

Expected: two rows — `Strength Progression (john2)` (owned by the renamed first program) and `Strength Progression (john)` (owned by the new second program), each with a distinct `owner_program_id`.

- [ ] **Step 10: Deleting "john2" deletes its owned clone but not "john"'s**

```js
const deleteRes = await fetch('/api/workout-templates', {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: '<johnProgramId>' }),  // the renamed "john2" program's id
})
console.log(deleteRes.status, await deleteRes.json())
```

```bash
psql "$DATABASE_URL" -c "select id, name, owner_program_id from phase_sets where template_base_name = 'Strength Progression' and owner_program_id is not null;"
psql "$DATABASE_URL" -c "select id from programs where id = '<johnProgramId>';"
```

Expected: `200`; only `Strength Progression (john)` (the second program's clone) remains; `programs` no longer has the `<johnProgramId>` row; `program_phases` rows for the deleted clone are gone too (`select count(*) from program_phases where phase_set_id = '<clonedId from step 4>';` returns `0`).

- [ ] **Step 11: Clean up remaining test data**

```bash
psql "$DATABASE_URL" -c "delete from programs where name in ('john', 'john2');"
```

(The `ON DELETE SET NULL` / `ON DELETE CASCADE` chain will clean up the second "john"'s owned clone and its phases automatically.)

---

### Task 13: Commit

**Files:** none (git only)

- [ ] **Step 1: Stage and commit**

```bash
git add lib/data/postgres/migrations/062_phase_set_ownership.sql \
  lib/data/postgres/schema.ts \
  lib/types/program.ts \
  lib/phase-set-naming.ts \
  lib/__tests__/phase-set-naming.test.ts \
  lib/data/repository.ts \
  lib/data/postgres/adapter.ts \
  app/api/phase-sets/clone/route.ts \
  app/api/workout-templates/route.ts \
  components/workout-builder/builder-review.tsx
git commit -m "Add phase set ownership: auto-name, rename-cascade, and delete owned clones with their program"
```

---

## Self-Review Notes

- **Spec coverage:**
  - "auto-generates a private 'owned' phase set clone named `<template> (<program name>)`, linked via `owner_program_id`" → Tasks 1, 2, 6, 9, 10, 11.
  - "Editing the phase set's contents in place doesn't break the link (id-based reference)" → unaffected by this plan (`updatePhaseSet` is unchanged); verified in Task 12 Step 6.
  - "Renaming the program cascades to rename its owned clone" → Task 7; verified in Task 12 Step 8.
  - "Creating a program with a name already in use is blocked" → Plan B (Task 12 Step 7 verifies it still works after this plan's changes).
  - "Deleting a program ALWAYS deletes its owned phase set clone" → Task 8 Step 1; verified in Task 12 Step 10.
  - "Reactivating/continuing a never-deleted program preserves its phase progression" → no special handling needed; nothing in this plan touches activation or `phaseSetId` once set, so it's preserved by construction.
- **Placeholder scan:** No TBD/placeholder text. Verification steps use `<templateId>`, `<clonedId>`, `<johnProgramId>` as explicit substitution points the engineer fills in from prior steps' output — these are not implementation placeholders.
- **Type consistency:** `PhaseSet`/`PhaseSetWithPhases` gain `ownerProgramId?`/`templateBaseName?` (Task 3) and are populated consistently by `listPhaseSets` (Task 6 Step 2) and returned by `createOwnedPhaseSetClone` (Task 6 Step 3). `createOwnedPhaseSetClone(userId, templateBaseName, programName, phases)` and `linkPhaseSetOwnership(phaseSetId, programId, userId)` signatures match between `repository.ts` (Task 5) and `adapter.ts` (Task 6). `buildOwnedPhaseSetName(templateBaseName, programName)` is used identically in Task 6 (clone) and Task 7 (rename-cascade).
- **Known limitations (deliberately unaddressed, per YAGNI):**
  - If `/api/phase-sets/clone` succeeds but the subsequent `/api/workout-templates` save fails (e.g. an unrelated validation error), the freshly-created clone is left unowned (`owner_program_id IS NULL`) and unreferenced. It won't be auto-cleaned, but it's harmless and the user can retry — a fresh clone is created as a side effect of any retry, leaving at most a small number of stray rows.
  - If a user manually reassigns another program's owned clone via the config-screen phase-set dropdown, and the owning program is later deleted, the borrowing program's `phase_set_id` becomes `NULL` (via `ON DELETE SET NULL`) rather than erroring — it silently loses its phase progression. Not addressed by this plan.
- **Dependencies confirmed:** Task 7 builds on Plan B's rewritten `saveProgram` (specifically the `const programId = pRow.id` line, which exists in both the pre- and post-Plan-B versions at the same logical position). Task 8's "always delete" relies on Plan A's `workout_sessions.phase_type` snapshot to preserve historical deload/testing analytics once `program_phases` rows cascade-delete.
