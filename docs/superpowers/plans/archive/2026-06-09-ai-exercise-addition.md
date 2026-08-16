> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# AI-Gated Exercise Addition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow any authenticated user to add exercises to the global library from within the app, with Gemini Flash generating the normalized name, instructions, muscles, and equipment from just a name input, plus a fuzzy duplicate check with rename-and-merge capability.

**Architecture:** A shared `AddExerciseSheet` component is triggered from three surfaces (stats search, workout builder swap panel, admin exercises panel). The sheet calls a new `/api/exercises/generate` endpoint for AI details and `/api/exercises` to save. Fuzzy matching runs client-side against the already-cached exercise library — no extra round-trip.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Drizzle ORM + PostgreSQL, `@ai-sdk/google` (Gemini Flash), Zod, Tailwind CSS v4, Radix UI Sheet, Sonner toasts, Vitest.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `lib/data/postgres/migrations/056_exercise_library_created_by.sql` | Add `created_by` column |
| Modify | `lib/data/postgres/schema.ts` | Add `createdBy` field to `exerciseLibrary` table |
| Modify | `lib/data/repository.ts` | Add `createExercise` + `renameExercise` to interface |
| Modify | `lib/data/postgres/adapter.ts` | Implement both new methods |
| Create | `app/api/exercises/generate/route.ts` | Gemini Flash — name → exercise details |
| Create | `app/api/exercises/route.ts` | Create or rename-merge exercise |
| Create | `components/exercises/add-exercise-sheet.tsx` | Shared sheet UI (fuzzy match + AI review) |
| Create | `lib/__tests__/exercise-utils.test.ts` | Tests for `fuzzyScore` |
| Modify | `components/stats/exercise-library-search.tsx` | "Add exercise" in no-results + sheet |
| Modify | `app/stats/stats-content.tsx` | Pass refresh callback down |
| Modify | `components/workout-builder/builder-review.tsx` | "Add exercise" when swap has no alts |
| Modify | `components/admin/exercise-manager.tsx` | Open sheet from Add btn; Generate in edit form |

---

## Task 1: DB Migration — add `created_by` to `exercise_library`

**Files:**
- Create: `lib/data/postgres/migrations/056_exercise_library_created_by.sql`
- Modify: `lib/data/postgres/schema.ts`

- [ ] **Step 1: Create the migration file**

```sql
-- lib/data/postgres/migrations/056_exercise_library_created_by.sql
ALTER TABLE exercise_library ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
```

- [ ] **Step 2: Update the Drizzle schema**

Open `lib/data/postgres/schema.ts`. Find the `exerciseLibrary` table definition (currently lines 183–189):

```typescript
export const exerciseLibrary = pgTable('exercise_library', {
  id:           uuid('id').primaryKey().defaultRandom(),
  name:         text('name').notNull().unique(),
  muscles:      jsonb('muscles').notNull().default([]),
  equipment:    text('equipment').array().notNull().default([]),
  instructions: text('instructions'),
})
```

Replace with:

```typescript
export const exerciseLibrary = pgTable('exercise_library', {
  id:           uuid('id').primaryKey().defaultRandom(),
  name:         text('name').notNull().unique(),
  muscles:      jsonb('muscles').notNull().default([]),
  equipment:    text('equipment').array().notNull().default([]),
  instructions: text('instructions'),
  createdBy:    uuid('created_by').references(() => users.id),
})
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit 2>&1 | grep -E "schema|exerciseLibrary" | head -10`

Expected: no errors related to these files.

- [ ] **Step 4: Commit**

```bash
git add lib/data/postgres/migrations/056_exercise_library_created_by.sql lib/data/postgres/schema.ts
git commit -m "feat: add created_by column to exercise_library"
```

---

## Task 2: Repository interface + adapter methods

**Files:**
- Modify: `lib/data/repository.ts`
- Modify: `lib/data/postgres/adapter.ts`

- [ ] **Step 1: Add methods to the repository interface**

Open `lib/data/repository.ts`. Find the exercise library section (near `listExerciseLibrary`, `upsertExercise`, `deleteExercise`). Add two new method signatures after `deleteExercise`:

```typescript
createExercise(entry: {
  name: string
  muscles: MuscleAssignment[]
  equipment: string[]
  instructions?: string
  createdBy: string
}): Promise<ExerciseLibraryEntry>
renameExercise(id: string, newName: string): Promise<ExerciseLibraryEntry>
```

- [ ] **Step 2: Implement `createExercise` in the adapter**

Open `lib/data/postgres/adapter.ts`. Find the `deleteExercise` method and add these two methods directly after it:

```typescript
async createExercise(entry: {
  name: string
  muscles: MuscleAssignment[]
  equipment: string[]
  instructions?: string
  createdBy: string
}): Promise<ExerciseLibraryEntry> {
  const [row] = await this.db.insert(s.exerciseLibrary)
    .values({
      name: entry.name,
      muscles: entry.muscles,
      equipment: entry.equipment,
      instructions: entry.instructions ?? null,
      createdBy: entry.createdBy,
    })
    .returning()
  return {
    id: row.id,
    name: row.name,
    muscles: (row.muscles as MuscleAssignment[]) ?? [],
    equipment: row.equipment ?? [],
    instructions: row.instructions ?? undefined,
  }
}

async renameExercise(id: string, newName: string): Promise<ExerciseLibraryEntry> {
  let result!: ExerciseLibraryEntry
  await this.db.transaction(async tx => {
    const existing = await tx.select().from(s.exerciseLibrary).where(eq(s.exerciseLibrary.id, id)).limit(1)
    if (!existing.length) throw new Error('Exercise not found')
    const oldName = existing[0].name
    const [updated] = await tx.update(s.exerciseLibrary)
      .set({ name: newName })
      .where(eq(s.exerciseLibrary.id, id))
      .returning()
    await tx.update(s.sessionExercises).set({ exerciseName: newName }).where(eq(s.sessionExercises.exerciseName, oldName))
    await tx.update(s.exerciseLogs).set({ exerciseName: newName }).where(eq(s.exerciseLogs.exerciseName, oldName))
    await tx.update(s.personalRecords).set({ exerciseName: newName }).where(eq(s.personalRecords.exerciseName, oldName))
    result = {
      id: updated.id,
      name: updated.name,
      muscles: (updated.muscles as MuscleAssignment[]) ?? [],
      equipment: updated.equipment ?? [],
      instructions: updated.instructions ?? undefined,
    }
  })
  return result
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit 2>&1 | grep -E "adapter|repository|createExercise|renameExercise" | head -10`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "feat: add createExercise and renameExercise to repository"
```

---

## Task 3: Fuzzy score utility + tests

The `fuzzyScore` function will be defined inside `add-exercise-sheet.tsx` (Task 6) and exported for testing. Write the tests first so we know the expected behaviour before building the sheet.

**Files:**
- Create: `lib/__tests__/exercise-utils.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/exercise-utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { fuzzyScore } from '../../components/exercises/add-exercise-sheet'

describe('fuzzyScore', () => {
  it('returns 1 for exact match (case-insensitive)', () => {
    expect(fuzzyScore('Barbell Squat', 'barbell squat')).toBe(1)
  })

  it('returns 0.8 for substring match', () => {
    expect(fuzzyScore('squat', 'Barbell Squat')).toBe(0.8)
  })

  it('returns 0.8 when query contains target', () => {
    expect(fuzzyScore('Barbell Squat', 'squat')).toBe(0.8)
  })

  it('returns high score for overlapping words', () => {
    expect(fuzzyScore('DB Bench Press', 'Dumbbell Bench Press')).toBeGreaterThan(0.3)
  })

  it('returns 0 for empty query', () => {
    expect(fuzzyScore('', 'Barbell Squat')).toBe(0)
  })

  it('returns low score for unrelated exercises', () => {
    expect(fuzzyScore('Bicep Curl', 'Barbell Squat')).toBeLessThan(0.3)
  })
})
```

- [ ] **Step 2: Run to confirm tests fail**

Run: `pnpm test lib/__tests__/exercise-utils.test.ts 2>&1 | tail -15`

Expected: FAIL — "Cannot find module '../../components/exercises/add-exercise-sheet'"

- [ ] **Step 3: Commit the test file**

```bash
git add lib/__tests__/exercise-utils.test.ts
git commit -m "test: add fuzzyScore tests (red)"
```

---

## Task 4: AI generate API route

**Files:**
- Create: `app/api/exercises/generate/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// app/api/exercises/generate/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import { z } from 'zod'

const RequestSchema = z.object({
  name: z.string().min(1).max(120),
})

const SYSTEM_PROMPT = `You are a fitness expert. Given an exercise name, return a JSON object with exactly these fields:
- normalizedName: the full proper name in Title Case — expand abbreviations (DB → Dumbbell, BB → Barbell, RDL → Romanian Deadlift, OHP → Overhead Press, etc.)
- instructions: 2-4 sentences explaining setup, form cues, and execution
- muscles: array of { muscle, role } objects. role must be "main" or "secondary". Use ONLY these muscle names: Chest, Shoulders, Triceps, Biceps, Forearms, Upper Back, Lats, Lower Back, Traps, Core, Quads, Hamstrings, Glutes, Calves, Adductors
- equipment: array of strings. Use ONLY these values: barbell, dumbbell, cable, kettlebell, machine, bodyweight

Return ONLY valid JSON. No markdown, no explanation, no code blocks.`

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = RequestSchema.safeParse(await req.json())
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  try {
    const { text } = await generateText({
      model: google('gemini-3.1-flash-lite'),
      system: SYSTEM_PROMPT,
      prompt: `Exercise name: "${body.data.name}"`,
    })

    let raw: {
      normalizedName: string
      instructions: string
      muscles: { muscle: string; role: 'main' | 'secondary' }[]
      equipment: string[]
    }
    try {
      raw = JSON.parse(text)
    } catch {
      return NextResponse.json({ error: 'AI returned invalid response' }, { status: 500 })
    }

    return NextResponse.json(raw)
  } catch {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit 2>&1 | grep "exercises/generate" | head -5`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/exercises/generate/route.ts
git commit -m "feat: add AI exercise generate endpoint"
```

---

## Task 5: Exercise create/merge API route

**Files:**
- Create: `app/api/exercises/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// app/api/exercises/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { z } from 'zod'
import type { MuscleAssignment } from '@/lib/types/program'

const CreateBody = z.object({
  name:        z.string().min(1).max(120),
  muscles:     z.array(z.object({ muscle: z.string(), role: z.enum(['main', 'secondary']) })).default([]),
  equipment:   z.array(z.string()).default([]),
  instructions: z.string().max(2000).optional(),
  mergeWithId: z.string().uuid().optional(),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = CreateBody.safeParse(await req.json())
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const repo = await getRepository()

  if (body.data.mergeWithId) {
    try {
      const exercise = await repo.renameExercise(body.data.mergeWithId, body.data.name)
      return NextResponse.json({ exercise })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Rename failed'
      return NextResponse.json({ error: msg }, { status: 400 })
    }
  }

  try {
    const exercise = await repo.createExercise({
      name:         body.data.name,
      muscles:      body.data.muscles as MuscleAssignment[],
      equipment:    body.data.equipment,
      instructions: body.data.instructions,
      createdBy:    session.user.id,
    })
    return NextResponse.json({ exercise }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Create failed'
    if (msg.toLowerCase().includes('unique') || msg.toLowerCase().includes('duplicate')) {
      return NextResponse.json({ error: 'An exercise with that name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit 2>&1 | grep "exercises/route" | head -5`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/exercises/route.ts
git commit -m "feat: add exercise create and rename-merge endpoint"
```

---

## Task 6: AddExerciseSheet component

**Files:**
- Create: `components/exercises/add-exercise-sheet.tsx`

- [ ] **Step 1: Create the directory and file**

```bash
mkdir -p components/exercises
```

- [ ] **Step 2: Create the component**

```typescript
// components/exercises/add-exercise-sheet.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Loader2, Sparkles, Check } from 'lucide-react'
import { invalidateCache, readCacheSync } from '@/lib/sqlite/cache'
import type { ExerciseLibraryEntry, MuscleAssignment } from '@/lib/types/program'

const MUSCLE_OPTIONS = [
  'Chest', 'Shoulders', 'Triceps', 'Biceps', 'Forearms',
  'Upper Back', 'Lats', 'Lower Back', 'Traps', 'Core',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors',
]

const EQUIPMENT_OPTIONS = ['barbell', 'dumbbell', 'cable', 'kettlebell', 'machine', 'bodyweight']

export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase().trim()
  const t = target.toLowerCase().trim()
  if (!q) return 0
  if (q === t) return 1
  if (t.includes(q) || q.includes(t)) return 0.8
  const qWords = q.split(/\s+/)
  const tWords = t.split(/\s+/)
  const shared = qWords.filter(w => tWords.some(tw => tw.includes(w) || w.includes(tw))).length
  return shared / Math.max(qWords.length, tWords.length)
}

interface GeneratedExercise {
  normalizedName: string
  instructions: string
  muscles: MuscleAssignment[]
  equipment: string[]
}

export interface AddExerciseSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialName?: string
  onAdded: (exercise: ExerciseLibraryEntry) => void
}

export function AddExerciseSheet({ open, onOpenChange, initialName = '', onAdded }: AddExerciseSheetProps) {
  const [name, setName] = useState(initialName)
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<GeneratedExercise | null>(null)
  const [genError, setGenError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reviewName, setReviewName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [muscles, setMuscles] = useState<MuscleAssignment[]>([])
  const [equipment, setEquipment] = useState<string[]>([])
  const [matches, setMatches] = useState<ExerciseLibraryEntry[]>([])

  const cachedLibrary = useCallback((): ExerciseLibraryEntry[] => {
    try {
      const cached = readCacheSync<{ exercises: ExerciseLibraryEntry[] }>('exercise-library')
      return cached?.exercises ?? []
    } catch {
      return []
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setName(initialName)
      setGenerated(null)
      setGenError(false)
      setReviewName('')
      setInstructions('')
      setMuscles([])
      setEquipment([])
      setMatches([])
    }
  }, [open, initialName])

  useEffect(() => {
    if (open && initialName) setName(initialName)
  }, [initialName, open])

  useEffect(() => {
    if (!name.trim()) { setMatches([]); return }
    const normalizedQuery = generated?.normalizedName ?? ''
    const lib = cachedLibrary()
    const scored = lib
      .map(ex => ({
        ex,
        score: Math.max(fuzzyScore(name, ex.name), normalizedQuery ? fuzzyScore(normalizedQuery, ex.name) : 0),
      }))
      .filter(({ score }) => score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ ex }) => ex)
    setMatches(scored)
  }, [name, generated, cachedLibrary])

  async function handleGenerate() {
    if (!name.trim()) return
    setGenerating(true)
    setGenError(false)
    try {
      const res = await fetch('/api/exercises/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) throw new Error()
      const data: GeneratedExercise = await res.json()
      setGenerated(data)
      setReviewName(data.normalizedName)
      setInstructions(data.instructions)
      setMuscles(data.muscles)
      setEquipment(data.equipment)
    } catch {
      setGenError(true)
    } finally {
      setGenerating(false)
    }
  }

  function handleUseExisting(ex: ExerciseLibraryEntry) {
    onAdded(ex)
    onOpenChange(false)
  }

  async function handleRenameAndUse(ex: ExerciseLibraryEntry) {
    const newName = reviewName.trim() || generated?.normalizedName || name.trim()
    if (!newName) return
    setSaving(true)
    try {
      const res = await fetch('/api/exercises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, mergeWithId: ex.id }),
      })
      if (!res.ok) { toast.error('Failed to rename exercise'); return }
      const data = await res.json()
      await invalidateCache('exercise-library')
      onAdded(data.exercise)
      onOpenChange(false)
    } catch {
      toast.error('Failed to rename exercise')
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    const finalName = reviewName.trim() || name.trim()
    if (!finalName) return
    setSaving(true)
    try {
      const res = await fetch('/api/exercises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: finalName, muscles, equipment, instructions: instructions || undefined }),
      })
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error ?? 'Save failed')
        return
      }
      const data = await res.json()
      await invalidateCache('exercise-library')
      onAdded(data.exercise)
      onOpenChange(false)
      toast.success('Exercise added to library')
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  function toggleMuscle(muscle: string, role: 'main' | 'secondary') {
    const existing = muscles.find(m => m.muscle === muscle)
    if (existing) {
      if (existing.role === role) {
        setMuscles(muscles.filter(m => m.muscle !== muscle))
      } else {
        setMuscles(muscles.map(m => m.muscle === muscle ? { ...m, role } : m))
      }
    } else {
      setMuscles([...muscles, { muscle, role }])
    }
  }

  const showReview = generated !== null || genError

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] flex flex-col">
        <SheetHeader className="border-b border-border/30 pb-3 shrink-0">
          <SheetTitle>Add Exercise</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 pb-[env(safe-area-inset-bottom)] space-y-4">
          {/* Name + Generate */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Exercise name</p>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleGenerate()}
                placeholder="e.g. DB Bench Press"
                className="h-9 flex-1"
                autoFocus
              />
              <Button size="sm" onClick={handleGenerate} disabled={generating || !name.trim()} className="shrink-0">
                {generating
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <><Sparkles className="h-4 w-4" /><span className="ml-1.5">Generate</span></>
                }
              </Button>
            </div>
          </div>

          {/* Fuzzy matches */}
          {matches.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Similar exercises already in library</p>
              {matches.map(ex => (
                <div key={ex.id} className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ex.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {ex.muscles.filter(m => m.role === 'main').map(m => m.muscle).join(', ')}
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" variant="outline" className="h-7 text-xs px-2.5" onClick={() => handleUseExisting(ex)}>
                      Use
                    </Button>
                    {showReview && (
                      <Button size="sm" variant="outline" className="h-7 text-xs px-2.5" onClick={() => handleRenameAndUse(ex)} disabled={saving}>
                        Rename &amp; use
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* AI error */}
          {genError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 flex items-center justify-between gap-3">
              <p className="text-sm text-destructive">Generation failed — fill in manually or retry</p>
              <Button size="sm" variant="ghost" onClick={handleGenerate} disabled={generating}>Retry</Button>
            </div>
          )}

          {/* Review form */}
          {showReview && (
            <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Review &amp; save</p>

              <div>
                <p className="text-xs text-muted-foreground mb-1">Name</p>
                <Input value={reviewName} onChange={e => setReviewName(e.target.value)} className="h-9" />
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1">Instructions</p>
                <textarea
                  value={instructions}
                  onChange={e => setInstructions(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1">Equipment</p>
                <div className="flex flex-wrap gap-1.5">
                  {EQUIPMENT_OPTIONS.map(o => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setEquipment(prev => prev.includes(o) ? prev.filter(e => e !== o) : [...prev, o])}
                      className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                        equipment.includes(o) ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted-foreground'
                      }`}
                      style={equipment.includes(o) ? { borderColor: 'var(--color-brand)', color: 'var(--color-brand)' } : undefined}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1">Muscles</p>
                <div className="flex flex-wrap gap-1.5">
                  {MUSCLE_OPTIONS.map(m => {
                    const assignment = muscles.find(a => a.muscle === m)
                    return (
                      <div key={m} className="flex rounded-lg overflow-hidden border border-border text-xs">
                        <button
                          type="button"
                          onClick={() => toggleMuscle(m, 'main')}
                          className={`px-2 py-1 transition-colors ${assignment?.role === 'main' ? 'bg-brand text-black font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
                          style={assignment?.role === 'main' ? { background: 'var(--color-brand)' } : undefined}
                          title="Primary"
                        >
                          {m}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleMuscle(m, 'secondary')}
                          className={`px-1.5 py-1 border-l border-border transition-colors ${assignment?.role === 'secondary' ? 'bg-amber-500/20 text-amber-400' : 'text-muted-foreground hover:text-foreground'}`}
                          title="Secondary"
                        >
                          2°
                        </button>
                      </div>
                    )
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Tap name = primary · 2° = secondary · tap again to remove</p>
              </div>

              <Button className="w-full" onClick={handleSave} disabled={saving || !reviewName.trim()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                Save to library
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 3: Run fuzzyScore tests (should now pass)**

Run: `pnpm test lib/__tests__/exercise-utils.test.ts 2>&1 | tail -15`

Expected: all 6 tests PASS.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit 2>&1 | grep "add-exercise-sheet" | head -5`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/exercises/add-exercise-sheet.tsx lib/__tests__/exercise-utils.test.ts
git commit -m "feat: add AddExerciseSheet component with AI generate and fuzzy match"
```

---

## Task 7: Wire into stats exercise library search

**Files:**
- Modify: `components/stats/exercise-library-search.tsx`
- Modify: `app/stats/stats-content.tsx`

- [ ] **Step 1: Update `ExerciseLibrarySearch` to accept callback + show sheet**

Replace the full contents of `components/stats/exercise-library-search.tsx`:

```typescript
"use client";

import { useState } from "react";
import { SearchIcon, Plus } from "lucide-react";
import type { ExerciseLibraryEntry, ProgramSession } from "@/lib/types/program";
import { ExerciseHistorySheet } from "@/components/exercise-history-sheet";
import { AddExerciseSheet } from "@/components/exercises/add-exercise-sheet";

interface ExerciseLibrarySearchProps {
  exercises: ExerciseLibraryEntry[];
  sessions: ProgramSession[];
  onExerciseAdded?: () => void;
}

export function ExerciseLibrarySearch({ exercises, sessions, onExerciseAdded }: ExerciseLibrarySearchProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [historyEx, setHistoryEx] = useState<{ name: string; muscles: ExerciseLibraryEntry["muscles"] } | null>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);

  const exerciseToSession = new Map<string, string>();
  for (const sess of sessions) {
    for (const ex of sess.exercises) {
      if (!exerciseToSession.has(ex.exerciseName.toLowerCase())) {
        exerciseToSession.set(ex.exerciseName.toLowerCase(), sess.name);
      }
    }
  }

  const filters = ["All", ...sessions.map(s => s.name)];

  const filtered = exercises.filter(ex => {
    if (!ex.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === "All") return true;
    return exerciseToSession.get(ex.name.toLowerCase()) === filter;
  });

  return (
    <div className="space-y-3">
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search exercises…"
          className="w-full rounded-xl border border-border bg-muted pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {filters.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-none rounded-full px-3 py-1 text-xs font-semibold border transition ${
              filter === f
                ? "bg-brand text-white border-brand"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-6">
            <p className="text-sm text-muted-foreground">No matches</p>
            <button
              onClick={() => setAddSheetOpen(true)}
              className="flex items-center gap-1.5 text-sm font-semibold text-brand"
            >
              <Plus className="h-4 w-4" /> Add &quot;{query || 'exercise'}&quot; to library
            </button>
          </div>
        )}
        {filtered.map(ex => {
          const mainMuscles = ex.muscles.filter(m => m.role === "main").map(m => m.muscle);
          const secondaryMuscles = ex.muscles.filter(m => m.role === "secondary").map(m => m.muscle);
          return (
            <button
              key={ex.id}
              onClick={() => setHistoryEx({ name: ex.name, muscles: ex.muscles })}
              className="w-full text-left rounded-xl bg-muted/60 border border-border px-4 py-3 flex items-center gap-3 hover:bg-muted transition"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{ex.name}</p>
                {(mainMuscles.length > 0 || secondaryMuscles.length > 0) && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {mainMuscles.map(m => (
                      <span key={m} className="text-[10px] rounded-full bg-brand/20 text-brand border border-brand/30 px-2 py-0.5 font-medium">
                        {m}
                      </span>
                    ))}
                    {secondaryMuscles.map(m => (
                      <span key={m} className="text-[10px] rounded-full bg-muted border border-border px-2 py-0.5 text-muted-foreground">
                        {m}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-muted-foreground text-sm">›</span>
            </button>
          );
        })}
      </div>

      <ExerciseHistorySheet
        exerciseName={historyEx?.name ?? null}
        muscles={historyEx?.muscles ?? []}
        onClose={() => setHistoryEx(null)}
      />

      <AddExerciseSheet
        open={addSheetOpen}
        onOpenChange={setAddSheetOpen}
        initialName={query}
        onAdded={() => {
          setAddSheetOpen(false);
          onExerciseAdded?.();
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Add `fetchExercises` + `onExerciseAdded` in `stats-content.tsx`**

Open `app/stats/stats-content.tsx`. Find the exercise fetch (currently lines 77–81):

```typescript
    // exercise-library: HTTP cache (3600s) handles repeat requests
    fetch("/api/exercise-library")
      .then(r => r.ok ? r.json() : null)
      .then(d => setExercises(d?.exercises ?? []))
      .catch(() => {});
```

Extract it into a named callback and add it before the `useEffect`:

```typescript
  const fetchExercises = useCallback(() => {
    fetch("/api/exercise-library", { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => setExercises(d?.exercises ?? []))
      .catch(() => {});
  }, []);
```

Replace the inline fetch with `fetchExercises()`:

```typescript
    fetchExercises();
```

Then find the `<ExerciseLibrarySearch ... />` usage (around line 230) and add the callback prop:

```typescript
<ExerciseLibrarySearch
  exercises={otherExercises.length > 0 ? otherExercises : exercises}
  sessions={sessions}
  onExerciseAdded={fetchExercises}
/>
```

You'll also need to add `useCallback` to the import if not already present — it is already imported on line 3.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit 2>&1 | grep -E "exercise-library-search|stats-content" | head -5`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/stats/exercise-library-search.tsx app/stats/stats-content.tsx
git commit -m "feat: wire AddExerciseSheet into stats exercise library search"
```

---

## Task 8: Wire into workout builder swap panel

**Files:**
- Modify: `components/workout-builder/builder-review.tsx`

The swap panel shows alternatives for each exercise. When there are no alternatives, show an "Add exercise" button. After adding, update the local exerciseLibrary state and immediately perform the swap.

- [ ] **Step 1: Add imports and state**

In `components/workout-builder/builder-review.tsx`, add to the imports at the top:

```typescript
import { AddExerciseSheet } from '@/components/exercises/add-exercise-sheet'
```

Add to the existing imports from lucide-react (the `Plus` icon):

```typescript
import { ChevronLeft, ChevronDown, Send, Loader2, CheckCircle2, Plus } from 'lucide-react'
```

Add these state variables inside the `BuilderReview` component, after the existing state declarations:

```typescript
const [addExSheetOpen, setAddExSheetOpen] = useState(false)
const [addExSheetName, setAddExSheetName] = useState('')
const [addExSheetTarget, setAddExSheetTarget] = useState<{ si: number; ei: number } | null>(null)
```

- [ ] **Step 2: Update the swap UI to show "Add" button when no alternatives**

Find the swap button rendering in the sessions map (around line 393–400 in the original file):

```typescript
{alts.length > 0 && (
  <button
    onClick={() => setSwapOpen(swapOpen === swapKey ? null : swapKey)}
    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0 py-1"
  >
    Swap <ChevronDown className={cn('h-3 w-3 transition-transform', swapOpen === swapKey && 'rotate-180')} />
  </button>
)}
```

Replace with:

```typescript
<div className="flex items-center gap-2 shrink-0">
  {alts.length > 0 && (
    <button
      onClick={() => setSwapOpen(swapOpen === swapKey ? null : swapKey)}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground py-1"
    >
      Swap <ChevronDown className={cn('h-3 w-3 transition-transform', swapOpen === swapKey && 'rotate-180')} />
    </button>
  )}
  <button
    onClick={() => { setAddExSheetName(ex.name); setAddExSheetTarget({ si, ei }); setAddExSheetOpen(true) }}
    className="flex items-center gap-0.5 text-xs text-brand py-1"
  >
    <Plus className="h-3 w-3" /> Add
  </button>
</div>
```

- [ ] **Step 3: Add the sheet + onAdded handler before the closing `</div>` of the component return**

Find the closing `</div>` at the very end of the component's return. Just before it, add:

```typescript
<AddExerciseSheet
  open={addExSheetOpen}
  onOpenChange={setAddExSheetOpen}
  initialName={addExSheetName}
  onAdded={exercise => {
    setExerciseLibrary(prev => [...prev, exercise])
    if (addExSheetTarget) {
      swapExercise(addExSheetTarget.si, addExSheetTarget.ei, exercise)
    }
    setAddExSheetOpen(false)
  }}
/>
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit 2>&1 | grep "builder-review" | head -5`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/workout-builder/builder-review.tsx
git commit -m "feat: wire AddExerciseSheet into workout builder swap panel"
```

---

## Task 9: Wire into admin exercise manager

**Files:**
- Modify: `components/admin/exercise-manager.tsx`

Two changes: (1) the existing "Add" button opens the sheet instead of the inline form, and (2) the `ExerciseForm` gains an inline "Generate" button that fills fields from AI without opening the sheet.

- [ ] **Step 1: Add import for `AddExerciseSheet` and `Sparkles` icon**

In `components/admin/exercise-manager.tsx`, update the imports:

```typescript
import { Plus, Pencil, Trash2, X, Check, Loader2, Search, RefreshCw, ChevronDown, ChevronUp, AlertCircle, Sparkles } from "lucide-react";
import { AddExerciseSheet } from "@/components/exercises/add-exercise-sheet";
```

- [ ] **Step 2: Add "Generate" button to `ExerciseForm`**

`ExerciseForm` currently starts at line 112. Add `generating` state and a `handleGenerate` function inside `ExerciseForm`:

Find the state declarations inside `ExerciseForm`:

```typescript
  const [name, setName] = useState(initial?.name ?? "");
  const [equipment, setEquipment] = useState<string[]>(initial?.equipment ?? []);
  const [muscles, setMuscles] = useState<MuscleAssignment[]>(initial?.muscles ?? []);
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [gifUrl, setGifUrl] = useState(initial?.gifUrl ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "");
```

Add `generating` state after them:

```typescript
  const [generating, setGenerating] = useState(false);
```

Add `handleGenerate` function after the state:

```typescript
  async function handleGenerate() {
    if (!name.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/exercises/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) { toast.error('Generation failed'); return; }
      const data = await res.json();
      if (data.normalizedName) setName(data.normalizedName);
      if (data.muscles?.length) setMuscles(data.muscles);
      if (data.equipment?.length) setEquipment(data.equipment);
      if (data.instructions) setInstructions(data.instructions);
    } catch {
      toast.error('Generation failed');
    } finally {
      setGenerating(false);
    }
  }
```

Then find the name input section inside the form's return JSX:

```typescript
      <div>
        <p className="text-xs text-muted-foreground mb-1">Exercise name</p>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Barbell Squat" className="h-9" />
      </div>
```

Replace with:

```typescript
      <div>
        <p className="text-xs text-muted-foreground mb-1">Exercise name</p>
        <div className="flex gap-2">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Barbell Squat" className="h-9 flex-1" />
          <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating || !name.trim()} className="shrink-0">
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          </Button>
        </div>
      </div>
```

- [ ] **Step 3: Add sheet state and wire the Add button**

In the `ExerciseManager` component (starting line 187), add state for the sheet:

```typescript
  const [addSheetOpen, setAddSheetOpen] = useState(false);
```

Find the existing "Add" button (around line 287–289):

```typescript
        <Button size="sm" onClick={() => { setAdding(true); setEditingId(null); }}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
```

Replace with:

```typescript
        <Button size="sm" onClick={() => setAddSheetOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
```

- [ ] **Step 4: Add the `AddExerciseSheet` to the return JSX**

In the `ExerciseManager` return, just before the final closing `</div>` of the outermost `<div className="space-y-4">`, add:

```typescript
      <AddExerciseSheet
        open={addSheetOpen}
        onOpenChange={setAddSheetOpen}
        onAdded={() => { setAddSheetOpen(false); load(); }}
      />
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit 2>&1 | grep "exercise-manager" | head -5`

Expected: no errors.

- [ ] **Step 6: Run all tests**

Run: `pnpm test 2>&1 | tail -20`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add components/admin/exercise-manager.tsx
git commit -m "feat: wire AddExerciseSheet into admin exercise manager with inline Generate button"
```

---

## Task 10: Push and verify

- [ ] **Step 1: Final TypeScript check**

Run: `pnpm tsc --noEmit 2>&1 | grep -v "node_modules" | head -20`

Expected: no errors outside node_modules.

- [ ] **Step 2: Final test run**

Run: `pnpm test 2>&1 | tail -10`

Expected: all tests pass.

- [ ] **Step 3: Push to main**

```bash
git push origin fix/exercise-save:main
```

- [ ] **Step 4: Manual verification checklist**

After Railway redeploys (~1–2 min):

1. **Stats page** — search for an exercise that doesn't exist → "No matches" + "Add exercise" button appears → tap it → sheet opens with name pre-filled → tap Generate → AI fills details (name normalised, muscles, equipment, instructions) → similar exercises shown if any match → tap "Save to library" → toast "Exercise added to library" → search again, new exercise appears

2. **Stats page — merge path** — search for "DB Bench Press" → "Add DB Bench Press to library" → sheet opens → Generate → AI returns "Dumbbell Bench Press" → fuzzy matches shows "Barbell Bench Press" or similar → tap "Rename & use" → verifies existing exercise is renamed + returned to caller

3. **Workout builder swap panel** — create a new program → on review screen, each exercise shows "+ Add" button → tap it → sheet opens → Generate → Save → exercise is immediately swapped in

4. **Admin panel** — open admin → exercises → tap "Add" button → sheet opens (not inline form) → Generate fills all fields → Save works

5. **Admin edit form** — tap pencil on an existing exercise → the name row now has a sparkle button → tap it → all fields fill from AI

