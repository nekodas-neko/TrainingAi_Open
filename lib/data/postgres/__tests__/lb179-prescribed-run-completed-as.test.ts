// LB-179 — `prescribed_runs.completed_as`, through both write paths and the create upsert.
//
// The rules that keep a stale 'walk' from outliving its day:
//   · every status write sets it: what the client sent, or null (a run) when it sent nothing;
//   · a fresh or regenerated prescription resets it to null.
// And the offline push branch goes through the same repository function as the web PATCH.
//
// Runs only against a real local dev Postgres; skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000179a01'
const OTHER = '00000000-0000-4000-8000-000000179a02'
const DATE = '2026-09-20'

describe.skipIf(!canRun)('prescribed_runs.completed_as (LB-179)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let planId: string

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'lb179@example.com', 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [USER])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'lb179-other@example.com', 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [OTHER])
    planId = (await pool.query(`INSERT INTO running_plans (user_id, goal_kind, framework_key, fitness_snapshot, is_active) VALUES ($1, 'general', 'polarized', '{}'::jsonb, true) RETURNING id`, [USER])).rows[0].id
  })
  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM running_plans WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM activity_logs WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]])
  })

  const fresh = () => repo.upsertPrescribedRun(USER, {
    id: crypto.randomUUID(), planId, date: DATE, runType: 'tempo', durationMin: 30, distanceKm: null,
    targetHrLow: 150, targetHrHigh: 165, targetZoneIds: [3], rationale: '', gateAction: 'proceed',
    status: 'pending', activityLogId: null,
  })
  const stored = async (id: string) => (await pool.query(`SELECT status, completed_as FROM prescribed_runs WHERE id = $1`, [id])).rows[0]

  it('records a walk, and a later completion that does not say reads as a run', async () => {
    const r = await fresh()
    expect((await stored(r.id)).completed_as).toBeNull()
    const walked = await repo.updatePrescribedRun(USER, r.id, { status: 'completed', completedAs: 'walk' })
    expect(walked?.completedAs).toBe('walk')
    await repo.updatePrescribedRun(USER, r.id, { status: 'completed' })
    expect(await stored(r.id)).toEqual({ status: 'completed', completed_as: null })
  })

  it('a regenerated prescription for the day drops the old walk', async () => {
    const r = await fresh()
    await repo.updatePrescribedRun(USER, r.id, { status: 'completed', completedAs: 'walk' })
    // Same (user, plan, date): the create upsert's conflict path. It rewrites the row's id too (existing
    // behaviour), so follow the returned id and check the day still holds one row.
    const again = await fresh()
    expect(await stored(again.id)).toEqual({ status: 'pending', completed_as: null })
    const n = (await pool.query(`SELECT count(*)::int AS n FROM prescribed_runs WHERE plan_id = $1 AND date = $2`, [planId, DATE])).rows[0].n
    expect(n).toBe(1)
  })

  it('the offline push branch carries it through the same write', async () => {
    const r = await fresh()
    const res = await repo.pushMutations(USER, [{ domain: 'prescribed_run', date: DATE, payload: { id: r.id, status: 'completed', completedAs: 'walk' } }])
    expect(res.errors ?? []).toEqual([])
    expect(await stored(r.id)).toEqual({ status: 'completed', completed_as: 'walk' })
  })

  // #3796: the activity link is client-supplied on both write paths, so it is stored only when it
  // names one of the caller's own activity logs, and as null otherwise — the status still lands.
  it("stores the caller's own activity link, and null for another user's", async () => {
    const activity = async (userId: string) => (await pool.query(
      `INSERT INTO activity_logs (user_id, date, activity_type, title) VALUES ($1, $2, 'other', 'Run') RETURNING id`,
      [userId, DATE])).rows[0].id as string
    const own = await activity(USER)
    const foreign = await activity(OTHER)
    const link = async (id: string) => (await pool.query(`SELECT status, activity_log_id FROM prescribed_runs WHERE id = $1`, [id])).rows[0]

    const r = await fresh()
    await repo.updatePrescribedRun(USER, r.id, { status: 'completed', activityLogId: own })
    expect(await link(r.id)).toEqual({ status: 'completed', activity_log_id: own })

    await repo.updatePrescribedRun(USER, r.id, { status: 'completed', activityLogId: foreign })
    expect(await link(r.id)).toEqual({ status: 'completed', activity_log_id: null })

    // The offline push goes through the same write, and is not refused over the link.
    const res = await repo.pushMutations(USER, [{ domain: 'prescribed_run', date: DATE, payload: { id: r.id, status: 'completed', activityLogId: foreign } }])
    expect(res.errors ?? []).toEqual([])
    expect(await link(r.id)).toEqual({ status: 'completed', activity_log_id: null })
  })

  it('the database refuses any other value', async () => {
    const r = await fresh()
    await expect(pool.query(`UPDATE prescribed_runs SET completed_as = 'swim' WHERE id = $1`, [r.id])).rejects.toThrow(/completed_as_check/)
  })
})
