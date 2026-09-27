// LA-168: an incremental rollup whose HR cutoff falls INSIDE a workout must still bin that workout
// at 15 s. The workout-window read selected sessions that *started* at or after the cutoff, so a
// pass whose cutoff landed mid-session treated the rest of it as ordinary time: it re-binned the
// span at 5 minutes and `deleteBleHeartrateNotIn` removed the 15-second rows. In production that
// took ring-only sessions from 180 stored readings to 13, three days after the workout, and every
// consumer that re-derives from raw HR (the HRR trend, zone minutes) read the thinned trace.
//
// Runs only against a real local dev Postgres — skips cleanly without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER_MID = '00000000-0000-4000-8000-0000000016a8'
const USER_PAD = '00000000-0000-4000-8000-0000000016a9'
const USER_OPEN = '00000000-0000-4000-8000-0000000016aa'

const DS_PER_MIN = 600
const ANCHOR_DS = 50_000_000
const ANCHOR_UTC_MS = Date.parse('2026-07-10T02:00:00.000Z')
const toUtc = (ds: number) => new Date(ANCHOR_UTC_MS + (ds - ANCHOR_DS) * 100)

// Every pass below has its HR cutoff here. `sinceDs` is the cutoff plus the rollup's 3-day margin.
const CUTOFF_DS = ANCHOR_DS - 220 * DS_PER_MIN
const SINCE_DS = CUTOFF_DS + 3 * 24 * 60 * DS_PER_MIN

describe.skipIf(!canRun)('aggregateOuraRawSamples — a cutoff inside a workout window (LA-168)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const clean = async (userId: string) => {
    for (const t of ['oura_heartrate', 'oura_raw_samples', 'oura_ble_clock_anchors', 'workout_sessions', 'oura_rollup_state']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [userId])
    }
  }

  /** A workout, and one IBI row every 15 s from `samplesFrom` to `samplesTo`, so a 15-second bin holds one. */
  const seed = async (userId: string, startDs: number, endDs: number | null, samplesFrom: number, samplesTo: number) => {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [userId, `la168-${userId}@example.com`],
    )
    await clean(userId)
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [userId, ANCHOR_DS, new Date(ANCHOR_UTC_MS).toISOString()],
    )
    await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at) VALUES ($1, 'LA-168', $2, $3)`,
      [userId, toUtc(startDs).toISOString(), endDs == null ? null : toUtc(endDs).toISOString()],
    )
    const values: string[] = []
    const params: unknown[] = [userId]
    for (let ds = samplesFrom; ds < samplesTo; ds += 150) {
      values.push(`($1, $${params.length + 1}, 128, 'ibi_and_amplitude_event', $${params.length + 2}, $${params.length + 3}::jsonb)`)
      params.push(ds, `aa${ds.toString(16)}`, JSON.stringify({ hr_bpm: [110] }))
    }
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${values.join(',')}`,
      params,
    )
  }

  const bleRows = async (userId: string, fromDs: number, toDs: number): Promise<number> => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM oura_heartrate
       WHERE user_id = $1 AND source = 'ble' AND timestamp >= $2 AND timestamp < $3`,
      [userId, toUtc(fromDs).toISOString(), toUtc(toDs).toISOString()],
    )
    return rows[0].n
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
  })

  afterAll(async () => {
    if (!canRun) return
    for (const u of [USER_MID, USER_PAD, USER_OPEN]) {
      await clean(u)
      await pool.query(`DELETE FROM users WHERE id = $1`, [u])
    }
  })

  it('keeps 15-second bins for the part of a workout after the cutoff', async () => {
    const start = CUTOFF_DS - 20 * DS_PER_MIN
    const end = CUTOFF_DS + 40 * DS_PER_MIN
    await seed(USER_MID, start, end, start, end)
    await repo.aggregateOuraRawSamples(USER_MID, 'Australia/Brisbane', { sinceDs: SINCE_DS })
    // 40 minutes after the cutoff: 160 bins at 15 s, 8 at 5 minutes.
    expect(await bleRows(USER_MID, CUTOFF_DS, end)).toBeGreaterThan(100)
  })

  it('keeps 15-second bins in the 10-minute pad of a workout that ended just before the cutoff', async () => {
    const end = CUTOFF_DS - 5 * DS_PER_MIN
    const start = end - 60 * DS_PER_MIN
    await seed(USER_PAD, start, end, start, CUTOFF_DS + 5 * DS_PER_MIN)
    await repo.aggregateOuraRawSamples(USER_PAD, 'Australia/Brisbane', { sinceDs: SINCE_DS })
    // The 5 minutes after the cutoff are inside the pad: 20 bins at 15 s, 1 or 2 at 5 minutes.
    expect(await bleRows(USER_PAD, CUTOFF_DS, CUTOFF_DS + 5 * DS_PER_MIN)).toBeGreaterThan(15)
  })

  it('keeps 15-second bins for an unfinished workout that started before the cutoff', async () => {
    // No completed_at: the rollup gives it a two-hour window, so the cutoff is inside it.
    const start = CUTOFF_DS - 20 * DS_PER_MIN
    const samplesTo = CUTOFF_DS + 40 * DS_PER_MIN
    await seed(USER_OPEN, start, null, start, samplesTo)
    await repo.aggregateOuraRawSamples(USER_OPEN, 'Australia/Brisbane', { sinceDs: SINCE_DS })
    expect(await bleRows(USER_OPEN, CUTOFF_DS, samplesTo)).toBeGreaterThan(100)
  })
})
