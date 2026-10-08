// #2338 — a night the user enters by hand, on the device.
//
// Drives the REAL schema (`MIGRATIONS` + `RECONCILE_COLUMNS`) and the REAL store on `node:sqlite`,
// built as a v50 device first so the v51 step is the one a phone runs, not a fresh install. What it
// pins: the local write (pending, manual, nothing measured), one manual night per date, the read that
// lets a device night win, a pull that cannot revert an unpushed entry, and the confirm guard.
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

const tolerate = (db: DatabaseSync, s: string) => { try { db.exec(s) } catch { /* the service tolerates an existing column */ } }

/** A device on v50: every migration up to it, every reconcile column except v51's. */
function v50Device() {
  const db = new DatabaseSync(':memory:')
  for (const m of MIGRATIONS.filter(m => m.toVersion <= 50)) for (const s of m.statements) tolerate(db, s)
  for (const c of RECONCILE_COLUMNS) if (!(c.table === 'sleep_sessions' && c.column === 'manual_entry')) tolerate(db, c.ddl)
  return db
}
/** Upgrade exactly as the service does: the v51 statements (which must apply cleanly), then reconcile. */
function upgradeToV51(db: DatabaseSync) {
  for (const s of MIGRATIONS.find(m => m.toVersion === 51)!.statements) db.exec(s)
  for (const c of RECONCILE_COLUMNS) tolerate(db, c.ddl)
}

const store = () => new SQLiteLocalStore()
const all = (sql: string, ...p: unknown[]) => local.db!.prepare(sql).all(...(p as never[])) as Record<string, unknown>[]

const DATE = '2026-10-07'
const NIGHT = {
  id: '6f1c2a4e-0b7d-4c1e-9a55-2338aa0000b1', date: DATE,
  sleepStart: '2026-10-06T12:30:00.000Z', sleepEnd: '2026-10-06T20:30:00.000Z',
  durationHours: 8, timeInBedHours: 8,
}
const RING: LocalSleepSession = {
  id: 'ring-1', date: DATE, durationHours: 6.4, deepSleepHours: 1, remSleepHours: 1.5, lightSleepHours: 3.9,
  sleepStart: '2026-10-06T13:10:00.000Z', sleepEnd: '2026-10-06T20:05:00.000Z', awakHours: 0.5,
  ouraId: 'ble:1', efficiency: 90, onsetLatencySec: 600, averageHrvMs: 50, avgHeartRate: 55,
  lowestHeartRate: 48, restlessPeriods: 10, sleepScore: null, respiratoryRate: 14, sleepPhase5Min: null,
  timeInBedHours: 7, manualSleepStart: null, manualEntry: false, syncStatus: 'synced',
  updatedAt: '2026-10-06T21:00:00.000Z',
}

beforeEach(() => {
  local.db = v50Device()
  // A device night pulled before the upgrade.
  local.db.exec(`INSERT INTO sleep_sessions (id, date, duration_hours, oura_id, sleep_start, sleep_end, updated_at, sync_status)
    VALUES ('old-ring', '2026-10-01', 7.5, 'ble:0', '2026-09-30T13:00:00.000Z', '2026-09-30T20:30:00.000Z', '2026-09-30T21:00:00.000Z', 'synced')`)
  upgradeToV51(local.db)
})

describe('the v51 upgrade', () => {
  it('keeps every existing row and reads it as a device night', async () => {
    const [row] = await store().getSleepSessions('2026-09-01')
    expect(row).toMatchObject({ id: 'old-ring', durationHours: 7.5, manualEntry: false })
  })
})

describe('upsertManualSleepLocally', () => {
  it('writes a pending manual row with its window and nothing measured, and returns its id', async () => {
    expect(await store().upsertManualSleepLocally(NIGHT)).toBe(NIGHT.id)
    expect(all(`SELECT * FROM sleep_sessions WHERE id=?`, NIGHT.id)[0]).toMatchObject({
      date: DATE, sleep_start: NIGHT.sleepStart, sleep_end: NIGHT.sleepEnd, duration_hours: 8,
      time_in_bed_hours: 8, awake_hours: null, efficiency: null, oura_id: null, average_hrv_ms: null,
      manual_entry: 1, sync_status: 'pending',
    })
  })

  it('reads back at once, before any push — offline is the normal case', async () => {
    await store().upsertManualSleepLocally(NIGHT)
    const rows = await store().getSleepSessions(DATE)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: NIGHT.id, manualEntry: true, durationHours: 8, syncStatus: 'pending' })
  })

  it('a second entry for the date edits the first and keeps its id', async () => {
    await store().upsertManualSleepLocally(NIGHT)
    const id = await store().upsertManualSleepLocally({ ...NIGHT, id: '6f1c2a4e-0b7d-4c1e-9a55-2338aa0000b2', sleepStart: '2026-10-06T13:30:00.000Z', durationHours: 7, timeInBedHours: 7 })
    expect(id).toBe(NIGHT.id)
    const manual = all(`SELECT id, sleep_start, duration_hours FROM sleep_sessions WHERE manual_entry=1`)
    expect(manual).toEqual([{ id: NIGHT.id, sleep_start: '2026-10-06T13:30:00.000Z', duration_hours: 7 }])
  })
})

describe('getSleepSessions ranks a device night above a typed one', () => {
  it('hides the manual night once the ring night for that sleep is pulled', async () => {
    await store().upsertManualSleepLocally(NIGHT)
    await store().applyDelta({ sleepSessions: [RING] })
    const rows = await store().getSleepSessions(DATE)
    expect(rows.map(r => r.id)).toEqual(['ring-1'])
    // Kept, not deleted: it is still the user's entry, and it is still on its way to the server.
    expect(all(`SELECT sync_status FROM sleep_sessions WHERE id=?`, NIGHT.id)).toEqual([{ sync_status: 'pending' }])
  })
})

describe('the pull and the confirm', () => {
  it('a pull carrying an older copy cannot revert an unpushed edit', async () => {
    await store().upsertManualSleepLocally(NIGHT)
    await store().applyDelta({ sleepSessions: [{ ...RING, id: NIGHT.id, ouraId: null, durationHours: 3, manualEntry: true, updatedAt: '2030-01-01T00:00:00.000Z' }] })
    expect(all(`SELECT duration_hours, manual_entry FROM sleep_sessions WHERE id=?`, NIGHT.id)).toEqual([{ duration_hours: 8, manual_entry: 1 }])
  })

  it('a pulled manual night lands with its marker', async () => {
    await store().applyDelta({ sleepSessions: [{ ...RING, id: 'from-web', ouraId: null, manualEntry: true }] })
    expect(all(`SELECT manual_entry FROM sleep_sessions WHERE id='from-web'`)).toEqual([{ manual_entry: 1 }])
  })

  it('confirm flips it to synced, unless another edit of the same night is still queued', async () => {
    await store().upsertManualSleepLocally(NIGHT)
    local.db!.prepare(`INSERT INTO mutations_outbox (id, user_id, domain, date, payload, created_at) VALUES (?, 'u', 'manual_sleep', ?, ?, ?)`)
      .run('m-1', DATE, JSON.stringify({ id: NIGHT.id }), '2026-10-07T00:00:00.000Z')
    local.db!.prepare(`INSERT INTO mutations_outbox (id, user_id, domain, date, payload, created_at) VALUES (?, 'u', 'manual_sleep', ?, ?, ?)`)
      .run('m-2', DATE, JSON.stringify({ id: NIGHT.id }), '2026-10-07T00:01:00.000Z')
    await store().markManualSleepSynced(NIGHT.id, ['m-1'])
    expect(all(`SELECT sync_status FROM sleep_sessions WHERE id=?`, NIGHT.id)).toEqual([{ sync_status: 'pending' }])
    await store().markManualSleepSynced(NIGHT.id, ['m-1', 'm-2'])
    expect(all(`SELECT sync_status FROM sleep_sessions WHERE id=?`, NIGHT.id)).toEqual([{ sync_status: 'synced' }])
  })

  it('confirm never touches a device row', async () => {
    await store().applyDelta({ sleepSessions: [{ ...RING, syncStatus: 'synced' }] })
    local.db!.exec(`UPDATE sleep_sessions SET sync_status='pending' WHERE id='ring-1'`)
    await store().markManualSleepSynced('ring-1')
    expect(all(`SELECT sync_status FROM sleep_sessions WHERE id='ring-1'`)).toEqual([{ sync_status: 'pending' }])
  })
})
