// #2105 — the half a pure test cannot reach: that the readiness verdict's snapshot survives a round
// trip through real columns, that re-judging a day cannot erase an answer, and that every read and
// write is scoped to one user.
//
// Runs only against a real local dev Postgres — skips without DATABASE_URL.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type { ReadinessVerdictRecord } from '@trainingai/shared/types/body'

const canRun = !!process.env.DATABASE_URL
const USER_A = '00000000-0000-4000-8000-000002105a01'
const USER_B = '00000000-0000-4000-8000-000002105a02'
const DAY = '2026-10-06'

const record = (over: Partial<Omit<ReadinessVerdictRecord, 'responseState'>> = {}): Omit<ReadinessVerdictRecord, 'responseState'> => ({
  date: DAY,
  verdict: 'poor',
  score: 41,
  band: { median: 63, low: 57, high: 69.5 },
  baselineDays: 28,
  baselineSameVersionDays: 3,
  contributors: {
    hrvBalance: { score: 41, provisional: false, input: -0.9, gap: null },
    recoveryIndex: { score: 80, provisional: true, input: 4, gap: null },
  },
  readinessModelVersion: 'v6:dev-warmup:2026-10-06',
  modelVersion: 1,
  ...over,
})

describe.skipIf(!canRun)('readiness verdict repository', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const [id, tag] of [[USER_A, 'a'], [USER_B, 'b']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `readiness-verdict-${tag}@example.com`])
    }
  })

  // Every case starts from no verdicts, so the response-state cases cannot leak into the
  // isolation one and fail it for a reason that has nothing to do with scoping.
  beforeEach(async () => {
    for (const id of [USER_A, USER_B]) {
      await pool.query(`DELETE FROM readiness_verdicts WHERE user_id = $1`, [id])
    }
  })

  afterAll(async () => {
    for (const id of [USER_A, USER_B]) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])   // cascades the verdicts
    }
    await pool.end()
  })

  it('round-trips the verdict, the band, the counts AND the contributors', async () => {
    await repo.upsertReadinessVerdict(USER_A, record())
    expect(await repo.getReadinessVerdict(USER_A, DAY)).toEqual({ ...record(), responseState: 'none' })
  })

  it('a re-judgement updates the evidence but NEVER erases the answer', async () => {
    await repo.upsertReadinessVerdict(USER_A, record())
    expect(await repo.setReadinessVerdictResponse(USER_A, DAY, 'rated')).toBe(true)

    await repo.upsertReadinessVerdict(USER_A, record({ verdict: 'normal', score: 63 }))

    const got = await repo.getReadinessVerdict(USER_A, DAY)
    expect(got?.verdict).toBe('normal')     // the evidence moved
    expect(got?.score).toBe(63)
    expect(got?.responseState).toBe('rated') // his answer did not
  })

  it('reports when there is no verdict to respond to', async () => {
    expect(await repo.setReadinessVerdictResponse(USER_A, '2019-01-01', 'dismissed')).toBe(false)
  })

  it('returns null rather than inventing a verdict for a day never judged', async () => {
    expect(await repo.getReadinessVerdict(USER_A, '2019-01-02')).toBeNull()
  })

  it('keeps one user out of another\'s verdicts', async () => {
    await repo.upsertReadinessVerdict(USER_A, record({ verdict: 'poor' }))
    await repo.upsertReadinessVerdict(USER_B, record({ verdict: 'good', score: 88 }))
    expect((await repo.getReadinessVerdict(USER_A, DAY))?.verdict).toBe('poor')
    expect((await repo.getReadinessVerdict(USER_B, DAY))?.verdict).toBe('good')

    // B answering must not answer A's, and B cannot answer a day only A was asked about.
    await repo.setReadinessVerdictResponse(USER_B, DAY, 'dismissed')
    expect((await repo.getReadinessVerdict(USER_A, DAY))?.responseState).toBe('none')
    await repo.upsertReadinessVerdict(USER_A, record({ date: '2026-10-05' }))
    expect(await repo.setReadinessVerdictResponse(USER_B, '2026-10-05', 'rated')).toBe(false)
    expect((await repo.getReadinessVerdict(USER_A, '2026-10-05'))?.responseState).toBe('none')
  })

  it('refuses a verdict or a response state the design does not have', async () => {
    const insert = (verdict: string, state: string) => pool.query(
      `INSERT INTO readiness_verdicts (user_id, date, verdict, score, band_median, band_low, band_high,
         baseline_days, baseline_same_version_days, contributors, readiness_model_version, model_version, response_state)
       VALUES ($1, '2019-02-01', $2, 50, 50, 40, 60, 28, 28, '{}'::jsonb, 'v6', 1, $3)`, [USER_A, verdict, state])
    await expect(insert('terrible', 'none')).rejects.toThrow()
    // Sleep's states are not readiness's: the prompt is rated or dismissed, never acknowledged.
    await expect(insert('poor', 'acknowledged')).rejects.toThrow()
    await expect(insert('poor', 'corrected')).rejects.toThrow()
    await expect(insert('poor', 'rated')).resolves.toBeDefined()
  })
})
