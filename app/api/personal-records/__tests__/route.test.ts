// LB-95: GET /api/personal-records returns the caller's records for every exercise, each with its
// date, newest first, and never another user's.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const USER = '00000000-0000-4000-8000-0000000b9501'
const OTHER = '00000000-0000-4000-8000-0000000b9502'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER, timezone: 'Australia/Brisbane' } })),
}))

const canRun = !!process.env.DATABASE_URL

describe.skipIf(!canRun)('GET /api/personal-records (LB-95)', () => {
  let pool: import('pg').Pool

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x') ON CONFLICT (id) DO NOTHING`,
        [id, `lb95-${id}@example.com`],
      )
      await pool.query(`DELETE FROM personal_records WHERE user_id = $1`, [id])
    }
    await pool.query(
      `INSERT INTO personal_records (user_id, exercise_name, estimated_1rm, achieved_at) VALUES
         ($1, 'LB95 Squat', 140, '2026-05-01T08:00:00Z'),
         ($1, 'LB95 Retired Lift', 90, '2025-11-20T08:00:00Z'),
         ($1, 'LB95 Bench', 100.5, '2026-09-01T08:00:00Z'),
         ($2, 'LB95 Someone Else', 300, '2026-09-10T08:00:00Z')`,
      [USER, OTHER],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM personal_records WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  it("returns every one of the caller's records, dated, newest first", async () => {
    const { GET } = await import('../route')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect((await res.json()).records).toEqual([
      { exerciseName: 'LB95 Bench', estimated1rm: 100.5, achievedAt: '2026-09-01T08:00:00.000Z' },
      { exerciseName: 'LB95 Squat', estimated1rm: 140, achievedAt: '2026-05-01T08:00:00.000Z' },
      { exerciseName: 'LB95 Retired Lift', estimated1rm: 90, achievedAt: '2025-11-20T08:00:00.000Z' },
    ])
  })

  it('refuses a caller with no session', async () => {
    const { auth } = await import('@/auth')
    vi.mocked(auth).mockResolvedValueOnce(null as never)
    const { GET } = await import('../route')
    expect((await GET()).status).toBe(401)
  })
})
