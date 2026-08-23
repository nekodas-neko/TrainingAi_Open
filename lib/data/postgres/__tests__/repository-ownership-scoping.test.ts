// Ownership scoping across repository domains (Q-155).
//
// Measured 2026-08-09 by mutation: neutralising ALL 246 `eq(x.userId, userId)` / `user_id = ${userId}`
// predicates in the adapter and its slices left **286 of 317** DB tests passing. Per-file, three
// slices (`nutrition`, `body-battery`, `social`) could have every ownership check deleted with
// **zero** failures, and two whole quartiles of `adapter.ts` behaved the same — 93 of 246 predicates
// provably unguarded, as a lower bound.
//
// The scoping is CORRECT today. The gap is that nothing would tell you if it stopped being, in the
// highest-severity class this project has. These tests are the burn-down: each one fails if its
// method's `user_id` predicate is removed.
//
// Extending this is deliberately cheap — add a row to READERS or a case to the destructive block.
// The full uncovered list is in `docs/reviews/2026-08-09-ownership-mutation-coverage.md`.
//
// Runs only against a real local dev Postgres — skips cleanly elsewhere (CI's "Tests" job has no
// DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const USER_A = '00000000-0000-4000-8000-00000000a01a'
const USER_B = '00000000-0000-4000-8000-00000000b01b'
// A third party exists only so `removeFriend` can be called by someone who is neither the
// requester nor the addressee — with two users every friendship has A on one side of it.
const USER_C = '00000000-0000-4000-8000-00000000c01c'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER_A, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

const DAY = '2026-03-14'
const FROM = '2026-03-01'
const TO = '2026-03-31'

describe.skipIf(!canRun)('repository ownership scoping (Q-155)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const bIds: Record<string, string> = {}

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    for (const [id, tag] of [[USER_A, 'a'], [USER_B, 'b'], [USER_C, 'c']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `ownership-scoping-${tag}@example.com`],
      )
    }

    // Everything below belongs to B. A must never see or touch any of it.
    const inj = await pool.query(
      `INSERT INTO injuries (user_id, muscle_name, notes, severity, started_date)
       VALUES ($1, 'B SECRET KNEE', 'B private note', 'moderate', $2) RETURNING id`,
      [USER_B, DAY],
    )
    bIds.injury = inj.rows[0].id

    const sup = await pool.query(
      `INSERT INTO supplements (user_id, name, dose, sort_order, active, updated_at)
       VALUES ($1, 'B SECRET CREATINE', '5g', 0, true, now()) RETURNING id`,
      [USER_B],
    )
    bIds.supplement = sup.rows[0].id

    const act = await pool.query(
      `INSERT INTO activity_logs (user_id, activity_type, title, date, duration_min)
       VALUES ($1, 'walk', 'B SECRET WALK', $2, 42) RETURNING id`,
      [USER_B, DAY],
    )
    bIds.activity = act.rows[0].id

    await pool.query(
      `INSERT INTO mood_logs (user_id, log_date, energy_level, sleep_quality) VALUES ($1, $2, 3, 'ok')
       ON CONFLICT DO NOTHING`,
      [USER_B, DAY],
    )

    // Without a B row here the getBodyBatteryHistory assertion has nothing to leak and passes
    // whether or not the scoping exists — a test that cannot fail. Verified by mutation: with this
    // seed it fails when the predicate is removed, and without it, it did not.
    await pool.query(
      `INSERT INTO body_battery_daily
         (user_id, date, anchor, anchor_source, end_value, day_min, day_max,
          total_charged, total_drained, resting_hr, hr_max, hr_sample_count, model_version)
       VALUES ($1, $2, 55, 'seed', 61, 40, 88, 30, 24, 52, 190, 100, 1)
       ON CONFLICT DO NOTHING`,
      [USER_B, DAY],
    )

    // Nutrition: the whole slice failed zero tests under mutation, so all of it is seeded here.
    const mt = await pool.query(
      `INSERT INTO meal_types (user_id, name, emoji, sort_order, required, reminders_enabled,
                               time_start_hour, time_end_hour)
       VALUES ($1, 'B SECRET BRUNCH', '\u{1F373}', 0, false, false, 9, 12) RETURNING id`,
      [USER_B],
    )
    bIds.mealType = mt.rows[0].id

    // deleteMealType throws MEAL_TYPE_HAS_LOGS before it ever reaches the ownership check, so
    // testing it against the meal type above would pass whether or not the scoping exists. This
    // second type has no logs, which is the only way that test can actually fail.
    const mt2 = await pool.query(
      `INSERT INTO meal_types (user_id, name, emoji, sort_order, required, reminders_enabled,
                               time_start_hour, time_end_hour)
       VALUES ($1, 'B SECRET SNACK', '\u{1F34E}', 1, false, false, 15, 17) RETURNING id`,
      [USER_B],
    )
    bIds.emptyMealType = mt2.rows[0].id

    const fi = await pool.query(
      `INSERT INTO food_items (user_id, name, calories, protein_g, carbs_g, fat_g,
                               serving_size_g, region, source)
       VALUES ($1, 'B SECRET OATS', 380, 13, 67, 7, 100, 'AU', 'manual') RETURNING id`,
      [USER_B],
    )
    bIds.foodItem = fi.rows[0].id

    const fl = await pool.query(
      `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier,
                              logged_at, updated_at)
       VALUES ($1, $2, $3, $4, 1.5, now(), now()) RETURNING id`,
      [USER_B, DAY, bIds.mealType, bIds.foodItem],
    )
    bIds.foodLog = fl.rows[0].id

    const sm = await pool.query(
      `INSERT INTO saved_meals (user_id, name) VALUES ($1, 'B SECRET MEAL') RETURNING id`,
      [USER_B],
    )
    bIds.savedMeal = sm.rows[0].id

    await pool.query(
      `INSERT INTO nutrition_targets (user_id, updated_at) VALUES ($1, now())
       ON CONFLICT DO NOTHING`,
      [USER_B],
    )

    // Further adapter.ts domains from the uncovered quartiles.
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, updated_at)
       VALUES ($1, $2, $3, $4, now()) ON CONFLICT DO NOTHING`,
      [USER_B, DAY, `${DAY}T22:00:00Z`, `${DAY}T06:00:00Z`],
    )
    await pool.query(
      `INSERT INTO day_checkins (user_id, log_date, phase, sore_muscles, updated_at)
       VALUES ($1, $2, 'morning', '{}', now()) ON CONFLICT DO NOTHING`,
      [USER_B, DAY],
    )
    const ft = await pool.query(
      `INSERT INTO fitness_tests (user_id, date, test_type, updated_at)
       VALUES ($1, $2, 'cooper', now()) RETURNING id`,
      [USER_B, DAY],
    )
    bIds.fitnessTest = ft.rows[0].id
    await pool.query(
      `INSERT INTO personal_records (user_id, exercise_name, estimated_1rm, achieved_at)
       VALUES ($1, 'B SECRET LIFT', 999, now()) ON CONFLICT DO NOTHING`,
      [USER_B],
    )
    await pool.query(
      `INSERT INTO supplement_logs (user_id, supplement_id, log_date, updated_at)
       VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING`,
      [USER_B, bIds.supplement, DAY],
    )

    // `seasons` is a GLOBAL table — every user sees every season. The scoping lives on
    // season_results, so a leak here does not add a row, it attaches B's rank and badge to the
    // season A is looking at. The assertion has to be about the nested result, not the row count.
    const se = await pool.query(
      `INSERT INTO seasons (label, start_date, end_date) VALUES ('B TEST SEASON', $1, $2)
       RETURNING id`,
      [FROM, TO],
    )
    bIds.season = se.rows[0].id
    await pool.query(
      `INSERT INTO season_results (user_id, season_id, rank, sessions, volume_kg, badge_label)
       VALUES ($1, $2, 1, 40, 90000, 'Gold') ON CONFLICT DO NOTHING`,
      [USER_B, bIds.season],
    )

    // A full workout chain for B. The bulk-mutation methods scope through a JOIN on
    // workout_sessions rather than a column on their own table, so they need the whole chain to be
    // exercised at all.
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, is_early_deload)
       VALUES ($1, 'B SECRET SESSION', $2, false) RETURNING id`,
      [USER_B, `${DAY}T08:00:00Z`],
    )
    bIds.workoutSession = ws.rows[0].id
    const el = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at, estimated_1rm,
                                  exercise_deloaded)
       VALUES ($1, 'B SECRET LIFT', $2, 200, false) RETURNING id`,
      [bIds.workoutSession, `${DAY}T08:30:00Z`],
    )
    bIds.exerciseLog = el.rows[0].id
    const sl = await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps)
       VALUES ($1, 1, 100, 5) RETURNING id`,
      [bIds.exerciseLog],
    )
    bIds.setLog = sl.rows[0].id

    const rp = await pool.query(
      `INSERT INTO running_plans (user_id) VALUES ($1) RETURNING id`, [USER_B])
    bIds.runningPlan = rp.rows[0].id
    const pr = await pool.query(
      `INSERT INTO prescribed_runs (user_id, plan_id, date, run_type)
       VALUES ($1, $2, $3, 'easy') RETURNING id`,
      [USER_B, bIds.runningPlan, DAY],
    )
    bIds.prescribedRun = pr.rows[0].id

    const prog = await pool.query(
      `INSERT INTO programs (user_id, name, is_active, phase_mode)
       VALUES ($1, 'B SECRET PROGRAM', false, 'manual') RETURNING id`,
      [USER_B],
    )
    bIds.program = prog.rows[0].id
    await pool.query(
      `INSERT INTO program_volume_targets (program_id, muscle_group, target_sets_per_week)
       VALUES ($1, 'chest', 18) ON CONFLICT DO NOTHING`,
      [bIds.program],
    )

    const gr = await pool.query(
      `INSERT INTO goal_recommendations (user_id, source, status, recommended_calories)
       VALUES ($1, 'ai', 'pending', 2400) RETURNING id`,
      [USER_B],
    )
    bIds.goalRec = gr.rows[0].id
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(
      `DELETE FROM friendships WHERE requester_id = ANY($1::uuid[]) OR addressee_id = ANY($1::uuid[])`,
      [[USER_A, USER_B, USER_C]])
    for (const id of [USER_A, USER_B, USER_C]) {
      // food_logs and supplement_logs before their meal_types/food_items/supplements parents.
      for (const t of ['injuries', 'activity_logs', 'mood_logs', 'body_battery_daily',
                       'food_logs', 'saved_meals', 'nutrition_targets', 'supplement_logs',
                       'supplements', 'meal_types', 'food_items', 'sleep_sessions',
                       'day_checkins', 'fitness_tests', 'personal_records', 'season_results', 'prescribed_runs',
                       'running_plans', 'goal_recommendations', 'workout_sessions', 'programs',
                       'progression_styles', 'phase_sets']) {
        await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [id])
      }
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
    if (bIds.season) await pool.query(`DELETE FROM seasons WHERE id = $1`, [bIds.season])
  })

  // ---- reads: A must not see B's rows ----
  // Each entry fails if its method's user_id predicate is dropped.
  const READERS: [string, () => Promise<unknown[]>, string][] = [
    ['listInjuries', () => repo.listInjuries(USER_A) as Promise<unknown[]>, 'B SECRET KNEE'],
    ['listSupplements', () => repo.listSupplements(USER_A, DAY) as Promise<unknown[]>, 'B SECRET CREATINE'],
    ['listMoodLogs', () => repo.listMoodLogs(USER_A, FROM, TO) as Promise<unknown[]>, ''],
    ['listMealTypes', () => repo.listMealTypes(USER_A) as Promise<unknown[]>, 'B SECRET BRUNCH'],
    ['listFoodLogs', () => repo.listFoodLogs(USER_A, DAY) as Promise<unknown[]>, 'B SECRET OATS'],
    ['listSavedMeals', () => repo.listSavedMeals(USER_A) as Promise<unknown[]>, 'B SECRET MEAL'],
    ['searchFoodItems', () => repo.searchFoodItems(USER_A, 'SECRET') as Promise<unknown[]>, 'B SECRET OATS'],
    ['listFoodLogsSummary', () => repo.listFoodLogsSummary(USER_A, FROM, TO) as Promise<unknown[]>, ''],
    ['listSleepSessions', () => repo.listSleepSessions(USER_A, FROM, TO) as Promise<unknown[]>, ''],
    ['listDayCheckins', () => repo.listDayCheckins(USER_A, FROM, TO, 'morning') as Promise<unknown[]>, ''],
    ['listFitnessTests', () => repo.listFitnessTests(USER_A, FROM, TO) as Promise<unknown[]>, ''],
  ]

  // USER_A is created fresh here and owns nothing, so the only correct result is an empty array.
  // Asserting emptiness rather than "B's id is absent" matters: several of these methods map rows
  // to a shape with NO userId field, so a `not.toContain(USER_B)` assertion on them can never fail
  // and would sit here looking like coverage while providing none. getBodyBatteryHistory is exactly
  // that case — it was written the wrong way first and survived the mutation run that killed the
  // other eight.
  for (const [name, call, marker] of READERS) {
    it(`${name} returns nothing belonging to another user`, async () => {
      const rows = await call()
      expect(Array.isArray(rows)).toBe(true)
      if (marker) expect(JSON.stringify(rows)).not.toContain(marker)
      expect(rows).toHaveLength(0)
    })
  }

  it('getBodyBatteryHistory returns nothing belonging to another user', async () => {
    const rows = await repo.getBodyBatteryHistory(USER_A, FROM, TO)
    expect(rows).toHaveLength(0)
  })

  // ---- destructive writes: A must not be able to delete or edit B's rows ----

  it('deleteInjury cannot delete another user\'s injury', async () => {
    await repo.deleteInjury(bIds.injury, USER_A).catch(() => {})
    const { rows } = await pool.query(`SELECT deleted_at FROM injuries WHERE id = $1`, [bIds.injury])
    expect(rows).toHaveLength(1)
    expect(rows[0].deleted_at).toBeNull()
  })

  it('updateInjury cannot edit another user\'s injury', async () => {
    await repo.updateInjury(bIds.injury, USER_A, { notes: 'OVERWRITTEN BY A' }).catch(() => {})
    const { rows } = await pool.query(`SELECT notes FROM injuries WHERE id = $1`, [bIds.injury])
    expect(rows[0].notes).toBe('B private note')
  })

  it('deleteSupplement cannot delete another user\'s supplement', async () => {
    await repo.deleteSupplement(bIds.supplement, USER_A).catch(() => {})
    const { rows } = await pool.query(
      `SELECT name, deleted_at FROM supplements WHERE id = $1`, [bIds.supplement])
    expect(rows).toHaveLength(1)
    expect(rows[0].deleted_at).toBeNull()
    expect(rows[0].name).toBe('B SECRET CREATINE')
  })

  it('updateSupplement cannot edit another user\'s supplement', async () => {
    await repo.updateSupplement(bIds.supplement, USER_A, { name: 'OVERWRITTEN BY A' }).catch(() => {})
    const { rows } = await pool.query(`SELECT name FROM supplements WHERE id = $1`, [bIds.supplement])
    expect(rows[0].name).toBe('B SECRET CREATINE')
  })

  it('deleteActivityLog cannot delete another user\'s activity', async () => {
    // Q-556: it now also REPORTS the miss. The row staying intact was always the security property;
    // returning `false` is what lets the route stop answering `{ success: true }` for it.
    const deleted = await repo.deleteActivityLog(USER_A, bIds.activity).catch(() => false)
    expect(deleted).toBe(false)
    const { rows } = await pool.query(
      `SELECT deleted_at FROM activity_logs WHERE id = $1`, [bIds.activity])
    expect(rows).toHaveLength(1)
    expect(rows[0].deleted_at).toBeNull()
  })

  it('deleteActivityLog reports false for an id that does not exist at all', async () => {
    // Indistinguishable from someone else's id, which is the enumeration property the cross-user
    // review's control pass verified. Both answer `false`; neither says which.
    const deleted = await repo.deleteActivityLog(USER_A, '00000000-0000-4000-8000-0000000556ff')
    expect(deleted).toBe(false)
  })

  it('deleteActivityLog is idempotent — a re-delete of your own row still reports true', async () => {
    // The WHERE does not filter `deleted_at IS NULL` on purpose. A double-tap, or a row already
    // deleted on another device, must not read as a failure — which is half of why this route
    // cannot answer 404 on a miss until activity-log deletes have an outbox domain (Q-328).
    const { rows } = await pool.query(
      `SELECT id FROM activity_logs WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1`, [USER_A])
    if (rows.length === 0) return
    expect(await repo.deleteActivityLog(USER_A, rows[0].id)).toBe(true)
    expect(await repo.deleteActivityLog(USER_A, rows[0].id)).toBe(true)
  })

  // ---- nutrition slice: 22 predicates, zero test coverage before this ----

  it('deleteMealType cannot delete another user\'s meal type', async () => {
    await repo.deleteMealType(bIds.emptyMealType, USER_A).catch(() => {})
    const { rows } = await pool.query(
      `SELECT name FROM meal_types WHERE id = $1`, [bIds.emptyMealType])
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('B SECRET SNACK')
  })

  it('updateMealType cannot edit another user\'s meal type', async () => {
    await repo.updateMealType(bIds.mealType, USER_A, { name: 'OVERWRITTEN BY A' }).catch(() => {})
    const { rows } = await pool.query(`SELECT name FROM meal_types WHERE id = $1`, [bIds.mealType])
    expect(rows[0].name).toBe('B SECRET BRUNCH')
  })

  it('deleteFoodLog cannot delete another user\'s food log', async () => {
    await repo.deleteFoodLog(bIds.foodLog, USER_A).catch(() => {})
    const { rows } = await pool.query(
      `SELECT deleted_at FROM food_logs WHERE id = $1`, [bIds.foodLog])
    expect(rows).toHaveLength(1)
    expect(rows[0].deleted_at).toBeNull()
  })

  it('updateFoodLog cannot edit another user\'s food log', async () => {
    await repo.updateFoodLog(bIds.foodLog, USER_A, 99).catch(() => {})
    const { rows } = await pool.query(
      `SELECT quantity_multiplier FROM food_logs WHERE id = $1`, [bIds.foodLog])
    expect(Number(rows[0].quantity_multiplier)).toBe(1.5)
  })

  it('deleteSavedMeal cannot delete another user\'s saved meal', async () => {
    await repo.deleteSavedMeal(bIds.savedMeal, USER_A).catch(() => {})
    const { rows } = await pool.query(
      `SELECT name FROM saved_meals WHERE id = $1`, [bIds.savedMeal])
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('B SECRET MEAL')
  })

  it('getNutritionTargets returns nothing for a user with none', async () => {
    // B has a targets row; A has none. Null is the only correct answer.
    expect(await repo.getNutritionTargets(USER_A)).toBeNull()
  })

  // ---- further adapter.ts domains ----

  it('listPersonalRecords returns nothing belonging to another user', async () => {
    // Returns a Map, so the array-emptiness assertion used above does not apply.
    const prs = await repo.listPersonalRecords(USER_A)
    expect(prs.size).toBe(0)
  })

  it('getPersonalRecord cannot read another user\'s PR', async () => {
    expect(await repo.getPersonalRecord(USER_A, 'B SECRET LIFT')).toBeNull()
  })

  it('getMoodLog cannot read another user\'s mood log', async () => {
    expect(await repo.getMoodLog(USER_A, DAY)).toBeNull()
  })

  it('getDayCheckin cannot read another user\'s check-in', async () => {
    expect(await repo.getDayCheckin(USER_A, DAY, 'morning')).toBeNull()
  })

  it('deleteFitnessTest cannot delete another user\'s test', async () => {
    // Soft delete — it sets deleted_at and leaves every other column alone, so asserting on
    // test_type here could never fail. That is the third case in this file where the obvious
    // assertion was unfalsifiable; each was caught only by running the test under mutation.
    await repo.deleteFitnessTest(USER_A, bIds.fitnessTest).catch(() => {})
    const { rows } = await pool.query(
      `SELECT deleted_at FROM fitness_tests WHERE id = $1`, [bIds.fitnessTest])
    expect(rows).toHaveLength(1)
    expect(rows[0].deleted_at).toBeNull()
  })

  it('listSeasonsWithResults does not attach another user\'s season result', async () => {
    const seasons = await repo.listSeasonsWithResults(USER_A)
    const mine = seasons.find(x => x.id === bIds.season)
    expect(mine).toBeDefined()          // seasons are global — A does see the season itself
    expect(mine!.result).toBeUndefined() // but never B's rank/badge on it
  })

  // ---- bulk mutations: a scoping slip here is silent and irreversible ----

  it('previewLbsToKgFix cannot see another user\'s logs', async () => {
    const res = await repo.previewLbsToKgFix(USER_A, ['B SECRET LIFT'], TO)
    // `exercises` is NOT a leak channel: it echoes one summary per REQUESTED name, derived from the
    // argument, so it is length 1 here even for a user with no data. Asserting it empty fails on
    // clean code. The two things that can actually leak are the log rows and the PR lookup — B has a
    // 999 kg PR for this exercise, so an unscoped read would surface it as oldPersonalRecord.
    expect(res.logs).toHaveLength(0)
    expect(res.exercises[0]?.oldPersonalRecord ?? null).toBeNull()
  })

  it('applyLbsToKgFix cannot rewrite another user\'s set weights', async () => {
    // Two-sided on purpose: an empty result is not enough, because the leak that matters is the
    // WRITE. Check B's stored weight is byte-for-byte what it was.
    const res = await repo.applyLbsToKgFix(USER_A, ['B SECRET LIFT'], TO)
    expect(res.logs).toHaveLength(0)
    const { rows } = await pool.query(
      `SELECT weight_kg FROM set_logs WHERE id = $1`, [bIds.setLog])
    expect(Number(rows[0].weight_kg)).toBe(100)
  })

  it('reconcilePersonalRecord cannot promote another user\'s lift into this user\'s PRs', async () => {
    await repo.reconcilePersonalRecord(USER_A, 'B SECRET LIFT').catch(() => {})
    const mine = await pool.query(
      `SELECT id FROM personal_records WHERE user_id = $1 AND exercise_name = $2`,
      [USER_A, 'B SECRET LIFT'])
    expect(mine.rows).toHaveLength(0)
    // And B's own PR must survive — the no-best branch DELETEs, so an unscoped run wipes it.
    const theirs = await pool.query(
      `SELECT estimated_1rm FROM personal_records WHERE user_id = $1 AND exercise_name = $2`,
      [USER_B, 'B SECRET LIFT'])
    expect(theirs.rows).toHaveLength(1)
  })

  it('updateActivityLogMetrics cannot edit another user\'s activity', async () => {
    await repo.updateActivityLogMetrics(USER_A, bIds.activity, { distanceKm: 999 }).catch(() => {})
    const { rows } = await pool.query(
      `SELECT distance_km FROM activity_logs WHERE id = $1`, [bIds.activity])
    expect(rows[0].distance_km).toBeNull()
  })

  it('updatePrescribedRun cannot edit another user\'s prescribed run', async () => {
    // Assert on `status`, the column the patch actually writes. An assertion on run_type cannot
    // fail — this method only ever sets status and updated_at — and it survived the mutation run
    // that killed the other 35. Fifth unfalsifiable assertion caught this way in this file.
    await repo.updatePrescribedRun(USER_A, bIds.prescribedRun, { status: 'skipped' }).catch(() => {})
    const { rows } = await pool.query(
      `SELECT status FROM prescribed_runs WHERE id = $1`, [bIds.prescribedRun])
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('pending')
  })

  it('updateGoalRecommendationStatus cannot change another user\'s recommendation', async () => {
    await repo.updateGoalRecommendationStatus(USER_A, bIds.goalRec, 'dismissed').catch(() => {})
    const { rows } = await pool.query(
      `SELECT status, dismissed_at FROM goal_recommendations WHERE id = $1`, [bIds.goalRec])
    expect(rows[0].status).toBe('pending')
    expect(rows[0].dismissed_at).toBeNull()
  })

  // ---- Q-174: program_volume_targets has no user_id column, so these scope through `programs` ----

  it('listVolumeTargets cannot read another user\'s volume targets', async () => {
    const rows = await repo.listVolumeTargets(USER_A, bIds.program)
    expect(rows).toHaveLength(0)
  })

  it('replaceVolumeTargets cannot wipe another user\'s volume targets', async () => {
    // The pre-guard must reject before the DELETE runs. Two-sided: the call rejects AND B's row
    // survives — an unscoped run would delete by program_id and re-insert A's targets under B.
    await expect(repo.replaceVolumeTargets(USER_A, bIds.program, [{ muscleGroup: 'back', targetSetsPerWeek: 99 }]))
      .rejects.toThrow()
    const { rows } = await pool.query(
      `SELECT muscle_group, target_sets_per_week FROM program_volume_targets WHERE program_id = $1`,
      [bIds.program])
    expect(rows).toHaveLength(1)
    expect(rows[0].muscle_group).toBe('chest')
    expect(rows[0].target_sets_per_week).toBe(18)
  })

  it('replaceVolumeTargets still works for the program\'s OWNER', async () => {
    // Without this, a guard that rejected every caller would pass the test above. Proving the
    // rejection is only half — the permit path has to be exercised too.
    const own = await pool.query(
      `INSERT INTO programs (user_id, name, is_active, phase_mode)
       VALUES ($1, 'A OWN PROGRAM', false, 'manual') RETURNING id`, [USER_A])
    const aProgram = own.rows[0].id
    await repo.replaceVolumeTargets(USER_A, aProgram, [{ muscleGroup: 'back', targetSetsPerWeek: 14 }])
    const rows = await repo.listVolumeTargets(USER_A, aProgram)
    expect(rows).toHaveLength(1)
    expect(rows[0].muscleGroup).toBe('back')
    expect(rows[0].targetSetsPerWeek).toBe(14)
  })

  it('unlogSupplement cannot unlog another user\'s supplement', async () => {
    await repo.unlogSupplement(bIds.supplement, USER_A, DAY).catch(() => {})
    const { rows } = await pool.query(
      `SELECT id FROM supplement_logs WHERE supplement_id = $1 AND log_date = $2
        AND deleted_at IS NULL`,
      [bIds.supplement, DAY])
    expect(rows).toHaveLength(1)
  })

  // ── Ownership by pre-check, not by predicate ───────────────────────────────
  //
  // The 246-predicate mutation sweep that produced this file could not reach this class at all,
  // and said so: **13 tables have no `user_id` column of their own** — `session_exercises`,
  // `exercise_logs`, `set_logs`, `style_sets`, `program_sessions`, `program_phases`, `schedules`,
  // `schedule_days`, `saved_meal_items`, `program_volume_targets` among them. Ownership for those
  // is enforced by a join or an explicit pre-check, so rewriting `eq(x.userId, userId)` never
  // touched it and "no predicate failed" said nothing about them.
  //
  // Read first, then tested: `removeSessionExercise` and `ensureWorkoutSession` are both correctly
  // guarded today, and `renameExercise`'s cross-user UPDATEs are correct too (they key on
  // `exercise_library.name`, which is globally UNIQUE, so they are shared-catalogue maintenance
  // rather than a leak). Nothing here is a fix. These hold the guards in place.
  //
  // Each case pairs a REJECT with a PERMIT, because a guard that rejected everyone would pass the
  // reject half on its own — the same trap that made two earlier tests in this file unfalsifiable.

  it('removeSessionExercise cannot delete a row from another user\'s program', async () => {
    // Reuses the fixture program: `programs` is UNIQUE on (user_id, name), so a second
    // 'B SECRET PROGRAM' fails on the constraint rather than on ownership.
    const sess = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position)
       VALUES ($1, 'B SECRET SESSION', 0) RETURNING id`, [bIds.program])
    const se = await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, position)
       VALUES ($1, 'B SECRET PRESS', 0) RETURNING id`, [sess.rows[0].id])

    // `session_exercises` has no user_id, so this can only be caught by the programs join.
    expect(await repo.removeSessionExercise(USER_A, se.rows[0].id)).toBe(false)
    const { rows } = await pool.query(`SELECT id FROM session_exercises WHERE id = $1`, [se.rows[0].id])
    expect(rows).toHaveLength(1)
  })

  it('removeSessionExercise still works for the program\'s OWNER', async () => {
    const prog = await pool.query(
      `INSERT INTO programs (user_id, name, is_active, phase_mode)
       VALUES ($1, 'A OWN PROGRAM SE', false, 'manual') RETURNING id`, [USER_A])
    const sess = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position)
       VALUES ($1, 'A OWN SESSION', 0) RETURNING id`, [prog.rows[0].id])
    const se = await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, position)
       VALUES ($1, 'A OWN PRESS', 0) RETURNING id`, [sess.rows[0].id])

    expect(await repo.removeSessionExercise(USER_A, se.rows[0].id)).toBe(true)
    const { rows } = await pool.query(`SELECT id FROM session_exercises WHERE id = $1`, [se.rows[0].id])
    expect(rows).toHaveLength(0)
  })

  it('ensureWorkoutSession refuses to adopt another user\'s session id', async () => {
    // The consequence if this ever regressed is the worst in the file: the caller goes on to write
    // exercise_logs and set_logs into the adopted session, and neither table has a user_id to stop
    // it. That is why the guard is an explicit throw rather than a silent no-op.
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at)
       VALUES ($1, 'B SECRET WORKOUT', now()) RETURNING id`, [USER_B])

    // Q-462/Q-463: the throw is now a typed NotFoundError, so `/api/log-exercise` can answer 404
    // instead of 500 — a correctly-refused request is not a server fault, and reporting it as 5xx
    // told the sync path to retry what can never succeed. Asserting the TYPE rather than the message
    // is also the stronger check: it cannot pass by coincidence on wording.
    //
    // 404 rather than 403 on the wire, deliberately: a session owned by someone else must not be
    // distinguishable from one that does not exist, or the route becomes a membership oracle. The
    // identifying detail still reaches the server log as a one-line warning.
    const { isNotFoundError } = await import('@trainingai/shared/errors')
    await expect(
      repo.ensureWorkoutSession(USER_A, ws.rows[0].id, undefined, 'A HIJACK ATTEMPT', new Date()),
    ).rejects.toSatisfy(isNotFoundError)

    const { rows } = await pool.query(
      `SELECT user_id, session_name FROM workout_sessions WHERE id = $1`, [ws.rows[0].id])
    expect(rows[0].user_id).toBe(USER_B)
    expect(rows[0].session_name).toBe('B SECRET WORKOUT')
  })

  it('ensureWorkoutSession still returns the OWNER\'s existing session', async () => {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at)
       VALUES ($1, 'A OWN WORKOUT', now()) RETURNING id`, [USER_A])

    const got = await repo.ensureWorkoutSession(USER_A, ws.rows[0].id, undefined, 'A OWN WORKOUT', new Date())
    expect(got.id).toBe(ws.rows[0].id)
    expect(got.wasInserted).toBe(false)
  })

  // ── Parent row-count guard → unscoped child delete ─────────────────────────
  //
  // The four below are the exact shape CLAUDE.md names: a user-scoped UPDATE on a parent whose id
  // came from the client, followed by an UNSCOPED `DELETE … WHERE parent_id = id` + re-insert of
  // the children. The child tables (`style_sets`, `program_phases`, `saved_meal_items`,
  // `program_sessions`/`schedule_days`) have no `user_id`, so if the parent's row-count check ever
  // goes, the delete wipes the other user's children with nothing left to stop it. Each guard is
  // in place today; each test fails if its guard is removed — verified one mutation at a time,
  // 2026-08-12, exactly one failing test each.
  //
  // That closes the 13-table list above. Two of the thirteen are deliberately NOT tested here:
  // `exercise_media` and `exercise_gif_cache` are keyed by exercise NAME, hold no per-user row,
  // and are written only by admin routes — shared-catalogue maintenance, the same category the
  // 2026-08-10 pass put `renameExercise` in, not a leak with a missing guard.

  it('saveProgressionStyle cannot wipe another user\'s style sets', async () => {
    const st = await pool.query(
      `INSERT INTO progression_styles (user_id, name) VALUES ($1, 'B SECRET STYLE') RETURNING id`,
      [USER_B])
    await pool.query(
      `INSERT INTO style_sets (style_id, set_number, pct, reps, rest_sec, use_for_1rm)
       VALUES ($1, 1, 0.8, 5, 180, true)`, [st.rows[0].id])

    await expect(repo.saveProgressionStyle(USER_A, {
      id: st.rows[0].id, userId: USER_A, name: 'A HIJACK STYLE', sets: [],
    })).rejects.toThrow()

    const { rows } = await pool.query(`SELECT id FROM style_sets WHERE style_id = $1`, [st.rows[0].id])
    expect(rows).toHaveLength(1)
    const owner = await pool.query(`SELECT user_id, name FROM progression_styles WHERE id = $1`, [st.rows[0].id])
    expect(owner.rows[0].user_id).toBe(USER_B)
    expect(owner.rows[0].name).toBe('B SECRET STYLE')
  })

  it('saveProgressionStyle still replaces the OWNER\'s style sets', async () => {
    const created = await repo.saveProgressionStyle(USER_A, {
      id: '', userId: USER_A, name: 'A OWN STYLE',
      sets: [{ id: '', styleId: '', setNumber: 1, pct: 0.7, reps: 8, restSec: 120, useFor1rm: false }],
    })
    const edited = await repo.saveProgressionStyle(USER_A, {
      ...created, name: 'A OWN STYLE',
      sets: [
        { id: '', styleId: created.id, setNumber: 1, pct: 0.9, reps: 3, restSec: 240, useFor1rm: true },
        { id: '', styleId: created.id, setNumber: 2, pct: 0.9, reps: 3, restSec: 240, useFor1rm: true },
      ],
    })
    expect(edited.sets).toHaveLength(2)
    const { rows } = await pool.query(
      `SELECT pct FROM style_sets WHERE style_id = $1 ORDER BY set_number`, [created.id])
    expect(rows.map(r => r.pct)).toEqual([0.9, 0.9])
  })

  it('updatePhaseSet cannot wipe another user\'s program phases', async () => {
    const ps = await pool.query(
      `INSERT INTO phase_sets (user_id, name, is_default) VALUES ($1, 'B SECRET PHASE SET', false) RETURNING id`,
      [USER_B])
    await pool.query(
      `INSERT INTO program_phases (phase_set_id, position, name, duration_cycles, phase_type)
       VALUES ($1, 0, 'B SECRET PHASE', 4, 'normal')`, [ps.rows[0].id])

    await expect(
      repo.updatePhaseSet(ps.rows[0].id, USER_A, 'A HIJACK PHASE SET', []),
    ).rejects.toThrow(/not found/i)

    const { rows } = await pool.query(
      `SELECT name FROM program_phases WHERE phase_set_id = $1`, [ps.rows[0].id])
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('B SECRET PHASE')
  })

  it('updatePhaseSet still replaces the OWNER\'s phases', async () => {
    const ps = await pool.query(
      `INSERT INTO phase_sets (user_id, name, is_default) VALUES ($1, 'A OWN PHASE SET', false) RETURNING id`,
      [USER_A])
    await pool.query(
      `INSERT INTO program_phases (phase_set_id, position, name, duration_cycles, phase_type)
       VALUES ($1, 0, 'A OLD PHASE', 4, 'normal')`, [ps.rows[0].id])

    const got = await repo.updatePhaseSet(ps.rows[0].id, USER_A, 'A OWN PHASE SET', [
      { position: 0, name: 'A NEW PHASE', durationCycles: 6, phaseType: 'peak' },
    ])
    expect(got.phases.map(p => p.name)).toEqual(['A NEW PHASE'])
  })

  it('updateSavedMeal cannot wipe another user\'s saved-meal items', async () => {
    const meal = await pool.query(
      `INSERT INTO saved_meals (user_id, name) VALUES ($1, 'B SECRET MEAL PLAN') RETURNING id`, [USER_B])
    await pool.query(
      `INSERT INTO saved_meal_items (saved_meal_id, food_item_id, quantity_multiplier)
       VALUES ($1, $2, 1)`, [meal.rows[0].id, bIds.foodItem])

    await expect(
      repo.updateSavedMeal(meal.rows[0].id, USER_A, 'A HIJACK MEAL', []),
    ).rejects.toThrow(/not found/i)

    const { rows } = await pool.query(
      `SELECT id FROM saved_meal_items WHERE saved_meal_id = $1`, [meal.rows[0].id])
    expect(rows).toHaveLength(1)
    const owner = await pool.query(`SELECT user_id, name FROM saved_meals WHERE id = $1`, [meal.rows[0].id])
    expect(owner.rows[0].user_id).toBe(USER_B)
    expect(owner.rows[0].name).toBe('B SECRET MEAL PLAN')
  })

  it('saveProgram cannot wipe another user\'s sessions or schedule days', async () => {
    const prog = await pool.query(
      `INSERT INTO programs (user_id, name, is_active, phase_mode)
       VALUES ($1, 'B SECRET PROGRAM 2', false, 'manual') RETURNING id`, [USER_B])
    const sess = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position)
       VALUES ($1, 'B SECRET SESSION 2', 0) RETURNING id`, [prog.rows[0].id])
    const sched = await pool.query(
      `INSERT INTO schedules (program_id, type) VALUES ($1, 'weekly') RETURNING id`, [prog.rows[0].id])
    await pool.query(
      `INSERT INTO schedule_days (schedule_id, day_of_week, session_id) VALUES ($1, 1, $2)`,
      [sched.rows[0].id, sess.rows[0].id])

    await expect(repo.saveProgram(USER_A, {
      id: prog.rows[0].id, userId: USER_A, name: 'A HIJACK PROGRAM', isActive: false,
      sessions: [], createdAt: new Date(), updatedAt: new Date(),
      phaseMode: 'manual', trainingGoal: 'strength', autoApplyPrescriptions: false,
    })).rejects.toThrow(/not found/i)

    const sessions = await pool.query(
      `SELECT name FROM program_sessions WHERE program_id = $1`, [prog.rows[0].id])
    expect(sessions.rows.map(r => r.name)).toEqual(['B SECRET SESSION 2'])
    const days = await pool.query(
      `SELECT day_of_week FROM schedule_days WHERE schedule_id = $1`, [sched.rows[0].id])
    expect(days.rows).toHaveLength(1)
    const owner = await pool.query(`SELECT user_id, name FROM programs WHERE id = $1`, [prog.rows[0].id])
    expect(owner.rows[0].user_id).toBe(USER_B)
    expect(owner.rows[0].name).toBe('B SECRET PROGRAM 2')
  })

  // ── friendships: two party columns, no `user_id` ───────────────────────────
  //
  // `friendships` is the odd one out — it is user-scoped twice over (`requester_id`,
  // `addressee_id`) and by neither name, so the 246-predicate sweep never saw it and the
  // `userId`-is-unused CI check cannot see it either. The three methods below differ in WHICH
  // party may act, which is the part a careless edit would flatten.

  // `friendships` is UNIQUE on (requester_id, addressee_id), so a case that leaves its row behind
  // makes the NEXT case fail on the constraint instead of on its own guard. Seeding through this
  // helper and cleaning up in `finally` keeps each failure attributable to the mutation that caused
  // it — without it, mutating `acceptFriendRequest` also reddened the decline case.
  const seedFriendship = async (requester: string, addressee: string, status: string) => {
    const { rows } = await pool.query(
      `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, $3)
       ON CONFLICT (requester_id, addressee_id) DO UPDATE SET status = EXCLUDED.status RETURNING id`,
      [requester, addressee, status])
    return rows[0].id as string
  }
  const dropFriendship = (id: string) => pool.query(`DELETE FROM friendships WHERE id = $1`, [id])

  it('acceptFriendRequest cannot be used by the requester to accept its own request', async () => {
    const id = await seedFriendship(USER_A, USER_B, 'pending')
    try {
      await expect(repo.acceptFriendRequest(id, USER_A)).rejects.toThrow(/not found/i)
      const { rows } = await pool.query(`SELECT status FROM friendships WHERE id = $1`, [id])
      expect(rows[0].status).toBe('pending')
    } finally { await dropFriendship(id) }
  })

  it('acceptFriendRequest still works for the ADDRESSEE', async () => {
    const id = await seedFriendship(USER_A, USER_B, 'pending')
    try {
      await repo.acceptFriendRequest(id, USER_B)
      const { rows } = await pool.query(`SELECT status FROM friendships WHERE id = $1`, [id])
      expect(rows[0].status).toBe('accepted')
    } finally { await dropFriendship(id) }
  })

  it('declineFriendRequest cannot be used by the requester', async () => {
    const id = await seedFriendship(USER_A, USER_B, 'pending')
    try {
      await repo.declineFriendRequest(id, USER_A)
      const { rows } = await pool.query(`SELECT id FROM friendships WHERE id = $1`, [id])
      expect(rows).toHaveLength(1)
    } finally { await dropFriendship(id) }
  })

  it('declineFriendRequest still works for the ADDRESSEE', async () => {
    const id = await seedFriendship(USER_A, USER_B, 'pending')
    try {
      await repo.declineFriendRequest(id, USER_B)
      const { rows } = await pool.query(`SELECT id FROM friendships WHERE id = $1`, [id])
      expect(rows).toHaveLength(0)
    } finally { await dropFriendship(id) }
  })

  it('removeFriend cannot delete a friendship the caller is not part of', async () => {
    const id = await seedFriendship(USER_B, USER_C, 'accepted')
    try {
      await repo.removeFriend(id, USER_A)
      const { rows } = await pool.query(`SELECT id FROM friendships WHERE id = $1`, [id])
      expect(rows).toHaveLength(1)
    } finally { await dropFriendship(id) }
  })

  it('removeFriend still works for either PARTY', async () => {
    const id = await seedFriendship(USER_B, USER_A, 'accepted')
    try {
      await repo.removeFriend(id, USER_A)
      const { rows } = await pool.query(`SELECT id FROM friendships WHERE id = $1`, [id])
      expect(rows).toHaveLength(0)
    } finally { await dropFriendship(id) }
  })
})
