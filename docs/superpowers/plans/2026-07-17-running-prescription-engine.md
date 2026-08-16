# Running Prescription Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a recovery-aware running coach: the user does a cardio baseline once, sets a goal, and the app prescribes the **next run** (type + duration/distance + target HR zones + a plain-English rationale) using a **deterministic, rule-based framework** — never an LLM number — and re-prescribes as each run is logged, gating or softening the prescription when recent training load / low readiness / a heavy leg day means a hard run would be unwise.

**Architecture:** The prescription is produced by pure, unit-tested TypeScript in `lib/running/` — a swappable **framework template** (`RunFramework`) proposes the ideal next run, then a **recovery gate** (`lib/running/recovery-gate.ts`) softens or blocks it from real recovery signals. The MVP framework is **polarized 80/20** (Seiler). Gemini is used **only** to phrase the already-computed deterministic rationale into encouragement on a separate best-effort route — **no LLM self-reported number gates any automatic action** (repo rule: "Deterministic math lives in code"). Data lives in two new tables (`running_plans`, `prescribed_runs`, migration **132**) that reuse the existing user/activity scaffolding; a completed/skipped prescribed run is an **offline-first user write** (local store + outbox + `pushMutations` mirror + pull mapping), and execution of a prescribed run hands off to the existing guided-activity GPS+HR tracking (`components/activity/`), linking the resulting `activity_logs` row back on completion.

**Tech Stack:** TypeScript; pure engine `lib/running/*` (vitest); Drizzle/Postgres (`lib/data/postgres/schema.ts`, migration `132_running_plans.sql`); repository interface `lib/data/repository.ts` + `lib/data/postgres/adapter.ts`; offline-first local store `lib/local-store/*` + outbox `lib/sync/mutation-schema.ts`; Next.js route handlers `app/api/running-plan/*`; Gemini via `@ai-sdk/google` (`generateText`, best-effort flavour only); UI `app/running/` + `components/running/*` reusing `lib/health/hr-zones.ts`, shadcn/Radix, Lucide, theme tokens, `pt-safe`/`pb-safe`.

---

## Design decisions (made in the planning session — encode, don't re-litigate)

1. **Rule-based engine, AI for flavour only.** The prescription (`type`, `durationMin`/`distanceKm`, `targets`, `rationale`) is 100% deterministic math in `lib/running/`. The AI route (`/api/running-plan/explain`) only rephrases the already-computed `rationale` string into a warmer sentence; it returns prose via `generateText` wrapped in try/catch-returning-JSON, is rate-limited, and its output **never** feeds back into the engine or gates any action. This is the repo's hard rule ("no LLM self-reported number may gate an automatic action"; "prose-only `generateText` routes must never grow a `JSON.parse` of model text").

2. **Framework = polarized 80/20 (Seiler), structured swappable.** MVP default is the polarized/pyramidal intensity distribution: ~80% of runs are easy (Zone 1–2, conversational, below the aerobic/ventilatory threshold) and ~20% are hard quality sessions (interval/tempo, Zone 4–5), with a weekly long easy run and a simple week-over-week volume progression capped at ~10%/week. Chosen because it is the best-evidenced distribution for improving cardio health / VO₂max in recreational runners (Seiler & Kjerland 2006; Stöggl & Sperlich 2014, *Frontiers in Physiology*) and maps cleanly onto our existing Karvonen HR zones (`lib/health/hr-zones.ts`). The engine takes a `RunFramework` interface so a **Couch-to-5K graded** template (beginner) or **Norwegian 4×4** template can be dropped in later without touching the gate, the route, or the tables — only a new `lib/running/frameworks/<key>.ts` and a registry line.

3. **Recovery gate is a separate deterministic stage (research-backed).** After the framework proposes the ideal run, `applyRecoveryGate` may downgrade it (`proceed` → `soften` → `rest`). It exists because prescribing a hard long run **the day after a heavy lower-body strength session** is counter-productive: the **concurrent-training "interference effect"** (Hickson 1980; Wilson et al. 2012 meta-analysis, *J. Strength Cond. Res.*) plus **residual neuromuscular fatigue / delayed-onset muscle soreness** from eccentric leg work degrade running economy and raise injury risk. The gate also softens on **low or still-provisional readiness** (`oura_daily_derived.readiness_score`), **high strain/ACWR** (`computeMonotonyStrain`/`computeVolumeAcwr`), **a run in the last ~24 h**, and **short sleep** — each is a signal our data already surfaces. The gate **degrades gracefully**: a missing signal is neutral, never fabricated. **Optional future signal:** the `daily_zone_minutes` table/API from the sibling plan `docs/superpowers/plans/2026-07-17-hr-zone-minutes-and-views.md` (being written in parallel — do NOT rebuild it) can later feed the gate a "hard minutes already accrued this week" input to enforce the 80/20 cap directly; it is **out of scope for the MVP gate** and left as a documented extension point on `RecoveryGateInputs`, not a Phase-1 dependency.

4. **Reuse the existing HR-zone and activity scaffolding, add only what's genuinely new.** Target HR bands come from `computeHrZones`/`hrReserveTarget` (`lib/health/hr-zones.ts`) — One Formula, One Place, no second zone math. A prescribed run is *executed* by the existing guided-activity GPS+HR flow (`components/activity/`), which already writes an `activity_logs` row of type `'run'` (seeded in `058_activity_logs.sql`). We add `running_plans` + `prescribed_runs` (migration 132) rather than bolting onto `programs`/`schedules` because a prescribed run is **generated/adaptive**, not a static template row — but `prescribed_runs.activity_log_id` FKs the existing activity row so history stays unified.

5. **Fitness snapshot degrades to age-based zones.** The engine reads a `FitnessSnapshot` (VO₂max, maxHR, restingHR, thresholdHR, weekly base minutes). Its **preferred** source is the cardio-baseline results plan (`docs/superpowers/plans/2026-07-17-cardio-baseline-tests.md`, a sibling being written in parallel — supplies measured VO₂max + max-HR + threshold HR) and the VO₂max module (`lib/health/vo2max.ts`, from `docs/superpowers/plans/2026-07-16-training-stress-score-and-vo2max.md` Task 1). **Neither may exist on disk yet.** So Task 1 builds a resolver that reads whatever is present and **falls back to age-based zones** (`hrMaxFromAge`, `computeHrZones`) when the baseline/VO₂max are absent — the engine is fully buildable and shippable standalone today.

6. **Offline-first for the one user write.** The only user-initiated write in the running domain is **marking a prescribed run completed or skipped** (and linking the actual `activity_logs` run). That is an offline-first write: local store table `prescribed_runs`, outbox domain `'prescribed_run'`, a `pushMutations` branch that mirrors the web PATCH via one shared repo function, and a pull-delta mapping. The plan *itself* (goal + framework choice) is created on an online setup screen and is not part of the offline hot path (creating a plan is a deliberate online action, like connecting Oura) — but its read is cache-seeded for instant paint.

## Verified current state (2026-07-17)

- **HR zones (reuse):** `lib/health/hr-zones.ts` — `hrMaxFromAge(age)` (220−age, 190 fallback, line 9), `hrReserve(maxHr, restingHr)` (floored 30, line 15), `computeHrZones({maxHr, restingHr}): HrZone[]` (5 Karvonen bands, line 41), `hrReserveTarget(pct, restingHr, hrMax)` (line 81), `estimateHrMax({age, observed})` (line 75). `HrZone.id` is `1|2|3|4|5`.
- **Training load (reuse):** `app/api/training-load/route.ts` returns `TrainingLoadResponse { acwr, acuteLoad, chronicLoad, interpretation, monotony, strain, ... }` via `computeVolumeAcwr(sessions, todayMid)` and `computeMonotonyStrain(dailyLoadsKg)` (`lib/ai-periodization/acwr.ts`). Repo feed: `repo.getSessionLoadsFrom(userId, fromDate): Promise<SessionLoad[]>` (`repository.ts:468`), `repo.getWorkoutSessionsFrom(userId, fromDate): Promise<WorkoutSession[]>` (`repository.ts:465`).
- **Readiness (reuse, gate input):** `/api/readiness-score` persists/read `oura_daily_derived.readiness_score` via `repo.getOuraDailyDerived(userId, fromIso, toIso)`; provisional flag = `oura_daily_summary.n_history < 14` (BASELINE_MIN_NIGHTS). `repo.getOuraDailySummary(userId, from, to)` → rows with `.nHistory` (readiness route lines 133–134, 437).
- **Muscle normalization (reuse):** `normalizeMuscle(raw)` (`lib/muscles.ts:21`). No `LOWER_BODY` set exists — this plan defines one **once** in `lib/running/lower-body.ts`. `exercise_logs.muscleGroups` is `text[]` (`schema.ts:176`); `workout_sessions` rows carry per-exercise muscle groups via `exercise_logs`.
- **Activity domain (reuse + offline-first reference):** table `activity_logs` (`schema.ts:277`), type id `'run'` (distance-based, `058_activity_logs.sql:14`). Web routes `app/api/activity-logs/route.ts` (GET list, POST `repo.saveActivityLog`, DELETE) + `app/api/activity-logs/[id]/metrics/route.ts`, all Zod-validated. Repo: `saveActivityLog(userId, log, opts?)` (`repository.ts:405`), `listActivityLogs(userId, from, to)` (`repository.ts:406`), `deleteActivityLog` (`repository.ts:408`). Guided execution: `components/activity/` (`pre-activity-screen.tsx`, `active-activity-screen.tsx`, `done-activity-screen.tsx`) and `components/guided-walk/` (fast/slow block config `walk-config.tsx`).
- **Offline-first chain (mirror for `prescribed_run`):** LocalStore interface `lib/local-store/index.ts` (`getActivityLogs`, `upsertActivityLog` at lines 25/56); SQLite impl `lib/local-store/sqlite-backend.ts` (table DDL, upsert at 1387, sync-confirm delete at 870); pending-mutation domain union `lib/local-store/types.ts:298`; outbox Zod enum `lib/sync/mutation-schema.ts:9`; pull-confirm branch `lib/local-store/sync-engine.ts:553` (`m.domain === 'activity_logs'`). `pushMutations` lives in `lib/data/postgres/adapter.ts`; **CI rule `scripts/check-push-mutations.js` fails the Custom Rules check if `pushMutations` touches `this.db`/raw `sql` directly** — every write must go through a shared repo function.
- **Dates (reuse):** `lib/date-utils.ts` — `todayInTz(tz)` (line 28), `todayMidnightUtc(tz)` (line 61), `normalizeDateParam(input)` (line 82), `ageFromDob(dob, now)` (line 136), `DEFAULT_TZ` (line 3). Never `new Date().toISOString().slice(0,10)`, never `now − N×86400000`.
- **Infra (reuse):** rate limit `rateLimit(key, limit, windowMs)` (`lib/rate-limit.ts:97`, usage `readiness-score/route.ts:113`); AI prose route pattern `app/api/ai/health-insight/route.ts` (cache→rate-limit→`generateText` in try/catch); cache `cachedFetch`/`readCacheSync`/`cachedFetchToday`/`invalidateCache` (`lib/sqlite/cache.ts`); TTL constants `lib/cache-ttl.ts`; SWR header on aggregate GETs: `Cache-Control: private, max-age=60, stale-while-revalidate=120`.
- **Migration numbering:** directory tops out at `126_set_log_planned_snapshot.sql`; sibling plans claim up to 128; **132 is reserved for this feature** (per the task brief). `migrate.js` applies in filename sort order — re-confirm 132 is free against the directory AND open PRs/plan docs at implementation time before claiming it.
- **Version:** `package.json` 1.161.3; changelog `lib/changelog.ts` (`CHANGELOG[0]`).

## File structure

**Create — pure engine (Phase 1):**
- `lib/running/types.ts` — `RunType`, `FitnessSnapshot`, `RunTargets`, `Prescription`, `RunningGoal`, `RunFramework`, `FrameworkContext`.
- `lib/running/lower-body.ts` — the single `LOWER_BODY_MUSCLES` set + `isLowerBodyMuscle(name)` (One Place).
- `lib/running/fitness-snapshot.ts` — `resolveFitnessSnapshot(inputs)`: baseline-first, age-based fallback.
- `lib/running/hr-targets.ts` — `targetsForRunType(type, fitness)`: maps a `RunType` to `RunTargets` using `computeHrZones`/`hrReserveTarget`.
- `lib/running/recovery-gate.ts` — `applyRecoveryGate(prescription, inputs)`: proceed/soften/rest.
- `lib/running/framework.ts` — `RunFramework` registry + `getFramework(key)`.
- `lib/running/frameworks/polarized.ts` — the polarized 80/20 template (`polarizedFramework`).
- `lib/running/prescription.ts` — `prescribeNextRun(ctx, gateInputs)`: framework → gate → final `Prescription`.
- Tests: `lib/running/__tests__/{fitness-snapshot,hr-targets,recovery-gate,polarized,prescription}.test.ts`.

**Create — persistence + API (Phase 1):**
- `lib/data/postgres/migrations/132_running_plans.sql` — `running_plans` + `prescribed_runs`.
- `lib/validation/prescribed-run.ts` — the **shared** Zod schema for the completion PATCH, imported by both the web route and the `pushMutations` branch (mirrors `lib/validation/activity-log.ts`, "Shared by the web route and pushMutations").
- `app/api/running-plan/route.ts` — `GET` (active plan + today's prescription) / `POST` (create plan from baseline+goal).
- `app/api/running-plan/runs/[id]/route.ts` — `PATCH` (complete/skip; offline-first mirror).
- `app/api/running-plan/explain/route.ts` — AI flavour (best-effort prose only).

**Create — UI (Phase 1):**
- `app/running/page.tsx` — server shell.
- `components/running/running-plan-content.tsx` — today's prescribed-run card + gate banner (local-first read).
- `components/running/plan-setup-sheet.tsx` — baseline/goal setup (online).
- `components/running/prescribed-run-card.tsx` — the card (memo, stable props), hand-off button to guided activity.

**Modify:**
- `lib/data/postgres/schema.ts` — add `runningPlans`, `prescribedRuns` Drizzle tables.
- `lib/data/repository.ts` — add running-plan methods to the interface.
- `lib/data/postgres/adapter.ts` — implement methods + `pushMutations` `'prescribed_run'` branch (via a shared repo fn) + `getSyncDelta`/pull mapping.
- `lib/local-store/types.ts` — `LocalPrescribedRun` + add `'prescribed_run'` to the `PendingMutation.domain` union.
- `lib/local-store/index.ts` — `getPrescribedRuns`/`upsertPrescribedRun` on the `LocalStore` interface (+ the `applyDelta` bulk field).
- `lib/local-store/sqlite-backend.ts` — the two method impls + the `applyDelta` prescribed-run branch (local-pending-wins guard).
- `lib/sqlite/migrations.ts` — new `MIGRATIONS` block (`toVersion: 14`, current latest is 13) creating the local `prescribed_runs` table **and** its `RECONCILE_TABLES`/`RECONCILE_COLUMNS` entries (the reconcile path — not the versioned ALTER — is the real schema authority after a partial upgrade).
- `lib/local-store/sync-engine.ts` — row→`LocalPrescribedRun` mapping, `domains.running` flag, `applyDelta` call, and the outbox-ack branch for `'prescribed_run'`.
- `lib/sync/mutation-schema.ts` — add `'prescribed_run'` to the outbox `z.enum` domain list.
- `components/sync-provider.tsx` — invalidate the running-plan cache when `delta.domains.running` is set.
- `lib/cache-ttl.ts` — `RUNNING_PLAN_TTL`.
- `lib/cache-groups.ts` — `invalidateRunningPlan()` group.
- `lib/changelog.ts` + `package.json` — version/changelog (final task).

---

## PHASE 1 — MVP: baseline in → next-run prescription + recovery gate

### Task 1: Core types + lower-body set

**Files:**
- Create: `lib/running/types.ts`, `lib/running/lower-body.ts`, `lib/running/__tests__/lower-body.test.ts`

- [ ] **Step 1: Write the failing test** (`lib/running/__tests__/lower-body.test.ts`)

```typescript
import { describe, it, expect } from 'vitest'
import { isLowerBodyMuscle, LOWER_BODY_MUSCLES } from '../lower-body'

describe('isLowerBodyMuscle', () => {
  it('recognises canonical + synonym leg muscles', () => {
    expect(isLowerBodyMuscle('quadriceps')).toBe(true) // synonym → quads
    expect(isLowerBodyMuscle('Glutes')).toBe(true)
    expect(isLowerBodyMuscle('hamstring')).toBe(true)
    expect(isLowerBodyMuscle('calves')).toBe(true)
    expect(isLowerBodyMuscle('legs')).toBe(true)
  })
  it('rejects upper-body muscles', () => {
    expect(isLowerBodyMuscle('chest')).toBe(false)
    expect(isLowerBodyMuscle('biceps')).toBe(false)
  })
  it('exposes the canonical set (normalized, lowercased)', () => {
    expect(LOWER_BODY_MUSCLES.has('quads')).toBe(true)
    expect(LOWER_BODY_MUSCLES.has('quadriceps')).toBe(false) // stores canonical only
  })
})
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run lib/running/__tests__/lower-body.test.ts`
  Expected: FAIL — `Cannot find module '../lower-body'`.

- [ ] **Step 3: Implement `lib/running/lower-body.ts`**

```typescript
import { normalizeMuscle } from '@/lib/muscles'

// The single lower-body muscle set (One Place). Stored as canonical names — callers
// normalize first via normalizeMuscle so synonyms (quadriceps→quads, hamstring→hamstrings)
// resolve. Used by the recovery gate to detect a recent heavy leg session (concurrent-
// training interference — see plan design note 3).
export const LOWER_BODY_MUSCLES: ReadonlySet<string> = new Set([
  'quads', 'hamstrings', 'glutes', 'calves', 'legs', 'adductors', 'abductors', 'hip flexors',
])

export function isLowerBodyMuscle(raw: string): boolean {
  return LOWER_BODY_MUSCLES.has(normalizeMuscle(raw))
}
```

- [ ] **Step 4: Implement `lib/running/types.ts`** (no test — pure type surface consumed by later tasks)

```typescript
import type { HrZone } from '@/lib/health/hr-zones'

export type RunType = 'easy' | 'long' | 'interval' | 'tempo' | 'recovery'

export interface FitnessSnapshot {
  maxHr: number
  restingHr: number
  vo2max: number | null
  thresholdHr: number | null            // lactate/ventilatory threshold HR from baseline; null → derived
  weeklyBaseMinutes: number             // starting weekly easy-run minutes (from baseline or a floor)
  source: 'baseline' | 'age-estimate'
}

export interface RunTargets {
  zoneIds: HrZone['id'][]               // target zone(s), e.g. [1,2] for easy, [4,5] for interval
  hrLowBpm: number
  hrHighBpm: number
}

export interface Prescription {
  type: RunType
  durationMin: number | null
  distanceKm: number | null
  targets: RunTargets
  rationale: string                     // deterministic, template-generated — NEVER an AI string
  frameworkKey: string
}

export type GoalKind = 'cardio_health' | 'distance_event'
export interface RunningGoal {
  kind: GoalKind
  targetDistanceKm: number | null
  targetDate: string | null             // YYYY-MM-DD (user-tz), normalized on write
}

export interface FrameworkContext {
  fitness: FitnessSnapshot
  weekIndex: number                     // 0-based week since plan start
  runsThisWeek: { type: RunType; durationMin: number | null }[]
  goal: RunningGoal
}

export interface RunFramework {
  key: string
  label: string
  /** The ideal next run BEFORE the recovery gate softens it. */
  nextRun(ctx: FrameworkContext): Prescription
}
```

- [ ] **Step 5: Run test + commit** — Run: `npx vitest run lib/running/__tests__/lower-body.test.ts` → PASS.

```bash
git add lib/running/types.ts lib/running/lower-body.ts lib/running/__tests__/lower-body.test.ts
git commit -m "Add running-engine core types and the canonical lower-body muscle set"
```

---

### Task 2: Fitness snapshot resolver (baseline-first, age fallback)

**Files:**
- Create: `lib/running/fitness-snapshot.ts`, `lib/running/__tests__/fitness-snapshot.test.ts`

Reads whatever fitness data exists and always returns a usable snapshot. The cardio-baseline plan and `lib/health/vo2max.ts` may not exist yet — this resolver takes their outputs as **optional inputs** so it builds standalone.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { resolveFitnessSnapshot } from '../fitness-snapshot'

describe('resolveFitnessSnapshot', () => {
  it('uses measured baseline values when present', () => {
    const s = resolveFitnessSnapshot({
      age: 35, restingHr: 50,
      baseline: { vo2max: 52, maxHr: 188, thresholdHr: 168, weeklyBaseMinutes: 120 },
    })
    expect(s.source).toBe('baseline')
    expect(s.maxHr).toBe(188)
    expect(s.thresholdHr).toBe(168)
    expect(s.vo2max).toBe(52)
    expect(s.weeklyBaseMinutes).toBe(120)
  })

  it('falls back to age-based max HR and a base-minutes floor when no baseline', () => {
    const s = resolveFitnessSnapshot({ age: 40, restingHr: 55, baseline: null })
    expect(s.source).toBe('age-estimate')
    expect(s.maxHr).toBe(180)            // 220 - 40
    expect(s.thresholdHr).toBeNull()
    expect(s.vo2max).toBeNull()
    expect(s.weeklyBaseMinutes).toBe(60) // conservative starting floor
  })

  it('uses the 190 HR fallback when age is unknown and floors resting HR', () => {
    const s = resolveFitnessSnapshot({ age: null, restingHr: null, baseline: null })
    expect(s.maxHr).toBe(190)
    expect(s.restingHr).toBe(60)         // resting-HR fallback
  })
})
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run lib/running/__tests__/fitness-snapshot.test.ts`
  Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/running/fitness-snapshot.ts`**

```typescript
import { hrMaxFromAge } from '@/lib/health/hr-zones'
import type { FitnessSnapshot } from './types'

export interface BaselineResult {
  vo2max: number | null
  maxHr: number | null
  thresholdHr: number | null
  weeklyBaseMinutes: number | null
}

export interface FitnessSnapshotInputs {
  age: number | null
  restingHr: number | null
  /** From docs/.../2026-07-17-cardio-baseline-tests.md when available; null → age-based. */
  baseline: BaselineResult | null
}

const DEFAULT_RESTING_HR = 60
const BASE_MINUTES_FLOOR = 60

export function resolveFitnessSnapshot(i: FitnessSnapshotInputs): FitnessSnapshot {
  const restingHr = i.restingHr != null && i.restingHr > 0 ? i.restingHr : DEFAULT_RESTING_HR
  const b = i.baseline
  const hasBaseline = b != null && b.maxHr != null
  const maxHr = hasBaseline ? b!.maxHr! : hrMaxFromAge(i.age)
  return {
    maxHr,
    restingHr,
    vo2max: b?.vo2max ?? null,
    thresholdHr: b?.thresholdHr ?? null,
    weeklyBaseMinutes: b?.weeklyBaseMinutes ?? BASE_MINUTES_FLOOR,
    source: hasBaseline ? 'baseline' : 'age-estimate',
  }
}
```

- [ ] **Step 4: Run test + commit** — Run: `npx vitest run lib/running/__tests__/fitness-snapshot.test.ts` → PASS.

```bash
git add lib/running/fitness-snapshot.ts lib/running/__tests__/fitness-snapshot.test.ts
git commit -m "Add fitness-snapshot resolver (baseline-first, age-based HR fallback)"
```

---

### Task 3: HR targets per run type

**Files:**
- Create: `lib/running/hr-targets.ts`, `lib/running/__tests__/hr-targets.test.ts`

Maps each `RunType` to a target HR band, reusing `computeHrZones` (One Formula, One Place — no second zone math).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { targetsForRunType } from '../hr-targets'
import type { FitnessSnapshot } from '../types'

const fit: FitnessSnapshot = {
  maxHr: 190, restingHr: 50, vo2max: 50, thresholdHr: null,
  weeklyBaseMinutes: 90, source: 'baseline',
}

describe('targetsForRunType', () => {
  it('easy = zones 1-2, band below aerobic threshold', () => {
    const t = targetsForRunType('easy', fit)
    expect(t.zoneIds).toEqual([1, 2])
    // reserve = 140; z1 low = 50, z3 low = 50 + 0.7*140 = 148 → easy upper is the z3 boundary
    expect(t.hrLowBpm).toBe(50)
    expect(t.hrHighBpm).toBe(148)
  })
  it('interval = zones 4-5, top band', () => {
    const t = targetsForRunType('interval', fit)
    expect(t.zoneIds).toEqual([4, 5])
    expect(t.hrLowBpm).toBe(50 + Math.round(0.8 * 140)) // z4 low = 162
  })
  it('recovery caps at zone 1', () => {
    const t = targetsForRunType('recovery', fit)
    expect(t.zoneIds).toEqual([1])
    expect(t.hrHighBpm).toBe(50 + Math.round(0.6 * 140)) // z2 low = 134
  })
})
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run lib/running/__tests__/hr-targets.test.ts`
  Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/running/hr-targets.ts`**

```typescript
import { computeHrZones, type HrZone } from '@/lib/health/hr-zones'
import type { FitnessSnapshot, RunTargets, RunType } from './types'

// Which HR zones each run type targets (polarized model: easy work sits in 1-2,
// quality work in 4-5). Bands are read off the canonical Karvonen zones so there is
// no second HR-zone formula anywhere.
const ZONES_BY_TYPE: Record<RunType, HrZone['id'][]> = {
  recovery: [1],
  easy: [1, 2],
  long: [1, 2],
  tempo: [3, 4],
  interval: [4, 5],
}

export function targetsForRunType(type: RunType, fitness: FitnessSnapshot): RunTargets {
  const zones = computeHrZones({ maxHr: fitness.maxHr, restingHr: fitness.restingHr })
  const ids = ZONES_BY_TYPE[type]
  const first = zones.find(z => z.id === ids[0])!
  const last = zones.find(z => z.id === ids[ids.length - 1])!
  const hrLowBpm = first.minBpm
  // Upper bound = the top targeted zone's upper edge; the top zone's maxBpm is Infinity,
  // so cap it at the profile's maxHr instead.
  const hrHighBpm = Number.isFinite(last.maxBpm) ? last.maxBpm : fitness.maxHr
  return { zoneIds: ids, hrLowBpm, hrHighBpm }
}
```

- [ ] **Step 4: Run test + commit** — Run: `npx vitest run lib/running/__tests__/hr-targets.test.ts` → PASS.

```bash
git add lib/running/hr-targets.ts lib/running/__tests__/hr-targets.test.ts
git commit -m "Map run types to Karvonen HR target bands (reuses computeHrZones)"
```

---

### Task 4: Recovery gate (research-backed)

**Files:**
- Create: `lib/running/recovery-gate.ts`, `lib/running/__tests__/recovery-gate.test.ts`

The deterministic stage that softens/blocks a proposed run from real recovery signals. Pure function over already-fetched signals (DB access stays in the route).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { applyRecoveryGate, type RecoveryGateInputs } from '../recovery-gate'
import type { Prescription } from '../types'

const hardRun: Prescription = {
  type: 'interval', durationMin: 40, distanceKm: null,
  targets: { zoneIds: [4, 5], hrLowBpm: 162, hrHighBpm: 190 },
  rationale: 'ideal', frameworkKey: 'polarized-80-20',
}
const base: RecoveryGateInputs = {
  readiness: 80, readinessProvisional: false,
  hoursSinceLowerBodyStrength: 96, lastLowerBodyVolumeKg: 0,
  strain: null, acwr: 1.0, hoursSinceLastRun: 48, sleepHoursLastNight: 8,
}

describe('applyRecoveryGate', () => {
  it('proceeds when everything is fresh', () => {
    const r = applyRecoveryGate(hardRun, base)
    expect(r.action).toBe('proceed')
    expect(r.prescription.type).toBe('interval')
  })

  it('softens a hard run the day after a heavy leg session (interference effect)', () => {
    const r = applyRecoveryGate(hardRun, { ...base, hoursSinceLowerBodyStrength: 18, lastLowerBodyVolumeKg: 6000 })
    expect(r.action).toBe('soften')
    expect(r.prescription.type).toBe('easy')
    expect(r.reasons.some(x => /leg|lower-body|interference/i.test(x))).toBe(true)
  })

  it('rests when readiness is very low', () => {
    const r = applyRecoveryGate(hardRun, { ...base, readiness: 45 })
    expect(r.action).toBe('rest')
    expect(r.prescription.type).toBe('recovery')
  })

  it('softens (never rests) when readiness is still provisional — degrade, do not fabricate', () => {
    const r = applyRecoveryGate(hardRun, { ...base, readiness: null, readinessProvisional: true })
    expect(r.action).toBe('soften')
    expect(r.reasons.some(x => /readiness.*(learning|provisional)/i.test(x))).toBe(true)
  })

  it('softens on very high ACWR / strain spike', () => {
    const r = applyRecoveryGate(hardRun, { ...base, acwr: 1.6 })
    expect(r.action).toBe('soften')
  })

  it('leaves an already-easy run untouched even when softening', () => {
    const easy: Prescription = { ...hardRun, type: 'easy', targets: { zoneIds: [1, 2], hrLowBpm: 100, hrHighBpm: 148 } }
    const r = applyRecoveryGate(easy, { ...base, acwr: 1.6 })
    expect(r.prescription.type).toBe('easy') // softening a soft run is a no-op on type
  })
})
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run lib/running/__tests__/recovery-gate.test.ts`
  Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/running/recovery-gate.ts`**

```typescript
import { ACWR_THRESHOLDS } from '@/lib/ai-periodization/acwr'
import { targetsForRunType } from './hr-targets'
import type { FitnessSnapshot, Prescription, RunType } from './types'

export type GateAction = 'proceed' | 'soften' | 'rest'

export interface RecoveryGateInputs {
  readiness: number | null              // oura_daily_derived.readiness_score (0-100)
  readinessProvisional: boolean         // true while composite baseline still learning (n_history < 14)
  hoursSinceLowerBodyStrength: number | null  // most recent heavy lower-body strength session
  lastLowerBodyVolumeKg: number         // its volume load (0 if none / not heavy)
  strain: number | null                 // Foster strain (computeMonotonyStrain)
  acwr: number | null                   // computeVolumeAcwr
  hoursSinceLastRun: number | null
  sleepHoursLastNight: number | null
}

export interface RecoveryGateResult {
  action: GateAction
  reasons: string[]
  prescription: Prescription            // possibly-softened copy
}

// Thresholds — this module's calibration constants (deterministic, documented).
const HEAVY_LEG_VOLUME_KG = 3000        // a session above this counts as a "heavy" leg day
const LEG_INTERFERENCE_HOURS = 24       // hard running within 24h of heavy legs is downgraded
const READINESS_REST = 50               // below this → rest
const READINESS_SOFTEN = 65             // below this → soften
const SHORT_SLEEP_HOURS = 5.5

const HARD: ReadonlySet<RunType> = new Set(['interval', 'tempo', 'long'])

export function applyRecoveryGate(p: Prescription, i: RecoveryGateInputs): RecoveryGateResult {
  const reasons: string[] = []
  let action: GateAction = 'proceed'
  const escalate = (to: GateAction) => {
    const rank = { proceed: 0, soften: 1, rest: 2 } as const
    if (rank[to] > rank[action]) action = to
  }

  // Hard signals → rest.
  if (i.readiness != null && i.readiness < READINESS_REST) {
    escalate('rest'); reasons.push(`Readiness is low (${i.readiness}/100) — an easy recovery day helps more than a hard run.`)
  }

  // Concurrent-training interference: hard run soon after a heavy lower-body session.
  if (
    HARD.has(p.type) &&
    i.hoursSinceLowerBodyStrength != null &&
    i.hoursSinceLowerBodyStrength < LEG_INTERFERENCE_HOURS &&
    i.lastLowerBodyVolumeKg >= HEAVY_LEG_VOLUME_KG
  ) {
    escalate('soften')
    reasons.push('You trained legs hard in the last day — running hard now blunts both adaptations (interference effect) and adds injury risk, so this is an easy run.')
  }

  if (i.readinessProvisional) {
    escalate('soften'); reasons.push('Your readiness baseline is still learning (provisional) — keeping today easy until it is trustworthy.')
  } else if (i.readiness != null && i.readiness < READINESS_SOFTEN) {
    escalate('soften'); reasons.push(`Readiness is a little down (${i.readiness}/100) — dialing today back.`)
  }
  if (i.acwr != null && i.acwr > ACWR_THRESHOLDS.optimalMax) {
    escalate('soften'); reasons.push('Your recent training load is spiking — easy today to keep the acute:chronic ratio in the safe zone.')
  }
  if (i.sleepHoursLastNight != null && i.sleepHoursLastNight < SHORT_SLEEP_HOURS) {
    escalate('soften'); reasons.push(`Short sleep last night (${i.sleepHoursLastNight.toFixed(1)}h) — going easy.`)
  }

  if (action === 'proceed' || !HARD.has(p.type)) {
    return { action: action === 'rest' ? 'rest' : action, reasons, prescription: action === 'rest' ? downgrade(p, 'recovery') : p }
  }
  const targetType: RunType = action === 'rest' ? 'recovery' : 'easy'
  return { action, reasons, prescription: downgrade(p, targetType) }
}

// Rebuild the prescription as a gentler type, recomputing its HR targets. Duration is
// trimmed for a softened session. Needs the fitness snapshot to re-band — carried on the
// prescription's targets is not enough, so the gate re-derives from maxHr/restingHr via
// the low/high already present when possible; the route passes a fresh snapshot instead.
function downgrade(p: Prescription, to: RunType): Prescription {
  return { ...p, type: to, rationale: p.rationale, targets: p.targets, durationMin: p.durationMin != null ? Math.round(p.durationMin * (to === 'recovery' ? 0.5 : 0.7)) : null }
}

/** Re-target a softened prescription against the current fitness snapshot (called by the
 *  route after applyRecoveryGate so the HR band matches the new, gentler type). */
export function retarget(p: Prescription, fitness: FitnessSnapshot): Prescription {
  return { ...p, targets: targetsForRunType(p.type, fitness) }
}
```

- [ ] **Step 4: Run test + commit** — Run: `npx vitest run lib/running/__tests__/recovery-gate.test.ts` → PASS.

```bash
git add lib/running/recovery-gate.ts lib/running/__tests__/recovery-gate.test.ts
git commit -m "Add recovery gate: downgrade hard runs on low readiness, heavy legs, load spikes"
```

> Note for the implementer: the `downgrade` helper keeps the old HR band; the route calls `retarget(result.prescription, fitness)` immediately after `applyRecoveryGate` so the softened run's HR targets match its new type. The gate tests assert on `type`, not band, so the split is clean.

---

### Task 5: Polarized 80/20 framework + registry

**Files:**
- Create: `lib/running/framework.ts`, `lib/running/frameworks/polarized.ts`, `lib/running/__tests__/polarized.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { getFramework } from '../framework'
import type { FitnessSnapshot, RunningGoal } from '../types'

const fitness: FitnessSnapshot = {
  maxHr: 190, restingHr: 50, vo2max: 50, thresholdHr: 168,
  weeklyBaseMinutes: 100, source: 'baseline',
}
const goal: RunningGoal = { kind: 'cardio_health', targetDistanceKm: null, targetDate: null }

describe('polarized 80/20 framework', () => {
  const fw = getFramework('polarized-80-20')

  it('is registered under its key', () => {
    expect(fw.key).toBe('polarized-80-20')
  })

  it('first run of the week with no history is an easy run', () => {
    const p = fw.nextRun({ fitness, weekIndex: 0, runsThisWeek: [], goal })
    expect(p.type).toBe('easy')
    expect(p.durationMin).toBeGreaterThan(0)
    expect(p.frameworkKey).toBe('polarized-80-20')
    expect(p.rationale.length).toBeGreaterThan(0)
  })

  it('after ~4 easy runs, prescribes the weekly quality session', () => {
    const easy = { type: 'easy' as const, durationMin: 30 }
    const p = fw.nextRun({ fitness, weekIndex: 0, runsThisWeek: [easy, easy, easy, easy], goal })
    expect(['interval', 'tempo']).toContain(p.type)
  })

  it('caps weekly volume growth at ~10% per week', () => {
    const p0 = fw.nextRun({ fitness, weekIndex: 0, runsThisWeek: [], goal })
    const p2 = fw.nextRun({ fitness, weekIndex: 2, runsThisWeek: [], goal })
    // week-2 easy run is longer, but not more than ~1.1^2 of the week-0 one
    expect(p2.durationMin!).toBeLessThanOrEqual(Math.ceil(p0.durationMin! * 1.1 ** 2) + 1)
  })

  it('an unknown framework key throws (fail closed, not a silent default)', () => {
    expect(() => getFramework('nope')).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run lib/running/__tests__/polarized.test.ts`
  Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/running/frameworks/polarized.ts`**

```typescript
import { targetsForRunType } from '../hr-targets'
import type { FrameworkContext, Prescription, RunFramework, RunType } from '../types'

const KEY = 'polarized-80-20'
const WEEKLY_GROWTH = 1.10           // ≤10% weekly volume progression
const QUALITY_AFTER_EASY = 4         // ~1 quality session per ~5 runs → ~20% hard
const LONG_RUN_FRACTION = 0.35       // the week's long run ≈ 35% of weekly minutes

// Polarized/pyramidal distribution (Seiler & Kjerland 2006; Stöggl & Sperlich 2014):
// ~80% easy aerobic volume, ~20% high-intensity quality. Deterministic — no randomness,
// no LLM. Progression is a simple capped week-over-week volume increase.
function nextRun(ctx: FrameworkContext): Prescription {
  const weeklyMinutes = Math.round(ctx.fitness.weeklyBaseMinutes * WEEKLY_GROWTH ** ctx.weekIndex)
  const easySoFar = ctx.runsThisWeek.filter(r => r.type === 'easy' || r.type === 'long' || r.type === 'recovery').length
  const hardSoFar = ctx.runsThisWeek.filter(r => r.type === 'interval' || r.type === 'tempo').length
  const hasLong = ctx.runsThisWeek.some(r => r.type === 'long')

  let type: RunType
  let durationMin: number
  let rationale: string

  if (hardSoFar === 0 && easySoFar >= QUALITY_AFTER_EASY) {
    type = 'interval'
    durationMin = Math.max(25, Math.round(weeklyMinutes * 0.2))
    rationale = 'This is your weekly quality session — short, hard intervals in your top HR zones are what actually push VO₂max up. It is the ~20% of "hard" in the 80/20 model.'
  } else if (!hasLong && easySoFar >= 2) {
    type = 'long'
    durationMin = Math.round(weeklyMinutes * LONG_RUN_FRACTION)
    rationale = 'Your weekly long easy run — time on feet at a conversational pace builds the aerobic base that most of your fitness comes from.'
  } else {
    type = 'easy'
    durationMin = Math.max(20, Math.round(weeklyMinutes * 0.22))
    rationale = 'An easy aerobic run — keep it conversational (Zone 1–2). ~80% of your running should feel this comfortable; that is what makes the hard days work.'
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

export const polarizedFramework: RunFramework = { key: KEY, label: 'Polarized 80/20', nextRun }
```

- [ ] **Step 4: Implement `lib/running/framework.ts`**

```typescript
import type { RunFramework } from './types'
import { polarizedFramework } from './frameworks/polarized'

// Framework registry — add a new template by adding a module + a line here. The engine,
// gate, route, and tables are framework-agnostic (design note 2).
const FRAMEWORKS: Record<string, RunFramework> = {
  [polarizedFramework.key]: polarizedFramework,
}

export const DEFAULT_FRAMEWORK_KEY = polarizedFramework.key

export function getFramework(key: string): RunFramework {
  const fw = FRAMEWORKS[key]
  if (!fw) throw new Error(`Unknown running framework: ${key}`)
  return fw
}
```

- [ ] **Step 5: Run test + commit** — Run: `npx vitest run lib/running/__tests__/polarized.test.ts` → PASS.

```bash
git add lib/running/framework.ts lib/running/frameworks/polarized.ts lib/running/__tests__/polarized.test.ts
git commit -m "Add polarized 80/20 running framework and swappable framework registry"
```

---

### Task 6: Prescription orchestrator (framework → gate → final)

**Files:**
- Create: `lib/running/prescription.ts`, `lib/running/__tests__/prescription.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { prescribeNextRun } from '../prescription'
import type { FitnessSnapshot, RunningGoal } from '../types'
import type { RecoveryGateInputs } from '../recovery-gate'

const fitness: FitnessSnapshot = {
  maxHr: 190, restingHr: 50, vo2max: 50, thresholdHr: 168,
  weeklyBaseMinutes: 120, source: 'baseline',
}
const goal: RunningGoal = { kind: 'cardio_health', targetDistanceKm: null, targetDate: null }
const fresh: RecoveryGateInputs = {
  readiness: 82, readinessProvisional: false, hoursSinceLowerBodyStrength: 96,
  lastLowerBodyVolumeKg: 0, strain: null, acwr: 1.0, hoursSinceLastRun: 48, sleepHoursLastNight: 8,
}

describe('prescribeNextRun', () => {
  it('returns the framework run when recovery is fine', () => {
    const out = prescribeNextRun(
      { fitness, weekIndex: 0, runsThisWeek: [{ type: 'easy', durationMin: 30 }, { type: 'easy', durationMin: 30 }, { type: 'easy', durationMin: 30 }, { type: 'easy', durationMin: 30 }], goal },
      fresh, 'polarized-80-20',
    )
    expect(out.gateAction).toBe('proceed')
    expect(['interval', 'tempo']).toContain(out.prescription.type)
  })

  it('softens the quality session after a heavy leg day and re-bands HR to the easy zones', () => {
    const out = prescribeNextRun(
      { fitness, weekIndex: 0, runsThisWeek: [{ type: 'easy', durationMin: 30 }, { type: 'easy', durationMin: 30 }, { type: 'easy', durationMin: 30 }, { type: 'easy', durationMin: 30 }], goal },
      { ...fresh, hoursSinceLowerBodyStrength: 14, lastLowerBodyVolumeKg: 5000 },
      'polarized-80-20',
    )
    expect(out.gateAction).toBe('soften')
    expect(out.prescription.type).toBe('easy')
    expect(out.prescription.targets.zoneIds).toEqual([1, 2]) // re-targeted, not the interval band
  })
})
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run lib/running/__tests__/prescription.test.ts`
  Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/running/prescription.ts`**

```typescript
import { getFramework } from './framework'
import { applyRecoveryGate, retarget, type GateAction, type RecoveryGateInputs } from './recovery-gate'
import type { FrameworkContext, Prescription } from './types'

export interface PrescribeResult {
  prescription: Prescription
  gateAction: GateAction
  gateReasons: string[]
}

export function prescribeNextRun(
  ctx: FrameworkContext,
  gateInputs: RecoveryGateInputs,
  frameworkKey: string,
): PrescribeResult {
  const ideal = getFramework(frameworkKey).nextRun(ctx)
  const gated = applyRecoveryGate(ideal, gateInputs)
  const prescription = gated.action === 'proceed' ? ideal : retarget(gated.prescription, ctx.fitness)
  return { prescription, gateAction: gated.action, gateReasons: gated.reasons }
}
```

- [ ] **Step 4: Run test + commit** — Run: `npx vitest run lib/running/__tests__/prescription.test.ts` → PASS.

```bash
git add lib/running/prescription.ts lib/running/__tests__/prescription.test.ts
git commit -m "Add prescribeNextRun orchestrator (framework proposes, recovery gate disposes)"
```

---

### Task 7: Migration 132 + schema + repository interface

**Files:**
- Create: `lib/data/postgres/migrations/132_running_plans.sql`
- Modify: `lib/data/postgres/schema.ts`, `lib/data/repository.ts`

- [ ] **Step 1: Re-confirm migration 132 is free.** Run: `ls lib/data/postgres/migrations/ | grep '^13' ; grep -rl "132_\|migration 132" docs/superpowers/plans/`
  Expected: no file named `132_*`, and no *other* plan claiming 132. If taken, use the next free number and update every reference in this task.

- [ ] **Step 2: Write `lib/data/postgres/migrations/132_running_plans.sql`**

```sql
-- Running Prescription Engine (design: docs/superpowers/plans/2026-07-17-running-prescription-engine.md).
-- running_plans: one active plan per user (goal + framework + fitness snapshot).
-- prescribed_runs: each generated run; status flips to completed/skipped as a user write,
-- and links the actual activity_logs row on completion. Soft-deletable + synced.
CREATE TABLE IF NOT EXISTS running_plans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_kind          text NOT NULL DEFAULT 'cardio_health',
  target_distance_km double precision,
  target_date        date,
  framework_key      text NOT NULL DEFAULT 'polarized-80-20',
  fitness_snapshot   jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS running_plans_one_active_per_user
  ON running_plans (user_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS prescribed_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id         uuid NOT NULL REFERENCES running_plans(id) ON DELETE CASCADE,
  date            date NOT NULL,
  run_type        text NOT NULL,
  duration_min    double precision,
  distance_km     double precision,
  target_hr_low   integer,
  target_hr_high  integer,
  target_zone_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  rationale       text NOT NULL DEFAULT '',
  gate_action     text NOT NULL DEFAULT 'proceed',
  status          text NOT NULL DEFAULT 'pending',   -- 'pending' | 'completed' | 'skipped'
  activity_log_id uuid REFERENCES activity_logs(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS prescribed_runs_user_plan_date
  ON prescribed_runs (user_id, plan_id, date);
CREATE INDEX IF NOT EXISTS prescribed_runs_user_date ON prescribed_runs (user_id, date);
```

- [ ] **Step 3: Add Drizzle tables to `lib/data/postgres/schema.ts`** (append after `activityLogs`, since it FKs that table)

```typescript
export const runningPlans = pgTable('running_plans', {
  id:               uuid('id').primaryKey().defaultRandom(),
  userId:           uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  goalKind:         text('goal_kind').notNull().default('cardio_health'),
  targetDistanceKm: doublePrecision('target_distance_km'),
  targetDate:       date('target_date', { mode: 'string' }),
  frameworkKey:     text('framework_key').notNull().default('polarized-80-20'),
  fitnessSnapshot:  jsonb('fitness_snapshot').notNull().default({}),
  isActive:         boolean('is_active').notNull().default(true),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const prescribedRuns = pgTable('prescribed_runs', {
  id:            uuid('id').primaryKey().defaultRandom(),
  userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  planId:        uuid('plan_id').notNull().references(() => runningPlans.id, { onDelete: 'cascade' }),
  date:          date('date', { mode: 'string' }).notNull(),
  runType:       text('run_type').notNull(),
  durationMin:   doublePrecision('duration_min'),
  distanceKm:    doublePrecision('distance_km'),
  targetHrLow:   integer('target_hr_low'),
  targetHrHigh:  integer('target_hr_high'),
  targetZoneIds: jsonb('target_zone_ids').notNull().default([]),
  rationale:     text('rationale').notNull().default(''),
  gateAction:    text('gate_action').notNull().default('proceed'),
  status:        text('status').notNull().default('pending'),
  activityLogId: uuid('activity_log_id').references(() => activityLogs.id, { onDelete: 'set null' }),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:     timestamp('deleted_at', { withTimezone: true }),
}, t => [unique().on(t.userId, t.planId, t.date)])
```

- [ ] **Step 4: Add repository interface methods to `lib/data/repository.ts`** (near the activity-log methods). Add the row types + interface signatures:

```typescript
export interface RunningPlan {
  id: string; userId: string; goalKind: string; targetDistanceKm: number | null
  targetDate: string | null; frameworkKey: string; fitnessSnapshot: unknown
  isActive: boolean; createdAt: Date; updatedAt: Date
}
export interface PrescribedRun {
  id: string; userId: string; planId: string; date: string; runType: string
  durationMin: number | null; distanceKm: number | null
  targetHrLow: number | null; targetHrHigh: number | null; targetZoneIds: number[]
  rationale: string; gateAction: string; status: 'pending' | 'completed' | 'skipped'
  activityLogId: string | null; updatedAt: Date
}
export interface PrescribedRunUpdate {   // Zod-whitelisted PATCH body — never a raw request body into .set()
  status?: 'completed' | 'skipped'
  activityLogId?: string | null
}

// on the Repository interface:
getActiveRunningPlan(userId: string): Promise<RunningPlan | null>
saveRunningPlan(userId: string, plan: Omit<RunningPlan, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<RunningPlan>
getPrescribedRuns(userId: string, from: string, to: string): Promise<PrescribedRun[]>
upsertPrescribedRun(userId: string, run: Omit<PrescribedRun, 'userId' | 'updatedAt'>): Promise<PrescribedRun>
updatePrescribedRun(userId: string, id: string, patch: PrescribedRunUpdate): Promise<PrescribedRun | null>
```

- [ ] **Step 5: Apply the migration locally + verify.** Run: `pnpm db:local && PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d trainingai_dev -c '\d prescribed_runs'`
  Expected: the table prints with all columns; `pnpm db:local` reports migrations applied without error.

- [ ] **Step 6: Commit**

```bash
git add lib/data/postgres/migrations/132_running_plans.sql lib/data/postgres/schema.ts lib/data/repository.ts
git commit -m "Add running_plans + prescribed_runs tables, schema, and repository interface"
```

---

### Task 8: Adapter implementation + push/pull mirror

**Files:**
- Modify: `lib/data/postgres/adapter.ts`

Implement the five repo methods, the `pushMutations` `'prescribed_run'` branch, and the pull-delta output. The push branch must call `updatePrescribedRun`/`upsertPrescribedRun` (shared repo functions) — **never** `this.db`/raw `sql` directly (CI rule `scripts/check-push-mutations.js`). Every UPDATE is scoped to `user_id`.

- [ ] **Step 1: Implement the five methods** in `adapter.ts` (Drizzle, `and(eq(userId), eq(id))` scoping, `rowToPrescribedRun` mapper covering every column). Signatures exactly as the interface in Task 7 Step 4. `updatePrescribedRun` returns `null` when 0 rows match the `(user_id, id)` scope (ownership check — never an unscoped write).

- [ ] **Step 2: Add the `pushMutations` branch.** In the domain switch, handle `'prescribed_run'`: `const parsed = PrescribedRunPatchBody.safeParse({ ...mut.payload, id: (mut.payload as any).id })` (importing the shared schema from `lib/validation/prescribed-run.ts`, created in Task 10 Step 1 — mirror the `ActivityLogBody` import at `adapter.ts:35`); push-error on failure; then call `this.updatePrescribedRun(userId, parsed.data.id, { status: parsed.data.status, activityLogId: parsed.data.activityLogId ?? null })`. No `this.db` / raw `sql` — delegate to the shared repo function only.

- [ ] **Step 3: Emit prescribed runs in `getSyncDelta` + map in the pull.** Add `prescribed_runs` to the delta payload (rows where `updated_at > cursor`, including `deleted_at` tombstones) and the corresponding `pullDelta`/`applyDelta` upsert columns, mirroring the `activity_logs` handling. Gate the `applyDelta` upsert on `sync_status === 'synced'` so a pull never clobbers a pending local completion.

- [ ] **Step 4: Verify the CI push-mutations rule passes.** Run: `node scripts/check-push-mutations.js`
  Expected: exits 0 (no `this.db`/raw `sql` inside `pushMutations`).

- [ ] **Step 5: Typecheck + commit** — Run: `npx tsc --noEmit 2>&1 | grep -i "adapter\|running\|prescribed" || echo clean` → `clean`.

```bash
git add lib/data/postgres/adapter.ts
git commit -m "Implement running-plan repository methods, push-mutation mirror, and pull delta"
```

---

### Task 9: `GET`/`POST /api/running-plan`

**Files:**
- Create: `app/api/running-plan/route.ts`

- [ ] **Step 1: Implement the route.**
  - **Auth + rate limit** (mirror siblings): `rateLimit(\`${userId}:running-plan\`, 20, 60_000)` → 429.
  - **`GET`**: reads the active plan; if none, returns `{ plan: null, prescription: null }`. Otherwise assembles the engine inputs and returns `{ plan, prescription, gateAction, gateReasons }`:
    - `tz = session.user?.timezone ?? DEFAULT_TZ`; `today = todayInTz(tz)`; `todayMid = todayMidnightUtc(tz)`.
    - `fitness` = `resolveFitnessSnapshot({ age: ageFromDob(user.dateOfBirth, new Date()), restingHr: <latest body_metrics.resting_heart_rate>, baseline: <cardio-baseline result or null> })`. **The cardio-baseline read is behind a `try { ... } catch { baseline = null }`** so this route works before that sibling ships.
    - `runsThisWeek` = `getPrescribedRuns(userId, <monday of this week>, today)` filtered to `status !== 'skipped'`, mapped to `{ type, durationMin }`. Week start via `lib/date-utils` (never `now − N×86400000`).
    - Gate inputs: readiness from `repo.getOuraDailyDerived(userId, today, today)[0]?.readinessScore`; `readinessProvisional` from `repo.getOuraDailySummary(userId, today, today)[0]?.nHistory < 14`; `hoursSinceLowerBodyStrength`/`lastLowerBodyVolumeKg` from the most recent `getWorkoutSessionsFrom(userId, todayMid − 3d)` whose `exercise_logs.muscleGroups` intersect `isLowerBodyMuscle`; `acwr`/`strain` from `computeVolumeAcwr`/`computeMonotonyStrain` over `getSessionLoadsFrom(userId, todayMid − 28d)`; `hoursSinceLastRun` from `listActivityLogs` type `'run'`; `sleepHoursLastNight` from `listSleepSessions`.
    - `const { prescription, gateAction, gateReasons } = prescribeNextRun(ctx, gateInputs, plan.frameworkKey)`.
    - **SWR headers**: `Cache-Control: private, max-age=60, stale-while-revalidate=120`.
  - **`POST`** (create/replace the active plan from baseline+goal): Zod-validate the body (`goalKind`, `targetDistanceKm?`, `targetDate?` → `normalizeDateParam`, `frameworkKey` default `DEFAULT_FRAMEWORK_KEY`). Compute the `FitnessSnapshot`, deactivate any existing active plan (scoped UPDATE `is_active=false WHERE user_id`), `saveRunningPlan`, then generate and `upsertPrescribedRun` today's first prescription. Returns the new plan + prescription. This is an online deliberate action (no outbox).

- [ ] **Step 2: Dev-server smoke.** Run: `pnpm dev`, log in as `test@local.dev`/`testpass123`.
  - `POST /api/running-plan` with `{ "goalKind": "cardio_health" }` → 200 with a `plan` + `prescription` (type `easy`, non-empty `rationale`, HR band).
  - `GET /api/running-plan` → 200, same plan, a prescription; verify `Cache-Control` header present (`curl -sI`).
  - Seed a today `oura_daily_derived.readiness_score = 45` (psql, port 5433) → `GET` returns `gateAction: "rest"`, prescription type `recovery`, a `gateReasons` sentence about readiness.

- [ ] **Step 3: Commit**

```bash
git add app/api/running-plan/route.ts
git commit -m "Add GET/POST /api/running-plan (assemble engine inputs, gate-aware prescription)"
```

---

### Task 10: Offline-first completion write (`PATCH` + outbox mirror)

**Files:**
- Create: `lib/validation/prescribed-run.ts`, `app/api/running-plan/runs/[id]/route.ts`
- Modify: `lib/sync/mutation-schema.ts`, `lib/local-store/types.ts`, `lib/local-store/index.ts`, `lib/sqlite/migrations.ts`, `lib/local-store/sqlite-backend.ts`, `lib/local-store/sync-engine.ts`, `components/sync-provider.tsx`, `lib/data/postgres/adapter.ts`

Marking a prescribed run completed/skipped is the domain's only offline-first user write. Mirror the `activity_logs` chain exactly (verified against `lib/validation/activity-log.ts`, `lib/sqlite/migrations.ts`, `lib/local-store/sync-engine.ts`).

- [ ] **Step 1: Shared completion schema** (`lib/validation/prescribed-run.ts`) — the one Zod schema both the web PATCH and `pushMutations` import (the `activity-log.ts` "shared by the web route and pushMutations" pattern):

```typescript
import { z } from 'zod'

// Shared by the web PATCH route (app/api/running-plan/runs/[id]) and the pushMutations
// 'prescribed_run' branch — one schema so the two write paths cannot drift.
export const PrescribedRunPatchBody = z.object({
  id:            z.string().uuid(),
  status:        z.enum(['completed', 'skipped']),
  activityLogId: z.string().uuid().nullable().optional(),
})
export type PrescribedRunPatch = z.infer<typeof PrescribedRunPatchBody>
```

- [ ] **Step 2: Outbox enum** (`lib/sync/mutation-schema.ts:9`) — add `'prescribed_run'` to the `domain` `z.enum([...])` list. (The payload is the generic `z.record` already in `MutationSchema`; the shared schema above validates it inside `pushMutations`.)

- [ ] **Step 3: Local store type + interface.** `lib/local-store/types.ts`: add `'prescribed_run'` to the `PendingMutation.domain` union (line ~298) and a `LocalPrescribedRun` interface (columns mirroring `prescribed_runs`, `zoneIds: number[]`, + `syncStatus: 'pending' | 'synced'`). `lib/local-store/index.ts`: add `getPrescribedRuns(cutoffDate: string): Promise<LocalPrescribedRun[]>` and `upsertPrescribedRun(record: LocalPrescribedRun): Promise<void>` to the `LocalStore` interface, and `prescribedRuns?: LocalPrescribedRun[]` to the `applyDelta({...})` argument.

- [ ] **Step 4: Local schema** (`lib/sqlite/migrations.ts`) — append a `MIGRATIONS` block `{ toVersion: 14, statements: ['CREATE TABLE IF NOT EXISTS prescribed_runs (id TEXT PRIMARY KEY, plan_id TEXT, date TEXT, run_type TEXT, duration_min REAL, distance_km REAL, target_hr_low INTEGER, target_hr_high INTEGER, target_zone_ids TEXT, rationale TEXT, gate_action TEXT, status TEXT, activity_log_id TEXT, updated_at TEXT, sync_status TEXT, deleted_at TEXT)'] }` (no PRAGMA inside the upgrade transaction; a bare `CREATE TABLE IF NOT EXISTS` is idempotent under a retried partial upgrade). Register it in **`RECONCILE_TABLES`** (a `CREATE_PRESCRIBED_RUNS` const) **and** every column in **`RECONCILE_COLUMNS`** in this same commit — the reconcile path (not the versioned block) is the real schema authority after a partial upgrade; do not also add versioned `ALTER`s.

- [ ] **Step 5: SQLite backend** (`lib/local-store/sqlite-backend.ts`): implement `getPrescribedRuns(cutoffDate)` (`SELECT * FROM prescribed_runs WHERE date >= ? AND deleted_at IS NULL ORDER BY date`) and `upsertPrescribedRun(record)` (`INSERT ... ON CONFLICT(id) DO UPDATE SET ...` overwriting all columns — a completion is a full-row write, no read-merge). Add the `applyDelta` prescribed-run branch mirroring the `activity_logs` one (~line 870): tombstone `DELETE ... WHERE id=? AND sync_status='synced'`, else insert-on-conflict guarded by `WHERE prescribed_runs.sync_status='synced'` (local pending wins — never clobber an unsynced completion).

- [ ] **Step 6: Sync engine** (`lib/local-store/sync-engine.ts`): add the row→`LocalPrescribedRun` mapping (mirror the `activityLogs` map ~line 194), a `domains.running` flag (declare `running: boolean` ~line 42, init `false` ~line 408, set `running: prescribedRuns.length > 0` ~line 392, OR-merge across pages ~line 429), pass `prescribedRuns` into `applyDelta(...)` (~line 376), and the outbox-ack branch (~line 553): `else if (m.domain === 'prescribed_run') { const recs = await store.getPrescribedRuns(m.date); const rec = recs.find(r => r.id === (m.payload as any).id); if (rec) await store.upsertPrescribedRun({ ...rec, syncStatus: 'synced' }) }`. In `getSyncDelta` (`adapter.ts:2792`) add the `prescribedRuns` page (query by `gt(updatedAt, since)`, include tombstones, respect `pageLimit`/`hasMore`) alongside `activityLogs`.

- [ ] **Step 7: Sync provider** (`components/sync-provider.tsx`): after applying a delta, `if (delta.domains.running) await invalidateRunningPlan()` (the group added in Task 12 Step 1) — alongside the existing `delta.domains.activity` invalidation (~line 122).

- [ ] **Step 8: Web `PATCH /api/running-plan/runs/[id]`.** Auth + rate limit; parse the body with the **shared** `PrescribedRunPatchBody` (never a raw body into Drizzle `.set()`), then `repo.updatePrescribedRun(userId, id, { status, activityLogId })`; 404 when it returns `null` (ownership — the 0-row scoped match). No SWR header (mutation). This is the exact same write the `pushMutations` `'prescribed_run'` branch performs (Task 8 Step 2, which imports the same `PrescribedRunPatchBody` and calls the same `updatePrescribedRun`) — one shared schema, one shared repo function, both paths.

- [ ] **Step 9: Verify parity + typecheck.** Run: `npx vitest run lib/data/postgres/__tests__/push-mutations-web-parity.test.ts && node scripts/check-push-mutations.js`
  Expected: parity test PASS, check exits 0 (the push branch delegates to `updatePrescribedRun`, no `this.db`/raw `sql`). Then `npx tsc --noEmit 2>&1 | grep -iE "prescribed|running|mutation" || echo clean` → `clean`.

- [ ] **Step 10: Commit**

```bash
git add lib/validation/prescribed-run.ts app/api/running-plan/runs lib/sync/mutation-schema.ts lib/local-store/types.ts lib/local-store/index.ts lib/sqlite/migrations.ts lib/local-store/sqlite-backend.ts lib/local-store/sync-engine.ts components/sync-provider.tsx lib/data/postgres/adapter.ts
git commit -m "Make prescribed-run completion offline-first: local table, outbox, push+pull mirror"
```

---

### Task 11: AI flavour route (prose only, best-effort, never gates)

**Files:**
- Create: `app/api/running-plan/explain/route.ts`

Rephrases the deterministic `rationale` + `gateReasons` into one warm sentence of encouragement. Prose only — no `generateObject`, no `JSON.parse` of model text, wrapped in try/catch returning JSON, rate-limited. If it fails, the caller falls back to the deterministic `rationale` (the AI is never load-bearing).

- [ ] **Step 1: Implement the route** (mirror `app/api/ai/health-insight/route.ts`):

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'

const Body = z.object({
  type: z.string(), durationMin: z.number().nullable(),
  rationale: z.string(), gateReasons: z.array(z.string()),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`running-explain:${userId}`, 15, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { type, durationMin, rationale, gateReasons } = parsed.data

  try {
    const { text } = await generateText({
      model: google('gemini-3.1-flash-lite'),
      prompt: `You are a supportive running coach. In ONE encouraging sentence (no numbers you invent, no medical claims), restate why today's run is a "${type}" run${durationMin ? ` of about ${durationMin} minutes` : ''}. Base it ONLY on this reasoning: ${[rationale, ...gateReasons].join(' ')}`,
    })
    return NextResponse.json({ message: text.trim() })
  } catch (err) {
    // AI is flavour only — never load-bearing. Fall back to the deterministic rationale.
    return NextResponse.json({ message: rationale, degraded: true }, { status: 200 })
  }
}
```

- [ ] **Step 2: Dev-server smoke.** `POST /api/running-plan/explain` with a sample body → 200 `{ message }` (a single sentence, or the deterministic `rationale` if the AI key is absent — either is acceptable, the number in the prescription is unchanged).

- [ ] **Step 3: Commit**

```bash
git add app/api/running-plan/explain/route.ts
git commit -m "Add best-effort AI flavour route for running prescriptions (prose only, never gates)"
```

---

### Task 12: Running screen UI (local-first, hand-off to guided activity)

**Files:**
- Create: `app/running/page.tsx`, `components/running/running-plan-content.tsx`, `components/running/prescribed-run-card.tsx`, `components/running/plan-setup-sheet.tsx`
- Modify: `lib/cache-ttl.ts`, `lib/cache-groups.ts`

- [ ] **Step 1: Add the cache key + group.**
  - `lib/cache-ttl.ts`: `export const RUNNING_PLAN_TTL = TTL_SHORT` (a prescription changes intra-day as runs are logged).
  - `lib/cache-groups.ts`: `export function invalidateRunningPlan() { return invalidateCache('running-plan') }` — call it after a completion write (Task 10 client path) and after `POST` plan create.

- [ ] **Step 2: `prescribed-run-card.tsx`** — a `React.memo` card taking stable props `{ prescription, gateAction, gateReasons, onStart, onSkip }`. Renders the run type, duration, HR target band (with a Lucide icon, e.g. `Activity`/`Footprints` — never an emoji), the rationale, and — when `gateAction !== 'proceed'` — a banner with the gate reasons paired with a Lucide icon + text label (never colour-alone). Primary "Start run" button is bottom-anchored with `pb-safe`; it routes to the guided-activity flow (`/activity` with the run pre-selected) to execute + log the `activity_logs` run. Uses theme tokens (`--accent-*`), not hex literals.

- [ ] **Step 3: `running-plan-content.tsx`** — client component. Seeds synchronously from cache in a `useEffect` (never a `useState` initializer) via `readCacheSync('running-plan')`, revalidates with `cachedFetch('running-plan', '/api/running-plan', RUNNING_PLAN_TTL)`. **Local-first read of prescribed runs**: reads `getLocalStore(userId)?.getPrescribedRuns(...)` for today's status (so an offline completion shows immediately), falling back to the API payload only when the store is unavailable — mirroring the supplements reference (`app/nutrition/nutrition-content.tsx`). When there is no active plan, shows an empty state with a "Set up my running plan" button opening `plan-setup-sheet.tsx`. Completion/skip calls the local-store write + `queueMutation({ userId, domain: 'prescribed_run', date, payload })` and `invalidateRunningPlan()` **before** firing the refetch (feedback synchronous, network fire-and-forget).

- [ ] **Step 4: `plan-setup-sheet.tsx`** — a shadcn `Sheet side="bottom"` (owns its own bottom inset — no `pb-safe` inside it). Goal picker (cardio health / distance event), optional target distance + date, then `POST /api/running-plan`. On success closes + `invalidateRunningPlan()`.

- [ ] **Step 5: `app/running/page.tsx`** — server shell rendering `<RunningPlanContent />` inside the app's standard page frame; header uses `pt-safe`, background via `bg-page`/dynamic-background (never `bg-background` root).

- [ ] **Step 6: Lint + typecheck + dev smoke.** Run: `npx eslint app/running components/running && npx tsc --noEmit 2>&1 | head -5`. Then `pnpm dev`: at the ≤640px S25 viewport (412×915), `/running` shows the empty state → set up a plan → the prescribed-run card renders with an icon + HR band + rationale; the Start button sits above the gesture bar; a seeded low-readiness day shows the gate banner with a text label.

- [ ] **Step 7: Commit**

```bash
git add app/running components/running lib/cache-ttl.ts lib/cache-groups.ts
git commit -m "Add running-plan screen: local-first prescribed-run card, gate banner, setup sheet"
```

---

## PHASE 2 — Periodized multi-week plan + adaptation (later; each task shippable)

> Phase 1 already ships a working coach (baseline → next run → recovery gate → log → next run). Phase 2 makes the plan look ahead multiple weeks and adapt its base volume from logged runs. Do **not** start Phase 2 until Phase 1 is merged and device-smoked.

### Task 13: Adapt weekly base minutes from logged runs

**Files:**
- Create: `lib/running/adaptation.ts`, `lib/running/__tests__/adaptation.test.ts`
- Modify: `app/api/running-plan/route.ts` (recompute `fitnessSnapshot.weeklyBaseMinutes` on `GET` from recent completed runs)

- [ ] **Step 1: Write the failing test** — `adaptWeeklyBaseMinutes(currentBase, recentCompletedRunMinutes)` raises the base by ≤10% when the user consistently completes prescribed volume, holds it when they miss runs, and never drops below the floor (60) or jumps more than 10%/week.

```typescript
import { describe, it, expect } from 'vitest'
import { adaptWeeklyBaseMinutes } from '../adaptation'

describe('adaptWeeklyBaseMinutes', () => {
  it('raises base by ≤10% when last week was fully completed', () => {
    expect(adaptWeeklyBaseMinutes(100, { completedMinutes: 100, prescribedMinutes: 100 })).toBeCloseTo(110, 0)
  })
  it('holds when the user completed < 70% of prescribed volume', () => {
    expect(adaptWeeklyBaseMinutes(100, { completedMinutes: 50, prescribedMinutes: 100 })).toBe(100)
  })
  it('never drops below the 60-minute floor', () => {
    expect(adaptWeeklyBaseMinutes(60, { completedMinutes: 0, prescribedMinutes: 100 })).toBe(60)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run lib/running/__tests__/adaptation.test.ts` → FAIL.

- [ ] **Step 3: Implement `lib/running/adaptation.ts`**

```typescript
const FLOOR = 60
const MAX_GROWTH = 1.10
const COMPLETION_THRESHOLD = 0.7

export function adaptWeeklyBaseMinutes(
  currentBase: number,
  lastWeek: { completedMinutes: number; prescribedMinutes: number },
): number {
  if (lastWeek.prescribedMinutes <= 0) return Math.max(FLOOR, currentBase)
  const ratio = lastWeek.completedMinutes / lastWeek.prescribedMinutes
  if (ratio < COMPLETION_THRESHOLD) return Math.max(FLOOR, currentBase)
  return Math.max(FLOOR, Math.round(currentBase * Math.min(MAX_GROWTH, 1 + 0.10 * ratio)))
}
```

- [ ] **Step 4: Wire into `GET /api/running-plan`** — before building `ctx`, recompute `weeklyBaseMinutes` via `adaptWeeklyBaseMinutes(plan.fitnessSnapshot.weeklyBaseMinutes, <last week's completed vs prescribed from getPrescribedRuns>)`, and best-effort persist the updated snapshot back to `running_plans` (scoped UPDATE). A persist failure must not fail the read.

- [ ] **Step 5: Run test + dev smoke + commit** — Run: `npx vitest run lib/running/__tests__/adaptation.test.ts` → PASS.

```bash
git add lib/running/adaptation.ts lib/running/__tests__/adaptation.test.ts app/api/running-plan/route.ts
git commit -m "Adapt weekly running base volume from logged-run completion (≤10%/week, floored)"
```

### Task 14: Multi-week look-ahead view

**Files:**
- Modify: `lib/running/frameworks/polarized.ts` (add `weekPlan(ctx): Prescription[]` producing a full week), `components/running/running-plan-content.tsx` (render the upcoming week as read-only preview cards, today highlighted)

- [ ] **Step 1: Add `weekPlan` to the framework interface + polarized impl** — deterministic: emits the week's easy/long/quality distribution as an ordered `Prescription[]` (~80/20), each with `targetsForRunType`. Unit-test that a week has ≥1 quality + ≥1 long + the rest easy, and total minutes ≈ `weeklyBaseMinutes`.
- [ ] **Step 2: Render** the upcoming week as preview cards below today's actionable card (today's is the only one with a Start button; future days are informational). Reuse `prescribed-run-card.tsx` in a `preview` variant (no buttons). Verify at the S25 viewport.
- [ ] **Step 3: Commit** — `git commit -m "Add multi-week polarized look-ahead preview to the running plan screen"`.

---

### Task Final: Gate + version/docs

- [ ] **Step 1: Full gate** — Run: `pnpm lint && npx tsc --noEmit && pnpm test && pnpm build`. Expected: all green (DB tests run against local Postgres on 5433).
- [ ] **Step 2: Device-verification bar.** This feature touches an offline-first domain (prescribed-run completion), native SQLite (new local table), safe-area (the running screen + Start button), and a hand-off into the GPS/HR guided-activity flow — so the merge gate is the on-device smoke run (`docs/device-smoke-checklist.md`) **or** a `projectOverview.md` Known-Issues row marking these NOT device-verified. Web `pnpm dev` (native SQLite absent — `getLocalStore` returns null) exercises the online fallback read only; the local-first completion path, the outbox push, and the safe-area insets are **not** web-verifiable.
- [ ] **Step 3: Version + changelog + journal + index (same PR).** Bump `package.json` **minor** (new user-facing feature). `lib/changelog.ts` top entry: "New: a running coach — do a baseline, set a goal, and the app prescribes your next run (easy, long, tempo or intervals) with a target heart-rate zone, using the polarized 80/20 method. It is recovery-aware: after a heavy leg day or on a low-readiness morning it automatically dials the run back so you train when it actually helps." Write the session journal as a **new file** in `docs/overview/entries/YYYY-MM-DD-running-prescription-engine.md`; update `projectOverview.md` (status + any Known-Issues device row from Step 2); remove this plan's backlog entry.
- [ ] **Step 4: Push + PR.** `git push -u origin feat/running-prescription-engine`. **This PR adds migration 132 — a new-table migration is reversible and non-data-dropping, so it is a standard change**, but confirm with the owner if they want the two new tables reviewed before merge. Otherwise merge on green per the CI/CD workflow once the smoke passes.

---

## Verification summary

- **Automated (sandbox, vitest):** lower-body set (3); fitness-snapshot baseline/fallback (3); HR targets per run type (3); recovery gate proceed/soften/rest across every signal incl. the leg-interference and provisional-readiness cases (6); polarized framework distribution + progression cap + fail-closed key (5); orchestrator proceed + soften-and-re-band (2); push-mutations web-parity test; Phase 2 adaptation (3) + week-plan shape. Plus `node scripts/check-push-mutations.js` (CI rule) and the full `pnpm lint && tsc && test && build` gate.
- **Dev-server (sandbox, local Postgres 5433):** migration 132 applies; `POST`/`GET /api/running-plan` return a plan + prescription with SWR headers; a seeded low-readiness day flips `gateAction` to `rest`/`soften`; the AI flavour route returns prose or the deterministic fallback; the `/running` screen renders the card + gate banner at the ≤640px viewport.
- **NOT sandbox-verifiable — state in the PR:**
  - **Offline-first completion path** — native SQLite (`getLocalStore`) does not run in the web/dev sandbox, so the local-first read, the `prescribed_run` outbox push, the `pushMutations` mirror, and the pull-delta clobber-gate are **APK-only**. On-device is the authoritative check (log a run offline, kill the app, reopen → the completed prescription persists and syncs).
  - **Safe-area insets** — the running screen header (`pt-safe`) and the bottom-anchored Start button (`pb-safe`) render as 0 insets in the web sandbox; verify on the S25 that nothing sits under the status/gesture bars.
  - **Guided-activity hand-off** — the Start button routes into the existing GPS+HR flow; that flow's device behaviour (GPS, live HR from the ring/strap) is unchanged by this PR but the round-trip (prescribe → run → `activity_logs` row → `activity_log_id` link → next prescription adapts) is only fully exercisable on-device.
  - **Baseline/VO₂max inputs** — `lib/health/vo2max.ts` and the cardio-baseline results are sibling plans that may not be merged yet; this feature ships against the age-based fallback and the baseline read is `try/catch`-guarded, so no cross-plan dependency blocks merge. When those land, the snapshot upgrades from `age-estimate` to `baseline` automatically with no code change here.
  - **Kotlin/native:** none — this PR is entirely JS/server/SQL, ships via Railway into the WebView with no APK rebuild (the new local SQLite table is created by the existing JS migration runner on next open).

## Notes for the implementer

- **The engine is deterministic; the AI is flavour.** Never let `/api/running-plan/explain` output feed back into `prescribeNextRun` or gate anything. The prescription's numbers come only from `lib/running/`.
- **One HR formula.** Target bands come from `computeHrZones`/`hrReserveTarget` (`lib/health/hr-zones.ts`). Do not re-derive zone thresholds in `lib/running/`.
- **Mirror the write paths.** The `PATCH` web route and the `pushMutations` `'prescribed_run'` branch must call the same repo function (`updatePrescribedRun`). CI (`scripts/check-push-mutations.js`) fails if the push branch touches `this.db`/raw `sql`.
- **Framework is swappable by design** — a Couch-to-5K or Norwegian-4×4 template is a new `lib/running/frameworks/<key>.ts` + one registry line, nothing else. Do not hardcode `'polarized-80-20'` anywhere except the default constant.
- **Dates:** every date param through `normalizeDateParam`; "today" via `todayInTz(tz)`; week/window starts via `lib/date-utils`, never `now − N×86400000`.
- **Re-anchor by symbol** if line numbers have drifted at implementation time — the Oura/health cluster moves fast.
