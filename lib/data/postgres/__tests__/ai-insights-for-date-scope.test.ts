// Q-291 gives one AI surface the text another has already shown the user today. That read crosses
// no boundary it should not: `ai_health_insights` has no per-row ACL beyond `user_id`, and the
// prompt it feeds is sent to a model, so a scoping slip here leaks one user's health narration into
// another's. The ordering assertion is not cosmetic either — the caller hashes this text to decide
// whether its cached insight is still valid, so an unstable row order regenerates it for nothing.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER_A = '00000000-0000-4000-8000-0000000a1901'
const USER_B = '00000000-0000-4000-8000-0000000a1902'
const DAY = '2026-08-06'
const OTHER_DAY = '2026-08-07'

describe.skipIf(!canRun)('listAiHealthInsightsForDate — scoping and order (Q-291)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const seed = (userId: string, section: string, date: string, insight: string) => pool.query(
    `INSERT INTO ai_health_insights (user_id, section, date, insight)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, section, date) DO UPDATE SET insight = EXCLUDED.insight`,
    [userId, section, date, insight])

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const id of [USER_A, USER_B]) {
      // Email derived from the id, not a hand-written tag. `ON CONFLICT (id)` cannot protect a
      // UNIQUE email, so a tag reused after the UUID changed leaves the old row owning the address
      // and beforeAll dies on `users_email_unique` — which vitest then reports as SKIPPED tests,
      // indistinguishable from the skipIf guard firing. Cost this file one debugging round.
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `ai-insight-scope-${id}@example.com`])
      await pool.query(`DELETE FROM ai_health_insights WHERE user_id = $1`, [id])
    }
    // Inserted out of alphabetical order — but that alone does NOT make the ordering assertion
    // bite: measured here, dropping the ORDER BY still returned these alphabetically, so the test
    // passed against an adapter that had none. An UPDATE is what forces the issue: Postgres writes
    // a new tuple at the end of the heap rather than in place, so re-touching the row that sorts
    // FIRST moves it physically LAST, and an unordered seq scan can no longer come back sorted.
    await seed(USER_A, 'sleep', DAY, 'A sleep')
    await seed(USER_A, 'readiness', DAY, 'A readiness')
    await seed(USER_A, 'activity', DAY, 'A activity placeholder')
    await seed(USER_A, 'activity', DAY, 'A activity')
    await seed(USER_A, 'readiness', OTHER_DAY, 'A readiness tomorrow')
    await seed(USER_B, 'readiness', DAY, "B's private readiness narration")
  })

  afterAll(async () => {
    for (const id of [USER_A, USER_B]) {
      await pool.query(`DELETE FROM ai_health_insights WHERE user_id = $1`, [id])
    }
  })

  it('returns only the asked-for user, never another', async () => {
    const rows = await repo.listAiHealthInsightsForDate(USER_A, DAY)
    expect(rows.map(r => r.insight).join(' ')).not.toContain("B's private")
    expect(rows.every(r => r.insight.startsWith('A '))).toBe(true)
  })

  it('returns only the asked-for date', async () => {
    const rows = await repo.listAiHealthInsightsForDate(USER_A, DAY)
    expect(rows.map(r => r.insight)).not.toContain('A readiness tomorrow')
    expect(rows).toHaveLength(3)
  })

  it('orders by section, so the caller\'s context hash is stable', async () => {
    const rows = await repo.listAiHealthInsightsForDate(USER_A, DAY)
    expect(rows.map(r => r.section)).toEqual(['activity', 'readiness', 'sleep'])
  })

  it('is empty for a user with nothing that day, rather than throwing', async () => {
    expect(await repo.listAiHealthInsightsForDate(USER_B, OTHER_DAY)).toEqual([])
  })
})
