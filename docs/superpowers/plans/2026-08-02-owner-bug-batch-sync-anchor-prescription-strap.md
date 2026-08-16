# Owner Bug Batch (2026-08-02) — Sync, Body-Battery Anchor, Phase Transition, Chest Strap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five production bugs the owner reported on 2026-08-02: pull-to-sync failing, the
guided walk never reaching the server (and so never reaching the training calendar), Body Battery's
anchor flipping between the readiness and sleep scores mid-day, the AI prescription vanishing when a
phase transition is accepted, and the chest-strap card permanently reading "Connecting…".

**Architecture:** Five independent workstreams (A–E), each a separately-mergeable PR off a fresh
`main`. They share no files. A and B are the two halves of the one visible symptom ("Sync failed —
will retry automatically") and should ship first, in that order — A removes the stranded mutation, B
removes the local-DB init fault that can independently fail a pull. C, D and E are independent of
everything.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, Zod (shared validation in
`packages/shared/src/validation/`), Drizzle + Postgres, `@capacitor-community/sqlite` (local store),
Kotlin (native Polar foreground service), Vitest.

---

## Evidence this plan is built on

All five were traced to source in the investigation session; none is speculative. Where a claim was
verified by running code it says so.

| # | Owner report | Root cause (file:line) | Verified how |
|---|---|---|---|
| 1 | "Pulling down to sync gives error" | Two independent causes: (a) a dead-lettered `activity_logs` mutation (see #3); (b) `applyDelta` is called **outside** `pullPage`'s try block (`lib/local-store/sync-engine.ts:531`), so a broken local schema throws straight out of `pullDelta` → `handlePullSync` sees `null` → toast (`app/session-select/session-select-content.tsx:625`). The device console shows the local schema *is* broken (`duplicate column name: attempts`, WAL failure). | Source read + console screenshots |
| 2 | "Body battery starting at readiness score and sometimes sleep score" | `app/api/body-battery/route.ts:140-155` picks the anchor fresh on **every** read: `oura_daily_derived.readinessScore` if present, else our computed sleep score. The derived row only exists once `/api/readiness-score` has run that day, so the anchor — and therefore the whole day's curve — silently switches source (and jumps by `readiness − sleepScore` points) part-way through the morning. | Source read |
| 3 | "Guided walk did not show up in training calendar" | `computeWalkSegmentStats` rounds `avgHr` to **1 decimal place** (`lib/walk/segment-stats.ts:23`), but `WalkSegmentStatSchema.avgHr` is `z.number().int()` (`packages/shared/src/validation/activity-log.ts:17`). One fractional segment mean rejects the **entire** `activity_logs` payload on both write paths → 5 attempts → dead-letter. The calendar reads `activity_logs` from the **server** (`getCalendarData`, `lib/data/postgres/adapter.ts:1066`), so an un-synced walk can never appear there even though the local-first Health list shows it. | **Reproduced** with a Vitest run against the real schema — fails with `{path: ["segments",0,"avgHr"], message: "Invalid input: expected int, received number"}` |
| 4 | "Clicked move to Intensification and all prescription info disappeared" | `advancePhase` sets `prescription: null, prescriptionStatus: 'none'` (`lib/data/postgres/slices/periodization.ts:80-99`). `'none'` is **not** `'consumed'`, and `isAiPrescriptionPending` keys on `'consumed'` (`packages/shared/src/ai-periodization/prescription-pending.ts:28`) — so no "Preparing your AI workout…" state, no poll, and no client-side regeneration trigger fire. The only regeneration is a **fire-and-forget server self-fetch** (`app/api/ai-periodization/session/[sessionId]/transition/route.ts:61`) — the exact pattern this codebase already documents as "unreliable in prod" (`components/workout-screen.tsx:1519`). Result: a permanent dead state until the next completed workout. | Source read |
| 5 | "Still always getting a connection notice for the polar strap" | The card's label is derived from a boolean pair — `!gattConnected && active` renders "Connecting…" (`components/settings/chest-strap-pairing.tsx:34-38`). `active` is `true` from app start (ambient mode runs all day via `live-hr-ambient-provider.tsx:28`) and only `nativeState === 'ready'` counts as connected. The native service gives up after 6 failures and calls `stopSelf()` (`PolarStrapService.kt:159-163`) **without emitting a final status**, so JS is stuck on the last-seen `"disconnected"` forever → "Connecting…" while nothing is connecting. | Source read |

---

## File Structure

| File | Workstream | Responsibility after the change |
|---|---|---|
| `packages/shared/src/validation/activity-log.ts` | A | Accepts the payloads the app actually mints; still rejects impossible data |
| `lib/walk/segment-stats.ts` | A | Emits an integer `avgHr` at source |
| `lib/data/postgres/adapter.ts` | A | Push errors name the failing field |
| `lib/sqlite/sqlite-service.ts` | B | Local DB open recovers permanently instead of re-failing every launch |
| `app/api/body-battery/route.ts` | C | One anchor per day; upgrades sleep→readiness exactly once, never flaps |
| `components/body-battery-card.tsx` | C | Says when the anchor is provisional |
| `app/api/ai-periodization/session/[sessionId]/transition/route.ts` | D | Leaves the slot in the "regenerating" state the UI already understands |
| `components/workout/ai-prescription-card.tsx` | D | Client-fires the regeneration (reliable path) |
| `lib/live-hr/chest-strap-source.ts` | E | Exposes the real link state, not a boolean pair |
| `components/settings/chest-strap-pairing.tsx` | E | Honest label + a manual reconnect |
| `android/.../polar/PolarStrapService.kt` | E | Announces "stopped" before it dies |

---

## Workstream A — the guided walk can never sync (bugs 1 + 3)

**Branch:** `fix/activity-log-segment-validation`

Two changes are needed and the order matters. The owner's device is holding a **frozen, already-
serialised payload** in its outbox with `segments[].avgHr = <fractional>`. Rounding at source fixes
future walks but does nothing for that stranded row — only relaxing the server schema lets it drain
when the owner taps **Retry** on the sync-health card. So: relax the schema (unblocks the stranded
row) *and* round at source (keeps new payloads clean).

### Task A1: Let a fractional segment mean HR through the schema

**Files:**
- Modify: `packages/shared/src/validation/activity-log.ts:17`
- Test: `packages/shared/src/validation/__tests__/plausibility.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/validation/__tests__/plausibility.test.ts`:

```ts
describe('ActivityLogBody — guided-walk segment stats (2026-08-02 owner report)', () => {
  const walk = {
    date: '2026-08-01', activityType: 'walk', title: 'Interval walk',
    startTime: '08:15', endTime: '08:39', durationMin: 24, distanceKm: 2.34,
  }

  // computeWalkSegmentStats rounds means to 1dp, so avgHr is routinely fractional. The schema
  // required an integer, which rejected the WHOLE payload — the walk then dead-lettered in the
  // outbox and never reached the server (or the training calendar).
  it('accepts a segment whose avgHr is a 1dp mean', () => {
    const res = ActivityLogBody.safeParse({
      ...walk,
      segments: [{
        index: 0, setNumber: 1, kind: 'fast', startSec: 0, endSec: 120,
        avgHr: 123.4, maxHr: 140, hrAtStart: 110,
        avgPaceSecPerKm: 600, distanceKm: 0.2, avgCadenceSpm: 112.3,
      }],
    })
    expect(res.success).toBe(true)
  })

  it('still rejects a segment HR that is not a heart rate', () => {
    const res = ActivityLogBody.safeParse({
      ...walk,
      segments: [{
        index: 0, setNumber: 1, kind: 'fast', startSec: 0, endSec: 120,
        avgHr: 0, maxHr: 140, hrAtStart: 110,
        avgPaceSecPerKm: 600, distanceKm: 0.2, avgCadenceSpm: 112.3,
      }],
    })
    expect(res.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/shared/src/validation/__tests__/plausibility.test.ts`
Expected: FAIL — `Invalid input: expected int, received number` at `segments.0.avgHr`.

- [ ] **Step 3: Drop `.int()` from the three segment HR fields**

In `packages/shared/src/validation/activity-log.ts`, replace the three HR lines of
`WalkSegmentStatSchema`:

```ts
const WalkSegmentStatSchema = z.object({
  index: z.number().int(),
  setNumber: z.number().int(),
  kind: z.enum(['warmup', 'fast', 'slow', 'cooldown']),
  startSec: z.number(),
  endSec: z.number(),
  // Segment means are rounded to 1dp by computeWalkSegmentStats, so these are NOT integers.
  // `.int()` here rejected the whole activity payload on both write paths and dead-lettered
  // every guided walk whose segment mean HR wasn't whole (2026-08-02). The `segments` JSONB
  // column types these as plain `number | null`, so a fractional value stores fine.
  avgHr: z.number().positive().nullable(),
  maxHr: z.number().positive().nullable(),
  hrAtStart: z.number().positive().nullable(),
  avgPaceSecPerKm: z.number().positive().nullable(),
  distanceKm: z.number().nonnegative().nullable(),
  avgCadenceSpm: z.number().nonnegative().nullable(),
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/shared/src/validation/__tests__/plausibility.test.ts`
Expected: PASS (both new cases, plus the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/validation/activity-log.ts packages/shared/src/validation/__tests__/plausibility.test.ts
git commit -m "Accept fractional segment mean HR in activity payloads

computeWalkSegmentStats rounds segment means to 1dp; the schema demanded an
integer, so one fractional mean rejected the entire activity_logs payload on
both write paths. Every affected guided walk dead-lettered in the outbox and
never reached the server or the training calendar."
```

### Task A2: Round the segment mean HR at source

**Files:**
- Modify: `lib/walk/segment-stats.ts:22-24,67`
- Test: Create `lib/walk/__tests__/segment-stats.test.ts`

`avg()` is shared by `avgHr` (which should be whole beats) and `avgCadenceSpm` (where 1dp is
meaningful), so give HR its own rounding rather than changing `avg()` for both.

- [ ] **Step 1: Write the failing test**

Create `lib/walk/__tests__/segment-stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeWalkSegmentStats } from '../segment-stats'
import { ActivityLogBody } from '@trainingai/shared/validation/activity-log'
import type { IntervalPlan } from '../interval-plan'

const START = 1_754_000_000_000

const plan = {
  totalSec: 240,
  segments: [
    { index: 0, setNumber: 1, kind: 'fast', startSec: 0, endSec: 120 },
    { index: 1, setNumber: 1, kind: 'slow', startSec: 120, endSec: 240 },
  ],
} as unknown as IntervalPlan

// 121, 122, 123 → mean 122; 130, 131 → mean 130.5 (the case that broke production).
const hrSamples = [
  { at: START + 10_000, bpm: 121 },
  { at: START + 20_000, bpm: 122 },
  { at: START + 30_000, bpm: 123 },
  { at: START + 130_000, bpm: 130 },
  { at: START + 140_000, bpm: 131 },
]

describe('computeWalkSegmentStats', () => {
  it('emits whole-beat segment mean HR', () => {
    const stats = computeWalkSegmentStats({
      plan, startedAtMs: START, hrSamples, rawPoints: [], cadenceSeries: null,
    })
    expect(stats[0].avgHr).toBe(122)
    expect(stats[1].avgHr).toBe(131)   // 130.5 rounds up
    expect(Number.isInteger(stats[1].avgHr!)).toBe(true)
  })

  it('produces segments the wire schema accepts', () => {
    const segments = computeWalkSegmentStats({
      plan, startedAtMs: START, hrSamples, rawPoints: [], cadenceSeries: null,
    })
    const res = ActivityLogBody.safeParse({
      date: '2026-08-01', activityType: 'walk', title: 'Interval walk',
      startTime: '08:15', durationMin: 4, segments,
    })
    expect(res.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/walk/__tests__/segment-stats.test.ts`
Expected: FAIL — `expected 130.5 to be 131`.

- [ ] **Step 3: Round HR to whole beats**

In `lib/walk/segment-stats.ts`, add a dedicated helper next to `avg` and use it for `avgHr`:

```ts
function avg(nums: number[]): number | null {
  return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null
}

// Heart rate is whole beats — a 1dp mean is noise here, and it is what made these payloads
// fail the wire schema before it was relaxed (2026-08-02). Cadence keeps `avg`'s 1dp.
function avgWhole(nums: number[]): number | null {
  const mean = avg(nums)
  return mean == null ? null : Math.round(mean)
}
```

and change the returned `avgHr`:

```ts
      avgHr: avgWhole(bpms),
```

Leave `avgCadenceSpm: avg(...)` and `aggregateSegmentsByKind` untouched — the roll-up averages
already-rounded per-segment values and is display-only.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/walk/__tests__/segment-stats.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/walk/segment-stats.ts lib/walk/__tests__/segment-stats.test.ts
git commit -m "Round guided-walk segment mean HR to whole beats

A 1dp mean is noise for heart rate and is what pushed these payloads outside
the wire contract. Cadence keeps its decimal — it is a real distinction there."
```

### Task A3: Name the failing field when a push is rejected

The sync-health card currently shows `Invalid activity_logs payload (5 attempts)` — enough to know
something broke, not enough to know what. Every hour spent on this bug was spent finding the field.

**Files:**
- Modify: `lib/data/postgres/adapter.ts:3777-3781`
- Test: Create `lib/data/postgres/__tests__/push-error-detail.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/data/postgres/__tests__/push-error-detail.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { describeZodFailure } from '../push-error-detail'
import { ActivityLogBody } from '@trainingai/shared/validation/activity-log'

describe('describeZodFailure', () => {
  it('names the field path and the reason', () => {
    const res = ActivityLogBody.safeParse({
      date: '2026-08-01', activityType: 'walk', title: 'Interval walk', distanceKm: 0,
    })
    expect(res.success).toBe(false)
    if (res.success) return
    expect(describeZodFailure(res.error)).toContain('distanceKm')
  })

  it('joins at most three issues and stays short enough for a toast', () => {
    const res = ActivityLogBody.safeParse({ date: 'nope' })
    expect(res.success).toBe(false)
    if (res.success) return
    const msg = describeZodFailure(res.error)
    expect(msg.length).toBeLessThanOrEqual(200)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/data/postgres/__tests__/push-error-detail.test.ts`
Expected: FAIL — `Cannot find module '../push-error-detail'`.

- [ ] **Step 3: Write the helper**

Create `lib/data/postgres/push-error-detail.ts`:

```ts
import type { ZodError } from 'zod'

// A rejected mutation dead-letters after 5 attempts and the owner sees only the message we put
// here. "Invalid activity_logs payload" cost a whole session to trace to segments[0].avgHr
// (2026-08-02) — name the field. Capped so it stays readable in the sync-health card.
export function describeZodFailure(error: ZodError): string {
  return error.issues
    .slice(0, 3)
    .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ')
    .slice(0, 200)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/data/postgres/__tests__/push-error-detail.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Use it in the `activity_logs` push branch**

In `lib/data/postgres/adapter.ts`, add the import next to the other validation imports:

```ts
import { describeZodFailure } from './push-error-detail'
```

and change the `activity_logs` rejection at line ~3778:

```ts
          const parsed = ActivityLogBody.safeParse({ ...p, date: mut.date })
          if (!parsed.success) {
            errors.push({
              id: mut.id, domain: mut.domain, date: mut.date,
              error: `Invalid activity_logs payload — ${describeZodFailure(parsed.error)}`,
            })
            continue
          }
```

Apply the identical change to the `fitness_tests` branch (line ~3796) and the `prescribed_run`
branch (line ~3807) — same failure mode, same blind message.

- [ ] **Step 6: Run lint + typecheck**

Run: `pnpm lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/data/postgres/push-error-detail.ts lib/data/postgres/__tests__/push-error-detail.test.ts lib/data/postgres/adapter.ts
git commit -m "Name the failing field when a synced mutation is rejected

A dead-lettered mutation's only user-visible trace is this string. 'Invalid
activity_logs payload' does not say which field, which is most of the cost of
diagnosing one."
```

### Task A4: Verify against the local dev server, then hand the owner the retry step

- [ ] **Step 1: Start the dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Exercise the changed route**

`POST http://localhost:3000/api/activity-logs` (signed in as `test@local.dev` / `testpass123`) with
a body carrying a `segments` array whose `avgHr` is `123.4`. Expected: **201/200**, and the row is
visible in `activity_logs` with the segment stored:

```bash
psql "postgresql://postgres:postgres@localhost:5433/trainingai_dev" \
  -c "select date, activity_type, jsonb_array_length(segments) from activity_logs order by created_at desc limit 3;"
```

- [ ] **Step 3: Confirm the calendar picks it up**

Open `http://localhost:3000/session-select` at a ≤640px viewport and confirm the day carries an
activity marker. This is the surface the owner reported as empty.

- [ ] **Step 4: Run the full suite and commit nothing further if green**

Run: `npx vitest run` — if a `lib/data/postgres/__tests__/*` file fails, **re-run that file alone
before reporting it** (CLAUDE.md: the DB-backed tests oversubscribe the local Postgres under
parallel workers; four false alarms came from exactly this on 2026-07-28). Stop `pnpm dev` first.

**Owner action after this ships:** the stranded 2026-08-01 mutation stays dead-lettered until it is
retried — the outbox does not re-attempt a dead-lettered row on its own. Tell the owner to open
**More → Profile** and tap **Retry** on the "1 change failed to sync" card once the deploy lands.

---

## Workstream B — the local SQLite store fails to open cleanly on every launch

**Branch:** `fix/local-sqlite-init-recovery`

Three distinct faults are visible in the owner's console, and each has its own fix. All three are
in `lib/sqlite/sqlite-service.ts`.

> **Device-verification gate:** this workstream touches the local store's open path — the single
> most dangerous file in the app (it has silently killed the local DB twice: WAL-in-transaction
> #27, non-idempotent ADD COLUMN #85). `getLocalStore` returns `null` in the web sandbox, so
> **none of this is exercised by `pnpm dev`**. It ships with an on-device smoke run
> (`docs/device-smoke-checklist.md`) **or** a Known-Issues row marking it unverified.

### Task B1: Read `PRAGMA journal_mode` through `query()`, not `execute()`

The console says `could not enable WAL mode: Execute: unknown error (code 0): Queries can be
performed using SQLiteDatabase query or rawQuery methods only.` `PRAGMA journal_mode=WAL` **returns
a row**, and the Android plugin's `execute()` path cannot return rows. WAL has therefore never been
enabled on this device — every write is slower and more lock-prone than intended.

**Files:**
- Modify: `lib/sqlite/sqlite-service.ts:75-79`

- [ ] **Step 1: Switch the call**

```ts
      // PRAGMA journal_mode RETURNS a row, so it must go through query() — execute() fails with
      // "Queries can be performed using SQLiteDatabase query or rawQuery methods only" and WAL is
      // then silently never enabled (observed on the S25, 2026-08-02). Still outside any
      // transaction: SQLite rejects the journal-mode switch inside one.
      try {
        const res = await _db.query('PRAGMA journal_mode=WAL;')
        const mode = (res.values?.[0] as { journal_mode?: string } | undefined)?.journal_mode
        if (mode?.toLowerCase() !== 'wal') {
          console.warn('[initSQLite] journal_mode is', mode, '— WAL not active')
        }
      } catch (e) {
        console.warn('[initSQLite] could not enable WAL mode:', e)
      }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/sqlite/sqlite-service.ts
git commit -m "Set WAL journal mode through query(), not execute()

PRAGMA journal_mode returns a row, which the Android plugin's execute() path
cannot handle — so the switch has been failing silently and WAL was never on."
```

### Task B2: Stop the broken version upgrade from re-running on every launch

`createConnection(..., dbVersion=21)` re-runs the v13 upgrade every launch, it fails every launch
with `duplicate column name: attempts`, and the fallback reopens at version 1 — which does **not**
write the version back, so the same failure recurs forever. `reconcileSchema()` is the declared
schema authority after a partial upgrade (CLAUDE.md), so once it has run cleanly the stored version
should be stamped forward and the poisoned upgrade retired.

**Files:**
- Modify: `lib/sqlite/sqlite-service.ts:52-81,101-121`

- [ ] **Step 1: Make `reconcileSchema` report whether it fully succeeded**

Change its signature and both failure arms to record a failure instead of swallowing it:

```ts
// Belt-and-suspenders schema check run after every open. ADD COLUMN is not idempotent in SQLite,
// so a partially-applied version upgrade can leave the local store permanently missing columns.
// This adds only what's actually absent (guarded by PRAGMA table_info), so it's a safe no-op once
// the schema is whole and cannot corrupt an already-correct DB.
// Returns false if ANY statement failed — the caller must not stamp the schema version forward
// on a partial reconcile, or the missing piece would never be repaired again.
async function reconcileSchema(db: SQLiteDBConnection): Promise<boolean> {
  let ok = true
  for (const stmt of RECONCILE_TABLES) {
    try {
      await db.execute(stmt);
    } catch (err) {
      ok = false
      console.error('[reconcileSchema] failed to ensure table:', err);
    }
  }
  for (const { table, column, ddl } of RECONCILE_COLUMNS) {
    try {
      const info = await db.query(`PRAGMA table_info(${table})`);
      const cols = (info.values ?? []) as { name: string }[];
      if (cols.length === 0) continue; // table absent — leave to the migrations
      if (cols.some(c => c.name === column)) continue; // already present
      await db.run(ddl, []);
      console.warn(`[reconcileSchema] added missing column ${table}.${column}`);
    } catch (err) {
      ok = false
      console.error(`[reconcileSchema] failed to reconcile ${table}.${column}:`, err);
    }
  }
  return ok
}
```

- [ ] **Step 2: Track whether the upgrade path was the fallback, and stamp the version**

Replace the block from the `try { _db = await conn.createConnection(...) }` through
`await reconcileSchema(_db)`:

```ts
      let usedFallback = false
      try {
        _db = await conn.createConnection(DB_NAME, false, 'no-encryption', dbVersion, false);
        await _db.open();
      } catch (upgradeErr) {
        // The versioned upgrade transaction failed — e.g. a non-idempotent
        // `ALTER TABLE ADD COLUMN` on a partially-applied version, which SQLite
        // rejects on retry with "duplicate column" and rolls the whole upgrade
        // back. A failed open would otherwise leave the ENTIRE local store dead
        // (every read returns empty), so freshly-logged data looks like it
        // vanished on reload. Instead: drop the half-open handle and reopen at
        // version 1. capacitor-sqlite never downgrades, so this opens the DB
        // as-is WITHOUT running the (broken) upgrade, and the idempotent
        // reconcileSchema() below then brings the schema current.
        console.error('[initSQLite] version upgrade failed — reopening without upgrade + reconciling:', upgradeErr);
        usedFallback = true
        try { await conn.closeConnection(DB_NAME, false); } catch { /* not registered/open — fine */ }
        _db = await conn.createConnection(DB_NAME, false, 'no-encryption', 1, false);
        await _db.open();
      }

      // (WAL block from Task B1 goes here, unchanged)

      const reconciled = await reconcileSchema(_db);

      // Stamp the schema version forward after a fallback open. Without this the poisoned upgrade
      // re-runs, re-fails and re-falls-back on EVERY launch, forever (observed on the S25 with
      // v13's `ALTER TABLE mutations_outbox ADD COLUMN attempts`, 2026-08-02) — leaving the store
      // permanently one bad moment away from a hard open failure. reconcileSchema is the declared
      // schema authority after a partial upgrade (CLAUDE.md), so once it has completed with no
      // errors the schema IS current and the version should say so. Only on a clean reconcile:
      // stamping over a partial one would retire the repair path with work still outstanding.
      if (usedFallback && reconciled) {
        try {
          await _db.execute(`PRAGMA user_version = ${dbVersion};`, false);
          console.warn('[initSQLite] schema reconciled — stamped user_version to', dbVersion);
        } catch (e) {
          console.error('[initSQLite] could not stamp user_version:', e);
        }
      }
      _initFailed = false; // a retry after a prior failure recovered
```

- [ ] **Step 3: Add a regression test for the reconcile-completeness invariant**

Every column a versioned `ALTER TABLE … ADD COLUMN` adds must also be in `RECONCILE_COLUMNS`,
otherwise stamping the version forward would strand it. Add to
`lib/sqlite/__tests__/migrations.test.ts`:

```ts
  it('every ALTER-added column is also registered in RECONCILE_COLUMNS', () => {
    // initSQLite stamps user_version forward after a clean reconcile, which retires the versioned
    // upgrade path. Any ADD COLUMN missing from RECONCILE_COLUMNS would then never be applied.
    const mirror = new Set(RECONCILE_COLUMNS.map(c => `${c.table}.${c.column}`))
    const missing: string[] = []
    for (const m of MIGRATIONS) {
      for (const stmt of m.statements) {
        const match = /ALTER TABLE (\w+) ADD COLUMN (\w+)/i.exec(stmt)
        if (match && !mirror.has(`${match[1]}.${match[2]}`)) {
          missing.push(`v${m.toVersion}: ${match[1]}.${match[2]}`)
        }
      }
    }
    expect(missing, `unreconciled ALTER-added columns: ${missing.join(', ')}`).toEqual([])
  })
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/sqlite/__tests__/migrations.test.ts`

If it fails, it has found real gaps — **add the missing entries to `RECONCILE_COLUMNS` in
`lib/sqlite/migrations.ts`** (copying the exact DDL from the migration that adds them) rather than
weakening the test. Re-run until green.

- [ ] **Step 5: Commit**

```bash
git add lib/sqlite/sqlite-service.ts lib/sqlite/migrations.ts lib/sqlite/__tests__/migrations.test.ts
git commit -m "Stamp the local schema version forward after a clean reconcile

The v13 upgrade fails with 'duplicate column name: attempts' on every launch
because the fallback reopen never writes the version back, so the poisoned
upgrade is retried forever. Stamp it once reconcileSchema has completed with no
errors, and assert every ALTER-added column is reconcilable so the stamp can
never retire an unrepaired schema."
```

### Task B3: Survive `Connection trainingai already exists`

The owner's third screenshot shows the *first* `createConnection` throwing
`CreateConnection: Connection trainingai already exists` — a leaked registration from an earlier
init attempt, not an upgrade fault. It currently lands in the upgrade-fallback arm, which reopens
at version 1 for the wrong reason.

**Files:**
- Modify: `lib/sqlite/sqlite-service.ts:47-54`

- [ ] **Step 1: Close any stale registration before opening**

Insert immediately before the `try { _db = await conn.createConnection(...) }`:

```ts
      // A previous init attempt can leave the connection registered without an open handle
      // (observed on the S25: "CreateConnection: Connection trainingai already exists",
      // 2026-08-02). That is a leaked registration, not an upgrade fault — clear it here so it
      // doesn't get misdiagnosed as one and pushed down the version-1 fallback path.
      try {
        const existing = await conn.isConnection(DB_NAME, false)
        if (existing.result) await conn.closeConnection(DB_NAME, false)
      } catch { /* nothing registered — the normal case */ }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/sqlite/sqlite-service.ts
git commit -m "Clear a leaked SQLite connection registration before opening

A registration left behind by an earlier init attempt threw 'Connection
trainingai already exists' from the first createConnection, which the upgrade
fallback then misread as a broken migration."
```

### Task B4: Make a failed pull say what failed

`applyDelta` sits **outside** `pullPage`'s try block, so a local-store fault propagates out of
`pullDelta` as an exception, is swallowed by `.catch(() => null)` in `handlePullSync`, and surfaces
as the generic "Sync failed — will retry automatically". The toast also fires for a plain backoff
window, which is not a failure at all.

**Files:**
- Modify: `lib/local-store/sync-engine.ts:531-536`
- Modify: `app/session-select/session-select-content.tsx:609-635`

- [ ] **Step 1: Catch and log the local-apply failure inside `pullPage`**

Wrap the `applyDelta`/`setLastSyncAt` pair:

```ts
  try {
    await store!.applyDelta({ bodyMetrics, moodLogs, sleepSessions,
      workoutSessions, activityLogs, fitnessTests, prescribedRuns, programs, programSessions, sessionExercises,
      schedules, scheduleDays, progressionStyles, styleSets,
      foodItems, foodLogs, supplements, supplementLogs, injuries,
      exerciseLogs, setLogs, personalRecords, ouraDaily, ouraDailySummary, ouraDailyDerived, dayCheckins });
    await store!.setLastSyncAt(raw.syncedAt);
  } catch (err) {
    // A broken local schema throws here, not at the fetch — and this used to propagate straight
    // out of pullDelta into a bare .catch(() => null), so the owner saw "Sync failed" with no
    // clue that the fault was on the device (2026-08-02). Report it as a failed page: the caller
    // already backs off correctly, and the cause is now in the device log.
    console.error('[pullDelta] applyDelta failed — local store may be out of schema:', err);
    return null;
  }
```

- [ ] **Step 2: Stop calling a backoff window a failure**

In `handlePullSync`, distinguish "we deliberately didn't try" from "we tried and it broke". Add an
exported predicate to `lib/local-store/sync-engine.ts`:

```ts
// True while a prior failure's backoff window is still open. A pull-to-sync during that window
// returns null WITHOUT attempting anything — reporting that as "Sync failed" is wrong and trains
// the owner to distrust a message that is usually about a transient earlier problem.
export function isSyncBackedOff(): boolean {
  return Date.now() < pullBackoffUntil || Date.now() < push5xxUntil;
}
```

and use it in `app/session-select/session-select-content.tsx`:

```ts
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (online && userId && getLocalStore(userId) && (pushRes === null || pullRes === null)) {
      toast.error(isSyncBackedOff()
        ? 'Sync is backing off after an earlier error — retrying shortly'
        : 'Sync failed — will retry automatically');
    }
```

Add `isSyncBackedOff` to the existing `@/lib/local-store/sync-engine` import in that file.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 4: Verify on the dev server**

`pnpm dev`, open `http://localhost:3000/session-select` at ≤640px, pull down to sync. Expected: no
toast (web has no local store, so the guard short-circuits — this confirms no regression in the
web path). The real verification is the device run below.

- [ ] **Step 5: Commit**

```bash
git add lib/local-store/sync-engine.ts app/session-select/session-select-content.tsx
git commit -m "Distinguish a local-apply failure and a backoff window from a real sync failure

applyDelta sat outside pullPage's try, so a device-side schema fault surfaced as
the same generic toast as a network failure — and a plain backoff window did too."
```

### Task B5: On-device verification

- [ ] **Step 1: Rebuild and sideload**

```bash
npx cap sync android && ./gradlew assembleDebug
```

(The sandbox has no Android SDK and the Gradle download is proxy-blocked — this step is the
owner's.)

- [ ] **Step 2: Confirm from the device console**

Launch the app twice. Expected on the **first** launch: the `duplicate column name: attempts` error
appears once, followed by `[initSQLite] schema reconciled — stamped user_version to 21`. Expected on
the **second** launch: **no** upgrade error at all, and no WAL warning.

- [ ] **Step 3: Confirm pull-to-sync**

Pull to sync on Home. Expected: no error toast.

- [ ] **Step 4: If no device run is possible**, add a Known-Issues row to `projectOverview.md`
marking this batch NOT device-verified, per the Canonical Runtime gate.

---

## Workstream C — Body Battery's anchor flips source mid-day

**Branch:** `fix/body-battery-anchor-stability`

The anchor is re-picked on every read. Before `/api/readiness-score` has run for the day there is no
`oura_daily_derived` row, so the fallback sleep score anchors the curve; once readiness lands, the
anchor jumps to it and the entire day's arc shifts by the difference. Two changes: freeze the anchor
once it is readiness-derived, and say so while it is still provisional.

### Task C1: Freeze the day's anchor once it comes from readiness

**Files:**
- Modify: `app/api/body-battery/route.ts:83-156`
- Test: Create `app/api/body-battery/__tests__/anchor-stability.test.ts`

The rule, in order:
1. Today's persisted snapshot has `anchorSource === 'readiness'` → **reuse that anchor**, never
   recompute. The day is settled.
2. Otherwise compute as today (derived readiness → own sleep score → frozen Cloud columns → 50) and
   persist. A sleep-derived anchor stays provisional and may upgrade to readiness exactly once.

- [ ] **Step 1: Write the failing test**

Create `app/api/body-battery/__tests__/anchor-stability.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveAnchor } from '../anchor'

describe('resolveAnchor', () => {
  it('uses the derived readiness score when it exists', () => {
    expect(resolveAnchor({
      persisted: null, derivedReadiness: 77, ownSleepScore: 61, cloud: null,
    })).toEqual({ anchor: 77, anchorSource: 'readiness', provisional: false })
  })

  it('falls back to our own sleep score before readiness has been computed', () => {
    expect(resolveAnchor({
      persisted: null, derivedReadiness: null, ownSleepScore: 61, cloud: null,
    })).toEqual({ anchor: 61, anchorSource: 'sleep', provisional: true })
  })

  it('upgrades a provisional sleep anchor to readiness exactly once', () => {
    expect(resolveAnchor({
      persisted: { anchor: 61, anchorSource: 'sleep' }, derivedReadiness: 77,
      ownSleepScore: 61, cloud: null,
    })).toEqual({ anchor: 77, anchorSource: 'readiness', provisional: false })
  })

  // The bug: without this, a later read that momentarily cannot see the derived row re-anchors
  // the whole day's curve back onto the sleep score and the number visibly jumps.
  it('never moves off a readiness anchor once the day has one', () => {
    expect(resolveAnchor({
      persisted: { anchor: 77, anchorSource: 'readiness' }, derivedReadiness: null,
      ownSleepScore: 61, cloud: null,
    })).toEqual({ anchor: 77, anchorSource: 'readiness', provisional: false })
  })

  it('clamps and defaults when there is nothing at all', () => {
    expect(resolveAnchor({
      persisted: null, derivedReadiness: null, ownSleepScore: null, cloud: null,
    })).toEqual({ anchor: 50, anchorSource: 'default', provisional: true })
  })

  it('uses the frozen Cloud columns only as a legacy last resort', () => {
    expect(resolveAnchor({
      persisted: null, derivedReadiness: null, ownSleepScore: null,
      cloud: { readinessScore: 70, sleepScore: 65 },
    })).toEqual({ anchor: 70, anchorSource: 'readiness', provisional: false })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/api/body-battery/__tests__/anchor-stability.test.ts`
Expected: FAIL — `Cannot find module '../anchor'`.

- [ ] **Step 3: Extract the anchor decision into a pure module**

Create `app/api/body-battery/anchor.ts`:

```ts
export type AnchorSource = 'readiness' | 'sleep' | 'default'

export interface AnchorInputs {
  /** Today's already-persisted snapshot, if the route has run at least once today. */
  persisted: { anchor: number; anchorSource: AnchorSource } | null
  /** Our own composite readiness for today — exists only once /api/readiness-score has run. */
  derivedReadiness: number | null
  /** Our own sleep score for the night that ended today. */
  ownSleepScore: number | null
  /** Frozen Oura Cloud columns — null for every post-re-key day; legacy arms only. */
  cloud: { readinessScore: number | null; sleepScore: number | null } | null
}

export interface AnchorResult {
  anchor: number
  anchorSource: AnchorSource
  /** True while the anchor may still be replaced today (sleep/default, pre-readiness). */
  provisional: boolean
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * The day's battery anchor.
 *
 * Recomputing this on every read let the source flip from `sleep` to `readiness` part-way
 * through the morning, which shifted the ENTIRE day's curve by the difference between the two
 * scores — the number visibly jumped and the two Home cards stopped agreeing (owner report,
 * 2026-08-02). A readiness anchor is therefore FROZEN for the rest of the day once it exists:
 * a sleep-derived anchor is explicitly provisional and may upgrade exactly once, never back.
 */
export function resolveAnchor(inputs: AnchorInputs): AnchorResult {
  const { persisted, derivedReadiness, ownSleepScore, cloud } = inputs

  if (persisted?.anchorSource === 'readiness') {
    return { anchor: clamp(persisted.anchor, 0, 100), anchorSource: 'readiness', provisional: false }
  }
  if (derivedReadiness != null) {
    return { anchor: clamp(derivedReadiness, 0, 100), anchorSource: 'readiness', provisional: false }
  }
  if (ownSleepScore != null) {
    return { anchor: clamp(ownSleepScore, 0, 100), anchorSource: 'sleep', provisional: true }
  }
  if (cloud?.readinessScore != null) {
    return { anchor: clamp(cloud.readinessScore, 0, 100), anchorSource: 'readiness', provisional: false }
  }
  if (cloud?.sleepScore != null) {
    return { anchor: clamp(cloud.sleepScore, 0, 100), anchorSource: 'sleep', provisional: true }
  }
  return { anchor: 50, anchorSource: 'default', provisional: true }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/api/body-battery/__tests__/anchor-stability.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire the route to it**

In `app/api/body-battery/route.ts`:

Add the import:

```ts
import { resolveAnchor } from './anchor'
```

Add today's snapshot to the existing `Promise.all` (line ~83), as a new entry:

```ts
    repo.getBodyBatteryHistory(userId, todayIso, todayIso),
```

destructured as `todaySnapshotRows`.

Replace the whole `let anchor / let anchorSource / if-else chain / anchor = clamp(...)` block
(lines ~138-156) with:

```ts
  const todaySnapshot = todaySnapshotRows[0] ?? null
  const { anchor, anchorSource, provisional: anchorProvisional } = resolveAnchor({
    persisted: todaySnapshot
      ? { anchor: todaySnapshot.anchor, anchorSource: todaySnapshot.anchorSource as 'readiness' | 'sleep' | 'default' }
      : null,
    derivedReadiness: derivedToday?.readinessScore ?? null,
    ownSleepScore,
    cloud: ouraToday
      ? { readinessScore: ouraToday.readinessScore ?? null, sleepScore: ouraToday.sleepScore ?? null }
      : null,
  })
```

Change `let battery = anchor` to stay as-is (it already reads the const).

Add `anchorProvisional` to the response interface and the returned object:

```ts
export interface BodyBatteryResponse {
  // …existing fields…
  anchorSource: 'readiness' | 'sleep' | 'default'
  /** True while the anchor is still the pre-readiness fallback and may be replaced today. */
  anchorProvisional: boolean
```

```ts
    anchor: Math.round(anchor),
    anchorSource,
    anchorProvisional,
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`battery`, `charged`, `drained` still start from `anchor` unchanged.)

- [ ] **Step 7: Commit**

```bash
git add app/api/body-battery/anchor.ts app/api/body-battery/__tests__/anchor-stability.test.ts app/api/body-battery/route.ts
git commit -m "Freeze the Body Battery anchor once it is readiness-derived

The anchor was re-picked on every read, so it flipped from the sleep score to
the readiness score part-way through the morning and shifted the whole day's
curve by the difference. A readiness anchor now settles the day; a sleep anchor
is explicitly provisional and can upgrade exactly once."
```

### Task C2: Say when the anchor is provisional

**Files:**
- Modify: `components/body-battery-card.tsx:140-170`

- [ ] **Step 1: Add the qualifier to both explanation strings**

In the expanded-detail block, after the existing `anchorSource` clauses:

```tsx
                      Started at <span className="font-semibold text-foreground tabular-nums">{battery.anchor}</span>
                      {battery.anchorSource === 'readiness' && ' from readiness'}
                      {battery.anchorSource === 'sleep' && ' from sleep'}
                      {battery.anchorProvisional && ' (provisional — re-anchors to today’s readiness once it’s ready)'}
```

and the same qualifier on the "Currently …" string below it.

- [ ] **Step 2: Verify on the dev server**

`pnpm dev`, open `http://localhost:3000/` at ≤640px, expand the Body Battery card. Expected: the
"Started at N from …" line renders, and the provisional note appears only when the seeded dev data
has no derived readiness row for today.

Check both themes — the card's text uses theme tokens, so no colour work is needed, but confirm the
longer string doesn't wrap badly at 360px.

- [ ] **Step 3: Commit**

```bash
git add components/body-battery-card.tsx
git commit -m "Mark a pre-readiness Body Battery anchor as provisional

The number legitimately moves once today's readiness lands; saying so is the
difference between an explained change and an unexplained one."
```

**Deliberately not doing:** unifying the two scores so Body Battery never anchors on readiness at
all. Readiness is a composite that already folds in sleep, HRV and RHR, so the two Home numbers are
inherently close — that is a modelling question (what should a battery anchor *mean*?), not a bug,
and it belongs in a separate design pass. Extracting the readiness composite into a shared function
so Body Battery could compute it inline instead of falling back is the clean long-term fix; the
readiness route is ~800 lines of inline computation and that refactor is its own project. Both are
recorded as follow-ups.

---

## Workstream D — the prescription vanishes when a phase transition is accepted

**Branch:** `fix/prescription-phase-transition-regen`

`advancePhase` nulls the prescription and sets status `'none'`. The pre-workout screen renders the
card only when `state.prescription` exists, and its "Preparing your AI workout…" placeholder — plus
the bounded poll and the client-side regeneration trigger — are all keyed on
`isAiPrescriptionPending`, which means `prescriptionStatus === 'consumed'`. `'none'` matches none of
it, so the screen goes blank with nothing driving recovery. The regeneration is a server self-fetch,
which this codebase already documents as unreliable in production.

Two changes, both small, both reusing machinery that already exists.

### Task D1: Leave the slot in the state the UI already understands

**Files:**
- Modify: `app/api/ai-periodization/session/[sessionId]/transition/route.ts:56-66`
- Test: Create `app/api/ai-periodization/__tests__/transition-status.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/api/ai-periodization/__tests__/transition-status.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isAiPrescriptionPending } from '@trainingai/shared/ai-periodization/prescription-pending'
import { POST_TRANSITION_STATUS } from '../session/[sessionId]/transition/status'

describe('the status a phase transition leaves behind', () => {
  // advancePhase clears the prescription. Whatever status is written must make
  // isAiPrescriptionPending true, or the pre-workout screen shows nothing at all: no card
  // (prescription is null), no "Preparing" placeholder, no poll, no regeneration trigger
  // (owner report, 2026-08-02).
  it('keeps the slot in the regenerating state', () => {
    expect(isAiPrescriptionPending(
      { prescription: null, prescriptionStatus: POST_TRANSITION_STATUS },
      { isAiDynamic: true, isBaselinePhase: false },
    )).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/api/ai-periodization/__tests__/transition-status.test.ts`
Expected: FAIL — `Cannot find module '../session/[sessionId]/transition/status'`.

- [ ] **Step 3: Add the named constant and use it**

Create `app/api/ai-periodization/session/[sessionId]/transition/status.ts`:

```ts
import type { PrescriptionStatus } from '@trainingai/shared/types/ai-periodization'

/**
 * The prescription status a completed phase transition leaves behind.
 *
 * `'consumed'` — not `'none'` — because `isAiPrescriptionPending` keys on exactly this value, and
 * it is what drives the pre-workout "Preparing your AI workout…" state, the bounded regeneration
 * poll, and the client-side /prescribe trigger. `'none'` matched none of them, so accepting a
 * transition emptied the card with nothing left to refill it (owner report, 2026-08-02).
 */
export const POST_TRANSITION_STATUS: PrescriptionStatus = 'consumed'
```

In `transition/route.ts`, import it and replace the status write:

```ts
import { POST_TRANSITION_STATUS } from './status'
```

```ts
  await repo.advancePhase(userId, sessionId, body.newPhase as PeriodizationPhase)
  await repo.updatePrescriptionStatus(userId, sessionId, POST_TRANSITION_STATUS)
  const updated = await repo.getSessionPeriodization(userId, sessionId)
```

- [ ] **Step 4: Drop the unreliable server self-fetch**

Delete the fire-and-forget `fetch(`${origin}/api/ai-periodization/session/${sessionId}/prescribe`…)`
block and the now-unused `const origin = req.nextUrl.origin`, replacing them with:

```ts
  // Regeneration is fired by the CLIENT (see ai-prescription-card.tsx's executeTransition) — a
  // container→own-origin self-fetch is unreliable in prod, which is exactly why the open-time and
  // completion-time triggers already moved client-side (workout-screen.tsx). The slot is left in
  // POST_TRANSITION_STATUS, so even if that call is lost the pre-workout screen's existing poll
  // and prescribe trigger recover it on the next open.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run app/api/ai-periodization/__tests__/transition-status.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/ai-periodization/session/\[sessionId\]/transition/status.ts app/api/ai-periodization/session/\[sessionId\]/transition/route.ts app/api/ai-periodization/__tests__/transition-status.test.ts
git commit -m "Leave a phase transition in the regenerating state, not an empty one

advancePhase clears the prescription and the route wrote status 'none', which
matches nothing the pre-workout screen watches — no placeholder, no poll, no
regeneration trigger. Accepting a transition therefore emptied the card
permanently. Also drop the server self-fetch regeneration, which this codebase
already documents as unreliable in production."
```

### Task D2: Fire the regeneration from the client

**Files:**
- Modify: `components/workout/ai-prescription-card.tsx:103-120`

- [ ] **Step 1: Fire `/prescribe` after the transition succeeds**

```ts
  async function executeTransition(newPhase: PeriodizationPhase) {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai-periodization/session/${sessionId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPhase }),
      });
      if (!res.ok) {
        toast.error("Couldn't start transition — try again");
        return;
      }
      await invalidatePrescriptionChanged(sessionId);
      // Client-fired regeneration, same reliability reasoning as the open-time and
      // completion-time triggers in workout-screen.tsx. Fire-and-forget: the slot is left in
      // the pending state server-side, so the pre-workout poll recovers it if this is lost.
      fetch(`/api/ai-periodization/session/${sessionId}/prescribe`, { method: 'POST' })
        .then(r => { if (r.ok) invalidatePrescriptionChanged(sessionId).catch(() => {}); })
        .catch(() => {});
      onPhaseChanged?.();
    } finally {
      setLoading(false);
    }
  }
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 3: Verify the whole flow on the dev server**

`pnpm dev`. This needs an `ai_dynamic` program with a pending transition-recommended prescription;
seed one directly:

```bash
psql "postgresql://postgres:postgres@localhost:5433/trainingai_dev" -c "
  update session_periodization
  set prescription = jsonb_set(prescription, '{phaseAction}', '\"transition_recommended\"'),
      prescription_status = 'pending'
  where prescription is not null;"
```

Open `http://localhost:3000/workout` at ≤640px, expand the AI Prescription card, tap
**Move to Intensification**.

Expected (this is the regression under test): the card does **not** vanish into nothing — the screen
shows **"Preparing your AI workout…"**, and a fresh prescription for the new phase appears when
generation lands.
Broken outcome (the bug): the card and everything under it disappear with no placeholder.

- [ ] **Step 4: Commit**

```bash
git add components/workout/ai-prescription-card.tsx
git commit -m "Fire prescription regeneration client-side after a phase transition"
```

---

## Workstream E — the chest-strap card is permanently stuck on "Connecting…"

**Branch:** `fix/chest-strap-link-status`

The card computes its label from two booleans: `active` (true from app start, because ambient mode
runs all day) and `gattConnected` (`nativeState === 'ready'`). Every other native state — `idle`,
`connecting`, `disconnected`, `stopped` — collapses into "Connecting…". And the native service, after
exhausting its backoff ladder, calls `stopSelf()` without emitting a final status, so JS is stuck on
the last-seen state forever.

> **Split:** Task E1/E2 are JS/TS and ship through Railway with no rebuild. **Task E3 is Kotlin and
> requires an owner APK rebuild** (`npx cap sync android && ./gradlew assembleDebug`) — the sandbox
> has no Android SDK. E1/E2 are useful without E3 (the label stops lying about `idle`/`stopped` it
> can already see); E3 closes the specific "gave up and said nothing" hole.

### Task E1: Surface the real link state, not a boolean pair

**Files:**
- Modify: `lib/live-hr/chest-strap-source.ts:57-74,104-107`
- Test: Create `lib/live-hr/__tests__/strap-link-label.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/live-hr/__tests__/strap-link-label.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { strapLinkLabel } from '../strap-link-label'

describe('strapLinkLabel', () => {
  it('reports a live, worn link', () => {
    expect(strapLinkLabel({ gattConnected: true, worn: true, active: true, state: 'ready' }))
      .toBe('Connected · on your chest')
  })

  it('explains a linked but unworn strap', () => {
    expect(strapLinkLabel({ gattConnected: true, worn: false, active: true, state: 'ready' }))
      .toBe('Connected · no chest contact (ring takes over)')
  })

  it('says connecting only while a connection is genuinely in progress', () => {
    expect(strapLinkLabel({ gattConnected: false, worn: true, active: true, state: 'connecting' }))
      .toBe('Connecting…')
    expect(strapLinkLabel({ gattConnected: false, worn: true, active: true, state: 'preparing' }))
      .toBe('Connecting…')
  })

  // The bug: every non-ready state read as "Connecting…" forever, including after the native
  // service had given up entirely (owner report, 2026-08-02).
  it('says retrying while the service is between attempts', () => {
    expect(strapLinkLabel({ gattConnected: false, worn: true, active: true, state: 'disconnected' }))
      .toBe('Strap not reachable — retrying')
  })

  it('says not connected once the service has stopped', () => {
    expect(strapLinkLabel({ gattConnected: false, worn: true, active: true, state: 'stopped' }))
      .toBe('Not connected — tap Connect, or it connects during workouts')
  })

  it('says not connected when nothing is running at all', () => {
    expect(strapLinkLabel({ gattConnected: false, worn: true, active: false, state: 'stopped' }))
      .toBe('Not connected — tap Connect, or it connects during workouts')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/live-hr/__tests__/strap-link-label.test.ts`
Expected: FAIL — `Cannot find module '../strap-link-label'`.

- [ ] **Step 3: Add `state` to `StrapLinkStatus` and write the label function**

In `lib/live-hr/chest-strap-source.ts`, extend the interface:

```ts
export interface StrapLinkStatus {
  /** Raw GATT truth — NOT the worn-gated view the manager sees. */
  gattConnected: boolean
  /** Sensor-contact state (false = clipped in but not on the chest). */
  worn: boolean
  /** True between start() and stop() — i.e. the app is actively trying to use the strap. */
  active: boolean
  /**
   * The native foreground service's own state, or 'stopped' on the in-WebView fallback path.
   * `gattConnected`+`active` alone cannot tell "connecting" from "gave up" — which is why the
   * card read "Connecting…" permanently (2026-08-02).
   */
  state: StrapState
}

export type StrapState = 'stopped' | 'idle' | 'connecting' | 'preparing' | 'ready' | 'closed' | 'disconnected'
```

Update the two producers:

```ts
export function getChestStrapLinkStatus(): StrapLinkStatus {
  return lastInstance?.linkStatus() ?? { gattConnected: false, worn: true, active: false, state: 'stopped' }
}
```

```ts
  linkStatus(): StrapLinkStatus {
    const gattConnected = this.nativePlugin ? this.nativeState === 'ready' : this.gattConnected
    // The in-WebView fallback path has no service state machine — map its one bit onto the
    // same vocabulary so the label function has a single input shape.
    const state: StrapState = this.nativePlugin
      ? (this.nativeState as StrapState)
      : this.gattConnected ? 'ready' : this.started ? 'connecting' : 'stopped'
    return { gattConnected, worn: this.worn, active: this.active, state }
  }
```

Create `lib/live-hr/strap-link-label.ts`:

```ts
import type { StrapLinkStatus } from './chest-strap-source'

/**
 * What the pairing card says about the strap link.
 *
 * Kept out of the component and unit-tested because the previous inline version derived the
 * label from `gattConnected` and `active` alone: `active` is true from app start (ambient mode
 * runs all day), so EVERY non-ready state — including a service that had exhausted its retries
 * and stopped — rendered as "Connecting…" indefinitely (owner report, 2026-08-02).
 */
export function strapLinkLabel(link: StrapLinkStatus): string {
  if (link.gattConnected) {
    return link.worn
      ? 'Connected · on your chest'
      : 'Connected · no chest contact (ring takes over)'
  }
  if (!link.active) return 'Not connected — tap Connect, or it connects during workouts'
  switch (link.state) {
    case 'connecting':
    case 'preparing':
      return 'Connecting…'
    case 'idle':
    case 'disconnected':
    case 'closed':
      return 'Strap not reachable — retrying'
    default:
      return 'Not connected — tap Connect, or it connects during workouts'
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/live-hr/__tests__/strap-link-label.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/live-hr/chest-strap-source.ts lib/live-hr/strap-link-label.ts lib/live-hr/__tests__/strap-link-label.test.ts
git commit -m "Derive the strap link label from the service state, not two booleans

Ambient mode keeps 'active' true all day, so every non-ready state collapsed
into 'Connecting…' — including a service that had already given up."
```

### Task E2: Use the label, and add a manual reconnect

Today the only way to retry a strap the service has given up on is to restart the app.

**Files:**
- Modify: `components/settings/chest-strap-pairing.tsx:6-7,34-38,73-113`

- [ ] **Step 1: Use the shared label**

Replace the inline `linkLabel` computation with:

```ts
import { strapLinkLabel } from '@/lib/live-hr/strap-link-label'
```

```ts
  const linkLabel = strapLinkLabel(link)
```

and update the default state passed to `useState`:

```ts
  const [link, setLink] = useState<StrapLinkStatus>({ gattConnected: false, worn: true, active: false, state: 'stopped' })
```

- [ ] **Step 2: Add the reconnect action**

Add the handler above the `return`:

```ts
  const [reconnecting, setReconnecting] = useState(false)

  // The native service stops itself after exhausting its backoff ladder (~4 min) on the
  // reasoning that an unreachable strap usually just isn't being worn. Before this, the only
  // way to get it back was to restart the app.
  async function reconnect() {
    setReconnecting(true)
    setError(null)
    try {
      const { getPolarBle } = await import('@/lib/polar-ble/plugin')
      const native = await getPolarBle()
      if (!native) { setError('Strap connection is only available in the app.'); return }
      await native.plugin.ensurePermissions()
      await native.plugin.startService()
      setLink(getChestStrapLinkStatus())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the strap connection.')
    } finally {
      setReconnecting(false)
    }
  }
```

and render it next to **Forget**, only when the link is down:

```tsx
          <div className="flex items-center justify-between">
            <span className="text-sm">{paired.name}</span>
            <div className="flex items-center gap-2">
              {!link.gattConnected && (
                <Button variant="outline" size="sm" onClick={reconnect} disabled={reconnecting}>
                  {reconnecting ? 'Connecting…' : 'Connect'}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={forget}>Forget</Button>
            </div>
          </div>
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 4: Verify on the dev server**

`pnpm dev`, open `http://localhost:3000/more` → Profile at ≤640px. The web build has no paired
strap and no native plugin, so the card renders its **Pair a heart-rate strap** state — confirm it
still renders and that nothing throws. The connected/retrying labels are device-only; they are
covered by the unit tests above and by the device run below.

- [ ] **Step 5: Commit**

```bash
git add components/settings/chest-strap-pairing.tsx
git commit -m "Show the strap's real link state and offer a manual reconnect

The service stops itself after ~4 minutes of failed attempts; until now the only
way to get it back was restarting the app."
```

### Task E3 (Kotlin — needs an owner APK rebuild): announce "stopped" before dying

**Files:**
- Modify: `android/app/src/main/java/com/trainingai/app/polar/PolarStrapService.kt:157-171,120-128`

- [ ] **Step 1: Emit a final status when the service gives up**

In `scheduleRetry()`:

```kotlin
    private fun scheduleRetry() {
        if (stopped) return
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            log("giving up after $consecutiveFailures consecutive failures — strap not reachable, stopping (ring covers HR)")
            // Tell JS before dying. Without this the WebView keeps its last-seen state
            // ("disconnected") forever and the pairing card reads "Connecting…" indefinitely
            // while nothing is connecting (owner report, 2026-08-02).
            state = "stopped"
            emitStatus()
            stopSelf()
            return
        }
```

- [ ] **Step 2: Emit it on any other teardown too**

In `onDestroy()`, before `super.onDestroy()`:

```kotlin
    override fun onDestroy() {
        stopped = true
        state = "stopped"
        emitStatus()
        main.removeCallbacksAndMessages(null)
        flush() // best-effort final flush
        ingest.shutdownNow()
        client?.close(); client = null
        instance = null
        super.onDestroy()
    }
```

- [ ] **Step 3: Compile-gate**

Run: `cd android && ./gradlew compileDebugKotlin`
Expected: BUILD SUCCESSFUL. **If Gradle cannot download its dependencies** (the sandbox proxy
blocks it), say so explicitly in the PR rather than claiming it compiled — this is a known sandbox
limitation, not a reason to skip stating it.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/com/trainingai/app/polar/PolarStrapService.kt
git commit -m "Emit a final strap status before the service stops itself

The service gives up after ~4 minutes of failed attempts and died silently, so
the WebView held its last-seen state forever and the card claimed it was still
connecting."
```

- [ ] **Step 5: Owner device verification**

Rebuild (`npx cap sync android && ./gradlew assembleDebug`), sideload, then with the strap **off the
chest and out of range**, open More → Profile. Expected within ~4 minutes: the label moves
`Connecting…` → `Strap not reachable — retrying` → `Not connected — tap Connect…`, and the
**Connect** button appears. Put the strap on and tap **Connect**: expected `Connected · on your
chest`.

---

## Sequencing, risk and merge policy

| Order | Workstream | Ships without a rebuild? | Merge gate |
|---|---|---|---|
| 1 | A — activity payload | Yes (server + JS) | Standard: green CI + `pnpm dev` pass. Not destructive. |
| 2 | B — local SQLite init | JS only, but **device-verified** | Needs the on-device smoke run **or** a Known-Issues row. Highest blast radius in the batch. |
| 3 | C — battery anchor | Yes | Standard. |
| 4 | D — phase transition | Yes | Standard. |
| 5 | E1/E2 — strap label | Yes | Standard. |
| 6 | E3 — Kotlin | **No — owner rebuild** | Compile-gate only in the sandbox; state that plainly. |

None of the five is destructive or irreversible (no data-dropping migration, no auth/session change,
no secret handling), so per CLAUDE.md each merges without a confirmation gate once CI is green **and**
the tested bar is met — with B's device gate being the one real constraint.

Every PR that changes user-visible behaviour bumps `package.json` (patch — these are all bug fixes)
and adds a `packages/shared/src/changelog.ts` entry, in the same PR, written last.

## Follow-ups this plan deliberately does not do

All are queued (No orphaned findings): items 1–4 as backlog **Q-41**, item 5 as **Q-42**, item 6
fixed inline in the docs PR that landed this plan.

1. **The training calendar cannot show an unsynced activity.** `getCalendarData` reads `activity_logs`
   from Postgres, so a locally-saved activity is invisible there until it syncs — the same
   sanctioned-exception shape as `home-day-timeline`. Workstream A removes the reason it was stuck,
   but the structural gap remains.
2. **Runs and walks never store `avgHr`/`maxHr` on the activity row.** `done-activity-screen.tsx:170`
   populates them only for `activityType === 'treadmill'`; every GPS run/walk writes null despite HR
   being collected live.
3. **`distanceKm: z.number().positive()` rejects a legitimate zero-distance GPS activity.** A route
   with ≥2 points that never moved computes exactly `0`, which `omitNullFields` does not strip and
   `.positive()` rejects — the same whole-payload rejection class as this batch's segment bug.
4. **`cadenceSpm`'s floor of 60 spm is untested against real slow-walk data.** A sub-60 mean would
   reject the whole payload identically.
5. **Extract the readiness composite into a shared function** so Body Battery can compute today's
   readiness rather than falling back to the sleep score at all (see Workstream C's note).
6. **The backlog's "Local SQLite is at v20" line is stale** — `lib/sqlite/__tests__/migrations.test.ts`
   asserts v21. Correct it in the docs PR that lands this plan.

## Testing summary

```bash
# Per-workstream
npx vitest run packages/shared/src/validation/__tests__/plausibility.test.ts   # A
npx vitest run lib/walk/__tests__/segment-stats.test.ts                        # A
npx vitest run lib/data/postgres/__tests__/push-error-detail.test.ts           # A
npx vitest run lib/sqlite/__tests__/migrations.test.ts                         # B
npx vitest run app/api/body-battery/__tests__/anchor-stability.test.ts         # C
npx vitest run app/api/ai-periodization/__tests__/transition-status.test.ts    # D
npx vitest run lib/live-hr/__tests__/strap-link-label.test.ts                  # E

# Full gate before any PR
pnpm lint && npx tsc --noEmit && npx vitest run
```

Stop `pnpm dev` before a full `vitest run` — a running dev server oversubscribes the local Postgres
and the Oura DB-backed files are the usual casualties. Re-run any failing
`lib/data/postgres/__tests__/*` file **alone** before reporting it as broken.

## Failure surfaces this plan cannot exercise

Stated up front so no PR from it claims more than it verified:

- **Native SQLite / Capacitor plugins** — `getLocalStore` returns `null` in the sandbox, so every
  behaviour in Workstream B is unverifiable here. Device run required.
- **The Polar foreground service** — no Android SDK; Gradle downloads are proxy-blocked. Kotlin is
  compile-gated at best, and the retry/stop lifecycle in E3 is device-only.
- **Samsung WebView rendering** — the label and button changes in E2 render in Chromium here only.
- **Drifted production data** — the local dev DB is freshly seeded, so a Body Battery anchor path
  that depends on a real `oura_daily_derived` row's presence/absence over a day cannot be
  reproduced; C's logic is covered by unit tests on the pure function instead.
- **Safe-area insets** — none of these tasks adds a bottom-anchored control, so the floored-utility
  rule is not engaged. The one new button (E2's **Connect**) sits inline in an existing card.
