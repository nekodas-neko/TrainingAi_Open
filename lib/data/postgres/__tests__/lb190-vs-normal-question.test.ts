// LB-190. `vs_yesterday` became `vs_normal`, and every answered row records which question it answered,
// because "compared to yesterday" and "compared to normal" are different measurements that must never
// be pooled. These pin the stored pair on both write paths, the legacy outbox key, and the constraint.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { resolveVsAnswer } from '@trainingai/shared/validation/day-checkin'
import { VS_QUESTION, CURRENT_VS_QUESTION } from '@trainingai/shared/types/day-checkin'

describe('resolveVsAnswer', () => {
  it('stamps an answer with the question the client says it asked, else the current one', () => {
    expect(resolveVsAnswer({ vsNormal: 'better', vsQuestion: 2 })).toEqual({ vsNormal: 'better', vsQuestion: 2 })
    expect(resolveVsAnswer({ vsNormal: 'same' })).toEqual({ vsNormal: 'same', vsQuestion: CURRENT_VS_QUESTION })
  })
  // A mutation queued offline before the rename deployed carries the old key and answered the old question.
  it('reads the legacy key as an answer to "compared to yesterday", whatever is current', () => {
    expect(resolveVsAnswer({ vsYesterday: 'worse' })).toEqual({ vsNormal: 'worse', vsQuestion: VS_QUESTION.YESTERDAY })
  })
  it('stores no question for no answer', () => {
    expect(resolveVsAnswer({})).toEqual({ vsNormal: null, vsQuestion: null })
    expect(resolveVsAnswer({ vsNormal: null, vsQuestion: 2 })).toEqual({ vsNormal: null, vsQuestion: null })
  })
})

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000000b1900'
const DAY = '2026-09-30'

describe.skipIf(!canRun)('day_checkins vs_normal + vs_question (LB-190)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const row = async () => (await pool.query(`SELECT vs_normal, vs_question FROM day_checkins WHERE user_id = $1`, [USER])).rows[0]
  const push = (payload: Record<string, unknown>) =>
    repo.pushMutations(USER, [{ id: 'm-lb190', domain: 'day_checkins', date: DAY, payload: { phase: 'morning', ...payload } }])

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, `lb190-${USER}@example.com`])
  })
  afterAll(async () => {
    await pool.query(`DELETE FROM day_checkins WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })
  beforeEach(async () => { await pool.query(`DELETE FROM day_checkins WHERE user_id = $1`, [USER]) })

  it('stores a pushed answer with its question', async () => {
    const res = await push({ vsNormal: 'better', vsQuestion: 2 })
    expect(res.errors ?? []).toEqual([])
    expect(await row()).toEqual({ vs_normal: 'better', vs_question: 2 })
  })

  it('stores a legacy-key mutation as question 1', async () => {
    const res = await push({ vsYesterday: 'worse' })
    expect(res.errors ?? []).toEqual([])
    expect(await row()).toEqual({ vs_normal: 'worse', vs_question: 1 })
  })

  it('reads the pair back through the repository', async () => {
    await push({ vsNormal: 'same', vsQuestion: 1 })
    const c = await repo.getDayCheckin(USER, DAY, 'morning')
    expect(c).toMatchObject({ vsNormal: 'same', vsQuestion: 1 })
  })

  it('refuses an answer with no question, and a question with no answer', async () => {
    await expect(pool.query(
      `INSERT INTO day_checkins (user_id, log_date, phase, vs_normal) VALUES ($1, $2, 'morning', 'better')`, [USER, DAY],
    )).rejects.toThrow(/day_checkins_vs_question_check/)
    await expect(pool.query(
      `INSERT INTO day_checkins (user_id, log_date, phase, vs_question) VALUES ($1, $2, 'morning', 1)`, [USER, DAY],
    )).rejects.toThrow(/day_checkins_vs_question_check/)
  })
})
