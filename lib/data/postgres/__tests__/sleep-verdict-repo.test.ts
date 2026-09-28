// TN-81 — the half a pure test cannot reach: that the snapshot survives a round trip through
// real columns, that a re-announcement cannot erase an answer, and that both arms are scoped to
// one user.
//
// The response-state case is the one that matters most. Under correction-only feedback, an
// answer silently reverting to silence is unrecoverable: "he agreed" and "he never looked" become
// the same row, which is the ambiguity the three states exist to remove.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type { SleepVerdictRecord } from '@trainingai/shared/types/body'

const canRun = !!process.env.DATABASE_URL
const USER_A = '00000000-0000-4000-8000-00000051ee01'
const USER_B = '00000000-0000-4000-8000-00000051ee02'
const DAY = '2026-09-26'

const record = (over: Partial<Omit<SleepVerdictRecord, 'responseState'>> = {}): Omit<SleepVerdictRecord, 'responseState'> => ({
  date: DAY,
  verdict: 'poor',
  triggered: ['duration', 'onset'],
  components: { durationHours: 5.2, onsetMinutes: 90, efficiency: 88 },
  bands: {
    durationLow: 6.9, durationHigh: 8.8,
    onsetLow: -95, onsetHigh: -15,
    efficiencyLow: 85.5, efficiencyHigh: 93.5,
  },
  baselineNights: 28,
  modelVersion: 1,
  ...over,
})

describe.skipIf(!canRun)('sleep verdict repository', () => {
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
         ON CONFLICT (id) DO NOTHING`, [id, `sleep-verdict-${tag}@example.com`])
      await pool.query(`DELETE FROM sleep_verdicts WHERE user_id = $1`, [id])
    }
  })

  // Every case starts from no verdicts. Without this the response-state cases leak into the
  // isolation one and it fails for a reason that has nothing to do with user scoping — the
  // aged-fixture trap this repo's local-DB notes warn about, arriving inside a single file.
  beforeEach(async () => {
    for (const id of [USER_A, USER_B]) {
      await pool.query(`DELETE FROM sleep_verdicts WHERE user_id = $1`, [id])
    }
  })

  afterAll(async () => {
    for (const id of [USER_A, USER_B]) {
      await pool.query(`DELETE FROM sleep_verdicts WHERE user_id = $1`, [id])
    }
    await pool.end()
  })

  it('round-trips the verdict, the component values AND the bands', async () => {
    await repo.upsertSleepVerdict(USER_A, record())
    const got = await repo.getSleepVerdict(USER_A, DAY)
    expect(got).toEqual({ ...record(), responseState: 'none' })
  })

  it('a re-announcement updates the evidence but NEVER erases the answer', async () => {
    await repo.upsertSleepVerdict(USER_A, record())
    expect(await repo.setSleepVerdictResponse(USER_A, DAY, 'corrected')).toBe(true)

    // Same night announced again — e.g. the sheet reopened, or a later night's data arriving.
    await repo.upsertSleepVerdict(USER_A, record({ verdict: 'normal', triggered: [] }))

    const got = await repo.getSleepVerdict(USER_A, DAY)
    expect(got?.verdict).toBe('normal')          // the evidence moved
    expect(got?.responseState).toBe('corrected') // his answer did not
  })

  it('reports when there is no announcement to respond to', async () => {
    expect(await repo.setSleepVerdictResponse(USER_A, '2019-01-01', 'acknowledged')).toBe(false)
  })

  it('keeps one user out of another\'s verdicts', async () => {
    await repo.upsertSleepVerdict(USER_A, record({ verdict: 'poor' }))
    await repo.upsertSleepVerdict(USER_B, record({ verdict: 'good', triggered: [] }))
    expect((await repo.getSleepVerdict(USER_A, DAY))?.verdict).toBe('poor')
    expect((await repo.getSleepVerdict(USER_B, DAY))?.verdict).toBe('good')

    await repo.setSleepVerdictResponse(USER_B, DAY, 'acknowledged')
    expect((await repo.getSleepVerdict(USER_A, DAY))?.responseState).toBe('none')
  })

  it('returns null rather than inventing a verdict for a night never announced', async () => {
    expect(await repo.getSleepVerdict(USER_A, '2019-01-02')).toBeNull()
  })

  it('refuses a verdict or a response state the design does not have', async () => {
    await expect(pool.query(
      `INSERT INTO sleep_verdicts (user_id, date, verdict, baseline_nights, model_version)
       VALUES ($1, '2019-02-01', 'terrible', 28, 1)`, [USER_A])).rejects.toThrow()
    await expect(pool.query(
      `INSERT INTO sleep_verdicts (user_id, date, verdict, baseline_nights, model_version, response_state)
       VALUES ($1, '2019-02-02', 'poor', 28, 1, 'agreed')`, [USER_A])).rejects.toThrow()
  })

  it('never writes a touched flag — an announcement is not his answer (TN-57)', async () => {
    await pool.query(`DELETE FROM day_checkins WHERE user_id = $1`, [USER_A])
    await repo.upsertSleepVerdict(USER_A, record())
    await repo.setSleepVerdictResponse(USER_A, DAY, 'acknowledged')
    const { rows } = await pool.query(
      `SELECT count(*) FILTER (WHERE sleep_quality_feel_touched) AS touched FROM day_checkins WHERE user_id = $1`,
      [USER_A])
    expect(Number(rows[0].touched)).toBe(0)
  })
})
