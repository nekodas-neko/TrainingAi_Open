> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Builder Cycle Length Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users specify total program weeks in the builder wizard, see the recommended default for their chosen phase structure, then fine-tune per-phase cycle counts on the review screen. Custom cycle counts clone the phase set at save time to avoid mutating shared templates.

**Architecture:** `totalWeeks: number` is added to `BuilderInputs` and a new wizard step (step 9, between Phase Structure and Schedule) captures it. The review screen gets inline `−/+` controls per phase with a live total. On save, if cycles differ from the phase set's defaults, the frontend calls `POST /api/phase-sets/clone` which creates a user-owned copy with the modified values and returns its ID. The `programs` table gets a `total_weeks` column (migration) for linear programs. The Gemini prompt receives `totalWeeks` to guide distribution.

**Tech Stack:** Next.js 15, React 19, TypeScript, Drizzle ORM, PostgreSQL (migration), Tailwind CSS v4.

---

## ⚠️ Pre-Flight: Known Issues

### Architecture constraint — phase set is shared, not per-program
`durationCycles` lives in `program_phases` rows that belong to a `phase_set`, not to a specific program. Editing cycles without cloning would change the phase set for ALL programs that reference it. The clone-on-save approach avoids this.

### Missing `clonePhaseSet` repository method
`lib/data/repository.ts` has `createPhaseSet` and `listPhaseSets` but no `clonePhaseSet`. The implementation uses a new API route `POST /api/phase-sets/clone` that handles the clone directly using `getRepository()` — no new repository method required.

### Wizard currently has 9 steps; step 9 triggers generate
`handleNext` calls `handleGenerate()` when `step === totalSteps` (=9). Inserting a new step 9 requires incrementing `totalSteps` to 10 and renumbering the old step 9 (Schedule + generate trigger) to step 10. The Phase Structure skip logic (skip step 8 if linear) is already in place and requires no change.

### `PHASE_STRUCTURES` has no `recommendedWeeks` field
The wizard's `PHASE_STRUCTURES` constant has only `name` and `description`. The recommended default weeks are hardcoded in this plan as an addition to `PHASE_STRUCTURES`. If new phase structures are added later, they need a `recommendedWeeks` entry too.

---

## File Map

| File | Change |
|------|--------|
| `lib/data/postgres/migrations/052_programs_total_weeks.sql` | **NEW** — add `total_weeks` column to `programs` |
| `lib/types/builder.ts` | Add `totalWeeks: number` to `BuilderInputs` |
| `components/workout-builder/builder-wizard.tsx` | Add `recommendedWeeks` to `PHASE_STRUCTURES`; add `totalWeeks` to `INITIAL_INPUTS`; insert step 9 (Program Length); renumber old step 9→10; update `totalSteps`, `handleNext`, `handleBack`, review trigger |
| `app/api/generate-program/route.ts` | Destructure `totalWeeks`; inject into prompt |
| `app/api/phase-sets/clone/route.ts` | **NEW** — POST endpoint to clone a phase set with overridden cycle counts |
| `components/workout-builder/builder-review.tsx` | Add `phaseCycles` state; per-phase `−/+` controls + live total; call clone API on save if cycles changed |

---

## Task 1: DB Migration — `programs.total_weeks`

**Files:**
- Create: `lib/data/postgres/migrations/052_programs_total_weeks.sql`

- [ ] **Step 1: Check the highest migration number**

```bash
ls /home/user/TrainingAI/lib/data/postgres/migrations/ | sort | tail -5
```

Expected: the highest file is `051_goals_water.sql`. Use `052` as the next number.

- [ ] **Step 2: Create the migration**

```sql
ALTER TABLE programs ADD COLUMN IF NOT EXISTS total_weeks integer;
```

Save to `lib/data/postgres/migrations/052_programs_total_weeks.sql`.

- [ ] **Step 3: Add the column to the Drizzle schema**

Open `lib/data/postgres/schema.ts`. Find the `programs` table definition. Add `totalWeeks` after the existing columns:

```typescript
totalWeeks:   integer('total_weeks'),
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/data/postgres/migrations/052_programs_total_weeks.sql lib/data/postgres/schema.ts
git commit -m "add total_weeks column to programs table"
```

---

## Task 2: Add `totalWeeks` to BuilderInputs and Wizard

**Files:**
- Modify: `lib/types/builder.ts`
- Modify: `components/workout-builder/builder-wizard.tsx`

- [ ] **Step 1: Add `totalWeeks` to `BuilderInputs`**

Open `lib/types/builder.ts`. Find `BuilderInputs` interface. Add:

```typescript
export interface BuilderInputs {
  programName: string
  equipment: string[]
  sessionsPerWeek: number
  timePerSessionMinutes: number | null
  musclesToFocus: string[]
  goal: 'hypertrophy' | 'strength+hypertrophy' | 'powerbuilding' | 'strength'
  phaseStructureName: string
  progressionMode: 'linear' | 'phase'
  totalWeeks: number        // ← add this
  scheduleType: 'rotation' | 'weekly'
  rotationRestAfterN: number
  weeklyDays: number[]
}
```

- [ ] **Step 2: Add `recommendedWeeks` to `PHASE_STRUCTURES` in wizard**

Open `components/workout-builder/builder-wizard.tsx`. Find `PHASE_STRUCTURES` (around line 28):

```typescript
const PHASE_STRUCTURES = [
  { name: 'Baselining',              description: '8 weeks to re-establish your 1RMs after time off' },
  { name: 'Phase-Based Progression', description: '4 weeks accumulation → 3 weeks strength → 2 weeks peak → 1 week deload' },
  // ... possibly more
]
```

Add `recommendedWeeks` to each entry:

```typescript
const PHASE_STRUCTURES = [
  { name: 'Baselining',              description: '8 weeks to re-establish your 1RMs after time off',                       recommendedWeeks: 10 },
  { name: 'Phase-Based Progression', description: '4 weeks accumulation → 3 weeks strength → 2 weeks peak → 1 week deload', recommendedWeeks: 11 },
]
```

> If there are additional entries not shown above, add `recommendedWeeks` to each by summing their described cycle counts. Default to `12` for any entry without a clear total.

- [ ] **Step 3: Add `totalWeeks` to `INITIAL_INPUTS`**

Find `const INITIAL_INPUTS: BuilderInputs = {` (around line 68). Add:

```typescript
totalWeeks: 11,   // default matches 'Phase-Based Progression' recommended
```

- [ ] **Step 4: Increment `totalSteps` from 9 to 10**

Find `const totalSteps = 9`. Change to:

```typescript
const totalSteps = 10
```

- [ ] **Step 5: Renumber old step 9 (Schedule) to step 10**

Find `{step === 9 && (` for the Schedule step. Change to `{step === 10 && (`.

Also update `handleBack` which currently returns to step 8 when `step === 1`:
```typescript
function handleBack() {
  if (step === 1) { onClose(); return }
  let prev = step - 1
  // Skip Phase Structure (step 8) when in linear progression mode
  if (prev === 8 && inputs.progressionMode === 'linear') prev = 7
  setStep(prev)
}
```
No change needed here — the skip of step 8 when linear still works correctly (7→9 program length, not back to 8).

- [ ] **Step 6: Update `handleNext` — renumber generate trigger**

Find `handleNext`:
```typescript
function handleNext() {
  if (step === totalSteps) { handleGenerate(); return }
  let next = step + 1
  if (next === 8 && inputs.progressionMode === 'linear') next = 9
  setStep(next)
}
```

No change needed to the skip logic. The `totalSteps` change from 9→10 means `handleGenerate()` now fires at step 10 instead of 9. Step 9 (new Program Length) flows normally.

- [ ] **Step 7: Update the `BuilderReview` trigger**

Find:
```typescript
if (step === 9 && program) {
```
Change to:
```typescript
if (step === 10 && program) {
```

Also find the `onBack` callback inside the `BuilderReview` render:
```typescript
onBack={() => { setProgram(null); setStep(8) }}
```
Change to:
```typescript
onBack={() => { setProgram(null); setStep(9) }}
```

- [ ] **Step 8: Add the Program Length step (new step 9)**

Find `{step === 8 && (` (Phase Structure) and insert the new step AFTER its closing `)}`:

```tsx
{step === 9 && (
  <div className="space-y-4">
    <div className="space-y-1">
      <h2 className="text-lg font-bold">How long?</h2>
      <p className="text-sm text-muted-foreground">
        {inputs.progressionMode === 'phase'
          ? `Recommended for ${inputs.phaseStructureName}: ${PHASE_STRUCTURES.find(p => p.name === inputs.phaseStructureName)?.recommendedWeeks ?? 12} weeks`
          : 'Recommended for linear progression: 12 weeks'}
      </p>
    </div>

    {/* Quick-select presets */}
    <div className="flex flex-wrap gap-2">
      {[8, 10, 12, 14, 16, 20].map(w => (
        <button
          key={w}
          type="button"
          onClick={() => setInputs(prev => ({ ...prev, totalWeeks: w }))}
          className={cn(
            'rounded-xl border px-4 py-2 text-sm font-semibold transition active:scale-95',
            inputs.totalWeeks === w
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-border bg-muted/30'
          )}
        >
          {w} wks
        </button>
      ))}
    </div>

    {/* Custom input */}
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        min={4}
        max={52}
        value={inputs.totalWeeks}
        onChange={e => {
          const v = parseInt(e.target.value)
          if (!isNaN(v) && v >= 4 && v <= 52) setInputs(prev => ({ ...prev, totalWeeks: v }))
        }}
        className="w-24 rounded-xl border bg-muted px-3 py-2.5 text-xl font-bold tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-brand"
      />
      <span className="text-sm text-muted-foreground font-medium">weeks</span>
    </div>
  </div>
)}
```

- [ ] **Step 9: Verify TypeScript**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 10: Commit**

```bash
git add lib/types/builder.ts components/workout-builder/builder-wizard.tsx
git commit -m "builder wizard: add Program Length step (step 9) with week presets and custom input"
```

---

## Task 3: Pass `totalWeeks` to generate-program API

**Files:**
- Modify: `app/api/generate-program/route.ts`

- [ ] **Step 1: Destructure `totalWeeks` from inputs**

Open `app/api/generate-program/route.ts`. Find where `inputs` is validated (the Zod schema near the top). Add `totalWeeks` to the schema:

```typescript
totalWeeks: z.number().int().min(4).max(52).default(12),
```

- [ ] **Step 2: Add `totalWeeks` to the prompt**

Find `const userPrompt = \`Design a workout program with these constraints:` (around line 228). After the `progressionContext` line, add:

```typescript
- Total program length: ${inputs.totalWeeks} weeks${inputs.progressionMode === 'phase' ? '. Distribute weeks across phases as you see fit, keeping the same phase order.' : '.'}
```

The updated prompt section:
```typescript
const userPrompt = `Design a workout program with these constraints:
- Program name: "${inputs.programName}"
- Available equipment: ${inputs.equipment.map(e => EQUIPMENT_LABEL[e] ?? e).join(', ')}
- Training days per week: ${inputs.sessionsPerWeek}
- Session volume target: ${targetExercises}
- Muscles to focus on: ${inputs.musclesToFocus.join(', ')}
- Training goal: ${inputs.goal}
- ${progressionContext}
- Total program length: ${inputs.totalWeeks} weeks${inputs.progressionMode === 'phase' ? '. Distribute weeks across phases as you see fit, keeping the same phase order.' : '.'}
- Schedule: ${scheduleDescription}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add app/api/generate-program/route.ts
git commit -m "pass totalWeeks to generate-program prompt"
```

---

## Task 4: Phase Set Clone API

**Files:**
- Create: `app/api/phase-sets/clone/route.ts`

- [ ] **Step 1: Check existing phase set repository methods**

```bash
grep -n "createPhaseSet\|listPhaseSets\|PhaseSet\b" /home/user/TrainingAI/lib/data/repository.ts | head -15
grep -n "createPhaseSet" /home/user/TrainingAI/lib/data/postgres/adapter.ts | head -5
```

Note the exact signature of `createPhaseSet` — it needs the phase set name, user ID, and an array of phases with `{ position, name, durationCycles, phaseType, primaryStyleId, secondaryStyleId }`.

- [ ] **Step 2: Check the PhaseSet type**

```bash
grep -n "interface PhaseSet\|type PhaseSet\|PhaseSetPhase\|ProgramPhase" /home/user/TrainingAI/lib/data/repository.ts | head -10
grep -rn "interface PhaseSet\|PhaseSetPhase" /home/user/TrainingAI/lib/types/ 2>/dev/null | head -10
```

- [ ] **Step 3: Create `app/api/phase-sets/clone/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

interface Override {
  position: number
  durationCycles: number
}

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const phaseSetId: string = body.phaseSetId
  const overrides: Override[] = Array.isArray(body.overrides) ? body.overrides : []

  if (!phaseSetId) return NextResponse.json({ error: 'phaseSetId required' }, { status: 400 })

  const repo = await getRepository()
  const phaseSets = await repo.listPhaseSets(userId)
  const source = phaseSets.find(ps => ps.id === phaseSetId)
  if (!source) return NextResponse.json({ error: 'Phase set not found' }, { status: 404 })

  // Build the cloned phases, applying overrides
  const overrideMap = new Map(overrides.map(o => [o.position, o.durationCycles]))
  const clonedPhases = source.phases.map(p => ({
    position:       p.position,
    name:           p.name,
    durationCycles: overrideMap.get(p.position) ?? p.durationCycles,
    phaseType:      p.phaseType,
    primaryStyleId: p.primaryStyleId,
    secondaryStyleId: p.secondaryStyleId ?? null,
  }))

  const cloneName = `${source.name} (custom)`
  const cloned = await repo.createPhaseSet(userId, cloneName, clonedPhases)

  return NextResponse.json({ id: cloned.id, name: cloned.name })
}
```

> If `repo.createPhaseSet` has a different signature, adapt the call to match what the repository expects. Read the adapter implementation at the line returned by Step 1 before writing.

- [ ] **Step 4: Verify TypeScript**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add app/api/phase-sets/clone/route.ts
git commit -m "add POST /api/phase-sets/clone endpoint for per-program cycle overrides"
```

---

## Task 5: Per-Phase Cycle Editor in Builder Review

**Files:**
- Modify: `components/workout-builder/builder-review.tsx`

- [ ] **Step 1: Read the Phase Progression section of builder-review.tsx**

```bash
sed -n '240,285p' /home/user/TrainingAI/components/workout-builder/builder-review.tsx
```

The section checks `(program.phases?.length ?? 0) > 0 && inputs.progressionMode !== 'linear'` and maps `program.phases` (each with `durationCycles`, `phaseType`, `name`, `primaryStyleName`).

- [ ] **Step 2: Add `phaseCycles` state**

After existing state declarations in `builder-review.tsx`, add:

```typescript
const [phaseCycles, setPhaseCycles] = useState<Record<number, number>>(() =>
  Object.fromEntries((program.phases ?? []).map(p => [p.position ?? 0, p.durationCycles]))
)
```

Note: `program.phases` is available at component mount because `BuilderReview` only renders after generation is complete.

- [ ] **Step 3: Add live total computation**

```typescript
const totalCycles = Object.values(phaseCycles).reduce((sum, c) => sum + c, 0)
```

- [ ] **Step 4: Replace phase rows in JSX with editable rows**

Find the phase rendering inside the Phase Progression section (around line 251):

```tsx
{program.phases.map((phase, i) => {
  const cycleLabel = `${phase.durationCycles} ${phase.durationCycles === 1 ? 'cycle' : 'cycles'}`
  const styleLabel = ...
  return (
    <div key={i} className="...">
      <p>{phase.name}</p>
      <p>{cycleLabel} · {styleLabel}</p>
    </div>
  )
})}
```

Replace with (keeping the same outer structure, just making cycle count editable):

```tsx
{/* Live total */}
<div className="flex items-center justify-between mb-2 px-0.5">
  <p className="text-xs text-muted-foreground">Total</p>
  <p className="text-xs font-bold tabular-nums">{totalCycles} {totalCycles === 1 ? 'week' : 'weeks'}</p>
</div>

{program.phases.map((phase, i) => {
  const pos = phase.position ?? i
  const cycles = phaseCycles[pos] ?? phase.durationCycles
  const styleLabel = phaseStyleShort(phase.primaryStyleName)
  return (
    <div key={i} className="flex items-center justify-between py-1.5 border-t border-border/20 first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{phase.name}</p>
        <p className="text-xs text-muted-foreground">{styleLabel}</p>
      </div>
      <div className="flex items-center gap-1 flex-none ml-2">
        <button
          type="button"
          onClick={() => setPhaseCycles(prev => ({ ...prev, [pos]: Math.max(1, (prev[pos] ?? phase.durationCycles) - 1) }))}
          className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center text-base font-bold active:scale-90 transition"
        >
          −
        </button>
        <span className="w-8 text-center text-sm font-bold tabular-nums">
          {cycles}
        </span>
        <button
          type="button"
          onClick={() => setPhaseCycles(prev => ({ ...prev, [pos]: (prev[pos] ?? phase.durationCycles) + 1 }))}
          className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center text-base font-bold active:scale-90 transition"
        >
          +
        </button>
        <span className="text-xs text-muted-foreground w-6">wk</span>
      </div>
    </div>
  )
})}
```

- [ ] **Step 5: Clone phase set in `handleSave` if cycles changed**

Find `handleSave` in `builder-review.tsx`. After cache invalidation (`invalidateCache('workout-data')`), before the navigation/completion call, add:

```typescript
// Determine the effective phaseSetId — clone if user changed any cycle counts
let effectivePhaseSetId = inputs.progressionMode === 'linear' ? null : program.phaseSetId

if (inputs.progressionMode === 'phase' && program.phaseSetId) {
  const originalCycles = Object.fromEntries(
    (program.phases ?? []).map(p => [p.position ?? 0, p.durationCycles])
  )
  const hasChanges = Object.entries(phaseCycles).some(
    ([pos, cycles]) => cycles !== (originalCycles[Number(pos)] ?? cycles)
  )
  if (hasChanges) {
    const overrides = Object.entries(phaseCycles).map(([pos, durationCycles]) => ({
      position: Number(pos),
      durationCycles,
    }))
    try {
      const cloneRes = await fetch('/api/phase-sets/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phaseSetId: program.phaseSetId, overrides }),
      })
      if (cloneRes.ok) {
        const cloned = await cloneRes.json()
        effectivePhaseSetId = cloned.id
      }
    } catch { /* fall back to original */ }
  }
}
```

Then find where `phaseSetId` is passed to the workout-templates POST and replace `program.phaseSetId` (or the existing expression) with `effectivePhaseSetId`:

```typescript
phaseSetId: effectivePhaseSetId,
```

Also update the `phaseMode` line to use `effectivePhaseSetId`:
```typescript
phaseMode: inputs.progressionMode === 'linear' ? 'manual' : 'automatic',
```
(No change needed here — this is already correct.)

Also pass `totalWeeks` to the workout-templates POST. Find the payload object and add:
```typescript
totalWeeks: inputs.totalWeeks,
```

- [ ] **Step 6: Add `totalWeeks` to the `Program` type and `saveProgram` adapter**

**a) Add to `lib/types/program.ts`:**

Find the `Program` interface (line 78). Add:
```typescript
  totalWeeks?: number
```
after `sessionsPerCycle?: number`.

**b) Add to `lib/data/postgres/adapter.ts` — `saveProgram` method (line 518):**

Find the `.set({...})` inside the `tx.update(s.programs)` block (around line 523) and add:
```typescript
totalWeeks: program.totalWeeks ?? null,
```

Find the `.values({...})` inside the `tx.insert(s.programs)` block (around line 532) and add:
```typescript
totalWeeks: program.totalWeeks ?? null,
```

**c) In `builder-review.tsx` `handleSave`, include `totalWeeks` in the program payload sent to `/api/workout-templates`:**

Find the `fetch('/api/workout-templates', { body: JSON.stringify({ program: ... }) })` call. The program object spreads from `program` and adds fields. Add:
```typescript
totalWeeks: inputs.totalWeeks,
```

- [ ] **Step 7: Verify TypeScript**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 8: Commit**

```bash
git add components/workout-builder/builder-review.tsx app/api/workout-templates/route.ts
git commit -m "builder review: per-phase cycle editor with live total; clone phase set on save if changed"
```

---

## Push

```bash
git push -u origin main
```

---

## Testing Checklist

**Program Length wizard step:**
- Open workout builder → step through to step 9 (after Phase Structure or Progression Mode if linear)
- Step 9 shows "How long?" with preset buttons (8/10/12/14/16/20 weeks) and a custom input
- Recommended weeks shown below heading (e.g. "Recommended for Phase-Based Progression: 11 weeks")
- Selecting a preset highlights it; custom input updates it
- Back/forward navigation skips Phase Structure (step 8) if linear mode chosen
- Continuing generates the program

**Phase cycle editor on review screen:**
- After generating a phase-based program, review screen shows Phase Progression section
- Each phase row has `−` / value / `+` controls for cycle count
- Minimum value: 1 (can't go below)
- "Total: N weeks" live counter updates as you adjust
- Linear programs: phase section hidden (unchanged from before)

**Phase set clone on save:**
- Adjust any phase cycle count → save program
- Program saves successfully
- If you then open Settings → Phase Sets, a new "... (custom)" phase set appears with the modified cycle counts
- If no cycles are changed, no new phase set is created

**totalWeeks in AI prompt:**
- Generate a new program with 8 weeks selected
- Review screen shows phases whose total cycle count approximately matches 8
- Generate with 16 weeks → phases show a longer total
