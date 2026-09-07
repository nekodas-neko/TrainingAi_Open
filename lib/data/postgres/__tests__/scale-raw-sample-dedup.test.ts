// PS-33: `scale_raw_samples` has no unique key — migration 157's two indexes are both non-unique —
// so a byte-identical re-send inserted a second archive row, unlike `oura_raw_samples`, which
// dedups on (user, timestamp, tag, body_hex). The trend survived it (lowest-wins picks the same
// number twice) but the archive double-counted the weigh-in.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000005cd'
const OTHER_USER_ID = '00000000-0000-4000-8000-0000000005ce'
const MEASURED_AT = new Date('2026-08-14T22:15:03.000Z')
const RAW_HEX = 'a1b2c3d4e5f6'

describe.skipIf(!canRun)('scale_raw_samples — a re-sent reading does not double the archive', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const rowCount = async (userId = TEST_USER_ID) => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM scale_raw_samples WHERE user_id = $1`, [userId])
    return Number(rows[0].n)
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const [id, label] of [[TEST_USER_ID, 'dedup'], [OTHER_USER_ID, 'dedup-other']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `scale-${label}-${id}@example.com`])
    }
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM scale_raw_samples WHERE user_id = ANY($1)`, [[TEST_USER_ID, OTHER_USER_ID]])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM scale_raw_samples WHERE user_id = ANY($1)`, [[TEST_USER_ID, OTHER_USER_ID]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[TEST_USER_ID, OTHER_USER_ID]])
  })

  const insert = (userId: string, over: Partial<{ measuredAt: Date; rawHex: string; status: string }> = {}) =>
    repo.insertScaleRawSample(userId, {
      measuredAt: over.measuredAt ?? MEASURED_AT,
      rawHex: over.rawHex ?? RAW_HEX,
      decoded: { weightKg: 72.4, impedanceOhmsA: 510, impedanceOhmsB: 520 },
      status: (over.status ?? 'confirmed') as 'confirmed' | 'pending' | 'dismissed',
    })

  it('the same bytes at the same instant archive once', async () => {
    const first = await insert(TEST_USER_ID)
    const second = await insert(TEST_USER_ID)

    expect(await rowCount()).toBe(1)
    // The id has to come back, not just the row: a pending reading is staged by this call and the
    // client confirms it by the id this returns, so a skipped insert that returned a new or null
    // id would break confirm rather than dedup it.
    expect(second.id).toBe(first.id)
  })

  it('a different instant or different bytes is a different reading', async () => {
    await insert(TEST_USER_ID)
    await insert(TEST_USER_ID, { measuredAt: new Date(MEASURED_AT.getTime() + 1000) })
    await insert(TEST_USER_ID, { rawHex: 'ffffffffffff' })

    expect(await rowCount()).toBe(3)
  })

  it('matching bytes on another account are that account\'s reading, not a duplicate', async () => {
    // The dedup is keyed on the user as well. Two people on one scale can post the same weight;
    // a match that ignored user_id would silently hand one person's row id to the other.
    const mine = await insert(TEST_USER_ID)
    const theirs = await insert(OTHER_USER_ID)

    expect(await rowCount(TEST_USER_ID)).toBe(1)
    expect(await rowCount(OTHER_USER_ID)).toBe(1)
    expect(theirs.id).not.toBe(mine.id)
  })
})
