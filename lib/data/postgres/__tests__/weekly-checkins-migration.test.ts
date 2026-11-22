// #3890 step 1: migration 202611221206 adds weekly_checkins and weekly_checkin_exercises. Nothing reads
// or writes them yet (step 2 does), so this pins the migration itself: it re-runs cleanly, each unique
// key refuses a duplicate, every CHECK refuses a bad value, a lift row cannot belong to someone else's
// check-in, a user's delete cascades, and the claude_ro views show only the owner's rows.
//
// Runs only against a real Postgres. CI's "Tests" job DOES set DATABASE_URL, so these run there.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { migrationTestLock, runMigrationSql } from './migration-test-lock'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { weeklyCheckins, weeklyCheckinExercises } from '@/lib/data/postgres/schema'

const canRun = !!process.env.DATABASE_URL
const FILE = '202611221206_weekly_checkins.sql'
const USER_A = '00000000-0000-4000-8000-0000000038b1'
const USER_B = '00000000-0000-4000-8000-0000000038b2'
const MON = '2026-11-16' // a Monday
const MON2 = '2026-11-23'
const FILE2 = '202611221523_weekly_checkins_days_off_written.sql' // adds weekly_checkins.days_off_written

const migrationSql = () =>
  readFileSync(join(process.cwd(), 'lib/data/postgres/migrations', FILE), 'utf8')

const migration2Sql = () =>
  readFileSync(join(process.cwd(), 'lib/data/postgres/migrations', FILE2), 'utf8')

describe('schema.ts matches migration 202611221206 (#3890)', () => {
  // No database needed: the Drizzle tables are compared with what the SQL file declares.
  const body = (table: string) =>
    migrationSql().split(`CREATE TABLE IF NOT EXISTS ${table} (`)[1].split('\n);')[0]
  const columns = (table: string) => body(table).split('\n').map(l => l.trim())
    .filter(l => /^[a-z_]+\s+(uuid|text|date|boolean|smallint(\[\])?|timestamptz)\b/.test(l))
    .map(l => l.split(/\s+/)[0]).sort()
  const constraints = (table: string) => [...body(table).matchAll(/CONSTRAINT (\w+)/g)].map(m => m[1]).sort()
  // The later migration adds one column (and its CHECKs) to weekly_checkins only; comments left out.
  const addSql = () => migration2Sql().split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  const addedColumns = (table: string) => table === 'weekly_checkins' ? [...addSql().matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map(m => m[1]) : []
  const addedConstraints = (table: string) => table === 'weekly_checkins' ? [...addSql().matchAll(/CONSTRAINT (\w+)/g)].map(m => m[1]) : []

  it.each([
    ['weekly_checkins', weeklyCheckins],
    ['weekly_checkin_exercises', weeklyCheckinExercises],
  ] as const)('%s has the same columns, constraints and indexes in both', (name, table) => {
    const cfg = getTableConfig(table)
    expect(cfg.columns.map(c => c.name).sort()).toEqual([...columns(name), ...addedColumns(name)].sort())
    const tsNames = [
      ...cfg.checks.map(c => c.name),
      ...cfg.uniqueConstraints.map(u => u.name),
      ...cfg.foreignKeys.map(f => f.getName()).filter(n => /_checkin_fkey$/.test(n)),
    ].filter((n): n is string => !!n).sort()
    expect(tsNames).toEqual([...constraints(name), ...addedConstraints(name)].sort())
  })
  it('has the per-lift partial unique index in both', () => {
    expect(getTableConfig(weeklyCheckinExercises).indexes.map(i => i.config.name))
      .toEqual(['weekly_checkin_exercises_checkin_exercise_id_key'])
    expect(migrationSql()).toContain('weekly_checkin_exercises_checkin_exercise_id_key')
    expect(getTableConfig(weeklyCheckins).indexes).toEqual([])
  })
})

describe.skipIf(!canRun)('migration 202611221206 — weekly check-ins (#3890)', () => {
  let pool: import('pg').Pool
  let libId: string
  const lock = migrationTestLock(() => pool)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await runMigrationSql(pool, migrationSql())
    await runMigrationSql(pool, migration2Sql())
    for (const id of [USER_A, USER_B]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `weekly-${id}@example.com`])
    }
    libId = (await pool.query(
      `INSERT INTO exercise_library (name) VALUES ('Test Lift 3890') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`)).rows[0].id
  })

  beforeEach(async () => { await lock.acquire() })
  afterEach(async () => { await lock.release() })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B]])
    await pool.query(`DELETE FROM exercise_library WHERE id = $1`, [libId])
  })

  const insert = async (table: string, all: Record<string, unknown>) => {
    const keys = Object.keys(all)
    return pool.query(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(all))
  }
  // A calendar date written out, not a clock instant: the week_start + 7 the CHECK wants.
  const plus7 = (d: string) => {
    const t = new Date(Date.parse(`${d}T00:00:00Z`) + 7 * 86400000)
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
  }
  const checkin = async (userId: string, week: string, cols: Record<string, unknown> = {}): Promise<string> =>
    (await insert('weekly_checkins', { user_id: userId, week_start: week, applies_week_start: plus7(week), ...cols })).rows[0].id
  const lift = (userId: string, checkinId: string, name: string, cols: Record<string, unknown> = {}) =>
    insert('weekly_checkin_exercises', {
      user_id: userId, checkin_id: checkinId, exercise_name: name, answer: 'about_right', effect: 'none', ...cols })
  const check = (p: Promise<unknown>, constraint: string) =>
    expect(p).rejects.toMatchObject({ code: '23514', constraint })
  const cleanWeek = (userId: string, week: string) =>
    pool.query(`DELETE FROM weekly_checkins WHERE user_id = $1 AND week_start = $2`, [userId, week])

  it('re-runs cleanly', async () => {
    await runMigrationSql(pool, migrationSql())
    await runMigrationSql(pool, migrationSql())
    const cols = (await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'weekly_checkin_exercises'`)).rows.map(r => r.column_name)
    expect(cols).toContain('applied_change_id')
    expect(cols).toContain('deleted_at')
  })

  it('a bare check-in is offered, with every answer null ("not answered")', async () => {
    await cleanWeek(USER_A, '2026-11-09')
    await checkin(USER_A, '2026-11-09')
    const { rows } = await pool.query(
      `SELECT status, saved_at, dismissed_at, days_off_weekdays, shorter_session_min, pain_raised, pain_exercise_name, pain_exercise_id, pain_where, pain_offer_status, pain_injury_id,
              swap_exercise_name, swap_exercise_id, swap_offer_status, swap_change_id, deleted_at, offered_at IS NOT NULL AS offered
         FROM weekly_checkins WHERE user_id = $1 AND week_start = '2026-11-09'`, [USER_A])
    expect(rows[0]).toEqual({ status: 'offered', saved_at: null, dismissed_at: null, days_off_weekdays: null,
      shorter_session_min: null, pain_raised: null, pain_exercise_name: null, pain_exercise_id: null, pain_where: null,
      pain_offer_status: null, pain_injury_id: null, swap_exercise_name: null, swap_exercise_id: null,
      swap_offer_status: null, swap_change_id: null, deleted_at: null, offered: true })
  })

  it('refuses a second check-in for the same user and week, allows another user or week', async () => {
    await cleanWeek(USER_A, MON); await cleanWeek(USER_B, MON); await cleanWeek(USER_A, MON2)
    await checkin(USER_A, MON)
    await expect(checkin(USER_A, MON)).rejects.toMatchObject({ code: '23505', constraint: 'weekly_checkins_week_key' })
    await checkin(USER_B, MON)
    await checkin(USER_A, MON2)
  })

  it('refuses a week_start that is not a Monday, accepts Monday', async () => {
    await check(checkin(USER_A, '2026-11-17'), 'weekly_checkins_week_start_check') // Tuesday
    await check(checkin(USER_A, '2026-11-22'), 'weekly_checkins_week_start_check') // Sunday
    await cleanWeek(USER_A, '2026-11-02'); await checkin(USER_A, '2026-11-02')
  })

  it.each([
    ['an unknown status', { status: 'done' }, 'weekly_checkins_status_check'],
    ['saved without saved_at', { status: 'saved' }, 'weekly_checkins_status_times_check'],
    ['dismissed without dismissed_at', { status: 'dismissed' }, 'weekly_checkins_status_times_check'],
    ['offered with saved_at', { status: 'offered', saved_at: '2026-11-22T08:00:00Z' }, 'weekly_checkins_status_times_check'],
    ['saved with dismissed_at too', { status: 'saved', saved_at: '2026-11-22T08:00:00Z', dismissed_at: '2026-11-22T08:00:00Z' }, 'weekly_checkins_status_times_check'],
    ['a weekday of 0', { days_off_weekdays: [0, 3] }, 'weekly_checkins_days_off_check'],
    ['a weekday of 8', { days_off_weekdays: [8] }, 'weekly_checkins_days_off_check'],
    ['more than seven weekdays', { days_off_weekdays: [1, 2, 3, 4, 5, 6, 7, 7] }, 'weekly_checkins_days_off_check'],
    ['a shorter session of 0 minutes', { shorter_session_min: 0 }, 'weekly_checkins_shorter_session_check'],
    ['a shorter session over 240 minutes', { shorter_session_min: 241 }, 'weekly_checkins_shorter_session_check'],
  ])('refuses %s', async (_n, cols, constraint) => {
    await cleanWeek(USER_A, '2026-10-26')
    await check(checkin(USER_A, '2026-10-26', cols), constraint)
  })

  it('stores the answers that are not about one lift, and tells "no days off" from "not answered"', async () => {
    await cleanWeek(USER_A, '2026-10-19'); await cleanWeek(USER_B, '2026-10-19')
    await checkin(USER_A, '2026-10-19', {
      status: 'saved', saved_at: '2026-11-22T08:00:00Z', days_off_weekdays: [3, 6], shorter_session_min: 45, pain_raised: true })
    await checkin(USER_B, '2026-10-19', { status: 'dismissed', dismissed_at: '2026-11-22T08:00:00Z', days_off_weekdays: [], pain_raised: false })
    const a = (await pool.query(`SELECT days_off_weekdays, shorter_session_min, pain_raised, applies_week_start::text AS applies FROM weekly_checkins WHERE user_id = $1 AND week_start = '2026-10-19'`, [USER_A])).rows[0]
    expect(a).toEqual({ days_off_weekdays: [3, 6], shorter_session_min: 45, pain_raised: true, applies: '2026-10-26' })
    const b = (await pool.query(`SELECT days_off_weekdays FROM weekly_checkins WHERE user_id = $1 AND week_start = '2026-10-19'`, [USER_B])).rows[0]
    expect(b.days_off_weekdays).toEqual([])
  })

  describe('the week the next-week answers apply to', () => {
    beforeEach(async () => { await cleanWeek(USER_A, '2026-10-12') })
    it('refuses anything but week_start + 7', async () => {
      await check(checkin(USER_A, '2026-10-12', { applies_week_start: '2026-10-12' }), 'weekly_checkins_applies_week_check')
      await check(checkin(USER_A, '2026-10-12', { applies_week_start: '2026-10-26' }), 'weekly_checkins_applies_week_check')
      await check(checkin(USER_A, '2026-10-12', { applies_week_start: '2026-10-20' }), 'weekly_checkins_applies_week_check') // a Tuesday
    })
    it('refuses a missing value, and accepts week_start + 7 across a year end', async () => {
      await expect(insert('weekly_checkins', { user_id: USER_A, week_start: '2026-10-12' })).rejects.toMatchObject({ code: '23502' })
      await cleanWeek(USER_A, '2026-12-28')
      await checkin(USER_A, '2026-12-28') // applies 2027-01-04
      const { rows } = await pool.query(`SELECT applies_week_start::text AS a FROM weekly_checkins WHERE user_id = $1 AND week_start = '2026-12-28'`, [USER_A])
      expect(rows[0].a).toBe('2027-01-04')
    })
    it('finds the check-in for a week by plain equality, one per user', async () => {
      await checkin(USER_A, '2026-10-12')
      const { rows } = await pool.query(`SELECT week_start::text AS w FROM weekly_checkins WHERE user_id = $1 AND applies_week_start = '2026-10-19'`, [USER_A])
      expect(rows).toEqual([{ w: '2026-10-12' }])
    })
  })

  describe('pain: which lift, where, and what became of the offer', () => {
    let injury: string
    beforeEach(async () => {
      await cleanWeek(USER_A, '2026-10-12')
      injury = (await pool.query(
        `INSERT INTO injuries (user_id, muscle_name, severity, started_date) VALUES ($1, 'test muscle', 'mild', '2026-11-20') RETURNING id`, [USER_A])).rows[0].id
    })
    afterEach(async () => { await cleanWeek(USER_A, '2026-10-12'); await pool.query(`DELETE FROM injuries WHERE id = $1`, [injury]) })

    it.each([
      ['a lift when pain was not raised (false)', { pain_raised: false, pain_exercise_name: 'Squat', pain_offer_status: 'open' }, 'weekly_checkins_pain_detail_check'],
      ['a lift when pain was not answered', { pain_exercise_name: 'Squat', pain_offer_status: 'open' }, 'weekly_checkins_pain_detail_check'],
      ['a where when pain was not raised', { pain_raised: false, pain_where: 'left knee' }, 'weekly_checkins_pain_detail_check'],
      ['an offer status when pain was not raised', { pain_raised: false, pain_offer_status: 'declined' }, 'weekly_checkins_pain_detail_check'],
      ['an empty lift name', { pain_raised: true, pain_exercise_name: '', pain_offer_status: 'open' }, 'weekly_checkins_pain_lift_check'],
      ['a library id with no name', { pain_raised: true, pain_exercise_id: 'LIB' }, 'weekly_checkins_pain_lift_check'],
      ['a where with no lift', { pain_raised: true, pain_where: 'left knee' }, 'weekly_checkins_pain_lift_check'],
      ['an empty where', { pain_raised: true, pain_exercise_name: 'Squat', pain_offer_status: 'open', pain_where: '' }, 'weekly_checkins_pain_where_check'],
      ['a where over 200 characters', { pain_raised: true, pain_exercise_name: 'Squat', pain_offer_status: 'open', pain_where: 'x'.repeat(201) }, 'weekly_checkins_pain_where_check'],
      ['an unknown offer status', { pain_raised: true, pain_exercise_name: 'Squat', pain_offer_status: 'pending' }, 'weekly_checkins_pain_offer_status_check'],
      ['a lift with no offer status', { pain_raised: true, pain_exercise_name: 'Squat' }, 'weekly_checkins_pain_offer_check'],
      ['an offer status with no lift', { pain_raised: true, pain_offer_status: 'open' }, 'weekly_checkins_pain_offer_check'],
      ['an injury while the offer is open', { pain_raised: true, pain_exercise_name: 'Squat', pain_offer_status: 'open', pain_injury_id: 'INJ' }, 'weekly_checkins_pain_injury_check'],
      ['an injury after the offer was declined', { pain_raised: true, pain_exercise_name: 'Squat', pain_offer_status: 'declined', pain_injury_id: 'INJ' }, 'weekly_checkins_pain_injury_check'],
      ['an injury with no offer at all', { pain_raised: true, pain_injury_id: 'INJ' }, 'weekly_checkins_pain_injury_check'],
    ])('refuses %s', async (_n, cols, constraint) => {
      const fill = Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v === 'INJ' ? injury : v === 'LIB' ? libId : v]))
      await check(checkin(USER_A, '2026-10-12', fill), constraint)
    })

    it('accepts pain not raised, raised with no lift, and each offer status; keeps lift and where when declined', async () => {
      await checkin(USER_A, '2026-10-12', { pain_raised: false }); await cleanWeek(USER_A, '2026-10-12')
      await checkin(USER_A, '2026-10-12', { pain_raised: true }); await cleanWeek(USER_A, '2026-10-12')
      await checkin(USER_A, '2026-10-12', { pain_raised: true, pain_exercise_name: 'Squat', pain_offer_status: 'open' }); await cleanWeek(USER_A, '2026-10-12')
      await checkin(USER_A, '2026-10-12', { pain_raised: true, pain_exercise_name: 'Squat', pain_exercise_id: libId, pain_where: 'a'.repeat(200), pain_offer_status: 'declined' })
      const { rows } = await pool.query(
        `SELECT pain_exercise_name, pain_exercise_id, char_length(pain_where) AS n, pain_offer_status, pain_injury_id FROM weekly_checkins WHERE user_id = $1 AND week_start = '2026-10-12'`, [USER_A])
      expect(rows[0]).toEqual({ pain_exercise_name: 'Squat', pain_exercise_id: libId, n: 200, pain_offer_status: 'declined', pain_injury_id: null })
    })

    it('accepts an injury once the offer is accepted, and deleting the injury keeps the answer', async () => {
      await checkin(USER_A, '2026-10-12', { pain_raised: true, pain_exercise_name: 'Squat', pain_where: 'left knee', pain_offer_status: 'accepted', pain_injury_id: injury })
      await pool.query(`DELETE FROM injuries WHERE id = $1`, [injury])
      const { rows } = await pool.query(`SELECT pain_offer_status, pain_injury_id, pain_where FROM weekly_checkins WHERE user_id = $1 AND week_start = '2026-10-12'`, [USER_A])
      expect(rows[0]).toEqual({ pain_offer_status: 'accepted', pain_injury_id: null, pain_where: 'left knee' })
    })

    it('sets the pain library id to null when the library lift goes', async () => {
      const tmp = (await pool.query(`INSERT INTO exercise_library (name) VALUES ('Test Lift 3890 c') RETURNING id`)).rows[0].id
      await checkin(USER_A, '2026-10-12', { pain_raised: true, pain_exercise_name: 'Gone', pain_exercise_id: tmp, pain_offer_status: 'open' })
      await pool.query(`DELETE FROM exercise_library WHERE id = $1`, [tmp])
      const { rows } = await pool.query(`SELECT pain_exercise_name, pain_exercise_id FROM weekly_checkins WHERE user_id = $1 AND week_start = '2026-10-12'`, [USER_A])
      expect(rows[0]).toEqual({ pain_exercise_name: 'Gone', pain_exercise_id: null })
    })
  })

  describe('a swap that was offered', () => {
    let change: string
    beforeEach(async () => {
      await cleanWeek(USER_A, '2026-10-12')
      change = (await pool.query(
        `INSERT INTO coach_changes (user_id, domain, target_id, patch) VALUES ($1, 'program', gen_random_uuid(), '{}') RETURNING id`, [USER_A])).rows[0].id
    })
    afterEach(async () => { await cleanWeek(USER_A, '2026-10-12'); await pool.query(`DELETE FROM coach_changes WHERE id = $1`, [change]) })

    it.each([
      ['an empty lift name', { swap_exercise_name: '', swap_offer_status: 'open' }, 'weekly_checkins_swap_lift_check'],
      ['a library id with no name', { swap_exercise_id: 'LIB' }, 'weekly_checkins_swap_lift_check'],
      ['an unknown offer status', { swap_exercise_name: 'Squat', swap_offer_status: 'pending' }, 'weekly_checkins_swap_offer_status_check'],
      ['a lift with no offer status', { swap_exercise_name: 'Squat' }, 'weekly_checkins_swap_offer_check'],
      ['an offer status with no lift', { swap_offer_status: 'open' }, 'weekly_checkins_swap_offer_check'],
      ['a change while the offer is open', { swap_exercise_name: 'Squat', swap_offer_status: 'open', swap_change_id: 'CH' }, 'weekly_checkins_swap_change_check'],
      ['a change after the offer was declined', { swap_exercise_name: 'Squat', swap_offer_status: 'declined', swap_change_id: 'CH' }, 'weekly_checkins_swap_change_check'],
    ])('refuses %s', async (_n, cols, constraint) => {
      const fill = Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v === 'CH' ? change : v === 'LIB' ? libId : v]))
      await check(checkin(USER_A, '2026-10-12', fill), constraint)
    })

    it('accepts open and declined offers with no change, and an accepted one with a change that clears when it is deleted', async () => {
      await checkin(USER_A, '2026-10-12', { swap_exercise_name: 'Squat', swap_offer_status: 'open' }); await cleanWeek(USER_A, '2026-10-12')
      await checkin(USER_A, '2026-10-12', { swap_exercise_name: 'Squat', swap_exercise_id: libId, swap_offer_status: 'declined' }); await cleanWeek(USER_A, '2026-10-12')
      await checkin(USER_A, '2026-10-12', { swap_exercise_name: 'Squat', swap_offer_status: 'accepted', swap_change_id: change })
      await pool.query(`DELETE FROM coach_changes WHERE id = $1`, [change])
      const { rows } = await pool.query(`SELECT swap_offer_status, swap_change_id FROM weekly_checkins WHERE user_id = $1 AND week_start = '2026-10-12'`, [USER_A])
      expect(rows[0]).toEqual({ swap_offer_status: 'accepted', swap_change_id: null })
    })

    it('does not depend on pain: a swap and a no-pain answer sit together', async () => {
      await checkin(USER_A, '2026-10-12', { pain_raised: false, swap_exercise_name: 'Squat', swap_offer_status: 'open' })
    })
  })

  describe('per-lift rows', () => {
    let cid: string
    beforeEach(async () => { await cleanWeek(USER_A, '2026-09-28'); cid = await checkin(USER_A, '2026-09-28') })

    it('refuses a second row for the same check-in and lift, by name and by id', async () => {
      await lift(USER_A, cid, 'Squat')
      await expect(lift(USER_A, cid, 'Squat')).rejects.toMatchObject({ code: '23505', constraint: 'weekly_checkin_exercises_lift_key' })
      await lift(USER_A, cid, 'by-id-1', { exercise_id: libId })
      await expect(lift(USER_A, cid, 'by-id-2', { exercise_id: libId })).rejects.toMatchObject({ code: '23505', constraint: 'weekly_checkin_exercises_checkin_exercise_id_key' })
      await lift(USER_A, cid, 'no-id-1'); await lift(USER_A, cid, 'no-id-2') // rows without an id do not collide
      // The same lift in another check-in is another row.
      await cleanWeek(USER_A, '2026-09-21')
      await lift(USER_A, await checkin(USER_A, '2026-09-21'), 'Squat', { exercise_id: libId })
    })

    it.each([
      ['an empty name', { exercise_name: '' }, 'weekly_checkin_exercises_exercise_name_check'],
      ['an unknown answer', { answer: 'easy' }, 'weekly_checkin_exercises_answer_check'],
      ['an unknown effect', { effect: 'raised' }, 'weekly_checkin_exercises_effect_check'],
      ['an unknown offer status', { effect: 'offered_step_up', offer_status: 'pending' }, 'weekly_checkin_exercises_offer_status_check'],
      ['an offer status on a lift with no offer', { effect: 'held', offer_status: 'open' }, 'weekly_checkin_exercises_offer_check'],
      ['an offered step up with no offer status', { effect: 'offered_step_up' }, 'weekly_checkin_exercises_offer_check'],
    ])('refuses %s', async (_n, cols, constraint) => {
      await check(lift(USER_A, cid, 'bad', cols), constraint)
    })

    it('stores each answer and what the app did with it', async () => {
      await lift(USER_A, cid, 'held', { answer: 'heavy', missed_rep: false, effect: 'held' })
      await lift(USER_A, cid, 'lowered', { answer: 'heavy', missed_rep: true, effect: 'lowered_one_step' })
      await lift(USER_A, cid, 'light-open', { answer: 'light', effect: 'offered_step_up', offer_status: 'open' })
      await lift(USER_A, cid, 'light-yes', { answer: 'light', effect: 'offered_step_up', offer_status: 'accepted' })
      await lift(USER_A, cid, 'light-no', { answer: 'light', effect: 'offered_step_up', offer_status: 'declined' })
      await lift(USER_A, cid, 'about-right') // about_right, nothing done, no read of a miss
      const { rows } = await pool.query(
        `SELECT exercise_name, answer, missed_rep, effect, offer_status FROM weekly_checkin_exercises WHERE checkin_id = $1 ORDER BY exercise_name`, [cid])
      expect(rows).toEqual([
        { exercise_name: 'about-right', answer: 'about_right', missed_rep: null, effect: 'none', offer_status: null },
        { exercise_name: 'held', answer: 'heavy', missed_rep: false, effect: 'held', offer_status: null },
        { exercise_name: 'light-no', answer: 'light', missed_rep: null, effect: 'offered_step_up', offer_status: 'declined' },
        { exercise_name: 'light-open', answer: 'light', missed_rep: null, effect: 'offered_step_up', offer_status: 'open' },
        { exercise_name: 'light-yes', answer: 'light', missed_rep: null, effect: 'offered_step_up', offer_status: 'accepted' },
        { exercise_name: 'lowered', answer: 'heavy', missed_rep: true, effect: 'lowered_one_step', offer_status: null },
      ])
    })

    it("cannot belong to another user's check-in", async () => {
      await expect(lift(USER_B, cid, 'stolen')).rejects.toMatchObject({ code: '23503', constraint: 'weekly_checkin_exercises_checkin_fkey' })
    })

    describe('what an accepted step up or a lowering wrote', () => {
      let change: string
      beforeEach(async () => {
        change = (await pool.query(
          `INSERT INTO coach_changes (user_id, domain, target_id, patch) VALUES ($1, 'lift_preference', gen_random_uuid(), '{}') RETURNING id`, [USER_A])).rows[0].id
      })
      afterEach(async () => { await pool.query(`DELETE FROM coach_changes WHERE id = $1`, [change]) })

      it.each([
        ['an effect of none', { effect: 'none' }],
        ['a hold', { effect: 'held' }],
        ['a step up offer that is open', { effect: 'offered_step_up', offer_status: 'open' }],
        ['a step up offer that was declined', { effect: 'offered_step_up', offer_status: 'declined' }],
      ])('refuses a change id on %s', async (_n, cols) => {
        await check(lift(USER_A, cid, 'bad', { ...cols, applied_change_id: change }), 'weekly_checkin_exercises_applied_check')
      })

      it('accepts a change id on a lowering and on an accepted step up, and none elsewhere', async () => {
        await lift(USER_A, cid, 'lowered', { answer: 'heavy', missed_rep: true, effect: 'lowered_one_step', applied_change_id: change })
        await lift(USER_A, cid, 'stepped', { answer: 'light', effect: 'offered_step_up', offer_status: 'accepted', applied_change_id: change })
        await lift(USER_A, cid, 'lowered-not-yet', { answer: 'heavy', missed_rep: true, effect: 'lowered_one_step' })
        await lift(USER_A, cid, 'accepted-not-yet', { answer: 'light', effect: 'offered_step_up', offer_status: 'accepted' })
      })

      it('clears the reference when the change is deleted, keeping the row', async () => {
        await lift(USER_A, cid, 'lowered', { answer: 'heavy', effect: 'lowered_one_step', applied_change_id: change })
        await pool.query(`DELETE FROM coach_changes WHERE id = $1`, [change])
        const { rows } = await pool.query(`SELECT effect, applied_change_id FROM weekly_checkin_exercises WHERE checkin_id = $1`, [cid])
        expect(rows[0]).toEqual({ effect: 'lowered_one_step', applied_change_id: null })
      })
    })

    it('carries a tombstone, which still holds the lift key so a redo revives the row', async () => {
      await lift(USER_A, cid, 'dropped', { deleted_at: '2026-11-22T08:00:00Z' })
      await expect(lift(USER_A, cid, 'dropped')).rejects.toMatchObject({ code: '23505', constraint: 'weekly_checkin_exercises_lift_key' })
      await pool.query(`UPDATE weekly_checkin_exercises SET deleted_at = NULL WHERE checkin_id = $1`, [cid])
      expect((await pool.query(`SELECT deleted_at FROM weekly_checkin_exercises WHERE checkin_id = $1`, [cid])).rows[0].deleted_at).toBeNull()
    })

    it('keeps the row when the library lift goes (id set null)', async () => {
      const tmp = (await pool.query(`INSERT INTO exercise_library (name) VALUES ('Test Lift 3890 b') RETURNING id`)).rows[0].id
      await lift(USER_A, cid, 'orphan', { exercise_id: tmp })
      await pool.query(`DELETE FROM exercise_library WHERE id = $1`, [tmp])
      const { rows } = await pool.query(`SELECT exercise_id FROM weekly_checkin_exercises WHERE checkin_id = $1`, [cid])
      expect(rows[0].exercise_id).toBeNull()
    })

    it('goes with its check-in', async () => {
      await lift(USER_A, cid, 'gone')
      await pool.query(`DELETE FROM weekly_checkins WHERE id = $1`, [cid])
      expect((await pool.query(`SELECT 1 FROM weekly_checkin_exercises WHERE checkin_id = $1`, [cid])).rowCount).toBe(0)
    })
  })

  it('a tombstoned check-in still holds the week, so redoing it revives the row', async () => {
    await cleanWeek(USER_A, '2026-09-14')
    await checkin(USER_A, '2026-09-14', { deleted_at: '2026-11-22T08:00:00Z' })
    await expect(checkin(USER_A, '2026-09-14')).rejects.toMatchObject({ code: '23505' })
  })

  it('cascades on the user, for both tables, and leaves the other user alone', async () => {
    const tmp = '00000000-0000-4000-8000-0000000038b3'
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')`, [tmp, `weekly-${tmp}@example.com`])
    await lift(tmp, await checkin(tmp, MON), 'gone')
    await pool.query(`DELETE FROM users WHERE id = $1`, [tmp])
    for (const t of ['weekly_checkins', 'weekly_checkin_exercises']) {
      expect((await pool.query(`SELECT 1 FROM ${t} WHERE user_id = $1`, [tmp])).rowCount).toBe(0)
    }
  })

  it("the committed claude_ro views are scoped to the owner's rows only", async () => {
    const file = readFileSync(join(process.cwd(), 'lib/data/postgres/claude-ro-views.sql'), 'utf8')
    const stmt = (view: string) => {
      const m = file.match(new RegExp(`CREATE VIEW claude_ro\\.${view} AS[\\s\\S]*?;\\n`))
      expect(m, `${view} is in claude-ro-views.sql`).not.toBeNull()
      expect(m![0]).toContain(`WHERE t.user_id = current_setting('app.claude_ro_owner', true)::uuid`)
      return m![0].replace('CREATE VIEW', 'CREATE OR REPLACE VIEW')
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('CREATE SCHEMA IF NOT EXISTS claude_ro')
      await client.query(stmt('weekly_checkins'))
      await client.query(stmt('weekly_checkin_exercises'))
      for (const u of [USER_A, USER_B]) {
        const c = (await client.query(
          `INSERT INTO weekly_checkins (user_id, week_start, applies_week_start) VALUES ($1, '2026-08-03', '2026-08-10') ON CONFLICT (user_id, week_start) DO UPDATE SET updated_at = now() RETURNING id`, [u])).rows[0].id
        await client.query(
          `INSERT INTO weekly_checkin_exercises (user_id, checkin_id, exercise_name, answer, effect) VALUES ($1, $2, 'scope', 'heavy', 'held') ON CONFLICT DO NOTHING`, [u, c])
      }
      await client.query(`SELECT set_config('app.claude_ro_owner', $1, true)`, [USER_B])
      for (const v of ['weekly_checkins', 'weekly_checkin_exercises']) {
        const rows = await client.query(`SELECT user_id FROM claude_ro.${v}`)
        expect(rows.rows.length).toBeGreaterThan(0)
        expect(new Set(rows.rows.map(r => r.user_id))).toEqual(new Set([USER_B]))
      }
      await client.query(`SELECT set_config('app.claude_ro_owner', '00000000-0000-4000-8000-0000000000ff', true)`)
      expect((await client.query(`SELECT 1 FROM claude_ro.weekly_checkins`)).rowCount).toBe(0)
      expect((await client.query(`SELECT 1 FROM claude_ro.weekly_checkin_exercises`)).rowCount).toBe(0)
    } finally {
      await client.query('ROLLBACK'); client.release()
    }
  })

  describe('days_off_written (202611221523)', () => {
    const WEEK = '2026-10-05' // applies 2026-10-12 .. 2026-10-18
    beforeEach(async () => { await cleanWeek(USER_A, WEEK) })
    const written = async () => (await pool.query(
      `SELECT days_off_written::text[] AS d FROM weekly_checkins WHERE user_id = $1 AND week_start = $2`, [USER_A, WEEK])).rows[0].d

    it('re-runs cleanly and adds one nullable date[] column with no default', async () => {
      await runMigrationSql(pool, migration2Sql())
      await runMigrationSql(pool, migration2Sql())
      const c = (await pool.query(
        `SELECT data_type, udt_name, is_nullable, column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'weekly_checkins' AND column_name = 'days_off_written'`)).rows
      expect(c).toEqual([{ data_type: 'ARRAY', udt_name: '_date', is_nullable: 'YES', column_default: null }])
    })
    it('is NULL on a bare check-in, and accepts NULL, an empty array and dates inside the applies-to week', async () => {
      await checkin(USER_A, WEEK)
      expect(await written()).toBeNull()
      await pool.query(`UPDATE weekly_checkins SET days_off_written = '{}' WHERE user_id = $1 AND week_start = $2`, [USER_A, WEEK])
      expect(await written()).toEqual([])
      await pool.query(`UPDATE weekly_checkins SET days_off_written = ARRAY['2026-10-12', '2026-10-18']::date[] WHERE user_id = $1 AND week_start = $2`, [USER_A, WEEK])
      expect(await written()).toEqual(['2026-10-12', '2026-10-18'])
      await pool.query(`UPDATE weekly_checkins SET days_off_written = NULL WHERE user_id = $1 AND week_start = $2`, [USER_A, WEEK])
      expect(await written()).toBeNull()
    })
    it('refuses more than seven dates', async () => {
      const eight = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-18']
      await check(checkin(USER_A, WEEK, { days_off_written: eight }), 'weekly_checkins_days_off_written_count_check')
    })
    it.each([
      ['the day before the applies-to week', ['2026-10-11']],
      ['the day after the applies-to week', ['2026-10-19']],
      ['the week being reviewed itself', ['2026-10-05']],
      ['one good date and one outside', ['2026-10-13', '2026-10-25']],
      ['a NULL element', [null, '2026-10-13']],
    ])('refuses %s', async (_n, dates) => {
      await check(checkin(USER_A, WEEK, { days_off_written: dates }), 'weekly_checkins_days_off_written_week_check')
    })
    it('accepts all seven days of the applies-to week', async () => {
      await checkin(USER_A, WEEK, { days_off_written: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'] })
      expect((await written())).toHaveLength(7)
    })
    it('follows applies_week_start across a year end', async () => {
      await cleanWeek(USER_A, '2026-12-28')
      await checkin(USER_A, '2026-12-28', { days_off_written: ['2027-01-04', '2027-01-10'] })
      await check(checkin(USER_B, '2026-12-28', { days_off_written: ['2027-01-11'] }), 'weekly_checkins_days_off_written_week_check')
      await cleanWeek(USER_A, '2026-12-28')
    })
  })
})
