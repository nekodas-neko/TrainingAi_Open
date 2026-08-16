> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Block Periodization UX Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify block periodization setup by removing redundant style pickers, introducing default phases/styles, adding an Accessory phase, and separating Phase Setup from the program editor.

**Architecture:** This is primarily a UI/UX simplification. The data model gains one new `phaseType` value (`'accessory'`). The phase engine routes accessory exercises to a fixed accessory phase instead of per-exercise styles. Default styles and phases are seeded in `upsertUser`. The config screen is refactored to split Phase Setup into its own section and hide/show style pickers based on program mode.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM, PostgreSQL, Tailwind v4, shadcn/ui, React hooks

---

## File Structure

| File | Responsibility |
|------|---|
| `lib/types/program.ts` | Add 'accessory' to phaseType union |
| `lib/phase-engine.ts` | Route accessory exercises to Accessory phase |
| `lib/__tests__/phase-engine.test.ts` | Test accessory routing logic |
| `lib/data/postgres/adapter.ts` | Seed default styles (Hypertrophy/Strength/Peak/Deload/General) and default phases (Accumulation/Intensification/Peak/Deload/Accessory) in upsertUser |
| `components/config/phase-editor.tsx` | Render Accessory phase as fixed (no duration stepper, type selector disabled, no drag) |
| `components/config-screen.tsx` | Major refactor: move Phase Setup to separate section, hide style picker for Block mode, lock Manual/Block toggle to creation, rename terminology |

---

## Task 1: Add Accessory Phase Type

**Files:**
- Modify: `lib/types/program.ts:20`

- [ ] **Step 1: Update phaseType union to include 'accessory'**

In `lib/types/program.ts`, line 20 currently reads:
```typescript
phaseType: 'normal' | 'peak' | 'deload'
```

Change it to:
```typescript
phaseType: 'normal' | 'peak' | 'deload' | 'accessory'
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
pnpm tsc --noEmit
```

Expected: zero errors

- [ ] **Step 3: Commit**

```bash
git add lib/types/program.ts
git commit -m "feat: add 'accessory' phaseType for fixed progression style"
```

---

## Task 2: Update Phase Engine to Route Accessory Exercises

**Files:**
- Modify: `lib/phase-engine.ts:resolveStyleForExercise function`

- [ ] **Step 1: Read the current resolveStyleForExercise function**

```bash
grep -A 30 "export function resolveStyleForExercise" /home/user/TrainingAI/lib/phase-engine.ts
```

Expected output shows the function signature and current logic.

- [ ] **Step 2: Update resolveStyleForExercise to handle accessory exercises**

Find the function in `lib/phase-engine.ts` and update it. The new logic should be:

```typescript
export function resolveStyleForExercise(
  exercise: SessionExercise,
  program: Program,
  currentPhase: ProgramPhase | null,
): string | undefined {
  // Accessory exercises use the Accessory phase's primary style, always
  if (exercise.exerciseRole === 'accessory') {
    const accessoryPhase = program.phases?.find(p => p.phaseType === 'accessory');
    return accessoryPhase?.primaryStyleId;
  }

  // Primary and Secondary follow the current phase (existing logic)
  if (!currentPhase) return exercise.styleId;

  if (exercise.exerciseRole === 'primary') {
    return currentPhase.primaryStyleId ?? exercise.styleId;
  }

  if (exercise.exerciseRole === 'secondary') {
    return currentPhase.secondaryStyleId ?? currentPhase.primaryStyleId ?? exercise.styleId;
  }

  return exercise.styleId;
}
```

(Replace the entire function with this new version; keep the function signature and docstring if it has one.)

- [ ] **Step 3: Verify TypeScript compilation**

```bash
pnpm tsc --noEmit
```

Expected: zero errors

- [ ] **Step 4: Commit**

```bash
git add lib/phase-engine.ts
git commit -m "feat: route accessory exercises to fixed Accessory phase style"
```

---

## Task 3: Add Tests for Accessory Phase Routing

**Files:**
- Modify: `lib/__tests__/phase-engine.test.ts`

- [ ] **Step 1: Add test case for accessory exercise routing**

Open `lib/__tests__/phase-engine.test.ts` and add this test case in the describe block:

```typescript
it('resolveStyleForExercise routes accessory to Accessory phase', () => {
  const accessoryPhase: ProgramPhase = {
    id: 'acc-phase',
    programId: 'prog1',
    position: 4,
    name: 'Accessory',
    durationCycles: 0,
    phaseType: 'accessory',
    primaryStyleId: 'general-style',
    secondaryStyleId: undefined,
  };

  const program = {
    ...mockProgram,
    phases: [
      mockPhase,
      { ...mockPhase, id: 'int', name: 'Intensification', position: 1 },
      { ...mockPhase, id: 'peak', name: 'Peak', position: 2, phaseType: 'peak' as const },
      { ...mockPhase, id: 'deload', name: 'Deload', position: 3, phaseType: 'deload' as const },
      accessoryPhase,
    ],
  };

  const accessoryExercise: SessionExercise = {
    id: 'ex1',
    exerciseName: 'Leg Curl',
    styleId: undefined,
    muscleGroups: ['Hamstrings'],
    position: 0,
    exerciseRole: 'accessory',
  };

  const result = resolveStyleForExercise(accessoryExercise, program, mockPhase);
  expect(result).toBe('general-style');
});
```

Place this test after any existing role tests (search for "exerciseRole" in the file to find the right location).

- [ ] **Step 2: Run tests to verify they pass**

```bash
pnpm test
```

Expected: all 20+ tests pass, including the new one

- [ ] **Step 3: Commit**

```bash
git add lib/__tests__/phase-engine.test.ts
git commit -m "test: add test for accessory exercise phase routing"
```

---

## Task 4: Update PhaseEditor to Handle Accessory Phase

**Files:**
- Modify: `components/config/phase-editor.tsx`

- [ ] **Step 1: Update the phaseType array to include 'accessory'**

Find the line with `(['normal', 'peak', 'deload'] as PhaseType[])` (around line 136) and update the type union at the top of the file:

Change line 24:
```typescript
type PhaseType = 'normal' | 'peak' | 'deload'
```

To:
```typescript
type PhaseType = 'normal' | 'peak' | 'deload' | 'accessory'
```

- [ ] **Step 2: Render Accessory phase specially**

Find the phase mapping section (around lines 79-196 where phases are rendered). After the main phase card closing `</div>`, add special handling before the "Add Phase" button:

Locate the `Add Phase` button (around line 199) and insert this BEFORE it:

```typescript
      {/* Accessory phase — always present, not draggable */}
      {phases.some(p => p.phaseType === 'accessory') && (
        <div className="rounded-xl border bg-card p-3 space-y-2 opacity-75">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-semibold">ACCESSORY (Fixed)</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-20 shrink-0">Style</span>
            <select
              value={phases.find(p => p.phaseType === 'accessory')?.primaryStyleId ?? ''}
              onChange={e => {
                const idx = phases.findIndex(p => p.phaseType === 'accessory');
                if (idx !== -1) update(idx, { primaryStyleId: e.target.value || undefined });
              }}
              className="text-xs border rounded px-2 py-1 bg-background flex-1"
            >
              <option value="">— select —</option>
              {styleOptions.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <p className="text-xs text-muted-foreground pl-0">
            Accessories always use this style, regardless of phase.
          </p>
        </div>
      )}
```

- [ ] **Step 3: Prevent Accessory phase from being added manually**

The add() function already creates normal phases, so no change needed. Keep it as-is.

- [ ] **Step 4: Verify TypeScript compilation**

```bash
pnpm tsc --noEmit
```

Expected: zero errors

- [ ] **Step 5: Commit**

```bash
git add components/config/phase-editor.tsx
git commit -m "feat: render Accessory phase as fixed, non-draggable"
```

---

## Task 5: Seed Default Progression Styles and Phases

**Files:**
- Modify: `lib/data/postgres/adapter.ts:upsertUser method`

- [ ] **Step 1: Find upsertUser method and add default styles seeding**

Find the `upsertUser` method and add this code after the user is created/updated but before the return statement:

```typescript
    // Seed default progression styles if they don't exist
    const defaultStyles = [
      { name: 'Hypertrophy', sets: [{ setNumber: 1, pct: 65, reps: 10, restSec: 60, useFor1rm: false }] },
      { name: 'Strength', sets: [{ setNumber: 1, pct: 80, reps: 5, restSec: 120, useFor1rm: false }] },
      { name: 'Peak', sets: [{ setNumber: 1, pct: 90, reps: 3, restSec: 180, useFor1rm: true }] },
      { name: 'Deload', sets: [{ setNumber: 1, pct: 50, reps: 10, restSec: 60, useFor1rm: false }] },
      { name: 'General', sets: [{ setNumber: 1, pct: 60, reps: 12, restSec: 60, useFor1rm: false }] },
    ];

    for (const style of defaultStyles) {
      const existing = await this.db
        .select()
        .from(s.progressionStyles)
        .where(and(eq(s.progressionStyles.userId, user.id), eq(s.progressionStyles.name, style.name)))
        .limit(1);

      if (existing.length === 0) {
        const styleId = crypto.randomUUID();
        await this.db.insert(s.progressionStyles).values({
          id: styleId,
          userId: user.id,
          name: style.name,
        });

        for (const set of style.sets) {
          await this.db.insert(s.styleSets).values({
            id: crypto.randomUUID(),
            styleId,
            setNumber: set.setNumber,
            pct: set.pct,
            reps: set.reps,
            restSec: set.restSec,
            useFor1rm: set.useFor1rm,
          });
        }
      }
    }
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
pnpm tsc --noEmit
```

Expected: zero errors

- [ ] **Step 3: Commit**

```bash
git add lib/data/postgres/adapter.ts
git commit -m "feat: seed default progression styles on user creation"
```

---

## Task 6: Auto-Populate Default Phases When Enabling Block Periodization

**Files:**
- Modify: `app/api/program-phases/route.ts:PUT handler`

- [ ] **Step 1: Update PUT handler to auto-populate default phases**

In `app/api/program-phases/route.ts`, in the PUT handler, add default phase population logic when phases array is empty:

```typescript
export async function PUT(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { programId: string; phases: Omit<ProgramPhase, 'id' | 'programId'>[] };

  const repo = await getRepository();
  const programs = await repo.listPrograms(userId);
  if (!programs.some(p => p.id === body.programId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let phasesToSave = body.phases;

  // If phases array is empty, populate defaults with default styles
  if (phasesToSave.length === 0) {
    const styles = await repo.listProgressionStyles(userId);
    const hypertrophy = styles.find(s => s.name === 'Hypertrophy');
    const strength = styles.find(s => s.name === 'Strength');
    const peak = styles.find(s => s.name === 'Peak');
    const deload = styles.find(s => s.name === 'Deload');
    const general = styles.find(s => s.name === 'General');

    phasesToSave = [
      {
        position: 0,
        name: 'Accumulation',
        durationCycles: 4,
        phaseType: 'normal' as const,
        primaryStyleId: hypertrophy?.id,
        secondaryStyleId: hypertrophy?.id,
      },
      {
        position: 1,
        name: 'Intensification',
        durationCycles: 3,
        phaseType: 'normal' as const,
        primaryStyleId: strength?.id,
        secondaryStyleId: strength?.id,
      },
      {
        position: 2,
        name: 'Peak',
        durationCycles: 2,
        phaseType: 'peak' as const,
        primaryStyleId: peak?.id,
        secondaryStyleId: undefined,
      },
      {
        position: 3,
        name: 'Deload',
        durationCycles: 1,
        phaseType: 'deload' as const,
        primaryStyleId: deload?.id,
        secondaryStyleId: undefined,
      },
      {
        position: 4,
        name: 'Accessory',
        durationCycles: 0,
        phaseType: 'accessory' as const,
        primaryStyleId: general?.id,
        secondaryStyleId: undefined,
      },
    ];
  }

  await repo.saveProgramPhases(body.programId, phasesToSave);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
pnpm tsc --noEmit
```

Expected: zero errors

- [ ] **Step 3: Commit**

```bash
git add app/api/program-phases/route.ts
git commit -m "feat: auto-populate default phases on Block Periodization enable"
```

---

## Task 7-11: Config Screen Refactoring (Large Component)

Due to the size and complexity of config-screen.tsx, these tasks are combined into a single execution step with checkpoints.

**Files:**
- Modify: `components/config-screen.tsx`

**Changes:**
1. Remove Phase Setup from Edit Program panel
2. Add Phase Setup as separate card section
3. Hide style picker for Block Periodization
4. Lock Manual/Block toggle to creation time
5. Rename terminology

- [ ] **Step 1: Execute all config screen changes**

Due to the complexity and interdependencies of these changes, they will be implemented via the Agent tool to carefully refactor the large component.

- [ ] **Step 2: Verify TypeScript compilation**

```bash
pnpm tsc --noEmit
```

Expected: zero errors

- [ ] **Step 3: Commit all changes**

```bash
git add components/config-screen.tsx
git commit -m "refactor: separate Phase Setup section, hide style picker for Block mode, lock periodization choice"
```

---

## Task 12: Manual Testing

**Files:**
- Test: manual walkthrough

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2-5: Manual testing walkthrough**

(See plan for detailed steps)

---

