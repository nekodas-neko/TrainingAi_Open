// #2414 — a device upgrading to SQLite v50 keeps every sleep row it had, reads the new window as
// NULL on those rows, and fills that window when the server re-sends the row unchanged.
//
// Drives the REAL schema (`MIGRATIONS` + `RECONCILE_COLUMNS`) and the REAL store on `node:sqlite`,
// built as a v49 device first, so the upgrade step is the one a phone runs, not a fresh install.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

const local = { db: null as DatabaseSync | null }
const bindable = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)
vi.mock('@/lib/sqlite/sqlite-service', () => ({
  runSQL: vi.fn(async (sql: string, p: unknown[] = []) => { local.db!.prepare(sql).run(...(p.map(bindable) as never[])) }),
  querySQL: vi.fn(async (sql: string, p: unknown[] = []) => local.db!.prepare(sql).all(...(p.map(bindable) as never[]))),
  withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  isSQLiteAvailable: () => true, isLocalStoreDead: () => false,
}))

import { MIGRATIONS, RECONCILE_COLUMNS } from '@/lib/sqlite/migrations'
import { SQLiteLocalStore } from '../sqlite-backend'
import type { LocalSleepSession } from '../types'

const NEW = new Set(['sleep_start', 'sleep_end', 'awake_hours'])
const tolerate = (db: DatabaseSync, s: string) => { try { db.exec(s) } catch { /* the service tolerates an existing column */ } }

/** A device on v49: every migration up to it, every reconcile column except v50's. */
function v49Device() {
  const db = new DatabaseSync(':memory:')
  for (const m of MIGRATIONS.filter(m => m.toVersion <= 49)) for (const s of m.statements) tolerate(db, s)
  for (const c of RECONCILE_COLUMNS) if (!(c.table === 'sleep_sessions' && NEW.has(c.column))) tolerate(db, c.ddl)
  return db
}

/** Upgrade exactly as the service does: the v50 statements, then reconcile. */
function upgradeToV50(db: DatabaseSync) {
  for (const s of MIGRATIONS.find(m => m.toVersion === 50)!.statements) db.exec(s)
  for (const c of RECONCILE_COLUMNS) tolerate(db, c.ddl)
}

const UPDATED = '2026-10-06T21:00:00.000Z'
const pulled: LocalSleepSession = {
  id: 'ss-1', date: '2026-10-06', durationHours: 7.67, deepSleepHours: 1.2, remSleepHours: 1.8,
  lightSleepHours: 4.3, sleepStart: '2026-10-05T12:16:00.000Z', sleepEnd: '2026-10-05T20:21:00.000Z',
  awakHours: 0.4, ouraId: 'ble:1', efficiency: 90, onsetLatencySec: 600, averageHrvMs: 50,
  avgHeartRate: 55, lowestHeartRate: 48, restlessPeriods: 10, sleepScore: 80, respiratoryRate: 14,
  sleepPhase5Min: '1122334411', timeInBedHours: 8.1, manualSleepStart: null, manualEntry: false,
  syncStatus: 'synced', updatedAt: UPDATED,
}

describe('sleep_sessions window across the v50 upgrade (#2414)', () => {
  beforeEach(() => {
    local.db = v49Device()
    // A night pulled before v50: no window columns exist yet.
    local.db.exec(`INSERT INTO sleep_sessions (id, date, duration_hours, deep_sleep_hours, rem_sleep_hours,
      light_sleep_hours, oura_id, sleep_phase_5_min, updated_at, sync_status)
      VALUES ('ss-1','2026-10-06',7.67,1.2,1.8,4.3,'ble:1','1122334411','${UPDATED}','synced')`)
    upgradeToV50(local.db)
  })

  it('keeps the pre-v50 row and reads its window as null — it renders exactly as before', async () => {
    const [row] = await new SQLiteLocalStore().getSleepSessions('2026-10-01')
    expect(row.durationHours).toBe(7.67)
    expect(row.sleepPhase5Min).toBe('1122334411')
    expect(row.sleepStart).toBeNull()
    expect(row.sleepEnd).toBeNull()
    expect(row.awakHours).toBeNull()
  })

  it('fills the window when the server re-sends the row with the SAME updated_at', async () => {
    const store = new SQLiteLocalStore()
    await store.applyDelta({ sleepSessions: [pulled] })
    const [row] = await store.getSleepSessions('2026-10-01')
    expect(row.sleepStart).toBe('2026-10-05T12:16:00.000Z')
    expect(row.sleepEnd).toBe('2026-10-05T20:21:00.000Z')
    expect(row.awakHours).toBe(0.4)
  })

  it('a stale re-send cannot revert a row that already has its window', async () => {
    const store = new SQLiteLocalStore()
    await store.applyDelta({ sleepSessions: [{ ...pulled, updatedAt: '2026-10-06T22:00:00.000Z' }] })
    await store.applyDelta({ sleepSessions: [{ ...pulled, durationHours: 1, updatedAt: UPDATED }] })
    const [row] = await store.getSleepSessions('2026-10-01')
    expect(row.durationHours).toBe(7.67)
  })

  it('never touches a pending (device-authored) row, window or not', async () => {
    local.db!.exec(`UPDATE sleep_sessions SET sync_status='pending' WHERE id='ss-1'`)
    const store = new SQLiteLocalStore()
    await store.applyDelta({ sleepSessions: [{ ...pulled, durationHours: 1 }] })
    const [row] = await store.getSleepSessions('2026-10-01')
    expect(row.sleepStart).toBeNull()
    expect(row.durationHours).toBe(7.67)
  })
})
