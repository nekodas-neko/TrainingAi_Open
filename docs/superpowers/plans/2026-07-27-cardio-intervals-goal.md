# Intervals Goal (Norwegian 4×4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Intervals" as a fifth selectable running-plan goal, alongside the existing Speed/Endurance/Heart health/Recovery, running the well-known Norwegian 4×4 protocol (4 × 4-minute high-intensity intervals with active recovery, twice a week, easy running filling the rest of the week).

**Architecture:** The prescription engine was explicitly built for this — `lib/running/framework.ts`'s own comment says "add a new template by adding a module + a line here." This plan adds exactly that: a new `RunFramework` module, a new `GoalKind` union member, a new `CardioGoalMeta` registry entry, and one new line in the Zod enum that validates the plan-setup POST body. No new UI component, no migration (`goal_kind`/`framework_key` are free-text DB columns per the existing design note), no changes to the recovery gate, the route, or the tables.

**Tech Stack:** Pure TypeScript (`lib/running/`), Vitest for tests, one Zod schema line in an existing API route.

---

## Why this shape (context for the implementer)

This was already answered before it was asked. `docs/superpowers/plans/2026-07-17-running-prescription-engine.md`'s design notes (and its code comment carried into `lib/running/cardio-goals.ts:6`) explicitly cite **Norwegian 4×4** as one of the frameworks the swappable `RunFramework` interface was built to support later, "without touching the gate, the route, or the tables — only a new `lib/running/frameworks/<key>.ts` and a registry line." That extension point has never been used until now.

Confirmed by reading the current code (not assumed):
- Interval *sessions* already exist as a `RunType` (`lib/running/types.ts:3`) and are already auto-prescribed as part of the **Speed** goal's mix (`speed-vo2max.ts`) and occasionally the **Endurance** goal's mix (`polarized.ts`) — but there is no goal where intervals are the entire point of the plan. This plan adds that as its own selectable goal, not a change to the existing two.
- `targetsForRunType('interval', fitness)` (`lib/running/hr-targets.ts:12`) already maps interval work to HR Zones 4-5 off the canonical Karvonen zones — reused as-is, no new HR math.
- `PlanSetupSheet` (`components/running/plan-setup-sheet.tsx`) renders `SELECTABLE_CARDIO_GOALS.map(...)` generically — a fifth goal in that array shows up in the picker with **zero UI code changes**. `needsTargetDistance: false` (Norwegian 4×4 is HR/time-based, not distance-based) means the target-distance picker correctly stays hidden for it, exactly as it already does for Heart health/Recovery.

**Session structure and cadence, and why:** the interval workout itself is a **fixed protocol**, not a volume that grows over weeks — 10 min warm-up + 4 × 4 min work (Zone 4-5, 85-95% max HR) + 3 × 3 min active-recovery between reps + 5 min cool-down = 40 minutes total. Growing that structure over time would depart from the published protocol (Helgerud et al. 2007, *J Strength Cond Res*; Wisløff et al. 2007, *Circulation* — both study the specific 4×4/3-min-recovery structure). Frequency is capped at **2 interval sessions/week** — the standard recreational-athlete recommendation, given the near-maximal HR demand — with an easy day required between every interval day (mirroring the same `canGoHard = easySoFar > hardSoFar` gate `speed-vo2max.ts`/`polarized.ts` already use), a weekly long easy run, and easy fill days otherwise. Only the *fill* (easy/long) day durations grow modestly week-over-week with fitness — the interval structure itself stays fixed.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/running/types.ts` (modify) | Add `'intervals'` to the `GoalKind` union. |
| `lib/running/cardio-goals.ts` (modify) | Add the `intervals` entry to `CARDIO_GOALS`. |
| `lib/running/frameworks/norwegian-4x4.ts` (new) | The framework itself — `nextRun()` prescribing the fixed 4×4 structure on hard days, easy/long fill otherwise. |
| `lib/running/frameworks/__tests__/norwegian-4x4.test.ts` (new) | Unit tests for the new framework. |
| `lib/running/framework.ts` (modify) | Register the new framework in `FRAMEWORKS`. |
| `app/api/running-plan/route.ts` (modify) | Add `'intervals'` to the `goalKind` Zod enum (line 31) so a plan-setup POST with this goal validates. |
| `lib/running/__tests__/cardio-goals.test.ts` (modify) | Update the "offers exactly N selectable goals" assertion to include the new one. |

---

## Task 1: The Norwegian 4×4 framework

**Files:**
- Create: `lib/running/frameworks/norwegian-4x4.ts`
- Test: `lib/running/frameworks/__tests__/norwegian-4x4.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/running/frameworks/__tests__/norwegian-4x4.test.ts
import { describe, it, expect } from 'vitest'
import { norwegian4x4Framework } from '../norwegian-4x4'
import type { FrameworkContext } from '../../types'

function baseCtx(overrides: Partial<FrameworkContext> = {}): FrameworkContext {
  return {
    fitness: { maxHr: 185, restingHr: 55, vo2max: 42, thresholdHr: null, weeklyBaseMinutes: 120, source: 'baseline' },
    weekIndex: 0,
    runsThisWeek: [],
    goal: { kind: 'intervals', targetDistanceKm: null, targetDate: null, timePerSessionMinutes: null },
    ...overrides,
  }
}

describe('norwegian4x4Framework', () => {
  it('prescribes an interval session first, at the fixed 40-minute protocol duration', () => {
    const p = norwegian4x4Framework.nextRun(baseCtx())
    expect(p.type).toBe('interval')
    expect(p.durationMin).toBe(40)
    expect(p.targets.zoneIds).toEqual([4, 5])
  })

  it('does not prescribe back-to-back interval days — requires an easy day between', () => {
    const afterOneInterval = norwegian4x4Framework.nextRun(
      baseCtx({ runsThisWeek: [{ type: 'interval', durationMin: 40 }] }),
    )
    expect(afterOneInterval.type).not.toBe('interval')
  })

  it('caps interval sessions at 2 per week', () => {
    const afterEasyIntervalEasyInterval = norwegian4x4Framework.nextRun(
      baseCtx({
        runsThisWeek: [
          { type: 'interval', durationMin: 40 },
          { type: 'easy', durationMin: 25 },
          { type: 'interval', durationMin: 40 },
          { type: 'easy', durationMin: 25 },
        ],
      }),
    )
    expect(afterEasyIntervalEasyInterval.type).not.toBe('interval')
  })

  it('keeps the interval duration fixed across weeks (no volume growth on the protocol itself)', () => {
    const week0 = norwegian4x4Framework.nextRun(baseCtx({ weekIndex: 0 }))
    const week8 = norwegian4x4Framework.nextRun(baseCtx({ weekIndex: 8 }))
    expect(week0.durationMin).toBe(40)
    expect(week8.durationMin).toBe(40)
  })

  it('fills non-interval days with easy or long runs, never tempo', () => {
    const afterInterval = norwegian4x4Framework.nextRun(
      baseCtx({ runsThisWeek: [{ type: 'interval', durationMin: 40 }] }),
    )
    expect(['easy', 'long']).toContain(afterInterval.type)
  })

  it('prescribes the weekly long run before defaulting to easy', () => {
    const p = norwegian4x4Framework.nextRun(
      baseCtx({ runsThisWeek: [{ type: 'interval', durationMin: 40 }, { type: 'easy', durationMin: 25 }] }),
    )
    expect(p.type).toBe('long')
  })

  it('stamps its own frameworkKey', () => {
    const p = norwegian4x4Framework.nextRun(baseCtx())
    expect(p.frameworkKey).toBe('norwegian-4x4')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/running/frameworks/__tests__/norwegian-4x4.test.ts`
Expected: FAIL — `Cannot find module '../norwegian-4x4'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/running/frameworks/norwegian-4x4.ts
import { targetsForRunType } from '../hr-targets'
import type { FrameworkContext, Prescription, RunFramework, RunType } from '../types'

const KEY = 'norwegian-4x4'
// The interval workout is a fixed protocol structure — 10 min warm-up + 4 × 4 min work
// (Zone 4-5, 85-95% max HR) + 3 × 3 min active recovery between reps + 5 min cool-down
// = 40 min total. It does not grow with training age the way easy-run volume does;
// growing it would depart from the published protocol (Helgerud et al. 2007, J Strength
// Cond Res; Wisløff et al. 2007, Circulation).
const INTERVAL_DURATION_MIN = 40
// Standard recreational-athlete cap — the near-maximal-HR demand of this protocol
// doesn't tolerate more without overreaching.
const MAX_HARD_PER_WEEK = 2
const FILL_GROWTH = 1.05

function nextRun(ctx: FrameworkContext): Prescription {
  const easySoFar = ctx.runsThisWeek.filter((r) => r.type === 'easy' || r.type === 'long' || r.type === 'recovery').length
  const hardSoFar = ctx.runsThisWeek.filter((r) => r.type === 'interval').length
  const hasLong = ctx.runsThisWeek.some((r) => r.type === 'long')
  const weeklyFillMinutes = Math.round(ctx.fitness.weeklyBaseMinutes * FILL_GROWTH ** ctx.weekIndex)

  // An easy day must separate every interval day — the protocol's recovery demand is
  // high (16 total minutes of near-maximal-HR work per session).
  const canGoHard = easySoFar > hardSoFar

  let type: RunType
  let durationMin: number
  let rationale: string

  if (hardSoFar < MAX_HARD_PER_WEEK && canGoHard) {
    type = 'interval'
    durationMin = INTERVAL_DURATION_MIN
    rationale = 'Norwegian 4×4 — 4 × 4 minutes at 85–95% max HR (Zone 4–5), each followed by 3 minutes of easy active recovery, bracketed by a 10-minute warm-up and 5-minute cool-down. One of the most time-efficient, evidence-backed protocols for raising VO₂max.'
  } else if (!hasLong && easySoFar >= 1) {
    type = 'long'
    durationMin = Math.max(30, Math.round(weeklyFillMinutes * 0.35))
    rationale = 'Your weekly long easy run — aerobic base work that supports the interval sessions and speeds recovery between them.'
  } else {
    type = 'easy'
    durationMin = Math.max(20, Math.round(weeklyFillMinutes * 0.2))
    rationale = "An easy recovery run — keep it conversational (Zone 1). This protocol's intensity lives entirely in the interval days; every other run should feel easy."
  }

  return {
    type,
    durationMin,
    distanceKm: null,
    targets: targetsForRunType(type, ctx.fitness),
    rationale,
    frameworkKey: KEY,
  }
}

export const norwegian4x4Framework: RunFramework = { key: KEY, label: 'Norwegian 4×4 intervals', nextRun }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/running/frameworks/__tests__/norwegian-4x4.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/running/frameworks/norwegian-4x4.ts lib/running/frameworks/__tests__/norwegian-4x4.test.ts
git commit -m "feat: add the Norwegian 4x4 interval framework"
```

---

## Task 2: Register the framework

**Files:**
- Modify: `lib/running/framework.ts`

- [ ] **Step 1: Add the import and registry line**

```typescript
import type { RunFramework } from './types'
import { polarizedFramework } from './frameworks/polarized'
import { speedVo2maxFramework } from './frameworks/speed-vo2max'
import { zone2BaseFramework } from './frameworks/zone2-base'
import { aerobicRecoveryFramework } from './frameworks/aerobic-recovery'
import { densityProgressionFramework } from './frameworks/density-progression'
import { norwegian4x4Framework } from './frameworks/norwegian-4x4'

// Framework registry — add a new template by adding a module + a line here. The engine,
// gate, route, and tables are framework-agnostic (design note 2).
const FRAMEWORKS: Record<string, RunFramework> = {
  [polarizedFramework.key]: polarizedFramework,
  [speedVo2maxFramework.key]: speedVo2maxFramework,
  [zone2BaseFramework.key]: zone2BaseFramework,
  [aerobicRecoveryFramework.key]: aerobicRecoveryFramework,
  [densityProgressionFramework.key]: densityProgressionFramework,
  [norwegian4x4Framework.key]: norwegian4x4Framework,
}
```

Note: this task has no dependency on `GoalKind`/`CARDIO_GOALS` — `FRAMEWORKS` is keyed purely by string, so registering the framework here works standalone, before any goal points at it (Task 3).

- [ ] **Step 2: Run the full running-domain test suite**

Run: `pnpm vitest run lib/running/`
Expected: PASS (no regressions — nothing references `'norwegian-4x4'` from the goal side yet).

- [ ] **Step 3: Type-check**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/running/framework.ts
git commit -m "feat: register the Norwegian 4x4 framework"
```

---

## Task 3: Register the goal

**Files:**
- Modify: `lib/running/types.ts:32-38`
- Modify: `lib/running/cardio-goals.ts`
- Modify: `app/api/running-plan/route.ts:31`
- Modify: `lib/running/__tests__/cardio-goals.test.ts:29-34`

- [ ] **Step 1: Add the new `GoalKind` member**

In `lib/running/types.ts`, extend the union (around line 32-38):

```typescript
export type GoalKind =
  | 'speed'          // faster 5K/3K + VO₂max
  | 'endurance'      // go further
  | 'heart_health'   // general cardiovascular health
  | 'recovery'       // improve heart-rate recovery / resting HR
  | 'intervals'      // Norwegian 4×4 — structured VO₂max interval protocol
  | 'cardio_health'  // legacy alias → heart_health-style
  | 'distance_event' // legacy alias → endurance-style
```

- [ ] **Step 2: Add the `CardioGoalMeta` entry**

In `lib/running/cardio-goals.ts`, add a new entry to `CARDIO_GOALS` (immediately after the `recovery` entry, before the legacy-aliases comment):

```typescript
  intervals: {
    key: 'intervals',
    label: 'Intervals (Norwegian 4×4)',
    blurb: 'A proven, time-efficient VO₂max protocol — 4×4-minute high-intensity intervals with active recovery, twice a week, easy running filling the rest.',
    defaultFrameworkKey: 'norwegian-4x4',
    needsTargetDistance: false,
    markers: ['vo2max', 'hrr1', 'efficiency', 'zone_distribution'],
    selectable: true,
  },
```

- [ ] **Step 3: Add the goal to the API route's validation**

In `app/api/running-plan/route.ts:31`, add `'intervals'` to the enum:

```typescript
  goalKind: z.enum(['speed', 'endurance', 'heart_health', 'recovery', 'intervals', 'cardio_health', 'distance_event']).default('heart_health'),
```

- [ ] **Step 4: Update the existing selectable-goals test**

In `lib/running/__tests__/cardio-goals.test.ts:29-34`, update the assertion to include the new goal (still alphabetically sorted):

```typescript
  it('offers exactly the five selectable goals (legacy hidden)', () => {
    expect(SELECTABLE_CARDIO_GOALS.map((g) => g.key).sort()).toEqual(
      ['endurance', 'heart_health', 'intervals', 'recovery', 'speed'],
    )
    expect(CARDIO_GOALS.cardio_health.selectable).toBe(false)
  })
```

- [ ] **Step 5: Run the test suite — should pass immediately since the framework is already registered (Task 2)**

Run: `pnpm vitest run lib/running/`
Expected: PASS — including "every framework a goal points to is registered" (`getFramework('norwegian-4x4')` now resolves) and the updated five-goals assertion.

- [ ] **Step 6: Type-check**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Manual verification**

`pnpm dev`, sign in, open `/running` (or wherever `PlanSetupSheet` is triggered from — the cardio hub's "Set up your running plan" flow), confirm "Intervals (Norwegian 4×4)" appears as a fifth goal card with its blurb, confirm selecting it does NOT show the target-distance picker (matches Heart health/Recovery's behavior), confirm "Create plan" succeeds and the next prescribed run is the interval session. Check the DB directly if useful: `psql $DATABASE_URL -c "select goal_kind, framework_key from running_plans order by created_at desc limit 1;"` should show `intervals` / `norwegian-4x4`.

- [ ] **Step 8: Commit**

```bash
git add lib/running/types.ts lib/running/cardio-goals.ts app/api/running-plan/route.ts lib/running/__tests__/cardio-goals.test.ts
git commit -m "feat: register the Intervals (Norwegian 4x4) running goal"
```

---

## Task 4: Full gate, version bump, session bookkeeping

- [ ] **Step 1: Full local gate**

```bash
pnpm ci:local
```

Expected: lint clean, `check-reconcile.js`/`check-push-mutations.js` OK (no offline-sync surface touched — this is pure plan-generation logic, no new table/column), `tsc --noEmit` clean, full `vitest run` green including all new/updated tests.

- [ ] **Step 2: Isolated production build**

```bash
rm -rf .next && npm run build
```

Expected: compiles successfully, no new warnings.

- [ ] **Step 3: Version bump**

Bump `package.json`'s `"version"` — minor bump (this is a new user-facing feature, not just a bug fix) — and add a `lib/changelog.ts` entry:

```typescript
{
  version: "<next minor version>",
  date: "<today, YYYY-MM-DD>",
  changes: [
    "Added \"Intervals (Norwegian 4×4)\" as a new running-plan goal — 4×4-minute high-intensity intervals with active recovery, twice a week, with easy running filling the rest.",
  ],
},
```

- [ ] **Step 4: Journal entry**

Create `docs/overview/entries/<date>-cardio-intervals-goal.md` documenting what shipped: the new goal, the framework's design (fixed protocol duration, 2×/week cap, easy-day gating), and that it required no migration, no new route, no gate changes — purely additive to the existing swappable-framework registry the engine was built for. Note this was fully verifiable in the sandbox (pure TS + one DB write through an existing, already-tested route) — no device-only surface here, unlike the run-status-chip plan.

- [ ] **Step 5: `projectOverview.md` update**

Add to Current Status / What's Shipped, no new Known Issues row needed (nothing here is device-only or unverifiable in-sandbox).

- [ ] **Step 6: Backlog update**

Remove this plan's queue entry from `docs/implementation-backlog.md` (added by the docs-only PR that lands this plan) and add a shipped note to the "Cardiovascular system redesign" batch, mirroring the pattern used for every other shipped item in that batch.

- [ ] **Step 7: Commit**

```bash
git add package.json lib/changelog.ts docs/overview/entries/<date>-cardio-intervals-goal.md projectOverview.md docs/implementation-backlog.md
git commit -m "chore: version bump, journal entry and backlog update for the Intervals goal"
```

---

## Explicit non-goals (out of scope for this plan)

- **Not a rep-by-rep guided workout.** This plan prescribes a 40-minute interval *run* the same way every other framework prescribes a run — the user executes it themselves against the HR-zone target shown during the run (`RunHrZoneHero`, already wired into `RunActiveScreen`). It does not add rep-by-rep phase cues, countdown beeps, or a structured interval-by-interval guided flow (that machinery exists for guided *walks* — `lib/walk/interval-plan.ts` — and is a separate, much larger undertaking explicitly out of scope here).
- **No changes to the recovery gate, the route's response shape, or the DB tables.** `goal_kind`/`framework_key` are free-text columns by design specifically so this kind of addition needs none of that.
