// Issue 2383 (item 2): Fix lbs logged as kg > Apply converts a log once.
//
// `applyLbsToKgFix` rewrites set weights, 1RM, target80 and volume. Nothing marked a log as
// converted, so a second Apply over the same exercises and date converted them again. The marker is
// `exercise_logs.unit_fix_applied_at`, claimed in the same statement that rewrites the log.
//
// DB-backed because the defect is in SQL: a mock cannot say whether the second statement matched a row.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000000023c1'
const OTHER = '00000000-0000-4000-8000-0000000023c2'
const LIFT = 'Unit Fix Test Lift'
const BEFORE = '2026-03-31'
const LBS_TO_KG = 0.45359237

describe.skipIf(!canRun)('applyLbsToKgFix is idempotent (issue 2383)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let oldLog = ''
  let oldSet = ''
  let recentLog = ''
  let deletedLog = ''

  async function seedLog(name: string, at: string, weight: number, e1rm: number, deleted = false) {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, 'S', $2) RETURNING id`,
      [USER, at],
    )
    const el = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at, estimated_1rm, target_80, volume, exercise_deloaded, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, false, $7) RETURNING id`,
      [ws.rows[0].id, name, at, e1rm, e1rm * 0.8, weight * 5, deleted ? new Date() : null],
    )
    const sl = await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, 1, $2, 5) RETURNING id`,
      [el.rows[0].id, weight],
    )
    return { log: el.rows[0].id as string, set: sl.rows[0].id as string }
  }

  const weightOf = async (setId: string) =>
    Number((await pool.query(`SELECT weight_kg FROM set_logs WHERE id = $1`, [setId])).rows[0].weight_kg)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
        [id, `unitfix-${id}@example.com`],
      )
    }
    const a = await seedLog(LIFT, '2026-01-10T00:00:00Z', 100, 150)
    oldLog = a.log; oldSet = a.set
    recentLog = (await seedLog(LIFT, '2026-05-10T00:00:00Z', 60, 90)).log
    deletedLog = (await seedLog(LIFT, '2026-01-12T00:00:00Z', 100, 150, true)).log
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM personal_records WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER]) // cascades to logs and sets
    await pool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [USER, OTHER])
  })

  it('converts a log once; a second Apply leaves weights, 1RM and the marker as they were', async () => {
    const first = await repo.applyLbsToKgFix(USER, [LIFT], BEFORE)
    expect(first.logs.map(l => l.exerciseLogId)).toEqual([oldLog])
    const converted = Math.round(100 * LBS_TO_KG * 2) / 2 // nearest 0.5 kg
    expect(await weightOf(oldSet)).toBe(converted)
    const afterFirst = await pool.query(
      `SELECT estimated_1rm, unit_fix_applied_at FROM exercise_logs WHERE id = $1`, [oldLog])
    expect(afterFirst.rows[0].unit_fix_applied_at).not.toBeNull()

    const second = await repo.applyLbsToKgFix(USER, [LIFT], BEFORE)
    expect(second.logs).toHaveLength(0)
    expect(second.alreadyConverted).toBe(1)
    // The weight is NOT multiplied by the factor a second time.
    expect(await weightOf(oldSet)).toBe(converted)
    const afterSecond = await pool.query(
      `SELECT estimated_1rm, unit_fix_applied_at FROM exercise_logs WHERE id = $1`, [oldLog])
    expect(Number(afterSecond.rows[0].estimated_1rm)).toBe(Number(afterFirst.rows[0].estimated_1rm))
    expect(new Date(afterSecond.rows[0].unit_fix_applied_at).getTime())
      .toBe(new Date(afterFirst.rows[0].unit_fix_applied_at).getTime())
  })

  it('the preview after an Apply reports nothing to convert, and says why', async () => {
    const preview = await repo.previewLbsToKgFix(USER, [LIFT], BEFORE)
    expect(preview.logs).toHaveLength(0)
    expect(preview.alreadyConverted).toBe(1)
  })

  it('leaves a log after the cutoff and a tombstoned log untouched', async () => {
    const recent = await pool.query(`SELECT unit_fix_applied_at FROM exercise_logs WHERE id = $1`, [recentLog])
    const deleted = await pool.query(`SELECT unit_fix_applied_at FROM exercise_logs WHERE id = $1`, [deletedLog])
    expect(recent.rows[0].unit_fix_applied_at).toBeNull()
    expect(deleted.rows[0].unit_fix_applied_at).toBeNull()
  })

  it('two Applies at the same moment convert each log once', async () => {
    const lift = 'Unit Fix Race Lift'
    const seeded = await seedLog(lift, '2026-02-01T00:00:00Z', 80, 120)
    const results = await Promise.all([
      repo.applyLbsToKgFix(USER, [lift], BEFORE),
      repo.applyLbsToKgFix(USER, [lift], BEFORE),
    ])
    expect(results.reduce((n, r) => n + r.logs.length, 0)).toBe(1)
    expect(await weightOf(seeded.set)).toBe(Math.round(80 * LBS_TO_KG * 2) / 2)
  })

  it('does not touch another user\'s marker or weights', async () => {
    const lift = 'Unit Fix Other Lift'
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, 'S', '2026-01-05T00:00:00Z') RETURNING id`, [OTHER])
    const el = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at, estimated_1rm, exercise_deloaded)
       VALUES ($1, $2, '2026-01-05T00:00:00Z', 100, false) RETURNING id`, [ws.rows[0].id, lift])
    const res = await repo.applyLbsToKgFix(USER, [lift], BEFORE)
    expect(res.logs).toHaveLength(0)
    const row = await pool.query(`SELECT unit_fix_applied_at FROM exercise_logs WHERE id = $1`, [el.rows[0].id])
    expect(row.rows[0].unit_fix_applied_at).toBeNull()
    await pool.query(`DELETE FROM workout_sessions WHERE id = $1`, [ws.rows[0].id])
  })
})
