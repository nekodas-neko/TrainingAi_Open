// #3087 — a workout deleted in the Oura app stops counting: its `oura_workouts` row is tombstoned
// (`deleted_at`), never deleted, and every reader leaves it out. Oura sending it again revives it.
//
// Runs against a real Postgres (DATABASE_URL) and skips without one.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { OuraWorkoutUpsertRow } from '@/lib/data/postgres/slices/oura'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003087'
const OTHER = '00000000-0000-4000-8000-000000013087'

const workout = (id: string, day: string): OuraWorkoutUpsertRow => ({
  id, day, activity: 'running',
  startDatetime: new Date(`${day}T07:00:00+10:00`), endDatetime: new Date(`${day}T07:40:00+10:00`),
  calories: null, distanceM: 6000, intensity: 'moderate', source: 'autodetected', label: null,
})

describe.skipIf(!canRun)('oura_workouts tombstones (#3087)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const [id, email] of [[USER, 'issue-3087@example.com'], [OTHER, 'issue-3087-other@example.com']]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, email])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]]) // cascades oura_workouts
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_workouts WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await repo.upsertOuraWorkouts(USER, [workout('t3087-a', '2026-10-08'), workout('t3087-b', '2026-10-09'), workout('t3087-c', '2026-10-12')])
    await repo.upsertOuraWorkouts(OTHER, [workout('t3087-x', '2026-10-09')])
  })

  const ids = async (userId = USER) => (await repo.getOuraWorkouts(userId, { from: '2026-10-01', to: '2026-10-31' })).map(w => w.id).sort()
  const stored = async () => (await pool.query(`SELECT id, deleted_at FROM oura_workouts WHERE user_id = $1 ORDER BY id`, [USER])).rows

  it('a delete tombstones the row, keeps it, and leaves it out of the read', async () => {
    expect(await repo.tombstoneOuraWorkouts(USER, ['t3087-b'])).toBe(1)
    expect(await ids()).toEqual(['t3087-a', 't3087-c'])
    const rows = await stored()
    expect(rows).toHaveLength(3)
    expect(rows.find(r => r.id === 't3087-b')?.deleted_at).toBeInstanceOf(Date)
    // A second delete event finds nothing new.
    expect(await repo.tombstoneOuraWorkouts(USER, ['t3087-b'])).toBe(0)
  })

  it("never tombstones another user's workout", async () => {
    expect(await repo.tombstoneOuraWorkouts(USER, ['t3087-x'])).toBe(0)
    expect(await ids(OTHER)).toEqual(['t3087-x'])
  })

  it('the reconcile tombstones only the days it read, and only what Oura no longer lists', async () => {
    expect(await repo.tombstoneOuraWorkoutsAbsent(USER, { from: '2026-10-08', to: '2026-10-10', keepIds: ['t3087-a'] })).toBe(1)
    // b is gone from a day Oura re-read; c is outside the range, and the other user's x is never touched.
    expect(await ids()).toEqual(['t3087-a', 't3087-c'])
    expect(await ids(OTHER)).toEqual(['t3087-x'])
  })

  it('an empty list for the range tombstones every workout on those days', async () => {
    expect(await repo.tombstoneOuraWorkoutsAbsent(USER, { from: '2026-10-08', to: '2026-10-10', keepIds: [] })).toBe(2)
    expect(await ids()).toEqual(['t3087-c'])
  })

  it('a dry run counts what the sweep would tombstone and writes nothing (#3389)', async () => {
    expect(await repo.tombstoneOuraWorkoutsAbsent(USER, { from: '2026-10-08', to: '2026-10-10', keepIds: ['t3087-a'], dryRun: true })).toBe(1)
    expect(await ids()).toEqual(['t3087-a', 't3087-b', 't3087-c'])
    expect((await stored()).every(r => r.deleted_at === null)).toBe(true)
  })

  it('a workout Oura sends again is live again', async () => {
    await repo.tombstoneOuraWorkouts(USER, ['t3087-b'])
    await repo.upsertOuraWorkouts(USER, [workout('t3087-b', '2026-10-09')])
    expect(await ids()).toEqual(['t3087-a', 't3087-b', 't3087-c'])
  })
})
