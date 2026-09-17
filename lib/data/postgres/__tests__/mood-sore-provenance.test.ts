// BF-173 — `saveMoodLog` records WHERE each sore tick came from.
//
// The scorer half is unit-tested in
// `packages/shared/src/ai-periodization/__tests__/sore-muscle-provenance.test.ts`; without this
// half the column is never written and the fix is inert, which is the failure mode worth a test of
// its own rather than a comment.
//
// Provenance is recorded at WRITE time on purpose. Re-deriving it at score time is the option the
// owner weighed and rejected: it suppresses the clamp whenever a muscle happens to be
// under-recovered, discarding the one case the check-in exists for — the lifter contradicting the
// model.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000e017'
const TZ = 'Australia/Brisbane'
const DAY = '2026-09-17'

describe.skipIf(!canRun)('BF-173 — mood log sore-muscle provenance', () => {
  let pool: import('pg').Pool
  let repo: Awaited<ReturnType<typeof import('@/lib/data').getRepositoryAsync>>

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'bf173-provenance@example.com', 'x', $2)
       ON CONFLICT (id) DO NOTHING`, [USER, TZ])
    repo = await (await import('@/lib/data')).getRepositoryAsync()
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM mood_logs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM mood_logs WHERE user_id = $1`, [USER])
  })

  const read = async (): Promise<string[] | null> => {
    const { rows } = await pool.query(
      `SELECT suggested_sore_muscles FROM mood_logs WHERE user_id = $1 AND log_date = $2`, [USER, DAY])
    return rows[0]?.suggested_sore_muscles ?? null
  }

  it('stores the caller-supplied list verbatim when one is given', async () => {
    const saved = await repo.saveMoodLog(USER, {
      logDate: DAY, energyLevel: 'ok', sleepQuality: 'ok', bodyState: [],
      soreMuscles: ['quadriceps', 'chest'],
      suggestedSoreMuscles: ['quadriceps'],
    })
    expect(await read()).toEqual(['quadriceps'])
    expect(saved.suggestedSoreMuscles).toEqual(['quadriceps'])
  })

  it('an explicitly empty caller list is kept, not treated as absent', async () => {
    // [] means "checked, none were suggestions" — every tick should clamp. If this were confused
    // with absent, the server would derive a list and silently suppress the lifter's own report.
    await repo.saveMoodLog(USER, {
      logDate: DAY, energyLevel: 'ok', sleepQuality: 'ok', bodyState: [],
      soreMuscles: ['quadriceps'],
      suggestedSoreMuscles: [],
    })
    expect(await read()).toEqual([])
  })

  it('derives a list server-side when the caller supplies none', async () => {
    // No workout history for this user, so nothing is within the suggestion window and the derived
    // answer is []. The point of the case is that the column is WRITTEN rather than left NULL —
    // NULL would mean "unknown" and score every tick the pre-BF-173 way forever.
    await repo.saveMoodLog(USER, {
      logDate: DAY, energyLevel: 'ok', sleepQuality: 'ok', bodyState: [],
      soreMuscles: ['quadriceps'],
    })
    expect(await read()).not.toBeNull()
    expect(await read()).toEqual([])
  })

  it('writes an empty list for a check-in with no sore muscles at all', async () => {
    await repo.saveMoodLog(USER, {
      logDate: DAY, energyLevel: 'good', sleepQuality: 'good', bodyState: [], soreMuscles: [],
    })
    expect(await read()).toEqual([])
  })

  it('re-saving the same day overwrites provenance rather than leaving the first answer', async () => {
    // The write is an upsert on (user_id, log_date); a missed column in the DO UPDATE set is the
    // recurring "save does not persist" shape, so the second save must move it.
    await repo.saveMoodLog(USER, {
      logDate: DAY, energyLevel: 'ok', sleepQuality: 'ok', bodyState: [],
      soreMuscles: ['quadriceps', 'chest'], suggestedSoreMuscles: ['quadriceps', 'chest'],
    })
    expect(await read()).toEqual(['quadriceps', 'chest'])

    await repo.saveMoodLog(USER, {
      logDate: DAY, energyLevel: 'ok', sleepQuality: 'ok', bodyState: [],
      soreMuscles: ['quadriceps', 'chest'], suggestedSoreMuscles: ['quadriceps'],
    })
    expect(await read()).toEqual(['quadriceps'])
  })

  it('getMoodLog reads provenance back out', async () => {
    await repo.saveMoodLog(USER, {
      logDate: DAY, energyLevel: 'ok', sleepQuality: 'ok', bodyState: [],
      soreMuscles: ['chest'], suggestedSoreMuscles: ['chest'],
    })
    const got = await repo.getMoodLog(USER, DAY)
    expect(got?.suggestedSoreMuscles).toEqual(['chest'])
  })
})
