// Q-288: `/api/export` covered 26 of 82 tables and presented as complete, and its per-table read was
// a single buffering `pool.query` while the route comment claimed it streamed. These test the two
// halves against a real Postgres — the isolation the new scoping map has to preserve, and the
// pagination that had to land before any bulk table could be added.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const A = '00000000-0000-4000-8000-00000000288a'
const B = '00000000-0000-4000-8000-00000000288b'

describe.skipIf(!canRun)('full export (Q-288)', () => {
  let pool: import('pg').Pool
  let exportUserData: typeof import('../full-export').exportUserData
  let EXPORTED: typeof import('../export-map').EXPORTED

  const collect = async (userId: string) => {
    const out: { domain: string; row: unknown }[] = []
    for await (const line of exportUserData(userId)) out.push(line)
    return out
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    ;({ exportUserData } = await import('../full-export'))
    ;({ EXPORTED } = await import('../export-map'))

    for (const [id, tag] of [[A, 'a'], [B, 'b']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'secret-hash', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `export-${tag}-${id}@example.com`])
      // A user_id-scoped table, and a chain reachable only through a two-deep FK path.
      await pool.query(`INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, '2026-08-20', 80)
                        ON CONFLICT DO NOTHING`, [id])
      const { rows: [prog] } = await pool.query(
        `INSERT INTO programs (user_id, name) VALUES ($1, $2) RETURNING id`, [id, `prog-${tag}`])
      const { rows: [ps] } = await pool.query(
        `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, $2, 1) RETURNING id`, [prog.id, `sess-${tag}`])
      await pool.query(
        `INSERT INTO session_exercises (session_id, exercise_name, position) VALUES ($1, $2, 1)`, [ps.id, `ex-${tag}`])
    }

    // One table pushed past the 5,000-row chunk, so the keyset boundary is actually crossed.
    await pool.query(`
      INSERT INTO oura_heartrate (user_id, timestamp, bpm)
      SELECT $1, timestamp '2026-08-01 00:00:00+00' + (g || ' seconds')::interval, 60
      FROM generate_series(1, 5001) g`, [A])
  }, 60_000)

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[A, B]])
  })

  it('leads with a manifest that names every excluded table and why', async () => {
    const lines = await collect(A)
    expect(lines[0].domain).toBe('_manifest')
    const m = lines[0].row as { excluded: { table: string; reason: string }[]; exportedTables: string[] }
    // The point of the manifest: an omission the reader can see, rather than one they must infer
    // from the file's size.
    expect(m.excluded.find(e => e.table === 'oura_raw_samples')?.reason).toMatch(/decoded values are exported/)
    expect(m.exportedTables).toContain('oura_daily_derived')
  })

  it('exports the tables that used to be missing entirely', async () => {
    // A sample of the 56 absent-by-accident tables, chosen across the domains the entry named.
    for (const t of ['oura_daily_derived', 'oura_daily_summary', 'ai_health_insights', 'meal_plans',
                     'fitness_tests', 'running_plans', 'user_stats', 'users']) {
      expect(Object.keys(EXPORTED)).toContain(t)
    }
  })

  it('NEVER leaks another user\'s rows, through a direct scope or a two-deep FK path', async () => {
    const lines = await collect(A)
    const rows = lines.filter(l => l.domain !== '_manifest' && l.domain !== 'goals')
      .map(l => l.row as Record<string, unknown>)
    // Direct user_id scoping.
    for (const r of rows) if ('user_id' in r) expect(r.user_id).not.toBe(B)
    // The FK paths, which carry no user_id of their own and are where a wrong predicate hides.
    const names = rows.map(r => r.name ?? r.exercise_name).filter(Boolean)
    expect(names).toContain('prog-a')
    expect(names).toContain('sess-a')
    expect(names).not.toContain('prog-b')
    expect(names).not.toContain('sess-b')
    expect(rows.map(r => r.exercise_name).filter(Boolean)).not.toContain('ex-b')
  })

  it('returns every row of a table larger than one page, with no duplicates', async () => {
    // The pagination fix. The old read was a single buffering SELECT; this crosses the 5,000-row
    // chunk boundary, which is where a keyset cursor drops or repeats rows if it is wrong.
    const lines = await collect(A)
    const hr = lines.filter(l => l.domain === 'oura_heartrate').map(l => (l.row as { id: string }).id)
    expect(hr).toHaveLength(5001)
    expect(new Set(hr).size).toBe(5001)
  })

  it('strips the password hash from the exported profile row', async () => {
    const lines = await collect(A)
    const me = lines.filter(l => l.domain === 'users').map(l => l.row as Record<string, unknown>)
    expect(me).toHaveLength(1)
    expect(me[0].id).toBe(A)
    expect(me[0]).not.toHaveProperty('password_hash')
    expect(JSON.stringify(lines)).not.toContain('secret-hash')
  })
})
