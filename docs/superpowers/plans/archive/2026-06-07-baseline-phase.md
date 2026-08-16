> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Baseline Phase (AMRAP 1RM Test) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional "Baseline" phase to the workout builder that runs a single AMRAP set per exercise in week 1, scales the resulting 1RM estimate down by a rep-band factor to account for formula inflation at high reps, and stores it as a personal record to seed the rest of the program's working weights.

**Architecture:** `phaseType: 'baseline'` is a first-class phase type stored in `program_phases`. The clone endpoint prepends a baseline phase when the builder toggle is on. During a baseline workout the server returns 1 set per exercise with no prescribed reps or intensity; the workout UI shows an "AMRAP" badge and the log-exercise API applies the rep-band scale factor before storing the PR.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM (PostgreSQL), Vitest, shadcn/ui, Tailwind v4.

---

## File Map

| File | Change |
|------|--------|
| `lib/types/program.ts` | Add `'baseline'` to `ProgramPhaseType` union |
| `components/workout/utils.ts` | Add `calcAmrap1RM(weight, reps)` |
| `lib/__tests__/utils.test.ts` *(new)* | Unit tests for `calcAmrap1RM` |
| `app/api/workout-data/route.ts` | Add `isBaseline` to `PhaseStatus`; override exercises to 1 set when baseline |
| `components/workout-screen.tsx` | Forward `isBaseline` to `ActiveWorkoutScreen` |
| `components/workout/active-workout-screen.tsx` | Accept `isBaseline` prop; AMRAP header text; pass `isAmrap` to `SetCard` |
| `components/workout/set-card.tsx` | Accept `isAmrap` prop; swap set badge for "AMRAP" label |
| `app/api/log-exercise/route.ts` | Detect baseline phase; apply AMRAP scale factor; always record PR |
| `app/api/phase-sets/clone/route.ts` | Accept `includeBaseline`; prepend baseline phase at position 0 |
| `components/workout-builder/builder-review.tsx` | Add `includeBaseline` state + toggle; always clone when baseline is on |

---

## Task 1: `calcAmrap1RM` helper + type

**Files:**
- Modify: `lib/types/program.ts`
- Modify: `components/workout/utils.ts`
- Create: `lib/__tests__/utils.test.ts`

### Background

The existing `calc1RM` (Epley/Brzycki average) overcorrects at high reps because fatigue—not max strength—limits the set above ~10 reps. We apply a rep-band scale factor *after* the formula.

| Reps | Factor | Rationale |
|------|--------|-----------|
| ≤ 5  | 1.00   | Near-maximal, formula accurate |
| 6–8  | 0.97   | Minimal fatigue contribution |
| 9–12 | 0.93   | Moderate fatigue (sweet spot for AMRAP tests) |
| 13–20| 0.88   | High reps — formula inflates |
| > 20 | 0.82   | Very high reps — conditioning-limited, not strength |

- [ ] **Step 1: Add `'baseline'` to the phase type union**

In `lib/types/program.ts`, find:
```typescript
export type ProgramPhaseType = 'normal' | 'peak' | 'deload' | 'accessory' | 'testing'
```
Replace with:
```typescript
export type ProgramPhaseType = 'normal' | 'peak' | 'deload' | 'accessory' | 'testing' | 'baseline'
```

- [ ] **Step 2: Add `calcAmrap1RM` to utils**

In `components/workout/utils.ts`, append after `calc1RM`:
```typescript
export function calcAmrap1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return weight
  const factor = reps <= 5 ? 1.0 : reps <= 8 ? 0.97 : reps <= 12 ? 0.93 : reps <= 20 ? 0.88 : 0.82
  return Math.round(calc1RM(weight, reps) * factor * 4) / 4
}
```

- [ ] **Step 3: Write failing tests**

Create `lib/__tests__/utils.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { calc1RM, calcAmrap1RM } from '../../components/workout/utils'

describe('calcAmrap1RM', () => {
  it('matches calc1RM for ≤5 reps (scale factor 1.0)', () => {
    expect(calcAmrap1RM(100, 5)).toBe(calc1RM(100, 5))
  })

  it('applies 0.97 factor at 8 reps', () => {
    const expected = Math.round(calc1RM(100, 8) * 0.97 * 4) / 4
    expect(calcAmrap1RM(100, 8)).toBe(expected)
  })

  it('applies 0.93 factor at 12 reps', () => {
    const expected = Math.round(calc1RM(100, 12) * 0.93 * 4) / 4
    expect(calcAmrap1RM(100, 12)).toBe(expected)
  })

  it('applies 0.88 factor at 15 reps', () => {
    const expected = Math.round(calc1RM(100, 15) * 0.88 * 4) / 4
    expect(calcAmrap1RM(100, 15)).toBe(expected)
  })

  it('applies 0.82 factor at 25 reps', () => {
    const expected = Math.round(calc1RM(100, 25) * 0.82 * 4) / 4
    expect(calcAmrap1RM(100, 25)).toBe(expected)
  })

  it('returns weight unchanged for 0 reps', () => {
    expect(calcAmrap1RM(100, 0)).toBe(100)
  })

  it('returns weight unchanged for 0 weight', () => {
    expect(calcAmrap1RM(0, 10)).toBe(0)
  })

  it('always produces a lower estimate than calc1RM for reps > 5', () => {
    expect(calcAmrap1RM(80, 15)).toBeLessThan(calc1RM(80, 15))
  })
})
```

- [ ] **Step 4: Run tests — expect failure (function not exported yet)**

```bash
cd /home/user/TrainingAI && pnpm test lib/__tests__/utils.test.ts
```

Expected: FAIL — `calcAmrap1RM is not a function` or similar.

- [ ] **Step 5: Run tests again after Step 2 — expect pass**

```bash
pnpm test lib/__tests__/utils.test.ts
```

Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add lib/types/program.ts components/workout/utils.ts lib/__tests__/utils.test.ts
git commit -m "feat: add baseline phase type and calcAmrap1RM helper"
```

---

## Task 2: workout-data API — baseline flag + single-set override

**Files:**
- Modify: `app/api/workout-data/route.ts`

### Background

The route already builds `PhaseStatus` and resolves `progressionStyle` per exercise. For baseline we need:
1. `isBaseline: boolean` on `PhaseStatus` (both the meta path and the session path)
2. When baseline: `defaultSets: 1` and `progressionStyle: null` per exercise (no prescribed reps/pct)

The workout-screen uses `defaultSets` (line 209) for the set count and `progressionStyle` for per-set weights; returning 1 / null is all that's needed.

- [ ] **Step 1: Add `isBaseline` to the `PhaseStatus` interface**

In `app/api/workout-data/route.ts`, find:
```typescript
export interface PhaseStatus {
  phase: ProgramPhase
  cycleInPhase: number
  totalPhaseCycles: number
  completedCycles: number
  totalProgramCycles: number
  blockComplete: boolean
  approxWeeksRemaining: number | null
  isDeloadActive: boolean
}
```
Replace with:
```typescript
export interface PhaseStatus {
  phase: ProgramPhase
  cycleInPhase: number
  totalPhaseCycles: number
  completedCycles: number
  totalProgramCycles: number
  blockComplete: boolean
  approxWeeksRemaining: number | null
  isDeloadActive: boolean
  isBaseline: boolean
}
```

- [ ] **Step 2: Populate `isBaseline` in the meta path**

Find the block (around line 86–95) that builds `phaseStatus` for the meta (`!sessionParam`) path:
```typescript
        phaseStatus = {
          phase: result.phase,
          cycleInPhase: result.cycleInPhase,
          totalPhaseCycles: result.totalPhaseCycles,
          completedCycles: result.completedCycles,
          totalProgramCycles: result.totalProgramCycles,
          blockComplete: result.blockComplete,
          approxWeeksRemaining: avgPerWeek > 0 ? result.approxWeeksRemaining(avgPerWeek) : null,
          isDeloadActive: deloadActive,
        }
```
Add `isBaseline: result.phase.phaseType === 'baseline',` as the last field:
```typescript
        phaseStatus = {
          phase: result.phase,
          cycleInPhase: result.cycleInPhase,
          totalPhaseCycles: result.totalPhaseCycles,
          completedCycles: result.completedCycles,
          totalProgramCycles: result.totalProgramCycles,
          blockComplete: result.blockComplete,
          approxWeeksRemaining: avgPerWeek > 0 ? result.approxWeeksRemaining(avgPerWeek) : null,
          isDeloadActive: deloadActive,
          isBaseline: result.phase.phaseType === 'baseline',
        }
```

- [ ] **Step 3: Populate `isBaseline` in the session path**

Find the block (around line 128–138) that builds `sessionPhaseStatus`:
```typescript
    sessionPhaseStatus = {
      phase: result.phase,
      cycleInPhase: result.cycleInPhase,
      totalPhaseCycles: result.totalPhaseCycles,
      completedCycles: result.completedCycles,
      totalProgramCycles: result.totalProgramCycles,
      blockComplete: result.blockComplete,
      approxWeeksRemaining: avgPerWeek > 0 ? result.approxWeeksRemaining(avgPerWeek) : null,
      isDeloadActive: isDeloadActive(result.phase, program, today),
    }
```
Add `isBaseline`:
```typescript
    sessionPhaseStatus = {
      phase: result.phase,
      cycleInPhase: result.cycleInPhase,
      totalPhaseCycles: result.totalPhaseCycles,
      completedCycles: result.completedCycles,
      totalProgramCycles: result.totalProgramCycles,
      blockComplete: result.blockComplete,
      approxWeeksRemaining: avgPerWeek > 0 ? result.approxWeeksRemaining(avgPerWeek) : null,
      isDeloadActive: isDeloadActive(result.phase, program, today),
      isBaseline: result.phase.phaseType === 'baseline',
    }
```

- [ ] **Step 4: Override `defaultSets` and `progressionStyle` for baseline exercises**

The exercise mapping (around line 140–182) ends with:
```typescript
        defaultSets: resolvedStyle?.length ?? 3,
        ...
        progressionStyle: resolvedStyle
          ? resolvedStyle.map(s => ({ pct: s.pct, reps: s.reps, restSec: s.restSec, useFor1rm: s.useFor1rm } as StyleSet))
          : null,
```

Before the mapping, add a boolean derived from `currentPhase`:
```typescript
  const isBaselinePhase = currentPhase?.phaseType === 'baseline'
```

Then in the mapping, replace the two lines above with:
```typescript
        defaultSets: isBaselinePhase ? 1 : (resolvedStyle?.length ?? 3),
        ...
        progressionStyle: isBaselinePhase
          ? null
          : resolvedStyle
            ? resolvedStyle.map(s => ({ pct: s.pct, reps: s.reps, restSec: s.restSec, useFor1rm: s.useFor1rm } as StyleSet))
            : null,
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors referencing `isBaseline` or `PhaseStatus`.

- [ ] **Step 6: Commit**

```bash
git add app/api/workout-data/route.ts
git commit -m "feat: add isBaseline to PhaseStatus; single AMRAP set for baseline exercises"
```

---

## Task 3: Workout screen AMRAP UI

**Files:**
- Modify: `components/workout-screen.tsx`
- Modify: `components/workout/active-workout-screen.tsx`
- Modify: `components/workout/set-card.tsx`

### Background

`workout-screen.tsx` already has `phaseStatus` state (line 59) and passes it to `ActiveWorkoutScreen` (line 725). We need to:
1. Thread `isBaseline` through as a prop to `ActiveWorkoutScreen`
2. Have `ActiveWorkoutScreen` display an "AMRAP Test" instruction banner and pass `isAmrap` to `SetCard`
3. `SetCard` swaps the set-number badge for an "AMRAP" label when `isAmrap` is true

- [ ] **Step 1: Pass `isBaseline` to `ActiveWorkoutScreen`**

In `components/workout-screen.tsx`, find the `<ActiveWorkoutScreen` render (around line 725). Add:
```tsx
isBaseline={phaseStatus?.isBaseline ?? false}
```
alongside the existing `phaseStatus={phaseStatus}` prop.

- [ ] **Step 2: Accept `isBaseline` in `ActiveWorkoutScreen`**

In `components/workout/active-workout-screen.tsx`, find the props interface (it already has `phaseStatus?: PhaseStatus | null`). Add `isBaseline?: boolean` to it.

- [ ] **Step 3: Add AMRAP instruction banner in `ActiveWorkoutScreen`**

In `active-workout-screen.tsx`, find the section where the set cards are rendered (the list of `<SetCard>` elements). Immediately above the set-card list, add:

```tsx
{isBaseline && (
  <div
    className="rounded-xl px-3 py-2 mb-2 text-xs text-center"
    style={{ background: 'color-mix(in oklch, var(--color-brand) 10%, transparent)', color: 'var(--color-brand)' }}
  >
    AMRAP Test — pick a challenging weight and do as many reps as possible with good form
  </div>
)}
```

- [ ] **Step 4: Pass `isAmrap` to each `<SetCard>`**

In the same file, every `<SetCard ...>` call that already receives `intensityPct`, add:
```tsx
isAmrap={isBaseline ?? false}
```

- [ ] **Step 5: Accept `isAmrap` in `SetCard` and swap the badge**

In `components/workout/set-card.tsx`:

1. Add `isAmrap?: boolean` to `SetCardProps`.
2. In the **active-card** render, find the set badge (bottom of the active state, the absolute-positioned div with `{index + 1}`):
```tsx
          {/* Set badge — top-left overlay */}
          <div
            className="absolute top-2 left-2 w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-black z-10"
            style={{ ... }}
          >
            {index + 1}
          </div>
```
Replace the inner content with:
```tsx
            {isAmrap ? 'A' : index + 1}
```
3. In the **done-card** render, find the label line:
```tsx
            <p className="text-[10px] text-muted-foreground">Set {index + 1} · Logged</p>
```
Replace with:
```tsx
            <p className="text-[10px] text-muted-foreground">{isAmrap ? 'AMRAP' : `Set ${index + 1}`} · Logged</p>
```
4. In the **upcoming-card** render, find:
```tsx
          <p className="text-[10px] text-muted-foreground">Set {index + 1} · {isNextUp ? "Up next" : "Upcoming"}</p>
```
Replace with:
```tsx
          <p className="text-[10px] text-muted-foreground">{isAmrap ? 'AMRAP' : `Set ${index + 1}`} · {isNextUp ? "Up next" : "Upcoming"}</p>
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/workout-screen.tsx components/workout/active-workout-screen.tsx components/workout/set-card.tsx
git commit -m "feat: AMRAP mode in workout UI for baseline phase"
```

---

## Task 4: log-exercise — AMRAP scale factor

**Files:**
- Modify: `app/api/log-exercise/route.ts`

### Background

`log-exercise` already resolves `currentPhase` (lines 105–117). When `currentPhase.phaseType === 'baseline'` we want to:
1. Apply the AMRAP rep-band scale factor to the 1RM estimate (the formula overcorrects at high reps)
2. Always record the PR (baseline is specifically designed to seed the personal record)

Note: the route has its own local `calc1RM` (copy of utils.ts). Keep it local — no cross-directory import needed. We add a local `amrapScaleFactor` helper to match the logic in `components/workout/utils.ts`.

- [ ] **Step 1: Add `amrapScaleFactor` local helper**

In `app/api/log-exercise/route.ts`, right after the local `calc1RM` function (around line 49), add:
```typescript
function amrapScaleFactor(reps: number): number {
  if (reps <= 5) return 1.0
  if (reps <= 8) return 0.97
  if (reps <= 12) return 0.93
  if (reps <= 20) return 0.88
  return 0.82
}
```

- [ ] **Step 2: Apply scale factor when baseline**

Currently (line 143):
```typescript
  const { estimated1rm, target80 } = calculate1RM(weights, reps, progressionStyle as StyleSet[] | undefined);
```

Replace with:
```typescript
  const isBaseline = currentPhase?.phaseType === 'baseline'
  let estimated1rm: number
  let target80: number
  if (isBaseline && weights[0] && reps[0]) {
    const raw = calc1RM(weights[0], reps[0])
    estimated1rm = mround(raw * amrapScaleFactor(reps[0]), 0.25)
    target80 = mround(estimated1rm * 0.8, 0.25)
  } else {
    ;({ estimated1rm, target80 } = calculate1RM(weights, reps, progressionStyle as StyleSet[] | undefined))
  }
```

- [ ] **Step 3: Always record PR during baseline**

Currently (line 147):
```typescript
  if (estimated1rm > 0 && !isAnyDeload) {
    isPR = await repo.upsertPersonalRecordIfBetter(userId, exercise, estimated1rm)
  }
```

Replace with:
```typescript
  if (estimated1rm > 0 && (!isAnyDeload || isBaseline)) {
    isPR = await repo.upsertPersonalRecordIfBetter(userId, exercise, estimated1rm)
  }
```

*(Baseline is not a deload but `isBaseline` guard makes the intent explicit and future-proof.)*

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Run the full test suite**

```bash
pnpm test
```

Expected: all existing tests pass (the phase-engine tests don't touch log-exercise, so no regressions expected).

- [ ] **Step 6: Commit**

```bash
git add app/api/log-exercise/route.ts
git commit -m "feat: apply AMRAP scale factor and record PR in baseline phase"
```

---

## Task 5: Clone API — `includeBaseline` support

**Files:**
- Modify: `app/api/phase-sets/clone/route.ts`

### Background

The clone route currently accepts `{ phaseSetId, overrides }`. When `includeBaseline: true` we:
1. Shift every existing phase's `position` up by 1
2. Unshift a baseline phase at position 0 with `durationCycles: 1` and no style

- [ ] **Step 1: Accept `includeBaseline` in the body**

In `app/api/phase-sets/clone/route.ts`, find:
```typescript
  const body = await req.json() as {
    phaseSetId: string
    overrides: Record<number, number>  // position → durationCycles
  }
```
Replace with:
```typescript
  const body = await req.json() as {
    phaseSetId: string
    overrides: Record<number, number>  // position → durationCycles
    includeBaseline?: boolean
  }
```

- [ ] **Step 2: Prepend baseline phase when requested**

Find:
```typescript
  const clonedPhases = source.phases.map(p => ({
    position:       p.position,
    name:           p.name,
    durationCycles: (body.overrides ?? {})[p.position] ?? p.durationCycles,
    phaseType:      p.phaseType,
    primaryStyleId: p.primaryStyleId,
  }))
```
Replace with:
```typescript
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
```

- [ ] **Step 3: TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/phase-sets/clone/route.ts
git commit -m "feat: clone phase set with optional prepended baseline phase"
```

---

## Task 6: Builder review — baseline toggle

**Files:**
- Modify: `components/workout-builder/builder-review.tsx`

### Background

The builder review already shows a "Phase Progression" block for phase-mode programs (lines 284–322). We add:
- An `includeBaseline` state (`false` by default)
- A toggle card above the phase progression block (only shown when `program.phases?.length > 0`, i.e. not linear mode)
- Always clones the phase set when `includeBaseline` is true (even if no cycle counts were edited)

- [ ] **Step 1: Add `includeBaseline` state**

In `components/workout-builder/builder-review.tsx`, find the existing state declarations (near the top of the component). Add:
```typescript
  const [includeBaseline, setIncludeBaseline] = useState(false)
```

- [ ] **Step 2: Always clone when baseline is on**

Find `handleSave`'s clone logic (around lines 207–224):
```typescript
      if (inputs.progressionMode !== 'linear' && program.phaseSetId && program.phases?.length) {
        const anyChanged = program.phases.some((p, i) => phaseCycles[i] !== p.durationCycles)
        if (anyChanged) {
          const overrides: Record<number, number> = {}
          program.phases.forEach((_, i) => { overrides[i] = phaseCycles[i] ?? program.phases[i].durationCycles })
          const cloneRes = await fetch('/api/phase-sets/clone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phaseSetId: program.phaseSetId, overrides }),
          })
          if (cloneRes.ok) {
            const cloned = await cloneRes.json()
            finalPhaseSetId = cloned.id
          }
        }
      }
```
Replace with:
```typescript
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
          }
        }
      }
```

- [ ] **Step 3: Add the toggle UI**

In the JSX, find the Phase Progression block (around line 284):
```tsx
        {/* Phase Progression */}
        {(program.phases?.length ?? 0) > 0 && (() => {
```

Immediately **before** that block, add:
```tsx
        {/* Baseline toggle — only for phase-mode programs */}
        {(program.phases?.length ?? 0) > 0 && (
          <div className="px-4 pt-3">
            <div
              className="rounded-xl border p-3 flex items-center gap-3"
              style={{ borderColor: includeBaseline ? 'var(--color-brand)' : undefined }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Add baseline test week</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Week 1 is an AMRAP session per exercise — sets your starting weights automatically.
                </p>
              </div>
              <button
                onClick={() => setIncludeBaseline(v => !v)}
                className="flex-none w-12 h-6 rounded-full transition-colors relative"
                style={{
                  background: includeBaseline ? 'var(--color-brand)' : 'var(--color-muted)',
                }}
                aria-label={includeBaseline ? 'Remove baseline week' : 'Add baseline week'}
              >
                <span
                  className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform"
                  style={{ transform: includeBaseline ? 'translateX(26px)' : 'translateX(2px)' }}
                />
              </button>
            </div>
          </div>
        )}
```

- [ ] **Step 4: TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/workout-builder/builder-review.tsx
git commit -m "feat: baseline test week toggle in builder review"
```

---

## Task 7: Push and verify

- [ ] **Step 1: Push the feature branch**

```bash
git push -u origin claude/nice-archimedes-8tJy3
```

- [ ] **Step 2: Manual test checklist (on device or browser)**

**A — Builder toggle (phase-mode program only):**
1. Open Config → Build a new program with any phase-based goal (e.g. Hypertrophy)
2. Reach the builder review screen
3. Confirm "Add baseline test week" toggle is visible above Phase Progression
4. Toggle it ON → border turns brand colour
5. Tap Save → program is saved; no error toast

**B — Workout UI in baseline phase:**
1. Activate the newly saved program
2. Open the workout for Session 1
3. Confirm phase header shows "Baseline · C1/1" (or just "Baseline")
4. Confirm AMRAP banner is visible above the set cards
5. Confirm each exercise has exactly 1 set card
6. Confirm set badge shows "A" instead of "1"
7. Confirm no intensity% badge is shown

**C — Logging an AMRAP set:**
1. Pick a weight on the AMRAP set card
2. Tap Start, do some reps (use the + button), tap Log
3. Done card shows "AMRAP · Logged"
4. Navigate to the exercise stats → confirm a new PR was saved
5. Open the 1RM calculator and confirm the PR is visible

**D — Linear program (baseline should NOT appear):**
1. Build a Linear Progression program
2. On the builder review, confirm "Add baseline test week" toggle is NOT shown

**E — Skip baseline (user opt-out):**
1. In a program with a baseline phase, go to the workout
2. Tap "Skip" / navigate away without logging (if the workout has a skip mechanism)
   — Or simply: build the program WITHOUT toggling baseline ON. Confirm the first workout starts on Accumulation (no Baseline phase).
