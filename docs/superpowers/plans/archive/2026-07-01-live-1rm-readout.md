# Live 1RM Readout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small live widget under the rest-timer ring that shows the running average weight × reps and the projected 1RM (matching the saved session number), colour-coded vs the previous 1RM.

**Architecture:** A pure helper `runningEstimate1RM` in `lib/1rm.ts` wraps the existing `calculate1RM` (fed the sets logged so far) so the projection matches what the app saves; a pure `oneRmTrendStatus` classifies it vs the previous 1RM. A small presentational component `Live1rmReadout` computes the display averages, calls those helpers, and renders one colour-coded line. It's rendered in the rest phase of `active-workout-screen.tsx`.

**Tech Stack:** TypeScript, React 19, Next.js 15, Tailwind v4, Vitest.

Spec: `docs/superpowers/specs/2026-07-01-live-1rm-readout-design.md`

---

## File Structure

- `lib/1rm.ts` (modify) — add `runningEstimate1RM` and `oneRmTrendStatus` + `OneRmTrend` type. Pure functions, no UI.
- `lib/__tests__/1rm.test.ts` (modify) — unit tests for both new functions.
- `components/workout/live-1rm-readout.tsx` (create) — presentational widget.
- `components/workout/active-workout-screen.tsx` (modify) — render the widget in the rest phase.

---

## Task 1: `runningEstimate1RM` helper

**Files:**
- Modify: `lib/1rm.ts`
- Test: `lib/__tests__/1rm.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the top import line of `lib/__tests__/1rm.test.ts` (replace the existing import):

```ts
import { calc1RM, calcAmrap1RM, calculate1RM, runningEstimate1RM } from '../1rm'
```

Append this block to the end of `lib/__tests__/1rm.test.ts`:

```ts
describe('runningEstimate1RM', () => {
  it('equals calc1RM for a single logged set', () => {
    expect(runningEstimate1RM([100], [5])).toBe(calc1RM(100, 5))
  })

  it('averages uniform sets to the same value as one set', () => {
    expect(runningEstimate1RM([100, 100], [5, 5])).toBe(calc1RM(100, 5))
  })

  it('averages per-set 1RMs, not the averaged inputs (mixed reps)', () => {
    const perSet = calculate1RM([100, 100], [5, 12]).estimated1rm
    expect(runningEstimate1RM([100, 100], [5, 12])).toBe(perSet)
    // averaged-inputs calc from (avgWeight, avgReps) would differ
    expect(runningEstimate1RM([100, 100], [5, 12])).not.toBe(calc1RM(100, 8.5))
  })

  it('falls back to all logged sets when the useFor1rm subset yields nothing', () => {
    const weights = [100, 100]
    const reps = [35, 6] // set 0 is >30 reps → excluded by the formula
    const style = [
      { pct: 100, reps: 5, useFor1rm: true },
      { pct: 100, reps: 5, useFor1rm: false },
    ]
    // Only the flagged set counts, but it is excluded (>30 reps) → primary is 0
    expect(calculate1RM(weights, reps, style).estimated1rm).toBe(0)
    // Fallback re-runs ignoring useFor1rm → set 1 counts
    const flat = calculate1RM(weights, reps, [
      { pct: 100, reps: 5 },
      { pct: 100, reps: 5 },
    ]).estimated1rm
    expect(flat).toBeGreaterThan(0)
    expect(runningEstimate1RM(weights, reps, style)).toBe(flat)
  })

  it('returns 0 for no logged sets', () => {
    expect(runningEstimate1RM([], [])).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test lib/__tests__/1rm.test.ts`
Expected: FAIL — `runningEstimate1RM is not a function` / import error.

- [ ] **Step 3: Implement the helper**

Append to `lib/1rm.ts` (after `calculate1RM`):

```ts
// Live per-set running estimate: the same calculate1RM the app saves, fed the
// sets logged so far, so the widget's number matches the summary exactly. If a
// useFor1rm-subset style hasn't logged a qualifying set yet (estimate is 0),
// fall back to averaging all logged sets so a number always shows from set 1.
export function runningEstimate1RM(
  weights: number[],
  reps: number[],
  style?: RMStyleSet[] | null,
): number {
  const primary = calculate1RM(weights, reps, style).estimated1rm
  if (primary > 0) return primary
  const flat = style?.map(s => ({ pct: s.pct, reps: s.reps }))
  return calculate1RM(weights, reps, flat).estimated1rm
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test lib/__tests__/1rm.test.ts`
Expected: PASS (all `runningEstimate1RM` tests green).

- [ ] **Step 5: Commit**

```bash
git add lib/1rm.ts lib/__tests__/1rm.test.ts
git commit -m "Add runningEstimate1RM helper for live per-set 1RM projection"
```

---

## Task 2: `oneRmTrendStatus` helper

**Files:**
- Modify: `lib/1rm.ts`
- Test: `lib/__tests__/1rm.test.ts`

- [ ] **Step 1: Write the failing tests**

Update the import line in `lib/__tests__/1rm.test.ts` to add the new symbol:

```ts
import { calc1RM, calcAmrap1RM, calculate1RM, runningEstimate1RM, oneRmTrendStatus } from '../1rm'
```

Append to the end of `lib/__tests__/1rm.test.ts`:

```ts
describe('oneRmTrendStatus', () => {
  it('is "none" when there is no previous 1RM', () => {
    expect(oneRmTrendStatus(76.25, null)).toBe('none')
    expect(oneRmTrendStatus(76.25, 0)).toBe('none')
  })

  it('is "up" when projected is clearly above previous', () => {
    expect(oneRmTrendStatus(76.25, 66.75)).toBe('up')
  })

  it('is "down" when projected is clearly below previous', () => {
    expect(oneRmTrendStatus(64.0, 66.75)).toBe('down')
  })

  it('is "even" within ±0.5 kg', () => {
    expect(oneRmTrendStatus(66.75, 66.5)).toBe('even')
    expect(oneRmTrendStatus(66.25, 66.75)).toBe('even')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test lib/__tests__/1rm.test.ts`
Expected: FAIL — `oneRmTrendStatus is not a function`.

- [ ] **Step 3: Implement the helper**

Append to `lib/1rm.ts`:

```ts
export type OneRmTrend = 'up' | 'even' | 'down' | 'none'

// Classify a live projection against the previous 1RM. ±0.5 kg counts as even so
// the colour doesn't flicker on a near-match.
export function oneRmTrendStatus(projected: number, previous: number | null): OneRmTrend {
  if (previous == null || previous <= 0) return 'none'
  const diff = projected - previous
  if (diff > 0.5) return 'up'
  if (diff < -0.5) return 'down'
  return 'even'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test lib/__tests__/1rm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/1rm.ts lib/__tests__/1rm.test.ts
git commit -m "Add oneRmTrendStatus for live 1RM colour classification"
```

---

## Task 3: `Live1rmReadout` component

**Files:**
- Create: `components/workout/live-1rm-readout.tsx`

- [ ] **Step 1: Create the component**

Create `components/workout/live-1rm-readout.tsx`:

```tsx
import { mround, runningEstimate1RM, oneRmTrendStatus, type RMStyleSet } from "@/lib/1rm";

interface Live1rmReadoutProps {
  /** Logged set weights so far, in order. */
  weights: number[];
  /** Logged set performed reps so far, in order. */
  reps: number[];
  style: RMStyleSet[] | null;
  previousEst1rm: number | null;
}

const TREND_COLOR = {
  up: "#22c55e",
  down: "#ef4444",
  even: "var(--color-brand)",
  none: "var(--color-brand)",
} as const;

export function Live1rmReadout({ weights, reps, style, previousEst1rm }: Live1rmReadoutProps) {
  if (weights.length === 0) return null;
  const projected = runningEstimate1RM(weights, reps, style);
  if (projected <= 0) return null;

  const avgWeight = mround(weights.reduce((a, b) => a + b, 0) / weights.length, 0.25);
  const avgRepsRaw = reps.reduce((a, b) => a + b, 0) / reps.length;
  const avgReps = Number.isInteger(avgRepsRaw) ? `${avgRepsRaw}` : avgRepsRaw.toFixed(1);

  const status = oneRmTrendStatus(projected, previousEst1rm);
  const color = TREND_COLOR[status];
  const diff = previousEst1rm != null ? projected - previousEst1rm : null;
  const showDelta = diff != null && status !== "none" && Math.abs(diff) > 0.5;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[13px]">
      <span className="text-muted-foreground tabular-nums">
        Ø {avgWeight} kg × {avgReps} reps
      </span>
      <span className="text-muted-foreground">=</span>
      <span className="font-bold tabular-nums" style={{ color }}>
        {projected} kg
      </span>
      {showDelta && (
        <span className="font-semibold tabular-nums" style={{ color }}>
          {status === "up" ? "▲" : "▼"} {diff! > 0 ? "+" : "−"}
          {Math.abs(diff!).toFixed(2)} kg
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit 2>&1 | grep -v web-push | grep "live-1rm-readout"`
Expected: no output (no type errors in the new file). The pre-existing `web-push` error is unrelated.

- [ ] **Step 3: Commit**

```bash
git add components/workout/live-1rm-readout.tsx
git commit -m "Add Live1rmReadout presentational component"
```

---

## Task 4: Render the widget in the rest phase

**Files:**
- Modify: `components/workout/active-workout-screen.tsx`

- [ ] **Step 1: Add the import**

At the top of `components/workout/active-workout-screen.tsx`, add after the `SetCard` import (line 8):

```tsx
import { Live1rmReadout } from "./live-1rm-readout";
```

- [ ] **Step 2: Render it under the rest ring**

In the rest-phase block, find the closing of the ring button and its caption (the `<p>` ending with `"Tap to start early"`), which sits inside `<div className="flex flex-col items-center">`. Immediately after that closing `</p>` and before the closing `</div>` of that flex column, insert:

```tsx
                  {currentSet >= 1 && exercise?.exerciseType !== "bodyweight" && (
                    <Live1rmReadout
                      weights={Array.from({ length: currentSet }, (_, i) => weightFor(i))}
                      reps={reps.slice(0, currentSet)}
                      style={exercise?.progressionStyle?.slice(0, currentSet) ?? null}
                      previousEst1rm={exercise?.estimated1rm ?? null}
                    />
                  )}
```

For reference, the surrounding block currently ends like this (the widget goes between the caption `<p>` and the `</div>`):

```tsx
                  <p className="text-xs mt-3 opacity-60" style={{ color: isRestOvertime ? "#ef4444" : "var(--color-muted-foreground)" }}>
                    {isRestOvertime ? "Rest complete · Tap to start" : "Tap to start early"}
                  </p>
                  {/* Live1rmReadout inserted here */}
                </div>
              )}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v web-push`
Expected: no output (only the pre-existing `web-push` error exists, which is filtered out).

- [ ] **Step 4: Run lint**

Run: `pnpm lint 2>&1 | grep -E "live-1rm-readout|active-workout-screen" | grep -i error`
Expected: no output (no new lint errors).

- [ ] **Step 5: Commit**

```bash
git add components/workout/active-workout-screen.tsx
git commit -m "Show live 1RM readout under the rest timer"
```

---

## Task 5: Manual verification and push

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit test suite**

Run: `pnpm test lib/__tests__/1rm.test.ts`
Expected: PASS — all `runningEstimate1RM` and `oneRmTrendStatus` tests green.

- [ ] **Step 2: Start the dev server against the local seeded DB**

Run (in a background shell):

```bash
unset DATABASE_URL DATABASE_SSL
export DATABASE_URL="postgresql://postgres:postgres@localhost:5433/trainingai_dev"
pnpm dev
```

Wait for `Local: http://localhost:3000`.

- [ ] **Step 2: Verify the workout route compiles**

Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/workout?session=test" --max-time 40`
Expected: `307` (redirect to sign-in — the route compiled with no error). Check the dev log shows no compile errors.

- [ ] **Step 3: Manual UI check**

Sign in as the seeded user (`test@local.dev` / `testpass123`), start a workout, and log the first set of a non-bodyweight exercise. During the rest phase, confirm:
- A line appears under the rest ring: `Ø <weight> kg × <reps> reps = <1RM> kg  ▲/▼ <delta> kg`.
- It is green when the projection is at/above the previous 1RM, red when below.
- After logging all sets, the projected value equals the exercise-summary screen's "This session" number.
- It does **not** appear for a bodyweight exercise.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin claude/screen-safe-spacing-pokr38
```

---

## Self-Review Notes

- **Spec coverage:** placement/visibility (Task 4 guards: rest phase, `currentSet >= 1`, non-bodyweight); display format (Task 3 JSX); session-matching calc + fallback (Task 1); colour thresholds (Task 2); files & tests (Tasks 1–3). All spec sections map to a task.
- **Type consistency:** `runningEstimate1RM(weights, reps, style)`, `oneRmTrendStatus(projected, previous)`, `OneRmTrend`, and `RMStyleSet` are used with identical signatures across the helper, tests, and component. `exercise.progressionStyle` (`StyleSet[]`) is structurally assignable to `RMStyleSet[]`.
- **No placeholders:** every code step shows complete code.
