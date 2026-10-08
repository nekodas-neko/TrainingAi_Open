// #2547 — a bedtime saved through the outbox must reach the local sleep row the card reads.
//
// The card reads `manual_sleep_start` from the LOCAL `sleep_sessions` row, but its save path only
// queued a `manual_bedtime` mutation, so a remount before the push landed (always, offline) showed
// the old value. The write now updates the row too, marked 'pending' so a pull cannot revert it, and
// the push confirm flips it back.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../../scripts/lib/strip-comments.js'

const db = { current: null as DatabaseSync | null }
vi.mock('@/lib/sqlite/sqlite-service', () => ({
  runSQL: vi.fn(async (sql: string, p: unknown[] = []) => { db.current!.prepare(sql).run(...(p as never[])) }),
  querySQL: vi.fn(async (sql: string, p: unknown[] = []) => db.current!.prepare(sql).all(...(p as never[]))),
  withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}))

import { SQLiteLocalStore } from '../sqlite-backend'

const store = () => new SQLiteLocalStore()
const all = (sql: string, ...p: unknown[]) => db.current!.prepare(sql).all(...(p as never[])) as Record<string, unknown>[]
const row = (date: string) => all(`SELECT manual_sleep_start AS m, sync_status AS s, updated_at AS u, duration_hours AS d FROM sleep_sessions WHERE date=?`, date)[0]

const NIGHT = '2026-10-05'
const MEASURED_AT = '2026-10-06T00:00:00.000Z'
const BEDTIME = '2026-10-05T13:15:00.000Z'

beforeEach(() => {
  db.current = new DatabaseSync(':memory:')
  db.current.exec(`
    CREATE TABLE mutations_outbox (id TEXT PRIMARY KEY, user_id TEXT, domain TEXT, date TEXT, payload TEXT);
    CREATE TABLE sleep_sessions (
      id TEXT PRIMARY KEY, date TEXT, duration_hours REAL, deep_sleep_hours REAL, rem_sleep_hours REAL,
      light_sleep_hours REAL, oura_id TEXT, efficiency REAL, onset_latency_sec REAL, average_hrv_ms REAL,
      avg_heart_rate REAL, lowest_heart_rate REAL, restless_periods REAL, sleep_score REAL,
      respiratory_rate REAL, sleep_phase_5_min TEXT, time_in_bed_hours REAL, manual_sleep_start TEXT,
      sleep_start TEXT, sleep_end TEXT, awake_hours REAL, manual_entry INTEGER NOT NULL DEFAULT 0, deleted_at TEXT,
      updated_at TEXT, sync_status TEXT);
    INSERT INTO sleep_sessions (id, date, duration_hours, sleep_start, updated_at, sync_status)
      VALUES ('sl-1', '${NIGHT}', 7.5, '2026-10-05T14:00:00.000Z', '${MEASURED_AT}', 'synced');
  `)
})

describe('the local write', () => {
  it('puts the bedtime on the night\'s row, pending, and touches nothing else on it', async () => {
    await store().setManualSleepStartLocally(NIGHT, BEDTIME)
    const r = row(NIGHT)
    expect(r.m).toBe(BEDTIME)
    expect(r.s).toBe('pending')
    expect(r.d).toBe(7.5)
    expect(all(`SELECT sleep_start AS st FROM sleep_sessions`)[0].st).toBe('2026-10-05T14:00:00.000Z')
  })

  it('is what the card reads back after a remount, before any push', async () => {
    await store().setManualSleepStartLocally(NIGHT, BEDTIME)
    const rows = await store().getSleepSessions(NIGHT)
    expect(rows.find(x => x.date === NIGHT)?.manualSleepStart).toBe(BEDTIME)
  })

  it('clearing writes null, still pending', async () => {
    await store().setManualSleepStartLocally(NIGHT, BEDTIME)
    await store().setManualSleepStartLocally(NIGHT, null)
    expect(row(NIGHT)).toMatchObject({ m: null, s: 'pending' })
  })

  it('a night with no local row changes nothing and does not throw', async () => {
    await store().setManualSleepStartLocally('2026-10-01', BEDTIME)
    expect(all(`SELECT COUNT(*) AS c FROM sleep_sessions`)[0].c).toBe(1)
    expect(row(NIGHT).m).toBeNull()
  })

  it('only the named night is written', async () => {
    db.current!.exec(`INSERT INTO sleep_sessions (id, date, updated_at, sync_status) VALUES ('sl-2', '2026-10-04', '${MEASURED_AT}', 'synced')`)
    await store().setManualSleepStartLocally(NIGHT, BEDTIME)
    expect(row('2026-10-04')).toMatchObject({ m: null, s: 'synced' })
  })
})

describe('a pull cannot revert it before the push lands', () => {
  const pull = (manualSleepStart: string | null, updatedAt: string) => store().applyDelta({
    sleepSessions: [{
      id: 'sl-1', date: NIGHT, durationHours: 7.5, deepSleepHours: null, remSleepHours: null, lightSleepHours: null,
      sleepStart: '2026-10-05T14:00:00.000Z', sleepEnd: null, awakHours: null, ouraId: null, efficiency: null,
      onsetLatencySec: null, averageHrvMs: null, avgHeartRate: null, lowestHeartRate: null, restlessPeriods: null,
      sleepScore: null, respiratoryRate: null, sleepPhase5Min: null, timeInBedHours: null, manualSleepStart,
      syncStatus: 'synced', updatedAt,
    }],
  } as never)

  it('a stale server row (no bedtime) does not overwrite the pending one', async () => {
    await store().setManualSleepStartLocally(NIGHT, BEDTIME)
    await pull(null, '2099-01-01T00:00:00.000Z')
    expect(row(NIGHT)).toMatchObject({ m: BEDTIME, s: 'pending' })
  })

  it('once confirmed, the server row with the bedtime applies as normal', async () => {
    await store().setManualSleepStartLocally(NIGHT, BEDTIME)
    await store().markManualBedtimeSynced(NIGHT)
    await pull(BEDTIME, '2099-01-01T00:00:00.000Z')
    expect(row(NIGHT)).toMatchObject({ m: BEDTIME, s: 'synced' })
  })
})

describe('the push confirm', () => {
  const queue = (id: string, at: string | null) =>
    db.current!.prepare(`INSERT INTO mutations_outbox (id, user_id, domain, date, payload) VALUES (?, 'u', 'manual_bedtime', ?, ?)`)
      .run(id, NIGHT, JSON.stringify({ at }))

  it('flips the row back to synced when it was the only bedtime queued', async () => {
    await store().setManualSleepStartLocally(NIGHT, BEDTIME)
    queue('m-1', BEDTIME)
    // The confirm loop runs BEFORE the batch is deleted, so the confirming mutation is still queued.
    await store().markManualBedtimeSynced(NIGHT, ['m-1'])
    expect(row(NIGHT).s).toBe('synced')
  })

  it('stays pending while a later bedtime for the same night is still queued', async () => {
    await store().setManualSleepStartLocally(NIGHT, BEDTIME)
    queue('m-1', BEDTIME)
    queue('m-2', null)
    await store().markManualBedtimeSynced(NIGHT, ['m-1'])
    expect(row(NIGHT).s).toBe('pending')
  })

  it('a queued bedtime for a different night does not hold this one back', async () => {
    await store().setManualSleepStartLocally(NIGHT, BEDTIME)
    queue('m-1', BEDTIME)
    db.current!.prepare(`INSERT INTO mutations_outbox (id, user_id, domain, date, payload) VALUES ('m-9', 'u', 'manual_bedtime', '2026-10-01', '{}')`).run()
    await store().markManualBedtimeSynced(NIGHT, ['m-1'])
    expect(row(NIGHT).s).toBe('synced')
  })
})

describe('the two call sites that make it matter', () => {
  const read = (p: string) => stripComments(readFileSync(path.join(process.cwd(), p), 'utf8'))

  it('the card writes the local row BEFORE it queues the mutation, in the same turn', () => {
    const src = read('components/health/sleep/manual-bedtime-card.tsx')
    const local = src.indexOf('setManualSleepStartLocally(date, at)')
    const queued = src.indexOf("domain: 'manual_bedtime'")
    expect(local, 'the card no longer writes the local row').toBeGreaterThan(-1)
    expect(queued).toBeGreaterThan(local)
  })

  it('the push confirm has an arm for the domain, passing the batch being confirmed', () => {
    const src = read('lib/local-store/sync-engine.ts')
    expect(src).toMatch(/m\.domain === 'manual_bedtime'/)
    expect(src).toMatch(/markManualBedtimeSynced\(m\.date, batchIds\)/)
  })
})
