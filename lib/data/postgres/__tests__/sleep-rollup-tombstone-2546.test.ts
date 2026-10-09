// Issue 2546 — the ring rollup tombstones the nights it no longer reproduces instead of hard-deleting
// them, and a night re-detected at the same `sleep_start` keeps its row (same id) instead of being
// reinserted under a fresh one.
//
// Before: every pass ran `DELETE … oura_id LIKE 'ble:%' AND date IN (…)` and reinserted the nights
// with new random ids. A device that had already pulled the old ids kept them for good (a hard delete
// never reaches the delta), so each re-roll left a ghost row beside the new one and a dropped night
// stayed on the phone indefinitely.
//
// The server half runs against a real Postgres (DATABASE_URL) and skips without one. The device half
// applies the delta's rows to the shipped `SQLiteLocalStore` on node:sqlite (the parity harness);
// native SQLite on the phone runs the same statements, only the driver differs.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

vi.mock('@/lib/sqlite/sqlite-service', () => import('@/lib/local-store/__tests__/parity/node-sqlite-service'))

import { SQLiteLocalStore } from '@/lib/local-store/sqlite-backend'
import { openVectorDb } from '@/lib/local-store/__tests__/parity/node-sqlite-service'
import type { OuraSleepUpsertRow } from '@/lib/data/repository'
import type { LocalSleepSession } from '@/lib/local-store/types'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000002546'
const DATE = '2026-10-05'
const NEXT = '2026-10-06'

const night = (start: string, end: string, hours: number, extra: Partial<OuraSleepUpsertRow> = {}): OuraSleepUpsertRow => ({
  ouraId: `ble:${Date.parse(start) / 1000}`, date: DATE, sleepStart: new Date(start), sleepEnd: new Date(end),
  durationHours: hours, deepSleepHours: 1.2, efficiency: 88, ...extra,
})
const MAIN    = night('2026-10-04T12:30:00.000Z', '2026-10-04T19:30:00.000Z', 6.5)
const EVENING = night('2026-10-04T08:00:00.000Z', '2026-10-04T08:50:00.000Z', 0.7)

describe.skipIf(!canRun)('BLE rollup sleep write — tombstones, never deletes (issue 2546)', () => {
  let pool: import('pg').Pool
  let io: import('@/lib/oura-ble/rollup/io').RollupIO
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    const { createPostgresRollupIO } = await import('@/lib/data/postgres/rollup-io')
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, 'issue-2546@example.com'])
    io = createPostgresRollupIO({
      db: client.getDb(), userId: USER,
      getOuraClockAnchor: async () => null,
      getOuraClockAnchors: async () => [],
      upsertBodyMetrics: async () => {},
      getBodyFatCalibration: async () => null,
      refitDaytimeHrvModel: async () => {},
      listSleepSessions: async () => [],
    })
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) // cascades sleep_sessions
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [USER])
  })

  /** The sleep step of one rollup pass, in the order `lib/oura-ble/rollup/run.ts` runs it. */
  async function pass(rows: OuraSleepUpsertRow[]) {
    await io.upsertSleepSessions(rows)
    await io.tombstoneBleSleepSessionsExcept(Array.from(new Set(rows.map(r => r.date))), rows.map(r => r.sleepStart))
  }

  type Row = { id: string; date: string; sleep_start: Date; sleep_end: Date; duration_hours: number | null;
    deep_sleep_hours: number | null; manual_entry: boolean; deleted_at: Date | null; updated_at: Date; created_at: Date;
    source_map: Record<string, string> | null; manual_sleep_start: Date | null; oura_id: string | null }
  const rows = async (): Promise<Row[]> => (await pool.query(
    `SELECT id, oura_id, date::text AS date, sleep_start, sleep_end, duration_hours, deep_sleep_hours, manual_entry,
            deleted_at, updated_at, created_at, source_map, manual_sleep_start
       FROM sleep_sessions WHERE user_id = $1 ORDER BY sleep_start, id`, [USER])).rows
  const live = async () => (await rows()).filter(r => r.deleted_at == null)

  it('tombstones a night the pass no longer produces, and keeps the row', async () => {
    await pass([EVENING, MAIN])
    const [evening] = await rows()
    await pass([MAIN])
    const all = await rows()
    expect(all).toHaveLength(2)
    expect(all.find(r => r.id === evening.id)).toMatchObject({ deleted_at: expect.any(Date) })
    expect((await live()).map(r => r.sleep_start.toISOString())).toEqual([MAIN.sleepStart.toISOString()])
  })

  it('keeps the id of a night re-detected at the same sleep_start, and replaces its values', async () => {
    await pass([MAIN])
    const [before] = await rows()
    // The 2026-08-27 revision from issue 2210: same start, the wake moved later, a field went missing.
    await pass([{ ...MAIN, sleepEnd: new Date('2026-10-04T20:26:00.000Z'), durationHours: 7.5, deepSleepHours: null }])
    const after = await rows()
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: before.id, deleted_at: null, duration_hours: 7.5, deep_sleep_hours: null })
    // The old delete + reinsert replaced every column; the rank merge would have kept the stored end.
    expect(after[0].sleep_end.toISOString()).toBe('2026-10-04T20:26:00.000Z')
    expect(after[0].source_map).not.toHaveProperty('deep_sleep_hours')
    expect(after[0].created_at.getTime()).toBe(before.created_at.getTime())
  })

  it('revives a tombstoned night when a later pass detects it again at the same sleep_start', async () => {
    await pass([EVENING, MAIN])
    const [evening] = await rows()
    await pass([MAIN])
    await pass([{ ...EVENING, durationHours: 0.8 }, MAIN])
    const all = await rows()
    expect(all).toHaveLength(2)
    expect(all.find(r => r.id === evening.id)).toMatchObject({ deleted_at: null, duration_hours: 0.8 })
  })

  it('keeps a bedtime the user recorded on a re-rolled night', async () => {
    await pass([MAIN])
    await pool.query(`UPDATE sleep_sessions SET manual_sleep_start = '2026-10-04T12:00:00Z' WHERE user_id = $1`, [USER])
    await pass([{ ...MAIN, durationHours: 6.6 }])
    expect((await rows())[0].manual_sleep_start?.toISOString()).toBe('2026-10-04T12:00:00.000Z')
  })

  it('never touches a manual night, another source\'s night, or another date', async () => {
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, manual_entry, oura_id) VALUES
         ($1, $2, '2026-10-04T06:00:00Z', '2026-10-04T07:00:00Z', 1, true, NULL),
         ($1, $2, '2026-10-04T05:00:00Z', '2026-10-04T05:40:00Z', 0.6, false, NULL),
         ($1, $3, '2026-10-05T12:30:00Z', '2026-10-05T19:30:00Z', 7, false, 'ble:other-night')`,
      [USER, DATE, NEXT])
    await pass([MAIN])
    await pass([night('2026-10-04T12:45:00.000Z', '2026-10-04T19:30:00.000Z', 6.3)]) // the night reshaped
    const all = await rows()
    expect(all.filter(r => r.deleted_at != null).map(r => r.sleep_start.toISOString())).toEqual([MAIN.sleepStart.toISOString()])
    expect(all.find(r => r.manual_entry)).toMatchObject({ deleted_at: null })
    expect(all.find(r => r.date === NEXT)).toMatchObject({ deleted_at: null })
    expect(all.filter(r => r.oura_id == null && !r.manual_entry)).toHaveLength(1) // the other source's night
  })

  // `oura_id` (ble:<startDs>) is unique per user and comes from the ring counter; `sleep_start` comes
  // from the clock anchor, which drifts between drains. The old DELETE freed the id; a tombstone holds it.
  it('moves a night whose start drifted under the same oura_id, keeping its id', async () => {
    await pass([MAIN])
    const [before] = await rows()
    await pass([{ ...MAIN, sleepStart: new Date('2026-10-04T12:31:00.000Z') }])
    const all = await rows()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id: before.id, deleted_at: null, oura_id: MAIN.ouraId })
    expect(all[0].sleep_start.toISOString()).toBe('2026-10-04T12:31:00.000Z')
  })

  it('retires the old holder of the oura_id when another row already sits at the drifted start', async () => {
    await pass([MAIN, EVENING])
    const [, before] = await rows()
    // The evening window's row is tombstoned, then MAIN's id comes back at the evening's start.
    await pass([MAIN])
    await pass([{ ...MAIN, sleepStart: EVENING.sleepStart }])
    const all = await rows()
    expect(all).toHaveLength(2)
    expect(all.find(r => r.id === before.id)).toMatchObject({ deleted_at: expect.any(Date), oura_id: null })
    expect(all.filter(r => r.deleted_at == null)).toEqual([expect.objectContaining({ oura_id: MAIN.ouraId })])
  })

  it('is idempotent: an unchanged re-roll leaves no extra rows and does not re-stamp a tombstone', async () => {
    await pass([EVENING, MAIN])
    await pass([MAIN])
    const tomb = (await rows()).find(r => r.deleted_at != null)!
    await pass([MAIN])
    await pass([MAIN])
    const all = await rows()
    expect(all).toHaveLength(2)
    const again = all.find(r => r.id === tomb.id)!
    expect(again.deleted_at?.getTime()).toBe(tomb.deleted_at?.getTime())
    expect(again.updated_at.getTime()).toBe(tomb.updated_at.getTime())
  })

  it('readers exclude a tombstoned night', async () => {
    await pass([EVENING, MAIN])
    await pass([MAIN])
    const listed = await repo.listSleepSessions(USER, DATE, DATE)
    expect(listed.map(r => r.sleepStart.toISOString())).toEqual([MAIN.sleepStart.toISOString()])
  })

  it('the delta carries the tombstone, and a device that pulled the night hides it after applying it', async () => {
    await pass([EVENING, MAIN])
    const toLocal = (r: Record<string, unknown>): LocalSleepSession => ({
      id: String(r.id), date: String(r.date),
      durationHours: (r.durationHours as number) ?? null, deepSleepHours: (r.deepSleepHours as number) ?? null,
      remSleepHours: null, lightSleepHours: null,
      sleepStart: (r.sleepStart as Date).toISOString(), sleepEnd: (r.sleepEnd as Date).toISOString(), awakHours: null,
      ouraId: (r.ouraId as string) ?? null, efficiency: (r.efficiency as number) ?? null, onsetLatencySec: null,
      averageHrvMs: null, avgHeartRate: null, lowestHeartRate: null, restlessPeriods: null, sleepScore: null,
      respiratoryRate: null, sleepPhase5Min: null, timeInBedHours: null, manualSleepStart: null,
      manualEntry: r.manualEntry === true,
      deletedAt: r.deletedAt ? (r.deletedAt as Date).toISOString() : null,
      syncStatus: 'synced', updatedAt: (r.updatedAt as Date).toISOString(),
    })

    // The device pulls both nights.
    openVectorDb()
    const store = new SQLiteLocalStore()
    const first = await repo.getSyncDelta(USER, new Date(0), null)
    await store.applyDelta({ sleepSessions: (first.sleepSessions as unknown as Record<string, unknown>[]).map(toLocal) } as never)
    expect((await store.getSleepSessions('2026-10-01')).length).toBe(2)

    // The server drops the evening window; the next delta carries it as a tombstone.
    const since = new Date(Math.max(...(first.sleepSessions as unknown as { updatedAt: Date }[]).map(r => r.updatedAt.getTime())))
    await new Promise(r => setTimeout(r, 5))
    await pass([MAIN])
    const second = await repo.getSyncDelta(USER, since, null)
    const tombs = (second.sleepSessions as unknown as Record<string, unknown>[]).filter(r => r.deletedAt != null)
    expect(tombs.map(r => (r.sleepStart as Date).toISOString())).toEqual([EVENING.sleepStart.toISOString()])

    await store.applyDelta({ sleepSessions: (second.sleepSessions as unknown as Record<string, unknown>[]).map(toLocal) } as never)
    const onDevice = await store.getSleepSessions('2026-10-01')
    expect(onDevice.map(r => r.sleepStart)).toEqual([MAIN.sleepStart.toISOString()])
  })
})
