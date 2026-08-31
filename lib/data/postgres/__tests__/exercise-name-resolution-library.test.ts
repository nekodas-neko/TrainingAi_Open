// `generate-program` used to keep only exercises whose name matched the library EXACTLY, dropping
// every paraphrase the model produced with no signal anywhere. The resolver replaced that filter,
// so its widening tiers have to hold against the real catalogue rather than against a hand-written
// fixture of five names — a change to `normalizeExerciseName` (shared with the GIF matcher) or to
// the catalogue itself could reintroduce the drop, and nothing else would notice.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildExerciseNameResolver } from '@trainingai/shared/workout/exercise-name-resolver'

const canRun = !!process.env.DATABASE_URL

describe.skipIf(!canRun)('exercise name resolution against the real library', () => {
  let pool: import('pg').Pool
  let library: { name: string; muscles: never[] }[]

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    const { rows } = await pool.query<{ name: string }>('SELECT name FROM exercise_library ORDER BY name')
    library = rows.map(r => ({ name: r.name, muscles: [] }))
  })

  afterAll(async () => {
    await pool?.end()
  })

  it('has a catalogue to resolve against', () => {
    expect(library.length).toBeGreaterThan(50)
  })

  // The exact tier is consulted first and is untouched by the widening, so this can only fail if
  // the resolver is rebuilt in a way that lets a wider tier shadow an exact name.
  it('resolves every library name to itself', () => {
    const resolver = buildExerciseNameResolver(library)
    const broken = library.filter(e => resolver.resolve(e.name)?.name !== e.name).map(e => e.name)
    expect(broken).toEqual([])
  })

  it('resolves every library name from a lowercase variant', () => {
    const resolver = buildExerciseNameResolver(library)
    const broken = library
      .filter(e => resolver.resolve(e.name.toLowerCase())?.name !== e.name)
      .map(e => e.name)
    expect(broken).toEqual([])
  })

  it('resolves every multi-word library name from a reordered variant', () => {
    const resolver = buildExerciseNameResolver(library)
    const broken = library
      .filter(e => {
        const words = e.name.split(' ')
        return words.length > 1 && resolver.resolve([...words].reverse().join(' '))?.name !== e.name
      })
      .map(e => e.name)
    expect(broken).toEqual([])
  })

  // The measurement that justified de-pluralising at all: 49 of 142 rows were unreachable from
  // their own plural before it, which is the single most likely thing a model writes.
  it('resolves every pluralisable library name from its plural', () => {
    const resolver = buildExerciseNameResolver(library)
    const broken = library
      .filter(e => !e.name.trim().toLowerCase().endsWith('s'))
      .filter(e => resolver.resolve(`${e.name}s`)?.name !== e.name)
      .map(e => e.name)
    expect(broken).toEqual([])
  })
})
