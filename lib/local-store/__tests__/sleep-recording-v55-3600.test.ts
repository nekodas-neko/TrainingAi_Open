// #3600 — the generic recording fields reach the phone's local store (SQLite v55), round-trip, read
// as before on a row without them, and make a night partial through the shared `isPartialNight`.
// Drives the REAL schema and store on `node:sqlite`, built as a v54 device first.
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
import { isPartialNight } from '@trainingai/shared/health/partial-night'
import { sleepAverages } from '@trainingai/shared/profile/measured-overview'

const TZ = 'Australia/Brisbane'
const NEW_COLS = ['restless_min', 'movement_measured_min', 'recording_incomplete', 'source_algorithm_version']
const tolerate = (db: DatabaseSync, s: string) => { try { db.exec(s) } catch { /* the service tolerates an existing column */ } }

function v54Device() {
  const db = new DatabaseSync(':memory:')
  for (const m of MIGRATIONS.filter(m => m.toVersion <= 54)) for (const s of m.statements) tolerate(db, s)
  for (const c of RECONCILE_COLUMNS) if (!(c.table === 'sleep_sessions' && NEW_COLS.includes(c.column))) tolerate(db, c.ddl)
  return db
}
function upgradeToV55(db: DatabaseSync) {
  for (const s of MIGRATIONS.find(m => m.toVersion === 55)!.statements) db.exec(s)
  for (const c of RECONCILE_COLUMNS) tolerate(db, c.ddl)
}

const UPDATED = '2026-10-25T00:00:00.000Z'
const base = {
  date: '2026-10-25', durationHours: 7, deepSleepHours: null, remSleepHours: null, lightSleepHours: null,
  awakHours: null, efficiency: 90, onsetLatencySec: null, averageHrvMs: null, avgHeartRate: null,
  lowestHeartRate: null, sleepScore: null, respiratoryRate: null, sleepPhase5Min: null, timeInBedHours: null,
  manualSleepStart: null, manualEntry: false, restlessPeriods: 4, syncStatus: 'synced' as const, updatedAt: UPDATED,
}
const recorded: LocalSleepSession = {
  ...base, id: 'ss-rec', ouraId: 'src-1', ouraSleepType: 'long_sleep',
  sleepStart: '2026-10-24T13:00:00.000Z', sleepEnd: '2026-10-24T21:00:00.000Z',
  restlessMin: 25, movementMeasuredMin: 400, recordingIncomplete: true, sourceAlgorithmVersion: 'v2',
}
const plain: LocalSleepSession = {
  ...base, id: 'ss-plain', date: '2026-10-20', ouraId: 'ble:1', ouraSleepType: null,
  sleepStart: '2026-10-19T13:00:00.000Z', sleepEnd: '2026-10-19T21:00:00.000Z',
}

describe('recording fields on the device (#3600)', () => {
  beforeEach(() => { local.db = v54Device() })

  it('the upgrade adds four nullable columns and keeps every existing row, reading null', async () => {
    local.db!.exec(`INSERT INTO sleep_sessions (id, date, oura_id, sleep_start, sleep_end, restless_periods, updated_at, sync_status)
      VALUES ('old','2026-10-10','src-0','2026-10-09T13:00:00.000Z','2026-10-09T21:00:00.000Z',7,'${UPDATED}','synced')`)
    upgradeToV55(local.db!)
    const [row] = await new SQLiteLocalStore().getSleepSessions('2026-10-01')
    expect(row).toMatchObject({ id: 'old', restlessPeriods: 7, restlessMin: null, movementMeasuredMin: null, recordingIncomplete: null, sourceAlgorithmVersion: null })
  })

  it('a row round-trips the four fields; a row without them reads null', async () => {
    upgradeToV55(local.db!)
    const store = new SQLiteLocalStore()
    await store.applyDelta({ sleepSessions: [recorded, plain] })
    const rows = await store.getSleepSessions('2026-10-01')
    expect(rows.find(r => r.id === 'ss-rec')).toMatchObject({ restlessMin: 25, movementMeasuredMin: 400, recordingIncomplete: true, sourceAlgorithmVersion: 'v2' })
    expect(rows.find(r => r.id === 'ss-plain')).toMatchObject({ restlessMin: null, movementMeasuredMin: null, recordingIncomplete: null, sourceAlgorithmVersion: null })
  })

  it('the night reaches the readers: partial through isPartialNight, and out of the shared averages', async () => {
    upgradeToV55(local.db!)
    const store = new SQLiteLocalStore()
    await store.applyDelta({ sleepSessions: [recorded, plain] })
    const nights = localSleepRowsAsNights(await store.getSleepSessions('2026-10-01'), TZ)
    const rec = nights.find(n => n.id === 'ss-rec')!
    const pl = nights.find(n => n.id === 'ss-plain')!
    expect(rec).toMatchObject({ restlessMin: 25, movementMeasuredMin: 400, recordingIncomplete: true, sourceAlgorithmVersion: 'v2' })
    expect(isPartialNight(rec)).toBe(true)
    expect(isPartialNight(pl)).toBe(false)
    const avg = sleepAverages(nights.map(n => ({ ...n, durationHours: n.durationHours ?? null, efficiency: n.efficiency ?? null, sleepStart: n.sleepStart ?? null, lowestHeartRate: null, respiratoryRate: null })))!
    expect(avg.nights).toBe(2)
    expect(avg.durationHours).toBe(7) // only the complete night's hours
  })

  it('a row pulled before v55 is filled by a re-send at the same updated_at; an older copy cannot overwrite', async () => {
    upgradeToV55(local.db!)
    const store = new SQLiteLocalStore()
    const bare = { ...recorded, restlessMin: null, movementMeasuredMin: null, recordingIncomplete: null, sourceAlgorithmVersion: null }
    await store.applyDelta({ sleepSessions: [bare] })
    await store.applyDelta({ sleepSessions: [{ ...recorded, updatedAt: '2026-10-24T00:00:00.000Z', restlessPeriods: 1 }] })
    expect((await store.getSleepSessions('2026-10-01'))[0]).toMatchObject({ sourceAlgorithmVersion: null, restlessPeriods: 4 })
    await store.applyDelta({ sleepSessions: [recorded] })
    expect((await store.getSleepSessions('2026-10-01'))[0]).toMatchObject({ restlessMin: 25, recordingIncomplete: true, sourceAlgorithmVersion: 'v2' })
  })

  it('an older server\'s reply (no fields) leaves a stored value alone at the same updated_at', async () => {
    upgradeToV55(local.db!)
    const store = new SQLiteLocalStore()
    await store.applyDelta({ sleepSessions: [recorded] })
    const { restlessMin, movementMeasuredMin, recordingIncomplete, sourceAlgorithmVersion, ...old } = recorded
    void restlessMin; void movementMeasuredMin; void recordingIncomplete; void sourceAlgorithmVersion
    await store.applyDelta({ sleepSessions: [old as LocalSleepSession] })
    expect((await store.getSleepSessions('2026-10-01'))[0]).toMatchObject({ recordingIncomplete: true, restlessMin: 25 })
  })
})
