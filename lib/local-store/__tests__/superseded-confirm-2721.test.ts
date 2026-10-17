// Issue 2721 — the device half of "a stale phone cannot overwrite a newer workout log".
//
// ① `queueMutation` stamps `editedAt` (this phone's clock) on the three workout domains and nothing
//    else, and keeps a stamp a payload already carries.
// ② When the server answers a push with `superseded` (it kept a newer copy), the mutation is still
//    `processed`, so the push-confirm flips the local log and sets back to 'synced' and drops the
//    outbox entry. That is what lets the next pull overwrite the stale local copy: `applyDelta`
//    only ever writes over 'synced' rows, so a row left 'pending' would show the old weights forever.
//
// Real SQLite (node:sqlite, in memory) for the store, the real sync engine around it; only the
// network and the stranded-row sweeps (which need tables this test does not build) are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { SUPERSEDED_WARNING } from '@trainingai/shared/sync/edited-at'

const db = { current: null as DatabaseSync | null }
vi.mock('@/lib/sqlite/sqlite-service', () => ({
  runSQL: vi.fn(async (sql: string, p: unknown[] = []) => { db.current!.prepare(sql).run(...(p as never[])) }),
  querySQL: vi.fn(async (sql: string, p: unknown[] = []) => db.current!.prepare(sql).all(...(p as never[]))),
  withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}))

const { holder } = vi.hoisted(() => ({ holder: { store: null as unknown } }))
vi.mock('@/lib/local-store/index', () => ({ getLocalStore: () => holder.store }))

import { SQLiteLocalStore } from '../sqlite-backend'
import { pushMutations, _resetSyncBackoff } from '../sync-engine'

const USER = 'u-2721'
const all = (sql: string, ...p: unknown[]) => db.current!.prepare(sql).all(...(p as never[])) as Record<string, unknown>[]

function wire(real: SQLiteLocalStore) {
  // The sweeps read food and workout tables this test has no reason to build; they are not under test.
  holder.store = new Proxy(real, {
    get(target, key, receiver) {
      if (key === 'getStrandedPendingWorkouts') return async () => []
      if (key === 'requeueStrandedFoodItems' || key === 'requeueStrandedFoodTombstones') return async () => 0
      const v = Reflect.get(target, key, receiver)
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
}

const serverSet = (setNumber: number, weightKg: number) => ({
  id: `s-${setNumber}`, exerciseLogId: 'el-1', setNumber, weightKg, reps: 5, setTimeSec: null, restTimeSec: null,
  intensityPct: null, useFor1rm: false, setStartMs: null, setEndMs: null, rpe: null, plannedPct: null,
  plannedReps: null, plannedRestSec: null, plannedWeightKg: null, rpeSource: null,
  updatedAt: '2026-10-17T03:00:00Z', deletedAt: null,
})

beforeEach(() => {
  _resetSyncBackoff()
  db.current = new DatabaseSync(':memory:')
  db.current.exec(`
    CREATE TABLE mutations_outbox (
      id TEXT PRIMARY KEY, user_id TEXT, domain TEXT, date TEXT, payload TEXT, created_at TEXT,
      attempts INTEGER, last_error TEXT, status TEXT, next_retry_at TEXT);
    CREATE TABLE workout_sessions (id TEXT PRIMARY KEY, sync_status TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE exercise_logs (id TEXT PRIMARY KEY, workout_session_id TEXT, sync_status TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE set_logs (
      id TEXT PRIMARY KEY, exercise_log_id TEXT NOT NULL, set_number INTEGER NOT NULL,
      weight_kg REAL NOT NULL, reps INTEGER NOT NULL, set_time_sec INTEGER, rest_time_sec INTEGER,
      intensity_pct REAL, use_for_1rm INTEGER NOT NULL DEFAULT 0, set_start_ms INTEGER, set_end_ms INTEGER,
      rpe REAL, planned_pct REAL, planned_reps INTEGER, planned_rest_sec INTEGER, planned_weight_kg REAL, rpe_source TEXT,
      updated_at TEXT, synced INTEGER NOT NULL DEFAULT 0, sync_status TEXT, deleted_at TEXT);
    INSERT INTO workout_sessions VALUES ('ws-1', 'synced', '2026-10-17T00:00:00Z', NULL);
    INSERT INTO exercise_logs VALUES ('el-1', 'ws-1', 'synced', '2026-10-17T00:00:00Z', NULL);
    INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps, sync_status)
      VALUES ('s-1', 'el-1', 1, 100, 5, 'synced'), ('s-2', 'el-1', 2, 100, 5, 'synced');
  `)
  wire(new SQLiteLocalStore())
})

afterEach(() => { vi.unstubAllGlobals() })

const outboxPayloads = () => all(`SELECT domain, payload FROM mutations_outbox ORDER BY created_at`)
  .map(r => ({ domain: r.domain, payload: JSON.parse(String(r.payload)) as Record<string, unknown> }))

describe('queueMutation stamps editedAt (①)', () => {
  it('stamps the three workout domains with this phone\'s clock', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_760_700_000_000)
    const store = new SQLiteLocalStore()
    await store.queueMutation({ userId: USER, domain: 'exercise_log_edit', date: '2026-10-17', payload: { exerciseLogId: 'el-1', weights: [100], reps: [5] } })
    await store.queueMutation({ userId: USER, domain: 'exercise_log_delete', date: '2026-10-17', payload: { exerciseLogId: 'el-1' } })
    await store.queueMutation({ userId: USER, domain: 'workout_log', date: '2026-10-17', payload: { exerciseLogId: 'el-1' } })
    await store.queueMutation({ userId: USER, domain: 'mood_logs', date: '2026-10-17', payload: { id: 'm-1' } })
    vi.restoreAllMocks()
    const byDomain = Object.fromEntries(outboxPayloads().map(r => [r.domain, r.payload.editedAt]))
    expect(byDomain).toEqual({
      exercise_log_edit: 1_760_700_000_000,
      exercise_log_delete: 1_760_700_000_000,
      workout_log: 1_760_700_000_000,
      mood_logs: undefined,
    })
  })

  it('keeps a stamp the payload already carries (a re-queued stranded log keeps its own edit time)', async () => {
    await new SQLiteLocalStore().queueMutation({ userId: USER, domain: 'workout_log', date: '2026-10-17', payload: { exerciseLogId: 'el-1', editedAt: 1_700_000_000_000 } })
    expect(outboxPayloads()[0].payload.editedAt).toBe(1_700_000_000_000)
  })
})

describe('a superseded push confirms, so the next pull can overwrite the stale copy (②)', () => {
  it('leaves the log and its sets synced, clears the outbox, and the pull then brings the server\'s weights', async () => {
    const store = new SQLiteLocalStore()
    // The phone's offline edit, made before the server fixed the weights.
    await store.updateExerciseLogLocally('el-1', [{ setNumber: 1, weightKg: 100, reps: 5 }, { setNumber: 2, weightKg: 100, reps: 5 }], { pending: true })
    await store.queueMutation({ userId: USER, domain: 'exercise_log_edit', date: '2026-10-17', payload: { exerciseLogId: 'el-1', weights: [100, 100], reps: [5, 5] } })

    // A pull before the push cannot touch the pending row — the guard this whole path relies on.
    await store.applyDelta({ setLogs: [serverSet(1, 45.5), serverSet(2, 45.5)] } as never)
    expect(all(`SELECT weight_kg FROM set_logs ORDER BY set_number`).map(r => r.weight_kg)).toEqual([100, 100])

    let sent: { mutations: Array<{ id: string; domain: string; date: string; payload: Record<string, unknown> }> } | null = null
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body)
      const m = sent!.mutations[0]
      return { ok: true, status: 200, json: async () => ({
        processed: 1, errors: [], warnings: [{ id: m.id, domain: m.domain, date: m.date, warning: SUPERSEDED_WARNING }],
      }) }
    }))

    const result = await pushMutations(USER)

    expect(result).toEqual({ pushed: 1 })
    expect(typeof sent!.mutations[0].payload.editedAt).toBe('number')
    expect(all(`SELECT sync_status FROM exercise_logs WHERE id='el-1'`)[0].sync_status).toBe('synced')
    expect(all(`SELECT DISTINCT sync_status FROM set_logs`).map(r => r.sync_status)).toEqual(['synced'])
    expect(all(`SELECT COUNT(*) AS n FROM mutations_outbox`)[0].n).toBe(0)

    // The server touched the row, so the next pull carries it; now it lands.
    await store.applyDelta({ setLogs: [serverSet(1, 45.5), serverSet(2, 45.5)] } as never)
    expect(all(`SELECT weight_kg FROM set_logs WHERE deleted_at IS NULL ORDER BY set_number`).map(r => r.weight_kg)).toEqual([45.5, 45.5])
  })
})
