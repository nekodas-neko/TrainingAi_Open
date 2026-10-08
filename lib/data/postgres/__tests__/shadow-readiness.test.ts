// #2377 (PR 1). The shadow readiness table (migration 202610071507): every field round-trips, a
// recompute of one version replaces only that version's row, a new version lands beside the old,
// the table refuses a row that read the unsettled current day, and the rows go with the user.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { ShadowReadinessRecord } from '@trainingai/shared/types'

const canRun = !!process.env.DATABASE_URL
const USER_A = '00000000-0000-4000-8000-0000000237a1'
const USER_B = '00000000-0000-4000-8000-0000000237b1'
const DOOMED = '00000000-0000-4000-8000-0000000237d1'

const record = (over: Partial<ShadowReadinessRecord> = {}): ShadowReadinessRecord => ({
  date: '2026-09-15',
  modelVersion: 1,
  shadowReadiness: 71.25,
  pillars: { sleep: 80.5, heart: 66, activity: null, body: 70 },
  pillarDetail: { activity: { effectiveWeight: 0, dropped: ['activity.training_load'] } },
  units: { 'sleep.duration': { score: 88, level: 80, day: 8, stage: 'settled' }, 'body.fuel': { score: null } },
  maturityStage: 'provisional',
  inputsThrough: '2026-09-14',
  liveReadiness: 74,
  liveModelVersion: 'v7',
  computedBy: 'daily',
  ...over,
})

describe.skipIf(!canRun)('shadow_readiness persistence (#2377)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const id of [USER_A, USER_B, DOOMED]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `shadow-${id}@example.com`],
      )
      await pool.query(`DELETE FROM shadow_readiness WHERE user_id = $1`, [id])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B, DOOMED]])
  })

  it('round-trips every field, nulls kept as null', async () => {
    await repo.upsertShadowReadiness(USER_A, record())
    const rows = await repo.getShadowReadiness(USER_A, '2026-09-15', '2026-09-15')
    expect(rows).toHaveLength(1)
    const { computedAt, ...rest } = rows[0]
    expect(rest).toEqual(record())
    expect(Math.abs(computedAt.getTime() - Date.now())).toBeLessThan(3_600_000)
  })

  it('a recompute of the same version replaces its own row, not a second one', async () => {
    await repo.upsertShadowReadiness(USER_A, record({ shadowReadiness: 60, computedBy: 'replay', inputsThrough: null }))
    const rows = await repo.getShadowReadiness(USER_A, '2026-09-15', '2026-09-15')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ modelVersion: 1, shadowReadiness: 60, computedBy: 'replay', inputsThrough: null })
  })

  it('a new model version is stored beside the old one, which is left as it was', async () => {
    await repo.upsertShadowReadiness(USER_A, record({ modelVersion: 2, shadowReadiness: 55, pillars: { sleep: 50, heart: 50, activity: 60, body: 60 } }))
    const both = await repo.getShadowReadiness(USER_A, '2026-09-01', '2026-09-30')
    expect(both.map(r => [r.modelVersion, r.shadowReadiness])).toEqual([[1, 60], [2, 55]])
    const v2 = await repo.getShadowReadiness(USER_A, '2026-09-01', '2026-09-30', 2)
    expect(v2.map(r => r.modelVersion)).toEqual([2])
  })

  it('reads only the requested days, oldest first', async () => {
    await repo.upsertShadowReadiness(USER_A, record({ date: '2026-09-17', inputsThrough: '2026-09-16' }))
    await repo.upsertShadowReadiness(USER_A, record({ date: '2026-09-16', inputsThrough: '2026-09-15' }))
    const rows = await repo.getShadowReadiness(USER_A, '2026-09-16', '2026-09-17', 1)
    expect(rows.map(r => r.date)).toEqual(['2026-09-16', '2026-09-17'])
  })

  it('refuses a row whose inputs reach the readiness day itself', async () => {
    await expect(repo.upsertShadowReadiness(USER_A, record({ date: '2026-09-20', inputsThrough: '2026-09-20' })))
      .rejects.toThrow()
    expect(await repo.getShadowReadiness(USER_A, '2026-09-20', '2026-09-20')).toEqual([])
  })

  it('refuses a score outside 0–100 and an unknown stage', async () => {
    await expect(repo.upsertShadowReadiness(USER_A, record({ date: '2026-09-21', inputsThrough: null, shadowReadiness: 101 })))
      .rejects.toThrow()
    await expect(repo.upsertShadowReadiness(USER_A, record({ date: '2026-09-21', inputsThrough: null, maturityStage: 'mature' as never })))
      .rejects.toThrow()
  })

  it('is scoped to the user: B writing the same day and version leaves A alone, and neither sees the other', async () => {
    const before = await repo.getShadowReadiness(USER_A, '2026-09-01', '2026-09-30')
    await repo.upsertShadowReadiness(USER_B, record({ shadowReadiness: 12, pillars: { sleep: 1, heart: 2, activity: 3, body: 4 } }))
    expect(await repo.getShadowReadiness(USER_A, '2026-09-01', '2026-09-30')).toEqual(before)
    const b = await repo.getShadowReadiness(USER_B, '2026-09-01', '2026-09-30')
    expect(b.map(r => r.shadowReadiness)).toEqual([12])
  })

  it('goes with the user', async () => {
    await repo.upsertShadowReadiness(DOOMED, record())
    await pool.query(`DELETE FROM users WHERE id = $1`, [DOOMED])
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM shadow_readiness WHERE user_id = $1`, [DOOMED])
    expect(rows[0].n).toBe(0)
  })
})
