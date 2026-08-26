// Colmi ring storage (PS-8, migration 231) — the two properties the sync path depends on.
//
// 1. A re-sync is FREE. The ring's history buffer is re-readable and the cursor is ours, so an
//    overlapping sync is normal operation, not an error. If it duplicated, every sync would inflate
//    the comparison against the other two devices — silently, and in the direction that looks like
//    the ring is more active.
// 2. Nothing leaks into a scoring table. The isolation is enforced statically by
//    scripts/check-learning-mode-isolation.js; this asserts it against a real database as well,
//    because a static check cannot see what a query actually wrote.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000c019'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('colmi learning-mode storage', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let slice: typeof import('@/lib/data/postgres/slices/colmi')
  let day = ''
  let base = new Date()

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool(); db = client.getDb()
    slice = await import('@/lib/data/postgres/slices/colmi')
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'colmi-lm@example.com', 'x', $2)
       ON CONFLICT (id) DO NOTHING`, [USER, TZ])
    // Anchor the fixture to the row's own local day read back from Postgres, and to MIDDAY on it —
    // never to a fixed date and never to midnight. A hardcoded date becomes a time bomb, and a
    // boundary is where an off-by-one stops being visible.
    const { rows } = await pool.query<{ d: string; t: Date }>(
      `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS d,
              ((now() AT TIME ZONE $1)::date + interval '12 hours') AT TIME ZONE $1 AS t`, [TZ])
    day = rows[0].d
    base = rows[0].t
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query('DELETE FROM users WHERE id = $1', [USER])
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM colmi_readings WHERE user_id = $1', [USER])
    await pool.query('DELETE FROM colmi_sleep_segments WHERE user_id = $1', [USER])
  })

  it('stores readings and reads them back within a window', async () => {
    const stored = await slice.insertColmiReadings(db, USER, [
      { kind: 'heart_rate', measuredAt: base, localDate: day, value: 61 },
      { kind: 'temperature', measuredAt: new Date(base.getTime() + 60_000), localDate: day, value: 32.4 },
    ])
    expect(stored).toBe(2)

    const back = await slice.getColmiReadings(db, USER, ['heart_rate'], new Date(base.getTime() - 3600_000), new Date(base.getTime() + 3600_000))
    expect(back).toHaveLength(1)
    expect(back[0].value).toBe(61)
    expect(back[0].localDate).toBe(day)
  })

  it('makes a repeat sync a no-op instead of a duplicate', async () => {
    const batch = [{ kind: 'heart_rate' as const, measuredAt: base, localDate: day, value: 61 }]
    expect(await slice.insertColmiReadings(db, USER, batch)).toBe(1)
    // The same batch again — exactly what an overlapping drain sends.
    expect(await slice.insertColmiReadings(db, USER, batch)).toBe(0)
    const { rows } = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM colmi_readings WHERE user_id = $1', [USER])
    expect(rows[0].n).toBe('1')
  })

  it('keeps the same instant under different kinds — the unique key is per kind', async () => {
    expect(await slice.insertColmiReadings(db, USER, [
      { kind: 'heart_rate', measuredAt: base, localDate: day, value: 61 },
      { kind: 'stress', measuredAt: base, localDate: day, value: 30 },
    ])).toBe(2)
  })

  it('stores sleep segments and dedups a repeat', async () => {
    const seg = [{
      localDate: day,
      startedAt: base,
      endedAt: new Date(base.getTime() + 60 * 60_000),
      stage: 3,
      minutes: 60,
    }]
    expect(await slice.insertColmiSleepSegments(db, USER, seg)).toBe(1)
    expect(await slice.insertColmiSleepSegments(db, USER, seg)).toBe(0)
    const back = await slice.getColmiSleepSegments(db, USER, day, day)
    expect(back).toHaveLength(1)
    expect(back[0].stage).toBe(3)
  })

  it('reports the newest reading, not the oldest', async () => {
    const older = new Date(base.getTime() - 7200_000)
    await slice.insertColmiReadings(db, USER, [
      { kind: 'heart_rate', measuredAt: older, localDate: day, value: 55 },
      { kind: 'heart_rate', measuredAt: base, localDate: day, value: 61 },
    ])
    const latest = await slice.getColmiLatestReadingAt(db, USER)
    expect(latest?.getTime()).toBe(base.getTime())
  })

  it('writes NOTHING into any scoring table', async () => {
    await slice.insertColmiReadings(db, USER, [
      { kind: 'heart_rate', measuredAt: base, localDate: day, value: 61 },
      { kind: 'temperature', measuredAt: base, localDate: day, value: 32.4 },
      { kind: 'spo2', measuredAt: base, localDate: day, value: 95, valueHigh: 99 },
    ])
    await slice.insertColmiSleepSegments(db, USER, [{
      localDate: day, startedAt: base, endedAt: new Date(base.getTime() + 3600_000), stage: 2, minutes: 60,
    }])

    // The five tables whose contents reach a score. A row here from this user would mean the
    // quarantine failed, whatever the static check says.
    for (const table of ['oura_heartrate', 'body_metrics', 'sleep_sessions', 'oura_daily', 'oura_daily_derived']) {
      const { rows } = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE user_id = $1`, [USER])
      expect({ table, n: rows[0].n }).toEqual({ table, n: '0' })
    }
  })
})
