/**
 * LB-103 — every muscle the real catalogue stores has a movement pattern.
 *
 * The unit tests beside `movementPattern` assert a hardcoded list of catalogue names, which is a
 * SNAPSHOT: add a muscle to `exercise_library` tomorrow and they keep passing while the new name
 * silently lands in `other`, indistinguishable from abs and the lower back, which belong there.
 *
 * This reads the catalogue instead. It is the same shape as LA-103's fix earlier today — a rule
 * fitted to the data it was written against is only safe while something checks the data.
 *
 * Runs only against a real local dev Postgres — skips without DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { movementPattern, CLASSIFIED_MUSCLES, normalizeMuscle } from '@trainingai/shared/muscles'

const canRun = !!process.env.DATABASE_URL

describe.skipIf(!canRun)('the exercise catalogue-s muscle vocabulary is fully classified', () => {
  let pool: import('pg').Pool
  let muscles: string[] = []

  beforeAll(async () => {
    const { Pool } = await import('pg')
    pool = new Pool({ connectionString: process.env.DATABASE_URL })
    const { rows } = await pool.query<{ muscle: string }>(
      `SELECT DISTINCT lower(trim(e->>'muscle')) AS muscle
         FROM exercise_library, jsonb_array_elements(muscles) e
        WHERE e->>'muscle' IS NOT NULL AND trim(e->>'muscle') <> ''
        ORDER BY 1`,
    )
    muscles = rows.map(r => r.muscle)
  })

  afterAll(async () => { await pool?.end() })

  it('finds a catalogue to check, so an empty read cannot pass as coverage', () => {
    expect(muscles.length).toBeGreaterThan(10)
  })

  it('classifies every distinct muscle name the catalogue stores', () => {
    const unclassified = muscles.filter(m => !CLASSIFIED_MUSCLES.includes(normalizeMuscle(m)))
    expect(unclassified, `add these to PATTERN_BY_MUSCLE in packages/shared/src/muscles.ts`).toEqual([])
  })

  it('puts most of the catalogue somewhere other than the other bucket', () => {
    // `other` is legitimate for abs, obliques and the lower back — three of eighteen. If it ever
    // holds most of the vocabulary, something stopped resolving rather than being deliberately there.
    const other = muscles.filter(m => movementPattern(m) === 'other')
    expect(other.length).toBeLessThan(muscles.length / 2)
  })
})
