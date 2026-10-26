// #3153 — a session deleted in the Oura app leaves the day timeline: its `oura_sessions` row is
// tombstoned (`deleted_at`), never deleted, and `listOuraSessions` leaves it out. Oura sending it
// again revives it. The column itself is checked by oura-sessions-deleted-at-column-3153.test.ts.
//
// Runs against a real Postgres (DATABASE_URL) and skips without one. Synthetic values only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { OuraSessionRow } from '@/lib/data/postgres/slices/oura'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000023153'
const OTHER = '00000000-0000-4000-8000-000000033153'

const session = (ouraId: string, day: string): OuraSessionRow => ({
  ouraId, day, sessionType: 'meditation', mood: 'good',
  startDatetime: new Date(`${day}T12:00:00+10:00`), endDatetime: new Date(`${day}T12:10:00+10:00`),
  heartRate: null, heartRateVariability: null, motionCount: null,
})

describe.skipIf(!canRun)('oura_sessions tombstones (#3153)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `oura-sessions-${id}@example.com`])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]]) // cascades oura_sessions
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_sessions WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await repo.upsertOuraSessions(USER, [session('t3153-a', '2026-10-08'), session('t3153-b', '2026-10-09'), session('t3153-c', '2026-10-12')])
    // Oura's ids are per account; the other user holding the same id must never be touched.
    await repo.upsertOuraSessions(OTHER, [session('t3153-b', '2026-10-09'), session('t3153-x', '2026-10-09')])
  })

  const ids = async (userId = USER) => (await repo.listOuraSessions(userId, '2026-10-01', '2026-10-31')).map(r => r.ouraId).sort()
  const stored = async (userId = USER) =>
    (await pool.query(`SELECT oura_id, deleted_at, updated_at FROM oura_sessions WHERE user_id = $1 ORDER BY oura_id`, [userId])).rows

  it('a delete tombstones the row, keeps it, moves updated_at, and leaves it out of the read', async () => {
    const before = (await stored()).find(r => r.oura_id === 't3153-b')!.updated_at as Date
    await new Promise(r => setTimeout(r, 5))
    expect(await repo.tombstoneOuraSessions(USER, ['t3153-b'])).toBe(1)
    expect(await ids()).toEqual(['t3153-a', 't3153-c'])
    const rows = await stored()
    expect(rows).toHaveLength(3)
    const b = rows.find(r => r.oura_id === 't3153-b')!
    expect(b.deleted_at).toBeInstanceOf(Date)
    expect((b.updated_at as Date).getTime()).toBeGreaterThan(before.getTime())
    // A second delete event finds nothing new.
    expect(await repo.tombstoneOuraSessions(USER, ['t3153-b'])).toBe(0)
  })

  it("never tombstones another user's session, even one with the same Oura id", async () => {
    expect(await repo.tombstoneOuraSessions(USER, ['t3153-x'])).toBe(0)
    await repo.tombstoneOuraSessions(USER, ['t3153-b'])
    expect(await ids(OTHER)).toEqual(['t3153-b', 't3153-x'])
    expect((await stored(OTHER)).every(r => r.deleted_at === null)).toBe(true)
  })

  it('the reconcile tombstones only the days it read, and only what Oura no longer lists', async () => {
    expect(await repo.tombstoneOuraSessionsAbsent(USER, { from: '2026-10-08', to: '2026-10-10', keepIds: ['t3153-a'] })).toBe(1)
    // b is gone from a day Oura re-read; c is outside the range, and the other user is never touched.
    expect(await ids()).toEqual(['t3153-a', 't3153-c'])
    expect(await ids(OTHER)).toEqual(['t3153-b', 't3153-x'])
  })

  it('an empty list for the range tombstones every session on those days', async () => {
    expect(await repo.tombstoneOuraSessionsAbsent(USER, { from: '2026-10-08', to: '2026-10-10', keepIds: [] })).toBe(2)
    expect(await ids()).toEqual(['t3153-c'])
  })

  it('a dry run counts what the sweep would tombstone and writes nothing (#3389)', async () => {
    const before = (await pool.query(`SELECT oura_id, deleted_at, updated_at FROM oura_sessions WHERE user_id = $1 ORDER BY oura_id`, [USER])).rows
    expect(await repo.tombstoneOuraSessionsAbsent(USER, { from: '2026-10-08', to: '2026-10-10', keepIds: [], dryRun: true })).toBe(2)
    expect(await ids()).toEqual(['t3153-a', 't3153-b', 't3153-c'])
    const after = (await pool.query(`SELECT oura_id, deleted_at, updated_at FROM oura_sessions WHERE user_id = $1 ORDER BY oura_id`, [USER])).rows
    expect(after).toEqual(before)
  })

  it('a session Oura sends again is live again', async () => {
    await repo.tombstoneOuraSessions(USER, ['t3153-b'])
    await repo.upsertOuraSessions(USER, [session('t3153-b', '2026-10-09')])
    expect(await ids()).toEqual(['t3153-a', 't3153-b', 't3153-c'])
  })
})
