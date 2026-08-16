# Batch A — Offline-First Data Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining "my data disappeared" root causes from `docs/planned_upgrades.md` Batch A (items A2–A9): confirm outbox mutations by stable id instead of `domain:date`, dead-letter permanently-failing mutations after 5 attempts with a visible Retry/Discard UI, stop a single 5xx from wedging the whole push queue, stop pull deltas clobbering pending local edits, make replayed `workout_log` pushes idempotent, and lift sync throughput (transactions, bulk inserts, paginated pull).

**Architecture:** The on-device SQLite local store (`lib/local-store/`) is the source of truth; writes go through `store.upsertX` + `queueMutation` into `mutations_outbox`, drained by `pushMutations` (client, `lib/local-store/sync-engine.ts`) → `POST /api/sync/push` → `PostgresAdapter.pushMutations`. Reads hydrate via `pullDelta` → `GET /api/sync/pull` → `getSyncDelta` → `applyDelta` (`lib/local-store/sqlite-backend.ts`). This plan threads the outbox row `id` through that whole loop, adds retry accounting columns to the outbox (local SQLite migration **v13**), and hardens both directions of the sync.

**Tech Stack:** Next.js 15 + TypeScript, Drizzle/Postgres (`lib/data/postgres/adapter.ts`), Capacitor SQLite local store, Zod, Vitest (`pnpm test` = `vitest run`, tests in `lib/**/__tests__/*.test.ts`), pnpm only.

---

**Assumption (stated up front):** **A1 (`food_items` in `getSyncDelta`/`pullDelta`) is covered by the separate quick-wins plan and is deliberately NOT duplicated here.** This plan assumes `applyDelta`'s existing `delta.foodItems` branch (`sqlite-backend.ts:756-758`) is/will be fed by that PR and does not touch the food-items delta path.

**Branch:** `fix/offline-sync-integrity` (split into 2–3 PRs if review size demands: Tasks 1–6 = protocol + dead-letter + UI; Tasks 7–9 = guards + idempotency; Tasks 10–13 = throughput + A9).

## Backwards-compatibility matrix (id-based confirm protocol)

Old = code currently on `main` / an APK built from it; New = this plan. The protocol must degrade, never break:

| Client | Server | Push envelope | Error records | Confirm behaviour |
|---|---|---|---|---|
| Old | Old | `{domain,date,payload}` | `{domain,date,error}` | `domain:date` matching (today's buggy-but-working baseline) |
| Old | New | no `id` sent | server echoes `id: undefined` | client still matches `domain:date` — unchanged |
| New | Old | sends `id`; old server's `z.object` **strips** the unknown `id` key silently | errors have no `id` | client **falls back** to `domain:date` matching for error records missing `id` (degraded: siblings sharing the key are retained, exactly like today — never worse) |
| New | New | `{id,domain,date,payload}` | `{id,domain,date,error}` | exact per-row confirm/fail by outbox id |

Rules the code must satisfy: server treats `id` as optional and only ever echoes it; client treats an error record's `id` as optional and falls back to `domain:date`; the outbox `id` is never used server-side for anything except echoing (no trust, no dedup key).

---

### Task 1: Server side of the id protocol — shared mutation schema + echo `id` in push results

**Files:**
- Create: `lib/sync/mutation-schema.ts`
- Create: `lib/sync/__tests__/mutation-schema.test.ts`
- Modify: `app/api/sync/push/route.ts` (replace inline `MutationSchema`, lines 6-10)
- Modify: `lib/data/repository.ts` (`IncomingMutation` line 67-71, `PushResult` line 73-76)
- Modify: `lib/data/postgres/adapter.ts` (`pushMutations` — the three `errors.push` sites at ~2531, ~2679, ~2689)

**Steps:**

- [ ] Write the failing test `lib/sync/__tests__/mutation-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MutationSchema } from '../mutation-schema'

describe('MutationSchema', () => {
  const base = { domain: 'food_logs', date: '2026-07-01', payload: { id: 'abc' } }

  it('accepts a mutation without an id (old-client shape)', () => {
    const r = MutationSchema.safeParse(base)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.id).toBeUndefined()
  })

  it('accepts and preserves an outbox id (new-client shape)', () => {
    const r = MutationSchema.safeParse({ ...base, id: '4f1c2d3e-aaaa-bbbb-cccc-1234567890ab' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.id).toBe('4f1c2d3e-aaaa-bbbb-cccc-1234567890ab')
  })

  it('rejects an unknown domain and a malformed date', () => {
    expect(MutationSchema.safeParse({ ...base, domain: 'users' }).success).toBe(false)
    expect(MutationSchema.safeParse({ ...base, date: '01/07/2026' }).success).toBe(false)
  })
})
```

- [ ] Run `pnpm vitest run lib/sync/__tests__/mutation-schema.test.ts` — fails: `Cannot find module '../mutation-schema'`.
- [ ] Create `lib/sync/mutation-schema.ts` (moved verbatim from the route, plus the optional `id`):

```ts
import { z } from 'zod'

// Envelope for one outbox mutation pushed from the on-device store.
// `id` is the client's mutations_outbox row id — optional so pre-v13 clients
// (which push without it) keep working. The server only echoes it back in
// per-item results; it is never trusted for anything else.
export const MutationSchema = z.object({
  id:      z.string().max(64).optional(),
  domain:  z.enum(['body_metrics', 'mood_logs', 'food_logs', 'supplement_logs', 'injuries', 'supplements', 'activity_logs', 'workout_log', 'day_checkins']),
  date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payload: z.record(z.string(), z.unknown()),
})

export type PushMutation = z.infer<typeof MutationSchema>
```

- [ ] In `app/api/sync/push/route.ts`: delete the inline `MutationSchema` (lines 6-10), add `import { MutationSchema } from '@/lib/sync/mutation-schema';`, and keep the per-item `safeParse` loop unchanged — `valid` now carries `id` through automatically since `z.infer` includes it.
- [ ] In `lib/data/repository.ts` update both types:

```ts
export interface IncomingMutation {
  id?:     string;   // client outbox row id — echoed back in per-item errors
  domain:  MutationDomain;
  date:    string;
  payload: Record<string, unknown>;
}

export interface PushResult {
  processed: number;
  errors:    Array<{ id?: string; domain: string; date: string; error: string }>;
}
```

- [ ] In `lib/data/postgres/adapter.ts` `pushMutations`, add `id: mut.id` to all three error records:
  - food_logs FK ownership (~2531): `errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'FK ownership check failed' })`
  - workout_log safeParse (~2679): `errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: 'Invalid workout_log payload' })`
  - the outer catch (~2689): `errors.push({ id: mut.id, domain: mut.domain, date: mut.date, error: String(err) })`
- [ ] Run `pnpm vitest run lib/sync/__tests__/mutation-schema.test.ts` — passes. Run `pnpm test` — full suite green.
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — both clean.
- [ ] Commit: `sync: accept and echo the client outbox id on push`

---

### Task 2: Client side of the id protocol — push ids, confirm by id with `domain:date` fallback

**Files:**
- Create: `lib/local-store/sync-helpers.ts`
- Create: `lib/local-store/__tests__/sync-helpers.test.ts`
- Modify: `lib/local-store/sync-engine.ts` (`pushMutations` lines 337-358)

**Steps:**

- [ ] Write the failing test `lib/local-store/__tests__/sync-helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveFailedOutboxIds } from '../sync-helpers'

const chunk = [
  { id: 'ob-1', domain: 'food_logs', date: '2026-07-01' },
  { id: 'ob-2', domain: 'food_logs', date: '2026-07-01' },
  { id: 'ob-3', domain: 'food_logs', date: '2026-07-01' },
  { id: 'ob-4', domain: 'body_metrics', date: '2026-07-01' },
]

describe('resolveFailedOutboxIds', () => {
  it('fails only the exact row when the server echoes an id', () => {
    const failed = resolveFailedOutboxIds(chunk, [
      { id: 'ob-2', domain: 'food_logs', date: '2026-07-01', error: 'FK ownership check failed' },
    ])
    expect([...failed.keys()]).toEqual(['ob-2'])
    expect(failed.get('ob-2')).toBe('FK ownership check failed')
  })

  it('falls back to domain:date for old servers that omit the id', () => {
    const failed = resolveFailedOutboxIds(chunk, [
      { domain: 'food_logs', date: '2026-07-01', error: 'boom' },
    ])
    // Degraded legacy behaviour: all three same-key food logs retained, the
    // unrelated body_metrics row still confirms.
    expect([...failed.keys()].sort()).toEqual(['ob-1', 'ob-2', 'ob-3'])
    expect(failed.has('ob-4')).toBe(false)
  })

  it('returns an empty map when there are no errors', () => {
    expect(resolveFailedOutboxIds(chunk, []).size).toBe(0)
  })
})
```

- [ ] Run `pnpm vitest run lib/local-store/__tests__/sync-helpers.test.ts` — fails: module not found.
- [ ] Create `lib/local-store/sync-helpers.ts` (pure, no Capacitor imports — keeps it importable from node tests):

```ts
// Pure helpers for the sync engine. No sqlite/capacitor imports so tests can
// run in the node environment.

export interface PushErrorRecord {
  id?:    string;
  domain: string;
  date:   string;
  error?: string;
}

// Map of failed outbox row id -> error message. Prefers exact id matching
// (new servers); falls back to domain:date for error records missing an id
// (old servers) — which retains every sibling sharing that key, matching the
// pre-id behaviour, never worse.
export function resolveFailedOutboxIds(
  chunk: Array<{ id: string; domain: string; date: string }>,
  errors: PushErrorRecord[],
): Map<string, string> {
  const failed = new Map<string, string>()
  const legacyByKey = new Map<string, string>()
  for (const e of errors) {
    if (e.id) failed.set(e.id, e.error ?? 'sync failed')
    else legacyByKey.set(`${e.domain}:${e.date}`, e.error ?? 'sync failed')
  }
  if (legacyByKey.size) {
    for (const m of chunk) {
      if (failed.has(m.id)) continue
      const legacy = legacyByKey.get(`${m.domain}:${m.date}`)
      if (legacy !== undefined) failed.set(m.id, legacy)
    }
  }
  return failed
}
```

- [ ] In `lib/local-store/sync-engine.ts` `pushMutations`, replace the envelope + confirm logic:
  - Envelope (line 344-346) becomes:

```ts
body: JSON.stringify({
  mutations: chunk.map(m => ({ id: m.id, domain: m.domain, date: m.date, payload: m.payload })),
}),
```

  - Result parsing + confirm (lines 354-357) becomes:

```ts
const result = await res.json() as {
  processed: number;
  errors: Array<{ id?: string; domain: string; date: string; error?: string }>;
};
// Confirm by outbox id. Failed rows stay queued; resolveFailedOutboxIds
// degrades to domain:date matching against pre-id servers.
const failed = resolveFailedOutboxIds(chunk, result.errors)
confirmed.push(...chunk.filter(m => !failed.has(m.id)))
```

  - Add `import { resolveFailedOutboxIds } from './sync-helpers';` at the top.
- [ ] Run `pnpm vitest run lib/local-store/__tests__/sync-helpers.test.ts` — passes.
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — clean.
- [ ] Commit: `sync: confirm pushed mutations by outbox id, not domain:date`

---

### Task 3: Local SQLite migration v13 — outbox retry columns + `activity_logs.sync_status`

**Files:**
- Modify: `lib/sqlite/migrations.ts` (append `toVersion: 13` after line 657; extend `RECONCILE_COLUMNS` at line 87-116)
- Modify: `lib/local-store/types.ts` (`PendingMutation` lines 264-271, `LocalActivityLog` lines 107-120)
- Modify: `lib/local-store/index.ts` (`LocalStore` interface — outbox methods lines 85-88)
- Modify: `lib/local-store/sqlite-backend.ts` (`queueMutation` line 1065, `getPendingMutations` line 1073, `getActivityLogs` line 310, `upsertActivityLog` line 1039; new methods)
- Create: `lib/sqlite/__tests__/migrations.test.ts`

**Steps:**

- [ ] Write the failing test `lib/sqlite/__tests__/migrations.test.ts` — a generic v13 + reconcile-parity guard (hard project rule after bug #85: every ALTER-added column must also be in the self-heal mirror):

```ts
import { describe, it, expect } from 'vitest'
import { MIGRATIONS, RECONCILE_COLUMNS } from '../migrations'

describe('local schema v13', () => {
  it('tops out at version 13', () => {
    expect(Math.max(...MIGRATIONS.map(m => m.toVersion))).toBe(13)
  })

  it('v13 adds the outbox retry columns and activity sync_status', () => {
    const v13 = MIGRATIONS.find(m => m.toVersion === 13)!
    const ddl = v13.statements.join('\n')
    for (const col of ['attempts', 'last_error', 'status', 'next_retry_at']) {
      expect(ddl, `mutations_outbox missing ${col}`).toContain(`ALTER TABLE mutations_outbox ADD COLUMN ${col}`)
    }
    expect(ddl).toContain('ALTER TABLE activity_logs ADD COLUMN sync_status')
  })

  it('every ALTER-added column is mirrored in RECONCILE_COLUMNS (bug #85 guard)', () => {
    const mirror = new Set(RECONCILE_COLUMNS.map(c => `${c.table}.${c.column}`))
    for (const mig of MIGRATIONS) {
      for (const stmt of mig.statements) {
        const m = stmt.match(/ALTER TABLE (\w+)\s+ADD COLUMN (\w+)/)
        if (m) expect(mirror.has(`${m[1]}.${m[2]}`), `RECONCILE_COLUMNS missing ${m[1]}.${m[2]}`).toBe(true)
      }
    }
  })
})
```

- [ ] Run `pnpm vitest run lib/sqlite/__tests__/migrations.test.ts` — fails (max version is 12).
- [ ] Append to `MIGRATIONS` in `lib/sqlite/migrations.ts`:

```ts
{
  toVersion: 13,
  statements: [
    // Outbox retry accounting: attempts + last_error + dead-letter status +
    // exponential next_retry_at, so a poisoned mutation stops silently
    // retrying forever and becomes visible/recoverable in the sync-health UI.
    `ALTER TABLE mutations_outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE mutations_outbox ADD COLUMN last_error TEXT`,
    `ALTER TABLE mutations_outbox ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`,
    `ALTER TABLE mutations_outbox ADD COLUMN next_retry_at TEXT`,
    // Pull-clobber guard for offline activity edits (applyDelta checks it).
    `ALTER TABLE activity_logs ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'`,
  ],
},
```

- [ ] Add the five matching entries to `RECONCILE_COLUMNS` (next to the v11 activity entries at lines 107-109):

```ts
// Outbox retry accounting + activity pull-guard added in v13.
{ table: 'mutations_outbox', column: 'attempts',      ddl: `ALTER TABLE mutations_outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0` },
{ table: 'mutations_outbox', column: 'last_error',    ddl: `ALTER TABLE mutations_outbox ADD COLUMN last_error TEXT` },
{ table: 'mutations_outbox', column: 'status',        ddl: `ALTER TABLE mutations_outbox ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'` },
{ table: 'mutations_outbox', column: 'next_retry_at', ddl: `ALTER TABLE mutations_outbox ADD COLUMN next_retry_at TEXT` },
{ table: 'activity_logs',    column: 'sync_status',   ddl: `ALTER TABLE activity_logs ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'` },
```

  (The base `CREATE_MUTATIONS_OUTBOX`/`CREATE_ACTIVITY_LOGS` constants stay in their original CREATE shape — per the existing convention, ALTER-added columns are restored by `RECONCILE_COLUMNS`, not by widening the base CREATEs.)
- [ ] Update `lib/local-store/types.ts`:

```ts
export interface PendingMutation {
  id:          string;
  userId:      string;
  domain:      'body_metrics' | 'mood_logs' | 'food_logs' | 'supplement_logs' | 'injuries' | 'supplements' | 'activity_logs' | 'workout_log' | 'day_checkins';
  date:        string;
  payload:     Record<string, unknown>;
  createdAt:   string;
  attempts:    number;
  lastError:   string | null;
  status:      'pending' | 'failed';
  nextRetryAt: string | null;
}
```

  and add `syncStatus: 'pending' | 'synced';` to `LocalActivityLog`.
- [ ] Update `lib/local-store/index.ts` `LocalStore` interface — outbox section becomes:

```ts
// Outbox
queueMutation(m: Omit<PendingMutation, 'id' | 'createdAt' | 'attempts' | 'lastError' | 'status' | 'nextRetryAt'>): Promise<void>;
getPendingMutations(userId: string): Promise<PendingMutation[]>;
getFailedMutations(userId: string): Promise<PendingMutation[]>;
recordMutationFailures(failures: Array<{ id: string; error: string }>): Promise<void>;
retryFailedMutation(id: string): Promise<void>;
deleteMutations(ids: string[]): Promise<void>;
```

- [ ] Update `lib/local-store/sqlite-backend.ts`:
  - `queueMutation` insert gains the new columns explicitly: `INSERT OR REPLACE INTO mutations_outbox (id, user_id, domain, date, payload, created_at, attempts, last_error, status, next_retry_at) VALUES (?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),0,NULL,'pending',NULL)`.
  - Add a private `mapMutation(r: Record<string, unknown>): PendingMutation` (existing fields plus `attempts: Number(r.attempts ?? 0)`, `lastError: r.last_error ? String(r.last_error) : null`, `status: (r.status as 'pending' | 'failed') ?? 'pending'`, `nextRetryAt: r.next_retry_at ? String(r.next_retry_at) : null`).
  - `getPendingMutations` becomes due-aware:

```ts
async getPendingMutations(userId: string): Promise<PendingMutation[]> {
  const nowIso = new Date().toISOString();
  const rows = await querySQL<Record<string, unknown>>(
    `SELECT * FROM mutations_outbox
      WHERE user_id = ? AND status = 'pending'
        AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY created_at`,
    [userId, nowIso],
  );
  return rows.map(r => this.mapMutation(r));
}
```

  - Add the three new methods (dead-letter threshold + backoff computed via helpers added in Task 4 — for now inline the constant 5 and set `next_retry_at` from a `nextRetryAtIso` argument computed by the caller; final shape below):

```ts
async getFailedMutations(userId: string): Promise<PendingMutation[]> {
  const rows = await querySQL<Record<string, unknown>>(
    `SELECT * FROM mutations_outbox WHERE user_id = ? AND status = 'failed' ORDER BY created_at`,
    [userId],
  );
  return rows.map(r => this.mapMutation(r));
}

async recordMutationFailures(failures: Array<{ id: string; error: string }>): Promise<void> {
  for (const f of failures) {
    const rows = await querySQL<{ attempts: number }>(
      `SELECT attempts FROM mutations_outbox WHERE id = ?`, [f.id],
    );
    if (!rows.length) continue;
    const attempts = Number(rows[0].attempts) + 1;
    const dead = attempts >= MAX_MUTATION_ATTEMPTS;
    const nextRetryAt = dead ? null : new Date(Date.now() + nextRetryDelayMs(attempts)).toISOString();
    await runSQL(
      `UPDATE mutations_outbox
          SET attempts = ?, last_error = ?, status = ?, next_retry_at = ?
        WHERE id = ?`,
      [attempts, f.error.slice(0, 500), dead ? 'failed' : 'pending', nextRetryAt, f.id],
    );
  }
}

async retryFailedMutation(id: string): Promise<void> {
  await runSQL(
    `UPDATE mutations_outbox
        SET status = 'pending', attempts = 0, next_retry_at = NULL, last_error = NULL
      WHERE id = ?`,
    [id],
  );
}
```

  (import `MAX_MUTATION_ATTEMPTS, nextRetryDelayMs` from `./sync-helpers` — added in Task 4; if implementing Tasks 3 and 4 in order, add the two exports to `sync-helpers.ts` now, they are two lines.)
  - `getActivityLogs` mapping gains `syncStatus: (r.sync_status as 'pending' | 'synced') ?? 'synced',`; `upsertActivityLog` gains the `sync_status` column: add `sync_status` to the column list, `record.syncStatus` to params, and `sync_status=excluded.sync_status` to the `DO UPDATE SET`.
- [ ] Fix the two `LocalActivityLog` construction sites that now fail typecheck:
  - `lib/local-store/sync-engine.ts` `activityLogs` mapping (line 156-169): add `syncStatus: 'synced' as const,`.
  - `components/activity/done-activity-screen.tsx` `store.upsertActivityLog({...})` (line 125-136): add `syncStatus: 'pending',`.
- [ ] Run `pnpm vitest run lib/sqlite/__tests__/migrations.test.ts` — passes. `pnpm test` — green.
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — clean.
- [ ] Commit: `local db v13: outbox retry accounting and activity sync_status`

---

### Task 4: Dead-letter wiring — attempts/backoff on per-item failure, stop after 5

**Files:**
- Modify: `lib/local-store/sync-helpers.ts` (add `MAX_MUTATION_ATTEMPTS`, `nextRetryDelayMs`)
- Modify: `lib/local-store/sync-engine.ts` (`pushMutations`)
- Modify: `lib/local-store/__tests__/sync-helpers.test.ts` (backoff cases)
- Create: `lib/local-store/__tests__/sync-engine.test.ts`

**Steps:**

- [ ] Add failing backoff tests to `lib/local-store/__tests__/sync-helpers.test.ts`:

```ts
import { MAX_MUTATION_ATTEMPTS, nextRetryDelayMs } from '../sync-helpers'

describe('nextRetryDelayMs', () => {
  it('backs off exponentially: 30s, 2m, 8m, 32m', () => {
    expect(nextRetryDelayMs(1)).toBe(30_000)
    expect(nextRetryDelayMs(2)).toBe(120_000)
    expect(nextRetryDelayMs(3)).toBe(480_000)
    expect(nextRetryDelayMs(4)).toBe(1_920_000)
  })
  it('caps at one hour', () => {
    expect(nextRetryDelayMs(10)).toBe(3_600_000)
  })
  it('dead-letters at five attempts', () => {
    expect(MAX_MUTATION_ATTEMPTS).toBe(5)
  })
})
```

- [ ] Run `pnpm vitest run lib/local-store/__tests__/sync-helpers.test.ts` — fails (exports missing).
- [ ] Add to `lib/local-store/sync-helpers.ts`:

```ts
export const MAX_MUTATION_ATTEMPTS = 5

// 30s · 4^(attempts-1), capped at 1h: 30s, 2m, 8m, 32m, then dead-letter.
export function nextRetryDelayMs(attempts: number): number {
  return Math.min(30_000 * 4 ** (attempts - 1), 60 * 60_000)
}
```

- [ ] Write the failing integration-style test `lib/local-store/__tests__/sync-engine.test.ts` (mocks the store factory and `fetch` — vitest runs in node, and `getLocalStore` would otherwise return null):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PendingMutation } from '../types'

const { fakeStore } = vi.hoisted(() => ({
  fakeStore: {
    getPendingMutations:    vi.fn(),
    deleteMutations:        vi.fn().mockResolvedValue(undefined),
    recordMutationFailures: vi.fn().mockResolvedValue(undefined),
    getFoodLogs:            vi.fn().mockResolvedValue([]),
    getStrandedPendingWorkouts: vi.fn().mockResolvedValue([]), // added in Task 9; harmless before
    queueMutation:          vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/local-store/index', () => ({ getLocalStore: () => fakeStore }))

import { pushMutations } from '../sync-engine'

function mut(id: string, domain: PendingMutation['domain'], date: string): PendingMutation {
  return { id, userId: 'u1', domain, date, payload: { id: `payload-${id}` },
           createdAt: '2026-07-01T00:00:00.000Z', attempts: 0, lastError: null,
           status: 'pending', nextRetryAt: null }
}

describe('pushMutations', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('deletes confirmed rows and records failures only for server-failed ids', async () => {
    fakeStore.getPendingMutations.mockResolvedValue([
      mut('ob-1', 'food_logs', '2026-07-01'),
      mut('ob-2', 'food_logs', '2026-07-01'),
    ])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ processed: 1, errors: [
        { id: 'ob-2', domain: 'food_logs', date: '2026-07-01', error: 'FK ownership check failed' },
      ] }),
    }))
    const res = await pushMutations('u1')
    expect(res).toEqual({ pushed: 1 })
    expect(fakeStore.deleteMutations).toHaveBeenCalledWith(['ob-1'])
    expect(fakeStore.recordMutationFailures).toHaveBeenCalledWith([
      { id: 'ob-2', error: 'FK ownership check failed' },
    ])
  })

  it('records no per-item failure on a transport-level 5xx', async () => {
    fakeStore.getPendingMutations.mockResolvedValue([mut('ob-1', 'body_metrics', '2026-07-01')])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const res = await pushMutations('u1')
    expect(res).toBeNull()
    expect(fakeStore.deleteMutations).not.toHaveBeenCalled()
    expect(fakeStore.recordMutationFailures).not.toHaveBeenCalled()
  })
})
```

- [ ] Run `pnpm vitest run lib/local-store/__tests__/sync-engine.test.ts` — fails (`recordMutationFailures` never called; sync-engine doesn't wire it yet).
- [ ] In `lib/local-store/sync-engine.ts` `pushMutations`, after computing `failed` (Task 2's map), record the failures per chunk:

```ts
const failed = resolveFailedOutboxIds(chunk, result.errors)
confirmed.push(...chunk.filter(m => !failed.has(m.id)))
if (failed.size) {
  // Per-item server rejections: bump attempts / schedule backoff / dead-letter
  // at MAX_MUTATION_ATTEMPTS. Transport failures (catch/!res.ok above) are
  // deliberately NOT counted — they say nothing about the mutation itself.
  await store.recordMutationFailures(
    [...failed.entries()].map(([id, error]) => ({ id, error })),
  ).catch(() => {})
}
```

  Note the semantics this creates end-to-end: rows returned by `getPendingMutations` are already filtered to `status='pending'` and due (`next_retry_at`), so a dead-lettered or backing-off row simply stops being pushed — no other change needed in the loop.
- [ ] Run both test files — pass. `pnpm test` — green.
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — clean.
- [ ] Commit: `sync: dead-letter mutations after five failed attempts`

---

### Task 5: A4 — 5xx wedge isolation (route try/catch, non-fatal getUserById, client backoff)

**Files:**
- Modify: `app/api/sync/push/route.ts` (lines 45-47)
- Modify: `lib/data/postgres/adapter.ts` (`pushMutations` pre-loop, lines 2457-2462)
- Modify: `lib/local-store/sync-helpers.ts` (+ `serverBackoffMs`)
- Modify: `lib/local-store/sync-engine.ts` (`pushMutations`)
- Modify: `lib/local-store/__tests__/sync-helpers.test.ts`

**Steps:**

- [ ] Add the failing test to `lib/local-store/__tests__/sync-helpers.test.ts`:

```ts
import { serverBackoffMs } from '../sync-helpers'

describe('serverBackoffMs', () => {
  it('backs off 30s, 1m, 2m … on consecutive 5xx responses', () => {
    expect(serverBackoffMs(1)).toBe(30_000)
    expect(serverBackoffMs(2)).toBe(60_000)
    expect(serverBackoffMs(3)).toBe(120_000)
  })
  it('caps at ten minutes', () => {
    expect(serverBackoffMs(8)).toBe(600_000)
  })
})
```

- [ ] Run `pnpm vitest run lib/local-store/__tests__/sync-helpers.test.ts` — fails.
- [ ] Add to `lib/local-store/sync-helpers.ts`:

```ts
// Whole-queue backoff after a 5xx from /api/sync/push: 30s · 2^(n-1), cap 10m.
export function serverBackoffMs(consecutive5xx: number): number {
  return Math.min(30_000 * 2 ** (consecutive5xx - 1), 10 * 60_000)
}
```

- [ ] In `lib/local-store/sync-engine.ts`, add module-level state next to `lastSyncMs`:

```ts
// After a 5xx from /api/sync/push, hold the whole queue back briefly instead
// of re-hitting a struggling server on every sync trigger. Per-item failures
// are handled separately (recordMutationFailures); this is transport-level.
let push5xxUntil = 0;
let consecutive5xx = 0;
```

  In `pushMutations`: early-return `if (Date.now() < push5xxUntil) return null;` right after the empty-queue check; replace `if (!res.ok) break;` with:

```ts
if (!res.ok) {
  if (res.status >= 500) {
    consecutive5xx += 1;
    push5xxUntil = Date.now() + serverBackoffMs(consecutive5xx);
  }
  break; // server error/overload — stop hammering, retry later
}
consecutive5xx = 0;
push5xxUntil = 0;
```

- [ ] In `app/api/sync/push/route.ts`, wrap the repo call so an adapter-level throw becomes a structured 500 (the client above now backs off instead of terminally wedging on the oldest chunk):

```ts
try {
  const repo = await getRepository();
  const result = await repo.pushMutations(userId, valid);
  return NextResponse.json(result);
} catch (err) {
  console.error('[sync/push] pushMutations threw', err);
  return NextResponse.json({ error: 'Sync push failed' }, { status: 500 });
}
```

- [ ] In `lib/data/postgres/adapter.ts` `pushMutations`, make the pre-loop timezone lookup non-fatal (a transient DB error here currently 500s the whole batch before any mutation is tried):

```ts
let userTz: string = DEFAULT_TZ
if (mutations.some(m => m.domain === 'workout_log')) {
  try {
    const user = await this.getUserById(userId)
    userTz = user?.timezone ?? DEFAULT_TZ
  } catch (err) {
    console.error('[pushMutations] getUserById failed; defaulting timezone', err)
  }
}
```

- [ ] Run `pnpm test` — green (the Task 4 sync-engine 5xx test still passes; add one more case there asserting a second immediate `pushMutations('u1')` call after a 500 returns `null` **without** calling fetch — proves the backoff gate: assert `fetch` mock call count stays 1).
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — clean.
- [ ] Local runtime check: `pnpm dev`, sign in as `test@local.dev` / `testpass123`, then from the browser console `fetch('/api/sync/push', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({mutations:[{domain:'supplement_logs',date:'2026-07-01',payload:{supplementId:'00000000-0000-0000-0000-000000000000',logDate:'2026-07-01'}}]})}).then(r=>r.json()).then(console.log)` — expect a 200 with a per-item error record (FK violation caught per-item), not a 500.
- [ ] Commit: `sync: keep one bad push chunk from wedging the queue`

---

### Task 6: Sync-health UI — dead-lettered rows with per-row Retry / Discard

**Files:**
- Create: `components/more/sync-health-card.tsx`
- Modify: `app/more/more-content.tsx` (render in the profile tab, line 122-124)

**Steps:**

- [ ] Create `components/more/sync-health-card.tsx` (small pure-render component; no unit test — it's UI over store methods already tested; verified on-device per the final checklist):

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { getLocalStore } from '@/lib/local-store';
import { pushMutations } from '@/lib/local-store/sync-engine';
import type { PendingMutation } from '@/lib/local-store/types';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const DOMAIN_LABELS: Record<PendingMutation['domain'], string> = {
  body_metrics:    'Body metrics',
  mood_logs:       'Mood check-in',
  food_logs:       'Food log',
  supplement_logs: 'Supplement log',
  injuries:        'Injury',
  supplements:     'Supplement',
  activity_logs:   'Activity',
  workout_log:     'Workout',
  day_checkins:    'Day check-in',
};

export function SyncHealthCard({ userId }: { userId?: string }) {
  const [failed, setFailed] = useState<PendingMutation[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const store = userId ? getLocalStore(userId) : null;
    if (!store) return;
    const [failedRows, pendingRows] = await Promise.all([
      store.getFailedMutations(userId!),
      store.getPendingMutations(userId!),
    ]);
    setFailed(failedRows);
    setPendingCount(pendingRows.length);
  }, [userId]);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  const handleRetry = useCallback(async (id: string) => {
    const store = userId ? getLocalStore(userId) : null;
    if (!store) return;
    setBusyId(id);
    try {
      await store.retryFailedMutation(id);
      await pushMutations(userId!);
      await refresh();
      const stillFailed = (await store.getFailedMutations(userId!)).some(m => m.id === id);
      if (stillFailed) toast.error('Still failing — see the error below');
      else toast.success('Synced');
    } finally {
      setBusyId(null);
    }
  }, [userId, refresh]);

  const handleDiscard = useCallback(async (id: string) => {
    const store = userId ? getLocalStore(userId) : null;
    if (!store) return;
    await store.deleteMutations([id]);
    await refresh();
    toast('Change discarded');
  }, [userId, refresh]);

  if (failed.length === 0) return null;

  return (
    <div className="mx-4 mt-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
        {failed.length} change{failed.length > 1 ? 's' : ''} failed to sync
        {pendingCount > 0 && (
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {pendingCount} waiting
          </span>
        )}
      </div>
      <ul className="mt-2 space-y-2">
        {failed.map(m => (
          <li key={m.id} className="rounded-lg bg-background/60 p-2">
            <div className="text-xs font-medium">
              {DOMAIN_LABELS[m.domain]} — {m.date}
            </div>
            <div className="mt-0.5 line-clamp-2 break-all text-[11px] text-muted-foreground">
              {m.lastError ?? 'Unknown error'} ({m.attempts} attempts)
            </div>
            <div className="mt-1.5 flex gap-2">
              <Button size="sm" variant="secondary" className="h-8 flex-1"
                      disabled={busyId === m.id} onClick={() => handleRetry(m.id)}>
                Retry
              </Button>
              <Button size="sm" variant="ghost" className="h-8 flex-1 text-destructive"
                      onClick={() => handleDiscard(m.id)}>
                Discard
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] In `app/more/more-content.tsx`: `import { SyncHealthCard } from '@/components/more/sync-health-card';` and render it at the top of the profile tab panel (line 122):

```tsx
<div style={{ display: tab === "profile" ? undefined : "none" }}>
  <SyncHealthCard userId={user?.id} />
  <ProfileTab ... />
</div>
```

- [ ] Run `pnpm lint` and `npx tsc --noEmit` — clean. `pnpm test` — green.
- [ ] Local runtime check: `pnpm dev` → More tab renders normally with no card (web has no SQLite, `getLocalStore` returns null → component renders nothing). No console errors.
- [ ] Commit: `more: surface dead-lettered sync mutations with retry/discard`

---

### Task 7: A5 — applyDelta pull-clobber guards (workout_sessions, activity_logs) + activity calories/start_time

**Files:**
- Modify: `lib/local-store/sqlite-backend.ts` (`applyDelta` workout_sessions branch lines 545-562, activity_logs branch lines 644-656)
- Modify: `lib/local-store/sync-engine.ts` (`pushMutations` confirm loop lines 365-394 — add `activity_logs` branch)
- Create: `lib/local-store/__tests__/sqlite-backend.test.ts`

**Steps:**

- [ ] Write the failing test `lib/local-store/__tests__/sqlite-backend.test.ts` (mocks the SQL layer; assertions target the guard clauses and column lists — the real DB behaviour is covered by the on-device checklist):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { runSQL, querySQL } = vi.hoisted(() => ({
  runSQL:   vi.fn().mockResolvedValue(undefined),
  querySQL: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/sqlite/sqlite-service', () => ({ runSQL, querySQL }))

import { SQLiteLocalStore } from '../sqlite-backend'

const store = new SQLiteLocalStore()

const workoutSession = {
  id: 'ws-1', sessionName: 'Session A', startedAt: '2026-07-01T08:00:00.000Z',
  completedAt: null, updatedAt: '2026-07-01T09:00:00.000Z', deletedAt: null,
  syncStatus: 'synced' as const,
}
const activityLog = {
  id: 'al-1', date: '2026-07-01', activityType: 'run', title: 'Morning run',
  durationMin: 30, distanceKm: 5, steps: null, avgHr: 150, maxHr: 170,
  caloriesBurned: 320, startTime: '07:15', updatedAt: '2026-07-01T09:00:00.000Z',
  syncStatus: 'synced' as const,
}

function sqlCalls(): string[] { return runSQL.mock.calls.map(c => String(c[0])) }

describe('applyDelta pull-clobber guards', () => {
  beforeEach(() => { vi.clearAllMocks(); querySQL.mockResolvedValue([]) })

  it('workout_sessions upsert only overwrites synced rows', async () => {
    await store.applyDelta({ workoutSessions: [workoutSession] })
    const stmt = sqlCalls().find(s => s.includes('INTO workout_sessions'))!
    expect(stmt).toContain(`WHERE workout_sessions.sync_status='synced'`)
  })

  it('workout_sessions delete spares pending local rows', async () => {
    await store.applyDelta({ workoutSessions: [{ ...workoutSession, deletedAt: '2026-07-01T10:00:00.000Z' }] })
    const stmt = sqlCalls().find(s => s.includes('DELETE FROM workout_sessions'))!
    expect(stmt).toContain(`sync_status='synced'`)
  })

  it('activity_logs upsert carries calories_burned/start_time and guards pending rows', async () => {
    await store.applyDelta({ activityLogs: [activityLog] })
    const stmt = sqlCalls().find(s => s.includes('INTO activity_logs'))!
    expect(stmt).toContain('calories_burned')
    expect(stmt).toContain('start_time')
    expect(stmt).toContain(`WHERE activity_logs.sync_status='synced'`)
    const params = runSQL.mock.calls.find(c => String(c[0]).includes('INTO activity_logs'))![1] as unknown[]
    expect(params).toContain(320)
    expect(params).toContain('07:15')
  })
})
```

- [ ] Run `pnpm vitest run lib/local-store/__tests__/sqlite-backend.test.ts` — fails (no guards, columns missing).
- [ ] In `applyDelta`, replace the `workout_sessions` branch:

```ts
for (const r of delta.workoutSessions ?? []) {
  if (r.deletedAt) {
    // Never delete a pending local session — it hasn't reached the server yet,
    // so the server's tombstone can't be about this row's latest state.
    await runSQL(`DELETE FROM workout_sessions WHERE id = ? AND sync_status='synced'`, [r.id]);
  } else {
    await runSQL(
      `INSERT INTO workout_sessions
         (id, session_name, started_at, completed_at, updated_at, synced, sync_status)
       VALUES (?,?,?,?,?,1,'synced')
       ON CONFLICT(id) DO UPDATE SET
         session_name=excluded.session_name,
         started_at=excluded.started_at,
         completed_at=excluded.completed_at,
         updated_at=excluded.updated_at,
         sync_status='synced'
       WHERE workout_sessions.sync_status='synced'`,
      [r.id, r.sessionName, r.startedAt, r.completedAt, r.updatedAt],
    );
  }
}
```

- [ ] Replace the `activity_logs` branch (adds `calories_burned` + `start_time`, which the server sends and `sync-engine.ts:166-167` already maps, plus the v13 guard):

```ts
for (const r of delta.activityLogs ?? []) {
  await runSQL(
    `INSERT INTO activity_logs
       (id, date, activity_type, title, duration_min, distance_km, steps,
        avg_hr, max_hr, calories_burned, start_time, updated_at, sync_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'synced')
     ON CONFLICT(id) DO UPDATE SET
       date=excluded.date, activity_type=excluded.activity_type,
       title=excluded.title, duration_min=excluded.duration_min,
       distance_km=excluded.distance_km, steps=excluded.steps,
       avg_hr=excluded.avg_hr, max_hr=excluded.max_hr,
       calories_burned=excluded.calories_burned, start_time=excluded.start_time,
       updated_at=excluded.updated_at, sync_status='synced'
     WHERE activity_logs.sync_status='synced'`,
    [r.id, r.date, r.activityType, r.title, r.durationMin, r.distanceKm,
     r.steps, r.avgHr, r.maxHr, r.caloriesBurned, r.startTime, r.updatedAt],
  );
}
```

- [ ] In `lib/local-store/sync-engine.ts` `pushMutations` confirm loop, add the missing `activity_logs` branch (without it, a locally-created activity stays `pending` forever and the new guard would block its own server hydration — including the server-computed `calories_burned`):

```ts
} else if (m.domain === 'activity_logs') {
  const recs = await store.getActivityLogs(m.date);
  const rec = recs.find(r => r.id === (m.payload.id as string));
  if (rec) await store.upsertActivityLog({ ...rec, syncStatus: 'synced' });
} else if (m.domain === 'workout_log') {
```

- [ ] Run the new test file — passes. `pnpm test` — green.
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — clean.
- [ ] Commit: `sync: stop pull deltas clobbering pending local workouts and activities`

---

### Task 8: A6 — `updatedAt`-gated last-write-wins for body_metrics / day_checkins / mood_logs + server-authoritative PRs

**Files:**
- Modify: `lib/local-store/sqlite-backend.ts` (`applyDelta` — bodyMetrics lines 502-513, moodLogs 515-526, dayCheckins 807-819, personalRecords 614-627)
- Modify: `lib/local-store/__tests__/sqlite-backend.test.ts`

**Steps:**

- [ ] Add failing tests to `lib/local-store/__tests__/sqlite-backend.test.ts`:

```ts
const bodyMetric = {
  date: '2026-07-01', weightKg: 82.5, bodyFatPct: null, steps: 9000, calories: null,
  proteinG: null, carbsG: null, fatG: null, waterMl: 1500, restingHeartRate: null,
  hrvMs: null, spo2Pct: null, updatedAt: '2026-07-01T09:00:00.000Z',
  deletedAt: null, syncStatus: 'synced' as const,
}
const personalRecord = {
  exerciseName: 'Bench Press', exerciseId: null, estimated1rm: 100,
  achievedAt: '2026-07-01T09:00:00.000Z', updatedAt: '2026-07-01T09:00:00.000Z',
  syncStatus: 'synced' as const,
}

describe('applyDelta timestamp-gated last-write-wins', () => {
  beforeEach(() => { vi.clearAllMocks(); querySQL.mockResolvedValue([]) })

  it('body_metrics only overwrite older synced rows', async () => {
    await store.applyDelta({ bodyMetrics: [bodyMetric] })
    const stmt = sqlCalls().find(s => s.includes('INTO body_metrics'))!
    expect(stmt).toContain(`WHERE body_metrics.sync_status='synced'`)
    expect(stmt).toContain('excluded.updated_at > body_metrics.updated_at')
  })

  it('personal_records take the server value verbatim (no MAX clamp)', async () => {
    await store.applyDelta({ personalRecords: [personalRecord] })
    const stmt = sqlCalls().find(s => s.includes('INTO personal_records'))!
    expect(stmt).not.toContain('MAX(')
    expect(stmt).toContain('estimated_1rm=excluded.estimated_1rm')
  })
})
```

- [ ] Run — fails (current code SELECTs sync_status then calls `upsertBodyMetric`; PR merge uses `MAX`).
- [ ] Replace the `bodyMetrics` branch in `applyDelta` — fold the pending-guard AND the timestamp gate into the upsert itself (both sides are `new Date().toISOString()`-format strings, so lexicographic comparison is chronological):

```ts
for (const r of delta.bodyMetrics ?? []) {
  if (r.deletedAt) {
    await runSQL(`DELETE FROM body_metrics WHERE date = ? AND sync_status='synced'`, [r.date]);
  } else {
    await runSQL(
      `INSERT INTO body_metrics
         (date, weight_kg, body_fat_pct, steps, calories, protein_g, carbs_g, fat_g,
          water_ml, resting_heart_rate, hrv_ms, spo2_pct, updated_at, deleted_at, sync_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'synced')
       ON CONFLICT(date) DO UPDATE SET
         weight_kg=excluded.weight_kg, body_fat_pct=excluded.body_fat_pct,
         steps=excluded.steps, calories=excluded.calories,
         protein_g=excluded.protein_g, carbs_g=excluded.carbs_g, fat_g=excluded.fat_g,
         water_ml=excluded.water_ml, resting_heart_rate=excluded.resting_heart_rate,
         hrv_ms=excluded.hrv_ms, spo2_pct=excluded.spo2_pct,
         updated_at=excluded.updated_at, deleted_at=excluded.deleted_at,
         sync_status='synced'
       WHERE body_metrics.sync_status='synced'
         AND excluded.updated_at > body_metrics.updated_at`,
      [r.date, r.weightKg, r.bodyFatPct, r.steps, r.calories, r.proteinG, r.carbsG,
       r.fatG, r.waterMl, r.restingHeartRate, r.hrvMs, r.spo2Pct, r.updatedAt, r.deletedAt],
    );
  }
}
```

- [ ] Apply the same shape to `moodLogs` (conflict target `log_date`, same column list as `upsertMoodLog`, `WHERE mood_logs.sync_status='synced' AND excluded.updated_at > mood_logs.updated_at`, delete gated on `sync_status='synced'`) and `dayCheckins` (conflict target `(log_date, phase)`, columns as `upsertDayCheckin`, `WHERE day_checkins.sync_status='synced' AND excluded.updated_at > day_checkins.updated_at`). This removes the `SELECT sync_status` pre-read for all three domains (part of A8's fold, done here because the SQL is rewritten anyway).
- [ ] Replace the `personalRecords` branch — the local mirror must accept server corrections downward (the `MAX()` clamp made a wrongly-high PR permanent; the server copy is authoritative because PRs are computed server-side, and the deliberate downward-reconcile is Batch C item C2):

```ts
for (const r of delta.personalRecords ?? []) {
  await runSQL(
    `INSERT INTO personal_records
       (exercise_name, exercise_id, estimated_1rm, achieved_at, updated_at, sync_status)
     VALUES (?,?,?,?,?,'synced')
     ON CONFLICT(exercise_name) DO UPDATE SET
       exercise_id=excluded.exercise_id,
       estimated_1rm=excluded.estimated_1rm,
       achieved_at=excluded.achieved_at,
       updated_at=excluded.updated_at,
       sync_status='synced'`,
    [r.exerciseName, r.exerciseId, r.estimated1rm, r.achievedAt, r.updatedAt],
  );
}
```

  Note for the plan record: today nothing on the server writes a PR downward — C2 (edit-path PR reconcile) is the writer; this change is the sync-side prerequisite so that when C2 lands, corrections actually propagate to devices.
- [ ] Run the test file — passes. `pnpm test` — green.
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — clean.
- [ ] Commit: `sync: gate singleton-day pulls on updatedAt and trust server PR values`

---

### Task 9: A7 — workout_log replay idempotency + stranded-pending re-queue

**Files:**
- Modify: `lib/data/postgres/adapter.ts` (`logExerciseAndSets` lines 735-845 — user_stats replay guard)
- Modify: `lib/local-store/sync-helpers.ts` (+ `buildWorkoutLogPayload`)
- Modify: `lib/local-store/sqlite-backend.ts` (+ `getStrandedPendingWorkouts`)
- Modify: `lib/local-store/index.ts` (interface + `LocalWorkoutHistory` reuse)
- Modify: `lib/local-store/sync-engine.ts` (`pushMutations` — re-queue sweep)
- Modify: `lib/local-store/__tests__/sync-helpers.test.ts`

**Verified during investigation (record in the PR description):** the direct-POST replay path is already id-idempotent — `workout-screen.tsx:615-624` generates client ids, `ensureWorkoutSession` upserts by `workoutSessionId`, and `logExerciseAndSets` (`adapter.ts:747-813`) does `ON CONFLICT(id) DO UPDATE` for both `exercise_logs` and `set_logs`. The two real gaps: (1) `user_stats` running totals (`adapter.ts:828-841`) increment again on every replay — a lost response then an outbox re-push double-counts volume/sets/sessions; (2) if the POST **and** `queueMutation` both throw (`workout-screen.tsx:685-690`), the local rows sit `pending` forever with no outbox entry.

**Steps:**

- [ ] Write the failing test for the payload builder in `lib/local-store/__tests__/sync-helpers.test.ts`:

```ts
import { buildWorkoutLogPayload } from '../sync-helpers'

const session = {
  id: 'ws-9', sessionName: 'Session B', startedAt: '2026-06-30T08:30:00.000Z',
  completedAt: null, updatedAt: '2026-06-30T09:10:00.000Z', deletedAt: null,
  syncStatus: 'pending' as const,
}
const exerciseLog = {
  id: 'el-9', workoutSessionId: 'ws-9', exerciseName: 'Squat',
  styleId: 'st-1', styleName: 'Heavy 5s', estimated1rm: 140, target80: 112,
  volume: null, avgReps: null, timeToComplete: 300, muscleGroups: ['quads'],
  loggedAt: '2026-06-30T08:45:00.000Z', interExerciseRestSec: 90,
  updatedAt: '2026-06-30T08:45:00.000Z', deletedAt: null, syncStatus: 'pending' as const,
  sets: [
    { id: 's-2', exerciseLogId: 'el-9', setNumber: 2, weightKg: 120, reps: 5,
      setTimeSec: 40, restTimeSec: 120, intensityPct: null, useFor1rm: true,
      setStartMs: null, setEndMs: null, rpe: 8, updatedAt: '2026-06-30T08:45:00.000Z',
      deletedAt: null, syncStatus: 'pending' as const },
    { id: 's-1', exerciseLogId: 'el-9', setNumber: 1, weightKg: 100, reps: 5,
      setTimeSec: 35, restTimeSec: 90, intensityPct: null, useFor1rm: false,
      setStartMs: null, setEndMs: null, rpe: null, updatedAt: '2026-06-30T08:45:00.000Z',
      deletedAt: null, syncStatus: 'pending' as const },
  ],
}

describe('buildWorkoutLogPayload', () => {
  it('rebuilds a schema-valid payload keyed on the original client ids, in set order', () => {
    const { date, payload } = buildWorkoutLogPayload(session, exerciseLog)
    expect(date).toBe('2026-06-30') // the log\'s own device-local date, not today
    expect(payload.workoutSessionId).toBe('ws-9')
    expect(payload.exerciseLogId).toBe('el-9')
    expect(payload.setLogIds).toEqual(['s-1', 's-2'])
    expect(payload.weights).toEqual([100, 120])
    expect(payload.reps).toEqual([5, 5])
    expect(payload.sets).toBe(2)
    expect(payload.styleId).toBe('st-1')
    // one set has no rpe → omit rpeValues entirely (schema requires ints 5-10)
    expect(payload.rpeValues).toBeUndefined()
  })
})
```

- [ ] Run — fails (export missing).
- [ ] Add to `lib/local-store/sync-helpers.ts`:

```ts
import type { LocalWorkoutSession, LocalExerciseLog, LocalSetLog } from './types'

// Rebuilds a LogExercisePayload-shaped outbox payload from local rows, for
// workouts stranded as sync_status='pending' with no outbox entry (direct POST
// failed AND queueMutation failed). Keyed on the original client ids so the
// server upsert path treats it as a replay, never a duplicate.
export function buildWorkoutLogPayload(
  session: LocalWorkoutSession,
  el: LocalExerciseLog & { sets: LocalSetLog[] },
): { date: string; payload: Record<string, unknown> } {
  const sets = [...el.sets].sort((a, b) => a.setNumber - b.setNumber)
  const everySetHasRpe = sets.length > 0 && sets.every(s => s.rpe != null)
  return {
    // The log's own device-local date (loggedAt was written with the device
    // clock at log time) — deliberately NOT todayInTz(): this is historical.
    date: el.loggedAt.slice(0, 10),
    payload: {
      workoutSessionId: session.id,
      exerciseLogId:    el.id,
      setLogIds:        sets.map(s => s.id),
      sessionName:      session.sessionName,
      exercise:         el.exerciseName,
      weights:          sets.map(s => s.weightKg),
      sets:             sets.length,
      reps:             sets.map(s => s.reps),
      localDate:        el.loggedAt,
      ...(el.timeToComplete != null ? { timeToCompleteSet: el.timeToComplete } : {}),
      ...(sets.some(s => s.setTimeSec != null)  ? { setTimes:  sets.map(s => s.setTimeSec ?? 0) }  : {}),
      ...(sets.some(s => s.restTimeSec != null) ? { restTimes: sets.map(s => s.restTimeSec ?? 0) } : {}),
      ...(everySetHasRpe ? { rpeValues: sets.map(s => s.rpe!) } : {}),
      ...(el.styleId ? { styleId: el.styleId } : {}),
      ...(el.styleName ? { styleName: el.styleName } : {}),
      ...(el.muscleGroups.length ? { muscleGroups: el.muscleGroups } : {}),
      ...(el.interExerciseRestSec != null ? { interExerciseRestSec: el.interExerciseRestSec } : {}),
      ...(el.estimated1rm != null ? { estimated1rm: el.estimated1rm } : {}),
      ...(el.target80 != null ? { target80: el.target80 } : {}),
      workoutStartedAt: new Date(session.startedAt).getTime(),
    },
  }
}
```

- [ ] Add `getStrandedPendingWorkouts` to `SQLiteLocalStore` (and the `LocalStore` interface: `getStrandedPendingWorkouts(cutoffIso: string): Promise<LocalWorkoutHistory[]>`):

```ts
// Pending sessions with no workout_log outbox entry — the double-failure case
// (direct POST failed, then queueMutation also failed). The payload LIKE match
// is safe because every workout_log payload embeds its workoutSessionId uuid.
async getStrandedPendingWorkouts(cutoffIso: string): Promise<LocalWorkoutHistory[]> {
  const rows = await querySQL<Record<string, unknown>>(
    `SELECT * FROM workout_sessions ws
      WHERE ws.sync_status='pending' AND ws.deleted_at IS NULL
        AND ws.updated_at < ?
        AND NOT EXISTS (
          SELECT 1 FROM mutations_outbox mo
           WHERE mo.domain='workout_log' AND mo.payload LIKE '%' || ws.id || '%'
        )`,
    [cutoffIso],
  );
  const result: LocalWorkoutHistory[] = [];
  for (const r of rows) {
    const session = {
      id: String(r.id), sessionName: String(r.session_name),
      startedAt: String(r.started_at),
      completedAt: r.completed_at ? String(r.completed_at) : null,
      updatedAt: String(r.updated_at),
      deletedAt: r.deleted_at ? String(r.deleted_at) : null,
      syncStatus: (r.sync_status as 'pending' | 'synced') ?? 'synced',
    };
    const exerciseLogs = await Promise.all(
      (await this.getExerciseLogs(session.id)).map(async el => ({
        ...el, sets: await this.getSetLogs(el.id),
      })),
    );
    result.push({ session, exerciseLogs });
  }
  return result;
}
```

- [ ] In `lib/local-store/sync-engine.ts` `pushMutations`, run the sweep before reading the queue (5-minute grace so an in-flight direct POST isn't raced):

```ts
// Re-queue workouts stranded by a double failure (POST threw AND queueMutation
// threw): pending locally, absent from the outbox. Grace period avoids racing
// a direct POST that is still in flight.
try {
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const stranded = await store.getStrandedPendingWorkouts(cutoff);
  for (const h of stranded) {
    for (const el of h.exerciseLogs) {
      const { date, payload } = buildWorkoutLogPayload(h.session, el);
      await store.queueMutation({ userId, domain: 'workout_log', date, payload });
    }
  }
} catch { /* sweep is best-effort; the normal queue still drains */ }

const pending = await store.getPendingMutations(userId);
```

  (import `buildWorkoutLogPayload` from `./sync-helpers`; the Task 4 test's `getStrandedPendingWorkouts: vi.fn().mockResolvedValue([])` already covers the mock.)
- [ ] Server replay guard in `lib/data/postgres/adapter.ts` `logExerciseAndSets`: before the exercise_logs insert (line 747), detect replay; skip the user_stats increment for replays:

```ts
const clientExerciseLogId = log.exerciseLogId ?? crypto.randomUUID()
// Replay detection: the client id already exists → this is a re-push of a
// commit whose response was lost. The row upserts are idempotent; the
// user_stats running totals below are NOT, so they must be skipped.
const [alreadyLogged] = await tx.select({ id: s.exerciseLogs.id })
  .from(s.exerciseLogs)
  .where(eq(s.exerciseLogs.id, clientExerciseLogId))
  .limit(1)
const isReplay = !!alreadyLogged
```

  and change line 828 `if (ws) {` → `if (ws && !isReplay) {`.
- [ ] Run `pnpm vitest run lib/local-store/__tests__/sync-helpers.test.ts` — passes. `pnpm test` — green.
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — clean.
- [ ] Local runtime check (`pnpm dev` + local Postgres): log a set via `POST /api/log-exercise` with fixed uuids, then re-POST the identical payload; verify with `psql "postgresql://postgres:postgres@localhost:5433/trainingai_dev" -c "SELECT total_sessions, total_sets, total_volume_kg FROM user_stats"` that totals did not double, and that `exercise_logs`/`set_logs` row counts are unchanged.
- [ ] Commit: `workout sync: skip stat totals on replays and requeue stranded logs`

---

### Task 10: A8a — `applyDelta` in one transaction + fold remaining SELECT-guards into the upserts

**Files:**
- Modify: `lib/local-store/sqlite-backend.ts` (`applyDelta` — wrap body; foodLogs 760-771, supplementLogs 777-792, injuries 794-805, exerciseLogs 564-588, setLogs 590-612)
- Modify: `lib/local-store/__tests__/sqlite-backend.test.ts`

**Steps:**

- [ ] Add failing tests:

```ts
describe('applyDelta batching', () => {
  beforeEach(() => { vi.clearAllMocks(); querySQL.mockResolvedValue([]) })

  it('runs inside a single BEGIN/COMMIT', async () => {
    await store.applyDelta({ workoutSessions: [workoutSession], activityLogs: [activityLog] })
    const stmts = sqlCalls()
    expect(stmts[0]).toBe('BEGIN')
    expect(stmts[stmts.length - 1]).toBe('COMMIT')
  })

  it('rolls back when a write fails', async () => {
    runSQL.mockImplementation(async (sql: string) => {
      if (String(sql).includes('INTO workout_sessions')) throw new Error('disk I/O')
    })
    await expect(store.applyDelta({ workoutSessions: [workoutSession] })).rejects.toThrow('disk I/O')
    expect(sqlCalls()).toContain('ROLLBACK')
  })

  it('needs no SELECT sync_status pre-reads (guards folded into upserts)', async () => {
    const foodLog = { id: 'fl-1', date: '2026-07-01', mealTypeId: 'mt-1', foodItemId: 'fi-1',
      quantityMultiplier: 1, loggedAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-01T12:00:00.000Z', deletedAt: null, syncStatus: 'synced' as const }
    await store.applyDelta({ foodLogs: [foodLog] })
    const selects = querySQL.mock.calls.map(c => String(c[0])).filter(s => s.includes('sync_status'))
    expect(selects).toEqual([])
    const stmt = sqlCalls().find(s => s.includes('INTO food_logs'))!
    expect(stmt).toContain(`WHERE food_logs.sync_status='synced'`)
  })
})
```

- [ ] Run — fails.
- [ ] Wrap the entire `applyDelta` body in a transaction (same pattern as `logWorkoutLocally:213-291`):

```ts
async applyDelta(delta: Parameters<LocalStore['applyDelta']>[0]): Promise<void> {
  try {
    await runSQL('BEGIN', []);
    // ...all existing per-domain loops...
    await runSQL('COMMIT', []);
  } catch (err) {
    await runSQL('ROLLBACK', []);
    throw err;
  }
}
```

- [ ] Fold each remaining `SELECT sync_status …; if (!existing.length || existing[0].sync_status === 'synced') { … }` pair into a guarded upsert, mirroring the Task 7/8 shape:
  - **foodLogs:** delete → `DELETE FROM food_logs WHERE id = ? AND sync_status='synced'`; upsert → the `upsertFoodLog` SQL inlined with `sync_status='synced'` literal and trailing `WHERE food_logs.sync_status='synced'`.
  - **supplementLogs:** delete → `DELETE FROM supplement_logs WHERE supplement_id=? AND log_date=? AND sync_status='synced'`; upsert → `upsertSupplementLog` SQL inlined + `WHERE supplement_logs.sync_status='synced'`.
  - **injuries:** delete → `DELETE FROM injuries WHERE id = ? AND sync_status='synced'`; upsert → `upsertInjury` SQL inlined + `WHERE injuries.sync_status='synced'`.
  - **exerciseLogs:** convert `INSERT OR REPLACE` (which cannot take a guard and resets unspecified columns) to `INSERT … ON CONFLICT(id) DO UPDATE SET workout_session_id=excluded.workout_session_id, exercise_name=excluded.exercise_name, style_id=excluded.style_id, style_name=excluded.style_name, estimated_1rm=excluded.estimated_1rm, target_80=excluded.target_80, volume=excluded.volume, avg_reps=excluded.avg_reps, time_to_complete=excluded.time_to_complete, muscle_groups=excluded.muscle_groups, logged_at=excluded.logged_at, inter_exercise_rest_sec=excluded.inter_exercise_rest_sec, updated_at=excluded.updated_at, synced=1, sync_status='synced' WHERE exercise_logs.sync_status='synced'`; delete gated `AND sync_status='synced'`.
  - **setLogs:** same conversion with the set_logs column list; delete gated `AND sync_status='synced'`.
- [ ] Run the test file — passes. `pnpm test` — green (the Task 7/8 guard tests must still pass unchanged — BEGIN/COMMIT wraps them).
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — clean.
- [ ] Commit: `sync: apply pull deltas in one transaction without per-row pre-reads`

---

### Task 11: A8b — `saveProgram` bulk inserts (kill the per-row N+1)

**Files:**
- Modify: `lib/data/postgres/slices/programs.ts` (lines 237-264)

**Steps:**

- [ ] Replace the per-session/per-exercise `insert().returning()` loops with pre-generated ids + two bulk inserts (id round-tripping semantics preserved — `sess.id`/`ex.id` are kept when present, exactly as the `.values({ ...(sess.id ? { id: sess.id } : {}) })` spread did; the periodization/workout-session restore code below the loop reads `savedSessions` the same way):

```ts
const sessionsWithIds = program.sessions.map(sess => ({
  sess,
  sessionId: sess.id ?? crypto.randomUUID(),
  exercises: sess.exercises.map(ex => ({ ex, exerciseId: ex.id ?? crypto.randomUUID() })),
}))

if (sessionsWithIds.length) {
  await tx.insert(s.programSessions).values(sessionsWithIds.map(({ sess, sessionId }) => ({
    id: sessionId,
    programId, name: sess.name, position: sess.position,
    icon: sess.icon ?? null,
    timeBudgetMinutes: sess.timeBudgetMinutes ?? 60,
  })))
  const exerciseRows = sessionsWithIds.flatMap(({ sessionId, exercises }) =>
    exercises.map(({ ex, exerciseId }) => ({
      id: exerciseId,
      sessionId, exerciseName: ex.exerciseName,
      styleId: ex.styleId ?? null,
      muscleGroups: ex.muscleGroups.map(mg => mg.toLowerCase()),
      position: ex.position,
      exerciseRole: ex.exerciseRole ?? 'primary',
    })))
  if (exerciseRows.length) await tx.insert(s.sessionExercises).values(exerciseRows)
}

const savedSessions: ProgramSession[] = sessionsWithIds.map(({ sess, sessionId, exercises }) => ({
  ...sess, id: sessionId, programId,
  exercises: exercises.map(({ ex, exerciseId }) => ({ ...ex, id: exerciseId, sessionId })),
}))
```

- [ ] Run `pnpm test` — green (no unit coverage exists for this slice; behaviour is verified at runtime below).
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — clean.
- [ ] Local runtime check (`pnpm dev`, local Postgres, sign in as `test@local.dev`): open the program editor, rename a session and an exercise, save, reload — structure intact; check `psql … -c "SELECT id, name, position FROM program_sessions ORDER BY position"` shows the round-tripped ids unchanged for pre-existing sessions.
- [ ] Commit: `programs: bulk-insert sessions and exercises on save`

---

### Task 12: A8c — paginated pull by `updatedAt` cursor + personal_records null-`achieved_at` fix

**Files:**
- Create: `lib/sync/cursor.ts`
- Create: `lib/sync/__tests__/cursor.test.ts`
- Modify: `lib/data/repository.ts` (`SyncDelta` — add `hasMore?: boolean`; `getSyncDelta` signature gains `pageLimit?: number`)
- Modify: `lib/data/postgres/adapter.ts` (`getSyncDelta` lines 2261-2451)
- Modify: `lib/local-store/sync-engine.ts` (`pullDelta` — page loop)

**Steps:**

- [ ] Write the failing test `lib/sync/__tests__/cursor.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveSyncCursor } from '../cursor'

const now = new Date('2026-07-01T10:00:00.000Z')

describe('resolveSyncCursor', () => {
  it('returns now / no-more when no domain hit its page limit', () => {
    const r = resolveSyncCursor([
      { maxUpdatedAt: new Date('2026-07-01T09:00:00.000Z'), hitLimit: false },
      { maxUpdatedAt: null, hitLimit: false },
    ], now)
    expect(r).toEqual({ syncedAt: now.toISOString(), hasMore: false })
  })

  it('cursors to 1ms before the earliest capped domain max (overlap, never skip)', () => {
    const r = resolveSyncCursor([
      { maxUpdatedAt: new Date('2026-07-01T08:00:00.000Z'), hitLimit: true },
      { maxUpdatedAt: new Date('2026-07-01T09:30:00.000Z'), hitLimit: true },
      { maxUpdatedAt: new Date('2026-07-01T09:59:00.000Z'), hitLimit: false },
    ], now)
    expect(r.hasMore).toBe(true)
    expect(r.syncedAt).toBe(new Date('2026-07-01T07:59:59.999Z').toISOString())
  })
})
```

- [ ] Run `pnpm vitest run lib/sync/__tests__/cursor.test.ts` — fails.
- [ ] Create `lib/sync/cursor.ts`:

```ts
export interface DomainPage {
  maxUpdatedAt: Date | null
  hitLimit:     boolean
}

// When any per-domain query returned a full page, the pull is incomplete:
// the client must re-pull with since = the earliest capped domain's max
// updatedAt, minus 1ms so rows sharing that exact timestamp are re-fetched
// on the next page (duplicates are safe — applyDelta upserts are idempotent;
// skipped rows are not).
export function resolveSyncCursor(
  pages: DomainPage[],
  now: Date,
): { syncedAt: string; hasMore: boolean } {
  const capped = pages.filter(p => p.hitLimit && p.maxUpdatedAt)
  if (capped.length === 0) return { syncedAt: now.toISOString(), hasMore: false }
  const cursorMs = Math.min(...capped.map(p => p.maxUpdatedAt!.getTime())) - 1
  return { syncedAt: new Date(cursorMs).toISOString(), hasMore: true }
}
```

- [ ] In `lib/data/repository.ts`: add `hasMore?: boolean;` to `SyncDelta` (after `syncedAt`), and change the interface method to `getSyncDelta(userId: string, since: Date, windowDays?: number, pageLimit?: number): Promise<SyncDelta>;`.
- [ ] In `adapter.ts` `getSyncDelta(userId, since, windowDays = 90, pageLimit = 500)`:
  - Import `asc, isNull, or` from `drizzle-orm` (extend the existing import).
  - Append `.orderBy(asc(<table>.updatedAt)).limit(pageLimit)` to the twelve row-heavy domain queries: `bodyMetrics`, `sleepSessions`, `moodLogs`, `activityLogs`, `workoutSessions`, `foodLogs`, `supplementLogs`, `injuries`, `exerciseLogs`, `setLogs`, `ouraDaily` (order by `s.ouraDaily.syncedAt`), `dayCheckins`. Program-structure tables, `supplements`, and `personalRecords` stay unpaginated (small, or keyed by parent).
  - Fix the personal_records filter (line 2353) so rows with null `achieved_at` are never dropped from the delta, and their mapped `updatedAt` is non-null:

```ts
.where(and(
  eq(s.personalRecords.userId, userId),
  or(isNull(s.personalRecords.achievedAt), gt(s.personalRecords.achievedAt, effectiveSince)),
))
```

  and in the return mapping: `personalRecords: personalRecords.map(r => ({ ...r, updatedAt: r.achievedAt ?? new Date(0) })),`.
  - Build the cursor from the paginated arrays and return it:

```ts
const now = new Date()
const page = (rows: { updatedAt: Date | string }[]) => ({
  hitLimit: rows.length === pageLimit,
  maxUpdatedAt: rows.length ? new Date(rows[rows.length - 1].updatedAt as string | Date) : null,
})
const { syncedAt, hasMore } = resolveSyncCursor([
  page(bodyMetrics), page(sleepSessions), page(moodLogs), page(activityLogs),
  page(workoutSessions), page(foodLogs), page(supplementLogs), page(injuries),
  page(exerciseLogs), page(setLogs), page(dayCheckins),
  { hitLimit: ouraDaily.length === pageLimit,
    maxUpdatedAt: ouraDaily.length ? new Date(ouraDaily[ouraDaily.length - 1].updatedAt as unknown as string | Date) : null },
], now)
```

  and replace `syncedAt: new Date().toISOString()` with `syncedAt, hasMore` in the returned object (`import { resolveSyncCursor } from '@/lib/sync/cursor'`).
- [ ] In `lib/local-store/sync-engine.ts` `pullDelta`: extract the existing fetch→map→`applyDelta`→`setLastSyncAt` body into a local `async function pullPage(sinceIso: string)` returning `{ count, domains, syncedAt, hasMore }`, then loop:

```ts
let sinceIso = lastSync.toISOString();
let total = 0;
const domains: SyncedDomains = { biometrics: false, programs: false, workouts: false };
for (let pageN = 0; pageN < 20; pageN++) {
  const pageResult = await pullPage(sinceIso);
  if (!pageResult) return pageN === 0 ? null : { synced: total, domains };
  total += pageResult.count;
  domains.biometrics ||= pageResult.domains.biometrics;
  domains.programs   ||= pageResult.domains.programs;
  domains.workouts   ||= pageResult.domains.workouts;
  sinceIso = pageResult.syncedAt;
  if (!pageResult.hasMore) break;
}
lastSyncMs = Date.now();
return { synced: total, domains };
```

  (`raw.hasMore` read as `Boolean((raw as { hasMore?: boolean }).hasMore)` — old servers omit it, which the loop treats as "one page, done": fully backwards compatible. `setLastSyncAt(raw.syncedAt)` stays inside `pullPage` so each page checkpoints — a crash mid-backfill resumes from the cursor, not from zero.)
- [ ] Run `pnpm vitest run lib/sync/__tests__/cursor.test.ts` — passes. `pnpm test` — green.
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — clean.
- [ ] Local runtime check: `pnpm dev`, sign in, `fetch('/api/sync/pull?since=1970-01-01T00:00:00.000Z').then(r=>r.json()).then(d=>console.log(d.hasMore, d.syncedAt, d.setLogs.length))` — with the seeded ~9 workouts everything fits one page (`hasMore` falsy/false); temporarily set `pageLimit = 5` locally and repeat to watch `hasMore: true` and an older `syncedAt` cursor, then revert.
- [ ] Commit: `sync: paginate the pull delta and stop dropping PRs with null achieved_at`

---

### Task 13: A9 — nutrition reads calories-burned from the local store first

**Files:**
- Modify: `app/nutrition/nutrition-content.tsx` (`fetchData`, lines 165-190)

`calsBurnedToday` is computed server-side as the sum of today's `activity_logs.calories_burned` (`app/api/body-metadata/route.ts:102-104`). The local store mirrors exactly those rows (and after Task 7 they carry `calories_burned` offline), so the page can compute the same number locally — the domain writes locally (`done-activity-screen.tsx:125`), so it must read locally first per the offline-first rule.

**Steps:**

- [ ] In `fetchData`, before the `Promise.all`, add a local-first read (the `cachedFetch` callback stays and overwrites with the authoritative server value whenever the network responds; offline, the callback never fires and the local value stands — same shape as the supplements reference pattern at lines 202-233):

```ts
const store = userId ? getLocalStore(userId) : null;
if (store) {
  try {
    const acts = (await store.getActivityLogs(today)).filter(a => a.date === today);
    if (acts.length) {
      setCalsBurnedToday(acts.reduce((sum, a) => sum + (a.caloriesBurned ?? 0), 0));
    }
  } catch { /* local store unavailable — server/cache path below still runs */ }
}
```

  (`getLocalStore` is already imported in this file; `today` is already the tz-correct `date ?? selectedDateRef.current`, originally seeded from `todayInTz()` — no new date construction.)
- [ ] Run `pnpm lint` and `npx tsc --noEmit` — clean. `pnpm test` — green.
- [ ] Local runtime check: `pnpm dev` → Nutrition tab renders identically (web store is null → pure fallback path).
- [ ] Commit: `nutrition: read calories-burned from the local store first`

---

### Task 14: Device (APK) verification checklist — MANDATORY before asking to merge

Capacitor SQLite does not run in the web/dev sandbox (`getLocalStore` returns null there), so **every** local-store change above passes web testing while the device path could still be broken. Per the project's offline-first rules, on-device is the authoritative check. Build the APK from the branch and verify on the Samsung Galaxy S25 Ultra:

- [ ] **v13 migration applies cleanly:** install over the previous build (not a fresh install), open the app, confirm no SQLite errors in logcat and that existing food/workout/activity history still renders. Then fresh-install and confirm first-open works too (reconcile path).
- [ ] **Poison-mutation dead-letter (A2/A3):** airplane mode → log 3 foods; before reconnecting, corrupt one via adb sqlite (set its outbox payload `foodItemId` to a random uuid) → reconnect → sync repeatedly. Expect: the 2 good logs confirm and disappear from the outbox on the first push (id-based confirm — the wedge is gone); the poisoned one retries with growing gaps, then appears in More → profile as a failed change after 5 attempts, with the FK error text; Discard removes it; the food list stays intact throughout.
- [ ] **Retry path:** dead-letter a mutation as above, fix the underlying row (restore the real `foodItemId`), tap Retry → toast "Synced", card disappears, row lands in Postgres.
- [ ] **5xx backoff (A4):** with the outbox non-empty, point the device at a build where `/api/sync/push` returns 500 (or kill the DB briefly): repeated foreground/background flips must NOT fire a push per flip (logcat: one push then silence for ≥30s), and the queue drains once the server recovers.
- [ ] **Pull-clobber guards (A5/A6):** airplane mode → log a workout set and an activity, edit today's water; while offline on device, change the same day's water from the web app; reconnect → sync. Expect: pending workout/activity/body-metric rows survive the pull (not reverted), then push and settle; the water value ends as whichever write had the later `updatedAt`.
- [ ] **Activity render offline (A5):** sync while online (pull server activities), airplane mode, cold-open → activity history shows calories and start times.
- [ ] **Stranded-workout sweep (A7):** airplane mode → log an exercise (direct POST fails); via adb, delete the resulting `workout_log` outbox row (simulates the double failure); wait >5 min, reconnect, sync → the workout re-queues and lands on the server exactly once (check `user_stats` totals increment once).
- [ ] **Cold backfill pagination (A8):** clear app data (or fresh install), sign in → full history hydrates across multiple pull pages without ANR/jank; airplane mode → food (any past date), workouts, activities all render.
- [ ] **Nutrition offline (A9):** log an activity, airplane mode, cold-open Nutrition → the calorie goal reflects the activity's burned calories from the local store.
- [ ] Update `projectOverview.md` (tick Batch A items A2–A9, note anything ⚠️ untested), bump `package.json` version (minor) + `lib/changelog.ts` entry, and append the session summary to the current `docs/overview/history-*.md` after the user confirms the merge.

---

## Self-review: A2–A9 coverage map

| Item | Task(s) |
|---|---|
| A2 id-based confirm end-to-end | 1 (server), 2 (client) |
| A3 attempts/last_error/status/next_retry_at + dead-letter after 5 | 3 (schema), 4 (wiring) |
| A3 sync-health UI with per-row Retry/Discard | 6 |
| A4 route try/catch, non-fatal getUserById, client 5xx backoff | 5 |
| A5 workout_sessions pending-guard | 7 |
| A5 activity_logs sync_status + guard | 3 (column), 7 (guard) |
| A5 calories_burned/start_time in activity upsert | 7 |
| A6 updatedAt-gated LWW (body_metrics/day_checkins/mood_logs) | 8 |
| A6 PR downward-correction (drop MAX clamp; C2 note) | 8 |
| A7 replay idempotency (user_stats) + double-failure stranding | 9 |
| A8 applyDelta transaction + guard folding | 8 (three LWW domains), 10 (rest + transaction) |
| A8 saveProgram bulk insert | 11 |
| A8 paginated pull by updatedAt cursor | 12 |
| A8 personal_records null-achievedAt delta fix | 12 |
| A9 nutrition body-metrics/calories read from local store | 13 |
| Device verification (offline-first rule #5) | 14 |

**Deliberately out of scope:** A1 (food_items in the pull delta — quick-wins plan); migrating the other known server-only read sites listed in CLAUDE.md (`mood_logs` session-select, `body_metrics` session-select, `injuries` workout-screen, `workout_log` aggregates) — A9 here covers only the nutrition read site named in the upgrade doc; C2's server-side PR downward-reconcile (Batch C); Postgres migration 103 indexes (quick win 4, Batch B).
