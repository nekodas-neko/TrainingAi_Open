# Warm-Up Ramp-Up: Equipment-Aware Duration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Bug:** The pre-set "Warm-up ramp-up" segmented timer on the exercise ready screen
(`components/workout/active-workout-screen.tsx`) shows the same fixed **2:00** (3
stages × `WARMUP_SECTION_SEC = 40`, line 154) for every exercise, regardless of
equipment. User-confirmed via two live screenshots: Sumo Deadlift and Bent-Over
Barbell Row — both barbell lifts — show `0:xx / 2:00`, identical to what a machine
exercise would show. This is a third, independent "how long does setup take"
implementation that was never wired to the equipment-aware model shipped in
`lib/workout/duration-model.ts` (session 186, PR #136) — the file doesn't import
`transitionSecForEquipment` or anything from `duration-model.ts` at all. It's the
most user-visible instance of the "One Formula, One Place" violation, since it's
what the lifter watches every single set.

**Fix:** Derive the per-stage duration from `transitionSecForEquipment(exercise?.equipment)`
divided across the fixed 3 stages (prep/activate/potentiate), instead of the
hardcoded `40`. Barbell exercises go from 2:00 → 4:00 total ramp-up (matching the
`TRANSITION_SEC_BARBELL = 240` assumption used everywhere else); machine/dumbbell/
cable/kettlebell exercises are unaffected (120/3 = 40, identical to today);
bodyweight is moot (the section is already hidden via `!isBodyweight`).

**Tech Stack:** Next.js 15, React, TypeScript, vitest.

> ⚠️ **Amended 2026-07-05 (backlog review):** `exercise_library.equipment` is
> `NOT NULL DEFAULT []`, and rows never covered by the equipment migrations
> (030/081/082) — plus any user-created exercise absent from the library — hit the
> `[]`/`undefined` → `TRANSITION_SEC_DEFAULT = 240` branch. The worst-case default is
> right for *planning* (over-estimating protects the budget) but inverted for an
> on-screen countdown the lifter has to sit through: an unmapped machine exercise
> silently doubles from 2:00 to 4:00 — and it contradicts `weightStepFor`
> (`components/workout/utils.ts`), which treats missing equipment as non-barbell.
> Implementer must make this an explicit decision: either have
> `warmupRampSectionSec()` fall back to `TRANSITION_SEC_STANDARD` for unknown/empty
> equipment (recommended — barbell-when-known still gets 4:00), or keep the 240s
> worst case and add an unmapped exercise (e.g. the seeded `Bicep Curl`, which has no
> equipment row) to Step 7's manual verification so the behaviour ships knowingly.
> Note the seeded `Barbell Front Squat` also has empty equipment — it would show a
> "correct-looking" 4:00 by coincidence; don't let it masquerade as the barbell test.

**Key decision:** Add a small pure helper `warmupRampSectionSec()` to
`lib/workout/duration-model.ts` (not inline math in the component) so it's
unit-testable without a component-rendering harness — this codebase has no
React component test infra today (no existing `*.test.tsx` for any workout
component), but has thorough pure-function coverage for the duration model.
Keeping the equipment→duration mapping in `duration-model.ts` also means any
future change to `TRANSITION_SEC_BARBELL`/`TRANSITION_SEC_STANDARD` automatically
flows through to this on-screen timer instead of needing a second edit.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/workout/duration-model.ts` | Modify | Add `warmupRampSectionSec(equipment, sectionCount)` |
| `lib/__tests__/duration-model.test.ts` | Modify | Unit tests for the new helper |
| `components/workout/active-workout-screen.tsx` | Modify | Use the helper instead of the hardcoded `40` |

---

### Task 1: Equipment-aware ramp-up section duration

**Files:**
- Modify: `lib/workout/duration-model.ts`
- Modify: `lib/__tests__/duration-model.test.ts`
- Modify: `components/workout/active-workout-screen.tsx`

- [ ] **Step 1: Write the failing test**

Add to `lib/__tests__/duration-model.test.ts`:

```ts
import { warmupRampSectionSec } from '@/lib/workout/duration-model'
// (add to the existing top-of-file import list instead if one already exists)

describe('warmupRampSectionSec', () => {
  it('splits the barbell transition assumption across 3 stages (4:00 total)', () => {
    expect(warmupRampSectionSec(['barbell'], 3)).toBe(80) // 240 / 3
  })

  it('splits the standard-equipment transition across 3 stages (2:00 total, unchanged today)', () => {
    expect(warmupRampSectionSec(['machine'], 3)).toBe(40) // 120 / 3
    expect(warmupRampSectionSec(['dumbbell', 'cable'], 3)).toBe(40)
  })

  it('splits the bodyweight transition across 3 stages (1:00 total)', () => {
    expect(warmupRampSectionSec(['bodyweight'], 3)).toBe(20) // 60 / 3
  })

  it('unknown/empty equipment assumes the barbell worst case', () => {
    expect(warmupRampSectionSec([], 3)).toBe(80)
    expect(warmupRampSectionSec(undefined, 3)).toBe(80)
  })

  it('falls back to a flat 40s per section if sectionCount is 0 (no divide-by-zero)', () => {
    expect(warmupRampSectionSec(['barbell'], 0)).toBe(40)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/__tests__/duration-model.test.ts`
Expected: FAIL — `warmupRampSectionSec` is not exported

- [ ] **Step 3: Write the implementation**

In `lib/workout/duration-model.ts`, add after `transitionSecForEquipment`:

```ts
// Per-stage duration for the on-screen warm-up ramp-up timer (prep/activate/potentiate,
// active-workout-screen.tsx) — splits the same equipment-aware transition assumption
// evenly across however many ramp stages are shown. Keeping this here (not inline in
// the component) means TRANSITION_SEC_* stays the single source of truth for both the
// planning estimate AND the on-screen countdown the lifter actually watches.
export function warmupRampSectionSec(equipment: string[] | undefined, sectionCount: number): number {
  if (sectionCount <= 0) return 40
  return transitionSecForEquipment(equipment) / sectionCount
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/__tests__/duration-model.test.ts`
Expected: PASS (all tests, including the pre-existing ones)

- [ ] **Step 5: Wire it into the ready screen**

In `components/workout/active-workout-screen.tsx`:

1. Add to the existing `duration-model` import (or add a new import line if none exists yet in this file):
```ts
import { warmupRampSectionSec } from '@/lib/workout/duration-model';
```

2. Reorder + replace lines 154–161 (`WARMUP_SECTION_SEC` currently comes *before*
   `warmupSectionCount` is computed — swap the order so the helper can use it):
```ts
  const readyElapsedSec = !timerStarted && readyStartElapsedRef.current != null
    ? Math.max(0, sessionElapsedSec - readyStartElapsedRef.current)
    : 0;
  const warmupSectionCount = warmupSets?.length ?? 0;
  const WARMUP_SECTION_SEC = warmupRampSectionSec(exercise?.equipment, warmupSectionCount);
  const allWarmupDone = warmupSectionCount > 0 && readyElapsedSec >= warmupSectionCount * WARMUP_SECTION_SEC;
  const activeWarmupSection = allWarmupDone ? warmupSectionCount : Math.floor(readyElapsedSec / WARMUP_SECTION_SEC);
  const warmupSectionProgress = (readyElapsedSec % WARMUP_SECTION_SEC) / WARMUP_SECTION_SEC;
```
(Leave `readyStartElapsedRef`/`readyElapsedSec` exactly as-is here — that ref is the
subject of the separate `2026-07-05-warmup-rampup-background-persist.md` plan; if
that plan has already landed on this branch's base, use whatever `readyElapsedSec`
looks like at that point instead of reintroducing the ref.)

- [ ] **Step 6: Run full verification**

Run: `pnpm test && npx tsc --noEmit && pnpm lint`
Expected: all green.

- [ ] **Step 7: Manual verification against the local dev DB**

Start `pnpm dev`, start a workout containing at least one barbell exercise and one
machine/dumbbell exercise (the seeded Push/Pull/Legs program has both — e.g. Barbell
Bench Press vs. a machine accessory if the active program has one, otherwise compare
against `Barbell Overhead Press` vs. `Tricep Pushdown` if Tricep Pushdown's equipment
is cable/machine in `exercise_library`). Confirm:
- Barbell exercise's ready screen shows `W1/W2/W3` totalling **4:00** (`0:00 / 4:00`
  header, ~1:20 per stage).
- Non-barbell exercise's ready screen still shows **2:00** total (unchanged).

- [ ] **Step 8: Commit**

```bash
git add lib/workout/duration-model.ts lib/__tests__/duration-model.test.ts components/workout/active-workout-screen.tsx
git commit -m "fix: warm-up ramp-up timer scales with equipment (barbell gets 4:00, not 2:00)"
```
