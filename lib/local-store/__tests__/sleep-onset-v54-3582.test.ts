// #3582 — the derived onset, final wake and awakenings reach the phone's local store (SQLite v54), and
// the Health sheet's restless-periods number prefers ours over Oura's. Drives the REAL schema and store
// on `node:sqlite`, built as a v53 device first so the upgrade is the one a phone runs.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

const local = { db: null as DatabaseSync | null }
const bindable = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)
vi.mock('@/lib/sqlite/sqlite-service', () => ({
  runSQL: vi.fn(async (sql: string, p: unknown[] = []) => { local.db!.prepare(sql).run(...(p.map(bindable) as never[])) }),
  querySQL: vi.fn(async (sql: string, p: unknown[] = []) => local.db!.prepare(sql).all(...(p.map(bindable) as never[]))),
  withTransaction: vi.fn(async (fn: (tx: { run: (sql: string, p?: unknown[]) => Promise<void> }) => Promise<unknown>) => fn({ run: (await import('@/lib/sqlite/sqlite-service')).runSQL })),
  isSQLiteAvailable: () => true, isLocalStoreDead: () => false,
}))

import { MIGRATIONS, RECONCILE_COLUMNS } from '@/lib/sqlite/migrations'
import { SQLiteLocalStore } from '../sqlite-backend'
import type { LocalSleepSession } from '../types'
import { localSleepRowsAsNights } from '@/lib/sleep/merge-sessions'

const TZ = 'Australia/Brisbane'
const NEW_COLS = ['onset_at', 'final_wake_at', 'computed_awakenings']
const tolerate = (db: DatabaseSync, s: string) => { try { db.exec(s) } catch { /* the service tolerates an existing column */ } }

function v53Device() {
  const db = new DatabaseSync(':memory:')
  for (const m of MIGRATIONS.filter(m => m.toVersion <= 53)) for (const s of m.statements) tolerate(db, s)
  for (const c of RECONCILE_COLUMNS) if (!(c.table === 'sleep_sessions' && NEW_COLS.includes(c.column))) tolerate(db, c.ddl)
  return db
}
function upgradeToV54(db: DatabaseSync) {
  for (const s of MIGRATIONS.find(m => m.toVersion === 54)!.statements) db.exec(s)
  for (const c of RECONCILE_COLUMNS) tolerate(db, c.ddl)
}

const UPDATED = '2026-10-25T00:00:00.000Z'
const base = {
  date: '2026-10-25', durationHours: 7, deepSleepHours: null, remSleepHours: null, lightSleepHours: null,
  awakHours: null, efficiency: 90, onsetLatencySec: null, averageHrvMs: null, avgHeartRate: null,
  lowestHeartRate: null, sleepScore: null, respiratoryRate: null, sleepPhase5Min: null, timeInBedHours: null,
  manualSleepStart: null, manualEntry: false, syncStatus: 'synced' as const, updatedAt: UPDATED,
}
const cloud: LocalSleepSession = {
  ...base, id: 'ss-cloud', ouraId: 'oura-1', ouraSleepType: 'long_sleep', restlessPeriods: 180,
  sleepStart: '2026-10-24T13:00:00.000Z', sleepEnd: '2026-10-24T21:00:00.000Z',
  onsetAt: '2026-10-24T13:40:00.000Z', finalWakeAt: '2026-10-24T20:50:00.000Z', computedAwakenings: 3,
}
const ring: LocalSleepSession = {
  ...base, id: 'ss-ring', date: '2026-10-20', ouraId: 'ble:1', ouraSleepType: null, restlessPeriods: 2,
  sleepStart: '2026-10-19T13:00:00.000Z', sleepEnd: '2026-10-19T21:00:00.000Z',
}

describe('derived sleep onset on the device (#3582)', () => {
  beforeEach(() => { local.db = v53Device() })

  it('the upgrade adds the three columns and keeps every existing row, reading NULL', async () => {
    local.db!.exec(`INSERT INTO sleep_sessions (id, date, oura_id, sleep_start, sleep_end, restless_periods, updated_at, sync_status)
      VALUES ('old','2026-10-10','oura-0','2026-10-09T13:00:00.000Z','2026-10-09T21:00:00.000Z',7,'${UPDATED}','synced')`)
    upgradeToV54(local.db!)
    const [row] = await new SQLiteLocalStore().getSleepSessions('2026-10-01')
    expect(row).toMatchObject({ id: 'old', restlessPeriods: 7, onsetAt: null, finalWakeAt: null, computedAwakenings: null })
  })

  it('a pulled Cloud night keeps the three fields; a ring night and one without a hypnogram read null', async () => {
    upgradeToV54(local.db!)
    const store = new SQLiteLocalStore()
    await store.applyDelta({ sleepSessions: [cloud, ring] })
    const rows = await store.getSleepSessions('2026-10-01')
    expect(rows.find(r => r.id === 'ss-cloud')).toMatchObject({ onsetAt: cloud.onsetAt, finalWakeAt: cloud.finalWakeAt, computedAwakenings: 3, restlessPeriods: 180 })
    expect(rows.find(r => r.id === 'ss-ring')).toMatchObject({ onsetAt: null, finalWakeAt: null, computedAwakenings: null, restlessPeriods: 2 })
  })

  it('the Health sheet reads ours (3) before Oura\'s (180); a ring night keeps the ring\'s count', async () => {
    upgradeToV54(local.db!)
    const store = new SQLiteLocalStore()
    await store.applyDelta({ sleepSessions: [cloud, ring] })
    const nights = localSleepRowsAsNights(await store.getSleepSessions('2026-10-01'), TZ)
    const c = nights.find(n => n.id === 'ss-cloud')!
    expect(c.restlessPeriods).toBe(3)
    expect(c.onsetAt).toBe(cloud.onsetAt)
    expect(c.finalWakeAt).toBe(cloud.finalWakeAt)
    expect(c.sleepStart).toBe(cloud.sleepStart) // the bed window is untouched
    const r = nights.find(n => n.id === 'ss-ring')!
    expect(r.restlessPeriods).toBe(2)
    expect(r.onsetAt ?? null).toBeNull()
  })

  it('a row pulled before v54 is filled by a re-send at the same updated_at; an older copy cannot overwrite', async () => {
    upgradeToV54(local.db!)
    const store = new SQLiteLocalStore()
    await store.applyDelta({ sleepSessions: [{ ...cloud, onsetAt: null, finalWakeAt: null, computedAwakenings: null }] })
    await store.applyDelta({ sleepSessions: [{ ...cloud, updatedAt: '2026-10-24T00:00:00.000Z', restlessPeriods: 1 }] })
    expect((await store.getSleepSessions('2026-10-01'))[0]).toMatchObject({ onsetAt: null, restlessPeriods: 180 })
    await store.applyDelta({ sleepSessions: [cloud] })
    expect((await store.getSleepSessions('2026-10-01'))[0]).toMatchObject({ onsetAt: cloud.onsetAt, computedAwakenings: 3 })
  })

  it('an older server\'s reply (no fields) leaves a stored value alone at the same updated_at', async () => {
    upgradeToV54(local.db!)
    const store = new SQLiteLocalStore()
    await store.applyDelta({ sleepSessions: [cloud] })
    const { onsetAt, finalWakeAt, computedAwakenings, ...old } = cloud
    void onsetAt; void finalWakeAt; void computedAwakenings
    await store.applyDelta({ sleepSessions: [old as LocalSleepSession] })
    expect((await store.getSleepSessions('2026-10-01'))[0]).toMatchObject({ onsetAt: cloud.onsetAt })
  })
})
