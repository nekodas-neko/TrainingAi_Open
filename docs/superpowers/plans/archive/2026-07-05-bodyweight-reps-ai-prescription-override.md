# Bodyweight Reps Silently Overwritten by Static-Style Remap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Bug:** User-confirmed via screenshot: a bodyweight Pull-Up exercise ("Pull ·
Accumulation · C1/1 · Ex 4/5" — an AI Dynamic Periodization program, accumulation
phase) shows **1 rep** prescribed for every set, despite "Last: 5, 4, 4, 5 reps ·
28 June" showing the lifter can clearly do 4–5.

**Confirmed root cause** — `app/api/workout-data/route.ts`, the per-exercise
mapping that builds `WorkoutExercise.progressionStyle`:

```ts
// (line ~314) AI prescription override — runs FIRST when the AI is driving load
if (aiDrivesLoad) {
  const p = aiPrescription!.exercises.find(e => e.sessionExerciseId === ex.id)
  if (p) {
    progressionStyle = prescriptionStyleForExercise(p)   // reps: presc.reps — the AI's OWN decided rep count
    ...
  }
}

// (line ~344) Bodyweight remap — runs SECOND, UNCONDITIONALLY, with no check for aiDrivesLoad
if (bwType === 'bodyweight' && progressionStyle && !isBaselinePhase) {
  const basis = Math.max(lastLog?.estimated1rm ?? 0, prMap.get(ex.exerciseName) ?? 0);
  const repMax = repMaxFromOneRm(basis);
  if (repMax > 0) {
    progressionStyle = progressionStyle.map(s => ({
      ...s,
      reps: Math.max(1, Math.floor((s.pct / 100) * repMax)),   // OVERWRITES presc.reps
    }));
  }
}
```

`prescriptionStyleForExercise()` (`lib/ai-periodization/apply-prescription.ts:24`)
already sets `reps: presc.reps` — the AI's own, already-bodyweight-aware, fully
computed rep target for this exact session (autoregulated, phase-appropriate). The
bodyweight remap block runs **after** this with no guard excluding the AI-driven
case, and unconditionally re-derives `reps` from `Math.floor((s.pct / 100) *
repMaxFromOneRm(basis))` — discarding the AI's decision and substituting a value
computed by a *different formula, designed for the static base-style path*, where
`pct` means "hand-tuned intensity fraction of a progression style" — not the AI's
prescribed intensity percentage, which has different semantics (see
`lib/ai-periodization/prompt.ts` for how the AI is told to reason about `pct`).
`repMaxFromOneRm()` (`lib/1rm.ts:191`) returns exactly `1` whenever even a single
rep at the reference weight already exceeds `basis` (by design — see its own
"largest r whose reference-weight 1RM does not exceed oneRm" contract and the
`Math.max(1, ...)` floor pattern used everywhere else in this file) — so any
mismatch between the AI's `pct` semantics and this formula's expectations collapses
every set to 1, exactly matching the screenshot.

This is a "One Formula, One Place" violation in the opposite direction from usual:
not two divergent formulas computing the *same* thing differently, but one formula
(the static bodyweight remap) reaching into and clobbering the output of a
*different, already-correct* one (the AI prescription) that runs immediately before
it in the same function.

**Fix:** Skip the bodyweight remap entirely when `aiDrivesLoad` is true — the AI
prescription already owns bodyweight-appropriate reps for that path.
Extract the remap into a small pure, unit-testable function in `lib/1rm.ts`
(alongside `repMaxFromOneRm`, which it depends on) rather than leaving it inline in
the route, matching this codebase's established pattern of keeping formulas pure
and tested (`duration-model.ts`, `time-audit.ts`, `1rm.ts` itself).

**Tech Stack:** Next.js 15 API route, TypeScript, vitest. No schema/migration
change.

⚠️ **Confidence note:** the code-level bug (AI-decided reps silently overwritten) is
verified by direct reading of both files — that part is not a guess. The exact
numeric collapse to `1` for *this specific screenshot* depends on this user's real
`estimated1rm`/personal-record/AI-prescribed-`pct` values, which aren't reachable
from this sandbox (no production DB access) and aren't reproducible locally without
a realistic AI Dynamic Periodization history for a bodyweight exercise (would
require seeding weeks of fake sessions + a real Gemini call). Task 1 below verifies
the fix addresses the *mechanism* (AI reps must survive); if it turns out this
user's case has a second contributing cause, that will surface as a still-wrong
number after this fix ships and should be reported back, not assumed away here.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/1rm.ts` | Modify | Extract `rescaleBodyweightReps()` |
| `lib/__tests__/1rm.test.ts` | Modify | Unit tests for the extracted function |
| `app/api/workout-data/route.ts` | Modify | Call the extracted function only when `!aiDrivesLoad` |

---

### Task 1: Stop the AI prescription's reps from being overwritten

**Files:**
- Modify: `lib/1rm.ts`
- Modify: `lib/__tests__/1rm.test.ts`
- Modify: `app/api/workout-data/route.ts`

- [ ] **Step 1: Write the failing test**

Add to `lib/__tests__/1rm.test.ts` (near the existing `repMaxFromOneRm` tests):

```ts
import { rescaleBodyweightReps } from '../1rm'
// (fold into the existing top-of-file import list instead if one already exists)

describe('rescaleBodyweightReps', () => {
  it('rescales each set\'s reps from its pct and the rep-max derived from basis', () => {
    // basis chosen so repMaxFromOneRm(basis) === 5 (matches the repMaxFromOneRm test fixture pattern)
    const basis = calc1RM(BW_REF, 5)
    const style = [{ pct: 100, reps: 1 }, { pct: 80, reps: 1 }, { pct: 60, reps: 1 }]
    const out = rescaleBodyweightReps(style, basis)
    expect(out.map(s => s.reps)).toEqual([5, 4, 3])
  })

  it('never returns 0 reps — floors at 1', () => {
    const out = rescaleBodyweightReps([{ pct: 10, reps: 1 }], calc1RM(BW_REF, 5))
    expect(out[0].reps).toBeGreaterThanOrEqual(1)
  })

  it('returns the style unchanged when basis has no usable estimate (repMax <= 0)', () => {
    const style = [{ pct: 75, reps: 8 }]
    expect(rescaleBodyweightReps(style, 0)).toEqual(style)
  })

  it('preserves every other field on each set (restSec, useFor1rm)', () => {
    const style = [{ pct: 100, reps: 1, restSec: 90, useFor1rm: true }]
    const out = rescaleBodyweightReps(style, calc1RM(BW_REF, 5))
    expect(out[0]).toMatchObject({ restSec: 90, useFor1rm: true })
  })
})
```

(Import `calc1RM` and `BW_REF` alongside the other `lib/1rm` imports already at the
top of this test file if not already present.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/__tests__/1rm.test.ts`
Expected: FAIL — `rescaleBodyweightReps` is not exported

- [ ] **Step 3: Write the implementation**

In `lib/1rm.ts`, add after `repMaxFromOneRm`:

```ts
// Rescales a STATIC progression style's reps for a bodyweight exercise from its
// per-set pct targets and the lifter's rep-max (inverted from their bodyweight 1RM
// via repMaxFromOneRm). Only ever call this for the static base-style path — an AI
// Dynamic Periodization prescription (prescriptionStyleForExercise,
// lib/ai-periodization/apply-prescription.ts) already decides bodyweight-appropriate
// reps directly from its own signals; re-deriving them here a second time silently
// discards the AI's decision (the bug this function's extraction fixes — see
// docs/superpowers/plans/2026-07-05-bodyweight-reps-ai-prescription-override.md).
export function rescaleBodyweightReps<T extends RMStyleSet>(style: T[], basis: number): T[] {
  const repMax = repMaxFromOneRm(basis)
  if (repMax <= 0) return style
  return style.map(s => ({ ...s, reps: Math.max(1, Math.floor((s.pct / 100) * repMax)) }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/__tests__/1rm.test.ts`
Expected: PASS (all tests, including pre-existing ones)

- [ ] **Step 5: Wire it into the route, gated on `!aiDrivesLoad`**

In `app/api/workout-data/route.ts`:

1. Add `rescaleBodyweightReps` to the existing `from '@/lib/1rm'` import.
2. Replace the bodyweight remap block (~line 344):
```ts
  // Bodyweight: prescribe reps as % of the rep max (from the personal record so an
  // easy day never lowers targets), round down, min 1. Only for the STATIC style —
  // an AI-driven prescription already decided bodyweight-appropriate reps itself
  // (prescriptionStyleForExercise) and must not be re-derived here.
  if (bwType === 'bodyweight' && progressionStyle && !isBaselinePhase && !aiDrivesLoad) {
    const basis = Math.max(lastLog?.estimated1rm ?? 0, prMap.get(ex.exerciseName) ?? 0);
    progressionStyle = rescaleBodyweightReps(progressionStyle, basis);
  }
```
(The only change from today: the added `&& !aiDrivesLoad` condition, and the inline
`repMaxFromOneRm`/`.map()` replaced by the extracted, tested function — behavior for
the non-AI static-style path is byte-identical.)

- [ ] **Step 6: Run the full suite + typecheck**

Run: `pnpm test && npx tsc --noEmit && pnpm lint`
Expected: all green.

- [ ] **Step 7: Manual verification against the local dev DB**

The local seed data doesn't include an AI Dynamic Periodization program with
bodyweight exercise history, so this can't be fully end-to-end verified in this
sandbox. At minimum:
1. Confirm the static (non-AI) bodyweight path still works: log a bodyweight
   exercise on a static-style program in the local dev DB across two sessions,
   confirm the second session's prescribed reps scale sensibly from the first (not
   frozen at a flat number).
2. If the user has (or can create) an AI Dynamic Periodization program with a
   bodyweight exercise, re-check the exact screen from the bug report — the
   prescribed reps should now match the AI's own reasoning (visible in the "Why
   this" / prescription explain sheet) instead of flattening to 1.
3. If reps are still wrong after this fix ships, that confirms a second,
   independent contributing cause exists — capture the exact `estimated1rm`/PR/
   AI-prescribed `pct` values at that point (e.g. via the admin/API response) and
   open a follow-up rather than assuming this fix alone was insufficient.

- [ ] **Step 8: Commit**

```bash
git add lib/1rm.ts lib/__tests__/1rm.test.ts app/api/workout-data/route.ts
git commit -m "fix: stop the bodyweight rep-remap from overwriting AI-prescribed reps"
```

⚠️ **Not exercised:** real production data for this exact user/exercise/phase
combination (see confidence note above) and native/on-device behavior (this is a
server-side route change with no device-specific surface).
