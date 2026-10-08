// Issue 2606 — removing a hand-entered night, on the device.
//
// Drives the REAL schema (`MIGRATIONS` + `RECONCILE_COLUMNS`) and the REAL store on `node:sqlite`,
// built as a v51 device first so the v52 step is the one a phone runs, not a fresh install. What it
// pins: the upgrade, the local removal (hidden at once, pending, device nights refused), the pull
// applying a server tombstone, a stale pull never resurrecting a removal, a newer live copy reviving
// it, and re-entering a removed night bringing the same row back.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

const local = { db: null as DatabaseSync | null }
const bindable = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)
vi.mock('@/lib/sqlite/sqlite-service', () => ({
  runSQL: vi.fn(async (sql: string, p: unknown[] = []) => { local.db!.prepare(sql).run(...(p.map(bindable) as never[])) }),
  querySQL: vi.fn(async (sql: string, p: unknown[] = []) => local.db!.prepare(sql).all(...(p.map(bindable) as never[]))),
  beginTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(),
  isSQLiteAvailable: () => true, isLocalStoreDead: () => false,
}))

import { MIGRATIONS, RECONCILE_COLUMNS } from '@/lib/sqlite/migrations'
import { SQLiteLocalStore } from '../sqlite-backend'
import type { LocalSleepSession } from '../types'

const tolerate = (db: DatabaseSync, s: string) => { try { db.exec(s) } catch { /* the service tolerates an existing column */ } }

/** A device on v51: every migration up to it, every reconcile column except v52's. */
function v51Device() {
  const db = new DatabaseSync(':memory:')
  for (const m of MIGRATIONS.filter(m => m.toVersion <= 51)) for (const s of m.statements) tolerate(db, s)
  for (const c of RECONCILE_COLUMNS) if (!(c.table === 'sleep_sessions' && c.column === 'deleted_at')) tolerate(db, c.ddl)
  return db
}
/** Upgrade exactly as the service does: the v52 statements (which must apply cleanly), then reconcile. */
function upgradeToV52(db: DatabaseSync) {
  for (const s of MIGRATIONS.find(m => m.toVersion === 52)!.statements) db.exec(s)
  for (const c of RECONCILE_COLUMNS) tolerate(db, c.ddl)
}

const store = () => new SQLiteLocalStore()
const all = (sql: string, ...p: unknown[]) => local.db!.prepare(sql).all(...(p as never[])) as Record<string, unknown>[]

const DATE = '2026-10-07'
const NIGHT = {
  id: '6f1c2a4e-0b7d-4c1e-9a55-2606aa0000c1', date: DATE,
  sleepStart: '2026-10-06T12:30:00.000Z', sleepEnd: '2026-10-06T20:30:00.000Z',
  durationHours: 8, timeInBedHours: 8,
}
/** The server's copy of NIGHT, as the pull carries it. */
const PULLED: LocalSleepSession = {
  id: NIGHT.id, date: DATE, durationHours: 8, deepSleepHours: null, remSleepHours: null, lightSleepHours: null,
  sleepStart: NIGHT.sleepStart, sleepEnd: NIGHT.sleepEnd, awakHours: null, ouraId: null, efficiency: null,
  onsetLatencySec: null, averageHrvMs: null, avgHeartRate: null, lowestHeartRate: null, restlessPeriods: null,
  sleepScore: null, respiratoryRate: null, sleepPhase5Min: null, timeInBedHours: 8, manualSleepStart: null,
  manualEntry: true, deletedAt: null, syncStatus: 'synced', updatedAt: '2026-10-07T00:00:00.000Z',
}

beforeEach(() => {
  local.db = v51Device()
  // A device night and a typed night pulled before the upgrade.
  local.db.exec(`INSERT INTO sleep_sessions (id, date, duration_hours, oura_id, sleep_start, sleep_end, manual_entry, updated_at, sync_status)
    VALUES ('old-ring', '2026-10-01', 7.5, 'ble:0', '2026-09-30T13:00:00.000Z', '2026-09-30T20:30:00.000Z', 0, '2026-09-30T21:00:00.000Z', 'synced'),
           ('old-typed', '2026-10-02', 8, NULL, '2026-10-01T12:30:00.000Z', '2026-10-01T20:30:00.000Z', 1, '2026-10-01T21:00:00.000Z', 'synced')`)
  upgradeToV52(local.db)
})

describe('the v52 upgrade', () => {
  it('adds deleted_at, keeps every existing row, and reads every one as live', async () => {
    expect(all(`SELECT name FROM pragma_table_info('sleep_sessions') WHERE name = 'deleted_at'`)).toEqual([{ name: 'deleted_at' }])
    expect(all(`SELECT id, deleted_at FROM sleep_sessions ORDER BY id`)).toEqual([
      { id: 'old-ring', deleted_at: null }, { id: 'old-typed', deleted_at: null },
    ])
    expect((await store().getSleepSessions('2026-09-01')).map(r => r.id)).toEqual(['old-ring', 'old-typed'])
  })
})

describe('removeManualSleepLocally', () => {
  it('marks a typed night removed and pending, hides it at once, and answers with its date', async () => {
    await store().upsertManualSleepLocally(NIGHT)
    expect(await store().removeManualSleepLocally(NIGHT.id)).toBe(DATE)
    expect(all(`SELECT deleted_at IS NOT NULL AS removed, sync_status, manual_entry, duration_hours FROM sleep_sessions WHERE id=?`, NIGHT.id))
      .toEqual([{ removed: 1, sync_status: 'pending', manual_entry: 1, duration_hours: 8 }])
    expect(await store().getSleepSessions(DATE)).toEqual([])
  })

  it('removes a synced typed night pulled from the server too', async () => {
    expect(await store().removeManualSleepLocally('old-typed')).toBe('2026-10-02')
    expect((await store().getSleepSessions('2026-09-01')).map(r => r.id)).toEqual(['old-ring'])
  })

  it('refuses a device night and an unknown id, changing nothing', async () => {
    expect(await store().removeManualSleepLocally('old-ring')).toBeNull()
    expect(await store().removeManualSleepLocally('nope')).toBeNull()
    expect(all(`SELECT id, deleted_at, sync_status FROM sleep_sessions WHERE id='old-ring'`))
      .toEqual([{ id: 'old-ring', deleted_at: null, sync_status: 'synced' }])
  })

  it('removing twice keeps the first removal time', async () => {
    await store().upsertManualSleepLocally(NIGHT)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T03:00:00.000Z'))
    await store().removeManualSleepLocally(NIGHT.id)
    vi.setSystemTime(new Date('2026-10-07T04:00:00.000Z'))
    await store().removeManualSleepLocally(NIGHT.id)
    vi.useRealTimers()
    expect(all(`SELECT deleted_at FROM sleep_sessions WHERE id=?`, NIGHT.id)).toEqual([{ deleted_at: '2026-10-07T03:00:00.000Z' }])
  })

  it('a remembered bedtime is never written onto a removed night', async () => {
    await store().upsertManualSleepLocally(NIGHT)
    await store().removeManualSleepLocally(NIGHT.id)
    await store().setManualSleepStartLocally(DATE, '2026-10-06T12:00:00.000Z')
    expect(all(`SELECT manual_sleep_start FROM sleep_sessions WHERE id=?`, NIGHT.id)).toEqual([{ manual_sleep_start: null }])
  })
})

describe('the pull and a removed night', () => {
  it('applies a server tombstone to a synced row and hides it', async () => {
    await store().applyDelta({ sleepSessions: [PULLED] })
    expect((await store().getSleepSessions(DATE)).map(r => r.id)).toEqual([NIGHT.id])
    await store().applyDelta({ sleepSessions: [{ ...PULLED, deletedAt: '2026-10-07T01:00:00.000Z', updatedAt: '2026-10-07T01:00:00.000Z' }] })
    expect(await store().getSleepSessions(DATE)).toEqual([])
    expect(all(`SELECT deleted_at FROM sleep_sessions WHERE id=?`, NIGHT.id)).toEqual([{ deleted_at: '2026-10-07T01:00:00.000Z' }])
  })

  it('a tombstone for a row the device never held lands hidden', async () => {
    await store().applyDelta({ sleepSessions: [{ ...PULLED, deletedAt: '2026-10-07T01:00:00.000Z' }] })
    expect(await store().getSleepSessions(DATE)).toEqual([])
  })

  it('a pull cannot bring back an unpushed removal', async () => {
    await store().applyDelta({ sleepSessions: [PULLED] })
    await store().removeManualSleepLocally(NIGHT.id)
    await store().applyDelta({ sleepSessions: [{ ...PULLED, durationHours: 7, updatedAt: '2030-01-01T00:00:00.000Z' }] })
    expect(await store().getSleepSessions(DATE)).toEqual([])
  })

  it('once confirmed, a stale (older) live copy does not resurrect it', async () => {
    await store().applyDelta({ sleepSessions: [PULLED] })
    await store().removeManualSleepLocally(NIGHT.id)
    await store().markManualSleepSynced(NIGHT.id)
    await store().applyDelta({ sleepSessions: [PULLED] }) // the pre-removal copy, updated_at older
    expect(await store().getSleepSessions(DATE)).toEqual([])
  })

  it('a NEWER live copy brings it back — the night was entered again, or a device measured it', async () => {
    await store().applyDelta({ sleepSessions: [{ ...PULLED, deletedAt: '2026-10-07T01:00:00.000Z', updatedAt: '2026-10-07T01:00:00.000Z' }] })
    await store().applyDelta({ sleepSessions: [{ ...PULLED, manualEntry: false, ouraId: null, durationHours: 7.2, updatedAt: '2026-10-07T02:00:00.000Z' }] })
    const rows = await store().getSleepSessions(DATE)
    expect(rows.map(r => [r.id, r.manualEntry, r.durationHours])).toEqual([[NIGHT.id, false, 7.2]])
  })
})

describe('entering a removed night again', () => {
  it('brings the same row back under its id, live and pending, rather than adding a second', async () => {
    await store().upsertManualSleepLocally(NIGHT)
    await store().removeManualSleepLocally(NIGHT.id)
    const id = await store().upsertManualSleepLocally({ ...NIGHT, id: '6f1c2a4e-0b7d-4c1e-9a55-2606aa0000c2', sleepStart: '2026-10-06T13:30:00.000Z', durationHours: 7, timeInBedHours: 7 })
    expect(id).toBe(NIGHT.id)
    expect(all(`SELECT id, deleted_at, sync_status, duration_hours FROM sleep_sessions WHERE manual_entry=1 AND date=?`, DATE))
      .toEqual([{ id: NIGHT.id, deleted_at: null, sync_status: 'pending', duration_hours: 7 }])
    expect((await store().getSleepSessions(DATE)).map(r => r.id)).toEqual([NIGHT.id])
  })

  it('prefers the date\'s live night over a removed one', async () => {
    await store().upsertManualSleepLocally(NIGHT)
    await store().removeManualSleepLocally(NIGHT.id)
    local.db!.exec(`INSERT INTO sleep_sessions (id, date, duration_hours, sleep_start, sleep_end, manual_entry, updated_at, sync_status)
      VALUES ('live-typed', '${DATE}', 6, '2026-10-06T14:00:00.000Z', '2026-10-06T20:00:00.000Z', 1, '2026-10-07T00:30:00.000Z', 'synced')`)
    expect(await store().upsertManualSleepLocally({ ...NIGHT, id: 'fresh' })).toBe('live-typed')
    expect(all(`SELECT deleted_at IS NOT NULL AS removed FROM sleep_sessions WHERE id=?`, NIGHT.id)).toEqual([{ removed: 1 }])
  })
})

// Issue 2660 — the stored sleep score for a removed night's wake date goes with it, offline too.
describe('the stored sleep score and a removed night', () => {
  const seedDerived = (day: string) => local.db!.exec(
    `INSERT INTO oura_daily_derived (day, sleep_score, sleep_contributors, readiness_score, updated_at, sync_status)
     VALUES ('${day}', 81, '{"x":1}', 77, '2026-10-07T00:00:00.000Z', 'synced')`)
  const derived = (day: string) => all(`SELECT sleep_score, sleep_contributors, readiness_score FROM oura_daily_derived WHERE day=?`, day)

  it('clears both sleep columns when no other night is left on the date, and nothing else', async () => {
    await store().upsertManualSleepLocally(NIGHT)
    seedDerived(DATE)
    await store().removeManualSleepLocally(NIGHT.id)
    expect(derived(DATE)).toEqual([{ sleep_score: null, sleep_contributors: null, readiness_score: 77 }])
  })

  it('clears nothing while a device night remains on the date', async () => {
    seedDerived('2026-10-01') // old-ring (device) is on this date
    local.db!.exec(`INSERT INTO sleep_sessions (id, date, duration_hours, manual_entry, updated_at, sync_status)
      VALUES ('typed-same-day', '2026-10-01', 1, 1, '2026-10-01T22:00:00.000Z', 'synced')`)
    await store().removeManualSleepLocally('typed-same-day')
    expect(derived('2026-10-01')).toEqual([{ sleep_score: 81, sleep_contributors: '{"x":1}', readiness_score: 77 }])
  })

  it('a device night is refused and its date keeps the score', async () => {
    seedDerived('2026-10-01')
    expect(await store().removeManualSleepLocally('old-ring')).toBeNull()
    expect(derived('2026-10-01')[0].sleep_score).toBe(81)
  })

  it('a pull carries the server null over a stale local score (applyDelta writes the columns as sent)', async () => {
    seedDerived(DATE)
    await store().applyDelta({ ouraDailyDerived: [{
      day: DATE, sleepScore: null, sleepContributors: null, readinessScore: 77, updatedAt: '2026-10-08T00:00:00.000Z',
    } as never] })
    expect(derived(DATE)).toEqual([{ sleep_score: null, sleep_contributors: null, readiness_score: 77 }])
  })
})
