// #3060 — Oura's period type reaches the device, so the cold-open seed keeps a `sleep` fragment out
// of its `long_sleep` night exactly as the server's card does (#3057).
//
// Drives the REAL schema (`MIGRATIONS` + `RECONCILE_COLUMNS`) and the REAL store on `node:sqlite`,
// built as a v52 device first, so the upgrade step is the one a phone runs. The night is the 19 Oct
// shape #3057 pins: a short `sleep` fragment, then the `long_sleep` main period 37 minutes later.
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
import { localSleepRowsAsNights, mergeByDate } from '@/lib/sleep/merge-sessions'

const TZ = 'Australia/Brisbane'
const tolerate = (db: DatabaseSync, s: string) => { try { db.exec(s) } catch { /* the service tolerates an existing column */ } }

/** A device on v52: every migration up to it, every reconcile column except v53's. */
function v52Device() {
  const db = new DatabaseSync(':memory:')
  for (const m of MIGRATIONS.filter(m => m.toVersion <= 52)) for (const s of m.statements) tolerate(db, s)
  for (const c of RECONCILE_COLUMNS) if (!(c.table === 'sleep_sessions' && c.column === 'oura_sleep_type')) tolerate(db, c.ddl)
  return db
}

/** Upgrade exactly as the service does: the v53 statements, then reconcile. */
function upgradeToV53(db: DatabaseSync) {
  for (const s of MIGRATIONS.find(m => m.toVersion === 53)!.statements) db.exec(s)
  for (const c of RECONCILE_COLUMNS) tolerate(db, c.ddl)
}

const UPDATED = '2026-10-19T00:00:00.000Z'
const base: Omit<LocalSleepSession, 'id' | 'ouraId' | 'sleepStart' | 'sleepEnd'> = {
  date: '2026-10-19', durationHours: null, deepSleepHours: null, remSleepHours: null, lightSleepHours: null,
  awakHours: null, efficiency: null, onsetLatencySec: null, averageHrvMs: null, avgHeartRate: null,
  lowestHeartRate: null, restlessPeriods: null, sleepScore: null, respiratoryRate: null,
  sleepPhase5Min: null, timeInBedHours: null, manualSleepStart: null, manualEntry: false,
  syncStatus: 'synced', updatedAt: UPDATED,
}
const fragment: LocalSleepSession = {
  ...base, id: 'ss-frag', ouraId: 'oura-fragment', ouraSleepType: 'sleep',
  sleepStart: '2026-10-18T13:05:00.000Z', sleepEnd: '2026-10-18T13:25:00.000Z',
  durationHours: 2 / 60, awakHours: 18 / 60, efficiency: 10, onsetLatencySec: 0,
}
const main: LocalSleepSession = {
  ...base, id: 'ss-main', ouraId: 'oura-main', ouraSleepType: 'long_sleep',
  sleepStart: '2026-10-18T14:02:00.000Z', sleepEnd: '2026-10-18T20:46:00.000Z',
  durationHours: 6 + 4 / 60, awakHours: 40 / 60, efficiency: 90, onsetLatencySec: 600,
}

describe('Oura sleep type on the device across the v53 upgrade (#3060)', () => {
  beforeEach(() => {
    local.db = v52Device()
    upgradeToV53(local.db)
  })

  it('a pulled night keeps its type, and the seed is the long_sleep period alone, as the server card is', async () => {
    const store = new SQLiteLocalStore()
    await store.applyDelta({ sleepSessions: [fragment, main] })
    const rows = await store.getSleepSessions('2026-10-01')
    expect(rows.map(r => [r.id, r.ouraSleepType]).sort()).toEqual([['ss-frag', 'sleep'], ['ss-main', 'long_sleep']])

    const seed = localSleepRowsAsNights(rows, TZ)
    expect(seed).toHaveLength(1)
    expect(seed[0].sleepStart).toBe(main.sleepStart) // 00:02 local, not the fragment's 23:05
    expect(seed[0].awakHours).toBe(main.awakHours) // the fragment's awake time is not added
    expect(seed[0].efficiency).toBe(90)

    // The route's own merge of the same rows, which is what replaces the seed.
    const server = mergeByDate(rows.map(r => ({ ...r, sleepTimeRecommendation: null })), TZ)
    expect(seed[0]).toMatchObject({ sleepStart: server[0].sleepStart, sleepEnd: server[0].sleepEnd, awakHours: server[0].awakHours, durationHours: server[0].durationHours })
  })

  it('a row pulled before v53 reads its type as unknown and the seed merges it, as it always did', async () => {
    local.db!.exec(`INSERT INTO sleep_sessions (id, date, oura_id, sleep_start, sleep_end, duration_hours, awake_hours, efficiency, updated_at, sync_status)
      VALUES ('ss-frag','2026-10-19','oura-fragment','${fragment.sleepStart}','${fragment.sleepEnd}',${fragment.durationHours},${fragment.awakHours},10,'${UPDATED}','synced'),
             ('ss-main','2026-10-19','oura-main','${main.sleepStart}','${main.sleepEnd}',${main.durationHours},${main.awakHours},90,'${UPDATED}','synced')`)
    const rows = await new SQLiteLocalStore().getSleepSessions('2026-10-01')
    expect(rows.every(r => r.ouraSleepType === null)).toBe(true)
    expect(localSleepRowsAsNights(rows, TZ)[0].sleepStart).toBe(fragment.sleepStart)
  })

  it('a re-send at the SAME updated_at fills the missing type; an older copy cannot', async () => {
    const store = new SQLiteLocalStore()
    await store.applyDelta({ sleepSessions: [{ ...fragment, ouraSleepType: null }, { ...main, ouraSleepType: null }] })
    // An older copy carrying a type does not revert the newer row.
    await store.applyDelta({ sleepSessions: [{ ...main, durationHours: 1, updatedAt: '2026-10-18T23:00:00.000Z' }] })
    let rows = await store.getSleepSessions('2026-10-01')
    expect(rows.find(r => r.id === 'ss-main')).toMatchObject({ ouraSleepType: null, durationHours: main.durationHours })

    await store.applyDelta({ sleepSessions: [fragment, main] })
    rows = await store.getSleepSessions('2026-10-01')
    expect(rows.map(r => r.ouraSleepType).sort()).toEqual(['long_sleep', 'sleep'])
    expect(localSleepRowsAsNights(rows, TZ)[0].sleepStart).toBe(main.sleepStart)
  })

  it('a retype the server sends at a newer updated_at replaces the stored type', async () => {
    const store = new SQLiteLocalStore()
    await store.applyDelta({ sleepSessions: [fragment, main] })
    await store.applyDelta({ sleepSessions: [{ ...fragment, ouraSleepType: 'long_sleep', updatedAt: '2026-10-19T01:00:00.000Z' }] })
    const rows = await store.getSleepSessions('2026-10-01')
    expect(rows.find(r => r.id === 'ss-frag')?.ouraSleepType).toBe('long_sleep')
  })

  it('never touches a pending (device-authored) row', async () => {
    const store = new SQLiteLocalStore()
    await store.applyDelta({ sleepSessions: [{ ...main, ouraSleepType: null }] })
    local.db!.exec(`UPDATE sleep_sessions SET sync_status='pending' WHERE id='ss-main'`)
    await store.applyDelta({ sleepSessions: [{ ...main, updatedAt: '2026-10-19T01:00:00.000Z' }] })
    const [row] = await store.getSleepSessions('2026-10-01')
    expect(row.ouraSleepType).toBeNull()
  })
})
