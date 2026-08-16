# Baseline Anchors + Push Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the running program a frozen "where you started" baseline anchor per plan, and a
push/adherence session split (spec D-3: most sessions are adherence-only, ~1-in-5 is an explicit
"beat X" push session graded against that anchor) plus environment awareness (D-5: treadmill vs
outdoor results never compared against each other).

**Architecture:** One new table (`running_baselines`) stores a frozen fitness/pace snapshot at plan
creation. Everything else — which session is a push session, what environment a completed run was
in, whether a push session was beaten — is **derived at read time** from data that already exists or
that the sibling density-progression plan's completion-link already produces, per the
"Stored Counters — derive, or reconcile on read" rule: no new mutable counters, no new sync-chain
fields, no extension to the offline `prescribed_run` mutation domain. This keeps the whole feature
server-side/read-time logic plus one append-only table.

**Tech Stack:** Existing `lib/running/` + `lib/health/vdot.ts` (VDOT/pace math), Drizzle migration,
existing `getPrescribedRuns`/`listActivityLogs` repository methods (no new repository methods needed
beyond the anchor table's own CRUD).

**Depends on:** `docs/superpowers/plans/2026-07-27-cardio-density-progression.md` — specifically its
Task 8 (completion linking: a completed `prescribed_runs` row's `activityLogId` must be reliably
populated for grading to have anything to compare against) and Task 2 (`ctx.goal` fix, since push
targets need the plan's real `targetDistanceKm`/`goalKind`, not the previous hardcoded fake goal).
Implement that plan first.

---

### Task 1: `running_baselines` table

**Files:**
- Modify: `lib/data/postgres/schema.ts`
- Create: `lib/data/postgres/migrations/146_running_baselines.sql` (verify `146` is still the next
  free number against `main` at implementation time — this plan claims the number immediately after
  the sibling density-progression plan's `145`; if that plan hasn't merged yet, renumber both
  against whatever is actually next)
- Modify: `lib/data/repository.ts`
- Modify: `lib/data/postgres/adapter.ts`

One row per running plan — a frozen snapshot of `resolveFitnessSnapshot()`'s output at the moment
the plan was created, plus an easy pace derived from it. Running-only, per spec D-1
("no per-modality anchor bookkeeping" outside running).

- [ ] **Step 1: Migration**

```sql
-- 146_running_baselines.sql
CREATE TABLE IF NOT EXISTS running_baselines (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id                UUID NOT NULL REFERENCES running_plans(id) ON DELETE CASCADE,
  vo2max                 DOUBLE PRECISION,
  max_hr                 INTEGER,
  resting_hr             INTEGER,
  threshold_hr           INTEGER,
  weekly_base_minutes    DOUBLE PRECISION,
  easy_pace_sec_per_km   DOUBLE PRECISION,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS running_baselines_one_per_plan ON running_baselines(plan_id);
```

One anchor per plan (the unique index) — a new plan (new block) always gets a fresh anchor; there is
no "update the anchor" path, only "create a new plan → create a new anchor," matching how
`saveRunningPlan` already deactivates-and-replaces rather than mutating in place.

- [ ] **Step 2: Schema**

In `lib/data/postgres/schema.ts`, add after `runningPlans`:

```typescript
export const runningBaselines = pgTable('running_baselines', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  userId:             uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  planId:             uuid('plan_id').notNull().references(() => runningPlans.id, { onDelete: 'cascade' }),
  vo2max:             doublePrecision('vo2max'),
  maxHr:              integer('max_hr'),
  restingHr:          integer('resting_hr'),
  thresholdHr:        integer('threshold_hr'),
  weeklyBaseMinutes:  doublePrecision('weekly_base_minutes'),
  easyPaceSecPerKm:   doublePrecision('easy_pace_sec_per_km'),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique().on(t.planId)])
```

- [ ] **Step 3: Repository type + methods**

In `lib/data/repository.ts`, add near `RunningPlan`:

```typescript
export interface RunningBaseline {
  id: string; userId: string; planId: string
  vo2max: number | null; maxHr: number | null; restingHr: number | null; thresholdHr: number | null
  weeklyBaseMinutes: number | null; easyPaceSecPerKm: number | null
  createdAt: Date
}
```

Add to the repository interface, near `saveRunningPlan`:

```typescript
saveRunningBaseline(userId: string, baseline: Omit<RunningBaseline, 'id' | 'userId' | 'createdAt'>): Promise<RunningBaseline>
getRunningBaseline(userId: string, planId: string): Promise<RunningBaseline | null>
```

- [ ] **Step 4: Adapter implementation**

In `lib/data/postgres/adapter.ts`, add near `saveRunningPlan`:

```typescript
  async saveRunningBaseline(userId: string, baseline: Omit<RunningBaseline, 'id' | 'userId' | 'createdAt'>): Promise<RunningBaseline> {
    const [r] = await this.db.insert(s.runningBaselines).values({
      userId, planId: baseline.planId,
      vo2max: baseline.vo2max ?? null, maxHr: baseline.maxHr ?? null,
      restingHr: baseline.restingHr ?? null, thresholdHr: baseline.thresholdHr ?? null,
      weeklyBaseMinutes: baseline.weeklyBaseMinutes ?? null, easyPaceSecPerKm: baseline.easyPaceSecPerKm ?? null,
    }).returning()
    return this.rowToRunningBaseline(r)
  }

  async getRunningBaseline(userId: string, planId: string): Promise<RunningBaseline | null> {
    const [r] = await this.db.select().from(s.runningBaselines)
      .where(and(eq(s.runningBaselines.userId, userId), eq(s.runningBaselines.planId, planId)))
      .limit(1)
    return r ? this.rowToRunningBaseline(r) : null
  }

  private rowToRunningBaseline(r: typeof s.runningBaselines.$inferSelect): RunningBaseline {
    return {
      id: r.id, userId: r.userId, planId: r.planId,
      vo2max: r.vo2max ?? null, maxHr: r.maxHr ?? null, restingHr: r.restingHr ?? null, thresholdHr: r.thresholdHr ?? null,
      weeklyBaseMinutes: r.weeklyBaseMinutes ?? null, easyPaceSecPerKm: r.easyPaceSecPerKm ?? null,
      createdAt: r.createdAt,
    }
  }
```

- [ ] **Step 5: Type-check and apply the migration**

```bash
npx tsc --noEmit
node scripts/local-db/migrate.js
```
Expected: clean, migration applies, `\d running_baselines` via `psql` shows the table.

- [ ] **Step 6: Commit**

```bash
git add lib/data/postgres/schema.ts lib/data/postgres/migrations/146_running_baselines.sql lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "feat: add running_baselines — one frozen fitness snapshot per plan"
```

---

### Task 2: Create the anchor when a plan is created

**Files:**
- Modify: `app/api/running-plan/route.ts`

- [ ] **Step 1: Compute and save the anchor right after `saveRunningPlan`**

In `POST` (currently right after the `saveRunningPlan` call, before `assembleInputs`), add:

```typescript
  const easyPaceSecPerKm = fitness.vo2max != null ? pacesFromVdot(fitness.vo2max).easySecPerKm : null
  await repo.saveRunningBaseline(userId, {
    planId: plan.id,
    vo2max: fitness.vo2max,
    maxHr: fitness.maxHr,
    restingHr: fitness.restingHr,
    thresholdHr: fitness.thresholdHr,
    weeklyBaseMinutes: fitness.weeklyBaseMinutes,
    easyPaceSecPerKm,
  })
```

Add the import:

```typescript
import { pacesFromVdot } from '@/lib/health/vdot'
```

This mirrors the exact same VO2max→easy-pace approximation the sibling density-progression plan's
framework uses (`ctx.fitness.vo2max` fed to `pacesFromVdot`) — one formula, one place, not
reimplemented here.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Manual verification**

Create a new plan via the wizard (`pnpm dev`, `/running`), then via `psql`, confirm a matching
`running_baselines` row exists with non-null `vo2max`/`easy_pace_sec_per_km` if the seed user has a
fitness test on file, or nulls if not (both are valid — the anchor should never fail plan creation).

- [ ] **Step 4: Commit**

```bash
git add app/api/running-plan/route.ts
git commit -m "feat: freeze a baseline anchor when a running plan is created"
```

---

### Task 3: Pure push-session and environment-inference functions

**Files:**
- Create: `lib/running/push-sessions.ts`
- Test: `lib/running/__tests__/push-sessions.test.ts`

Both "is this session a push session" and "was this run indoor or outdoor" are fully derivable —
no new stored fields, per the plan's architecture note.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { isPushSession, inferEnvironment } from '../push-sessions'

describe('isPushSession', () => {
  it('is false for the first 4 completed sessions in a plan', () => {
    expect(isPushSession(0)).toBe(false)
    expect(isPushSession(1)).toBe(false)
    expect(isPushSession(2)).toBe(false)
    expect(isPushSession(3)).toBe(false)
  })

  it('is true on the 5th completed session (0-indexed: 4)', () => {
    expect(isPushSession(4)).toBe(true)
  })

  it('repeats every 5 sessions', () => {
    expect(isPushSession(9)).toBe(true)
    expect(isPushSession(14)).toBe(true)
    expect(isPushSession(8)).toBe(false)
  })
})

describe('inferEnvironment', () => {
  it('is outdoor when a route polyline is present', () => {
    expect(inferEnvironment('abc123polyline')).toBe('outdoor')
  })

  it('is indoor when there is no route (treadmill, or GPS unavailable)', () => {
    expect(inferEnvironment(null)).toBe('indoor')
    expect(inferEnvironment('')).toBe('indoor')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/running/__tests__/push-sessions.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// Push/adherence session split (spec D-3) and environment inference (spec D-5) — both fully
// derived, never stored, per the "derive, or reconcile on read" rule (this project's stored
// counters have drifted every time one was persisted instead).

const PUSH_INTERVAL = 5

/** Whether the session at this 0-indexed position (count of PRIOR completed sessions in the plan)
 *  should be a push/benchmark session — spec D-3's "~1 in 4-5". Every 5th session, starting with
 *  the 5th (index 4). */
export function isPushSession(completedSessionsSoFar: number): boolean {
  return (completedSessionsSoFar + 1) % PUSH_INTERVAL === 0
}

export type RunEnvironment = 'indoor' | 'outdoor'

/** A session is outdoor if it has a real GPS route; treadmill/indoor sessions never record one.
 *  Environment-tagging (D-5) exists so a treadmill result never corrupts an outdoor pace anchor. */
export function inferEnvironment(routePolyline: string | null): RunEnvironment {
  return routePolyline ? 'outdoor' : 'indoor'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/running/__tests__/push-sessions.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/running/push-sessions.ts lib/running/__tests__/push-sessions.test.ts
git commit -m "feat: add pure push-session and environment-inference functions"
```

---

### Task 4: Wire push sessions into the prescription route

**Files:**
- Modify: `app/api/running-plan/route.ts`

When today's session is a push session, the prescription's rationale and distance target change to
an explicit "beat your best" framing, using the anchor + best same-environment completed result so
far this plan.

- [ ] **Step 1: Add a query for completed sessions and their best result**

Add near `assembleInputs`:

```typescript
import { isPushSession, inferEnvironment } from '@/lib/running/push-sessions'

interface PushContext {
  isPush: boolean
  bestDistanceKm: number | null
}

async function resolvePushContext(
  repo: Awaited<ReturnType<typeof getRepository>>,
  userId: string, plan: RunningPlan, todayIso: string,
): Promise<PushContext> {
  const completed = (await repo.getPrescribedRuns(userId, plan.createdAt.toISOString().slice(0, 10), todayIso))
    .filter(r => r.status === 'completed' && r.planId === plan.id)
  const isPush = isPushSession(completed.length)
  if (!isPush) return { isPush, bestDistanceKm: null }

  const logIds = completed.map(r => r.activityLogId).filter((id): id is string => id != null)
  if (logIds.length === 0) return { isPush, bestDistanceKm: null }

  const logs = await repo.listActivityLogs(userId, plan.createdAt.toISOString().slice(0, 10), todayIso)
  const matchingLogs = logs.filter(l => logIds.includes(l.id))
  const outdoorLogs = matchingLogs.filter(l => inferEnvironment(l.routePolyline ?? null) === 'outdoor')
  const distances = outdoorLogs.map(l => l.distanceKm).filter((d): d is number => d != null)
  const bestDistanceKm = distances.length > 0 ? Math.max(...distances) : null
  return { isPush, bestDistanceKm }
}
```

`plan.createdAt.toISOString().slice(0, 10)` here is a **date-range query bound**, not a "today"
computation — the forbidden-pattern lint rule (`no-restricted-syntax`) only fires on
`.toISOString().slice()` used to derive "today"; if it flags this call anyway, switch to
`toAestDay(plan.createdAt, tz)` (already imported in this file) instead, which is the tz-correct
equivalent for this exact use.

- [ ] **Step 2: Apply it in `GET`**

After computing `prescription` in `GET` (currently after line 159), before the `run` upsert:

```typescript
  const pushCtx = await resolvePushContext(repo, userId, plan, today)
  if (pushCtx.isPush && pushCtx.bestDistanceKm != null && prescription.distanceKm != null) {
    prescription.distanceKm = Math.max(prescription.distanceKm, Math.round((pushCtx.bestDistanceKm * 1.02) * 100) / 100)
    prescription.rationale = `Push session — you've covered ${pushCtx.bestDistanceKm.toFixed(2)} km in this block's best outdoor run. Beat it: aim for ${prescription.distanceKm.toFixed(2)} km today.`
  }
```

(2% is a deliberately small, achievable beat-margin — the point is a real but reachable stretch, not
a demoralizing jump; only applies when the framework already produces a `distanceKm` target — the
four pre-existing frameworks that leave it `null` are unaffected until they gain their own distance
axis, which is out of this plan's scope.)

Include `isPushSession: pushCtx.isPush` in the JSON response (add to the returned object, both `GET`
and `POST`) so the UI (Task 5) can show the push framing.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 4: Manual verification**

Seed at least 4 completed `prescribed_runs` rows for the test user's active plan (via `psql`, or by
manually marking runs completed through the UI/API across several simulated days), then hit
`GET /api/running-plan` a 5th time and confirm `isPushSession: true` and the rationale changes to the
"beat it" framing when a same-environment (`routePolyline`-bearing) completed log exists.

- [ ] **Step 5: Commit**

```bash
git add app/api/running-plan/route.ts
git commit -m "feat: wire push-session detection and beat-your-best targets into the prescription route"
```

---

### Task 5: Surface the push framing in the UI

**Files:**
- Modify: `components/running/prescribed-run-card.tsx`
- Modify: `components/running/running-plan-content.tsx`

- [ ] **Step 1: Add the prop and a small badge**

In `components/running/prescribed-run-card.tsx`, add to `Props` (currently lines 24-30):

```typescript
  isPushSession?: boolean
```

Destructure it in `PrescribedRunCardImpl` and render a small badge next to the title (after the
`<h2>`, currently line 61):

```tsx
        <h2 className="text-lg font-bold">{TYPE_LABEL[type]}</h2>
        {isPushSession && (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ color: 'var(--accent-amber)', background: 'color-mix(in oklch, var(--accent-amber) 15%, transparent)' }}
          >
            Push
          </span>
        )}
```

- [ ] **Step 2: Thread it from the content component**

In `components/running/running-plan-content.tsx`, extend `PlanResponse` (currently lines 18-26):

```typescript
  isPushSession?: boolean
```

Pass it to `PrescribedRunCard` (currently lines 132-138):

```tsx
        <PrescribedRunCard
          prescription={data.prescription}
          gateAction={data.gateAction ?? 'proceed'}
          gateReasons={data.gateReasons ?? []}
          isPushSession={data.isPushSession}
          onStart={onStart}
          onSkip={() => markRun('skipped')}
        />
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 4: Manual verification (dev server + Playwright)**

Using the same seeded-completed-runs state from Task 4 Step 4, open `/running` and confirm the
"Push" badge renders next to the run type, and the rationale text shows the beat-your-best framing.

- [ ] **Step 5: Commit**

```bash
git add components/running/prescribed-run-card.tsx components/running/running-plan-content.tsx
git commit -m "feat: show a push-session badge and beat-your-best framing on the running card"
```

---

### Task 6: Full gate, version bump, session bookkeeping

**Files:**
- Modify: `package.json`, `lib/changelog.ts`, `projectOverview.md`
- Create: `docs/overview/entries/2026-07-27-cardio-baseline-anchors.md`
- Modify: `docs/implementation-backlog.md`

- [ ] **Step 1: Run the full local gate**

```bash
pnpm lint
node scripts/check-reconcile.js
node scripts/check-push-mutations.js
pnpm typecheck
pnpm test
```

- [ ] **Step 2: Isolated production build**

```bash
rm -rf .next
npm run build
```

- [ ] **Step 3: Version bump + changelog**

Minor bump; changelog entry describing the anchor + push-session mechanic in plain language.

- [ ] **Step 4: Journal entry**

`docs/overview/entries/2026-07-27-cardio-baseline-anchors.md` — what shipped, and explicitly flag as
**not verified**: a real 5-session push cadence over real calendar time (the seed can't produce 5
genuinely-completed running sessions without manual DB seeding for this pass); on-device.

- [ ] **Step 5: `projectOverview.md`**

Update Current Status chain; add a Known Issues row.

- [ ] **Step 6: Backlog update**

In `docs/implementation-backlog.md`'s cardio batch: mark this item shipped with a pointer note.
Plateau handling (D-7) and block-end review (D-8) remain **explicitly deferred** — add a new backlog
row for them, noting they depend on real push-session history existing (this plan is the first thing
that produces any) and are therefore premature to plan in detail until the app has been used for at
least one full block.

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "chore: version bump, journal entry and backlog update for baseline anchors + push sessions"
git push -u origin feat/cardio-baseline-anchors
```

---

## Self-Review Notes

- **Spec coverage:** baseline anchor (frozen fitness/pace snapshot per plan) ✅ Tasks 1-2; push vs
  adherence sessions, ~1-in-5 (D-3) ✅ Tasks 3-4; environment tagging so treadmill never corrupts an
  outdoor anchor (D-5) ✅ `inferEnvironment` in Task 3, applied in Task 4's `resolvePushContext`.
  Plateau (D-7) and block review (D-8) — **explicitly deferred**, tracked in Task 6 Step 6, since
  both need real push-session history this plan is what first produces.
- **No sync-chain changes:** confirmed no new field is written through the offline
  `prescribed_run` mutation domain — `isPushSession`/environment are read-time derivations, not
  stored, so the local SQLite schema, `RECONCILE_TABLES`, and `pushMutations` are untouched.
- **One Formula, One Place:** the VO2max→easy-pace approximation (`pacesFromVdot`) is computed
  identically in the sibling density-progression plan's framework and this plan's anchor-freezing
  step — same function, same input field, not reimplemented.
