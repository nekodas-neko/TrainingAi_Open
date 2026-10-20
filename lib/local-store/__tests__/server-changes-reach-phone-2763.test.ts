// Issues 2763 and 2721 (review notes A and B) — what a pull and a confirm do to the local store.
//
// ① A best re-dated into the past reaches the phone. `personal_records` has no `updated_at`, so the
//    server sends every best on every page (`personalRecordsComplete`) and the device replaces its
//    synced copy with that set. A best the phone has not pushed is never dropped or overwritten.
// ② A superseded `workout_log` confirm keeps the log's local sets. They stay `synced = 0` until a
//    pull, and the replay reuses the server's set ids, so there is nothing phantom to drop.
// ③ A pull snapshot older than a confirmed set tombstone cannot revive the set.
//
// Real SQLite (node:sqlite, in memory) for the store and the real sync engine around it; only the
// network is stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { SUPERSEDED_WARNING } from '@trainingai/shared/sync/edited-at'

const db = { current: null as DatabaseSync | null }
vi.mock('@/lib/sqlite/sqlite-service', () => ({
  runSQL: vi.fn(async (sql: string, p: unknown[] = []) => { db.current!.prepare(sql).run(...(p as never[])) }),
  querySQL: vi.fn(async (sql: string, p: unknown[] = []) => db.current!.prepare(sql).all(...(p as never[]))),
  withTransaction: vi.fn(async (fn: (tx: { run: (sql: string, p?: unknown[]) => Promise<void> }) => Promise<unknown>) => fn({ run: (await import('@/lib/sqlite/sqlite-service')).runSQL })),
}))

const { holder } = vi.hoisted(() => ({ holder: { store: null as unknown } }))
vi.mock('@/lib/local-store/index', () => ({ getLocalStore: () => holder.store }))

import { SQLiteLocalStore } from '../sqlite-backend'
import { pushMutations, pullDelta, _resetSyncBackoff } from '../sync-engine'

const USER = 'u-2763'
const all = (sql: string, ...p: unknown[]) => db.current!.prepare(sql).all(...(p as never[])) as Record<string, unknown>[]

function wire(real: SQLiteLocalStore) {
  holder.store = new Proxy(real, {
    get(target, key, receiver) {
      if (key === 'getStrandedPendingWorkouts') return async () => []
      if (key === 'requeueStrandedFoodItems' || key === 'requeueStrandedFoodTombstones') return async () => 0
      if (key === 'pruneProgramStructure') return async () => 0
      if (key === 'getSyncMeta') return async () => '2026-10-11T00:00:00.000Z'
      const v = Reflect.get(target, key, receiver)
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
}

const EMPTY_DELTA = {
  programs: [], programSessions: [], sessionExercises: [], schedules: [], scheduleDays: [],
  progressionStyles: [], styleSets: [], bodyMetrics: [], sleepSessions: [], moodLogs: [],
  activityLogs: [], fitnessTests: [], prescribedRuns: [], workoutSessions: [], exerciseLogs: [],
  setLogs: [], personalRecords: [], ouraDaily: [], ouraDailySummary: [], ouraDailyDerived: [],
  foodItems: [], foodLogs: [], supplements: [], supplementLogs: [], injuries: [], dayCheckins: [],
  syncedAt: '2026-10-17T05:00:00.000Z', hasMore: false,
}
const best = (exerciseName: string, estimated1rm: number, achievedAt: string) =>
  ({ exerciseName, exerciseId: null, estimated1rm, achievedAt, updatedAt: achievedAt })

function serveDelta(delta: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ...EMPTY_DELTA, ...delta }) })))
}

const serverSet = (setNumber: number, weightKg: number, updatedAt: string) => ({
  id: `s-${setNumber}`, exerciseLogId: 'el-1', setNumber, weightKg, reps: 5, setTimeSec: null, restTimeSec: null,
  intensityPct: null, useFor1rm: false, setStartMs: null, setEndMs: null, rpe: null, plannedPct: null,
  plannedReps: null, plannedRestSec: null, plannedWeightKg: null, rpeSource: null, updatedAt, deletedAt: null,
})

beforeEach(() => {
  _resetSyncBackoff()
  db.current = new DatabaseSync(':memory:')
  db.current.exec(`
    CREATE TABLE mutations_outbox (
      id TEXT PRIMARY KEY, user_id TEXT, domain TEXT, date TEXT, payload TEXT, created_at TEXT,
      attempts INTEGER, last_error TEXT, status TEXT, next_retry_at TEXT);
    CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE workout_sessions (id TEXT PRIMARY KEY, sync_status TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE exercise_logs (id TEXT PRIMARY KEY, workout_session_id TEXT, sync_status TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE set_logs (
      id TEXT PRIMARY KEY, exercise_log_id TEXT NOT NULL, set_number INTEGER NOT NULL,
      weight_kg REAL NOT NULL, reps INTEGER NOT NULL, set_time_sec INTEGER, rest_time_sec INTEGER,
      intensity_pct REAL, use_for_1rm INTEGER NOT NULL DEFAULT 0, set_start_ms INTEGER, set_end_ms INTEGER,
      rpe REAL, planned_pct REAL, planned_reps INTEGER, planned_rest_sec INTEGER, planned_weight_kg REAL, rpe_source TEXT,
      updated_at TEXT, synced INTEGER NOT NULL DEFAULT 0, sync_status TEXT, deleted_at TEXT);
    CREATE TABLE personal_records (
      exercise_name TEXT PRIMARY KEY, exercise_id TEXT, estimated_1rm REAL NOT NULL, achieved_at TEXT,
      updated_at TEXT NOT NULL, sync_status TEXT NOT NULL DEFAULT 'synced');
    INSERT INTO workout_sessions VALUES ('ws-1', 'synced', '2026-10-17T00:00:00Z', NULL);
    INSERT INTO exercise_logs VALUES ('el-1', 'ws-1', 'synced', '2026-10-17T00:00:00Z', NULL);
  `)
  wire(new SQLiteLocalStore())
})

afterEach(() => { vi.unstubAllGlobals() })

describe('a best re-dated into the past reaches the phone (#2763)', () => {
  const bests = () => all(`SELECT exercise_name, estimated_1rm, achieved_at FROM personal_records ORDER BY exercise_name`)

  beforeEach(() => {
    db.current!.exec(`
      INSERT INTO personal_records VALUES
        ('Squat', NULL, 150, '2026-10-16T01:00:00.000Z', '2026-10-16T01:00:00.000Z', 'synced'),
        ('Bench', NULL, 100, '2026-10-10T01:00:00.000Z', '2026-10-10T01:00:00.000Z', 'synced');
    `)
  })

  it('takes the re-dated value even though its date is older than the last pull', async () => {
    // Squat's best was edited down to an older log: lower value, an achieved_at before the last pull
    // (2026-10-16), which the old `achieved_at > since` filter could never select.
    serveDelta({
      personalRecordsComplete: true,
      personalRecords: [best('Squat', 140, '2026-09-01T01:00:00.000Z'), best('Bench', 100, '2026-10-10T01:00:00.000Z')],
    })

    const res = await pullDelta(USER, true)

    expect(bests()).toEqual([
      { exercise_name: 'Bench', estimated_1rm: 100, achieved_at: '2026-10-10T01:00:00.000Z' },
      { exercise_name: 'Squat', estimated_1rm: 140, achieved_at: '2026-09-01T01:00:00.000Z' },
    ])
    expect(res!.domains.workouts).toBe(true)
    expect(res!.synced).toBe(1)
  })

  it('drops a best the server no longer has', async () => {
    serveDelta({ personalRecordsComplete: true, personalRecords: [best('Bench', 100, '2026-10-10T01:00:00.000Z')] })

    const res = await pullDelta(USER, true)

    expect(bests().map(b => b.exercise_name)).toEqual(['Bench'])
    expect(res!.domains.workouts).toBe(true)
  })

  it('reports nothing changed when the server\'s set matches the phone\'s', async () => {
    serveDelta({
      personalRecordsComplete: true,
      personalRecords: [best('Squat', 150, '2026-10-16T01:00:00.000Z'), best('Bench', 100, '2026-10-10T01:00:00.000Z')],
    })

    const res = await pullDelta(USER, true)

    expect(res!.synced).toBe(0)
    expect(res!.domains.workouts).toBe(false)
  })

  it('never drops or overwrites a best the phone created and has not pushed', async () => {
    db.current!.exec(`INSERT INTO personal_records VALUES ('Deadlift', NULL, 200, '2026-10-17T01:00:00.000Z', '2026-10-17T01:00:00.000Z', 'pending')`)
    serveDelta({
      personalRecordsComplete: true,
      personalRecords: [best('Deadlift', 180, '2026-09-01T01:00:00.000Z'), best('Bench', 100, '2026-10-10T01:00:00.000Z')],
    })

    await pullDelta(USER, true)

    expect(bests().find(b => b.exercise_name === 'Deadlift')).toEqual(
      { exercise_name: 'Deadlift', estimated_1rm: 200, achieved_at: '2026-10-17T01:00:00.000Z' })
    expect(bests().map(b => b.exercise_name)).toEqual(['Bench', 'Deadlift'])
  })

  it('keeps a pending best the server has never heard of when it prunes', async () => {
    // Absent from the server's set, so only the `sync_status = 'synced'` guard in the prune protects it.
    db.current!.exec(`INSERT INTO personal_records VALUES ('Press', NULL, 70, '2026-10-17T01:00:00.000Z', '2026-10-17T01:00:00.000Z', 'pending')`)
    serveDelta({
      personalRecordsComplete: true,
      personalRecords: [best('Squat', 150, '2026-10-16T01:00:00.000Z'), best('Bench', 100, '2026-10-10T01:00:00.000Z')],
    })

    await pullDelta(USER, true)

    expect(bests().map(b => b.exercise_name)).toEqual(['Bench', 'Press', 'Squat'])
  })

  it('prunes nothing when the reply carries the flag but no array', async () => {
    serveDelta({ personalRecordsComplete: true, personalRecords: undefined })

    await pullDelta(USER, true)

    expect(bests().map(b => b.exercise_name)).toEqual(['Bench', 'Squat'])
  })

  it('treats a delta without the flag as a window and prunes nothing', async () => {
    serveDelta({ personalRecords: [best('Bench', 105, '2026-10-17T01:00:00.000Z')] })

    await pullDelta(USER, true)

    expect(bests().map(b => b.exercise_name)).toEqual(['Bench', 'Squat'])
    expect(bests().find(b => b.exercise_name === 'Bench')!.estimated_1rm).toBe(105)
  })
})

describe('a superseded workout_log confirm keeps the log\'s local sets (#2721 note A)', () => {
  function answerSuperseded() {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const m = JSON.parse(init.body).mutations[0]
      return { ok: true, status: 200, json: async () => ({
        processed: 1, errors: [], warnings: [{ id: m.id, domain: m.domain, date: m.date, warning: SUPERSEDED_WARNING }],
      }) }
    }))
  }
  const liveSets = () => all(`SELECT id, set_number, weight_kg FROM set_logs WHERE deleted_at IS NULL ORDER BY set_number`)
    .map(r => [r.id, r.set_number, r.weight_kg])

  it('leaves the sets in place until the pull brings the server\'s', async () => {
    // Logged on the phone: the sets are 'pending' and `synced = 0` (nothing has pulled them back).
    db.current!.exec(`
      UPDATE exercise_logs SET sync_status = 'pending' WHERE id = 'el-1';
      INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps, synced, sync_status)
        VALUES ('s-1', 'el-1', 1, 100, 5, 0, 'pending'), ('s-2', 'el-1', 2, 100, 5, 0, 'pending');`)
    const store = new SQLiteLocalStore()
    await store.queueMutation({ userId: USER, domain: 'workout_log', date: '2026-10-17',
      payload: { workoutSessionId: 'ws-1', exerciseLogId: 'el-1', exercise: 'Squat', weights: [100, 100], reps: [5, 5] } })

    answerSuperseded()
    expect(await pushMutations(USER)).toEqual({ pushed: 1 })

    expect(liveSets()).toEqual([['s-1', 1, 100], ['s-2', 2, 100]])
    expect(all(`SELECT sync_status FROM exercise_logs WHERE id='el-1'`)[0].sync_status).toBe('synced')

    await store.applyDelta({ setLogs: [serverSet(1, 45.5, '2026-10-17T03:00:00Z'), serverSet(2, 45.5, '2026-10-17T03:00:00Z')] } as never)
    expect(liveSets()).toEqual([['s-1', 1, 45.5], ['s-2', 2, 45.5]])
  })
})

describe('a stale snapshot cannot revive a confirmed set tombstone (#2721 note B)', () => {
  const tombstone = () => {
    db.current!.exec(`
      INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps, synced, sync_status, updated_at, deleted_at)
        VALUES ('s-1', 'el-1', 1, 100, 5, 1, 'synced', '2026-10-17T02:00:00.000Z', '2026-10-17T02:30:00.000Z');`)
  }
  const row = () => all(`SELECT weight_kg, deleted_at FROM set_logs WHERE id='s-1'`)[0]

  it('keeps the tombstone when the snapshot is older', async () => {
    tombstone()
    await new SQLiteLocalStore().applyDelta({ setLogs: [serverSet(1, 100, '2026-10-17T01:00:00.000Z')] } as never)
    expect(row().deleted_at).toBe('2026-10-17T02:30:00.000Z')
  })

  it('clears the tombstone when the server row is newer (the superseded-edit case)', async () => {
    tombstone()
    await new SQLiteLocalStore().applyDelta({ setLogs: [serverSet(1, 45.5, '2026-10-17T03:00:00.000Z')] } as never)
    expect(row()).toEqual({ weight_kg: 45.5, deleted_at: null })
  })

  it('still updates a live synced set from an older-or-equal snapshot as before', async () => {
    db.current!.exec(`INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps, synced, sync_status, updated_at)
      VALUES ('s-1', 'el-1', 1, 100, 5, 1, 'synced', '2026-10-17T02:00:00.000Z')`)
    await new SQLiteLocalStore().applyDelta({ setLogs: [serverSet(1, 90, '2026-10-17T01:00:00.000Z')] } as never)
    expect(row().weight_kg).toBe(90)
  })
})
