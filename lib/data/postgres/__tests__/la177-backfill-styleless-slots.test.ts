// LA-177 — the styleless-slot backfill assigns each slot its ROLE's most-used style, in its own
// active program, and nothing else. Runs the migration's SQL against seeded rows.
//
// Runs only against a real local dev Postgres; skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000177b01'
const SQL = readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/202609290751_backfill_styleless_active_slots.sql'), 'utf8')

describe.skipIf(!canRun)('LA-177 backfill of styleless slots', () => {
  let pool: import('pg').Pool
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'la177@example.com', 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [USER])
    const style = async (name: string) => (await pool.query(`INSERT INTO progression_styles (user_id, name) VALUES ($1, $2) RETURNING id`, [USER, name])).rows[0].id
    ids.A = await style('LA177 Alpha'); ids.B = await style('LA177 Bravo'); ids.P = await style('LA177 Power')
    const prog = async (active: boolean) => (await pool.query(`INSERT INTO programs (user_id, name, is_active) VALUES ($1, $2, $3) RETURNING id`, [USER, active ? 'LA177 active' : 'LA177 inactive', active])).rows[0].id
    const active = await prog(true), inactive = await prog(false)
    const sess = async (programId: string) => (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'S', 0) RETURNING id`, [programId])).rows[0].id
    const s1 = await sess(active), s2 = await sess(inactive)
    const ex = async (sessionId: string, key: string, role: string, styleId: string | null, pos: number) => {
      ids[key] = (await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, style_id, muscle_groups, position, exercise_role) VALUES ($1, $2, $3, '{}', $4, $5) RETURNING id`, [sessionId, key, styleId, pos, role])).rows[0].id
    }
    // accessory: Bravo x2 beats Alpha x1; primary: a tie (Alpha, Power) broken by name → Alpha; secondary: no styled slot.
    await ex(s1, 'acc1', 'accessory', ids.B, 0); await ex(s1, 'acc2', 'accessory', ids.B, 1); await ex(s1, 'acc3', 'accessory', ids.A, 2)
    await ex(s1, 'accNull', 'accessory', null, 3)
    await ex(s1, 'pri1', 'primary', ids.A, 4); await ex(s1, 'pri2', 'primary', ids.P, 5); await ex(s1, 'priNull', 'primary', null, 6)
    await ex(s1, 'secNull', 'secondary', null, 7)
    await ex(s2, 'inactiveNull', 'accessory', null, 0)
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM progression_styles WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  const styleOf = async (key: string) => (await pool.query(`SELECT style_id FROM session_exercises WHERE id = $1`, [ids[key]])).rows[0].style_id

  it('fills by role within the program, breaks a tie by name, and leaves the rest alone', async () => {
    await pool.query(SQL)
    expect(await styleOf('accNull')).toBe(ids.B)       // the role's majority
    expect(await styleOf('priNull')).toBe(ids.A)       // tie → 'LA177 Alpha' before 'LA177 Power'
    expect(await styleOf('secNull')).toBeNull()        // no styled secondary to learn from: not guessed
    expect(await styleOf('inactiveNull')).toBeNull()   // inactive program: out of scope
    expect(await styleOf('acc3')).toBe(ids.A)          // an already-styled slot is never touched
  })

  it('is a no-op on a second run', async () => {
    await expect(pool.query(SQL)).resolves.toBeDefined()
    expect(await styleOf('accNull')).toBe(ids.B)
  })
})
