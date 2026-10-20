// #3176 (#3077): VO₂ max and vascular age arrive as separate Oura documents on separate days, so the
// latest of each is read on its own and each carries its own day.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003176'

describe.skipIf(!canRun)('getLatestOuraCloudVitals (#3176)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const clear = () => pool.query(`DELETE FROM oura_daily WHERE user_id = $1`, [USER])

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, `vitals-${USER}@example.com`])
  })
  afterAll(async () => {
    if (!canRun) return
    await clear()
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })
  beforeEach(clear)

  it('returns VO₂ max and vascular age from different days, each with its own day', async () => {
    await repo.upsertOuraDaily(USER, [{ date: '2026-10-19', vo2Max: 47.5 }, { date: '2026-10-20', vascularAge: 31 }], 'oura_cloud')
    expect(await repo.getLatestOuraCloudVitals(USER)).toEqual({
      date: '2026-10-20', vo2Max: 47.5, vo2MaxDate: '2026-10-19', vascularAge: 31, vascularAgeDate: '2026-10-20',
    })
  })

  it('is null with neither', async () => {
    expect(await repo.getLatestOuraCloudVitals(USER)).toBeNull()
  })
})
