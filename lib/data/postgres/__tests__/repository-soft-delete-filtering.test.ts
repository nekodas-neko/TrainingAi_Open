// Soft-delete filtering: a deleted row must never come back (Q-178).
//
// Measured 2026-08-09 by mutation, the same method used for ownership scoping in
// `repository-ownership-scoping.test.ts`: every `isNull(x.deletedAt)` in the adapter and its slices
// was rewritten to an always-true predicate of the same shape, so soft-deleted rows reappear.
//
// **86 predicates neutralised. 371 of 372 tests still passed.** Per file, `adapter.ts` (59),
// `nutrition.ts` (5), `oura.ts` (11) and `periodization.ts` (7) each failed **zero** tests — 82 of 86
// predicates (95%) provably unguarded. Only `programs.ts` was noticed, by one test, as a side clause.
//
// The filtering is CORRECT today. The gap is that nothing holds it in place, and the failure it
// guards against is directly user-visible: deleted rows reappearing is the mirror of the "my data
// disappeared" class CLAUDE.md already tracks, and reads the same way to whoever hits it.
//
// Every test here deletes through the REAL repository method rather than stamping `deleted_at` by
// hand, so it exercises the delete path and the read filter together. Each was verified to fail when
// the predicates are neutralised — check any addition the same way before counting it as coverage.
//
// Runs only against a real local dev Postgres — skips cleanly elsewhere (CI's "Tests" job has no
// DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const USER = '00000000-0000-4000-8000-00000000d0de'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

const DAY = '2026-04-11'
const FROM = '2026-04-01'
const TO = '2026-04-30'

describe.skipIf(!canRun)('soft-delete filtering (Q-178)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, 'soft-delete-filtering@example.com', 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [USER],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['injuries', 'supplement_logs', 'supplements', 'activity_logs', 'food_logs',
                     'meal_types', 'food_items', 'saved_meals', 'fitness_tests',
                     'mood_logs', 'workout_sessions']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('a deleted injury does not come back in listInjuries', async () => {
    const { rows } = await pool.query(
      `INSERT INTO injuries (user_id, muscle_name, notes, severity, started_date)
       VALUES ($1, 'DELETED HAMSTRING', 'gone', 'mild', $2) RETURNING id`, [USER, DAY])
    expect(await repo.listInjuries(USER)).toHaveLength(1)   // present before the delete
    await repo.deleteInjury(rows[0].id, USER)
    expect(await repo.listInjuries(USER)).toHaveLength(0)
  })

  it('a deleted supplement does not come back in listSupplements', async () => {
    const { rows } = await pool.query(
      `INSERT INTO supplements (user_id, name, dose, sort_order, active, updated_at)
       VALUES ($1, 'DELETED ZINC', '10mg', 0, true, now()) RETURNING id`, [USER])
    expect(await repo.listSupplements(USER, DAY)).toHaveLength(1)
    await repo.deleteSupplement(rows[0].id, USER)
    expect(await repo.listSupplements(USER, DAY)).toHaveLength(0)
  })

  it('a deleted activity log does not come back in listActivityLogs', async () => {
    const { rows } = await pool.query(
      `INSERT INTO activity_logs (user_id, activity_type, title, date, duration_min)
       VALUES ($1, 'walk', 'DELETED WALK', $2, 30) RETURNING id`, [USER, DAY])
    expect(await repo.listActivityLogs(USER, FROM, TO)).toHaveLength(1)
    await repo.deleteActivityLog(USER, rows[0].id)
    expect(await repo.listActivityLogs(USER, FROM, TO)).toHaveLength(0)
  })

  it('a deleted fitness test does not come back in listFitnessTests', async () => {
    const { rows } = await pool.query(
      `INSERT INTO fitness_tests (user_id, date, test_type, updated_at)
       VALUES ($1, $2, 'cooper', now()) RETURNING id`, [USER, DAY])
    expect(await repo.listFitnessTests(USER, FROM, TO)).toHaveLength(1)
    await repo.deleteFitnessTest(USER, rows[0].id)
    expect(await repo.listFitnessTests(USER, FROM, TO)).toHaveLength(0)
  })

  it('a deleted food log does not come back in listFoodLogs', async () => {
    const mt = await pool.query(
      `INSERT INTO meal_types (user_id, name, emoji, sort_order, required, reminders_enabled,
                               time_start_hour, time_end_hour)
       VALUES ($1, 'DEL LUNCH', '\u{1F957}', 0, false, false, 12, 14) RETURNING id`, [USER])
    const fi = await pool.query(
      `INSERT INTO food_items (user_id, name, calories, protein_g, carbs_g, fat_g,
                               serving_size_g, region, source)
       VALUES ($1, 'DELETED RICE', 130, 3, 28, 0, 100, 'AU', 'manual') RETURNING id`, [USER])
    const fl = await pool.query(
      `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier,
                              logged_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, now(), now()) RETURNING id`,
      [USER, DAY, mt.rows[0].id, fi.rows[0].id])
    expect(await repo.listFoodLogs(USER, DAY)).toHaveLength(1)
    await repo.deleteFoodLog(fl.rows[0].id, USER)
    expect(await repo.listFoodLogs(USER, DAY)).toHaveLength(0)
  })

  // NOT a saved-meal test. `deleteSavedMeal` is a HARD delete and `saved_meals` has no `deleted_at`
  // column at all, so a test of it can never fail under the soft-delete mutation — it was written
  // here first, survived the run that killed the other five, and was moved out rather than left
  // sitting in a file whose whole contract is "every test here fails when the filters are removed".
  //
  // The three below have no repository delete method (their soft delete arrives through sync's
  // pushMutations), so they stamp `deleted_at` directly and test the READ filter — which is exactly
  // what the mutation neutralises.

  it('a deleted workout session does not come back in getWorkoutSessionsFrom', async () => {
    const { rows } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, is_early_deload)
       VALUES ($1, 'DELETED SESSION', $2, false) RETURNING id`, [USER, `${DAY}T09:00:00Z`])
    const from = new Date(`${FROM}T00:00:00Z`)
    expect(await repo.getWorkoutSessionsFrom(USER, from)).toHaveLength(1)
    await pool.query(`UPDATE workout_sessions SET deleted_at = now() WHERE id = $1`, [rows[0].id])
    expect(await repo.getWorkoutSessionsFrom(USER, from)).toHaveLength(0)
  })

  // countWorkoutSessions requires completed_at IS NOT NULL, so an in-progress session counts zero
  // regardless of deletion — the seed has to complete the session or the test asserts nothing. It
  // also filters via raw SQL (`deleted_at IS NULL`) rather than Drizzle's isNull(), which the first
  // version of the mutator did not match: 27 raw-SQL filters were invisible to it, so the surface is
  // 113 predicates, not the 86 first counted.
  it('a deleted workout session is not counted by countWorkoutSessions', async () => {
    const { rows } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at, is_early_deload)
       VALUES ($1, 'DELETED COUNT SESSION', $2, $3, false) RETURNING id`,
      [USER, `${DAY}T10:00:00Z`, `${DAY}T11:00:00Z`])
    expect(await repo.countWorkoutSessions(USER)).toBe(1)
    await pool.query(`UPDATE workout_sessions SET deleted_at = now() WHERE id = $1`, [rows[0].id])
    expect(await repo.countWorkoutSessions(USER)).toBe(0)
  })

  // ---- Q-179: a soft-deleted child permanently pins its parent ----
  // The static sweep flagged deleteMealType's in-use probe for reading food_logs with no
  // deleted_at filter, and the behaviour reproduces: delete your only log for a meal type and the
  // meal type becomes undeletable, citing a log you can no longer see.
  //
  // Adding the filter was NOT the fix, and a test written both ways is the only reason that is
  // known. `food_logs.meal_type_id -> meal_types` is ON DELETE RESTRICT, so with the soft-deleted
  // log excluded from the probe the hard DELETE simply failed on the FK instead — trading a clean
  // domain error for a 500. The one-directional version passed.
  //
  // FIXED 2026-08-10 (owner decision): meal types soft-delete, like every other user-owned row
  // here, so the RESTRICT is never tested and the soft-deleted logs keep pointing at a row that
  // still exists — tombstones intact, no unsynced device can resurrect them.
  //
  // `activity_logs.activity_type -> activity_types` is NO ACTION, the same shape, and is NOT fixed
  // here: it is admin-only behind `requireAdmin`, so it is a different severity and a different
  // decision. Left as filed.

  it('a meal type whose only food log was DELETED becomes deletable again', async () => {
    // The Q-179 reproduction, now asserted the other way round. Both directions are needed: a fix
    // that simply dropped the in-use check would pass this and fail the next test.
    const mt = await pool.query(
      `INSERT INTO meal_types (user_id, name, emoji, sort_order, required, reminders_enabled,
                               time_start_hour, time_end_hour)
       VALUES ($1, 'ORPHANED BRUNCH', '\u{1F373}', 7, false, false, 10, 12) RETURNING id`, [USER])
    const fi = await pool.query(
      `INSERT INTO food_items (user_id, name, calories, protein_g, carbs_g, fat_g,
                               serving_size_g, region, source)
       VALUES ($1, 'ORPHANED TOAST', 150, 5, 25, 3, 100, 'AU', 'manual') RETURNING id`, [USER])
    const log = await pool.query(
      `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier,
                              logged_at, updated_at)
       VALUES ($1, '2026-05-03', $2, $3, 1, now(), now()) RETURNING id`,
      [USER, mt.rows[0].id, fi.rows[0].id])

    // Delete through the real repository method, so the delete path and the read filter are
    // exercised together.
    await repo.deleteFoodLog(log.rows[0].id, USER)
    // RV-45 made this return whether a row matched. `true` is the stronger assertion for this
    // test's own point — the meal type really did become deletable again, rather than merely not
    // throwing.
    await expect(repo.deleteMealType(mt.rows[0].id, USER)).resolves.toBe(true)

    // Gone from the user's list…
    const live = await repo.listMealTypes(USER)
    expect(live.map(m => m.id)).not.toContain(mt.rows[0].id)

    // …but still present as a row, which is the whole point: the soft-deleted log's FK still
    // resolves, so its sync tombstone survives. A hard delete could not have left this.
    const still = await pool.query(`SELECT deleted_at FROM meal_types WHERE id = $1`, [mt.rows[0].id])
    expect(still.rows).toHaveLength(1)
    expect(still.rows[0].deleted_at).not.toBeNull()
  })

  it('a deleted meal type cannot be logged against, renamed, or reordered back', async () => {
    const mt = await pool.query(
      `INSERT INTO meal_types (user_id, name, emoji, sort_order, required, reminders_enabled,
                               time_start_hour, time_end_hour)
       VALUES ($1, 'GONE SUPPER', '\u{1F374}', 8, false, false, 20, 22) RETURNING id`, [USER])
    const fi = await pool.query(
      `INSERT INTO food_items (user_id, name, calories, protein_g, carbs_g, fat_g,
                               serving_size_g, region, source)
       VALUES ($1, 'GONE SOUP', 90, 3, 10, 4, 100, 'AU', 'manual') RETURNING id`, [USER])
    await repo.deleteMealType(mt.rows[0].id, USER)

    // A soft-deleted parent must stop accepting new children, or the "no live logs" guarantee the
    // delete was granted under stops being true a moment later.
    expect(await repo.foodLogRefsValid(USER, mt.rows[0].id, fi.rows[0].id)).toBe(false)
    await expect(repo.updateMealType(mt.rows[0].id, USER, { name: 'BACK AGAIN' }))
      .rejects.toThrow('Meal type not found')
  })

  it('a meal type that still has a LIVE food log is not deletable', async () => {
    // The other half: the probe must still block. A fix that simply dropped the check would pass
    // the test above.
    const mt = await pool.query(
      `INSERT INTO meal_types (user_id, name, emoji, sort_order, required, reminders_enabled,
                               time_start_hour, time_end_hour)
       VALUES ($1, 'LIVE DINNER', '\u{1F372}', 6, false, false, 18, 20) RETURNING id`, [USER])
    const fi = await pool.query(
      `INSERT INTO food_items (user_id, name, calories, protein_g, carbs_g, fat_g,
                               serving_size_g, region, source)
       VALUES ($1, 'LIVE PASTA', 200, 7, 40, 2, 100, 'AU', 'manual') RETURNING id`, [USER])
    await pool.query(
      `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier,
                              logged_at, updated_at)
       VALUES ($1, '2026-05-02', $2, $3, 1, now(), now())`,
      [USER, mt.rows[0].id, fi.rows[0].id])

    await expect(repo.deleteMealType(mt.rows[0].id, USER)).rejects.toThrow('MEAL_TYPE_HAS_LOGS')
  })

  // ---- Q-178: the server disagreed with the device about deleted mood logs ----
  // `mood_logs` carries `deleted_at` on the server AND in the local table, and
  // `lib/local-store/sqlite-backend.ts` filters it — but the two user-facing server reads did not.
  // The device would hide a deleted mood log; the server would hand it straight back.
  //
  // Latent, not live: nothing server-side writes that column yet. Fixed anyway (owner decision)
  // because whoever adds mood-log deletion would otherwise land on a server that returns deleted
  // rows, and "the mood I deleted came back after a sync" reads as a sync bug rather than a missing
  // predicate.
  //
  // These stamp `deleted_at` by hand rather than deleting through a repository method — unlike
  // every other test in this file — because there is no `deleteMoodLog` to call. That is the
  // finding, not a shortcut: the column exists with no writer.

  it('a deleted mood log is hidden from both user-facing reads', async () => {
    await pool.query(
      `INSERT INTO mood_logs (user_id, log_date, energy_level, sleep_quality, updated_at)
       VALUES ($1, $2, 3, 3, now())
       ON CONFLICT (user_id, log_date) DO UPDATE SET deleted_at = NULL, updated_at = now()`,
      [USER, DAY])

    expect(await repo.getMoodLog(USER, DAY)).not.toBeNull()
    expect((await repo.listMoodLogs(USER, FROM, TO)).map(m => m.logDate)).toContain(DAY)

    await pool.query(`UPDATE mood_logs SET deleted_at = now() WHERE user_id = $1 AND log_date = $2`,
      [USER, DAY])

    expect(await repo.getMoodLog(USER, DAY)).toBeNull()
    expect((await repo.listMoodLogs(USER, FROM, TO)).map(m => m.logDate)).not.toContain(DAY)
  })

  it('but the sync delta still emits it, because that is the tombstone', async () => {
    // The third read of `mood_logs` is inside `getSyncDelta`, and it must stay unfiltered. A delta
    // that hid deleted rows could never tell a device a row went away, so the delete would not
    // propagate — the failure CLAUDE.md's sync rules exist to prevent. Filing this as "add the
    // filter to the three reads" would have introduced that bug; the sync read is a different kind
    // of read from the two above, and this test is what holds them apart.
    const delta = await repo.getSyncDelta(USER, new Date(0))
    const moods = (delta as unknown as { moodLogs?: { logDate: string }[] }).moodLogs ?? []
    expect(moods.map(m => m.logDate)).toContain(DAY)
  })
})
