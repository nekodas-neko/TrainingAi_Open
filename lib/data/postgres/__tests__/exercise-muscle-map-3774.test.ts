// #3774 — `getNextSession` now reads the catalogue through `listExerciseMuscleMap` (name and
// muscles) instead of `listExerciseLibrary` (every column). `computeMuscleRecovery` keys what it is
// given by lower-cased name and keeps the last entry, so the lighter read must return the same
// names, the same muscles, in the same order, or two names differing only in case could resolve
// differently.
//
// Runs only against a real local dev Postgres.
import { describe, it, expect, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const NAMES = ['zz 3774 Case Pair', 'ZZ 3774 case pair']

describe.skipIf(!canRun)('listExerciseMuscleMap is listExerciseLibrary\'s names and muscles, in its order', () => {
  afterAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    await getPool().query(`DELETE FROM exercise_library WHERE name = ANY($1)`, [NAMES])
  })

  it('agrees entry for entry', async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    await getPool().query(
      `INSERT INTO exercise_library (name, muscles) VALUES ($1, $3::jsonb), ($2, $4::jsonb) ON CONFLICT (name) DO NOTHING`,
      [NAMES[0], NAMES[1], JSON.stringify([{ muscle: 'chest', role: 'primary' }]), JSON.stringify([{ muscle: 'back', role: 'primary' }])],
    )
    const repo = await getRepository()
    const [full, light] = await Promise.all([repo.listExerciseLibrary(), repo.listExerciseMuscleMap()])
    expect(light.length).toBeGreaterThanOrEqual(2)
    expect(light).toEqual(full.map(e => ({ name: e.name, muscles: e.muscles })))
  })
})
