// `updateUserPreferences` is a MERGE, and the merge is the entire feature (Q-392).
//
// Preferences moved off `localStorage` so a reinstall or a second browser keeps them. That only
// holds if a write from one device leaves the other device's keys alone — a replace looks correct
// on the device that wrote and silently wipes the other's settings, which is worse than the
// device-local storage it replaced, because the user now believes it syncs.
//
// Verified by mutation: replacing the merge with `set({ preferences: patch })` fails "keeps keys
// this device has never heard of"; dropping the `null` branch fails "an explicit null clears";
// dropping the row lock is not observable here and is argued at the call site instead.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000f001'

describe.skipIf(!canRun)('user preferences — merge semantics', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    const { PostgresWorkoutRepository } = await import('@/lib/data/postgres/adapter')
    repo = new PostgresWorkoutRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'prefs-merge@example.com', 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`UPDATE users SET preferences = '{}'::jsonb WHERE id = $1`, [USER])
  })

  it('starts empty rather than defaulted — an absent key means "never set"', async () => {
    expect(await repo.getUserPreferences(USER)).toEqual({})
  })

  it('keeps keys this device has never heard of', async () => {
    await repo.updateUserPreferences(USER, { scoreRingStyle: 'arc', weightLookback: 90 })
    // A second device that only knows about home widgets writes its own key.
    const merged = await repo.updateUserPreferences(USER, { homeWidgets: ['water', 'steps'] })
    expect(merged).toEqual({ scoreRingStyle: 'arc', weightLookback: 90, homeWidgets: ['water', 'steps'] })
    expect(await repo.getUserPreferences(USER)).toEqual(merged)
  })

  it('overwrites a key it does send', async () => {
    await repo.updateUserPreferences(USER, { scoreRingStyle: 'arc' })
    const merged = await repo.updateUserPreferences(USER, { scoreRingStyle: 'dial' })
    expect(merged.scoreRingStyle).toBe('dial')
  })

  it('replaces an array wholesale rather than concatenating', async () => {
    await repo.updateUserPreferences(USER, { homeCards: ['a', 'b', 'c'] })
    const merged = await repo.updateUserPreferences(USER, { homeCards: ['a'] })
    // Removing a card is expressed as a shorter list; a deep merge would make removal impossible.
    expect(merged.homeCards).toEqual(['a'])
  })

  it('an explicit null clears the key, and absence does not', async () => {
    await repo.updateUserPreferences(USER, { scoreRingStyle: 'arc', weightLookback: 90 })
    const merged = await repo.updateUserPreferences(USER, { scoreRingStyle: null })
    expect('scoreRingStyle' in merged).toBe(false)
    expect(merged.weightLookback).toBe(90)
  })

  it('returns the merged bag, so the caller learns what the other device set', async () => {
    await repo.updateUserPreferences(USER, { foodRegion: 'AU' })
    const merged = await repo.updateUserPreferences(USER, { mealReminders: true })
    expect(merged).toEqual({ foodRegion: 'AU', mealReminders: true })
  })

  it('an empty patch is a no-op, not a wipe', async () => {
    await repo.updateUserPreferences(USER, { scoreRingStyle: 'arc' })
    expect(await repo.updateUserPreferences(USER, {})).toEqual({ scoreRingStyle: 'arc' })
  })

  it('does not clobber a write that lands mid-merge', async () => {
    // The interleaving that loses data, staged deterministically rather than raced: another
    // device's write commits between this one's read and its write. Without the row lock the
    // read sees the pre-write bag (MVCC does not block it), the UPDATE then queues behind the
    // other transaction, and the merge it finally writes is built from a bag that is already
    // stale — silently dropping the other device's key.
    const other = await pool.connect()
    let merged: Awaited<ReturnType<typeof repo.updateUserPreferences>>
    try {
      await other.query('BEGIN')
      await other.query(`UPDATE users SET preferences = '{"scoreRingStyle":"arc"}'::jsonb WHERE id = $1`, [USER])

      const pending = repo.updateUserPreferences(USER, { weightLookback: 30 })
      await new Promise(r => setTimeout(r, 150))
      await other.query('COMMIT')
      merged = await pending
    } finally {
      other.release()
    }

    expect(merged).toEqual({ scoreRingStyle: 'arc', weightLookback: 30 })
    expect(await repo.getUserPreferences(USER)).toEqual(merged)
  })

  it('is scoped to the user — one account cannot write another\'s bag', async () => {
    // NOT ...f002: that is `app/api/admin/backfill-derived-scores/__tests__/backfill.test.ts`'s only
    // test user, and the `finally` below DELETEs it. Vitest runs files in parallel workers against
    // one shared local database, so that delete can land between the other file's seed and its
    // query, failing it on `sleep_sessions_user_id_fkey` — a red run in a file the PR never touched.
    // Second instance of this shape found on 2026-08-26; the survey is in LA-32.
    const other = '00000000-0000-4000-8000-00000000f0a2'
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'prefs-merge-other-f0a2@example.com', 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [other])
    try {
      await repo.updateUserPreferences(USER, { scoreRingStyle: 'arc' })
      expect(await repo.getUserPreferences(other)).toEqual({})
    } finally {
      await pool.query(`DELETE FROM users WHERE id = $1`, [other])
    }
  })
})
