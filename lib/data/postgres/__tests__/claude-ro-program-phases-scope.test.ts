// The claude_ro audit view for program_phases was scoped through `program_id` — a column the
// modern write path never sets (migration 024 made it nullable on purpose; createPhaseSet,
// updatePhaseSet and the 042 seed all insert with only `phase_set_id`). The predicate therefore
// matched ZERO rows for every user, and a 2026-08-05 production audit read that as "eight phase
// sets contain no phases" when the table was fine.
//
// That is the worst kind of bug in an audit tool: it does not fail, it lies. These tests pin the
// scoping to the column the data actually uses.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000fa50'

describe.skipIf(!canRun)('claude_ro program_phases scoping', () => {
  let pool: import('pg').Pool
  const setId = randomUUID()

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `phasescope-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`INSERT INTO phase_sets (id, user_id, name, is_default) VALUES ($1,$2,'Scope test',false)
                      ON CONFLICT (id) DO NOTHING`, [setId, TEST_USER_ID])
    // Written the way every real path writes them: phase_set_id set, program_id left NULL.
    for (let i = 1; i <= 3; i++) {
      await pool.query(
        `INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type)
         VALUES ($1,$2,$3,$4,1,'normal') ON CONFLICT (id) DO NOTHING`,
        [randomUUID(), setId, i, `Phase ${i}`],
      )
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM program_phases WHERE phase_set_id = $1`, [setId])
    await pool.query(`DELETE FROM phase_sets WHERE id = $1`, [setId])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('the modern write path leaves program_id NULL', async () => {
    // This is the fact the old predicate contradicted. If a future change starts populating
    // program_id, this test failing is the signal to revisit the view — not a reason to delete it.
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM program_phases WHERE phase_set_id = $1 AND program_id IS NOT NULL`,
      [setId],
    )
    expect(rows[0].n).toBe('0')
  })

  it('the OLD program_id-only predicate finds nothing — this was the bug', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM program_phases t
       WHERE EXISTS (SELECT 1 FROM programs p WHERE p.id = t.program_id AND p.user_id = $1)`,
      [TEST_USER_ID],
    )
    expect(rows[0].n).toBe('0')
  })

  it('the phase_set-scoped predicate finds them, and stays scoped to the owner', async () => {
    const predicate = `EXISTS (SELECT 1 FROM phase_sets ps WHERE ps.id = t.phase_set_id AND ps.user_id = $1)
                       OR EXISTS (SELECT 1 FROM programs p WHERE p.id = t.program_id AND p.user_id = $1)`
    const mine = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM program_phases t WHERE ${predicate}`, [TEST_USER_ID])
    expect(mine.rows[0].n).toBe('3')

    // The OR arm must not become a leak: a different user still sees none of these rows.
    const other = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM program_phases t
       WHERE (${predicate}) AND t.phase_set_id = $2`,
      ['00000000-0000-4000-8000-0000000000ff', setId])
    expect(other.rows[0].n).toBe('0')
  })

  it('the generator emits the phase_set path, not the program_id-only one', async () => {
    const { readFileSync } = await import('fs')
    const src = readFileSync('scripts/generate-claude-ro-views.js', 'utf8')
    const line = src.split('\n').find(l => l.trimStart().startsWith('program_phases:'))!
    expect(line).toContain('phase_sets')
  })
})
