# Bodyweight Rep-Based Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bodyweight exercises progress on reps (a rep max) instead of the user's fluctuating body weight, using a fixed reference weight so the existing 1RM primitives produce a rep-driven number.

**Architecture:** Bodyweight uses a constant `BW_REF` in place of real body weight; the session number is the best single set's `calc1RM` at `BW_REF + added` (no AMRAP/prescription scaling); a rep max is derived by inverting `calc1RM` at `BW_REF`; working sets are prescribed as `floor(pct × repMax)` keyed off the personal record so easy days don't lower targets. The summary shows "REP MAX" in reps.

**Tech Stack:** TypeScript, React 19, Next.js 15, Vitest.

Spec: `docs/superpowers/specs/2026-07-01-bodyweight-rep-progression-design.md`

---

## File Structure

- `lib/1rm.ts` (modify) — add `BW_REF`, `bodyweightOneRm`, `repMaxFromOneRm`. Pure.
- `lib/__tests__/1rm.test.ts` (modify) — unit tests for the three additions.
- `lib/workout/log-exercise.ts` (modify) — reference weight + best-set bodyweight estimate.
- `app/api/workout-data/route.ts` (modify) — bodyweight rep-target prescription (PR-based).
- `components/workout/exercise-summary-screen.tsx` (modify) — REP MAX display + next-session reps.

---

## Task 1: `BW_REF`, `bodyweightOneRm`, `repMaxFromOneRm`

**Files:**
- Modify: `lib/1rm.ts`
- Test: `lib/__tests__/1rm.test.ts`

- [ ] **Step 1: Write the failing tests**

Update the import line in `lib/__tests__/1rm.test.ts` to add the new symbols (it currently imports `calc1RM, calcAmrap1RM, calculate1RM, runningEstimate1RM, oneRmTrendStatus`):

```ts
import { calc1RM, calcAmrap1RM, calculate1RM, runningEstimate1RM, oneRmTrendStatus, BW_REF, bodyweightOneRm, repMaxFromOneRm } from '../1rm'
```

Append to the end of `lib/__tests__/1rm.test.ts`:

```ts
describe('bodyweightOneRm', () => {
  it('takes the best single set', () => {
    // effective weights already include BW_REF + added
    expect(bodyweightOneRm([BW_REF, BW_REF], [6, 10])).toBe(calc1RM(BW_REF, 10))
  })

  it('equals calc1RM for uniform sets', () => {
    expect(bodyweightOneRm([BW_REF, BW_REF, BW_REF], [6, 6, 6])).toBe(calc1RM(BW_REF, 6))
  })

  it('scores added weight higher than bodyweight', () => {
    expect(bodyweightOneRm([BW_REF + 20], [6])).toBeGreaterThan(bodyweightOneRm([BW_REF], [6]))
  })

  it('returns 0 when there are no valid sets', () => {
    expect(bodyweightOneRm([], [])).toBe(0)
    expect(bodyweightOneRm([BW_REF], [0])).toBe(0)
  })
})

describe('repMaxFromOneRm', () => {
  it('round-trips reps -> oneRm -> reps', () => {
    expect(repMaxFromOneRm(calc1RM(BW_REF, 10))).toBe(10)
    expect(repMaxFromOneRm(calc1RM(BW_REF, 6))).toBe(6)
    expect(repMaxFromOneRm(bodyweightOneRm([BW_REF], [12]))).toBe(12)
  })

  it('returns 0 for no estimate and clamps tiny values to 1', () => {
    expect(repMaxFromOneRm(0)).toBe(0)
    expect(repMaxFromOneRm(1)).toBe(1)
  })

  it('is monotonic — more strength never means fewer reps', () => {
    expect(repMaxFromOneRm(calc1RM(BW_REF, 12))).toBeGreaterThanOrEqual(repMaxFromOneRm(calc1RM(BW_REF, 8)))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test lib/__tests__/1rm.test.ts`
Expected: FAIL — `BW_REF`/`bodyweightOneRm`/`repMaxFromOneRm` not exported.

- [ ] **Step 3: Implement the additions**

Append to `lib/1rm.ts`:

```ts
// Fixed reference weight for bodyweight exercises. Stands in for the lifter's real
// (fluctuating) body weight so the 1RM primitives yield a number driven by reps +
// added load only. Internal — never displayed as kg.
export const BW_REF = 100

// Bodyweight session estimate = the best single set's 1RM-equivalent. `effectiveWeights`
// already include BW_REF + added load. No AMRAP/prescription scaling, so the round-trip
// reps -> estimate -> reps (via repMaxFromOneRm) is stable, and submaximal working sets
// can't drag the estimate below the best set.
export function bodyweightOneRm(effectiveWeights: number[], reps: number[]): number {
  let best = 0
  for (let i = 0; i < effectiveWeights.length; i++) {
    const w = effectiveWeights[i]
    const r = reps[i] ?? 0
    if (w > 0 && r > 0) best = Math.max(best, calc1RM(w, Math.min(r, 36)))
  }
  return mround(best, 0.25)
}

// Largest integer rep count R (1..40) whose reference-weight 1RM does not exceed
// oneRm. The +0.5 tolerance absorbs the 0.25 rounding in stored estimates. Returns 0
// when there is no estimate.
export function repMaxFromOneRm(oneRm: number): number {
  if (oneRm <= 0) return 0
  let best = 1
  for (let r = 1; r <= 40; r++) {
    if (calc1RM(BW_REF, r) <= oneRm + 0.5) best = r
    else break
  }
  return best
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test lib/__tests__/1rm.test.ts`
Expected: PASS (all suites, including the new ones).

- [ ] **Step 5: Commit**

```bash
git add lib/1rm.ts lib/__tests__/1rm.test.ts
git commit -m "Add bodyweight reference-weight 1RM and rep-max helpers"
```

---

## Task 2: Reference weight + best-set estimate in logging

**Files:**
- Modify: `lib/workout/log-exercise.ts`

- [ ] **Step 1: Add the import**

In `lib/workout/log-exercise.ts`, update the `@/lib/1rm` import (currently
`import { mround, calc1RM, amrapScaleFactor, calculate1RM } from '@/lib/1rm';`) to:

```ts
import { mround, calc1RM, amrapScaleFactor, calculate1RM, BW_REF, bodyweightOneRm } from '@/lib/1rm';
```

- [ ] **Step 2: Replace the body-weight effective-weights block**

Replace the current bodyweight block (`lib/workout/log-exercise.ts:93-103`):

```ts
  let effectiveWeights = weights;
  if (exerciseType === 'bodyweight') {
    const todayStr = todayInTz(tz);
    const from90d = toAestDay(new Date(todayMidnightUtc(tz).getTime() - 90 * 86_400_000), tz);
    const bodyMetrics = await repo.listBodyMetrics(userId, from90d, todayStr);
    const latestWeighIn = bodyMetrics
      .filter(m => m.weightKg != null)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const bodyweightKg = latestWeighIn?.weightKg ?? 0;
    effectiveWeights = weights.map(w => Math.max(0, bodyweightKg + w));
  }
```

with:

```ts
  let effectiveWeights = weights;
  if (exerciseType === 'bodyweight') {
    // Reps are the load: use a fixed reference weight instead of real body weight so
    // the estimate tracks reps + added load only, never the lifter's weigh-ins.
    effectiveWeights = weights.map(w => Math.max(1, BW_REF + w));
  }
```

- [ ] **Step 3: Add the bodyweight branch to the estimate**

Replace the estimate block (`lib/workout/log-exercise.ts:141-149`):

```ts
  let estimated1rm: number;
  let target80: number;
  if (isBaseline && effectiveWeights[0] && reps[0]) {
    const raw = calc1RM(effectiveWeights[0], Math.min(reps[0], 36));
    estimated1rm = mround(raw * amrapScaleFactor(reps[0]), 0.25);
    target80 = mround(estimated1rm * 0.8, 0.25);
  } else {
    ;({ estimated1rm, target80 } = calculate1RM(effectiveWeights, reps, progressionStyle));
  }
```

with:

```ts
  let estimated1rm: number;
  let target80: number;
  if (exerciseType === 'bodyweight') {
    // Best-set rep-max-equivalent; AMRAP/prescription scaling deliberately omitted.
    estimated1rm = bodyweightOneRm(effectiveWeights, reps);
    target80 = mround(estimated1rm * 0.8, 0.25);
  } else if (isBaseline && effectiveWeights[0] && reps[0]) {
    const raw = calc1RM(effectiveWeights[0], Math.min(reps[0], 36));
    estimated1rm = mround(raw * amrapScaleFactor(reps[0]), 0.25);
    target80 = mround(estimated1rm * 0.8, 0.25);
  } else {
    ;({ estimated1rm, target80 } = calculate1RM(effectiveWeights, reps, progressionStyle));
  }
```

- [ ] **Step 4: Verify type-check and lint**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v web-push`
Expected: no output. (If `toAestDay`, `todayMidnightUtc`, or `repo.listBodyMetrics` are now unused *and* eslint errors on them, remove the now-dead imports; unused-var is a warning here, so this is optional.)

Run: `pnpm lint 2>&1 | grep "log-exercise" | grep -i error`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add lib/workout/log-exercise.ts
git commit -m "Use reference weight and best-set estimate for bodyweight logging"
```

---

## Task 3: Bodyweight rep-target prescription in workout-data

**Files:**
- Modify: `app/api/workout-data/route.ts`

- [ ] **Step 1: Add the import**

In `app/api/workout-data/route.ts`, add to the `@/lib/1rm` imports (or add a new import line if none exists):

```ts
import { repMaxFromOneRm } from "@/lib/1rm";
```

- [ ] **Step 2: Fetch personal records once**

Find the batch fetch around `app/api/workout-data/route.ts:143-146` (the `Promise.all([...])` that includes `repo.getLastExerciseLogsBatch(...)`). Add `repo.listPersonalRecords(userId)` to that array and destructure it. For example, if it currently reads:

```ts
  const [phaseList, lastLogs, todayNames, sessionPeriodization] = await Promise.all([
    isAutomatic ? repo.listProgramPhases(program.id) : Promise.resolve([] as ProgramPhase[]),
    repo.getLastExerciseLogsBatch(userId, exerciseNames),
    repo.getDayExerciseNames(userId, todayStr.replace(/-/g, '/')),
    isAiDynamic ? repo.getSessionPeriodization(userId, programSession.id) : Promise.resolve(null),
  ]);
```

change it to:

```ts
  const [phaseList, lastLogs, todayNames, sessionPeriodization, prMap] = await Promise.all([
    isAutomatic ? repo.listProgramPhases(program.id) : Promise.resolve([] as ProgramPhase[]),
    repo.getLastExerciseLogsBatch(userId, exerciseNames),
    repo.getDayExerciseNames(userId, todayStr.replace(/-/g, '/')),
    isAiDynamic ? repo.getSessionPeriodization(userId, programSession.id) : Promise.resolve(null),
    repo.listPersonalRecords(userId),
  ]);
```

(If the destructuring uses different variable names, keep them and just append `, prMap` and the `repo.listPersonalRecords(userId)` call in the same position.)

- [ ] **Step 3: Override reps for bodyweight before the return**

In the per-exercise `.map` (`app/api/workout-data/route.ts:262`), locate `const libEntry = libByName.get(ex.exerciseName.toLowerCase())` (around line 307), which sits just before `return {`. Immediately after that line, insert:

```ts
      // Bodyweight: prescribe reps as % of the rep max (from the personal record so an
      // easy day never lowers targets), round down, min 1.
      const bwType = libEntry?.exerciseType ?? 'weighted';
      if (bwType === 'bodyweight' && progressionStyle && !isBaselinePhase) {
        const basis = Math.max(lastLog?.estimated1rm ?? 0, prMap.get(ex.exerciseName) ?? 0);
        const repMax = repMaxFromOneRm(basis);
        if (repMax > 0) {
          progressionStyle = progressionStyle.map(s => ({
            ...s,
            reps: Math.max(1, Math.floor((s.pct / 100) * repMax)),
          }));
        }
      }
```

- [ ] **Step 4: Verify type-check and lint**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v web-push`
Expected: no output. (If `prMap.get` complains about the Map value type, note `listPersonalRecords` returns `Map<string, number>`, so `prMap.get(name)` is `number | undefined` — the `?? 0` handles it.)

Run: `pnpm lint 2>&1 | grep "workout-data" | grep -i error`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add app/api/workout-data/route.ts
git commit -m "Prescribe bodyweight sets as reps off the rep max"
```

---

## Task 4: REP MAX display + next-session reps in the summary

**Files:**
- Modify: `components/workout/exercise-summary-screen.tsx`

- [ ] **Step 1: Add the import**

In `components/workout/exercise-summary-screen.tsx`, add:

```ts
import { repMaxFromOneRm } from "@/lib/1rm";
```

- [ ] **Step 2: Compute bodyweight display values**

After the existing `rmColor` computation (`components/workout/exercise-summary-screen.tsx:56-63`), add:

```ts
  const isBodyweight = exerciseType === "bodyweight";
  const prevRepMax = prevEst1rm != null ? repMaxFromOneRm(prevEst1rm) : null;
  const newRepMax = repMaxFromOneRm(newEst1rm);
  const repDiff = prevRepMax != null ? newRepMax - prevRepMax : null;
  const previewRepMax = repMaxFromOneRm(Math.max(newEst1rm, prevEst1rm ?? 0));
```

- [ ] **Step 3: Swap the "Estimated 1RM" block to show REP MAX for bodyweight**

Replace the estimate-comparison block (`components/workout/exercise-summary-screen.tsx:133-155`):

```tsx
        {/* Estimated 1RM comparison */}
        <div className="rounded-xl bg-muted px-3 py-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Estimated 1RM</p>
            {rmDiff != null && Math.abs(rmDiff) > 0.1 && (
              <p className={cn("text-[10px] font-medium", rmColor)}>
                {rmDiff > 0 ? `+${rmDiff.toFixed(2)} kg` : `${rmDiff.toFixed(2)} kg`}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">Previous</p>
              <p className="text-base font-bold tabular-nums">
                {prevEst1rm != null ? `${prevEst1rm} kg` : "—"}
              </p>
            </div>
            {rmArrow && <span className={cn("text-xl font-bold", rmColor)}>{rmArrow}</span>}
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">This session</p>
              <p className={cn("text-base font-bold tabular-nums", rmColor)}>{newEst1rm} kg</p>
            </div>
          </div>
```

with:

```tsx
        {/* Estimated 1RM (weighted) / Rep max (bodyweight) comparison */}
        <div className="rounded-xl bg-muted px-3 py-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {isBodyweight ? "Rep Max" : "Estimated 1RM"}
            </p>
            {isBodyweight
              ? repDiff != null && repDiff !== 0 && (
                  <p className={cn("text-[10px] font-medium", rmColor)}>
                    {repDiff > 0 ? `+${repDiff} rep${Math.abs(repDiff) === 1 ? "" : "s"}` : `${repDiff} rep${Math.abs(repDiff) === 1 ? "" : "s"}`}
                  </p>
                )
              : rmDiff != null && Math.abs(rmDiff) > 0.1 && (
                  <p className={cn("text-[10px] font-medium", rmColor)}>
                    {rmDiff > 0 ? `+${rmDiff.toFixed(2)} kg` : `${rmDiff.toFixed(2)} kg`}
                  </p>
                )}
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">Previous</p>
              <p className="text-base font-bold tabular-nums">
                {isBodyweight
                  ? (prevRepMax != null ? `${prevRepMax} RM` : "—")
                  : (prevEst1rm != null ? `${prevEst1rm} kg` : "—")}
              </p>
            </div>
            {rmArrow && <span className={cn("text-xl font-bold", rmColor)}>{rmArrow}</span>}
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">This session</p>
              <p className={cn("text-base font-bold tabular-nums", rmColor)}>
                {isBodyweight ? `${newRepMax} RM` : `${newEst1rm} kg`}
              </p>
            </div>
          </div>
```

- [ ] **Step 4: Show the next-session block for bodyweight with rep targets**

Replace the next-session block (`components/workout/exercise-summary-screen.tsx:166-191`):

```tsx
        {/* Next session targets */}
        {exerciseType !== "bodyweight" && (
          <div className="rounded-xl border border-brand/25 bg-brand/5 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Next Session
            </p>
            {ps && ps.length > 0 ? (
              <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(ps.length, 5)}, 1fr)` }}>
                {ps.slice(0, 5).map((s, i) => (
                  <div key={i} className="rounded-lg bg-muted/60 border border-border/60 px-1.5 py-2 text-center">
                    <p className="text-[9px] text-muted-foreground mb-0.5">S{i + 1}</p>
                    <p className="text-xs font-bold tabular-nums leading-tight" style={{ color: "var(--color-brand)" }}>
                      {mround125Up((newEst1rm * s.pct) / 100)} kg
                    </p>
                    <p className="text-[9px] text-muted-foreground">{s.reps}r</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Target (80% 1RM)</p>
                <p className="text-lg font-bold text-brand tabular-nums">{target80} kg</p>
              </div>
            )}
          </div>
        )}
```

with:

```tsx
        {/* Next session targets */}
        {(!isBodyweight || (ps && ps.length > 0)) && (
          <div className="rounded-xl border border-brand/25 bg-brand/5 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Next Session
            </p>
            {ps && ps.length > 0 ? (
              <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(ps.length, 5)}, 1fr)` }}>
                {ps.slice(0, 5).map((s, i) => (
                  <div key={i} className="rounded-lg bg-muted/60 border border-border/60 px-1.5 py-2 text-center">
                    <p className="text-[9px] text-muted-foreground mb-0.5">S{i + 1}</p>
                    {isBodyweight ? (
                      <p className="text-xs font-bold tabular-nums leading-tight" style={{ color: "var(--color-brand)" }}>
                        {Math.max(1, Math.floor((previewRepMax * s.pct) / 100))} reps
                      </p>
                    ) : (
                      <>
                        <p className="text-xs font-bold tabular-nums leading-tight" style={{ color: "var(--color-brand)" }}>
                          {mround125Up((newEst1rm * s.pct) / 100)} kg
                        </p>
                        <p className="text-[9px] text-muted-foreground">{s.reps}r</p>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Target (80% 1RM)</p>
                <p className="text-lg font-bold text-brand tabular-nums">{target80} kg</p>
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 5: Verify type-check and lint**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v web-push`
Expected: no output.

Run: `pnpm lint 2>&1 | grep "exercise-summary-screen" | grep -i error`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add components/workout/exercise-summary-screen.tsx
git commit -m "Show rep max and rep-based next-session targets for bodyweight"
```

---

## Task 5: Verify end-to-end and push

**Files:** none (verification only)

- [ ] **Step 1: Run the unit suite**

Run: `pnpm test lib/__tests__/1rm.test.ts`
Expected: PASS (all suites).

- [ ] **Step 2: Boot the dev server**

Run (background shell):

```bash
unset DATABASE_URL DATABASE_SSL
export DATABASE_URL="postgresql://postgres:postgres@localhost:5433/trainingai_dev"
pnpm dev
```

Wait for `Local: http://localhost:3000`, then confirm the workout route compiles:

Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/workout?session=13065248-689d-4f5e-8b12-aaab410f5683" --max-time 40`
Expected: `307` and no compile errors in the dev log.

- [ ] **Step 3: Manual UI check**

The seeded program has weighted exercises only, so add a bodyweight exercise to test
(or confirm behaviour by driving a bodyweight exercise if one exists). Verify:
- Log a baseline/AMRAP set (e.g. 10 reps) → summary shows "REP MAX 10 RM", not kg.
- Next session shows per-set **rep** targets = `floor(pct × 10)` (e.g. 80% → 8 reps).
- An easy/submaximal session does not lower next session's targets (PR-based).
- Beating the rep max raises the targets next time.
- Changing `body_metrics.weight_kg` in the local DB no longer moves the bodyweight number.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin claude/screen-safe-spacing-pokr38
```

---

## Implementation notes (discovered during build)

- **Client-side estimate (added task):** the exercise summary derives its rep max from
  `newEst1rm`, which is computed **client-side** in `components/workout-screen.tsx`
  (not only server-side in `log-exercise.ts`). `calculate1RM` on the bodyweight
  per-set weights (all 0) returns 0, so the client must mirror the server: compute
  `bodyweightOneRm(snapWeights.map(w => Math.max(1, BW_REF + w)), snapReps)` for
  bodyweight. Without this the summary showed "0 RM".
- **Next-session preview (refinement):** the preview uses
  `Math.max(s.reps, Math.floor((repMaxFromOneRm(newEst1rm) * s.pct) / 100))` where
  `s.reps` is the route's current PR-based prescription — so the preview never shows a
  lower target after a submaximal session, only a higher one if this session implies a
  bigger rep max.

## Self-Review Notes

- **Spec coverage:** reference weight (Task 2); best-set estimate (Task 1 `bodyweightOneRm` + Task 2); rep max derivation (Task 1 `repMaxFromOneRm`); PR-based rep prescription with floor/min-1 (Task 3); baseline AMRAP unchanged (Task 2 leaves the baseline/else branches for non-bodyweight and bodyweight computes from the single logged set); added weight via `BW_REF + w` (Task 2); REP MAX display + next-session reps (Task 4); tests (Task 1, Task 5). All spec sections map to a task.
- **Type consistency:** `BW_REF` (number), `bodyweightOneRm(effectiveWeights, reps)`, `repMaxFromOneRm(oneRm)` are used identically across tasks. `prMap` is `Map<string, number>` (from `listPersonalRecords`); `progressionStyle` items keep their `StyleSet` shape (spread `...s`, only `reps` overridden). `exerciseType`/`isBodyweight` derive from the same `ExerciseType`.
- **No placeholders:** every code step shows complete code.
