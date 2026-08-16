# Health-Data Provenance & Sync Hardening (Track B remainder) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three health-data plumbing gaps left after the direct-BLE pipeline shipped: **(A)** a `source` provenance column + precedence-ranked merge (manual > oura_ble > health_connect) so a lower-priority source can't clobber a higher-priority value; **(B)** promote `sleep_sessions` to a real offline-first domain (today it's a blind server→device pull mirror — a local write has no push path and is clobbered by the next pull); **(C)** harden `POST /api/sync-health` (no Zod, no bounds) against the good ingest-route template.

**Architecture:** Server/JS + local-SQLite only — **no APK-native/Kotlin work**, but Chunk B touches the local SQLite schema (a local migration) so it is **on-device-verification-gated** for its device half. Three **independently-landable chunks**, each its own PR (suffix the branch `-a`/`-b`/`-c`). They share no code and can land in any order; **do Chunk C first** (smallest, fully server-side, zero design questions) as a warm-up, then B, then A (the largest). One Postgres migration (Chunk A, **number 120**) and one local SQLite migration (Chunk B, **version 14**).

**Tech Stack:** TypeScript, Drizzle/Postgres, Zod, the Capacitor SQLite local store (`lib/local-store/`, `lib/sqlite/`), the offline-first sync engine (`getSyncDelta`/`pullDelta`/`applyDelta`/`pushMutations`), vitest.

> **⚠️ SCOPE NOTE for the reviewing agent — split candidate.** Per the writing-plans convention this is three independent subsystems; it is written as one doc for continuity but each chunk is a standalone PR and could be three separate plans. If you'd rather review/merge them independently, treat each `## Chunk` as its own plan.

> **★ Reconciliation (verified 2026-07-11):** PR #422 ("Oura BLE Chunk 4") shipped **zero** provenance work — there is **no `source` column** on `body_metrics`/`sleep_sessions`/`oura_daily` today. The 2026-07-07 data-mapping plan's phrase "provenance… scoped to the fields BLE writes" described work that was **deferred, not shipped**. All three chunks are greenfield; nothing here re-specs merged code.

---

## Runtime reality / verification note

- **Chunk A (provenance):** server + Postgres only. Fully sandbox-verifiable on the local dev DB (`pnpm db:local`) — the merge precedence is DB-backed-testable.
- **Chunk B (offline-first sleep):** server + **local SQLite**. The server half (push domain, `pushMutations` branch, `applyDelta` gate, `getSyncDelta` already emits sleep) is sandbox-verifiable; the **local-store half (the v14 migration, the local write→outbox→pull round-trip) is on-device-only** — `getLocalStore` returns `null` in the web sandbox (Canonical Runtime rule). Chunk B is **not "done" until the on-device smoke run** (`docs/device-smoke-checklist.md`) confirms a local sleep edit survives a pull.
- **Chunk C (sync-health):** server only, fully sandbox-verifiable.
- Every chunk's math/validation is unit- or DB-tested in the sandbox; the device-gated part is explicitly Chunk B's local round-trip.

---

## Domain facts you need (verified against `main` by exploration — file:line)

**Shared upsert helpers (where merge logic lives):**
- `upsertBodyMetrics(userId, metrics[])` — `lib/data/postgres/adapter.ts:1632`. ON CONFLICT `(userId, date)`; 18-field blind `COALESCE(EXCLUDED.col, body_metrics.col)` (lines 1650-1668).
- `upsertOuraSleep(db, userId, sessions[])` — `lib/data/postgres/slices/oura.ts:317`. ON CONFLICT `(userId, sleepStart)`; 15-field `COALESCE` (349-364) + `updatedAt=NOW()`. Delegated from `adapter.ts:4338`.
- `upsertOuraDaily(db, userId, rows[])` — `lib/data/postgres/slices/oura.ts:107`. ON CONFLICT `(userId, date)`.
- **The clobber bug:** `COALESCE(EXCLUDED.col, existing.col)` = *any non-null new write wins*, so a Health-Connect or Cloud write silently overwrites a manual value.

**All writers that pass through those helpers (the sweep list for Chunk A):**
- `body_metrics` (9 server + 1 local): `pushMutations` body_metrics branch (`adapter.ts:3013`), BLE rollup (`adapter.ts:3872`), HC ingest (`app/api/health-connect/ingest/route.ts:77`), Oura Cloud sync (`app/api/oura/sync/route.ts:289`), Oura webhook (`app/api/oura/webhook/route.ts:146`), manual save (`app/api/body-metadata/route.ts:176`), native HC sync (`app/api/sync-health/route.ts:33`), AI-chat weight (`app/api/ai-chat/route.ts:92`); local `store.upsertBodyMetric` (`lib/local-store/sqlite-backend.ts:512`).
- `sleep_sessions` (6): `upsertOuraSleep` via BLE rollup (`adapter.ts:3772`), Cloud sync (`app/api/oura/sync/route.ts:277`), webhook (`app/api/oura/webhook/route.ts:180`); **and two Health-Connect paths that use `saveSleepSession` (`adapter.ts:2010`) which is `onConflictDoNothing` — no merge at all**: the `sync-health` route (`app/api/sync-health/route.ts:72`) and the direct save.
- `oura_daily` (3+): `upsertOuraDaily` via Cloud sync (`app/api/oura/sync/route.ts:222`), webhook (8 call sites, `app/api/oura/webhook/route.ts`), BLE rollup wear-time.

**Offline-first machinery (Chunk B):**
- Local `sleep_sessions` table — `lib/sqlite/migrations.ts:263` (`CREATE_SLEEP_SESSIONS`): `id, date, duration_hours, deep/rem/light_sleep_hours, updated_at`. **No `sync_status`, no `deleted_at`** — a blind pull mirror. Read at `sqlite-backend.ts:63` (`getSleepSessions`).
- Reference domain WITH `sync_status`: local `body_metrics` — `migrations.ts:236` (`... updated_at, deleted_at, sync_status TEXT NOT NULL DEFAULT 'synced'`); writer `upsertBodyMetric` (`sqlite-backend.ts:512`) COALESCE-read-merges then writes `sync_status`.
- `MutationDomain` enum — `lib/data/repository.ts:201` and client mirror `PendingMutation.domain` — `lib/local-store/types.ts:292`. **Neither has `sleep`.**
- `queueMutation` — `lib/local-store/index.ts:94`.
- `pushMutations` — `adapter.ts:2984` (per-domain if/else; strips `{syncStatus, updatedAt, deletedAt}` at 3003). **No sleep branch.**
- `applyDelta` — `sqlite-backend.ts:647`. Every offline-first domain upserts with `... ON CONFLICT DO UPDATE ... WHERE table.sync_status='synced'` (the pull-clobber gate). **The `sleep_sessions` branch (700-715) is a blind upsert with NO gate** (no local column to gate on).
- `getSyncDelta` — `adapter.ts:2735`: **already selects + emits `sleep_sessions`** (2759-2761, 2963) — server→device already works; only device→server and the local schema/gate are missing.
- `RECONCILE_TABLES`/`RECONCILE_COLUMNS` — `lib/sqlite/migrations.ts:382`/`87`; `sleep_sessions` has **zero** `RECONCILE_COLUMNS` entries. `scripts/check-reconcile.js` + `scripts/check-push-mutations.js` gate coverage in CI (the "Custom Rules" check).
- Local migrations — `MIGRATIONS` in `migrations.ts:401`, highest `toVersion: 13`. CLAUDE.md rules: no PRAGMA in upgrade statements; `ADD COLUMN` is not idempotent (assume partial application); register every new column in `RECONCILE_COLUMNS` in the same commit.

**sync-health gap (Chunk C):**
- `app/api/sync-health/route.ts` (95 lines): `auth()` session, then `await req.json() as SyncPayload` — **no Zod**, only `MAX_ITEMS=400` length check. Writes `upsertBodyMetrics` (33), `saveActivityLog` (60), `saveSleepSession` (72).
- Good template: `app/api/health-connect/ingest/route.ts` — `z.object({...})` with per-field `.min/.max/.nullable`, `z.coerce`, `safeParse`→400 (16-52), `rateLimit` (64).

**Migrations:** next free Postgres number = **120** (116 claimed by backlog item 2's `oura_daily_summary`; 118 by R4's `exercise_deloaded`). Next local SQLite version = **14**.

**Testing:** `pnpm test` → `vitest run`. DB-backed tests gate on `describe.skipIf(!process.env.DATABASE_URL)`. **`push-mutations-web-parity.test.ts`** is the model harness (pushes the same payload through both `pushMutations` and the web route, asserts identical behaviour) — extend it for Chunk A's merge and Chunk B's new sleep push. Local logic tests: `lib/local-store/__tests__/`, `lib/sqlite/__tests__/migrations.test.ts`.

---

## Chunk C — Harden `POST /api/sync-health` (do this first)

**Branch:** `fix/sync-health-hardening`. Smallest, server-only, no design questions. Brings the untyped route up to the `health-connect/ingest` standard.

### Task C1: Add a Zod schema and reject malformed/oversized input

**Files:**
- Modify: `app/api/sync-health/route.ts`
- Test: `app/api/__tests__/sync-health.test.ts` (create)

- [ ] **Step 1: Read both routes**

Read `app/api/sync-health/route.ts` (full) and `app/api/health-connect/ingest/route.ts` (full). Note the exact `SyncPayload` type (`@/lib/health-connect-sync`) the route currently casts to, and the `IngestBodySchema` shape + `safeParse`→400 pattern in the ingest route. This is a read-only step.

- [ ] **Step 2: Write a failing test**

```typescript
// app/api/__tests__/sync-health.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => ({
  upsertBodyMetrics: vi.fn(), saveActivityLog: vi.fn(), saveSleepSession: vi.fn(),
})) }))

import { POST } from '@/app/api/sync-health/route'

const post = (body: unknown) => POST(new Request('http://x/api/sync-health', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

describe('POST /api/sync-health validation', () => {
  it('400s when body_metrics has a non-numeric weight', async () => {
    const res = await post({ metrics: [{ date: '2026-07-01', weightKg: 'heavy' }] })
    expect(res.status).toBe(400)
  })
  it('400s when the metrics array exceeds the item cap', async () => {
    const res = await post({ metrics: Array.from({ length: 401 }, (_, i) => ({ date: `2026-07-${i}` })) })
    expect(res.status).toBe(400)
  })
  it('accepts a well-formed payload', async () => {
    const res = await post({ metrics: [{ date: '2026-07-01', weightKg: 82.5 }] })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 3: Run it — expect FAIL** (the string weight currently passes through unvalidated → 200, or the current cap returns a non-400).

Run: `pnpm test app/api/__tests__/sync-health.test.ts`

- [ ] **Step 4: Add the Zod schema to the route**

Mirror `IngestBodySchema`'s field-by-field shape for whatever `SyncPayload` currently carries (metrics / activities / sleep). Add near the top of `app/api/sync-health/route.ts`:

```typescript
import { z } from 'zod'

const SyncHealthSchema = z.object({
  metrics: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    weightKg: z.coerce.number().positive().max(500).optional(),
    // …one field per SyncPayload metric key, matching health-connect/ingest's bounds…
  })).max(400).optional(),
  // …activities / sleep arrays, each .max(400), each field-validated…
}).strict()
```

Then replace the `await req.json() as SyncPayload` cast + the `MAX_ITEMS` length check with:

```typescript
  const parsed = SyncHealthSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  }
  const payload = parsed.data
```

Use `payload.*` downstream in place of the cast variable. **Fail closed:** a `null`/non-JSON body must 400, not throw.

- [ ] **Step 5: Run tests + typecheck + lint**

Run: `pnpm test app/api/__tests__/sync-health.test.ts && pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/sync-health/route.ts app/api/__tests__/sync-health.test.ts
git commit -m "Validate /api/sync-health payloads with Zod, reject malformed/oversized input"
```

### Task C2: Add the standard rate limit

- [ ] **Step 1** — Add `import { rateLimit } from '@/lib/rate-limit'` and, right after the auth check, the same shape a sibling ingest route uses: `if (!rateLimit(\`${userId}:sync-health\`, 30, 60_000)) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })`. Match the exact limit/window of `health-connect/ingest` — read it and copy the numbers.
- [ ] **Step 2** — `pnpm exec tsc --noEmit && pnpm lint` → PASS.
- [ ] **Step 3** — Commit: `git commit -am "Rate-limit /api/sync-health to match sibling ingest routes"`.

> **Outbox note (deliberately NOT in scope for Chunk C):** `/api/sync-health` is a server-*receive* endpoint for the Capacitor JS layer's pre-aggregated push — the spec/backlog line "no outbox" refers to the fact that its *sleep* domain has no client outbox path. That is exactly what **Chunk B** builds (the sleep offline-first domain). Do not add an outbox here; fix the domain in B. Chunk C is only the Zod + rate-limit + fail-closed retrofit.

---

## Chunk B — Promote `sleep_sessions` to an offline-first domain

**Branch:** `feat/sleep-offline-first`. Today sleep is a **blind pull mirror**: `getSyncDelta` already emits it, but the local table has no `sync_status`/`deleted_at`, there is no `sleep` `MutationDomain`, no `pushMutations` branch, and `applyDelta`'s sleep branch has no clobber gate — so a local sleep write is un-pushable and gets overwritten by the next pull. This chunk makes sleep follow the standard offline-first checklist (CLAUDE.md §"Offline Sync" and §"Offline-First").

> **HR note:** there is **no local `oura_heartrate` table** — the intraday HR series is server-only by design (a cross-session aggregate, correctly left on `cachedFetch` per the read-site audit). The daily HR *summary* fields (`restingHeartRate`, `hrvMs`, `spo2Pct`) already live in the offline-first `body_metrics` local table. **So "promote HR to offline-first" is already satisfied for the summary and out-of-scope for the intraday series** (promoting the series would need a whole new local table for little gain). This chunk is **sleep only**. State that in the journal.

### Task B1: Local migration v14 — add `sync_status` + `deleted_at` to local `sleep_sessions`

**Files:**
- Modify: `lib/sqlite/migrations.ts` (add migration v14, extend `CREATE_SLEEP_SESSIONS`, add `RECONCILE_COLUMNS` entries)
- Test: `lib/sqlite/__tests__/migrations.test.ts`

- [ ] **Step 1: Extend the base `CREATE_SLEEP_SESSIONS`** (`migrations.ts:263`) so a fresh install gets the columns, AND add matching enrichment columns needed to render sleep offline (the local table today lacks `sleep_start/end`, `efficiency`, HR fields, `sleep_score` — a rendered offline row needs them; per CLAUDE.md §"local table holds everything needed to render"). Add at minimum: `sleep_start TEXT, sleep_end TEXT, efficiency INTEGER, average_hrv_ms REAL, avg_heart_rate INTEGER, lowest_heart_rate INTEGER, sleep_score INTEGER, respiratory_rate REAL, deleted_at TEXT, sync_status TEXT NOT NULL DEFAULT 'synced'`.

- [ ] **Step 2: Add migration v14** to the `MIGRATIONS` array (`migrations.ts:401`, after `toVersion: 13`). **No PRAGMA in the statements** (CLAUDE.md); each `ADD COLUMN` is a separate statement; assume partial application (idempotency is handled by `reconcileSchema`, not here):

```typescript
{
  toVersion: 14,
  statements: [
    "ALTER TABLE sleep_sessions ADD COLUMN sleep_start TEXT",
    "ALTER TABLE sleep_sessions ADD COLUMN sleep_end TEXT",
    "ALTER TABLE sleep_sessions ADD COLUMN efficiency INTEGER",
    "ALTER TABLE sleep_sessions ADD COLUMN average_hrv_ms REAL",
    "ALTER TABLE sleep_sessions ADD COLUMN avg_heart_rate INTEGER",
    "ALTER TABLE sleep_sessions ADD COLUMN lowest_heart_rate INTEGER",
    "ALTER TABLE sleep_sessions ADD COLUMN sleep_score INTEGER",
    "ALTER TABLE sleep_sessions ADD COLUMN respiratory_rate REAL",
    "ALTER TABLE sleep_sessions ADD COLUMN deleted_at TEXT",
    "ALTER TABLE sleep_sessions ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'",
  ],
},
```

- [ ] **Step 3: Register every new column in `RECONCILE_COLUMNS`** (`migrations.ts:87`) — one `{ table: 'sleep_sessions', column: '<col>', ddl: 'ALTER TABLE sleep_sessions ADD COLUMN <col> <type>' }` per column above. This is the real schema authority after a partial upgrade (CLAUDE.md §"Local SQLite Migrations"); `scripts/check-reconcile.js` fails CI if any is missing.

- [ ] **Step 4: Add/extend the migration test** — assert `migrations.test.ts` sees v14 and that every v14 column is present in `RECONCILE_COLUMNS`. Follow the existing reconcile-coverage assertion in that file.

- [ ] **Step 5: Run** `pnpm test lib/sqlite/__tests__/migrations.test.ts && node scripts/check-reconcile.js` → PASS. **Commit.**

### Task B2: Add the `sleep` mutation domain + local write path

**Files:**
- Modify: `lib/data/repository.ts` (`MutationDomain`), `lib/local-store/types.ts` (`PendingMutation.domain` + `LocalSleepSession`), `lib/local-store/sqlite-backend.ts` (`upsertSleepSession` writer + read filter), `lib/local-store/index.ts` (if a typed wrapper exists).

- [ ] **Step 1** — Add `'sleep'` to `MutationDomain` (`repository.ts:201`) and to `PendingMutation.domain` (`types.ts:292`). Extend `LocalSleepSession` (`types.ts:37`) with the new fields + `syncStatus`.
- [ ] **Step 2** — Add a local writer `upsertSleepSession(s)` in `sqlite-backend.ts` that **read-merges** (copy the `upsertBodyMetric` COALESCE-read-merge pattern at `:512`, NOT a blind overwrite — CLAUDE.md "single-field save must read-merge") and sets `sync_status='pending'` on a local edit. Update `getSleepSessions` (`:63`) to filter `WHERE deleted_at IS NULL`.
- [ ] **Step 3** — Typecheck/lint → PASS. **Commit.**

### Task B3: `pushMutations` sleep branch (mirror the web write)

**Files:**
- Modify: `lib/data/postgres/adapter.ts` (`pushMutations`, add a `sleep` branch)

- [ ] **Step 1** — Add a `else if (mut.domain === 'sleep')` branch in `pushMutations` (`adapter.ts:2984`) that validates the payload and writes via the **shared** `upsertOuraSleep` helper (`slices/oura.ts:317`) scoped to `userId` — do NOT touch `this.db`/raw `sql` directly (the `check-push-mutations.js` Custom Rules check fails the build otherwise; the branch must call the shared repo function). The payload carries every field the local table holds (B1). Source for these pushed rows = `'manual'` if this chunk lands before Chunk A, else pass the appropriate source once Chunk A adds the param (note the coupling in the PR description).
- [ ] **Step 2** — Extend `push-mutations-web-parity.test.ts` with a `sleep` case: push a sleep payload through `pushMutations` and assert the row lands with the same fields the web path would write.
- [ ] **Step 3** — `pnpm test ... parity ... && node scripts/check-push-mutations.js` → PASS. **Commit.**

### Task B4: `applyDelta` sync-status gate + `pullDelta` flag + tombstone

**Files:**
- Modify: `lib/local-store/sqlite-backend.ts` (`applyDelta` sleep branch `:700`), `lib/local-store/sync-engine.ts` (`pullDelta` domain flag), `components/sync-provider.tsx` (group mapping), `lib/data/postgres/adapter.ts` (`getSyncDelta` — add `deletedAt` emission if a server tombstone is added).

- [ ] **Step 1** — Rewrite the `applyDelta` sleep branch (`sqlite-backend.ts:700`) from the blind upsert to the gated form every other domain uses: `... ON CONFLICT(id) DO UPDATE SET ... WHERE sleep_sessions.sync_status='synced'` (and map every new column). This stops a pull from clobbering a pending local edit (CLAUDE.md §103).
- [ ] **Step 2** — Add the `sleep` domain flag to `pullDelta`'s `SyncedDomains` (`sync-engine.ts:50`) and the sync-provider group mapping (`sync-provider.tsx`) so a pulled sleep delta triggers the right cache invalidation (CLAUDE.md §109).
- [ ] **Step 3 (server tombstone)** — `sleep_sessions` has **no `deletedAt`** server-side (unlike workout tables). If sleep gets delete UI, add `deleted_at` to the server table too (fold into Chunk A's migration 120, or a note that sleep-delete is out of scope until then). If no sleep-delete UI exists, **document that cross-device sleep deletes are out of scope** for this chunk and the local `deleted_at` is forward-provisioning only.
- [ ] **Step 4** — Typecheck/lint/tests → PASS. **Commit.**

### Task B5: On-device verification (the real gate)

- [ ] **Step 1** — Per Canonical Runtime, the local round-trip cannot be verified in the sandbox. Add the sleep round-trip to `docs/device-smoke-checklist.md`: on the APK, edit a sleep value offline → confirm it persists across an app restart → go online → confirm it pushes and is not reverted by the next pull. Until the owner runs this, add a `projectOverview.md` Known-Issues row marking Chunk B **NOT yet verified on device**.
- [ ] **Step 2** — Bookkeeping (version bump only if any user-visible behaviour changed — likely not for pure plumbing; changelog optional), journal, remove nothing from backlog yet (the item covers all three chunks — annotate which shipped). **Commit.**

---

## Chunk A — `source` provenance column + precedence-ranked merge

**Branch:** `feat/health-data-provenance`. The largest chunk. Adds a `source` column to the three tables and replaces blind `COALESCE` last-writer-wins with a precedence-aware merge.

> **★ DESIGN FORK for the reviewing agent — decide before Task A2.** A single per-**row** `source` cannot perfectly model `body_metrics`, whose rows legitimately mix sources (weight=manual, hrv=oura_ble, steps=health_connect on the same date). Two options:
>
> - **Option 1 (recommended, row-level `source`):** store the highest-precedence source that has written the row; merge rule = *higher-or-equal source overwrites per field (`COALESCE(new,old)`), lower source only fills nulls (`COALESCE(old,new)`)*. Strictly better than today (a lower-priority source can never overwrite a higher-priority non-null value), fully implementable in the upsert SET clause, one column per table. **Residual imperfection:** once a high-priority source stamps the row, a genuinely-new field from a lower-priority source is still allowed to fill a null, but a later same-field lower-priority update is blocked at the row's rank — acceptable and safe (documented below).
> - **Option 2 (per-field provenance table `(user_id, date, field, source)`):** exact, but a large new table + every field-write updates provenance + every read joins it. Much more work; likely over-engineered for a single-user app.
>
> This plan specs **Option 1**. If the reviewer prefers Option 2, Tasks A2–A4 change materially — flag it before proceeding.

### Task A1: Migration 120 — add `source` to the three tables

**Files:**
- Create: `lib/data/postgres/migrations/120_health_data_source.sql`

- [ ] **Step 1** — Write an idempotent migration adding a nullable `source TEXT` to each table (nullable so existing rows read as "unknown"/lowest precedence; no backfill needed — a NULL source loses to any explicit source, which is the safe default):

```sql
-- 120_health_data_source.sql — provenance for precedence-ranked merge.
ALTER TABLE body_metrics    ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE sleep_sessions  ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE oura_daily      ADD COLUMN IF NOT EXISTS source TEXT;
```

- [ ] **Step 2** — Add `source` to the Drizzle table defs (`schema.ts` — `bodyMetrics` ~226, `sleepSessions` ~326, `ouraDaily` ~672): `source: text('source')`. Update the `rowToBodyMetrics`/`rowToSleepSession` mappers + any SELECT lists so the field round-trips (CLAUDE.md: a missed mapper fails silently as "save doesn't persist").
- [ ] **Step 3** — Apply on the local dev DB (`pnpm db:local`) and confirm the columns exist. Typecheck. **Commit.**

### Task A2: A shared source-precedence helper

**Files:**
- Create: `lib/data/health-source.ts`
- Test: `lib/data/__tests__/health-source.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/data/__tests__/health-source.test.ts
import { describe, it, expect } from 'vitest'
import { sourceRank, HEALTH_SOURCES, type HealthSource } from '@/lib/data/health-source'

describe('sourceRank', () => {
  it('ranks manual > oura_ble > oura_cloud > health_connect > unknown', () => {
    expect(sourceRank('manual')).toBeGreaterThan(sourceRank('oura_ble'))
    expect(sourceRank('oura_ble')).toBeGreaterThan(sourceRank('oura_cloud'))
    expect(sourceRank('oura_cloud')).toBeGreaterThan(sourceRank('health_connect'))
    expect(sourceRank(null)).toBe(0) // unknown / legacy row = lowest
  })
  it('enumerates the known sources', () => {
    expect(HEALTH_SOURCES).toContain('manual')
    expect(HEALTH_SOURCES).toContain('oura_ble')
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm test lib/data/__tests__/health-source.test.ts`
- [ ] **Step 3: Implement**

```typescript
// lib/data/health-source.ts
// Provenance for body_metrics / sleep_sessions / oura_daily. Higher rank wins a
// merge conflict; a lower-ranked source may only fill a NULL, never overwrite.
export const HEALTH_SOURCES = ['health_connect', 'oura_cloud', 'oura_ble', 'manual'] as const
export type HealthSource = (typeof HEALTH_SOURCES)[number]

const RANK: Record<HealthSource, number> = {
  health_connect: 1,
  oura_cloud: 2,
  oura_ble: 3,
  manual: 4,
}

/** Precedence rank; null/unknown (legacy rows) rank 0 (lowest). */
export function sourceRank(source: string | null | undefined): number {
  return source && source in RANK ? RANK[source as HealthSource] : 0
}
```

- [ ] **Step 4: Run — PASS. Commit.**

### Task A3: Precedence merge in the three upsert helpers

**Files:**
- Modify: `lib/data/postgres/adapter.ts` (`upsertBodyMetrics:1632`), `lib/data/postgres/slices/oura.ts` (`upsertOuraSleep:317`, `upsertOuraDaily:107`)

- [ ] **Step 1** — Add a `source: HealthSource` parameter to each helper's signature (and its `OuraSleepUpsertRow`/`OuraDailyRow` if row-carried). Replace each field's blind `COALESCE(EXCLUDED.col, table.col)` in the `onConflictDoUpdate` SET clause with the precedence form. Using a SQL rank expression keyed on the incoming vs stored `source` (implement the rank as a small SQL `CASE` mirroring `sourceRank`, or a Postgres helper): for each data column `col`:

```sql
col = CASE
        WHEN <rank(EXCLUDED.source)> >= <rank(table.col_source)> THEN COALESCE(EXCLUDED.col, table.col)
        ELSE COALESCE(table.col, EXCLUDED.col)
      END
```

and set the row `source` to the higher-ranked of the two: `source = CASE WHEN <rank(EXCLUDED.source)> >= <rank(table.source)> THEN EXCLUDED.source ELSE table.source END`. Encapsulate the `rank(...)` SQL once (a `sql` fragment builder next to the helper) so the three helpers share it (One-Formula). Where `table.col_source` isn't tracked per-field (Option 1), compare against the row's `source` — this is the documented row-level approximation.

- [ ] **Step 2** — Extend `push-mutations-web-parity.test.ts` (or a new `lib/data/postgres/__tests__/health-source-merge.test.ts`, DB-backed, `skipIf(!DATABASE_URL)`) to prove precedence: (a) seed a `manual` weight; (b) upsert the same date with `health_connect` source + a different weight; (c) assert the manual weight survives; (d) upsert `health_connect` with a *new* null-in-existing field (e.g. steps) and assert it fills; (e) assert a higher-or-equal source (`oura_ble` vs `oura_cloud`) overwrites. Cover all three tables at least once.
- [ ] **Step 3** — `pnpm test` + typecheck + lint → PASS. **Commit.**

### Task A4: Pass a `source` from every writer (the sweep)

**Files (every caller from the fact-sheet — pass the correct source constant):**
- Modify each writer to pass its source to the now-`source`-aware helper:
  - `'manual'` → `app/api/body-metadata/route.ts:176`, `app/api/ai-chat/route.ts:92`, the `pushMutations` body_metrics branch (`adapter.ts:3013`) **and** the new sleep branch (Chunk B) — device-originated user writes are manual-tier.
  - `'oura_ble'` → BLE rollup body_metrics (`adapter.ts:3872`) + BLE rollup sleep (`adapter.ts:3772`) + BLE rollup wear-time `oura_daily`.
  - `'oura_cloud'` → `app/api/oura/sync/route.ts` (222/277/289), `app/api/oura/webhook/route.ts` (all `upsert*` call sites).
  - `'health_connect'` → `app/api/health-connect/ingest/route.ts:77`, `app/api/sync-health/route.ts` (33/72).
- **Fix the two `onConflictDoNothing` sleep paths:** `saveSleepSession` (`adapter.ts:2010`) is used by the Health-Connect sleep writes and silently no-ops against an existing row. Route those through `upsertOuraSleep` with `source='health_connect'` so HC sleep *merges* (filling nulls, never overwriting a higher source) instead of being dropped — OR document why no-op-on-conflict is acceptable for HC sleep. Decide and note it.

- [ ] **Step 1** — Make each edit; the compiler enforces the new required param, so a missed caller is a build error (good — the type system is the checklist here). Enumerate and tick each call site above.
- [ ] **Step 2** — `pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build` → PASS.
- [ ] **Step 3** — Verify on the local dev DB: log a manual weight via `/api/body-metadata`, then POST a Health-Connect payload for the same date with a different weight via `/api/sync-health`, and confirm (SQL) the manual weight survives and its `source='manual'`; confirm a new HC-only field filled. **Commit.**

### Task A5: Bookkeeping

- [ ] Remove the Track-B Queue entry (or annotate which chunks shipped) from `docs/implementation-backlog.md`; also update backlog item 4's "Remaining" line (it references this provenance work) and the "Not yet queued" Track-B bullet. Journal + `projectOverview.md`. Version bump only if user-visible (provenance is invisible → likely no bump; a changelog line is optional). Full gate (`pnpm lint && tsc && test && build`). **Commit.**

---

## Self-review checklist (run before handing off)

- **Reconciliation:** confirmed #422 shipped no provenance; all three chunks greenfield. ✅
- **Chunk independence:** C, B, A share no files-of-record beyond the backlog entry; each is its own PR; ordering C→B→A recommended, any order valid. ✅
- **Chunk A design fork surfaced:** row-level vs per-field provenance called out with a recommendation before the code tasks. ✅
- **One-Formula:** the source-rank lives once (`lib/data/health-source.ts` + one shared SQL rank fragment); the three upsert helpers share it. ✅
- **Offline-first checklist (Chunk B):** local table holds render fields (B1), read-merge write + `sync_status='pending'` (B2), push branch via shared helper (B3), `applyDelta` sync-status gate + `pullDelta` flag + group mapping (B4), `RECONCILE_COLUMNS` coverage (B1), on-device gate (B5). Maps to CLAUDE.md §103/§105/§108/§109/§120. ✅
- **CI Custom Rules:** `pushMutations` sleep branch uses the shared `upsertOuraSleep` (no `this.db`/raw `sql`); every new local column is in `RECONCILE_COLUMNS`. ✅
- **Mapper coverage (Chunk A):** `source` added to `rowToX`/SELECT lists so it round-trips (A1 step 2). ✅
- **Migrations claimed:** Postgres 120 (116/118 spoken-for), local SQLite v14. ✅
- **Runtime honesty:** Chunk B's local round-trip is device-gated (B5 Known-Issues row); everything else sandbox-verifiable. ✅
- **Fail-closed (Chunk C):** null/non-JSON body → 400, not a throw. ✅
