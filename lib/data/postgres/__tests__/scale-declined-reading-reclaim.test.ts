// LA-108: a declined weigh-in had no way back. `confirmScaleSample` matched only `status='pending'`,
// so a reading the app declined — or one the owner tapped *Not me* on by mistake — could never be
// filed. That is worse than losing one reading, because the weight band anchors on the last
// CONFIRMED weight: with nothing to re-anchor it, a genuine change large enough to be declined once
// is declined every time after, silently and forever.
//
// These run against the adapter rather than a mock, because the whole fix is one SQL predicate.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000108001'
const OTHER_USER_ID = '00000000-0000-4000-8000-000000108002'

describe.skipIf(!canRun)('scale_raw_samples — a declined reading can be claimed back', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const insert = async (status: 'pending' | 'dismissed' | 'confirmed', weightKg: number, userId = TEST_USER_ID) => {
    const { id } = await repo.insertScaleRawSample(userId, {
      measuredAt: new Date(Date.now() - 60_000), rawHex: 'ab12',
      decoded: { weightKg, impedanceOhmsA: 500, impedanceOhmsB: 510 },
      status,
    })
    return id
  }
  const statusOf = async (id: number) => {
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM scale_raw_samples WHERE id = $1`, [id])
    return rows[0]?.status ?? null
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const id of [TEST_USER_ID, OTHER_USER_ID]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `scale-reclaim-${id}@example.com`])
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

  it('confirms a dismissed reading, returning the row so the caller can file it', async () => {
    const id = await insert('dismissed', 64.2)
    const row = await repo.confirmScaleSample(TEST_USER_ID, id)
    expect(row?.id).toBe(id)
    expect((row?.decoded as { weightKg?: number } | null)?.weightKg).toBe(64.2)
    expect(await statusOf(id)).toBe('confirmed')
  })

  it('still confirms a pending reading — the original path is unchanged', async () => {
    const id = await insert('pending', 71.5)
    expect((await repo.confirmScaleSample(TEST_USER_ID, id))?.id).toBe(id)
    expect(await statusOf(id)).toBe('confirmed')
  })

  // The reason the predicate is `in ('pending','dismissed')` and not "anything but confirmed":
  // claiming an already-filed reading twice would re-run applyScaleReadingToBodyMetrics on it.
  it('refuses an already-confirmed reading, so claiming twice cannot double-apply it', async () => {
    const id = await insert('confirmed', 71.5)
    expect(await repo.confirmScaleSample(TEST_USER_ID, id)).toBeNull()
    expect(await statusOf(id)).toBe('confirmed')
  })

  it('refuses another account’s declined reading', async () => {
    const id = await insert('dismissed', 57.8, OTHER_USER_ID)
    expect(await repo.confirmScaleSample(TEST_USER_ID, id)).toBeNull()
    expect(await statusOf(id)).toBe('dismissed')
  })

  describe('listRecentDismissedScaleSamples', () => {
    it('returns only this account’s declined readings, newest first', async () => {
      await insert('pending', 71.0)
      await insert('confirmed', 71.2)
      await insert('dismissed', 57.8, OTHER_USER_ID)
      const mine = await insert('dismissed', 58.0)

      const rows = await repo.listRecentDismissedScaleSamples(TEST_USER_ID, 10)
      expect(rows.map(r => r.id)).toEqual([mine])
    })

    it('orders newest first and honours the limit', async () => {
      const ids: number[] = []
      for (let i = 0; i < 3; i++) {
        const { id } = await repo.insertScaleRawSample(TEST_USER_ID, {
          // Minutes apart so the ordering is by measuredAt rather than by insertion order.
          measuredAt: new Date(Date.now() - (3 - i) * 60_000), rawHex: `ab1${i}`,
          decoded: { weightKg: 57 + i }, status: 'dismissed',
        })
        ids.push(id)
      }
      const rows = await repo.listRecentDismissedScaleSamples(TEST_USER_ID, 2)
      expect(rows.map(r => r.id)).toEqual([ids[2], ids[1]])
    })
  })
})
