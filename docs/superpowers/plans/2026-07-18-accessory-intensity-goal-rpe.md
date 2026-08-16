# Accessory Intensity — Goal-Aware Bands + RPE-Targeted Load

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Re-verify before building (plans go stale):** confirm the current line numbers/shapes of `lib/ai-periodization/goal-ranges.ts`, `lib/ai-periodization/expected-rpe.ts`, `lib/ai-periodization/prompt.ts` (`intensityZoneForRole`), the accessory-clamp block in `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`, and the accessory-style block in `app/api/workout-data/route.ts` against `main` before editing. The task line references below are anchors, not guarantees.

**Goal:** Make accessory exercises target a *productive, goal-appropriate effort* instead of a single hardcoded light band. Today every goal prescribes accessories from one constant — `ACCESSORY = { pctMin: 55, pctMax: 75, repMin: 8, repMax: 15 }` (`lib/ai-periodization/goal-ranges.ts:26`) — whose low end produces the owner's complaint: a 60% × 12 accessory reads as "RPE 6 · Light" and stays there. After this change, accessories are (a) **goal-aware** (a strength program's accessories sit heavier than a hypertrophy program's) and (b) **prescribed by target RPE, not fixed %1RM** — the load floats to whatever produces the goal's target effort at the chosen reps, so the same difficulty is hit across rep ranges. Primary and secondary compounds are **untouched**.

**Non-goals (explicitly out of scope — the owner deferred these):** per-muscle-group intensity profiles (abs/calves/delts each getting their own rep/% map) are NOT part of this plan. Intensity stays keyed on `(goal, phase, role)`; muscle group has no influence. See "Limitations & follow-ups".

**Architecture:** One new deterministic formula — the **inverse** of the existing reps-aware `expectedRpe(pct, reps)` — computes the %1RM that yields a target RPE at a given rep count. Per-goal accessory config (rep band + target RPE) lives beside the existing goal zones. Two application points consume it: the AI prescription path (`prescribe/route.ts`, the app's live progression engine) and the base-style accessory path (`workout-data/route.ts`, so AI-dynamic sessions are correct even before/without a generated prescription). No migration, no schema change, no new synced column, no cache-group change — this is pure prescription math on data already flowing through these routes.

**Tech Stack:** TypeScript, Vitest (unit). No new deps, no DB, no client changes. The workout screen's "expected RPE" slider readout (`expectedRpe(intensityPct, reps)`) needs no edit — it will simply show ~8 once the prescribed `intensityPct` is derived to produce ~8.

---

## Design decisions

### D1 — Prescribe accessories by target RPE, deriving the load (chosen)

`expectedRpe(pct, reps)` (`lib/ai-periodization/expected-rpe.ts:34`) already models effort as `10 − RIR`, where `RIR = maxRepsAtPct(pct) − reps`. It is monotonic and cleanly invertible: to hit `targetRpe` at `reps`, we need `RIR = 10 − targetRpe`, i.e. `maxReps = reps + (10 − targetRpe)`, and at failure `repFactor(maxReps) = 100 / pct`. So:

```
pctForExpectedRpe(targetRpe, reps) = 100 / repFactor(reps + (10 − targetRpe))
```

This is the exact algebraic inverse of the model already in the codebase (same `repFactor` curve from `lib/1rm.ts`), so the readout and the derivation can never diverge — a One-Formula-One-Place guarantee, not a coincidence. Prescribing accessories this way is what makes "same difficulty, different rep ranges" literally true: at RPE 8, 12 reps → ~66%, 15 reps → ~61%, 8 reps → ~74% — constant effort, floating load.

**Rejected alternative:** hardcoding higher per-goal % bands directly (no RPE inverse). Rejected because a fixed % produces *different* RPE at different rep counts (the exact bug we're fixing — 60% is RPE 6 at 12 reps but RPE 8.3 at 15), and it would drift from the `expectedRpe` readout the moment either side is edited.

### D2 — Goal-aware accessory targets

Replace the single `ACCESSORY` constant with a per-goal `{ repMin, repMax }` band **plus** a per-goal `targetRpe`. The pct band shown/clamped is then *derived* from the target RPE at the rep-band edges via D1, so there is still a single source of truth (the RPE target), not a second hand-tuned number. Suggested starting values (implementer may tune — these are all genuinely challenging, ≥ RPE 7.5, and skew by goal):

| Goal | Accessory reps | Target RPE | Derived pct band (≈, via D1) |
|---|---|---|---|
| `strength` | 6–10 | 8.0 | ~70–80% |
| `powerbuilding` | 8–12 | 8.0 | ~66–75% |
| `strength+hypertrophy` | 8–12 | 8.5 | ~68–77% |
| `hypertrophy` | 10–15 | 8.5 | ~61–72% |
| `power` | 6–10 | 7.5 | ~67–77% |
| `endurance` | 12–20 | 8.0 | ~52–65% |

(The derived-pct column is illustrative; the code computes it — do not hardcode it.)

### D3 — Two application points

- **Primary — AI prescription** (`prescribe/route.ts`, the accessory-clamp loop `:312-322`). After autoregulation settles each accessory's reps, **override** the accessory's `pct` to `round0.5(clamp(pctForExpectedRpe(accessoryTargetRpe(goal), reps), 40, 85))`. This replaces the current `clampPrescribedPct(a.pct, exZone)` for accessories (which today wrongly clamps them into the *primary* zone — see D4). Compounds keep the existing clamp untouched.
- **Secondary — base-style accessories** (`workout-data/route.ts`, the `isAiDynamic` accessory block near `:436`). When `isAiDynamic` and the exercise role is `accessory`, derive the accessory's per-set `pct` from the RPE target the same way, so an AI-dynamic session shows the right effort **even before the first prescription is generated or when the accessory is absent from the current prescription** (exactly the state that produces the owner's live 60% reading). This mirrors the existing precedent at `:436` where `lastSetMode` is applied to base-style accessories "whether the AI prescription is driving or the session is still on the base style".

### D4 — Fix the `intensityZoneForRole` accessory gap (incidental correctness)

`intensityZoneForRole(goal, phase, 'accessory')` (`prompt.ts:87-91`) currently returns the **primary** zone for accessories (it only special-cases `'secondary'`). That means the pct clamp in the prescribe route would floor an accessory around `primary.pctMin × 0.9` (~65% for powerbuilding accumulation) — inconsistent with the 55–75% accessory rep-band notion in `goal-ranges.ts`, and it would fight the D3 override. This plan makes `intensityZoneForRole` return an **accessory-appropriate** zone (built from the D2 band) so the two intensity notions agree. This is why the fix belongs here and not as a separate ticket — leaving it returning the primary zone would silently re-clamp the D3 override.

### D5 — Autoregulation interaction (intended, documented)

Under RPE-targeting, an accessory is always prescribed *at* its target RPE, so the autoregulation "RPE ran low → +reps" push (`autoregulation.ts:79-102`) will rarely fire for accessories (delta ≈ 0) — that is **intended**: constant effort, with progression coming from the load floating up as the estimated 1RM grows (`pct × 1RM` where `1RM` rises from the `plus1` last-set push). Reps still climb within the goal's accessory band when the model/autoreg raises them, and the pct is re-derived at the new rep count so effort stays constant. No autoreg code changes; verify the existing autoreg tests still pass and add one asserting an accessory stays near target RPE across a rep bump.

### D6 — What this does NOT fix (be honest in the PR)

The "expected RPE" readout is a function of the **prescribed** `intensityPct`. This plan changes how that pct is derived for accessories in the **AI-dynamic** paths. An accessory pinned to a purely **static** progression style on a **non-AI-dynamic** program keeps its stored style % — its stored 60% is per-user DB data, not code. For the owner's program (which is AI-dynamic — it shows periodization phases), D3's base-style path makes the accessory read correctly. Retro-fixing stored static styles on non-AI programs is a flagged follow-up (see Limitations), not built here.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `lib/ai-periodization/expected-rpe.ts` | **Modify** | Add `pctForExpectedRpe(targetRpe, reps)` — the algebraic inverse of `expectedRpe`. |
| `lib/__tests__/expected-rpe.test.ts` | **Modify** | Add round-trip tests (`expectedRpe(pctForExpectedRpe(r, n), n) ≈ r`) + edge cases. |
| `lib/ai-periodization/goal-ranges.ts` | **Modify** | Replace single `ACCESSORY` with per-goal `{repMin,repMax}` + `targetRpe`; derive the accessory pct band via `pctForExpectedRpe`; export `accessoryTargetRpe(goal)`. |
| `lib/__tests__/goal-ranges.test.ts` | **Modify** | Per-goal accessory bands differ by goal; derived band round-trips to the target RPE. |
| `lib/ai-periodization/prompt.ts` | **Modify** (`intensityZoneForRole` `:87-91`) | Return an accessory-appropriate zone for `role === 'accessory'` (built from the goal accessory band), not the primary zone. |
| `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts` | **Modify** (`:312-322`) | For accessories, override pct to the RPE-target-derived value after reps settle; compounds unchanged. |
| `app/api/workout-data/route.ts` | **Modify** (accessory block near `:436`) | For `isAiDynamic` accessories on the base style, derive per-set pct from the goal target RPE. |
| `lib/workout/known-styles.ts` | **Modify** (`GOAL_STYLE_RULES` `:81-91`) — *optional, low-risk* | Note-only reconciliation: ensure newly-generated programs' accessory styles aren't lighter than the target. See Task 5 (may be a no-op after review). |

No migration. No `lib/cache-groups.ts` / `lib/cache-ttl.ts` change. No client component change.

---

## Task 1: Invert the RPE model — `pctForExpectedRpe`

**Files:** Modify `lib/ai-periodization/expected-rpe.ts`; Modify `lib/__tests__/expected-rpe.test.ts`

- [ ] **Step 1: Write the failing test.** Add to `lib/__tests__/expected-rpe.test.ts`:

```ts
import { expectedRpe, pctForExpectedRpe } from '@/lib/ai-periodization/expected-rpe'

describe('pctForExpectedRpe', () => {
  it('round-trips with expectedRpe (within 0.3 RPE) across rep ranges', () => {
    for (const targetRpe of [7, 8, 8.5, 9]) {
      for (const reps of [6, 8, 10, 12, 15]) {
        const pct = pctForExpectedRpe(targetRpe, reps)
        expect(Math.abs(expectedRpe(pct, reps) - targetRpe)).toBeLessThanOrEqual(0.3)
      }
    }
  })

  it('holds effort constant as reps rise — more reps => lighter load', () => {
    const at8 = pctForExpectedRpe(8, 8)
    const at12 = pctForExpectedRpe(8, 12)
    const at15 = pctForExpectedRpe(8, 15)
    expect(at8).toBeGreaterThan(at12)
    expect(at12).toBeGreaterThan(at15)
  })

  it('reproduces the reference case: RPE 8 @ 12 reps ≈ 66%', () => {
    expect(pctForExpectedRpe(8, 12)).toBeGreaterThan(63)
    expect(pctForExpectedRpe(8, 12)).toBeLessThan(69)
  })
})
```

- [ ] **Step 2: Run to verify it fails** (`pnpm exec vitest run lib/__tests__/expected-rpe.test.ts`) — FAIL: `pctForExpectedRpe` is not exported.

- [ ] **Step 3: Implement.** Add to `lib/ai-periodization/expected-rpe.ts` (after `expectedRpe`):

```ts
// Inverse of expectedRpe: the %1RM at which performing `reps` reps yields ~targetRpe.
// expectedRpe(pct, reps) = 10 − (maxRepsAtPct(pct) − reps); solving for pct at a target
// RPE gives maxReps = reps + (10 − targetRpe), and at failure repFactor(maxReps) = 100/pct.
// Same repFactor curve as expectedRpe/the 1RM math, so the two can never drift.
export function pctForExpectedRpe(targetRpe: number, reps: number): number {
  const clampedRpe = Math.min(10, Math.max(5, targetRpe))
  const rir = 10 - clampedRpe
  const maxReps = Math.max(1, reps + rir)
  const pct = 100 / repFactor(maxReps)
  return Math.round(pct * 2) / 2 // 0.5 precision, matching the codebase's pct rounding
}
```

- [ ] **Step 4: Run to verify it passes.** Expected: PASS (existing `expected-rpe` tests unaffected).

- [ ] **Step 5: Commit** — `Add pctForExpectedRpe: algebraic inverse of the expected-RPE model`.

---

## Task 2: Per-goal accessory targets + goal-aware bands

**Files:** Modify `lib/ai-periodization/goal-ranges.ts`; Modify `lib/__tests__/goal-ranges.test.ts`

- [ ] **Step 1: Write the failing test.** Add to `lib/__tests__/goal-ranges.test.ts`:

```ts
import { goalRange, accessoryTargetRpe } from '@/lib/ai-periodization/goal-ranges'
import { expectedRpe } from '@/lib/ai-periodization/expected-rpe'

describe('goal-aware accessory bands', () => {
  it('strength accessories are heavier than hypertrophy accessories', () => {
    const s = goalRange('strength', 'accessory')
    const h = goalRange('hypertrophy', 'accessory')
    expect(s.pctMax).toBeGreaterThan(h.pctMin)
    expect(s.repMax).toBeLessThan(h.repMax) // strength = fewer reps, hypertrophy = more
  })

  it('derived accessory band edges land near the goal target RPE', () => {
    for (const goal of ['strength', 'powerbuilding', 'hypertrophy', 'strength+hypertrophy']) {
      const r = goalRange(goal, 'accessory')
      const target = accessoryTargetRpe(goal)
      expect(Math.abs(expectedRpe(r.pctMax, r.repMin) - target)).toBeLessThanOrEqual(0.4)
      expect(Math.abs(expectedRpe(r.pctMin, r.repMax) - target)).toBeLessThanOrEqual(0.4)
    }
  })

  it('every goal accessory targets a genuinely challenging effort (>= RPE 7.5)', () => {
    for (const goal of ['strength', 'powerbuilding', 'hypertrophy', 'endurance', 'power', 'strength+hypertrophy']) {
      expect(accessoryTargetRpe(goal)).toBeGreaterThanOrEqual(7.5)
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `accessoryTargetRpe` not exported; the single `ACCESSORY` band is goal-agnostic so band edges won't be near per-goal targets.

- [ ] **Step 3: Implement.** In `lib/ai-periodization/goal-ranges.ts`, replace the single `ACCESSORY` constant and `goalRange`'s accessory branch:

```ts
import { pctForExpectedRpe } from '@/lib/ai-periodization/expected-rpe'

// Accessories are prescribed to a target EFFORT (RPE), not a fixed %1RM — the load floats to
// whatever hits the target at the chosen reps. Goal-flavoured: strength accessories a touch
// heavier/lower-rep, hypertrophy more rep-driven, but ALL genuinely challenging (>= RPE 7.5).
const ACCESSORY_SPEC: Record<string, { repMin: number; repMax: number; targetRpe: number }> = {
  strength:               { repMin: 6,  repMax: 10, targetRpe: 8.0 },
  hypertrophy:            { repMin: 10, repMax: 15, targetRpe: 8.5 },
  power:                  { repMin: 6,  repMax: 10, targetRpe: 7.5 },
  endurance:              { repMin: 12, repMax: 20, targetRpe: 8.0 },
  powerbuilding:          { repMin: 8,  repMax: 12, targetRpe: 8.0 },
  'strength+hypertrophy': { repMin: 8,  repMax: 12, targetRpe: 8.5 },
}
const DEFAULT_ACCESSORY_SPEC = { repMin: 8, repMax: 15, targetRpe: 8.0 }

function accessorySpec(trainingGoal: string) {
  return ACCESSORY_SPEC[trainingGoal] ?? DEFAULT_ACCESSORY_SPEC
}

export function accessoryTargetRpe(trainingGoal: string): number {
  return accessorySpec(trainingGoal).targetRpe
}

// Derived accessory band: pct is computed from the target RPE at the rep-band edges, so the
// target RPE is the single source of truth (One Formula) — no second hand-tuned % to drift.
function accessoryRange(trainingGoal: string): GoalRange {
  const { repMin, repMax, targetRpe } = accessorySpec(trainingGoal)
  return {
    pctMin: pctForExpectedRpe(targetRpe, repMax), // more reps @ target => lighter
    pctMax: pctForExpectedRpe(targetRpe, repMin), // fewer reps @ target => heavier
    repMin,
    repMax,
  }
}
```

Then update `goalRange`:

```ts
export function goalRange(trainingGoal: string, role: string): GoalRange {
  if (role === 'accessory') return accessoryRange(trainingGoal)
  if (role === 'secondary' && SECONDARY[trainingGoal]) return SECONDARY[trainingGoal]
  return COMPOUND[trainingGoal] ?? COMPOUND.strength
}
```

- [ ] **Step 4: Run to verify it passes.** Also run the full `expected-rpe` + `goal-ranges` + `autoregulation` suites — `goalRange` feeds the autoreg rep-band clamp, so confirm no autoreg test regressed.

- [ ] **Step 5: Commit** — `Make accessory intensity goal-aware and derive its band from a target RPE`.

---

## Task 3: Fix `intensityZoneForRole` + apply RPE-target in the prescribe route

**Files:** Modify `lib/ai-periodization/prompt.ts`; Modify `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`

- [ ] **Step 1 (prompt.ts): accessory-appropriate zone.** In `intensityZoneForRole` (`:87-91`), return an accessory zone for accessories instead of the primary `base`. Build it from `goalRange(trainingGoal, 'accessory')` (import it), keeping `setsMin/setsMax` from the phase zone:

```ts
export function intensityZoneForRole(trainingGoal: string, phase: string, role: string): IntensityZone {
  const base = intensityZone(trainingGoal, phase)
  if (role === 'accessory') {
    const acc = goalRange(trainingGoal, 'accessory')
    return { pctMin: acc.pctMin, pctMax: acc.pctMax, repMin: acc.repMin, repMax: acc.repMax, setsMin: base.setsMin, setsMax: base.setsMax }
  }
  if (role === 'secondary' && MODERATE_SECONDARY_GOALS.has(trainingGoal)) return secondaryIntensityZone(base)
  return base
}
```

Watch for an import cycle (`prompt.ts` ↔ `goal-ranges.ts`): if one arises, lift `ACCESSORY_SPEC`/`accessoryRange` into a tiny shared module both import, or inline the `pctForExpectedRpe` call here. Typecheck will reveal it.

- [ ] **Step 2 (prescribe route): RPE-target override for accessories.** In the accessory-clamp loop (`:312-322`), branch on role. Compounds keep `clampPrescribedPct(a.pct, exZone)`; accessories get the deterministic RPE-target load at their settled reps:

```ts
import { accessoryTargetRpe } from '@/lib/ai-periodization/goal-ranges'
import { pctForExpectedRpe } from '@/lib/ai-periodization/expected-rpe'
// ...
  for (const ex of parsed.exercises) {
    const a = autoregById.get(ex.session_exercise_id)
    if (!a) continue
    const role = roleById.get(ex.session_exercise_id) ?? 'primary'
    ex.reps = a.reps
    ex.sets = a.sets
    if (role === 'accessory') {
      // Accessories are prescribed to a target effort; the load floats to hit it at the reps.
      const pct = pctForExpectedRpe(accessoryTargetRpe(signals.trainingGoal), a.reps)
      ex.pct = Math.min(85, Math.max(40, pct))
    } else {
      const exZone = intensityZoneForRole(signals.trainingGoal, parsed.phase, role)
      ex.pct = clampPrescribedPct(a.pct, exZone)
    }
  }
```

- [ ] **Step 3: Test.** Extend `app/api/next-session/prescription/__tests__/prescription.test.ts` (or the prescribe route's own test) with a case asserting: given an accessory exercise and a chosen goal, the emitted `pct` satisfies `|expectedRpe(pct, reps) − accessoryTargetRpe(goal)| ≤ 0.3`, and a compound in the same prescription is unchanged by this branch. If the route is awkward to unit-test directly, add a focused test on a small extracted helper (`accessoryPctForReps(goal, reps)`).

- [ ] **Step 4: Typecheck + targeted tests** (`pnpm typecheck && pnpm exec vitest run` on the touched suites) — PASS.

- [ ] **Step 5: Commit** — `Prescribe AI accessories to a goal target RPE; fix accessory intensity zone`.

---

## Task 4: Base-style accessories in the workout-data route

**Files:** Modify `app/api/workout-data/route.ts`

- [ ] **Step 1: Derive base-style accessory load from the RPE target.** In the `isAiDynamic` block near `:436` (where `lastSetMode` is already applied to base-style accessories), when the role is `accessory` and the style is not AI-driven for this exercise (`!aiStyleApplied`) and not a deload/baseline phase, remap each style set's `pct` to `pctForExpectedRpe(accessoryTargetRpe(trainingGoal), set.reps)` (clamped 40–85, 0.5-rounded). Preserve everything else on the set (reps, restSec, useFor1rm). Bodyweight exercises (`resolveBodyweightStyle` path) are excluded — they carry no %1RM load. Re-verify the exact variable names (`progressionStyle`, `aiStyleApplied`, the phase flags) against `main`; the intent is: an AI-dynamic accessory on its base style shows the goal target effort instead of its stored light %.

- [ ] **Step 2: Verify against the local seeded DB.** `pnpm db:local` then `pnpm dev`; log in as `test@local.dev` / `testpass123`. Open a session with an accessory and hit `/api/workout-data`. Confirm the accessory's returned `pct`/target weight now corresponds to ~RPE 8 (feed the returned `pct` + reps through `expectedRpe` mentally or in a scratch test). Confirm primary/secondary loads are unchanged and the endpoint still returns 200. The seed's Push/Pull/Legs program (goal in the seed) is the fixture — note which goal it is and that the accessory band matches that goal.

- [ ] **Step 3: Commit** — `Derive base-style accessory load from the goal target RPE for AI-dynamic sessions`.

---

## Task 5: Program-generation reconciliation (review-only; likely a no-op)

**Files:** possibly `lib/workout/known-styles.ts` (`GOAL_STYLE_RULES` `:81-91`)

- [ ] **Step 1: Review, don't reflexively change.** `GOAL_STYLE_RULES` assigns a *named style* (reps + %) to accessories at program-generation time (e.g. powerbuilding → `'Hypertrophy 3-set'` 3×10 @65%; hypertrophy/strength+hypertrophy → `'General'` 3×12 @60%). Because Tasks 3–4 derive accessory load at prescription/read time, the stored style's % is overridden for AI-dynamic programs regardless — so a change here is **not required for correctness**. Only adjust if a newly-generated program's *first* render (before any AI prescription and before Task 4's path applies) would still read too light AND that path isn't covered. If you do change it, do **not** silently alter shared styles' rep schemes (users may want 12-rep abs) — prefer leaving reps and letting the derivation set load. Document the decision in the PR; a no-op with a one-line justification is an acceptable outcome of this task.

- [ ] **Step 2: Commit only if changed** (else skip).

---

## Task 6: Full local gate

**Files:** none (verification only)

- [ ] **Step 1: Full gate** — `pnpm ci:local` (lint, `check-reconcile.js`, `check-push-mutations.js`, typecheck, tests). All green. `check-push-mutations.js` is trivially green (no `pushMutations` edit); `check-reconcile.js` trivially green (no schema change).
- [ ] **Step 2: No cache/sync/offline obligations.** Confirm (checklist, no code): no new cache key, no cache-group edit, no synced column, no `pushMutations`/`getSyncDelta`/`applyDelta` change. This change is prescription math only.
- [ ] **Step 3: Regression sweep on the sibling engine tests** — run `autoregulation.test.ts`, `phase-engine.test.ts`, `prescription-schema.test.ts`, `reconcile-prescription.test.ts`, `expected-rpe.test.ts`, `goal-ranges.test.ts`. All green (the accessory rep-band feeds autoreg; the pct override feeds the prescribe path).

---

## Verification summary — what is and isn't sandbox-verifiable

**Verifiable in the sandbox (must be green before merge):**
- `pctForExpectedRpe` round-trip + monotonicity unit tests; goal-aware band tests; prescribe accessory-pct test.
- `pnpm typecheck`, `pnpm lint`, full `pnpm ci:local`, sibling engine suites.
- `/api/workout-data` returns accessory loads at ~RPE 8 for the seeded AI-dynamic program (`pnpm dev` + `test@local.dev`).

**NOT verifiable in the sandbox — call these out when presenting:**
- **The owner's actual program.** The fix is visible only where the accessory flows through an AI-dynamic path (D6). The seed exercises the code path, but the owner's live "RPE 6 → RPE 8" change is only confirmable against their production program on the S25 APK. Run `docs/device-smoke-checklist.md` (open the accessory, confirm the slider reads ~RPE 8 and the prescribed weight rose accordingly) or add a `projectOverview.md` Known-Issues row marking it not-yet-device-verified.
- **Feel.** Whether RPE 8 accessories are the right dose for the owner is a training-preference call, not a code check — the target RPE per goal is tunable in `ACCESSORY_SPEC` if they want more/less.

---

## Limitations & follow-ups (create backlog/Known-Issues entries per the no-orphaned-findings rule)

1. **Per-muscle-group intensity — explicitly deferred (owner decision 2026-07-18).** Intensity stays keyed on `(goal, phase, role)`. If the owner later wants abs/calves/etc. to carry their own rep/% profiles, that is a separate, larger plan (a muscle→profile map layered on this) — file it, don't fold it in.
2. **Existing static styles on non-AI-dynamic programs.** A stored accessory style % on a program that is not AI-dynamic is untouched (D6). If the owner has such a program, reconciling stored styles needs either a re-generation or a data migration — the latter mutates per-user program data (confirm-first per CLAUDE.md). Flag as a follow-up decision, not built here.
3. **`ACCESSORY_SPEC` values are starting points.** Tune per goal after the owner trains a block at the new targets.

---

## Self-review (against the two selected scope items)

- **Goal-aware accessory bands (scope item 1):** Task 2 replaces the single goal-agnostic `ACCESSORY` with per-goal specs; test asserts strength ≠ hypertrophy accessory loading ✓.
- **Target accessories by RPE (scope item 2):** Task 1 adds the exact inverse of `expectedRpe`; Tasks 3–4 apply it so accessory load floats to hit the goal target RPE at any rep count ✓.
- **One Formula, One Place:** the pct derivation reuses `repFactor`/`expectedRpe`'s own curve — inverse of the existing model, no parallel implementation; the target RPE is the single source, the pct band is derived (D2) ✓.
- **No scope creep:** primary/secondary compounds untouched (Task 3 branches on role); per-muscle-group explicitly excluded (non-goals + Limitation 1) ✓.
- **No offline/cache/migration surface:** prescription math only — Task 6 Step 2 confirms ✓.
- **Honest limits:** D6 + Verification summary state the fix is AI-dynamic-path-only and device-unverified in-sandbox ✓.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-18-accessory-intensity-goal-rpe.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.

**2. Inline Execution** — execute in-session via executing-plans with checkpoints.

**Which approach?**
