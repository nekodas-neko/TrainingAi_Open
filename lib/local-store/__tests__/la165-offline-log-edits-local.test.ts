// LA-165 — the device half of offline edits to logged work, against a real in-memory SQLite.
//
// ① An offline write must be 'pending' so a pull landing before its push cannot revert it.
// ② The push-confirm must flip it back — and the confirm guards counted the very mutation they were
//    confirming (the loop runs before `deleteMutations`), so `markSessionSynced` NEVER fired. That
//    pre-existing bug is pinned here too.
// ③ An edit that adds a set must show it, and the pull must not then show it twice.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

const db = { current: null as DatabaseSync | null }
vi.mock('@/lib/sqlite/sqlite-service', () => ({
  runSQL: vi.fn(async (sql: string, p: unknown[] = []) => { db.current!.prepare(sql).run(...(p as never[])) }),
  querySQL: vi.fn(async (sql: string, p: unknown[] = []) => db.current!.prepare(sql).all(...(p as never[]))),
  beginTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(),
}))

import { SQLiteLocalStore } from '../sqlite-backend'

const all = (sql: string, ...p: unknown[]) => db.current!.prepare(sql).all(...(p as never[])) as Record<string, unknown>[]
const store = () => new SQLiteLocalStore()

beforeEach(() => {
  db.current = new DatabaseSync(':memory:')
  db.current.exec(`
    CREATE TABLE mutations_outbox (id TEXT PRIMARY KEY, domain TEXT, payload TEXT);
    CREATE TABLE workout_sessions (id TEXT PRIMARY KEY, sync_status TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE exercise_logs (id TEXT PRIMARY KEY, workout_session_id TEXT, sync_status TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE set_logs (
      id TEXT PRIMARY KEY, exercise_log_id TEXT NOT NULL, set_number INTEGER NOT NULL,
      weight_kg REAL NOT NULL, reps INTEGER NOT NULL, set_time_sec INTEGER, rest_time_sec INTEGER,
      intensity_pct REAL, use_for_1rm INTEGER NOT NULL DEFAULT 0, set_start_ms INTEGER, set_end_ms INTEGER,
      rpe REAL, planned_pct REAL, planned_reps INTEGER, planned_rest_sec INTEGER,
      updated_at TEXT, synced INTEGER NOT NULL DEFAULT 0, sync_status TEXT, deleted_at TEXT);
    INSERT INTO workout_sessions VALUES ('ws-1', 'synced', '2026-09-20T00:00:00Z', NULL);
    INSERT INTO exercise_logs VALUES ('el-1', 'ws-1', 'synced', '2026-09-20T00:00:00Z', NULL);
    INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps, sync_status)
      VALUES ('s-1', 'el-1', 1, 40, 8, 'synced'), ('s-2', 'el-1', 2, 40, 8, 'synced');
  `)
})

const sets = () => all(`SELECT set_number, weight_kg, reps, sync_status FROM set_logs WHERE exercise_log_id='el-1' AND deleted_at IS NULL ORDER BY set_number`)

describe('pending mode (①)', () => {
  it('an offline edit leaves the log and its sets pending, so a pull cannot overwrite them', async () => {
    await store().updateExerciseLogLocally('el-1', [{ setNumber: 1, weightKg: 45, reps: 6 }, { setNumber: 2, weightKg: 45, reps: 6 }], { pending: true })
    expect(all(`SELECT sync_status FROM exercise_logs WHERE id='el-1'`)[0].sync_status).toBe('pending')
    expect(sets().map(s => s.sync_status)).toEqual(['pending', 'pending'])
  })

  it('the default still mirrors a confirmed write as synced', async () => {
    await store().updateExerciseLogLocally('el-1', [{ setNumber: 1, weightKg: 45, reps: 6 }])
    expect(all(`SELECT sync_status FROM exercise_logs WHERE id='el-1'`)[0].sync_status).toBe('synced')
  })

  it('offline deletes tombstone pending, for a log and for a whole session', async () => {
    await store().deleteExerciseLogLocally('el-1', { pending: true })
    expect(all(`SELECT sync_status, deleted_at IS NOT NULL AS gone FROM exercise_logs WHERE id='el-1'`)[0]).toEqual({ sync_status: 'pending', gone: 1 })
    await store().deleteWorkoutSessionLocally('ws-1', { pending: true })
    expect(all(`SELECT sync_status FROM workout_sessions WHERE id='ws-1'`)[0].sync_status).toBe('pending')
  })
})

describe('an edit that adds or re-adds a set (③)', () => {
  it('shows an added set, and truncates a removed one', async () => {
    await store().updateExerciseLogLocally('el-1', [
      { setNumber: 1, weightKg: 45, reps: 6 }, { setNumber: 2, weightKg: 45, reps: 6 }, { setNumber: 3, weightKg: 50, reps: 3 },
    ], { pending: true })
    expect(sets().map(s => [s.set_number, s.weight_kg])).toEqual([[1, 45], [2, 45], [3, 50]])
    await store().updateExerciseLogLocally('el-1', [{ setNumber: 1, weightKg: 45, reps: 6 }], { pending: true })
    expect(sets().map(s => s.set_number)).toEqual([1])
  })

  it('brings a truncated set back when the edit re-adds it, as the server upsert does', async () => {
    await store().updateExerciseLogLocally('el-1', [{ setNumber: 1, weightKg: 45, reps: 6 }], { pending: true })
    await store().updateExerciseLogLocally('el-1', [{ setNumber: 1, weightKg: 45, reps: 6 }, { setNumber: 2, weightKg: 42, reps: 7 }], { pending: true })
    expect(sets().map(s => [s.set_number, s.weight_kg])).toEqual([[1, 45], [2, 42]])
    expect(all(`SELECT COUNT(*) AS n FROM set_logs WHERE exercise_log_id='el-1' AND set_number=2`)[0].n).toBe(1)
  })

  it('the pull replaces a SYNCED local copy of the set with the server’s row, not beside it', async () => {
    await store().updateExerciseLogLocally('el-1', [
      { setNumber: 1, weightKg: 40, reps: 8 }, { setNumber: 2, weightKg: 40, reps: 8 }, { setNumber: 3, weightKg: 50, reps: 3 },
    ])
    await store().applyDelta({ setLogs: [{
      id: 'server-3', exerciseLogId: 'el-1', setNumber: 3, weightKg: 50, reps: 3, setTimeSec: null, restTimeSec: null,
      intensityPct: null, useFor1rm: false, setStartMs: null, setEndMs: null, rpe: null, plannedPct: null,
      plannedReps: null, plannedRestSec: null, updatedAt: '2026-09-28T00:00:00Z', deletedAt: null,
    }] } as never)
    expect(all(`SELECT id FROM set_logs WHERE exercise_log_id='el-1' AND set_number=3`)).toEqual([{ id: 'server-3' }])
  })

  it('but leaves a PENDING local copy alone — a pull never reverts an edit on its way', async () => {
    await store().updateExerciseLogLocally('el-1', [
      { setNumber: 1, weightKg: 40, reps: 8 }, { setNumber: 2, weightKg: 40, reps: 8 }, { setNumber: 3, weightKg: 50, reps: 3 },
    ], { pending: true })
    const localId = all(`SELECT id FROM set_logs WHERE exercise_log_id='el-1' AND set_number=3`)[0].id
    await store().applyDelta({ setLogs: [{
      id: 'server-3', exerciseLogId: 'el-1', setNumber: 3, weightKg: 50, reps: 3, setTimeSec: null, restTimeSec: null,
      intensityPct: null, useFor1rm: false, setStartMs: null, setEndMs: null, rpe: null, plannedPct: null,
      plannedReps: null, plannedRestSec: null, updatedAt: '2026-09-28T00:00:00Z', deletedAt: null,
    }] } as never)
    expect(all(`SELECT id FROM set_logs WHERE id=?`, localId)).toHaveLength(1)
  })
})

describe('push-confirms (②)', () => {
  const queue = (id: string, domain: string, payload: object) =>
    db.current!.prepare(`INSERT INTO mutations_outbox VALUES (?, ?, ?)`).run(id, domain, JSON.stringify(payload))

  it('markExerciseLogSynced flips the log once its own mutation is the one confirming', async () => {
    await store().updateExerciseLogLocally('el-1', [{ setNumber: 1, weightKg: 45, reps: 6 }], { pending: true })
    queue('m-1', 'exercise_log_edit', { exerciseLogId: 'el-1' })
    await store().markExerciseLogSynced('el-1', ['m-1'])
    expect(all(`SELECT sync_status FROM exercise_logs WHERE id='el-1'`)[0].sync_status).toBe('synced')
    expect(sets().map(s => s.sync_status)).toEqual(['synced'])
  })

  it('but waits while a LATER edit to the same log is still queued', async () => {
    await store().updateExerciseLogLocally('el-1', [{ setNumber: 1, weightKg: 45, reps: 6 }], { pending: true })
    queue('m-1', 'exercise_log_edit', { exerciseLogId: 'el-1' })
    queue('m-2', 'exercise_log_edit', { exerciseLogId: 'el-1' })
    await store().markExerciseLogSynced('el-1', ['m-1'])
    expect(all(`SELECT sync_status FROM exercise_logs WHERE id='el-1'`)[0].sync_status).toBe('pending')
  })

  it('markWorkoutSessionTreeSynced flips the session, its logs and their sets', async () => {
    await store().deleteWorkoutSessionLocally('ws-1', { pending: true })
    queue('m-1', 'workout_session_delete', { workoutSessionId: 'ws-1' })
    await store().markWorkoutSessionTreeSynced('ws-1', ['m-1'])
    expect(all(`SELECT sync_status FROM workout_sessions`)[0].sync_status).toBe('synced')
    expect(all(`SELECT DISTINCT sync_status FROM set_logs`).map(r => r.sync_status)).toEqual(['synced'])
  })

  it('markSessionSynced now fires when its own session_rpe is the one confirming (pre-existing bug)', async () => {
    db.current!.exec(`UPDATE workout_sessions SET sync_status='pending'`)
    queue('m-rpe', 'session_rpe', { workoutSessionId: 'ws-1', sessionRpe: 7 })
    await store().markSessionSynced('ws-1', ['m-rpe'])
    expect(all(`SELECT sync_status FROM workout_sessions`)[0].sync_status).toBe('synced')
  })

  it('and without the confirming ids it still behaves as before: it counts the mutation and waits', async () => {
    db.current!.exec(`UPDATE workout_sessions SET sync_status='pending'`)
    queue('m-rpe', 'session_rpe', { workoutSessionId: 'ws-1', sessionRpe: 7 })
    await store().markSessionSynced('ws-1')
    expect(all(`SELECT sync_status FROM workout_sessions`)[0].sync_status).toBe('pending')
  })
})
