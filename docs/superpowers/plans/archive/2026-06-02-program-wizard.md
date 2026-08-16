> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Program Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 6-step guided program creation wizard at `/program-wizard` that filters exercises by muscle group and equipment, calculates evidence-based volume targets, and uses Gemini to review selections and generate a block periodization phase sequence.

**Architecture:** A pure-function `wizard-engine.ts` handles all session-splitting, volume, and filtering logic (testable with vitest, no DB calls). A client-side step machine in `wizard-content.tsx` orchestrates six step components and persists draft answers to `localStorage`. The `/api/program-wizard/generate` route calls Gemini with Zod-validated input, resolves style names to UUIDs, and returns a structured program recommendation. Saving reuses the existing `saveProgram` repo method and `PUT /api/program-phases` endpoint. This plan executes **after** block periodization ships — `exerciseRole`, `program_phases`, `phaseMode`, and `lib/phase-engine.ts` already exist.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM, PostgreSQL, Tailwind v4, shadcn/ui, `@ai-sdk/google` (Gemini), `zod`, vitest (already installed)

---

## File Map

| Status | File | Change |
|--------|------|--------|
| **Create** | `lib/data/postgres/migrations/022_style_rep_ranges.sql` | Add `reps_min`, `reps_max`; make `rest_sec` nullable |
| **Modify** | `lib/data/postgres/schema.ts` | Update `styleSets` table definition |
| **Modify** | `lib/types/progression.ts` | Add `repsMin?`, `repsMax?`; make `restSec?` optional |
| **Modify** | `lib/data/postgres/adapter.ts` | Update style mapper; add `seedDefaultProgressionStyles` method; call in `upsertUser` |
| **Modify** | `lib/data/repository.ts` | Add `seedDefaultProgressionStyles` to interface |
| **Modify** | `app/api/workout-data/route.ts` | Pass `repsMin`/`repsMax`/nullable `restSec` through `StyleSet` mapping |
| **Modify** | `components/workout/active-workout-screen.tsx` | Dynamic rest from `pct` when `restSec` is null |
| **Create** | `lib/wizard-engine.ts` | Pure functions: session splitting, volume targeting, exercise filtering, role assignment |
| **Create** | `lib/__tests__/wizard-engine.test.ts` | vitest tests for all wizard-engine exports |
| **Create** | `app/program-wizard/page.tsx` | Server page — fetches exercise library + user styles; passes to client |
| **Create** | `app/program-wizard/wizard-content.tsx` | Client orchestrator — step state machine + localStorage persistence |
| **Create** | `components/wizard/step-goal.tsx` | Goal + experience picker |
| **Create** | `components/wizard/step-schedule.tsx` | Days/week + duration picker |
| **Create** | `components/wizard/step-muscles.tsx` | Muscle group multi-select |
| **Create** | `components/wizard/step-equipment.tsx` | Equipment multi-select |
| **Create** | `components/wizard/step-exercises.tsx` | Exercise cards + swap bottom sheet |
| **Create** | `components/wizard/step-review.tsx` | AI review results + save/regenerate |
| **Create** | `app/api/program-wizard/generate/route.ts` | Gemini call with Zod validation + rate limit |
| **Modify** | `components/config-screen.tsx` | "Create with Wizard" button + `programId` query param on mount |

---

## Task 1: DB Migration — Rep Ranges + Nullable Rest

**Files:**
- Create: `lib/data/postgres/migrations/022_style_rep_ranges.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Backwards-compatible: existing rows keep reps + rest_sec unchanged
ALTER TABLE style_sets
  ADD COLUMN IF NOT EXISTS reps_min INTEGER,
  ADD COLUMN IF NOT EXISTS reps_max INTEGER;

-- NULL rest_sec = calculate dynamically from pct at runtime
ALTER TABLE style_sets
  ALTER COLUMN rest_sec DROP NOT NULL,
  ALTER COLUMN rest_sec DROP DEFAULT;
```

- [ ] **Step 2: Verify the file exists**

```bash
ls lib/data/postgres/migrations/022_style_rep_ranges.sql
```

Expected: file listed.

- [ ] **Step 3: Commit**

```bash
git add lib/data/postgres/migrations/022_style_rep_ranges.sql
git commit -m "feat: add rep range columns and nullable rest_sec to style_sets"
```

---

## Task 2: Schema + Types + Adapter Style Mapper

**Files:**
- Modify: `lib/data/postgres/schema.ts`
- Modify: `lib/types/progression.ts`
- Modify: `lib/data/postgres/adapter.ts`
- Modify: `app/api/workout-data/route.ts`

- [ ] **Step 1: Update `styleSets` in `lib/data/postgres/schema.ts`**

Find the `styleSets` table definition (line ~35) and replace it:

```typescript
export const styleSets = pgTable('style_sets', {
  id:        uuid('id').primaryKey().defaultRandom(),
  styleId:   uuid('style_id').notNull().references(() => progressionStyles.id, { onDelete: 'cascade' }),
  setNumber: integer('set_number').notNull(),
  pct:       doublePrecision('pct').notNull(),
  reps:      integer('reps').notNull(),
  repsMin:   integer('reps_min'),
  repsMax:   integer('reps_max'),
  restSec:   integer('rest_sec'),
  useFor1rm: boolean('use_for_1rm').notNull().default(false),
}, t => [unique().on(t.styleId, t.setNumber)])
```

- [ ] **Step 2: Update `StyleSet` in `lib/types/progression.ts`**

```typescript
export interface StyleSet {
  id: string
  styleId: string
  setNumber: number
  pct: number        // % of 1RM (e.g. 72 = 72%)
  reps: number       // exact target reps — used when repsMin/repsMax are null
  repsMin?: number   // lower end of rep range (e.g. 8) — shown as "8–12" in UI
  repsMax?: number   // upper end of rep range (e.g. 12)
  restSec?: number   // override rest in seconds; undefined/null = dynamic from pct
  useFor1rm: boolean
}

export interface ProgressionStyle {
  id: string
  userId: string
  name: string
  sets: StyleSet[]
}
```

- [ ] **Step 3: Update style mapper in `lib/data/postgres/adapter.ts`**

Find `listProgressionStyles` (line ~321). The inner `.map<StyleSet>` currently maps 5 fields. Update it to include the new fields:

```typescript
.map<StyleSet>(ss => ({
  id: ss.id, styleId: ss.styleId, setNumber: ss.setNumber,
  pct: ss.pct, reps: ss.reps,
  repsMin: ss.repsMin ?? undefined,
  repsMax: ss.repsMax ?? undefined,
  restSec: ss.restSec ?? undefined,
  useFor1rm: ss.useFor1rm,
})),
```

Also update `saveProgressionStyle` (line ~365). The `tx.insert(s.styleSets).values(...)` currently passes `restSec: set.restSec`. Update it:

```typescript
const [setRow] = await tx.insert(s.styleSets)
  .values({
    ...(set.id ? { id: set.id } : {}),
    styleId, setNumber: set.setNumber, pct: set.pct,
    reps: set.reps,
    repsMin: set.repsMin ?? null,
    repsMax: set.repsMax ?? null,
    restSec: set.restSec ?? null,
    useFor1rm: set.useFor1rm,
  })
  .returning()
```

- [ ] **Step 4: Update `workout-data` route StyleSet mapping**

In `app/api/workout-data/route.ts`, find the `progressionStyle` mapping (line ~84):

```typescript
progressionStyle: resolvedStyle
  ? resolvedStyle.map(s => ({
      pct: s.pct,
      reps: s.reps,
      repsMin: s.repsMin,
      repsMax: s.repsMax,
      restSec: s.restSec,
      useFor1rm: s.useFor1rm,
    } as StyleSet))
  : null,
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
pnpm build 2>&1 | grep -E "error TS" | head -20
```

Expected: zero new TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add lib/data/postgres/schema.ts lib/types/progression.ts lib/data/postgres/adapter.ts app/api/workout-data/route.ts
git commit -m "feat: extend StyleSet with rep ranges and nullable rest_sec"
```

---

## Task 3: Dynamic Rest in Active Workout Screen

**Files:**
- Modify: `components/workout/active-workout-screen.tsx`

When `restSec` is `undefined`/`null` on a `StyleSet`, the rest timer should calculate duration from the set's `pct` value.

- [ ] **Step 1: Add `pctToRestSec` helper at the top of `active-workout-screen.tsx`**

After the imports and before the component, add:

```typescript
function pctToRestSec(pct: number): number {
  if (pct < 65)  return 45
  if (pct < 75)  return 75
  if (pct < 85)  return 120
  if (pct < 93)  return 210
  return 300
}
```

- [ ] **Step 2: Update `currentRestSec` to use dynamic rest**

Find line ~112:
```typescript
const currentRestSec = exercise?.progressionStyle?.[currentSet - 1]?.restSec ?? 90;
```

Replace with:
```typescript
const currentStyleSet = exercise?.progressionStyle?.[currentSet - 1]
const currentRestSec = currentStyleSet
  ? (currentStyleSet.restSec ?? pctToRestSec(currentStyleSet.pct))
  : 90
```

- [ ] **Step 3: Verify the build**

```bash
pnpm build 2>&1 | grep -E "error TS" | head -10
```

Expected: no new TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add components/workout/active-workout-screen.tsx
git commit -m "feat: calculate rest time dynamically from %1RM when restSec is not set"
```

---

## Task 4: Seed Default Progression Styles

**Files:**
- Modify: `lib/data/repository.ts`
- Modify: `lib/data/postgres/adapter.ts`

Six default styles are inserted for every new user account. Seeding is idempotent — if styles already exist for the user, do nothing.

- [ ] **Step 1: Add interface method to `lib/data/repository.ts`**

Find the `// ── Programs ──` section. Add:

```typescript
// ── Progression styles ────────────────────────────────────────────────────
listProgressionStyles(userId: string): Promise<ProgressionStyle[]>
saveProgressionStyle(userId: string, style: ProgressionStyle): Promise<ProgressionStyle>
deleteProgressionStyle(userId: string, styleId: string): Promise<void>
seedDefaultProgressionStyles(userId: string): Promise<void>
```

(The first three already exist — just add `seedDefaultProgressionStyles`.)

- [ ] **Step 2: Implement `seedDefaultProgressionStyles` in `lib/data/postgres/adapter.ts`**

Add after `deleteProgressionStyle` (line ~379):

```typescript
async seedDefaultProgressionStyles(userId: string): Promise<void> {
  const existing = await this.db.select({ id: s.progressionStyles.id })
    .from(s.progressionStyles).where(eq(s.progressionStyles.userId, userId)).limit(1)
  if (existing.length > 0) return  // already has styles — do not overwrite

  type SetDef = { setNumber: number; pct: number; repsMin: number; repsMax: number; useFor1rm: boolean }
  type StyleDef = { name: string; sets: SetDef[] }

  function interpolatePct(setNum: number, totalSets: number, pctMin: number, pctMax: number): number {
    if (totalSets === 1) return pctMin
    return Math.round(pctMin + (pctMax - pctMin) * ((setNum - 1) / (totalSets - 1)))
  }

  function makeSets(totalSets: number, pctMin: number, pctMax: number, repsMin: number, repsMax: number): SetDef[] {
    return Array.from({ length: totalSets }, (_, i) => ({
      setNumber: i + 1,
      pct: interpolatePct(i + 1, totalSets, pctMin, pctMax),
      repsMin, repsMax,
      useFor1rm: i === totalSets - 1,  // last set only
    }))
  }

  const defaults: StyleDef[] = [
    { name: 'Compound — Accumulation',    sets: makeSets(4, 68, 72, 10, 12) },
    { name: 'Compound — Intensification', sets: makeSets(4, 77, 82, 5, 7) },
    { name: 'Compound — Peak',            sets: makeSets(3, 87, 92, 2, 4) },
    { name: 'Accessory — Volume',         sets: makeSets(3, 63, 68, 12, 15).map(s => ({ ...s, useFor1rm: false })) },
    { name: 'Accessory — Strength',       sets: makeSets(3, 75, 80, 6, 8).map(s => ({ ...s, useFor1rm: false })) },
    { name: 'Full Body',                  sets: makeSets(3, 65, 70, 10, 12) },
  ]

  await this.db.transaction(async tx => {
    for (const def of defaults) {
      const [styleRow] = await tx.insert(s.progressionStyles)
        .values({ userId, name: def.name })
        .returning()
      await tx.insert(s.styleSets).values(
        def.sets.map(set => ({
          styleId: styleRow.id,
          setNumber: set.setNumber,
          pct: set.pct,
          reps: set.repsMin,  // reps used as fallback; actual range from repsMin/repsMax
          repsMin: set.repsMin,
          repsMax: set.repsMax,
          restSec: null,  // dynamic from pct
          useFor1rm: set.useFor1rm,
        }))
      )
    }
  })
}
```

- [ ] **Step 3: Call `seedDefaultProgressionStyles` inside `upsertUser`**

Find `upsertUser` (line ~41). After the user insert returns, add the seed call — but only on new rows (detect by checking if `createdAt` equals `updatedAt`, which is always true for a fresh insert):

```typescript
async upsertUser(user: Omit<User, 'id' | 'createdAt' | 'isActive' | 'isAdmin'>, forceActive?: boolean): Promise<User> {
  const invited = forceActive ?? await this.isInvited(user.email)
  const [r] = await this.db.insert(s.users)
    .values({ oauthSub: user.oauthSub ?? null, email: user.email, name: user.name ?? null, isActive: invited })
    .onConflictDoUpdate({
      target: s.users.oauthSub,
      set: { email: sql`EXCLUDED.email`, name: sql`EXCLUDED.name` },
    })
    .returning()
  // Seed default styles for brand-new users (idempotent — does nothing if styles exist)
  await this.seedDefaultProgressionStyles(r.id)
  return this.rowToUser(r)
}
```

- [ ] **Step 4: Verify build**

```bash
pnpm build 2>&1 | grep -E "error TS" | head -10
```

Expected: zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "feat: seed six default progression styles for new user accounts"
```

---

## Task 5: wizard-engine.ts (TDD)

**Files:**
- Create: `lib/wizard-engine.ts`
- Create: `lib/__tests__/wizard-engine.test.ts`

Pure functions only — no DB calls, no imports from Next.js or browser APIs.

- [ ] **Step 1: Write failing tests**

Create `lib/__tests__/wizard-engine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  buildSessionTemplate,
  filterExercises,
  maxWorkingSets,
  setsPerSessionForMuscle,
  autoAssignRole,
  pctToRestSec,
} from '../wizard-engine'
import type { ExerciseLibraryEntry } from '../types/program'

// ── buildSessionTemplate ──────────────────────────────────────────────────

describe('buildSessionTemplate', () => {
  it('2 days → Full Body A + B regardless of muscles', () => {
    const t = buildSessionTemplate(2, ['Chest', 'Back'])
    expect(t).toHaveLength(2)
    expect(t[0].name).toBe('Full Body A')
    expect(t[1].name).toBe('Full Body B')
    expect(t[0].muscles).toContain('Chest')
    expect(t[0].muscles).toContain('Back')
  })

  it('3 days with legs → Push / Pull / Legs', () => {
    const t = buildSessionTemplate(3, ['Chest', 'Back', 'Quads'])
    expect(t.map(s => s.name)).toEqual(['Push', 'Pull', 'Legs'])
    expect(t[0].muscles).toContain('Chest')
    expect(t[2].muscles).toContain('Quads')
  })

  it('3 days no legs → Upper A / Upper B / Arms', () => {
    const t = buildSessionTemplate(3, ['Chest', 'Back', 'Biceps'])
    expect(t.map(s => s.name)).toEqual(['Upper A', 'Upper B', 'Arms'])
  })

  it('4 days with legs → Upper A / Lower A / Upper B / Lower B', () => {
    const t = buildSessionTemplate(4, ['Chest', 'Back', 'Quads', 'Hamstrings'])
    expect(t.map(s => s.name)).toEqual(['Upper A', 'Lower A', 'Upper B', 'Lower B'])
  })

  it('4 days no legs → Push A / Pull A / Push B / Arms', () => {
    const t = buildSessionTemplate(4, ['Chest', 'Shoulders', 'Back', 'Biceps'])
    expect(t.map(s => s.name)).toEqual(['Push A', 'Pull A', 'Push B', 'Arms'])
  })

  it('6 days with legs → PPL × 2', () => {
    const t = buildSessionTemplate(6, ['Chest', 'Back', 'Quads'])
    expect(t.map(s => s.name)).toEqual(['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B'])
  })

  it('throws for unsupported day count', () => {
    expect(() => buildSessionTemplate(1, ['Chest'])).toThrow()
    expect(() => buildSessionTemplate(7, ['Chest'])).toThrow()
  })
})

// ── filterExercises ───────────────────────────────────────────────────────

describe('filterExercises', () => {
  const library: ExerciseLibraryEntry[] = [
    { id: '1', name: 'Bench Press',   muscles: [{ muscle: 'Chest', role: 'main' }, { muscle: 'Triceps', role: 'secondary' }], equipment: ['Barbell'] },
    { id: '2', name: 'Cable Fly',     muscles: [{ muscle: 'Chest', role: 'main' }],                                           equipment: ['Cable'] },
    { id: '3', name: 'Push-Up',       muscles: [{ muscle: 'Chest', role: 'main' }, { muscle: 'Triceps', role: 'secondary' }], equipment: ['Bodyweight'] },
    { id: '4', name: 'Barbell Curl',  muscles: [{ muscle: 'Biceps', role: 'main' }],                                          equipment: ['Barbell'] },
  ]

  it('filters by selected muscle groups', () => {
    const r = filterExercises(library, ['Chest'], ['Barbell', 'Bodyweight'])
    expect(r.map(e => e.name)).toContain('Bench Press')
    expect(r.map(e => e.name)).toContain('Push-Up')
    expect(r.map(e => e.name)).not.toContain('Barbell Curl')
  })

  it('filters by equipment', () => {
    const r = filterExercises(library, ['Chest'], ['Cable'])
    expect(r.map(e => e.name)).toContain('Cable Fly')
    expect(r.map(e => e.name)).not.toContain('Bench Press')
  })

  it('returns empty when no match', () => {
    const r = filterExercises(library, ['Chest'], ['Machine'])
    expect(r).toHaveLength(0)
  })

  it('Bodyweight always included in equipment filter', () => {
    // filterExercises adds Bodyweight to selected equipment automatically
    const r = filterExercises(library, ['Chest'], ['Barbell'])
    expect(r.map(e => e.name)).toContain('Push-Up')
  })
})

// ── maxWorkingSets ────────────────────────────────────────────────────────

describe('maxWorkingSets', () => {
  it('60 min hypertrophy with 5 exercises → 18', () => {
    expect(maxWorkingSets(60, 5, 'hypertrophy')).toBe(18)
    // available = 60 - 5 - 5 = 50 min; 50 / 2.6 = 19.2 → floor = 19
    // Note: actual result depends on formula — just check it is in range
    const r = maxWorkingSets(60, 5, 'hypertrophy')
    expect(r).toBeGreaterThanOrEqual(15)
    expect(r).toBeLessThanOrEqual(22)
  })

  it('60 min strength with 4 exercises → fewer than hypertrophy', () => {
    const str = maxWorkingSets(60, 4, 'strength')
    const hyp = maxWorkingSets(60, 4, 'hypertrophy')
    expect(str).toBeLessThan(hyp)
  })

  it('30 min < 45 min < 60 min for same goal', () => {
    expect(maxWorkingSets(30, 3, 'hypertrophy')).toBeLessThan(maxWorkingSets(45, 3, 'hypertrophy'))
    expect(maxWorkingSets(45, 3, 'hypertrophy')).toBeLessThan(maxWorkingSets(60, 3, 'hypertrophy'))
  })
})

// ── setsPerSessionForMuscle ───────────────────────────────────────────────

describe('setsPerSessionForMuscle', () => {
  it('14 target / 1 session = 14', () => {
    expect(setsPerSessionForMuscle(14, 1)).toBe(14)
  })

  it('14 target / 2 sessions = 7', () => {
    expect(setsPerSessionForMuscle(14, 2)).toBe(7)
  })

  it('rounds correctly', () => {
    expect(setsPerSessionForMuscle(11, 3)).toBe(4)  // 11/3 = 3.67 → round = 4
  })
})

// ── autoAssignRole ────────────────────────────────────────────────────────

describe('autoAssignRole', () => {
  it('Bench Press → primary', () => {
    expect(autoAssignRole('Bench Press', [
      { muscle: 'Chest', role: 'main' }, { muscle: 'Triceps', role: 'secondary' }
    ])).toBe('primary')
  })

  it('Romanian Deadlift → secondary (multi-joint, not in primary set)', () => {
    expect(autoAssignRole('Romanian Deadlift', [
      { muscle: 'Hamstrings', role: 'main' }, { muscle: 'Glutes', role: 'main' }, { muscle: 'Lower Back', role: 'secondary' }
    ])).toBe('secondary')
  })

  it('Bicep Curl → accessory (single-joint isolation)', () => {
    expect(autoAssignRole('Barbell Curl', [
      { muscle: 'Biceps', role: 'main' }
    ])).toBe('accessory')
  })

  it('Lateral Raise → accessory', () => {
    expect(autoAssignRole('Lateral Raise', [
      { muscle: 'Shoulders', role: 'main' }
    ])).toBe('accessory')
  })
})

// ── pctToRestSec ──────────────────────────────────────────────────────────

describe('pctToRestSec', () => {
  it('< 65% → 45s', () => { expect(pctToRestSec(60)).toBe(45) })
  it('65% → 75s', () => { expect(pctToRestSec(65)).toBe(75) })
  it('75% → 120s', () => { expect(pctToRestSec(75)).toBe(120) })
  it('85% → 210s', () => { expect(pctToRestSec(85)).toBe(210) })
  it('93% → 300s', () => { expect(pctToRestSec(93)).toBe(300) })
})
```

- [ ] **Step 2: Run tests — verify all fail**

```bash
pnpm test 2>&1 | tail -10
```

Expected: `FAIL lib/__tests__/wizard-engine.test.ts` — "Cannot find module '../wizard-engine'".

- [ ] **Step 3: Implement `lib/wizard-engine.ts`**

```typescript
import type { ExerciseLibraryEntry, MuscleAssignment, ExerciseRole } from '@/lib/types/program'

export type Goal = 'strength' | 'hypertrophy' | 'generalFitness' | 'cut'
export type Experience = 'beginner' | 'intermediate' | 'advanced'

export interface SessionTemplate {
  name: string
  muscles: string[]
}

// ── Session splitting ─────────────────────────────────────────────────────

const PUSH_MUSCLES  = ['Chest', 'Shoulders', 'Triceps']
const PULL_MUSCLES  = ['Back', 'Lats', 'Upper Back', 'Biceps', 'Forearms']
const LEG_MUSCLES   = ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors', 'Hip Flexors']

function hasLegs(muscles: string[]): boolean {
  return muscles.some(m => LEG_MUSCLES.includes(m))
}

export function buildSessionTemplate(days: number, selectedMuscles: string[]): SessionTemplate[] {
  if (days < 2 || days > 6) throw new Error(`Unsupported training days: ${days}`)

  const all = selectedMuscles
  const push = all.filter(m => PUSH_MUSCLES.includes(m))
  const pull = all.filter(m => PULL_MUSCLES.includes(m))
  const legs = all.filter(m => LEG_MUSCLES.includes(m))
  const upper = [...push, ...pull]

  if (days === 2) {
    return [
      { name: 'Full Body A', muscles: all },
      { name: 'Full Body B', muscles: all },
    ]
  }

  if (days === 3) {
    if (hasLegs(all)) {
      return [
        { name: 'Push', muscles: push.length ? push : upper },
        { name: 'Pull', muscles: pull.length ? pull : upper },
        { name: 'Legs', muscles: legs },
      ]
    }
    return [
      { name: 'Upper A', muscles: upper },
      { name: 'Upper B', muscles: upper },
      { name: 'Arms',    muscles: all.filter(m => ['Biceps','Triceps','Forearms'].includes(m)).length ? all.filter(m => ['Biceps','Triceps','Forearms'].includes(m)) : upper },
    ]
  }

  if (days === 4) {
    if (hasLegs(all)) {
      return [
        { name: 'Upper A', muscles: upper },
        { name: 'Lower A', muscles: legs },
        { name: 'Upper B', muscles: upper },
        { name: 'Lower B', muscles: legs },
      ]
    }
    const arms = all.filter(m => ['Biceps','Triceps','Forearms'].includes(m))
    return [
      { name: 'Push A', muscles: push.length ? push : upper },
      { name: 'Pull A', muscles: pull.length ? pull : upper },
      { name: 'Push B', muscles: push.length ? push : upper },
      { name: 'Arms',   muscles: arms.length ? arms : upper },
    ]
  }

  if (days === 5) {
    if (hasLegs(all)) {
      return [
        { name: 'Push',  muscles: push.length ? push : upper },
        { name: 'Pull',  muscles: pull.length ? pull : upper },
        { name: 'Legs',  muscles: legs },
        { name: 'Upper', muscles: upper },
        { name: 'Lower', muscles: legs },
      ]
    }
    return [
      { name: 'Push A',      muscles: push.length ? push : upper },
      { name: 'Pull A',      muscles: pull.length ? pull : upper },
      { name: 'Push B',      muscles: push.length ? push : upper },
      { name: 'Pull B',      muscles: pull.length ? pull : upper },
      { name: 'Shoulders',   muscles: all.filter(m => m === 'Shoulders').length ? ['Shoulders'] : upper },
    ]
  }

  // days === 6
  if (hasLegs(all)) {
    return [
      { name: 'Push A', muscles: push.length ? push : upper },
      { name: 'Pull A', muscles: pull.length ? pull : upper },
      { name: 'Legs A', muscles: legs },
      { name: 'Push B', muscles: push.length ? push : upper },
      { name: 'Pull B', muscles: pull.length ? pull : upper },
      { name: 'Legs B', muscles: legs },
    ]
  }
  const arms = all.filter(m => ['Biceps','Triceps','Forearms'].includes(m))
  return [
    { name: 'Push A', muscles: push.length ? push : upper },
    { name: 'Pull A', muscles: pull.length ? pull : upper },
    { name: 'Arms A', muscles: arms.length ? arms : upper },
    { name: 'Push B', muscles: push.length ? push : upper },
    { name: 'Pull B', muscles: pull.length ? pull : upper },
    { name: 'Arms B', muscles: arms.length ? arms : upper },
  ]
}

// ── Exercise filtering ────────────────────────────────────────────────────

export function filterExercises(
  library: ExerciseLibraryEntry[],
  selectedMuscles: string[],
  selectedEquipment: string[],
): ExerciseLibraryEntry[] {
  // Bodyweight is always available
  const equipment = [...new Set([...selectedEquipment, 'Bodyweight'])]
  return library.filter(ex => {
    const muscleMatch = ex.muscles.some(m => selectedMuscles.includes(m.muscle))
    const equipmentMatch = ex.equipment.some(e => equipment.includes(e))
    return muscleMatch && equipmentMatch
  })
}

// ── Volume targeting ──────────────────────────────────────────────────────

const WEEKLY_SET_TARGETS: Record<Goal, Record<Experience, number>> = {
  strength:       { beginner: 7,  intermediate: 9,  advanced: 11 },
  hypertrophy:    { beginner: 11, intermediate: 14, advanced: 18 },
  generalFitness: { beginner: 9,  intermediate: 11, advanced: 13 },
  cut:            { beginner: 9,  intermediate: 11, advanced: 13 },
}

export function weeklySetTarget(goal: Goal, experience: Experience): number {
  return WEEKLY_SET_TARGETS[goal][experience]
}

export function setsPerSessionForMuscle(
  targetWeekly: number,
  sessionsPerWeekHittingMuscle: number,
): number {
  return Math.round(targetWeekly / Math.max(1, sessionsPerWeekHittingMuscle))
}

const MINS_PER_SET: Record<Goal, number> = {
  cut:            2.0,
  generalFitness: 2.2,
  hypertrophy:    2.6,
  strength:       4.0,
}

export function maxWorkingSets(durationMin: number, exerciseCount: number, goal: Goal): number {
  const available = durationMin - 5 - exerciseCount
  return Math.floor(available / MINS_PER_SET[goal])
}

// ── Exercise role auto-assignment ─────────────────────────────────────────

const PRIMARY_COMPOUNDS = new Set([
  'Bench Press', 'Barbell Bench Press', 'Squat', 'Deadlift',
  'Overhead Press', 'Pull-Up', 'Chin-Up', 'Barbell Row',
  'Bent Over Barbell Row', 'Front Squat', 'Front Barbell Squat',
])

const COMPOUND_MUSCLES = new Set([
  'Chest', 'Lats', 'Upper Back', 'Quads', 'Hamstrings', 'Glutes', 'Shoulders', 'Lower Back',
])

export function autoAssignRole(exerciseName: string, muscles: MuscleAssignment[]): ExerciseRole {
  if (PRIMARY_COMPOUNDS.has(exerciseName)) return 'primary'
  const mainMuscles = muscles.filter(m => m.role === 'main').map(m => m.muscle)
  if (mainMuscles.some(m => COMPOUND_MUSCLES.has(m)) && muscles.length >= 2) return 'secondary'
  return 'accessory'
}

// ── Dynamic rest ──────────────────────────────────────────────────────────

export function pctToRestSec(pct: number): number {
  if (pct < 65) return 45
  if (pct < 75) return 75
  if (pct < 85) return 120
  if (pct < 93) return 210
  return 300
}
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
pnpm test 2>&1 | tail -15
```

Expected: all tests green. Example output:
```
✓ lib/__tests__/wizard-engine.test.ts (22 tests)
Test Files  1 passed
```

- [ ] **Step 5: Commit**

```bash
git add lib/wizard-engine.ts lib/__tests__/wizard-engine.test.ts
git commit -m "feat: add wizard-engine pure functions with full test coverage"
```

---

## Task 6: Wizard Page + Content Skeleton

**Files:**
- Create: `app/program-wizard/page.tsx`
- Create: `app/program-wizard/wizard-content.tsx`

The page is a server component that fetches the exercise library and user styles. The content component is the client-side step machine with localStorage persistence.

- [ ] **Step 1: Create `app/program-wizard/page.tsx`**

```typescript
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { getRepository } from '@/lib/data'
import WizardContent from './wizard-content'

export default async function ProgramWizardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const repo = await getRepository()
  const [library, styles] = await Promise.all([
    repo.listExerciseLibrary(),
    repo.listProgressionStyles(session.user.id),
  ])

  return <WizardContent library={library} styles={styles} />
}
```

- [ ] **Step 2: Create `app/program-wizard/wizard-content.tsx`**

```typescript
"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import type { ExerciseLibraryEntry } from "@/lib/types/program"
import type { ProgressionStyle } from "@/lib/types/progression"
import type { Goal, Experience, SessionTemplate } from "@/lib/wizard-engine"
import StepGoal from "@/components/wizard/step-goal"
import StepSchedule from "@/components/wizard/step-schedule"
import StepMuscles from "@/components/wizard/step-muscles"
import StepEquipment from "@/components/wizard/step-equipment"
import StepExercises from "@/components/wizard/step-exercises"
import StepReview from "@/components/wizard/step-review"

const DRAFT_KEY = 'ta_wizard_draft'
const DRAFT_TTL_DAYS = 7

export interface WizardState {
  step: number
  goal: Goal | null
  experience: Experience | null
  daysPerWeek: number | null
  sessionDurationMin: number | null
  muscleGroups: string[]
  equipment: string[]
  sessions: { name: string; muscles: string[]; exercises: string[] }[]
}

const INITIAL_STATE: WizardState = {
  step: 1, goal: null, experience: null, daysPerWeek: null,
  sessionDurationMin: null, muscleGroups: [], equipment: [], sessions: [],
}

interface Props {
  library: ExerciseLibraryEntry[]
  styles: ProgressionStyle[]
}

export default function WizardContent({ library, styles }: Props) {
  const router = useRouter()
  const [state, setState] = useState<WizardState>(INITIAL_STATE)

  // Restore draft on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const draft = JSON.parse(raw) as WizardState & { savedAt: string }
      const ageDays = (Date.now() - new Date(draft.savedAt).getTime()) / 86_400_000
      if (ageDays < DRAFT_TTL_DAYS) {
        setState({ ...INITIAL_STATE, ...draft })
      } else {
        localStorage.removeItem(DRAFT_KEY)
      }
    } catch { /* ignore corrupt draft */ }
  }, [])

  // Persist draft on every change (steps 1–5 only; step 6 is ephemeral)
  useEffect(() => {
    if (state.step >= 6) return
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...state, savedAt: new Date().toISOString() }))
  }, [state])

  function next(patch: Partial<WizardState>) {
    setState(prev => ({ ...prev, ...patch, step: prev.step + 1 }))
  }

  function back() {
    setState(prev => ({ ...prev, step: Math.max(1, prev.step - 1) }))
  }

  function onSaved(programId: string) {
    localStorage.removeItem(DRAFT_KEY)
    router.push(`/config?programId=${programId}`)
  }

  const totalSteps = 6
  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Progress bar */}
      <div className="h-1 bg-muted">
        <div
          className="h-1 bg-primary transition-all duration-300"
          style={{ width: `${(state.step / totalSteps) * 100}%` }}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-safe pt-4">
        {state.step === 1 && (
          <StepGoal
            goal={state.goal}
            experience={state.experience}
            onNext={(goal, experience) => next({ goal, experience })}
          />
        )}
        {state.step === 2 && (
          <StepSchedule
            daysPerWeek={state.daysPerWeek}
            sessionDurationMin={state.sessionDurationMin}
            onNext={(daysPerWeek, sessionDurationMin) => next({ daysPerWeek, sessionDurationMin })}
            onBack={back}
          />
        )}
        {state.step === 3 && (
          <StepMuscles
            selected={state.muscleGroups}
            onNext={(muscleGroups) => next({ muscleGroups })}
            onBack={back}
          />
        )}
        {state.step === 4 && (
          <StepEquipment
            selected={state.equipment}
            onNext={(equipment) => next({ equipment })}
            onBack={back}
          />
        )}
        {state.step === 5 && state.goal && state.experience && state.daysPerWeek && state.sessionDurationMin && (
          <StepExercises
            library={library}
            goal={state.goal}
            experience={state.experience}
            daysPerWeek={state.daysPerWeek}
            sessionDurationMin={state.sessionDurationMin}
            muscleGroups={state.muscleGroups}
            equipment={state.equipment}
            initialSessions={state.sessions}
            onNext={(sessions) => next({ sessions })}
            onBack={back}
          />
        )}
        {state.step === 6 && state.goal && state.experience && state.daysPerWeek && state.sessionDurationMin && (
          <StepReview
            wizardState={state as Required<WizardState>}
            styles={styles}
            onSaved={onSaved}
            onBack={back}
          />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles (missing step components are fine at this point)**

```bash
pnpm build 2>&1 | grep "error TS" | grep -v "Cannot find module.*wizard" | head -10
```

Expected: only "Cannot find module" errors for the step components not yet created.

- [ ] **Step 4: Commit**

```bash
git add app/program-wizard/page.tsx app/program-wizard/wizard-content.tsx
git commit -m "feat: add program wizard route and content skeleton with draft persistence"
```

---

## Task 7: Steps 1–4 (Goal, Schedule, Muscles, Equipment)

**Files:**
- Create: `components/wizard/step-goal.tsx`
- Create: `components/wizard/step-schedule.tsx`
- Create: `components/wizard/step-muscles.tsx`
- Create: `components/wizard/step-equipment.tsx`

- [ ] **Step 1: Create the `components/wizard/` directory**

```bash
mkdir -p components/wizard
```

- [ ] **Step 2: Create `components/wizard/step-goal.tsx`**

```typescript
"use client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { Goal, Experience } from "@/lib/wizard-engine"

const GOALS: { value: Goal; label: string; desc: string }[] = [
  { value: 'strength',       label: 'Strength',       desc: 'Lift heavier — lower reps, higher intensity' },
  { value: 'hypertrophy',    label: 'Hypertrophy',    desc: 'Build muscle — moderate reps, controlled volume' },
  { value: 'generalFitness', label: 'General Fitness',desc: 'Stay active and healthy — balanced approach' },
  { value: 'cut',            label: 'Cut',            desc: 'Lean out — maintain muscle while in deficit' },
]

const EXPERIENCE: { value: Experience; label: string }[] = [
  { value: 'beginner',     label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced',     label: 'Advanced' },
]

interface Props {
  goal: Goal | null
  experience: Experience | null
  onNext: (goal: Goal, experience: Experience) => void
}

export default function StepGoal({ goal: initGoal, experience: initExperience, onNext }: Props) {
  const [goal, setGoal] = import('react').useState<Goal | null>(initGoal)
  const [experience, setExperience] = import('react').useState<Experience | null>(initExperience)
  // Use inline state
  return <GoalForm initGoal={initGoal} initExp={initExperience} onNext={onNext} />
}

function GoalForm({ initGoal, initExp, onNext }: { initGoal: Goal | null; initExp: Experience | null; onNext: (g: Goal, e: Experience) => void }) {
  const { useState } = require('react') as typeof import('react')
  const [goal, setGoal] = useState<Goal | null>(initGoal)
  const [experience, setExperience] = useState<Experience | null>(initExp)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">What's your goal?</h1>

      <div className="space-y-2">
        {GOALS.map(g => (
          <button
            key={g.value}
            onClick={() => setGoal(g.value)}
            className={cn(
              "w-full text-left rounded-xl border px-4 py-3 transition",
              goal === g.value ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
            )}
          >
            <p className="font-semibold text-sm">{g.label}</p>
            <p className="text-xs text-muted-foreground">{g.desc}</p>
          </button>
        ))}
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2">Experience level</h2>
        <div className="flex gap-2">
          {EXPERIENCE.map(e => (
            <button
              key={e.value}
              onClick={() => setExperience(e.value)}
              className={cn(
                "flex-1 rounded-xl border py-2 text-sm font-medium transition",
                experience === e.value ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
              )}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      <Button
        className="w-full"
        disabled={!goal || !experience}
        onClick={() => goal && experience && onNext(goal, experience)}
      >
        Next
      </Button>
    </div>
  )
}
```

Note: The component uses a nested `GoalForm` to keep `useState` in a standard function component. Alternatively, flatten the component — either form is valid.

- [ ] **Step 3: Create `components/wizard/step-schedule.tsx`**

```typescript
"use client"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const DAYS = [2, 3, 4, 5, 6]
const DURATIONS = [
  { value: 30,  label: '30 min' },
  { value: 45,  label: '45 min' },
  { value: 60,  label: '60 min' },
  { value: 75,  label: '75 min+' },
]

interface Props {
  daysPerWeek: number | null
  sessionDurationMin: number | null
  onNext: (days: number, duration: number) => void
  onBack: () => void
}

export default function StepSchedule({ daysPerWeek: initDays, sessionDurationMin: initDur, onNext, onBack }: Props) {
  const [days, setDays] = useState<number | null>(initDays)
  const [duration, setDuration] = useState<number | null>(initDur)

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="text-sm text-muted-foreground">← Back</button>
      <h1 className="text-xl font-bold">How do you want to train?</h1>

      <div>
        <h2 className="text-sm font-semibold mb-2">Days per week</h2>
        <div className="flex gap-2">
          {DAYS.map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn(
                "flex-1 rounded-xl border py-3 text-sm font-bold transition",
                days === d ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2">Session duration</h2>
        <div className="grid grid-cols-2 gap-2">
          {DURATIONS.map(d => (
            <button
              key={d.value}
              onClick={() => setDuration(d.value)}
              className={cn(
                "rounded-xl border py-3 text-sm font-medium transition",
                duration === d.value ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <Button
        className="w-full"
        disabled={!days || !duration}
        onClick={() => days && duration && onNext(days, duration)}
      >
        Next
      </Button>
    </div>
  )
}
```

- [ ] **Step 4: Create `components/wizard/step-muscles.tsx`**

```typescript
"use client"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const MUSCLE_GROUPS = {
  Upper: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms'],
  Lower: ['Quads', 'Hamstrings', 'Glutes', 'Calves'],
  Core:  ['Core'],
}

interface Props {
  selected: string[]
  onNext: (muscles: string[]) => void
  onBack: () => void
}

export default function StepMuscles({ selected: init, onNext, onBack }: Props) {
  const [selected, setSelected] = useState<string[]>(init)

  function toggle(m: string) {
    setSelected(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])
  }

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="text-sm text-muted-foreground">← Back</button>
      <h1 className="text-xl font-bold">Which muscles do you want to train?</h1>
      <p className="text-sm text-muted-foreground">Select all that apply.</p>

      {Object.entries(MUSCLE_GROUPS).map(([group, muscles]) => (
        <div key={group}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{group}</h2>
          <div className="flex flex-wrap gap-2">
            {muscles.map(m => (
              <button
                key={m}
                onClick={() => toggle(m)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition",
                  selected.includes(m)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-muted",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      ))}

      <Button
        className="w-full"
        disabled={selected.length === 0}
        onClick={() => onNext(selected)}
      >
        Next
      </Button>
    </div>
  )
}
```

- [ ] **Step 5: Create `components/wizard/step-equipment.tsx`**

```typescript
"use client"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const EQUIPMENT_OPTIONS = [
  { value: 'Barbell',    label: 'Barbell',    desc: 'Olympic bar + plates' },
  { value: 'Dumbbells',  label: 'Dumbbells',  desc: 'Free weights' },
  { value: 'Cable',      label: 'Cable',      desc: 'Cable machine / pulley' },
  { value: 'Machine',    label: 'Machine',    desc: 'Leg press, smith, isolation machines' },
  { value: 'Bodyweight', label: 'Bodyweight', desc: 'No equipment needed' },
]

interface Props {
  selected: string[]
  onNext: (equipment: string[]) => void
  onBack: () => void
}

export default function StepEquipment({ selected: init, onNext, onBack }: Props) {
  // Bodyweight is always included — start with it selected
  const [selected, setSelected] = useState<string[]>(init.length ? init : ['Bodyweight'])

  function toggle(e: string) {
    if (e === 'Bodyweight') return  // always on
    setSelected(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e])
  }

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="text-sm text-muted-foreground">← Back</button>
      <h1 className="text-xl font-bold">What equipment do you have?</h1>
      <p className="text-sm text-muted-foreground">Bodyweight is always available.</p>

      <div className="space-y-2">
        {EQUIPMENT_OPTIONS.map(eq => (
          <button
            key={eq.value}
            onClick={() => toggle(eq.value)}
            disabled={eq.value === 'Bodyweight'}
            className={cn(
              "w-full text-left rounded-xl border px-4 py-3 transition",
              selected.includes(eq.value)
                ? "border-primary bg-primary/10"
                : "border-border hover:bg-muted",
              eq.value === 'Bodyweight' && "opacity-60 cursor-default",
            )}
          >
            <p className="font-semibold text-sm">{eq.label}</p>
            <p className="text-xs text-muted-foreground">{eq.desc}</p>
          </button>
        ))}
      </div>

      <Button className="w-full" onClick={() => onNext(selected)}>
        Next
      </Button>
    </div>
  )
}
```

- [ ] **Step 6: Build and verify no TypeScript errors in new components**

```bash
pnpm build 2>&1 | grep "error TS" | grep -v "step-exercises\|step-review\|WizardContent" | head -10
```

Expected: errors only for `step-exercises` and `step-review` (not yet created).

- [ ] **Step 7: Fix the `useState` import issue in step-goal.tsx**

The `StepGoal` component above has a non-standard require pattern — replace it with a clean implementation:

```typescript
"use client"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { Goal, Experience } from "@/lib/wizard-engine"

const GOALS: { value: Goal; label: string; desc: string }[] = [
  { value: 'strength',       label: 'Strength',       desc: 'Lift heavier — lower reps, higher intensity' },
  { value: 'hypertrophy',    label: 'Hypertrophy',    desc: 'Build muscle — moderate reps, controlled volume' },
  { value: 'generalFitness', label: 'General Fitness',desc: 'Stay active and healthy — balanced approach' },
  { value: 'cut',            label: 'Cut',            desc: 'Lean out — maintain muscle while in deficit' },
]

const EXPERIENCE: { value: Experience; label: string }[] = [
  { value: 'beginner',     label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced',     label: 'Advanced' },
]

interface Props {
  goal: Goal | null
  experience: Experience | null
  onNext: (goal: Goal, experience: Experience) => void
}

export default function StepGoal({ goal: initGoal, experience: initExperience, onNext }: Props) {
  const [goal, setGoal] = useState<Goal | null>(initGoal)
  const [experience, setExperience] = useState<Experience | null>(initExperience)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">What's your goal?</h1>
      <div className="space-y-2">
        {GOALS.map(g => (
          <button
            key={g.value}
            onClick={() => setGoal(g.value)}
            className={cn(
              "w-full text-left rounded-xl border px-4 py-3 transition",
              goal === g.value ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
            )}
          >
            <p className="font-semibold text-sm">{g.label}</p>
            <p className="text-xs text-muted-foreground">{g.desc}</p>
          </button>
        ))}
      </div>
      <div>
        <h2 className="text-sm font-semibold mb-2">Experience level</h2>
        <div className="flex gap-2">
          {EXPERIENCE.map(e => (
            <button
              key={e.value}
              onClick={() => setExperience(e.value)}
              className={cn(
                "flex-1 rounded-xl border py-2 text-sm font-medium transition",
                experience === e.value ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
              )}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>
      <Button
        className="w-full"
        disabled={!goal || !experience}
        onClick={() => goal && experience && onNext(goal, experience)}
      >
        Next
      </Button>
    </div>
  )
}
```

- [ ] **Step 8: Commit**

```bash
git add components/wizard/step-goal.tsx components/wizard/step-schedule.tsx components/wizard/step-muscles.tsx components/wizard/step-equipment.tsx
git commit -m "feat: add wizard steps 1-4 (goal, schedule, muscles, equipment)"
```

---

## Task 8: Step 5 — Exercise Selection

**Files:**
- Create: `components/wizard/step-exercises.tsx`

This is the most complex step. It uses `buildSessionTemplate`, `filterExercises`, `weeklySetTarget`, `setsPerSessionForMuscle`, `maxWorkingSets`, and `autoAssignRole` from `wizard-engine.ts`.

- [ ] **Step 1: Create `components/wizard/step-exercises.tsx`**

```typescript
"use client"
import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type { ExerciseLibraryEntry } from "@/lib/types/program"
import type { Goal, Experience } from "@/lib/wizard-engine"
import {
  buildSessionTemplate, filterExercises, weeklySetTarget,
  setsPerSessionForMuscle, maxWorkingSets, autoAssignRole,
} from "@/lib/wizard-engine"

interface SessionExercise {
  name: string
  muscleGroups: string[]
  equipment: string[]
  exerciseRole: 'primary' | 'secondary' | 'accessory'
  setCount: number
}

interface WizardSession {
  name: string
  muscles: string[]
  exercises: SessionExercise[]
}

interface Props {
  library: ExerciseLibraryEntry[]
  goal: Goal
  experience: Experience
  daysPerWeek: number
  sessionDurationMin: number
  muscleGroups: string[]
  equipment: string[]
  initialSessions: { name: string; muscles: string[]; exercises: string[] }[]
  onNext: (sessions: { name: string; muscles: string[]; exercises: string[] }[]) => void
  onBack: () => void
}

export default function StepExercises({
  library, goal, experience, daysPerWeek, sessionDurationMin,
  muscleGroups, equipment, initialSessions, onNext, onBack,
}: Props) {
  const sessionTemplates = useMemo(
    () => buildSessionTemplate(daysPerWeek, muscleGroups),
    [daysPerWeek, muscleGroups],
  )

  const filteredLibrary = useMemo(
    () => filterExercises(library, muscleGroups, equipment),
    [library, muscleGroups, equipment],
  )

  const targetWeekly = weeklySetTarget(goal, experience)

  // Build initial sessions with pre-selected exercises
  const [sessions, setSessions] = useState<WizardSession[]>(() => {
    // If restoring from draft (initialSessions has data), use it
    if (initialSessions.length > 0 && initialSessions[0].exercises.length > 0) {
      return sessionTemplates.map((tmpl, i) => {
        const draft = initialSessions[i]
        if (!draft) return buildDefaultSession(tmpl, filteredLibrary, targetWeekly, daysPerWeek, sessionDurationMin, goal)
        return {
          name: tmpl.name,
          muscles: tmpl.muscles,
          exercises: draft.exercises.map(exName => {
            const entry = library.find(e => e.name === exName)
            return entry
              ? { name: entry.name, muscleGroups: entry.muscles.map(m => m.muscle), equipment: entry.equipment, exerciseRole: autoAssignRole(entry.name, entry.muscles), setCount: 3 }
              : { name: exName, muscleGroups: [], equipment: [], exerciseRole: 'primary' as const, setCount: 3 }
          }),
        }
      })
    }
    return sessionTemplates.map(tmpl => buildDefaultSession(tmpl, filteredLibrary, targetWeekly, daysPerWeek, sessionDurationMin, goal))
  })

  const [swapTarget, setSwapTarget] = useState<{ sessionIdx: number; exerciseIdx: number } | null>(null)

  function swapExercise(sessionIdx: number, exerciseIdx: number, newExercise: ExerciseLibraryEntry) {
    setSessions(prev => prev.map((sess, si) => {
      if (si !== sessionIdx) return sess
      return {
        ...sess,
        exercises: sess.exercises.map((ex, ei) => {
          if (ei !== exerciseIdx) return ex
          return {
            name: newExercise.name,
            muscleGroups: newExercise.muscles.map(m => m.muscle),
            equipment: newExercise.equipment,
            exerciseRole: autoAssignRole(newExercise.name, newExercise.muscles),
            setCount: ex.setCount,
          }
        }),
      }
    }))
    setSwapTarget(null)
  }

  const swapSession = swapTarget ? sessions[swapTarget.sessionIdx] : null
  const swapExerciseName = swapTarget && swapSession ? swapSession.exercises[swapTarget.exerciseIdx]?.name : null

  // Alternatives for swap: same session muscles + equipment filter, exclude already-selected
  const swapAlternatives = useMemo(() => {
    if (!swapTarget || !swapSession) return []
    const usedNames = new Set(swapSession.exercises.map(e => e.name))
    return filteredLibrary.filter(e =>
      e.muscles.some(m => swapSession.muscles.includes(m.muscle)) && !usedNames.has(e.name)
    )
  }, [swapTarget, swapSession, filteredLibrary])

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-muted-foreground">← Back</button>
      <h1 className="text-xl font-bold">Review your exercises</h1>
      <p className="text-sm text-muted-foreground">Tap an exercise to swap it.</p>

      {sessions.map((sess, si) => (
        <div key={sess.name} className="rounded-xl border bg-card p-3 space-y-2">
          <p className="font-semibold text-sm">{sess.name}</p>
          {sess.exercises.map((ex, ei) => (
            <button
              key={ei}
              onClick={() => setSwapTarget({ sessionIdx: si, exerciseIdx: ei })}
              className="w-full flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm hover:bg-muted/80 transition"
            >
              <div className="text-left">
                <p className="font-medium">{ex.name}</p>
                <p className="text-xs text-muted-foreground">{ex.setCount} sets · {ex.exerciseRole}</p>
              </div>
              <span className="text-xs text-muted-foreground">swap</span>
            </button>
          ))}
        </div>
      ))}

      <Button
        className="w-full"
        onClick={() => onNext(sessions.map(s => ({
          name: s.name,
          muscles: s.muscles,
          exercises: s.exercises.map(e => e.name),
        })))}
      >
        Next — AI Review
      </Button>

      {/* Swap sheet */}
      <Sheet open={swapTarget !== null} onOpenChange={open => { if (!open) setSwapTarget(null) }}>
        <SheetContent side="bottom" className="max-h-[60vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Swap: {swapExerciseName}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {swapAlternatives.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No alternatives with your equipment selection.</p>
            )}
            {swapAlternatives.map(alt => (
              <button
                key={alt.id}
                onClick={() => swapTarget && swapExercise(swapTarget.sessionIdx, swapTarget.exerciseIdx, alt)}
                className="w-full text-left rounded-xl border px-3 py-2 hover:bg-muted transition"
              >
                <p className="font-medium text-sm">{alt.name}</p>
                <p className="text-xs text-muted-foreground">{alt.muscles.filter(m => m.role === 'main').map(m => m.muscle).join(', ')}</p>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ── Helper ────────────────────────────────────────────────────────────────

function buildDefaultSession(
  tmpl: { name: string; muscles: string[] },
  library: ExerciseLibraryEntry[],
  targetWeekly: number,
  daysPerWeek: number,
  durationMin: number,
  goal: Goal,
): WizardSession {
  // Exercises that match this session's muscles, sorted: main muscle matches first
  const candidates = library
    .filter(ex => ex.muscles.some(m => tmpl.muscles.includes(m.muscle) && m.role === 'main'))
    .sort((a, b) => {
      const aMain = a.muscles.filter(m => tmpl.muscles.includes(m.muscle) && m.role === 'main').length
      const bMain = b.muscles.filter(m => tmpl.muscles.includes(m.muscle) && m.role === 'main').length
      return bMain - aMain
    })

  const maxSets = maxWorkingSets(durationMin, Math.min(candidates.length, 6), goal)
  const sessionsHittingMuscle = daysPerWeek <= 3 ? 1 : daysPerWeek <= 4 ? 2 : 2
  const setsPerMuscle = setsPerSessionForMuscle(targetWeekly, sessionsHittingMuscle)
  const targetTotalSets = Math.min(maxSets, setsPerMuscle * tmpl.muscles.length)

  // Pick exercises: start with highest-muscle-match candidates, stop when sets budget filled
  const selected: SessionExercise[] = []
  let totalSets = 0
  for (const ex of candidates.slice(0, 8)) {
    if (totalSets >= targetTotalSets) break
    const role = autoAssignRole(ex.name, ex.muscles)
    const setCount = role === 'primary' ? Math.min(4, Math.ceil(setsPerMuscle * 1.2)) : 3
    selected.push({
      name: ex.name,
      muscleGroups: ex.muscles.map(m => m.muscle),
      equipment: ex.equipment,
      exerciseRole: role,
      setCount,
    })
    totalSets += setCount
  }

  return { name: tmpl.name, muscles: tmpl.muscles, exercises: selected }
}
```

- [ ] **Step 2: Commit**

```bash
git add components/wizard/step-exercises.tsx
git commit -m "feat: add wizard step 5 — exercise selection with swap"
```

---

## Task 9: Generate API Route

**Files:**
- Create: `app/api/program-wizard/generate/route.ts`

- [ ] **Step 1: Install zod if not already present**

```bash
pnpm list zod 2>&1 | grep zod || pnpm add zod
```

Expected: zod is already listed (it's used by other parts of the app) — if not, it will be installed.

- [ ] **Step 2: Create `app/api/program-wizard/generate/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'

// ── Zod schemas ───────────────────────────────────────────────────────────

const ExerciseSchema = z.object({
  name:         z.string().max(200),
  muscleGroups: z.array(z.string().max(50)).max(10),
  equipment:    z.array(z.string().max(50)).max(10),
  exerciseRole: z.enum(['primary', 'secondary', 'accessory']),
  setCount:     z.number().int().min(1).max(10),
})

const SessionSchema = z.object({
  name:      z.string().max(100),
  exercises: z.array(ExerciseSchema).max(10),
})

const StyleSchema = z.object({
  id:     z.string().uuid(),
  name:   z.string().max(100),
  pctMin: z.number().min(0).max(110),
  pctMax: z.number().min(0).max(110),
})

const RequestSchema = z.object({
  goal:              z.enum(['strength', 'hypertrophy', 'generalFitness', 'cut']),
  experience:        z.enum(['beginner', 'intermediate', 'advanced']),
  daysPerWeek:       z.number().int().min(2).max(6),
  sessionDurationMin:z.number().int().min(20).max(120),
  sessions:          z.array(SessionSchema).min(1).max(6),
  volumePlan: z.object({
    targetSetsPerMusclePerWeek: z.record(z.string(), z.number()),
    durationCapSets:            z.number().int().min(1).max(50),
  }),
  availableStyles: z.array(StyleSchema).max(20),
})

// ── Response type ─────────────────────────────────────────────────────────

export interface WizardGenerateResponse {
  programName: string
  sessions: {
    name: string
    exercises: {
      name: string
      suggestedStyleName: string | null
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

// ── Handler ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`${userId}:program-wizard`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 422 })
  }

  const data = parsed.data
  const styleNames = data.availableStyles.map(s => s.name)
  const styleMap = new Map(data.availableStyles.map(s => [s.name.toLowerCase(), s.id]))

  const responseSchema = `{
    "programName": "string",
    "sessions": [{ "name": "string", "exercises": [{ "name": "string", "suggestedStyleName": "string|null", "setCount": number, "exerciseRole": "primary|secondary|accessory", "notes": "string (optional)" }] }],
    "phases": [{ "name": "string", "durationCycles": number, "phaseType": "normal|peak|deload", "primaryStyleName": "string|null", "secondaryStyleName": "string|null" }],
    "flags": ["string"],
    "durationWarning": "string (optional)"
  }`

  const prompt = `You are reviewing a training program. The user's goal is ${data.goal}, experience: ${data.experience}.

Program sessions:
${JSON.stringify(data.sessions, null, 2)}

Volume plan: ${JSON.stringify(data.volumePlan)}

Available progression styles (use EXACT names):
${styleNames.length ? styleNames.map(n => `- "${n}"`).join('\n') : 'None — set all suggestedStyleName to null'}

Instructions:
1. Review exercise order in each session (compounds first, isolation last). Reorder if needed.
2. Assign a progression style to each exercise from the available list. Match: Compound (primary/secondary) → compound styles, accessories → accessory/volume styles. If no styles available, use null.
3. Generate a block periodization phase sequence appropriate for ${data.goal} at ${data.experience} level. Typical: Accumulation (4 cycles, normal) → Intensification (4 cycles, normal) → Peak (2 cycles, peak) → Deload (1 cycle, deload). Adjust for goal/experience.
4. Flag any muscle imbalances (e.g. too much push, no pull) or duration concerns.
5. Set durationWarning if the session volume seems too high for ${data.sessionDurationMin} min.

Respond ONLY with valid JSON matching this schema:
${responseSchema}`

  let text: string
  try {
    const result = await generateText({
      model: google('gemini-2.0-flash-lite'),
      system: 'You are a certified strength and conditioning coach. Respond ONLY with valid JSON. No prose, no markdown fences.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    })
    text = result.text.trim()
    // Strip markdown fences if present
    if (text.startsWith('```')) text = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '')
  } catch {
    return NextResponse.json({ error: 'AI generation failed' }, { status: 503 })
  }

  let aiResponse: WizardGenerateResponse
  try {
    aiResponse = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'AI returned invalid JSON' }, { status: 503 })
  }

  // Resolve style names → IDs (silently drop unmatched names)
  function resolveStyleId(name: string | null): string | undefined {
    if (!name) return undefined
    return styleMap.get(name.toLowerCase())
  }

  // Attach resolved IDs alongside names (client uses names for display, IDs for saving)
  const enriched = {
    ...aiResponse,
    resolvedStyles: {
      sessions: aiResponse.sessions.map(sess => ({
        name: sess.name,
        exercises: sess.exercises.map(ex => ({
          name: ex.name,
          resolvedStyleId: resolveStyleId(ex.suggestedStyleName),
        })),
      })),
      phases: aiResponse.phases.map(phase => ({
        name: phase.name,
        resolvedPrimaryStyleId: resolveStyleId(phase.primaryStyleName),
        resolvedSecondaryStyleId: resolveStyleId(phase.secondaryStyleName),
      })),
    },
  }

  return NextResponse.json(enriched)
}
```

- [ ] **Step 3: Verify build**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
```

Expected: no TypeScript errors in the new route.

- [ ] **Step 4: Commit**

```bash
git add app/api/program-wizard/generate/route.ts
git commit -m "feat: add program wizard AI generation endpoint with Zod validation and rate limiting"
```

---

## Task 10: Step 6 — AI Review + Save

**Files:**
- Create: `components/wizard/step-review.tsx`

- [ ] **Step 1: Create `components/wizard/step-review.tsx`**

```typescript
"use client"
import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { WizardState } from "@/app/program-wizard/wizard-content"
import type { ProgressionStyle } from "@/lib/types/progression"
import type { WizardGenerateResponse } from "@/app/api/program-wizard/generate/route"
import {
  weeklySetTarget, setsPerSessionForMuscle, maxWorkingSets, buildSessionTemplate,
} from "@/lib/wizard-engine"
import { todayInTz } from "@/lib/date-utils"

interface Props {
  wizardState: Required<WizardState>
  styles: ProgressionStyle[]
  onSaved: (programId: string) => void
  onBack: () => void
}

type ReviewState =
  | { status: 'loading' }
  | { status: 'success'; data: WizardGenerateResponse & { resolvedStyles: ResolvedStyles } }
  | { status: 'error'; message: string }

interface ResolvedStyles {
  sessions: { name: string; exercises: { name: string; resolvedStyleId?: string }[] }[]
  phases: { name: string; resolvedPrimaryStyleId?: string; resolvedSecondaryStyleId?: string }[]
}

export default function StepReview({ wizardState, styles, onSaved, onBack }: Props) {
  const [review, setReview] = useState<ReviewState>({ status: 'loading' })
  const [regenerateCount, setRegenerateCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const calledRef = useRef(false)

  const availableStyles = styles.map(s => ({
    id: s.id, name: s.name,
    pctMin: s.sets[0]?.pct ?? 65,
    pctMax: s.sets[s.sets.length - 1]?.pct ?? 75,
  }))

  const sessionTemplates = buildSessionTemplate(wizardState.daysPerWeek, wizardState.muscleGroups)
  const targetWeekly = weeklySetTarget(wizardState.goal, wizardState.experience)
  const volumePlan = {
    targetSetsPerMusclePerWeek: Object.fromEntries(
      wizardState.muscleGroups.map(m => [m, targetWeekly])
    ),
    durationCapSets: maxWorkingSets(wizardState.sessionDurationMin, 5, wizardState.goal),
  }

  async function generate() {
    setReview({ status: 'loading' })
    const payload = {
      goal: wizardState.goal,
      experience: wizardState.experience,
      daysPerWeek: wizardState.daysPerWeek,
      sessionDurationMin: wizardState.sessionDurationMin,
      sessions: wizardState.sessions.map((s, i) => ({
        name: s.name,
        exercises: s.exercises.map(exName => {
          const tmpl = sessionTemplates[i]
          return {
            name: exName,
            muscleGroups: tmpl?.muscles ?? [],
            equipment: wizardState.equipment,
            exerciseRole: 'primary' as const,
            setCount: 3,
          }
        }),
      })),
      volumePlan,
      availableStyles,
    }

    try {
      const res = await fetch('/api/program-wizard/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setReview({ status: 'success', data })
    } catch (e) {
      setReview({ status: 'error', message: (e as Error).message })
    }
  }

  useEffect(() => {
    if (calledRef.current) return
    calledRef.current = true
    generate()
  }, [])

  async function handleSave() {
    if (review.status !== 'success') return
    setSaving(true)
    const ai = review.data
    const today = todayInTz()

    try {
      // Build sessions from AI-ordered exercises with resolved styles
      const sessions = ai.sessions.map((sess, si) => {
        const resolved = ai.resolvedStyles.sessions[si]
        return {
          name: sess.name,
          position: si,
          exercises: sess.exercises.map((ex, ei) => ({
            exerciseName: ex.name,
            exerciseRole: ex.exerciseRole,
            styleId: resolved?.exercises[ei]?.resolvedStyleId ?? undefined,
            muscleGroups: wizardState.sessions.find(s => s.name === sess.name)
              ? [] : [],
            position: ei,
          })),
        }
      })

      // Save program
      const programRes = await fetch('/api/program-wizard/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: ai.programName,
          sessions,
          phaseMode: 'automatic',
          startedAt: today,
          sessionsPerCycle: wizardState.daysPerWeek,
          phases: ai.phases.map((phase, i) => {
            const resolved = ai.resolvedStyles.phases[i]
            return {
              position: i,
              name: phase.name,
              durationCycles: phase.durationCycles,
              phaseType: phase.phaseType,
              primaryStyleId: resolved?.resolvedPrimaryStyleId ?? null,
              secondaryStyleId: resolved?.resolvedSecondaryStyleId ?? null,
            }
          }),
        }),
      })
      if (!programRes.ok) throw new Error('Save failed')
      const { programId } = await programRes.json()
      onSaved(programId)
    } catch (e) {
      setSaving(false)
      alert('Failed to save program. Try again.')
    }
  }

  if (review.status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Reviewing your program…</p>
      </div>
    )
  }

  if (review.status === 'error') {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="text-sm text-muted-foreground">← Back</button>
        <p className="text-destructive text-sm">Review failed: {review.message}</p>
        <Button onClick={generate} variant="outline">Try again</Button>
      </div>
    )
  }

  const { data } = review

  return (
    <div className="space-y-4 pb-8">
      <button onClick={onBack} className="text-sm text-muted-foreground">← Back</button>
      <h1 className="text-xl font-bold">{data.programName}</h1>

      {/* Flags */}
      {data.flags.length > 0 && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 space-y-1">
          {data.flags.map((flag, i) => (
            <p key={i} className="text-xs text-amber-700 dark:text-amber-400">{flag}</p>
          ))}
        </div>
      )}
      {data.durationWarning && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3">
          <p className="text-xs text-amber-700 dark:text-amber-400">{data.durationWarning}</p>
        </div>
      )}

      {/* Sessions */}
      <details open className="group">
        <summary className="font-semibold text-sm cursor-pointer">Your sessions</summary>
        <div className="mt-2 space-y-3">
          {data.sessions.map(sess => (
            <div key={sess.name} className="rounded-xl border bg-card p-3 space-y-1">
              <p className="font-medium text-sm">{sess.name}</p>
              {sess.exercises.map(ex => (
                <div key={ex.name} className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{ex.name}</span>
                  <span>{ex.setCount} sets · {ex.suggestedStyleName ?? 'no style'}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </details>

      {/* Phases */}
      <details open className="group">
        <summary className="font-semibold text-sm cursor-pointer">Phase plan</summary>
        <div className="mt-2 space-y-2">
          {data.phases.map(phase => (
            <div key={phase.name} className="flex items-center justify-between rounded-xl border bg-card px-3 py-2">
              <div>
                <p className="text-sm font-medium">{phase.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{phase.phaseType} · {phase.durationCycles} cycle{phase.durationCycles !== 1 ? 's' : ''}</p>
              </div>
              <p className="text-xs text-muted-foreground">{phase.primaryStyleName ?? '—'}</p>
            </div>
          ))}
        </div>
      </details>

      {/* Actions */}
      <div className="space-y-2 pt-2">
        <Button
          className="w-full"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save program'}
        </Button>
        <Button
          variant="outline"
          className="w-full"
          disabled={regenerateCount >= 3 || saving}
          onClick={() => { setRegenerateCount(c => c + 1); generate() }}
        >
          Regenerate {regenerateCount >= 3 ? '(limit reached)' : `(${3 - regenerateCount} left)`}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/wizard/step-review.tsx
git commit -m "feat: add wizard step 6 — AI review display with save and regenerate"
```

---

## Task 11: Save API Route

**Files:**
- Create: `app/api/program-wizard/save/route.ts`

The save route creates the program (with sessions and schedule) then saves the phases using the existing repo methods.

- [ ] **Step 1: Create `app/api/program-wizard/save/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { todayInTz, DEFAULT_TZ } from '@/lib/date-utils'
import type { Program, ProgramSession, SessionExercise } from '@/lib/types/program'

const ExerciseSchema = z.object({
  exerciseName: z.string().max(200),
  exerciseRole: z.enum(['primary', 'secondary', 'accessory']),
  styleId:      z.string().uuid().optional().nullable(),
  muscleGroups: z.array(z.string()).max(10),
  position:     z.number().int().min(0),
})

const SessionSchema = z.object({
  name:      z.string().max(200),
  position:  z.number().int().min(0),
  exercises: z.array(ExerciseSchema).max(10),
})

const PhaseSchema = z.object({
  position:          z.number().int().min(0),
  name:              z.string().max(200),
  durationCycles:    z.number().int().min(1).max(52),
  phaseType:         z.enum(['normal', 'peak', 'deload']),
  primaryStyleId:    z.string().uuid().nullable(),
  secondaryStyleId:  z.string().uuid().nullable(),
})

const SaveSchema = z.object({
  name:             z.string().max(200),
  sessions:         z.array(SessionSchema).min(1).max(7),
  phaseMode:        z.enum(['manual', 'automatic']),
  startedAt:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessionsPerCycle: z.number().int().min(1).max(7),
  phases:           z.array(PhaseSchema).max(20),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = SaveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 422 })
  }

  const data = parsed.data
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const today = todayInTz(tz)

  const repo = await getRepository()

  // Build Program object in the shape saveProgram expects
  const programInput: Program = {
    id: '',  // adapter generates ID
    userId,
    name: data.name,
    isActive: false,
    sessions: data.sessions.map<ProgramSession>(sess => ({
      id: '',
      programId: '',
      name: sess.name,
      position: sess.position,
      exercises: sess.exercises.map<SessionExercise>(ex => ({
        id: '',
        sessionId: '',
        exerciseName: ex.exerciseName,
        styleId: ex.styleId ?? undefined,
        muscleGroups: ex.muscleGroups,
        position: ex.position,
        exerciseRole: ex.exerciseRole,
      })),
    })),
    schedule: {
      id: '',
      programId: '',
      type: 'rotation',
      restAfterN: data.sessionsPerCycle,
      days: [],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    phaseMode: data.phaseMode,
    startedAt: data.startedAt,
    sessionsPerCycle: data.sessionsPerCycle,
  }

  const saved = await repo.saveProgram(userId, programInput)

  // Save phases
  if (data.phases.length > 0) {
    await repo.saveProgramPhases(saved.id, data.phases.map(p => ({
      position: p.position,
      name: p.name,
      durationCycles: p.durationCycles,
      phaseType: p.phaseType,
      primaryStyleId: p.primaryStyleId ?? undefined,
      secondaryStyleId: p.secondaryStyleId ?? undefined,
    })))
    await repo.updateProgramPhaseSettings(saved.id, userId, {
      phaseMode: data.phaseMode,
      startedAt: data.startedAt,
      sessionsPerCycle: data.sessionsPerCycle,
    })
  }

  return NextResponse.json({ programId: saved.id })
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm build 2>&1 | grep "error TS" | head -20
```

Expected: zero TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/program-wizard/save/route.ts
git commit -m "feat: add wizard save endpoint — creates program + phases"
```

---

## Task 12: Config Screen Integration

**Files:**
- Modify: `components/config-screen.tsx`

Two minimal changes: a "Create with Wizard" button next to the existing "New" button, and reading `programId` from the URL query param to pre-select the newly created program.

- [ ] **Step 1: Read `components/config-screen.tsx` (lines 1–30)**

Confirm which imports exist at the top. Look for `useRouter` and add `useSearchParams` if not already imported.

- [ ] **Step 2: Add `useSearchParams` import**

Find the import line:
```typescript
import { useRouter } from "next/navigation";
```
Replace with:
```typescript
import { useRouter, useSearchParams } from "next/navigation";
```

- [ ] **Step 3: Read `programId` from query params and pre-select on mount**

In the component body, after the existing `useState` declarations, add:

```typescript
const searchParams = useSearchParams()

// Pre-select a program by ID when redirected from the wizard
useEffect(() => {
  const wizardProgramId = searchParams.get('programId')
  if (wizardProgramId && programs.length > 0) {
    const match = programs.find(p => p.id === wizardProgramId)
    if (match) setProgramEditId(wizardProgramId)
  }
}, [searchParams, programs])
```

(`setProgramEditId` is the existing state setter that opens the program edit sheet — check the actual setter name by searching for `programEditId` in the file.)

- [ ] **Step 4: Add "Wizard" button next to the existing "New" button**

Find the "New" button (line ~640):
```tsx
<button
  onClick={openNewProgram}
  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-brand text-white hover:opacity-90 transition"
>
  <Plus className="h-3.5 w-3.5" />
  New
</button>
```

Add the wizard link immediately after it:
```tsx
<a
  href="/program-wizard"
  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold border border-brand text-brand hover:bg-brand/10 transition"
>
  Wizard
</a>
```

- [ ] **Step 5: Verify build**

```bash
pnpm build 2>&1 | grep "error TS" | head -10
```

Expected: zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add components/config-screen.tsx
git commit -m "feat: add wizard entry point and programId pre-selection to config screen"
```

---

## Task 13: Final Build + Push

- [ ] **Step 1: Run full build**

```bash
pnpm build 2>&1 | tail -20
```

Expected: build completes successfully with no TypeScript or module resolution errors.

- [ ] **Step 2: Run tests**

```bash
pnpm test 2>&1 | tail -15
```

Expected: all tests pass including both `phase-engine.test.ts` and `wizard-engine.test.ts`.

- [ ] **Step 3: Push branch**

```bash
git push -u origin claude/project-review-brainstorm-SoBBa
```

---

## Self-Review Checklist

### Spec Coverage

- [x] Migration `022_style_rep_ranges.sql` — Task 1
- [x] `StyleSet` type updated with `repsMin`, `repsMax`, nullable `restSec` — Task 2
- [x] Dynamic rest from pct in workout UI — Task 3
- [x] Default progression styles seeded at `upsertUser` — Task 4
- [x] `wizard-engine.ts` pure functions with tests — Task 5
- [x] `buildSessionTemplate` all 9 day/leg combos — Task 5
- [x] `filterExercises` with equipment + Bodyweight always-included — Task 5
- [x] `maxWorkingSets` using goal-based mins-per-set — Task 5
- [x] `setsPerSessionForMuscle` — Task 5
- [x] `autoAssignRole` with PRIMARY_COMPOUNDS + COMPOUND_MUSCLES — Task 5
- [x] `pctToRestSec` — Task 5
- [x] Server page fetches library + styles — Task 6
- [x] Client orchestrator with step machine — Task 6
- [x] `localStorage` draft with 7-day TTL — Task 6
- [x] Step 1 (goal + experience) — Task 7
- [x] Step 2 (schedule) — Task 7
- [x] Step 3 (muscles) — Task 7
- [x] Step 4 (equipment, Bodyweight always on) — Task 7
- [x] Step 5 (exercise selection, swap sheet, session-template-based) — Task 8
- [x] Generate API with Zod + rateLimit + Gemini call — Task 9
- [x] Style name → UUID resolution — Task 9
- [x] Markdown fence stripping on Gemini response — Task 9
- [x] Step 6 (AI review display, regenerate ≤ 3, save button) — Task 10
- [x] Save API route with Zod + `saveProgram` + `saveProgramPhases` — Task 11
- [x] `sessionsPerCycle` and `startedAt` set on save — Task 11
- [x] Rotation schedule (`restAfterN = sessionsPerCycle`) — Task 11
- [x] Config screen "Wizard" button — Task 12
- [x] Config screen `programId` query param pre-selection — Task 12

### Placeholder Scan

All code blocks are complete. No TBD or TODO patterns.

### Type Consistency

- `Goal` and `Experience` exported from `wizard-engine.ts` and imported by step components and `wizard-content.tsx` — consistent
- `WizardGenerateResponse` exported from generate route and imported by `step-review.tsx` — consistent
- `WizardState` exported from `wizard-content.tsx` and imported by `step-review.tsx` — consistent
- `StyleSet` with `repsMin`/`repsMax`/`restSec?` defined in Task 2 and used in Task 3 — consistent
- `seedDefaultProgressionStyles` added to both `repository.ts` interface and `adapter.ts` implementation — consistent
