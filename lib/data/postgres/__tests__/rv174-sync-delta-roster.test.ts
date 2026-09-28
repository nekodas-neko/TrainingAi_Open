// RV-174 — the delta carries every program and style id the user has, on every page, including rows
// that did NOT change since the cursor. That is the whole point: the device prunes its mirror to this
// list, so a roster built from the changed rows alone would delete every unchanged program.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000174001'
const OTHER = '00000000-0000-4000-8000-000000174002'

describe.skipIf(!canRun)('getSyncDelta sends the program and style roster (RV-174)', () => {
  let pool: import('pg').Pool
  const mine: { programs: string[]; styles: string[] } = { programs: [], styles: [] }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    for (const [id, tag] of [[USER, 'mine'], [OTHER, 'other']]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `rv174-${tag}@example.com`])
    }
    // Old rows: well before the cursor used below, so the changed-rows half of the delta skips them.
    const old = new Date(Date.now() - 30 * 86_400_000)
    for (const name of ['RV174 A', 'RV174 B']) {
      const r = await pool.query(
        `INSERT INTO programs (user_id, name, updated_at) VALUES ($1, $2, $3) RETURNING id`, [USER, name, old])
      mine.programs.push(r.rows[0].id)
    }
    const st = await pool.query(
      `INSERT INTO progression_styles (user_id, name, updated_at) VALUES ($1, 'RV174 style', $2) RETURNING id`, [USER, old])
    mine.styles.push(st.rows[0].id)
    await pool.query(`INSERT INTO programs (user_id, name) VALUES ($1, 'RV174 not mine')`, [OTHER])
    await pool.query(`INSERT INTO progression_styles (user_id, name) VALUES ($1, 'RV174 not mine')`, [OTHER])
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM programs WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM progression_styles WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  it('lists every program and style the user has, whether or not it changed', async () => {
    const { getRepository } = await import('@/lib/data')
    const repo = await getRepository()
    const since = new Date(Date.now() - 86_400_000)
    const delta = await repo.getSyncDelta(USER, since)
    // Nothing changed since the cursor…
    expect((delta.programs as unknown[]).length).toBe(0)
    // …and the roster still names both programs and the style.
    expect([...(delta.programRoster ?? [])].sort()).toEqual([...mine.programs].sort())
    expect(delta.progressionStyleRoster).toEqual(mine.styles)
  })

  it('names nobody else’s rows', async () => {
    const { getRepository } = await import('@/lib/data')
    const repo = await getRepository()
    const delta = await repo.getSyncDelta(USER, new Date(0))
    const all = [...(delta.programRoster ?? []), ...(delta.progressionStyleRoster ?? [])]
    const theirs = await pool.query(
      `SELECT id FROM programs WHERE user_id = $1 UNION ALL SELECT id FROM progression_styles WHERE user_id = $1`, [OTHER])
    for (const r of theirs.rows) expect(all).not.toContain(r.id)
  })
})
