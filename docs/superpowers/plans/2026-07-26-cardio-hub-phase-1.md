# Cardiovascular Hub — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Cardiovascular hub — a new `/cardio` screen showing the user's HR profile and this
week's per-zone minute quota (target, done, remaining) plus steps, with a three-way modality picker —
and restructure the workout screen's entry points into **Gym Workout** / **Other Activity → Cardio**.

**Architecture:** Phase 1 is **assembly, not invention**. Both halves of the quota already exist:
`weeklyZoneTargets(frameworkKey, weeklyMinutes)` (`lib/running/zone-targets.ts`) produces per-zone
weekly minute *targets*, and `repo.getZoneMinutesRange()` (reconcile-on-read over `daily_zone_minutes`)
produces per-day zone-second *actuals*. This plan adds one pure function that subtracts them, one
aggregate GET route that assembles it, and the screen. No migration, no native code, no new sync
domain — the quota is a **server-derived read**, not an offline-first user-write domain.

**Tech Stack:** TypeScript; pure logic in `lib/health/` (vitest); Next.js route handler in
`app/api/cardio-week/`; UI in `app/cardio/` + `components/cardio/` reusing `HR_ZONE_META`,
`cachedFetchToday`/`readTodayCacheSync`, theme tokens, and the floored safe-area utilities.

---

## Spec reference

Implements these decisions from
[`docs/superpowers/specs/2026-07-26-cardio-system-spec.md`](../specs/2026-07-26-cardio-system-spec.md):

| Decision | What Phase 1 does with it |
|---|---|
| **D-9** quota, not calendar | The hub is per-zone remaining minutes + steps. No day assignment anywhere. |
| **D-1** hub owns no goal | The hub renders the quota and the picker. Running keeps its own goal/progression (untouched). |
| **D-2** goal shapes the quota | Zone targets come from the active running plan's `frameworkKey`; a zone weighted 0 renders "not needed". |
| **D-10** lifting already counts | No work needed — `computeDayZoneSeconds` is whole-day and modality-agnostic. Z1 renders complete-but-excluded. |
| **D-11** research split, personal volume | Split from `ZONE_WEIGHTS`; volume from the plan's `weeklyBaseMinutes`, floored at the 150-min guideline. |

**Out of scope for Phase 1** (later phases): the time-available session picker, the density-progression
framework, anchors/test sessions, the run execution screen, the visual/chart system, Polar PMD cadence.

---

## Verified current state (2026-07-26 — re-confirm before implementing)

- `weeklyZoneTargets(frameworkKey: string, weeklyMinutes: number): WeeklyZoneTargets`
  (`lib/running/zone-targets.ts:52`). Returns `perZone: { zoneId: 1|2|3|4|5; minutes: number }[]`,
  `totalMinutes`, `easyShare`, `moderateShare`, `hardShare`, `moderateEquivMinutes`,
  `meetsActivityGuideline`, `guidelineNote`. Volume is floored at `GUIDELINE_MIN = 150`.
- `repo.getZoneMinutesRange(userId, fromDay, toDay, tz, profile): Promise<DayZoneSeconds[]>`
  where `DayZoneSeconds = { day: string; seconds: [number,number,number,number,number] }`
  (`lib/data/postgres/slices/oura.ts:684`). **Reconcile-on-read**: today always recomputed, past days
  cached with the HR profile stamped, recomputed on profile drift. Safe to call every request.
- `resolveHrProfile(repo, userId, tz): Promise<HrProfile>` → `{ maxHr, restingHr }`
  (`lib/health/hr-profile.ts:16`).
- `computeObservedHr(bpms: readonly number[]): ObservedHrProfile` → `{ min, max, avg, sampleCount,
  isReliable, spikesRejected }` (`lib/health/observed-hr.ts:40`).
- `repo.getHrForWindow(userId: string, from: Date, to: Date)` → rows with `.bpm`.
- `getDailyGoals(profile): DailyGoals` → `{ stepGoal, activeEnergyGoal, zoneMinutesGoal, strengthFreqGoal }`
  (`lib/health/daily-goals.ts:41`).
- `startOfWeekInTz(tz): string` (`lib/date-utils.ts:46`) — the week-start helper. **Use it; never
  hand-roll a week boundary.**
- `HR_ZONE_META: { id; name; color }[]` (`lib/health/hr-zones.ts:48`) — Z1 Recovery `#3b82f6`,
  Z2 Light `#22c55e`, Z3 Aerobic `#eab308`, Z4 Hard `#f97316`, Z5 Peak `#ef4444`. **The only palette.**
- `repo.getActiveRunningPlan(userId)` — used by `app/api/running-plan/route.ts`. Returns the plan with
  `frameworkKey` and `fitnessSnapshot`, or null. **Re-confirm the exact method name against
  `lib/data/repository.ts` before Task 4** — if it differs, use whatever `app/api/running-plan/route.ts`
  calls.
- `repo.listBodyMetrics(userId, fromIso, toIso)` → rows with `.steps`, `.date`.
- Entry points today: `app/workout-select/workout-select-content.tsx:408-424` — a flat "Run" +
  "Log Activity" button row. `router.push('/running')` and a `LogActivitySheet`.
- Version: check `package.json`; changelog `lib/changelog.ts` (`CHANGELOG[0]`).

---

## File structure

**Create:**
- `lib/health/zone-quota.ts` — the pure subtract-actuals-from-targets function. One responsibility.
- `lib/health/__tests__/zone-quota.test.ts`
- `app/api/cardio-week/route.ts` — the aggregate GET assembling profile + quota + steps.
- `app/cardio/page.tsx` — auth-guarded server shell.
- `components/cardio/cardio-content.tsx` — client orchestrator (cache-seeded).
- `components/cardio/heart-profile-card.tsx` — resting / avg / max tiles.
- `components/cardio/zone-quota-card.tsx` — the per-zone bars.
- `components/cardio/steps-quota-card.tsx` — today + week step bars.
- `components/cardio/modality-picker.tsx` — Run / Guided walk / Other activity.

**Modify:**
- `app/workout-select/workout-select-content.tsx` — replace the flat button row with the two-way split.
- `lib/cache-ttl.ts` — add `CARDIO_WEEK_TTL`.
- `lib/cache-groups.ts` — add `cardio-week` to the groups that already invalidate activity/workout writes.
- `package.json` + `lib/changelog.ts` — version bump (final task).

---

## Task 1: The pure zone-quota function

**Files:**
- Create: `lib/health/zone-quota.ts`
- Test: `lib/health/__tests__/zone-quota.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { computeZoneQuota } from '../zone-quota'

describe('computeZoneQuota', () => {
  const targets = [
    { zoneId: 1 as const, minutes: 30 },
    { zoneId: 2 as const, minutes: 108 },
    { zoneId: 3 as const, minutes: 8 },
    { zoneId: 4 as const, minutes: 5 },
    { zoneId: 5 as const, minutes: 0 },
  ]

  it('subtracts accumulated seconds from the weekly target', () => {
    // Two days: Z2 gets 40min + 34min = 74min of a 108min target.
    const days = [
      { day: '2026-07-20', seconds: [1800, 2400, 180, 60, 0] as [number, number, number, number, number] },
      { day: '2026-07-21', seconds: [1800, 2040, 120, 60, 0] as [number, number, number, number, number] },
    ]
    const q = computeZoneQuota(targets, days)
    const z2 = q.zones.find(z => z.zoneId === 2)!
    expect(z2.targetMin).toBe(108)
    expect(z2.doneMin).toBe(74)
    expect(z2.remainingMin).toBe(34)
    expect(z2.pctComplete).toBe(69) // round(74/108*100)
    expect(z2.status).toBe('open')
  })

  it('marks a zone complete and never reports negative remaining', () => {
    const days = [{ day: '2026-07-20', seconds: [2400, 0, 0, 0, 0] as [number, number, number, number, number] }]
    const q = computeZoneQuota(targets, days)
    const z1 = q.zones.find(z => z.zoneId === 1)!
    expect(z1.doneMin).toBe(40)
    expect(z1.remainingMin).toBe(0)   // not -10
    expect(z1.pctComplete).toBe(100)  // capped
    expect(z1.status).toBe('complete')
  })

  it('marks a zero-target zone as not-required, not complete', () => {
    const q = computeZoneQuota(targets, [])
    const z5 = q.zones.find(z => z.zoneId === 5)!
    expect(z5.status).toBe('not-required')
    expect(z5.pctComplete).toBe(0)
  })

  it('reports training zones (Z2+) separately from passively-filled Z1', () => {
    const days = [{ day: '2026-07-20', seconds: [1800, 2400, 480, 300, 0] as [number, number, number, number, number] }]
    const q = computeZoneQuota(targets, days)
    // Z2 40 + Z3 8 + Z4 5 = 53 done of 108+8+5 = 121 target
    expect(q.trainingDoneMin).toBe(53)
    expect(q.trainingTargetMin).toBe(121)
    expect(q.trainingRemainingMin).toBe(68)
  })

  it('handles an empty week', () => {
    const q = computeZoneQuota(targets, [])
    expect(q.trainingDoneMin).toBe(0)
    expect(q.zones.find(z => z.zoneId === 2)!.remainingMin).toBe(108)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/health/__tests__/zone-quota.test.ts`
Expected: FAIL — `Failed to resolve import "../zone-quota"`

- [ ] **Step 3: Write the implementation**

```typescript
import type { ZoneTarget } from '@/lib/running/zone-targets'
import type { HrZone } from '@/lib/health/hr-zones'

// Per-zone weekly quota = the framework's target minus what's already been accumulated.
// Pure: the caller supplies targets (weeklyZoneTargets) and actuals (getZoneMinutesRange).
//
// Zone 1 is deliberately EXCLUDED from the `training*` totals (spec D-10): it fills from
// ordinary daily movement, so counting it would imply the training week is done when it isn't.
// It is still returned per-zone so the UI can show it complete-but-excluded.

export type ZoneQuotaStatus = 'open' | 'complete' | 'not-required'

export interface ZoneQuotaRow {
  zoneId: HrZone['id']
  targetMin: number
  doneMin: number
  remainingMin: number
  /** 0-100, capped — never over 100 even when the target is exceeded. */
  pctComplete: number
  status: ZoneQuotaStatus
}

export interface ZoneQuota {
  zones: ZoneQuotaRow[]
  /** Totals across the deliberate-training zones only (Z2-Z5); Z1 excluded. */
  trainingTargetMin: number
  trainingDoneMin: number
  trainingRemainingMin: number
}

/** The zone below which time accrues from ordinary daily movement rather than training. */
const PASSIVE_ZONE_ID = 1

export function computeZoneQuota(
  targets: readonly ZoneTarget[],
  days: readonly { seconds: readonly [number, number, number, number, number] }[],
): ZoneQuota {
  const doneSec = [0, 0, 0, 0, 0]
  for (const d of days) {
    for (let i = 0; i < 5; i++) doneSec[i] += d.seconds[i] ?? 0
  }

  const zones: ZoneQuotaRow[] = targets.map((t) => {
    const targetMin = Math.round(t.minutes)
    const doneMin = Math.round(doneSec[t.zoneId - 1] / 60)
    const remainingMin = Math.max(0, targetMin - doneMin)
    const pctComplete = targetMin > 0 ? Math.min(100, Math.round((doneMin / targetMin) * 100)) : 0
    const status: ZoneQuotaStatus =
      targetMin === 0 ? 'not-required' : remainingMin === 0 ? 'complete' : 'open'
    return { zoneId: t.zoneId, targetMin, doneMin, remainingMin, pctComplete, status }
  })

  const training = zones.filter((z) => z.zoneId !== PASSIVE_ZONE_ID)
  return {
    zones,
    trainingTargetMin: training.reduce((s, z) => s + z.targetMin, 0),
    trainingDoneMin: training.reduce((s, z) => s + z.doneMin, 0),
    trainingRemainingMin: training.reduce((s, z) => s + z.remainingMin, 0),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/health/__tests__/zone-quota.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add lib/health/zone-quota.ts lib/health/__tests__/zone-quota.test.ts
git commit -m "Add per-zone weekly quota computation

Subtracts accumulated zone-seconds from the framework's weekly targets.
Zone 1 is excluded from the training totals because it fills from ordinary
daily movement, so counting it would imply the training week is done when
deliberate work is still outstanding."
```

---

## Task 2: Week-window helper

The quota is weekly, and the week boundary must be the user's local week — never a rolling
7×86,400,000 ms offset (CLAUDE.md Date Arithmetic rule).

**Files:**
- Modify: `lib/health/zone-quota.ts`
- Test: `lib/health/__tests__/zone-quota.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing describe block's file)

```typescript
import { weekWindow } from '../zone-quota'

describe('weekWindow', () => {
  it('returns the local week start through today, inclusive', () => {
    const w = weekWindow('2026-07-22', '2026-07-20')
    expect(w.from).toBe('2026-07-20')
    expect(w.to).toBe('2026-07-22')
  })

  it('never returns a window ending before it starts', () => {
    // Defensive: a caller passing a stale week start must not invert the range.
    const w = weekWindow('2026-07-19', '2026-07-20')
    expect(w.from).toBe('2026-07-19')
    expect(w.to).toBe('2026-07-19')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/health/__tests__/zone-quota.test.ts`
Expected: FAIL — `weekWindow is not a function`

- [ ] **Step 3: Add the implementation to `lib/health/zone-quota.ts`**

```typescript
/** The inclusive local-date window for "this week so far". Callers pass `todayInTz(tz)` and
 *  `startOfWeekInTz(tz)` — this never derives dates itself, so there is no second timezone basis. */
export function weekWindow(todayIso: string, weekStartIso: string): { from: string; to: string } {
  const to = todayIso < weekStartIso ? weekStartIso : todayIso
  return { from: weekStartIso, to }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/health/__tests__/zone-quota.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add lib/health/zone-quota.ts lib/health/__tests__/zone-quota.test.ts
git commit -m "Add inclusive local-week window helper for the zone quota

Takes both dates from the caller so the week boundary always comes from the
user's timezone via startOfWeekInTz, rather than a rolling millisecond offset
that would straddle two local days."
```

---

## Task 3: Cache TTL constant

**Files:**
- Modify: `lib/cache-ttl.ts`

- [ ] **Step 1: Read the file to match the existing style**

Run: `sed -n '1,40p' lib/cache-ttl.ts`

- [ ] **Step 2: Add the constant**

Add alongside the other route TTLs (match the surrounding naming and comment style):

```typescript
/** Cardiovascular hub week payload (`cardio-week`). Short — the quota moves as HR lands, and
 *  today's zone-seconds are recomputed on every read anyway. One canonical TTL, one call site. */
export const CARDIO_WEEK_TTL = SHORT_TTL
```

If `SHORT_TTL` is not the exported name in this file, use whichever short constant its siblings use.
**Do not introduce a second TTL for this key** — CLAUDE.md requires one canonical TTL per cache key.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add lib/cache-ttl.ts
git commit -m "Add cache TTL for the cardio week payload"
```

---

## Task 4: The `/api/cardio-week` aggregate route

**Files:**
- Create: `app/api/cardio-week/route.ts`

- [ ] **Step 1: Confirm the running-plan repo method name**

Run: `grep -n "RunningPlan" lib/data/repository.ts | head`

Note the exact getter for the active plan. The route below assumes `repo.getActiveRunningPlan(userId)`
returning `{ frameworkKey, fitnessSnapshot } | null`. **If the name differs, use the one
`app/api/running-plan/route.ts` calls** — do not invent a repo method.

- [ ] **Step 2: Write the route**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz, startOfWeekInTz, todayMidnightUtc } from '@/lib/date-utils'
import { resolveHrProfile } from '@/lib/health/hr-profile'
import { computeObservedHr } from '@/lib/health/observed-hr'
import { getDailyGoals } from '@/lib/health/daily-goals'
import { weeklyZoneTargets } from '@/lib/running/zone-targets'
import { computeZoneQuota, weekWindow } from '@/lib/health/zone-quota'
import { ageFromDob } from '@/lib/date-utils'

// The Cardiovascular hub's week payload: HR profile + per-zone quota + steps.
// Server-derived read only — no user writes, so no outbox/local-store domain (spec D-9).
const OBSERVED_WINDOW_DAYS = 7
const DEFAULT_WEEKLY_MINUTES = 150 // WHO floor; weeklyZoneTargets floors at this anyway.

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:cardio-week`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()

  const today = todayInTz(tz)
  const { from, to } = weekWindow(today, startOfWeekInTz(tz))

  const profile = await resolveHrProfile(repo, userId, tz)

  const observedTo = new Date()
  const observedFrom = new Date(todayMidnightUtc(tz).getTime() - OBSERVED_WINDOW_DAYS * 86_400_000)

  const [days, hrRows, user, weekMetrics] = await Promise.all([
    repo.getZoneMinutesRange(userId, from, to, tz, profile).catch(() => []),
    repo.getHrForWindow(userId, observedFrom, observedTo).catch(() => []),
    repo.getUserById(userId),
    repo.listBodyMetrics(userId, from, to).catch(() => []),
  ])

  // Zone targets: the active running plan's framework supplies the SHAPE; its weekly base
  // minutes supply the SIZE (spec D-11 — research split, personalised volume).
  const plan = await repo.getActiveRunningPlan(userId).catch(() => null)
  const weeklyMinutes = plan?.fitnessSnapshot?.weeklyBaseMinutes ?? DEFAULT_WEEKLY_MINUTES
  const targets = weeklyZoneTargets(plan?.frameworkKey ?? 'zone2-base', weeklyMinutes)
  const quota = computeZoneQuota(targets.perZone, days)

  const observed = computeObservedHr(hrRows.map((r) => r.bpm))

  const goals = getDailyGoals({
    weightKg: user?.weightKg ?? null,
    heightCm: user?.heightCm ?? null,
    ageYears: ageFromDob(user?.dateOfBirth, new Date()),
    sex: user?.sex ?? null,
    activityLevel: user?.activityLevel ?? null,
  })

  const stepsToday = weekMetrics.find((m) => m.date === today)?.steps ?? 0
  const stepsWeek = weekMetrics.reduce((s, m) => s + (m.steps ?? 0), 0)
  const daysElapsed = days.length || 1

  return NextResponse.json(
    {
      week: { from, to },
      heart: {
        restingHr: profile.restingHr,
        avgHr: observed.avg,
        maxHr: observed.max ?? profile.maxHr,
        isReliable: observed.isReliable,
      },
      quota,
      guideline: {
        frameworkKey: targets.frameworkKey,
        totalMinutes: targets.totalMinutes,
        note: targets.guidelineNote,
        meets: targets.meetsActivityGuideline,
      },
      steps: {
        today: stepsToday,
        todayGoal: goals.stepGoal,
        week: stepsWeek,
        weekGoal: goals.stepGoal * 7,
        weekGoalSoFar: goals.stepGoal * daysElapsed,
      },
      hasRunningPlan: plan != null,
    },
    { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' } },
  )
}
```

**Note on field names:** `user?.weightKg` / `heightCm` / `dateOfBirth` / `sex` / `activityLevel` must
match the actual `User` type. Run `grep -n "weightKg\|dateOfBirth\|activityLevel" lib/types/user.ts`
first and correct any mismatch — a wrong field name reads as `undefined` and silently degrades the
goals to defaults.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. Fix any repo-method or user-field mismatches now.

- [ ] **Step 4: Verify against the dev server**

```bash
pnpm dev
```

In another shell, sign in as `test@local.dev` / `testpass123` and hit the route with the session
cookie (mirror however sibling routes are exercised in this repo — e.g. a `curl` with the cookie jar
used for `/api/zone-minutes`).

Expected: `200` with `week`, `heart`, `quota.zones` (5 rows), `guideline`, `steps`.
Seed has no `oura_heartrate`, so `quota` will be all-zero `doneMin` — that is correct, not a failure.
Confirm `quota.zones[1].targetMin > 0` and `remainingMin === targetMin`.

- [ ] **Step 5: Commit**

```bash
git add app/api/cardio-week/route.ts
git commit -m "Add cardio week aggregate route

Assembles the observed HR profile, the per-zone weekly quota and step
progress into one payload for the hub. Zone targets take their shape from
the active running plan's framework and their size from its weekly base
minutes, falling back to the WHO floor when no plan exists."
```

---

## Task 5: Cache invalidation

Any write that changes HR, activity or workout data changes the quota. Per CLAUDE.md, the key must be
registered in **every** relevant group in the same commit — never invalidated ad-hoc at a call site.

**Files:**
- Modify: `lib/cache-groups.ts`

- [ ] **Step 1: Find the groups that must carry the key**

Run: `grep -n -A 8 "export async function invalidateActivityWrites\|export async function invalidateWorkoutSummaries\|export async function invalidateBiometrics\|export async function invalidateOuraSync" lib/cache-groups.ts`

- [ ] **Step 2: Add `'cardio-week'` to each of those four groups' key lists**

`invalidateActivityWrites` (a logged walk/run adds zone minutes), `invalidateWorkoutSummaries`
(a lifting session adds zone minutes — spec D-10), `invalidateBiometrics` (steps change),
`invalidateOuraSync` (new HR lands). Match the existing array style in each function; do not create
a new group.

- [ ] **Step 3: Typecheck and run the cache-group tests**

Run: `npx tsc --noEmit && npx vitest run lib/__tests__ --silent`
Expected: no new failures

- [ ] **Step 4: Commit**

```bash
git add lib/cache-groups.ts
git commit -m "Invalidate the cardio week cache on every write that moves the quota

Zone minutes come from the whole day's heart rate, so a lifting session
shifts the quota just as a walk does; steps and Oura syncs move it too."
```

---

## Task 6: Heart profile card

**Files:**
- Create: `components/cardio/heart-profile-card.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { memo } from 'react'

interface Props {
  restingHr: number
  avgHr: number | null
  maxHr: number | null
  isReliable: boolean
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-[color:var(--muted)] px-2 py-2.5 text-center">
      <span className="block font-mono text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-[color:var(--muted-foreground)]">{label}</span>
    </div>
  )
}

function HeartProfileCardImpl({ restingHr, avgHr, maxHr, isReliable }: Props) {
  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
      <p className="mb-2.5 flex items-center font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
        Your heart
        <span className="ml-auto tracking-normal normal-case">last 7 days</span>
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Tile value={String(restingHr)} label="Resting" />
        <Tile value={avgHr != null ? String(avgHr) : '—'} label="Avg" />
        <Tile value={maxHr != null ? String(maxHr) : '—'} label="Max" />
      </div>
      {!isReliable && (
        <p className="mt-2.5 text-[11px] leading-snug text-[color:var(--muted-foreground)]">
          Still learning your range — wear your ring or strap for a few more days.
        </p>
      )}
    </div>
  )
}

export const HeartProfileCard = memo(HeartProfileCardImpl)
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/cardio/heart-profile-card.tsx
git commit -m "Add heart profile card for the cardio hub"
```

---

## Task 7: Zone quota card

**Files:**
- Create: `components/cardio/zone-quota-card.tsx`

- [ ] **Step 1: Write the component**

The bar fill must be a **block-level** element. `.zfill`-style inline elements ignore width/height —
this exact bug shipped in the mockup. Tailwind's `block` class on the fill is not optional.

```tsx
'use client'

import { memo } from 'react'
import { HR_ZONE_META } from '@/lib/health/hr-zones'
import type { ZoneQuota, ZoneQuotaRow } from '@/lib/health/zone-quota'

interface Props {
  quota: ZoneQuota
  goalLabel?: string
}

/** Zone 1 fills from ordinary daily movement, so it renders as context rather than a
 *  target (spec D-10) — showing it as an open goal would overstate the training week. */
const PASSIVE_ZONE_ID = 1

function ZoneRow({ row }: { row: ZoneQuotaRow }) {
  const meta = HR_ZONE_META.find((m) => m.id === row.zoneId)
  const notRequired = row.status === 'not-required'

  return (
    <li className={notRequired ? 'opacity-45' : undefined}>
      <div className="flex items-baseline gap-1.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta?.color }} aria-hidden />
          Z{row.zoneId} {meta?.name}
        </span>
        <span className="ml-auto font-mono text-xs tabular-nums">
          {notRequired ? (
            <span className="text-[color:var(--muted-foreground)]">not needed</span>
          ) : (
            <>
              <b className={row.status === 'complete' ? 'text-[color:var(--accent-green)]' : undefined}>{row.doneMin}</b>
              <span className="text-[color:var(--muted-foreground)]"> / {row.targetMin} min</span>
            </>
          )}
        </span>
      </div>

      <div
        className="mt-1 h-3.5 overflow-hidden rounded-full"
        style={{ background: 'color-mix(in oklch, var(--muted-foreground) 24%, transparent)' }}
        role="progressbar"
        aria-valuenow={row.pctComplete}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Zone ${row.zoneId} ${meta?.name}`}
      >
        {!notRequired && (
          <span className="block h-full rounded-full" style={{ width: `${row.pctComplete}%`, background: meta?.color }} />
        )}
      </div>

      {!notRequired && (
        <div className="mt-0.5 flex justify-between font-mono text-[10px] tabular-nums text-[color:var(--muted-foreground)]">
          <span>{row.pctComplete}% done</span>
          <span>{row.remainingMin === 0 ? 'complete' : `${row.remainingMin} min left`}</span>
        </div>
      )}
    </li>
  )
}

function ZoneQuotaCardImpl({ quota, goalLabel }: Props) {
  const training = quota.zones.filter((z) => z.zoneId !== PASSIVE_ZONE_ID)
  const passive = quota.zones.find((z) => z.zoneId === PASSIVE_ZONE_ID)
  const passiveMeta = HR_ZONE_META.find((m) => m.id === PASSIVE_ZONE_ID)

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
      <p className="mb-2.5 flex items-center font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
        This week&rsquo;s zones
        {goalLabel && <span className="ml-auto tracking-normal normal-case">{goalLabel}</span>}
      </p>

      <ul className="space-y-3">
        {training.map((row) => <ZoneRow key={row.zoneId} row={row} />)}
      </ul>

      {passive && (
        <p className="mt-3 border-t border-[color:var(--border)] pt-2.5 text-[11px] leading-snug text-[color:var(--muted-foreground)]">
          <b style={{ color: passive.status === 'complete' ? 'var(--accent-green)' : passiveMeta?.color }}>
            Z1 {passiveMeta?.name} {passive.status === 'complete' ? 'complete' : `${passive.doneMin}/${passive.targetMin} min`}
          </b>
          {' — '}Zone 1 fills from ordinary daily movement, so it isn&rsquo;t counted toward your training week.
        </p>
      )}
    </div>
  )
}

export const ZoneQuotaCard = memo(ZoneQuotaCardImpl)
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/cardio/zone-quota-card.tsx
git commit -m "Add per-zone weekly quota card

Each training zone shows done, target, percent and minutes remaining. Zone 1
sits below the divider as context rather than an open goal, since it accrues
without deliberate training."
```

---

## Task 8: Steps quota card

**Files:**
- Create: `components/cardio/steps-quota-card.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { memo } from 'react'

interface Props {
  today: number
  todayGoal: number
  week: number
  weekGoal: number
}

function StepBar({ value, goal, label }: { value: number; goal: number; label: string }) {
  const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between font-mono text-xs tabular-nums">
        <span>{value.toLocaleString()}</span>
        <span className="text-[10px] text-[color:var(--muted-foreground)]">/ {goal.toLocaleString()} {label}</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-[color:var(--muted)]"
        role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
        aria-label={`Steps ${label}`}
      >
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent-cyan)' }} />
      </div>
    </div>
  )
}

function StepsQuotaCardImpl({ today, todayGoal, week, weekGoal }: Props) {
  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
      <p className="mb-2.5 font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">Steps</p>
      <div className="grid grid-cols-2 gap-3">
        <StepBar value={today} goal={todayGoal} label="today" />
        <StepBar value={week} goal={weekGoal} label="wk" />
      </div>
    </div>
  )
}

export const StepsQuotaCard = memo(StepsQuotaCardImpl)
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/cardio/steps-quota-card.tsx
git commit -m "Add steps quota card for the cardio hub"
```

---

## Task 9: Modality picker

**Files:**
- Create: `components/cardio/modality-picker.tsx`

Cards contain no nested interactive content, so a real `<button>` is correct here (the
`<div role="button">` exception applies only when a card wraps other controls).

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { memo } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Footprints, Activity } from 'lucide-react'
import { hapticLight } from '@/lib/haptics'

interface Props {
  hasRunningPlan: boolean
  onLogActivity: () => void
}

function Option({
  icon, iconColor, iconBg, name, badge, hint, onClick,
}: {
  icon: React.ReactNode; iconColor: string; iconBg: string
  name: string; badge?: string; hint: string; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={() => { hapticLight(); onClick() }}
      className="flex w-full items-center gap-2.5 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3 text-left transition active:scale-[0.985]"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: iconBg, color: iconColor }}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">
          {name}
          {badge && (
            <span
              className="ml-1.5 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
              style={{ background: 'color-mix(in oklch, var(--accent-cyan) 16%, transparent)', color: 'var(--accent-cyan)' }}
            >
              {badge}
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-[color:var(--muted-foreground)]">{hint}</span>
      </span>
      <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-[color:var(--muted-foreground)]" aria-hidden />
    </button>
  )
}

function ModalityPickerImpl({ hasRunningPlan, onLogActivity }: Props) {
  const router = useRouter()
  return (
    <div className="flex flex-col gap-2">
      <Option
        icon={<Footprints className="h-4.5 w-4.5" />}
        iconColor="var(--accent-cyan)"
        iconBg="color-mix(in oklch, var(--accent-cyan) 15%, transparent)"
        name="Run"
        badge={hasRunningPlan ? 'Program' : undefined}
        hint={hasRunningPlan ? 'Your running plan' : 'Set up a running plan'}
        onClick={() => router.push('/running')}
      />
      <Option
        icon={<Footprints className="h-4.5 w-4.5" />}
        iconColor="#22c55e"
        iconBg="color-mix(in oklch, #22c55e 16%, transparent)"
        name="Guided walk"
        hint="Interval walk with fast and easy blocks"
        onClick={() => router.push('/activity/guided-walk')}
      />
      <Option
        icon={<Activity className="h-4.5 w-4.5" />}
        iconColor="var(--muted-foreground)"
        iconBg="var(--muted)"
        name="Other activity"
        hint="Treadmill, cycle, anything logged"
        onClick={onLogActivity}
      />
    </div>
  )
}

export const ModalityPicker = memo(ModalityPickerImpl)
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/cardio/modality-picker.tsx
git commit -m "Add modality picker for the cardio hub

Only Run carries a program badge; walk and other activity are tools that
report metrics back to the shared quota."
```

---

## Task 10: The hub content orchestrator

**Files:**
- Create: `components/cardio/cardio-content.tsx`

Cache-seed in a `useEffect`, **never** in a `useState` lazy initializer (that caused hydration
mismatches in session 165).

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { HeartPulse } from 'lucide-react'
import { cachedFetchToday, readTodayCacheSync } from '@/lib/sqlite/cache'
import { CARDIO_WEEK_TTL } from '@/lib/cache-ttl'
import { Button } from '@/components/ui/button'
import { LogActivitySheet } from '@/components/workout/log-activity-sheet'
import { HeartProfileCard } from './heart-profile-card'
import { ZoneQuotaCard } from './zone-quota-card'
import { StepsQuotaCard } from './steps-quota-card'
import { ModalityPicker } from './modality-picker'
import type { ZoneQuota } from '@/lib/health/zone-quota'

interface CardioWeek {
  week: { from: string; to: string }
  heart: { restingHr: number; avgHr: number | null; maxHr: number | null; isReliable: boolean }
  quota: ZoneQuota
  guideline: { frameworkKey: string; totalMinutes: number; note: string; meets: boolean }
  steps: { today: number; todayGoal: number; week: number; weekGoal: number; weekGoalSoFar: number }
  hasRunningPlan: boolean
}

export function CardioContent() {
  const [data, setData] = useState<CardioWeek | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [logOpen, setLogOpen] = useState(false)

  const refresh = useCallback(() => {
    setLoadError(false)
    // Today-keyed: the quota is "this week so far", so a seed from a previous day would
    // paint yesterday's remaining minutes across midnight.
    cachedFetchToday<CardioWeek>('cardio-week', '/api/cardio-week', CARDIO_WEEK_TTL, (d) => setData(d), {
      onError: () => setLoadError(true),
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const seed = readTodayCacheSync<CardioWeek>('cardio-week')
    if (seed) setData(seed)
    refresh()
  }, [refresh])

  return (
    <div className="flex h-full flex-col gap-2.5 overflow-y-auto px-4 pt-safe pb-safe-action">
      <div className="flex items-center gap-2 px-0.5 pb-0.5 pt-1.5">
        <HeartPulse className="h-5 w-5" style={{ color: 'var(--accent-cyan)' }} aria-hidden />
        <h1 className="text-xl font-bold">Cardiovascular</h1>
      </div>

      {data == null && !loadError && (
        <div className="mt-1 space-y-2.5" aria-hidden>
          <div className="h-24 animate-pulse rounded-2xl bg-[color:var(--muted)]" />
          <div className="h-44 animate-pulse rounded-2xl bg-[color:var(--muted)]" />
        </div>
      )}

      {data == null && loadError && (
        <div className="mt-6 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-[color:var(--muted-foreground)]">Couldn&apos;t load your week.</p>
          <Button variant="outline" onClick={refresh}>Retry</Button>
        </div>
      )}

      {data && (
        <>
          <HeartProfileCard
            restingHr={data.heart.restingHr}
            avgHr={data.heart.avgHr}
            maxHr={data.heart.maxHr}
            isReliable={data.heart.isReliable}
          />
          <ZoneQuotaCard quota={data.quota} />
          <StepsQuotaCard
            today={data.steps.today}
            todayGoal={data.steps.todayGoal}
            week={data.steps.week}
            weekGoal={data.steps.weekGoal}
          />
          <p className="mt-1 px-0.5 font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
            What do you want to do?
          </p>
          <ModalityPicker hasRunningPlan={data.hasRunningPlan} onLogActivity={() => setLogOpen(true)} />
        </>
      )}

      <LogActivitySheet open={logOpen} onOpenChange={setLogOpen} />
    </div>
  )
}
```

- [ ] **Step 2: Confirm `LogActivitySheet`'s import path and props**

Run: `grep -n "export function LogActivitySheet" -A 6 components/workout/log-activity-sheet.tsx`
Correct the import/props if they differ.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add components/cardio/cardio-content.tsx
git commit -m "Add cardio hub orchestrator

Seeds synchronously from a today-keyed cache so a repeat visit paints last
known state instead of a skeleton, then revalidates."
```

---

## Task 11: The `/cardio` page shell

**Files:**
- Create: `app/cardio/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { CardioContent } from '@/components/cardio/cardio-content'

export default async function CardioPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/sign-in')

  return (
    <div className="bg-page h-screen w-full">
      <CardioContent />
    </div>
  )
}
```

- [ ] **Step 2: Verify it renders**

```bash
pnpm dev
```

Sign in as `test@local.dev` / `testpass123`, open `http://localhost:3000/cardio`.

Expected: header, heart tiles (resting from seed, avg/max `—` since the seed has no `oura_heartrate`),
five-zone card with Z2 showing `0 / N min` and a **visible** empty track, steps card, three picker rows.
**Confirm the zone bar tracks are visible** — the mockup shipped with invisible bars because an inline
element ignored its width.

- [ ] **Step 3: Commit**

```bash
git add app/cardio/page.tsx
git commit -m "Add the cardio hub route"
```

---

## Task 12: Split the workout-screen entry points

**Files:**
- Modify: `app/workout-select/workout-select-content.tsx:408-424`

- [ ] **Step 1: Read the current block**

Run: `sed -n '400,430p' app/workout-select/workout-select-content.tsx`

- [ ] **Step 2: Replace the flat Run / Log Activity row**

Replace the two-button row with a single full-width row leading to the hub. The session carousel and
its Start button above are the "Gym Workout" half and stay exactly as they are.

```tsx
        {/* Gym Workout is the carousel above; everything non-gym lives behind the cardio hub. */}
        <div className="flex-none">
          <button
            onClick={() => router.push('/cardio')}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted/60 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted active:scale-95"
          >
            <HeartPulse className="h-4 w-4 text-muted-foreground" />
            Other Activity
          </button>
        </div>
```

- [ ] **Step 3: Fix the imports**

Add `HeartPulse` to the `lucide-react` import on line 6. **Remove `FootprintsIcon` and `Activity` if
they are now unused**, and remove the `LogActivitySheet` import plus its `logActivityOpen` state and
the `<LogActivitySheet ... />` element at line ~427 — the sheet now lives in the hub.

Run: `npx tsc --noEmit` and fix any unused-import lint errors.

- [ ] **Step 4: Verify in the dev server**

Open `http://localhost:3000/workout-select`.
Expected: the session carousel and Start button unchanged; one "Other Activity" button below the dots
which navigates to `/cardio`. The old "Run" and "Log Activity" buttons are gone.

- [ ] **Step 5: Commit**

```bash
git add app/workout-select/workout-select-content.tsx
git commit -m "Route non-gym training through the cardio hub

The flat Run and Log Activity buttons are replaced by a single Other Activity
entry, so the session carousel reads as the gym half and everything cardio
lives behind one door."
```

---

## Task 13: Full gate + version bump

**Files:**
- Modify: `package.json`, `lib/changelog.ts`

- [ ] **Step 1: Run the full gate**

```bash
npx tsc --noEmit
npm run lint
npx vitest run
node scripts/check-push-mutations.js
npm run build
```

Expected: all green. Fix anything that fails — do not proceed with a red gate.

- [ ] **Step 2: Exercise every changed surface on the dev server**

```bash
pnpm dev
```

- `/cardio` renders; zone tracks visible; retry state works (stop the server mid-load to see it).
- `/workout-select` shows "Other Activity" and navigates to `/cardio`.
- "Other activity" in the picker opens the log sheet.
- "Run" navigates to `/running` (unchanged).
- "Guided walk" navigates to `/activity/guided-walk` (unchanged).
- `/api/cardio-week` returns 200.

- [ ] **Step 3: Bump the version (minor — new feature)**

Edit `package.json` `version`, and prepend to `CHANGELOG` in `lib/changelog.ts` matching the existing
entry shape:

```typescript
  {
    version: '<new minor>',
    date: '2026-07-26',
    title: 'Cardiovascular hub',
    items: [
      'New Cardiovascular screen showing this week’s heart-rate zone targets — how many minutes you’ve done and how many are left in each zone — plus your resting, average and max heart rate and your step progress.',
      'Gym sessions, runs, walks and any logged activity all count toward the same weekly zone totals.',
      'The workout screen now splits into your gym session and one Other Activity door for everything cardio.',
    ],
  },
```

- [ ] **Step 4: Commit and push**

```bash
git add package.json lib/changelog.ts
git commit -m "Bump version for the cardiovascular hub"
git push -u origin feat/cardio-hub-phase-1
```

---

## Task 14: Session bookkeeping (same PR — CLAUDE.md requires it)

**Files:**
- Create: `docs/overview/entries/2026-07-26-cardio-hub-phase-1.md`
- Modify: `projectOverview.md`, `docs/implementation-backlog.md`

- [ ] **Step 1: Write the journal entry**

A new file per the convention in `docs/overview/entries/README.md` — never prepend to a shared history
file. Cover: what shipped, what was verified in the sandbox, and **what was not** (see Step 2).

- [ ] **Step 2: Add the Known-Issues row to `projectOverview.md`**

Required by the Canonical Runtime rule. State plainly:

> **Cardio hub Phase 1 — NOT verified on device / on real zone data.** The quota logic is unit-tested
> and the route is dev-server verified, but the local seed has **no `oura_heartrate` rows**, so every
> zone renders `0 min done`. A real non-zero quota, the Samsung WebView paint of the zone bars, and
> safe-area clearance on the new `/cardio` screen are all unconfirmed. Device smoke: open `/cardio`
> on the S25 after a day of ring wear, confirm Z2 shows non-zero minutes, the bars render, and the
> header/picker clear the status and gesture bars.

- [ ] **Step 3: Remove this item's entry from the backlog queue**

Per the backlog protocol, a completed item must never linger in the queue.

- [ ] **Step 4: Commit**

```bash
git add docs/overview/entries/2026-07-26-cardio-hub-phase-1.md projectOverview.md docs/implementation-backlog.md
git commit -m "Record the cardio hub phase 1 session"
git push
```

---

## What Phase 1 deliberately does not do

- **No progression, no anchors, no test sessions** — the running program is untouched.
- **No time-available session picker** — the picker is a plain three-way choice for now.
- **No new charts** — the visual system is a later phase.
- **No cadence capture** — Polar PMD is its own track.
- **No offline-first write path** — the quota is a server-derived read. It degrades to the
  cache-seeded last-known value offline, which is correct for a derived aggregate (same treatment as
  the other cross-session aggregates listed in CLAUDE.md's read-site status).

## Self-review notes

- **Spec coverage:** D-9 (Task 1, 7, 10), D-1 (Task 9 badge; running untouched), D-2 (Task 4 framework
  lookup; Task 7 `not-required`), D-10 (Task 1 `PASSIVE_ZONE_ID`; Task 7 divider copy; Task 5
  `invalidateWorkoutSummaries`), D-11 (Task 4 shape-from-framework / size-from-snapshot).
- **Type consistency:** `ZoneQuota` / `ZoneQuotaRow` / `ZoneQuotaStatus` defined in Task 1 and used
  unchanged in Tasks 7 and 10. `weekWindow` defined in Task 2, used in Task 4. `computeZoneQuota`
  takes `(targets, days)` in both its definition and its call site.
- **Known soft spots flagged inline for the implementer to verify rather than assume:** the
  `getActiveRunningPlan` repo method name (Task 4 Step 1), the `User` field names feeding
  `getDailyGoals` (Task 4 Step 2 note), and `LogActivitySheet`'s props (Task 10 Step 2).
