// #3779 review — the three guarded writes the walking plan's server settle relies on, against a real
// Postgres:
//   · the plan-state write is a compare-and-set on `updated_at`, including a row whose stamp came
//     from `defaultNow()` (microseconds, which a JS Date cannot hold);
//   · the day rows can be read with their tombstones, so a deleted day is never recreated;
//   · the server's completion changes only a live pending row, and says when it changed none.
//
// Runs only against a real local dev Postgres; skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000377901'
const OTHER = '00000000-0000-4000-8000-000000377902'
const DATE = '2026-11-12'

describe.skipIf(!canRun)('the walking plan\'s guarded writes (#3779)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let planId: string

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const [id, email] of [[USER, 'w3779@example.com'], [OTHER, 'w3779-other@example.com']]) {
      await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [id, email])
    }
    // Inserted by SQL so `updated_at` is the column default, with microseconds.
    planId = (await pool.query(`INSERT INTO running_plans (user_id, goal_kind, framework_key, fitness_snapshot, is_active) VALUES ($1, 'walking', 'walking-heart-health', '{}'::jsonb, true) RETURNING id`, [USER])).rows[0].id
  })
  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM running_plans WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]])
  })

  it('writes the state when the row is unchanged since the read, and refuses when it is not', async () => {
    const read = (await repo.getActiveRunningPlan(USER))!
    const micros = (await pool.query(`SELECT extract(microseconds FROM updated_at)::int % 1000 AS us FROM running_plans WHERE id = $1`, [planId])).rows[0].us
    expect(typeof micros).toBe('number') // usually non-zero: the case a plain equality would miss
    const first = await repo.updateRunningPlanSnapshot(USER, planId, { walkingPlan: { v: 1 } }, { ifUpdatedAt: read.updatedAt })
    expect(first).not.toBeNull()
    // The same stale read again: someone (this write) changed the row since.
    expect(await repo.updateRunningPlanSnapshot(USER, planId, { walkingPlan: { v: 2 } }, { ifUpdatedAt: read.updatedAt })).toBeNull()
    expect((await repo.getActiveRunningPlan(USER))!.fitnessSnapshot).toEqual({ walkingPlan: { v: 1 } })
    // From the returned row's stamp it goes through.
    expect(await repo.updateRunningPlanSnapshot(USER, planId, { walkingPlan: { v: 3 } }, { ifUpdatedAt: first!.updatedAt })).not.toBeNull()
  })

  it('never writes another user\'s plan, with or without the stamp', async () => {
    const read = (await repo.getActiveRunningPlan(USER))!
    expect(await repo.updateRunningPlanSnapshot(OTHER, planId, { x: 1 }, { ifUpdatedAt: read.updatedAt })).toBeNull()
    expect(await repo.updateRunningPlanSnapshot(OTHER, planId, { x: 1 })).toBeNull()
  })

  const day = () => repo.upsertPrescribedRun(USER, {
    id: crypto.randomUUID(), planId, date: DATE, runType: 'walk', durationMin: 9, distanceKm: null,
    targetHrLow: 110, targetHrHigh: null, targetZoneIds: [], rationale: '', gateAction: 'proceed',
    status: 'pending', activityLogId: null,
  })

  it('completes only a live pending day, and reports when it changed nothing', async () => {
    const r = await day()
    await repo.updatePrescribedRun(USER, r.id, { status: 'skipped' })
    expect(await repo.updatePrescribedRun(USER, r.id, { status: 'completed', completedAs: 'walk' }, { onlyIfPending: true })).toBeNull()
    expect((await pool.query(`SELECT status FROM prescribed_runs WHERE id = $1`, [r.id])).rows[0].status).toBe('skipped')
    const again = await day() // the day regenerated: pending again
    const done = await repo.updatePrescribedRun(USER, again.id, { status: 'completed', completedAs: 'walk' }, { onlyIfPending: true })
    expect(done?.status).toBe('completed')
  })

  it('reads a deleted day only when asked, with its tombstone, and never completes it', async () => {
    const r = await day()
    await pool.query(`UPDATE prescribed_runs SET deleted_at = now() WHERE id = $1`, [r.id])
    expect((await repo.getPrescribedRuns(USER, DATE, DATE)).filter((x) => x.planId === planId)).toHaveLength(0)
    const all = (await repo.getPrescribedRuns(USER, DATE, DATE, { includeDeleted: true })).filter((x) => x.planId === planId)
    expect(all).toHaveLength(1)
    expect(all[0].deletedAt).toBeInstanceOf(Date)
    expect(await repo.updatePrescribedRun(USER, r.id, { status: 'completed', completedAs: 'walk' }, { onlyIfPending: true })).toBeNull()
  })
})
