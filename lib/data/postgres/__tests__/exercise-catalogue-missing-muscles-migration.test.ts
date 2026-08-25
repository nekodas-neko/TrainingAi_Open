// Migration 216 (BF-16a) — five catalogue rows record fewer muscles than the movement they mirror.
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
    join(process.cwd(), 'lib/data/postgres/migrations/216_exercise_catalogue_missing_muscles.sql'),
    'utf8',
  )

// Exactly what 008 and 032 seeded, and what production still held on 2026-08-25.
const BEFORE: Record<string, [string, string][]> = {
  'Cable Chest Dips':        [['chest', 'main'], ['triceps', 'secondary']],
  'Dumbbell Shoulder Press': [['shoulders', 'main'], ['triceps', 'secondary']],
  'Cable Pulldown':          [['lats', 'main'], ['biceps', 'secondary']],
  'Barbell Hip Thrust':      [['glutes', 'main'], ['hamstrings', 'secondary']],
  'Barbell Shrug':           [['traps', 'main']],
}

const ADDED: Record<string, string[]> = {
  'Cable Chest Dips':        ['shoulders'],
  'Dumbbell Shoulder Press': ['traps'],
  'Cable Pulldown':          ['upper back'],
  'Barbell Hip Thrust':      ['quads', 'lower back', 'adductors'],
  'Barbell Shrug':           ['upper back', 'forearms'],
}

const NAMES = Object.keys(BEFORE)

describe.skipIf(!canRun)('migration 216 — catalogue rows missing muscles (BF-16a)', () => {
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
    await setMuscles('Barbell Shrug', JSON.stringify([
      { muscle: 'traps', role: 'main' },
      { muscle: 'Forearms', role: 'secondary' },
    ]))
    await pool.query(migrationSql())
    const got = await musclesOn('Barbell Shrug')
    expect(got.filter(m => m.muscle.toLowerCase() === 'forearms')).toHaveLength(1)
    expect(got).toContainEqual({ muscle: 'Forearms', role: 'secondary' })
    expect(got).toContainEqual({ muscle: 'upper back', role: 'secondary' })
  })

  it('leaves a catalogue row it does not name alone', async () => {
    const before = await musclesOn('Barbell Overhead Press')
    await pool.query(migrationSql())
    expect(await musclesOn('Barbell Overhead Press')).toEqual(before)
  })
})
