// DV-19 — one treadmill walk read as three device rows. The server keeps one activity per
// (date, start_time); a push that collides merges into the row already there, under that row's id,
// so the device's own confirmed row never comes back from the server and sits beside it forever.
// Applying the server's row for that minute must retire the orphan, and must leave alone a row
// that is still pending or sits at another second.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

const db = { current: null as DatabaseSync | null }
vi.mock('@/lib/sqlite/sqlite-service', () => ({
  runSQL: vi.fn(async (sql: string, p: unknown[] = []) => { db.current!.prepare(sql).run(...(p as never[])) }),
  querySQL: vi.fn(async (sql: string, p: unknown[] = []) => db.current!.prepare(sql).all(...(p as never[]))),
  beginTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(),
}))

import { SQLiteLocalStore } from '../sqlite-backend'

const ids = () => (db.current!.prepare(`SELECT id FROM activity_logs ORDER BY id`).all() as { id: string }[]).map(r => r.id)

const serverRow = (id: string, startTime: string) => ({
  id, date: '2026-09-24', activityType: 'treadmill', title: 'Treadmill interval walk',
  durationMin: 40, distanceKm: null, steps: null, avgHr: null, maxHr: null, caloriesBurned: 133,
  startTime, endTime: '09:58:00', notes: null, routePolyline: null, splits: null, bestEfforts: null,
  paceSeries: null, avgPaceSecPerKm: null, elevationGainM: null, elevationLossM: null,
  elevationProfile: null, cadenceSpm: null, cadenceSeries: null, cadenceSource: null, segments: null,
  updatedAt: '2026-09-24T23:19:13.245Z', deletedAt: null,
})

const apply = (rows: ReturnType<typeof serverRow>[]) =>
  new SQLiteLocalStore().applyDelta({ activityLogs: rows } as unknown as Parameters<SQLiteLocalStore['applyDelta']>[0])

beforeEach(() => {
  db.current = new DatabaseSync(':memory:')
  db.current.exec(`
    CREATE TABLE activity_logs (
      id TEXT PRIMARY KEY, date TEXT, activity_type TEXT, title TEXT, duration_min REAL, distance_km REAL,
      steps INTEGER, avg_hr INTEGER, max_hr INTEGER, calories_burned REAL, start_time TEXT, end_time TEXT,
      notes TEXT, route_polyline TEXT, splits TEXT, best_efforts TEXT, pace_series TEXT,
      avg_pace_sec_per_km REAL, elevation_gain_m REAL, elevation_loss_m REAL, elevation_profile TEXT,
      cadence_spm REAL, cadence_series TEXT, cadence_source TEXT, segments TEXT, updated_at TEXT,
      sync_status TEXT, deleted_at TEXT);
    INSERT INTO activity_logs (id, date, start_time, sync_status) VALUES
      ('device-own', '2026-09-24', '09:18', 'synced'),
      ('other-walk', '2026-09-24', '09:19', 'synced');
  `)
})

describe('applying the server row for a minute the device also holds (DV-19)', () => {
  it('retires the device row the push merged away, and keeps the one at another minute', async () => {
    await apply([serverRow('server-row', '09:18:00')])
    expect(ids()).toEqual(['other-walk', 'server-row'])
  })

  it('keeps a row still pending: its push has not happened, so it is not an orphan yet', async () => {
    db.current!.exec(`UPDATE activity_logs SET sync_status = 'pending' WHERE id = 'device-own'`)
    await apply([serverRow('server-row', '09:18:00')])
    expect(ids()).toEqual(['device-own', 'other-walk', 'server-row'])
  })

  it('keeps a row at the same minute but a different second, which the server can hold separately', async () => {
    db.current!.exec(`UPDATE activity_logs SET start_time = '09:18:30' WHERE id = 'device-own'`)
    await apply([serverRow('server-row', '09:18:00')])
    expect(ids()).toEqual(['device-own', 'other-walk', 'server-row'])
  })
})
