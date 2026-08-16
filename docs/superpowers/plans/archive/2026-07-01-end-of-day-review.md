# End of Day Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the end-of-night `MealBackfillSheet` with an offline-first "End of Day" review: day summary + Body Battery, per-meal food backfill, a set of pre-filled 1–5 wellness scales, and a journal — all captured to a new `day_checkins` domain whose on-device SQLite table is the source of truth.

**Architecture:** New offline-first domain `day_checkins` mirroring the existing `mood_logs` / `food_items` plumbing exactly (server Postgres table + Drizzle schema + a local SQLite table + outbox `queueMutation` + `pushMutations` adapter branch + `getSyncDelta`/`pullDelta`/`applyDelta` + `/api/sync/push` domain). A pure pre-fill helper derives each scale's default from existing signals; a pure insight helper builds a deterministic today-only summary. The UI is a bottom-sheet composed of small section components, reusing the existing offline `logFoodEntries` for meal backfill and the existing muscle-group picker for soreness.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, Drizzle ORM (Postgres), `@capacitor-community/sqlite` local store, Tailwind v4 + shadcn/ui Sheet, Vitest.

**Reference pattern (read these first — the merged offline-first food work is the template):**
- Local table + migration: `lib/sqlite/migrations.ts` (`food_items` at `toVersion: 10`, activity cols at `toVersion: 11`, plus `RECONCILE_TABLES` / `RECONCILE_COLUMNS`).
- Local types: `lib/local-store/types.ts` (`LocalFoodItem`, `PendingMutation.domain` union).
- Store interface + impl: `lib/local-store/index.ts`, `lib/local-store/sqlite-backend.ts` (`upsertFoodItem`, `applyDelta` foodItems branch, `clearLocalStoreData`).
- Sync push: `app/api/sync/push/route.ts` + `lib/data/postgres/adapter.ts` `pushMutations` (`food_logs`/`mood_logs` branches) + `pushMutations` mark-synced loop in `lib/local-store/sync-engine.ts`.
- Sync pull: `adapter.ts` `getSyncDelta`, `lib/data/repository.ts` `SyncDelta`, `sync-engine.ts` `pullDelta` mappers + `applyDelta`.
- Mood check-in UI (energy scale + muscle picker + issue chips): `components/mood-checkin-sheet.tsx` — reuse its `MUSCLE_GROUPS`, chip styling, and save shape.
- Current backfill sheet to replace: `components/nutrition/meal-backfill-sheet.tsx`; trigger in `app/nutrition/nutrition-content.tsx` (`?chat=backfill` → `chatOpen`).
- Body Battery source: `GET /api/body-battery` → `{ current, label: 'Charged'|'Good'|'Low'|'Drained', trend, charged, drained }` (`components/body-battery-card.tsx`).

**DEPENDENCY:** Build on `main` AFTER PR #82 merges (it adds local migrations `v10`/`v11`). The new `day_checkins` local migration is therefore **`toVersion: 12`**. Start by branching fresh: `git fetch origin main && git checkout -B feat/end-of-day-review origin/main`, then re-apply this plan's design spec if missing.

**Design spec:** `docs/superpowers/specs/2026-07-01-end-of-day-review-design.md`

---

## Phase 0 — Types and constants (shared, no deps)

### Task 1: DayCheckin domain types + scale config

**Files:**
- Create: `lib/types/day-checkin.ts`

- [ ] **Step 1: Write the types file**

```ts
// The evening (and, later, morning) wellness check-in captured by the
// End of Day review. All scale fields are 1–5; journal is the only free text.
export type CheckinPhase = 'evening' | 'morning'

export interface DayCheckin {
  id: string
  userId: string
  logDate: string          // YYYY-MM-DD (user's timezone)
  phase: CheckinPhase
  physicalTiredness: number | null // 1 (fresh) … 5 (drained)
  mentalDrain: number | null       // 1 (clear) … 5 (fried)
  barelyMoved: number | null       // 1 (very active) … 5 (sat all day)
  hydration: number | null         // 1 (well hydrated) … 5 (barely drank)
  lateHeavyMeal: number | null     // 1 (none/light early) … 5 (big & late)
  soreMuscles: string[]
  journal: string | null
  createdAt: Date
  updatedAt: Date
}

// The five evening scales, in display order, with their end labels. Drives the
// WellnessSection UI and the pre-fill helper so they never drift apart.
export const EVENING_SCALES = [
  { key: 'physicalTiredness', label: 'Physical tiredness', low: 'Fresh',       high: 'Drained' },
  { key: 'mentalDrain',       label: 'Mental drain',       low: 'Clear',       high: 'Fried' },
  { key: 'barelyMoved',       label: 'Movement',           low: 'Very active', high: 'Barely moved' },
  { key: 'hydration',         label: 'Hydration',          low: 'Well hydrated', high: 'Barely drank' },
  { key: 'lateHeavyMeal',     label: 'Late / heavy meal',  low: 'None / light', high: 'Big & late' },
] as const

export type EveningScaleKey = typeof EVENING_SCALES[number]['key']
```

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit 2>&1 | grep day-checkin || echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add lib/types/day-checkin.ts
git commit -m "feat(day-checkin): domain types + evening scale config"
```

---

## Phase 1 — Server data model

### Task 2: Postgres table + Drizzle schema

**Files:**
- Create: `lib/data/postgres/migrations/1XX_day_checkins.sql` (use the next free number — run `ls lib/data/postgres/migrations | sort | tail -1` to find it)
- Modify: `lib/data/postgres/schema.ts` (add `dayCheckins` table near `moodLogs`)

- [ ] **Step 1: Write the migration SQL**

```sql
-- day_checkins: End of Day (and later Start of Day) wellness check-ins.
-- One row per (user, day, phase). All scale columns are 1–5, nullable so a
-- partial save is valid. journal is the only free text.
CREATE TABLE IF NOT EXISTS day_checkins (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date            DATE NOT NULL,
  phase               TEXT NOT NULL DEFAULT 'evening',
  physical_tiredness  INTEGER,
  mental_drain        INTEGER,
  barely_moved        INTEGER,
  hydration           INTEGER,
  late_heavy_meal     INTEGER,
  sore_muscles        TEXT[] NOT NULL DEFAULT '{}',
  journal             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,
  UNIQUE (user_id, log_date, phase)
);
CREATE INDEX IF NOT EXISTS idx_day_checkins_user_updated ON day_checkins (user_id, updated_at);
```

- [ ] **Step 2: Add the Drizzle table to `schema.ts`** (mirror `moodLogs`)

```ts
export const dayCheckins = pgTable('day_checkins', {
  id:                uuid('id').primaryKey().defaultRandom(),
  userId:            uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  logDate:           date('log_date', { mode: 'string' }).notNull(),
  phase:             text('phase').notNull().default('evening'),
  physicalTiredness: integer('physical_tiredness'),
  mentalDrain:       integer('mental_drain'),
  barelyMoved:       integer('barely_moved'),
  hydration:         integer('hydration'),
  lateHeavyMeal:     integer('late_heavy_meal'),
  soreMuscles:       text('sore_muscles').array().notNull().default([]),
  journal:           text('journal'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:         timestamp('deleted_at', { withTimezone: true }),
}, t => [unique().on(t.userId, t.logDate, t.phase)])
```

- [ ] **Step 3: Apply migration to the local dev DB and verify**

Run: `pnpm db:local && node -e "const{Client}=require('pg');(async()=>{const c=new Client({connectionString:'postgresql://postgres:postgres@localhost:5433/trainingai_dev'});await c.connect();const r=await c.query(\"select column_name from information_schema.columns where table_name='day_checkins' order by 1\");console.log(r.rows.map(x=>x.column_name).join(','));await c.end()})()"`
Expected: prints the column list including `physical_tiredness,journal,phase,...`

- [ ] **Step 4: Commit**

```bash
git add lib/data/postgres/migrations/1XX_day_checkins.sql lib/data/postgres/schema.ts
git commit -m "feat(day-checkin): postgres table + drizzle schema"
```

### Task 3: Repository read + SyncDelta field

**Files:**
- Modify: `lib/data/repository.ts` (add `getDayCheckin` to the interface + `dayCheckins` to `SyncDelta`)
- Modify: `lib/data/postgres/adapter.ts` (implement `getDayCheckin`; add `dayCheckins` to `getSyncDelta`)

- [ ] **Step 1: Add to the `Repository` interface + `SyncDelta`**

```ts
// in SyncDelta (repository.ts):
  dayCheckins?:       unknown[];

// in Repository interface:
  getDayCheckin(userId: string, logDate: string, phase: string): Promise<import('@/lib/types/day-checkin').DayCheckin | null>;
```

- [ ] **Step 2: Implement `getDayCheckin` in `adapter.ts`** (mirror `getMoodLog`)

```ts
async getDayCheckin(userId: string, logDate: string, phase: string) {
  const [r] = await this.db.select().from(s.dayCheckins)
    .where(and(eq(s.dayCheckins.userId, userId), eq(s.dayCheckins.logDate, logDate),
               eq(s.dayCheckins.phase, phase), isNull(s.dayCheckins.deletedAt)))
    .limit(1)
  if (!r) return null
  return {
    id: r.id, userId: r.userId, logDate: r.logDate, phase: r.phase as 'evening' | 'morning',
    physicalTiredness: r.physicalTiredness, mentalDrain: r.mentalDrain, barelyMoved: r.barelyMoved,
    hydration: r.hydration, lateHeavyMeal: r.lateHeavyMeal, soreMuscles: r.soreMuscles,
    journal: r.journal, createdAt: r.createdAt, updatedAt: r.updatedAt,
  }
}
```

- [ ] **Step 3: Add the `dayCheckins` query to `getSyncDelta`'s `Promise.all` + return object** (mirror the `moodLogs` line)

```ts
// query (add to the Promise.all array):
this.db.select().from(s.dayCheckins)
  .where(and(eq(s.dayCheckins.userId, userId), gt(s.dayCheckins.updatedAt, effectiveSince))),
// destructure it alongside moodLogs, and add `dayCheckins,` to the returned object.
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm tsc --noEmit 2>&1 | grep -E "adapter|repository" || echo OK` → `OK`

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "feat(day-checkin): repository read + sync delta"
```

### Task 4: Sync push (server) branch

**Files:**
- Modify: `app/api/sync/push/route.ts` (add `'day_checkins'` to the `MutationSchema` domain enum)
- Modify: `lib/data/postgres/adapter.ts` `pushMutations` (add a `day_checkins` branch, mirror `mood_logs`)

- [ ] **Step 1: Extend the push domain enum**

```ts
domain: z.enum(['body_metrics','mood_logs','food_logs','supplement_logs','injuries','supplements','activity_logs','workout_log','day_checkins']),
```

- [ ] **Step 2: Add the `pushMutations` branch** (upsert on the unique key; ownership is implicit via userId)

```ts
} else if (mut.domain === 'day_checkins') {
  const p = clean as Record<string, unknown>
  const num = (v: unknown) => typeof v === 'number' ? v : null
  await this.db.insert(s.dayCheckins).values({
    userId, logDate: mut.date, phase: typeof p.phase === 'string' ? p.phase : 'evening',
    physicalTiredness: num(p.physicalTiredness), mentalDrain: num(p.mentalDrain),
    barelyMoved: num(p.barelyMoved), hydration: num(p.hydration), lateHeavyMeal: num(p.lateHeavyMeal),
    soreMuscles: Array.isArray(p.soreMuscles) ? p.soreMuscles as string[] : [],
    journal: typeof p.journal === 'string' ? p.journal : null,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [s.dayCheckins.userId, s.dayCheckins.logDate, s.dayCheckins.phase],
    set: {
      physicalTiredness: num(p.physicalTiredness), mentalDrain: num(p.mentalDrain),
      barelyMoved: num(p.barelyMoved), hydration: num(p.hydration), lateHeavyMeal: num(p.lateHeavyMeal),
      soreMuscles: Array.isArray(p.soreMuscles) ? p.soreMuscles as string[] : [],
      journal: typeof p.journal === 'string' ? p.journal : null, updatedAt: new Date(),
    },
  })
  processed++
}
```

- [ ] **Step 3: Reproduce round-trip against the local dev DB** (proves push persists)

Run a script mirroring `scratchpad/split_test.mjs` from the food work: auth, POST `/api/sync/push` with a `day_checkins` mutation, then read it back via a temporary `GET /api/day-checkin?date=...` (Task 6) — or query the DB directly with the pg snippet from Task 2 Step 3.
Expected: `{"processed":1,"errors":[]}` and the row present.

- [ ] **Step 4: Commit**

```bash
git add app/api/sync/push/route.ts lib/data/postgres/adapter.ts
git commit -m "feat(day-checkin): server sync push branch"
```

---

## Phase 2 — Local store (offline source of truth)

### Task 5: Local table, type, store methods, sync mappers

**Files:**
- Modify: `lib/sqlite/migrations.ts` (add `toVersion: 12` creating `day_checkins`; add to `RECONCILE_TABLES`)
- Modify: `lib/local-store/types.ts` (`LocalDayCheckin`; add `'day_checkins'` to `PendingMutation.domain`)
- Modify: `lib/local-store/index.ts` (interface: `getDayCheckin`, `upsertDayCheckin`; `applyDelta` gains `dayCheckins?`)
- Modify: `lib/local-store/sqlite-backend.ts` (implement + `applyDelta` branch + `clearLocalStoreData` note)
- Modify: `lib/local-store/index.ts` `clearLocalStoreData` (add `DELETE FROM day_checkins`)
- Modify: `lib/local-store/sync-engine.ts` (`pullDelta` mapper + mark-synced branch)

- [ ] **Step 1: Local migration v12 + reconcile** (mirror `CREATE_FOOD_ITEMS`)

```ts
const CREATE_DAY_CHECKINS = `CREATE TABLE IF NOT EXISTS day_checkins (
  log_date            TEXT NOT NULL,
  phase               TEXT NOT NULL DEFAULT 'evening',
  physical_tiredness  INTEGER,
  mental_drain        INTEGER,
  barely_moved        INTEGER,
  hydration           INTEGER,
  late_heavy_meal     INTEGER,
  sore_muscles        TEXT NOT NULL DEFAULT '[]',
  journal             TEXT,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT,
  sync_status         TEXT NOT NULL DEFAULT 'pending',
  PRIMARY KEY (log_date, phase)
)`;
// add CREATE_DAY_CHECKINS to RECONCILE_TABLES, and:
{ toVersion: 12, statements: [ CREATE_DAY_CHECKINS ] },
```

- [ ] **Step 2: `LocalDayCheckin` type + outbox domain**

```ts
export interface LocalDayCheckin {
  logDate: string; phase: string;
  physicalTiredness: number | null; mentalDrain: number | null; barelyMoved: number | null;
  hydration: number | null; lateHeavyMeal: number | null;
  soreMuscles: string[]; journal: string | null;
  updatedAt: string; deletedAt: string | null; syncStatus: 'pending' | 'synced';
}
// PendingMutation.domain union: add | 'day_checkins'
```

- [ ] **Step 3: Store interface additions** (`index.ts`)

```ts
getDayCheckin(logDate: string, phase: string): Promise<LocalDayCheckin | null>;
upsertDayCheckin(record: LocalDayCheckin): Promise<void>;
// applyDelta delta object: add `dayCheckins?: LocalDayCheckin[];`
```

- [ ] **Step 4: Backend impl** (`sqlite-backend.ts`; `sore_muscles` stored as JSON text like `mood_logs`)

```ts
async getDayCheckin(logDate: string, phase: string): Promise<LocalDayCheckin | null> {
  const rows = await querySQL<Record<string, unknown>>(
    `SELECT * FROM day_checkins WHERE log_date=? AND phase=? AND deleted_at IS NULL`, [logDate, phase])
  const r = rows[0]; if (!r) return null
  return {
    logDate: String(r.log_date), phase: String(r.phase),
    physicalTiredness: (r.physical_tiredness as number) ?? null, mentalDrain: (r.mental_drain as number) ?? null,
    barelyMoved: (r.barely_moved as number) ?? null, hydration: (r.hydration as number) ?? null,
    lateHeavyMeal: (r.late_heavy_meal as number) ?? null,
    soreMuscles: JSON.parse(String(r.sore_muscles ?? '[]')), journal: r.journal ? String(r.journal) : null,
    updatedAt: String(r.updated_at), deletedAt: r.deleted_at ? String(r.deleted_at) : null,
    syncStatus: String(r.sync_status) as 'pending' | 'synced',
  }
}
async upsertDayCheckin(record: LocalDayCheckin): Promise<void> {
  await runSQL(
    `INSERT INTO day_checkins (log_date, phase, physical_tiredness, mental_drain, barely_moved,
       hydration, late_heavy_meal, sore_muscles, journal, updated_at, deleted_at, sync_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(log_date, phase) DO UPDATE SET
       physical_tiredness=excluded.physical_tiredness, mental_drain=excluded.mental_drain,
       barely_moved=excluded.barely_moved, hydration=excluded.hydration,
       late_heavy_meal=excluded.late_heavy_meal, sore_muscles=excluded.sore_muscles,
       journal=excluded.journal, updated_at=excluded.updated_at,
       deleted_at=excluded.deleted_at, sync_status=excluded.sync_status`,
    [record.logDate, record.phase, record.physicalTiredness, record.mentalDrain, record.barelyMoved,
     record.hydration, record.lateHeavyMeal, JSON.stringify(record.soreMuscles), record.journal,
     record.updatedAt, record.deletedAt, record.syncStatus])
}
// applyDelta: for (const r of delta.dayCheckins ?? []) { const ex = await querySQL(`SELECT sync_status FROM day_checkins WHERE log_date=? AND phase=?`,[r.logDate,r.phase]); if(!ex.length||ex[0].sync_status==='synced') await this.upsertDayCheckin({...r, syncStatus:'synced'}) }
```

- [ ] **Step 5: `clearLocalStoreData` — add `runSQL('DELETE FROM day_checkins', [])`** (prevents cross-user leak, per the food_items lesson).

- [ ] **Step 6: `sync-engine.ts` — `pullDelta` mapper + mark-synced branch**

```ts
// mapper (build `dayCheckins`, pass into applyDelta):
const dayCheckins = ((raw.dayCheckins ?? []) as Record<string, unknown>[]).map(r => ({
  logDate: String(r.logDate), phase: String(r.phase ?? 'evening'),
  physicalTiredness: (r.physicalTiredness as number) ?? null, mentalDrain: (r.mentalDrain as number) ?? null,
  barelyMoved: (r.barelyMoved as number) ?? null, hydration: (r.hydration as number) ?? null,
  lateHeavyMeal: (r.lateHeavyMeal as number) ?? null,
  soreMuscles: (r.soreMuscles as string[]) ?? [], journal: r.journal ? String(r.journal) : null,
  updatedAt: toIso(r.updatedAt), deletedAt: r.deletedAt ? toIso(r.deletedAt) : null, syncStatus: 'synced' as const,
} satisfies LocalDayCheckin))
// mark-synced loop: else if (m.domain === 'day_checkins') { const recs = await store.getDayCheckin(m.date, String(m.payload.phase ?? 'evening')); if (recs) await store.upsertDayCheckin({ ...recs, syncStatus: 'synced' }) }
```

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm tsc --noEmit 2>&1 | grep -v web-push | head` → no errors

```bash
git add lib/sqlite/migrations.ts lib/local-store/
git commit -m "feat(day-checkin): local table, store methods, sync mappers"
```

---

## Phase 3 — API route (hydration + web fallback)

### Task 6: `GET`/`POST /api/day-checkin`

**Files:**
- Create: `app/api/day-checkin/route.ts`

- [ ] **Step 1: Write the route** (GET reads today's row for hydration/web; POST is the web fallback save)

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { z } from 'zod'
import { todayInTz, DEFAULT_TZ } from '@/lib/date-utils'

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  phase: z.enum(['evening','morning']).default('evening'),
  physicalTiredness: z.number().int().min(1).max(5).nullable().optional(),
  mentalDrain: z.number().int().min(1).max(5).nullable().optional(),
  barelyMoved: z.number().int().min(1).max(5).nullable().optional(),
  hydration: z.number().int().min(1).max(5).nullable().optional(),
  lateHeavyMeal: z.number().int().min(1).max(5).nullable().optional(),
  soreMuscles: z.array(z.string()).default([]),
  journal: z.string().max(2000).nullable().optional(),
})

export async function GET(req: Request) {
  const session = await auth(); const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const date = url.searchParams.get('date') ?? todayInTz(session.user?.timezone ?? DEFAULT_TZ)
  const phase = url.searchParams.get('phase') ?? 'evening'
  const repo = await getRepository()
  return NextResponse.json(await repo.getDayCheckin(userId, date, phase))
}

export async function POST(req: Request) {
  const session = await auth(); const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const b = parsed.data
  const date = b.date ?? todayInTz(session.user?.timezone ?? DEFAULT_TZ)
  const repo = await getRepository()
  // Reuse the same upsert as sync-push via a repo method (add saveDayCheckin mirroring saveMoodLog).
  const saved = await repo.saveDayCheckin(userId, { logDate: date, phase: b.phase,
    physicalTiredness: b.physicalTiredness ?? null, mentalDrain: b.mentalDrain ?? null,
    barelyMoved: b.barelyMoved ?? null, hydration: b.hydration ?? null, lateHeavyMeal: b.lateHeavyMeal ?? null,
    soreMuscles: b.soreMuscles, journal: b.journal ?? null })
  return NextResponse.json(saved, { status: 201 })
}
```

- [ ] **Step 2: Add `saveDayCheckin` to the repository interface + adapter** (extract the upsert from Task 4 Step 2 into a shared method the push branch also calls — DRY).

- [ ] **Step 3: Smoke it on the dev server** (`pnpm dev`, auth, POST then GET) — expect the row back.

- [ ] **Step 4: Commit**

```bash
git add app/api/day-checkin/ lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "feat(day-checkin): GET/POST api route + saveDayCheckin repo method"
```

---

## Phase 4 — Pure helpers (TDD)

### Task 7: Smart pre-fill helper

**Files:**
- Create: `lib/nutrition/day-checkin-prefill.ts`
- Test: `lib/nutrition/__tests__/day-checkin-prefill.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { prefillEveningScales } from '../day-checkin-prefill'

describe('prefillEveningScales', () => {
  it('maps Body Battery label to physical tiredness (Drained→5, Charged→1)', () => {
    expect(prefillEveningScales({ batteryLabel: 'Drained' }).physicalTiredness).toBe(5)
    expect(prefillEveningScales({ batteryLabel: 'Charged' }).physicalTiredness).toBe(1)
    expect(prefillEveningScales({ batteryLabel: 'Good' }).physicalTiredness).toBe(2)
  })
  it('maps low steps to a high "barely moved" score', () => {
    expect(prefillEveningScales({ steps: 800 }).barelyMoved).toBe(5)
    expect(prefillEveningScales({ steps: 12000 }).barelyMoved).toBe(1)
  })
  it('infers late/heavy meal from last-meal minutes-before-bed', () => {
    expect(prefillEveningScales({ lastMealMinutesBeforeBed: 30 }).lateHeavyMeal).toBe(5)
    expect(prefillEveningScales({ lastMealMinutesBeforeBed: 300 }).lateHeavyMeal).toBe(1)
  })
  it('defaults everything to a neutral 3 with no signals', () => {
    const p = prefillEveningScales({})
    expect(p).toEqual({ physicalTiredness: 3, mentalDrain: 3, barelyMoved: 3, hydration: 3, lateHeavyMeal: 3 })
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (`pnpm test day-checkin-prefill` → "prefillEveningScales is not a function").

- [ ] **Step 3: Implement**

```ts
export interface PrefillSignals {
  batteryLabel?: 'Charged' | 'Good' | 'Low' | 'Drained' | null
  steps?: number | null
  waterMl?: number | null
  lastMealMinutesBeforeBed?: number | null
}
const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)))
export function prefillEveningScales(sig: PrefillSignals) {
  const battery = { Charged: 1, Good: 2, Low: 4, Drained: 5 } as const
  return {
    physicalTiredness: sig.batteryLabel ? battery[sig.batteryLabel] : 3,
    mentalDrain: 3, // no reliable signal
    barelyMoved: sig.steps == null ? 3 : clamp(5 - (sig.steps / 12000) * 4),
    hydration: sig.waterMl == null ? 3 : clamp(5 - (sig.waterMl / 2500) * 4),
    lateHeavyMeal: sig.lastMealMinutesBeforeBed == null ? 3
      : clamp(5 - (sig.lastMealMinutesBeforeBed / 300) * 4),
  }
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `git add lib/nutrition/day-checkin-prefill.ts lib/nutrition/__tests__/day-checkin-prefill.test.ts && git commit -m "feat(day-checkin): smart pre-fill helper + tests"`

### Task 8: Deterministic today-insight helper

**Files:**
- Create: `lib/nutrition/day-insight.ts`
- Test: `lib/nutrition/__tests__/day-insight.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildTodayInsight } from '../day-insight'

describe('buildTodayInsight', () => {
  it('summarises the drivers present today', () => {
    const s = buildTodayInsight({ batteryCurrent: 34, batteryDrained: 52,
      scales: { physicalTiredness: 5, mentalDrain: 4, barelyMoved: 1, hydration: 3, lateHeavyMeal: 5 },
      soreMuscles: ['Chest','Shoulders'] })
    expect(s).toContain('34')
    expect(s.toLowerCase()).toContain('late')
    expect(s.toLowerCase()).toContain('sore')
  })
  it('returns a calm message when nothing stands out', () => {
    const s = buildTodayInsight({ batteryCurrent: 78, batteryDrained: 10,
      scales: { physicalTiredness: 2, mentalDrain: 2, barelyMoved: 2, hydration: 2, lateHeavyMeal: 1 },
      soreMuscles: [] })
    expect(s.length).toBeGreaterThan(0)
    expect(s.toLowerCase()).not.toContain('late')
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** (deterministic string builder; no AI)

```ts
interface InsightInput {
  batteryCurrent: number | null; batteryDrained: number | null
  scales: { physicalTiredness: number; mentalDrain: number; barelyMoved: number; hydration: number; lateHeavyMeal: number }
  soreMuscles: string[]
}
export function buildTodayInsight(i: InsightInput): string {
  const parts: string[] = []
  if (i.batteryCurrent != null) parts.push(`Body Battery ${i.batteryCurrent}${i.batteryDrained != null ? ` (down ${i.batteryDrained})` : ''}`)
  if (i.scales.physicalTiredness >= 4) parts.push('physically drained')
  if (i.scales.mentalDrain >= 4) parts.push('mentally taxed')
  if (i.scales.lateHeavyMeal >= 4) parts.push('a late / heavy meal')
  if (i.scales.hydration >= 4) parts.push('low hydration')
  if (i.scales.barelyMoved >= 4) parts.push('very little movement')
  if (i.soreMuscles.length) parts.push(`sore ${i.soreMuscles.slice(0, 3).join(', ').toLowerCase()}`)
  if (parts.length <= 1) return `${parts[0] ?? 'A steady day'} — nothing stands out today.`
  return `Today: ${parts.join(', ')}. Over time we'll learn which of these track with your drained days.`
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `git add lib/nutrition/day-insight.ts lib/nutrition/__tests__/day-insight.test.ts && git commit -m "feat(day-checkin): deterministic today-insight helper + tests"`

---

## Phase 5 — UI components

### Task 9: Reusable 1–5 segmented scale

**Files:**
- Create: `components/nutrition/end-of-day/scale-selector.tsx`

- [ ] **Step 1: Write the component** (5 pill buttons; selected uses brand fill; low/high end labels)

```tsx
'use client'
interface Props { label: string; low: string; high: string; value: number; onChange: (v: number) => void }
export function ScaleSelector({ label, low, high, value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex gap-1.5">
        {[1,2,3,4,5].map(n => (
          <button key={n} type="button" onClick={() => onChange(n)} aria-pressed={value === n}
            className={`flex-1 h-10 rounded-xl text-sm font-semibold border transition ${
              value === n ? 'bg-foreground text-background border-transparent' : 'border-border/60 text-muted-foreground'}`}>
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground"><span>{low}</span><span>{high}</span></div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + commit** `git add components/nutrition/end-of-day/scale-selector.tsx && git commit -m "feat(day-checkin): reusable 1-5 scale selector"`

### Task 10: Section components

**Files:**
- Create: `components/nutrition/end-of-day/day-summary-card.tsx` (props: `totals`, `targets`, `battery` → renders kcal vs target + macro bars + battery pill; read-only)
- Create: `components/nutrition/end-of-day/wellness-section.tsx` (props: `scales`, `onScale`, `soreMuscles`, `onToggleMuscle` → maps `EVENING_SCALES` to `ScaleSelector` + reuses `MUSCLE_GROUPS` chip picker copied from `mood-checkin-sheet.tsx`)
- Create: `components/nutrition/end-of-day/journal-section.tsx` (a labelled `Textarea`; the only free text)
- Create: `components/nutrition/end-of-day/today-insight-card.tsx` (props: `text` from `buildTodayInsight`; brand-tinted card)
- Create: `components/nutrition/end-of-day/meal-backfill-section.tsx` (extract the per-meal AI box list from `meal-backfill-sheet.tsx` — same `scanResultToEntries` + `logFoodEntries` flow, rendered as a section not a sheet)

- [ ] **Step 1–5:** For each file, write the component (props above), typecheck, and commit individually (`git commit -m "feat(day-checkin): <name> section"`). Keep each file focused and under ~120 lines. Match the mockup's sectioned-card styling on the `bg-secondary` sheet surface used by `food-logger-sheet.tsx`.

### Task 11: `EndOfDayReview` sheet orchestrator

**Files:**
- Create: `components/nutrition/end-of-day/end-of-day-review.tsx`

- [ ] **Step 1: Write the orchestrator**
  - Props: `{ open, onClose, mealTypes, logs, date, userId, targets, onLogged }`.
  - On open: fetch `GET /api/body-battery` (for the summary + pre-fill) and read `store.getDayCheckin(date,'evening')` local-first; seed scale state from the saved row if present, else from `prefillEveningScales(signals)` (signals: battery label, today's steps from `logs`/body-metadata, last-meal time vs a bedtime estimate).
  - Compose: `DaySummaryCard`, `MealBackfillSection`, `WellnessSection`, `JournalSection`, `TodayInsightCard` (from `buildTodayInsight` over current state), sticky `SaveBar`.
  - Save: `store.upsertDayCheckin(...)` + `queueMutation({domain:'day_checkins', date, payload})` + `pushMutations`; web fallback `POST /api/day-checkin`. Then `onClose()`.
- [ ] **Step 2: Typecheck + commit.**

---

## Phase 6 — Wire the trigger

### Task 12: Replace MealBackfillSheet with EndOfDayReview

**Files:**
- Modify: `app/nutrition/nutrition-content.tsx` (swap the dynamic import + the `chatOpen` render; add a visible "End of Day review" button near the Saved Meals row; pass `targets` + `logs` + `date` + `userId`)
- Delete: `components/nutrition/meal-backfill-sheet.tsx` **only after** its per-meal logic is fully moved into `meal-backfill-section.tsx` (Task 10).

- [ ] **Step 1: Swap the import/render**, keep the `?chat=backfill` effect opening `EndOfDayReview`.
- [ ] **Step 2: Add the entry button.**
- [ ] **Step 3: `pnpm dev` smoke — open `/nutrition?chat=backfill`**, confirm the review renders with pre-filled scales, log a meal (reuses `logFoodEntries`), set a scale, save; reopen to confirm the saved row loads local-first.
- [ ] **Step 4: Commit** `git commit -m "feat(day-checkin): open End of Day review from backfill trigger + nutrition button"`

---

## Phase 7 — Finalise

### Task 13: Full verification + changelog

- [ ] **Step 1:** `pnpm tsc --noEmit` clean (ignore the unrelated `web-push` line), `pnpm lint` no new warnings, `pnpm test` all pass (includes Tasks 7–8).
- [ ] **Step 2:** Playwright smoke of `/nutrition` (login → open review → no console errors), as in the food work.
- [ ] **Step 3:** Bump `package.json` minor + add a `lib/changelog.ts` entry ("End of Day review: confirm meals, quick wellness check, journal").
- [ ] **Step 4:** Update the spec's status to "implemented (v1)"; tick the roadmap item in `projectOverview.md`.
- [ ] **Step 5:** Commit, push, open PR. **Do NOT auto-merge** — native SQLite (`day_checkins` table, migration v12, offline read/write) only runs on the APK, so require on-device verification: save a check-in, force-close, reopen, confirm it persists offline.

---

## Self-review notes

- **Spec coverage:** DaySummary (Task 10), MealBackfill reuse (Task 10/11), 5 pre-filled scales (Tasks 1,7,9,10), muscle picker (Task 10), journal-only-text (Task 10), deterministic insight (Task 8), offline `day_checkins` end-to-end (Tasks 2–6), trigger replacement (Task 12), v1-only scope with `phase` column reserving the morning mirror (Tasks 1,2,5). ✅
- **Type consistency:** `LocalDayCheckin` (local, no id/userId — per-user store) ↔ `DayCheckin` (server, with id/userId) ↔ scale keys from `EVENING_SCALES` are used identically across pre-fill, UI, and payload.
- **Known deferrals (documented, not built):** Start-of-Day morning phase; real cross-day correlation analytics; adding `day_checkins` to on-device push chunking limits if it ever becomes heavy (it's one row/day — fine).
