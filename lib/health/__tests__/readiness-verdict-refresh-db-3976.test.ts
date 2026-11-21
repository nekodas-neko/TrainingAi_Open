// #3976 — the conditional rewrite of an unanswered readiness verdict, against a real database.
//
// The in-memory test (`readiness-verdict-refresh-3976.test.ts`) proves the helper's decisions; this
// proves the adapter's statement: it rewrites a row only while `response_state = 'none'`, never
// writes `response_state`, and creates nothing for a day with no row.
//
// Runs only against a real Postgres — skips without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000003976a01'
// Fixed dates: the helper judges the date it is given, never the clock.
const DAY = '2026-09-30'
const V = 'v5:no-checkin:2026-10-06'

describe.skipIf(!canRun)('readiness verdict refresh — real database (#3976)', () => {
  let pool: import('pg').Pool

  const setScore = (day: string, score: number) => pool.query(
    `UPDATE oura_daily_derived SET readiness_score = $3, readiness_contributors = $4::jsonb WHERE user_id = $1 AND day = $2`,
    [TEST_USER_ID, day, score, JSON.stringify({ hrvBalance: { score } })])
  const verdictRow = async (day: string) => (await pool.query(
    `SELECT score, verdict, band_low, band_high, response_state FROM readiness_verdicts WHERE user_id = $1 AND date = $2`,
    [TEST_USER_ID, day])).rows

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')`,
      [TEST_USER_ID, `readiness-verdict-refresh-${TEST_USER_ID}@example.com`],
    )
    // 28 ordinary days (60–66) before each judged day, and the three judged days at 63.
    for (let i = 0; i <= 30; i++) {
      const day = shiftDateStr(DAY, -i)
      const score = i <= 2 ? 63 : 60 + ((i - 1) % 7)
      await pool.query(
        `INSERT INTO oura_daily_derived (user_id, day, readiness_score, readiness_contributors, readiness_source, model_versions)
         VALUES ($1, $2, $3, $4::jsonb, 'ble-derived', $5::jsonb)`,
        [TEST_USER_ID, day, score, JSON.stringify({ hrvBalance: { score } }), JSON.stringify({ readiness: V })],
      )
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID]) // cascades every row
  })

  async function freeze(day: string) {
    const { getRepository } = await import('@/lib/data')
    const { buildReadinessVerdictRecord, READINESS_VERDICT_HISTORY_DAYS } = await import('@/lib/health/readiness-verdict-refresh')
    const repo = await getRepository()
    const built = buildReadinessVerdictRecord(day, await repo.getOuraDailyDerived(TEST_USER_ID, shiftDateStr(day, -READINESS_VERDICT_HISTORY_DAYS), day))
    if (built.kind !== 'record') throw new Error(`fixture ${built.kind}`)
    await repo.upsertReadinessVerdict(TEST_USER_ID, built.record)
  }

  async function refresh(day: string) {
    const { getRepository } = await import('@/lib/data')
    const { refreshUnansweredReadinessVerdict } = await import('@/lib/health/readiness-verdict-refresh')
    return refreshUnansweredReadinessVerdict(await getRepository(), TEST_USER_ID, day)
  }

  it('an unanswered row follows a re-score', async () => {
    await freeze(DAY)
    const [before] = await verdictRow(DAY)
    expect(before).toMatchObject({ score: 63, verdict: 'normal', response_state: 'none' })
    await setScore(DAY, 41)
    expect(await refresh(DAY)).toBe('updated')
    expect(await verdictRow(DAY)).toEqual([{ ...before, score: 41, verdict: 'poor' }])
  })

  it.each([['rated', 1], ['dismissed', 2]] as const)('a %s row never changes', async (state, back) => {
    const day = shiftDateStr(DAY, -back)
    await freeze(day)
    const { getRepository } = await import('@/lib/data')
    expect(await (await getRepository()).setReadinessVerdictResponse(TEST_USER_ID, day, state)).toBe(true)
    const before = await verdictRow(day)
    await setScore(day, 90)
    expect(await refresh(day)).toBe('answered')
    // The statement itself refuses an answered row, whatever the caller read first.
    const { buildReadinessVerdictRecord } = await import('@/lib/health/readiness-verdict-refresh')
    const built = buildReadinessVerdictRecord(day, await (await getRepository()).getOuraDailyDerived(TEST_USER_ID, shiftDateStr(day, -120), day))
    if (built.kind !== 'record') throw new Error('fixture')
    expect(await (await getRepository()).refreshUnansweredReadinessVerdict(TEST_USER_ID, built.record)).toBe(false)
    expect(await verdictRow(day)).toEqual(before)
  })

  it('a re-score with no row creates none', async () => {
    const day = shiftDateStr(DAY, -3)
    await setScore(day, 41)
    expect(await refresh(day)).toBe('no-row')
    expect(await verdictRow(day)).toEqual([])
  })
})
