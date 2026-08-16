# Per-Exercise Deload — Block 3: PR Gating / Log Payload Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sets logged for a per-exercise-deloaded exercise never update `personal_records`. The client flag lands in Block 4; this block makes the server honour it on both write paths.

**Architecture:** Add `exerciseDeloaded` to `LogExercisePayloadSchema` and extend the existing PR gate in `logExerciseFromPayload`. The gate condition is extracted into a small exported predicate so the rule is unit-testable without mocking the repository. **Sync mirror is free:** the `workout_log` branch of `pushMutations` (`lib/data/postgres/adapter.ts:2777-2787`) already parses the same schema and calls the same `logExerciseFromPayload`, so web and offline-outbox writes stay identical with no adapter change.

**Tech Stack:** TypeScript, zod, vitest.

**Depends on:** Nothing from Blocks 1–2 (independently mergeable), but only becomes reachable once Block 4 sends the flag.

---

### Task 1: PR-gate predicate — failing tests first

**Files:**
- Test: `lib/__tests__/log-exercise-pr-gate.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { shouldCountTowardPr } from '@/lib/workout/log-exercise'

describe('shouldCountTowardPr', () => {
  const base = { estimated1rm: 100, isAnyDeload: false, isBaseline: false, exerciseDeloaded: false }

  it('counts a normal full-intensity log', () => {
    expect(shouldCountTowardPr(base)).toBe(true)
  })

  it('never counts when there is no 1RM estimate', () => {
    expect(shouldCountTowardPr({ ...base, estimated1rm: 0 })).toBe(false)
  })

  it('does not count during a whole-session deload (existing behaviour)', () => {
    expect(shouldCountTowardPr({ ...base, isAnyDeload: true })).toBe(false)
  })

  it('baseline sessions count even inside a deload window (existing behaviour)', () => {
    expect(shouldCountTowardPr({ ...base, isAnyDeload: true, isBaseline: true })).toBe(true)
  })

  it('does not count a per-exercise-deloaded log', () => {
    expect(shouldCountTowardPr({ ...base, exerciseDeloaded: true })).toBe(false)
  })

  it('per-exercise deload blocks the PR even in a baseline session', () => {
    // A deloaded exercise is deliberately submaximal — its estimate is
    // meaningless for PRs regardless of the surrounding session type.
    expect(shouldCountTowardPr({ ...base, isBaseline: true, exerciseDeloaded: true })).toBe(false)
  })

  it('reverted exercise (flag false/absent) counts again', () => {
    expect(shouldCountTowardPr({ ...base, exerciseDeloaded: false })).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run lib/__tests__/log-exercise-pr-gate.test.ts`
Expected: FAIL — `shouldCountTowardPr` is not exported.

---

### Task 2: Schema field + gate implementation

**Files:**
- Modify: `lib/workout/log-exercise.ts` (schema at lines 8–43; PR gate at lines 181–184)

- [ ] **Step 1: Add the payload field**

In `LogExercisePayloadSchema`, after `wasOverride` (line 40):

```ts
  wasOverride:          z.boolean().optional(),
  exerciseDeloaded:     z.boolean().optional(),
```

- [ ] **Step 2: Extract and extend the PR gate**

Add the exported predicate near the schema (module scope):

```ts
// PR gate: deload work is deliberately submaximal, so its 1RM estimate must
// never enter personal_records. Whole-session deloads were already excluded;
// a per-exercise deload excludes just that exercise — and unlike the session
// flag it has no baseline exception, since the exercise itself was cut.
export function shouldCountTowardPr(args: {
  estimated1rm: number
  isAnyDeload: boolean
  isBaseline: boolean
  exerciseDeloaded: boolean
}): boolean {
  if (args.estimated1rm <= 0) return false
  if (args.exerciseDeloaded) return false
  return !args.isAnyDeload || args.isBaseline
}
```

Destructure the new field alongside the others in `logExerciseFromPayload` (the
`const { ... } = payload` block, line ~58 — add `exerciseDeloaded` after `wasOverride`),
then replace the gate at lines 181–184:

```ts
  let isPR = false;
  if (shouldCountTowardPr({
    estimated1rm,
    isAnyDeload,
    isBaseline,
    exerciseDeloaded: exerciseDeloaded ?? false,
  })) {
    isPR = await repo.upsertPersonalRecordIfBetter(userId, exercise, estimated1rm);
  }
```

Estimated 1RM is still computed and stored on the exercise log (matching
whole-session deload behaviour) — it just never touches `personal_records`.

- [ ] **Step 3: Run the tests**

Run: `pnpm exec vitest run lib/__tests__/log-exercise-pr-gate.test.ts && pnpm exec tsc --noEmit && pnpm test`
Expected: all PASS.

- [ ] **Step 4: Verify the sync mirror needs no change**

Confirm (read, don't edit) that `lib/data/postgres/adapter.ts:2777-2787` still parses
`LogExercisePayloadSchema` and calls `logExerciseFromPayload` — the new optional field
flows through both paths automatically. If that branch has drifted into duplicated
logic since this plan was written, STOP and flag it instead of patching one side.

- [ ] **Step 5: Commit**

```bash
git add lib/workout/log-exercise.ts lib/__tests__/log-exercise-pr-gate.test.ts
git commit -m "Gate PRs on per-exercise deload flag

Deload-zone sets are deliberately submaximal; letting their 1RM estimate
into personal_records would poison rm1 trends and PR celebrations. The
shared logExerciseFromPayload covers both the web route and the
workout_log sync branch."
```

---

## Self-Review Notes

- **Spec coverage (Block 3 scope):** `exerciseDeloaded` on the payload, PR gate extension, estimate still stored, revert restores eligibility (flag simply absent), sync-mirror verification step — all covered. Client-side sending of the flag is Block 4 (workout screen).
- **Behaviour decision encoded in tests:** `exerciseDeloaded` has **no baseline exception** (unlike `isAnyDeload`) — a deloaded exercise inside a baseline session still never sets a PR, because the exercise itself was cut to deload numbers. This is a deliberate strictness beyond the spec's one-liner.
- **Type consistency:** predicate args mirror the local variables already present in `logExerciseFromPayload` (`estimated1rm`, `isAnyDeload`, `isBaseline`).
