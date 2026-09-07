// Migration 270 (BF-130) — the catalogue had no home-gym option for two muscle groups.
//
// HAMSTRINGS: every hamstring-main row except three is a hip hinge, and the three knee-flexion
// options were machine (Leg Curl, Glute-Ham Raise) or needed an ankle anchor (Nordic). The owner has
// neither, so his programs train hamstrings through hip extension only — the one pattern his lumbar
// constraint asks him to limit.
//
// ADDUCTORS: found by the wider pass rather than the report. Exactly ONE adductor-main row existed
// and it was machine-only, so a home gym had zero — a worse gap than the reported one.
//
// Runs only against a real Postgres. CI's "Tests" job sets DATABASE_URL.
import { describe, it, expect, beforeAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const HOME_GYM = ['barbell', 'dumbbell', 'cable', 'bodyweight']

describe.skipIf(!canRun)('migration 270 — home-gym coverage (BF-130)', () => {
  let pool: import('pg').Pool

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
  })

  /** Rows whose MAIN muscle is `muscle`, with the equipment each declares. */
  const mainMoversFor = async (muscle: string): Promise<{ name: string; equipment: string[] }[]> => {
    const { rows } = await pool.query(
      `SELECT el.name, el.equipment
       FROM exercise_library el
       CROSS JOIN LATERAL jsonb_array_elements(el.muscles) mu
       WHERE el.merged_into IS NULL AND mu->>'role' = 'main'
         AND lower(mu->>'muscle') = $1`,
      [muscle],
    )
    return rows
  }

  const reachableAtHome = (rows: { equipment: string[] }[]) =>
    rows.filter(r => r.equipment.some(e => HOME_GYM.includes(e.toLowerCase())))

  it('adductors have a home-gym option at all — there were none', async () => {
    const rows = await mainMoversFor('adductors')
    expect(rows.length).toBeGreaterThan(1)
    expect(reachableAtHome(rows).length).toBeGreaterThan(0)
  })

  it('hamstrings have a knee-flexion option needing no machine and no anchor', async () => {
    const rows = await mainMoversFor('hamstrings')
    // Named explicitly: a generic "some bodyweight hamstring row exists" would be satisfied by the
    // Nordic curl, which is the row this entry exists because the owner cannot do.
    const names = rows.map(r => r.name)
    expect(names).toEqual(expect.arrayContaining(['Stability Ball Leg Curl', 'Slider Leg Curl']))
    for (const n of ['Stability Ball Leg Curl', 'Slider Leg Curl']) {
      expect(rows.find(r => r.name === n)?.equipment, n).toEqual(['bodyweight'])
    }
  })

  it('the added rows declare equipment — an empty list passes every filter (BF-129)', async () => {
    const added = ['Stability Ball Leg Curl', 'Slider Leg Curl', 'Copenhagen Plank', 'Cable Hip Adduction']
    const { rows } = await pool.query(
      'SELECT name, equipment FROM exercise_library WHERE name = ANY($1)', [added],
    )
    expect(rows).toHaveLength(added.length)
    for (const r of rows) expect(r.equipment.length, r.name).toBeGreaterThan(0)
  })

  it('every main muscle now has at least one home-reachable exercise', async () => {
    const { rows } = await pool.query(`
      SELECT lower(mu->>'muscle') AS muscle,
             count(*) FILTER (WHERE el.equipment && $1::text[]) AS home
      FROM exercise_library el
      CROSS JOIN LATERAL jsonb_array_elements(el.muscles) mu
      WHERE el.merged_into IS NULL AND mu->>'role' = 'main'
      GROUP BY 1
    `, [HOME_GYM])
    const stranded = rows.filter(r => Number(r.home) === 0).map(r => r.muscle)
    expect(stranded).toEqual([])
  })
})
