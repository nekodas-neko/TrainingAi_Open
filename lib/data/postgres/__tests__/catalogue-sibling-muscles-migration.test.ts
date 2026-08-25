// Migration 219 (LA-24, Kind 1) — five MORE catalogue rows record fewer muscles than a member of
// their own movement family. Sibling of migration 216's test, same shape and same reasoning.
//
// Only the kind that needs no judgement ships here: another family member already records the muscle
// being added, so this propagates the catalogue's own answer. The three families where BF-16a's own
// additions had no precedent stay owner-gated in LA-24.
//
// The role rule reads muscle counts and BF-15's anchor rule wants >= 3, so a row seeded short can
// never be classified above accessory however the thresholds are set. That is the defect behind the
// owner's *"hip thrusts and dumbbell shoulder press should be able to be a secondary"*.
//
// `exercise_library` is global — no `user_id`, and the migration matches by name — so this file
// cannot seed a private fixture the way a user-scoped test does. It takes the migration lock, puts
// the five real rows back to their pre-fix values, runs the migration against them, and restores
// what it found. The lock is what makes that safe against a parallel suite.
//
// Runs only against a real Postgres. CI's "Tests" job DOES set DATABASE_URL, so these run there.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { migrationTestLock } from './migration-test-lock'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canRun = !!process.env.DATABASE_URL

const migrationSql = () =>
  readFileSync(
    join(process.cwd(), 'lib/data/postgres/migrations/219_catalogue_sibling_muscles.sql'),
    'utf8',
  )

// Exactly what 008 and 032 seeded, and what production still held on 2026-08-25.
const BEFORE: Record<string, [string, string][]> = {
  'Dumbbell Overhead Press': [['shoulders', 'main'], ['triceps', 'secondary']],
  'Machine Shoulder Press':  [['shoulders', 'main'], ['triceps', 'secondary']],
  'Arnold Press':            [['shoulders', 'main'], ['triceps', 'secondary']],
  'Lat Pulldown':            [['lats', 'main'], ['biceps', 'secondary']],
  'Decline Bench Press':     [['chest', 'main'], ['triceps', 'secondary']],
}

const ADDED: Record<string, string[]> = {
  'Dumbbell Overhead Press': ['traps'],
  'Machine Shoulder Press':  ['traps'],
  'Arnold Press':            ['traps'],
  'Lat Pulldown':            ['upper back'],
  'Decline Bench Press':     ['shoulders'],
}

const NAMES = Object.keys(BEFORE)

describe.skipIf(!canRun)('migration 219 — sibling catalogue rows missing muscles (LA-24)', () => {
  let pool: import('pg').Pool
  const lock = migrationTestLock(() => pool)
  const saved = new Map<string, string>()

  const jsonFor = (pairs: [string, string][]) =>
    JSON.stringify(pairs.map(([muscle, role]) => ({ muscle, role })))

  async function musclesOn(name: string): Promise<{ muscle: string; role: string }[]> {
    const { rows } = await pool.query(`SELECT muscles FROM exercise_library WHERE name = $1`, [name])
    return rows[0]?.muscles ?? []
  }

  const setMuscles = (name: string, json: string) =>
    pool.query(`UPDATE exercise_library SET muscles = $2::jsonb WHERE name = $1`, [name, json])

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    for (const name of NAMES) saved.set(name, JSON.stringify(await musclesOn(name)))
  })

  beforeEach(async () => {
    await lock.acquire()
    for (const name of NAMES) await setMuscles(name, jsonFor(BEFORE[name]))
  })

  afterEach(async () => {
    for (const [name, json] of saved) await setMuscles(name, json)
    await lock.release()
  })

  afterAll(async () => {
    if (!canRun) return
    for (const [name, json] of saved) await setMuscles(name, json)
  })

  it('adds each missing muscle as a secondary, keeping what was already there', async () => {
    await pool.query(migrationSql())
    for (const name of NAMES) {
      const got = await musclesOn(name)
      // Everything the row already recorded survives, with its original role.
      for (const [muscle, role] of BEFORE[name]) {
        expect(got, name).toContainEqual({ muscle, role })
      }
      for (const muscle of ADDED[name]) {
        expect(got, `${name} + ${muscle}`).toContainEqual({ muscle, role: 'secondary' })
      }
      expect(got.length, name).toBe(BEFORE[name].length + ADDED[name].length)
    }
  })

  // The whole point of the entry: BF-15's anchor rule requires a catalogued exercise with >= 3
  // muscles, so these rows were structurally barred from ever being an anchor.
  it('takes every one of the five to at least three muscles', async () => {
    for (const name of NAMES) expect((await musclesOn(name)).length, name).toBeLessThan(3)
    await pool.query(migrationSql())
    for (const name of NAMES) expect((await musclesOn(name)).length, name).toBeGreaterThanOrEqual(3)
  })

  it('is idempotent — a second and third run add nothing', async () => {
    await pool.query(migrationSql())
    const once = await Promise.all(NAMES.map(musclesOn))
    await pool.query(migrationSql())
    await pool.query(migrationSql())
    expect(await Promise.all(NAMES.map(musclesOn))).toEqual(once)
  })

  // The guard compares lowercased, because the catalogue carries a few Title Case values
  // (`Barbell Jefferson Curl` records "Lower Back", `Dumbbell Fly` records "Chest"). Without the
  // fold, a row already naming the muscle in another case gets a duplicate assignment, and every
  // weighted-set tally then counts that muscle twice for the exercise.
  it('does not duplicate a muscle the row already names in a different case', async () => {
    await setMuscles('Lat Pulldown', JSON.stringify([
      { muscle: 'lats', role: 'main' },
      { muscle: 'Upper Back', role: 'secondary' },
    ]))
    await pool.query(migrationSql())
    const got = await musclesOn('Lat Pulldown')
    expect(got.filter(m => m.muscle.toLowerCase() === 'upper back')).toHaveLength(1)
    expect(got).toContainEqual({ muscle: 'Upper Back', role: 'secondary' })
  })

  it('leaves a catalogue row it does not name alone', async () => {
    // The row that ESTABLISHES the traps addition above must itself be untouched.
    const before = await musclesOn('Barbell Overhead Press')
    await pool.query(migrationSql())
    expect(await musclesOn('Barbell Overhead Press')).toEqual(before)
  })
})
