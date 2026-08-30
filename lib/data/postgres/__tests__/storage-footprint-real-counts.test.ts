// BF-54 — the admin console printed a planner ESTIMATE where it said "rows", and used the same
// number to justify a VACUUM FULL.
//
// CLAUDE.md already documents `n_live_tup` as an estimate maintained by autovacuum, with
// `last_analyze` NULL on every table in this database. Measured against production on 2026-08-30 the
// gap was not marginal: `oura_raw_samples` read **552** against **180,415** real rows, `rr_intervals`
// **0** against 87,015, `error_events` **1** against 6,102. The owner's screen showed 297 rows
// directly under a line reading "0 / 180,160".
//
// The test below reproduces the estimate being wrong rather than assuming it: it inserts rows and
// never ANALYZEs, which is the state this database is permanently in.
//
// Runs only against a local dev Postgres — skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000bf54'

describe.skipIf(!canRun)('the DB footprint counts rows rather than estimating them (BF-54)', () => {
  let pool: import('pg').Pool
  let getOuraStorageStats: typeof import('@/lib/data/postgres/slices/oura').getOuraStorageStats
  let db: Parameters<typeof getOuraStorageStats>[0]

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    pool = getPool()
    db = getDb() as typeof db
    ;({ getOuraStorageStats } = await import('@/lib/data/postgres/slices/oura'))
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, `footprint-${USER}@example.com`])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [USER])
  })

  const insert = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await pool.query(
        `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, recorded_at, epoch)
         VALUES ($1, $2, 1, 'test', $3, now(), 0)`,
        [USER, 1_000_000 + i, (i % 256).toString(16).padStart(2, '0')])
    }
  }

  it('reports what count(*) reports', async () => {
    await insert(7)
    const real = Number((await pool.query(`SELECT count(*)::int AS n FROM oura_raw_samples`)).rows[0].n)

    const stats = await getOuraStorageStats(db)
    const row = stats.tables.find(t => t.table === 'oura_raw_samples')
    expect(row).toBeDefined()
    expect(row!.rows).toBe(real)
    expect(row!.rows).toBeGreaterThanOrEqual(7)
  })

  // The reproduction, and the reason this is a test rather than a comment: the estimate is not
  // merely imprecise, it is stale by however long it has been since an ANALYZE that never runs.
  it('disagrees with n_live_tup, which is the bug', async () => {
    await pool.query(`ANALYZE oura_raw_samples`)
    const before = Number((await pool.query(
      `SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = 'oura_raw_samples'`)).rows[0]?.n_live_tup ?? 0)

    await insert(9)   // no ANALYZE after this — the state this database is always in

    const estimate = Number((await pool.query(
      `SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = 'oura_raw_samples'`)).rows[0]?.n_live_tup ?? 0)
    const real = Number((await pool.query(`SELECT count(*)::int AS n FROM oura_raw_samples`)).rows[0].n)
    expect(real).toBe(before + 9)
    // If this ever stops holding, autovacuum ran mid-test and the case proved nothing — which is
    // itself worth knowing, so it asserts rather than skipping.
    expect(estimate, 'the estimate went stale, which is the premise').toBeLessThan(real)

    const stats = await getOuraStorageStats(db)
    expect(stats.tables.find(t => t.table === 'oura_raw_samples')!.rows).toBe(real)
  })

  it('still reports exact sizes, which were never the problem', async () => {
    // `pg_total_relation_size` is read from the filesystem. Only the ROW columns of
    // `pg_stat_user_tables` are estimates, and conflating the two is what cost a session (Q-528).
    const stats = await getOuraStorageStats(db)
    const row = stats.tables.find(t => t.table === 'oura_raw_samples')!
    const real = Number((await pool.query(
      `SELECT pg_total_relation_size('oura_raw_samples')::bigint AS b`)).rows[0].b)
    expect(row.bytes).toBe(real)
  })

  it('covers every table in the footprint list', async () => {
    const stats = await getOuraStorageStats(db)
    for (const t of stats.tables) expect(Number.isInteger(t.rows), `${t.table} has no count`).toBe(true)
    expect(stats.tables.length).toBeGreaterThan(10)
  })
})

// The VACUUM FULL path is asserted at source rather than run. `vacuumTableFull` takes an ACCESS
// EXCLUSIVE lock with `statement_timeout` deliberately set to 0, against a database every other test
// file in this directory shares — which is the wedge CLAUDE.md warns about, for a code path whose
// only change is which expression produces one number.
describe('the reclaim justifies itself on a real count too (BF-54)', () => {
  const src = readFileSync(join(process.cwd(), 'lib/data/postgres/slices/oura.ts'), 'utf8')
  // Comments are stripped before the prohibition, and deliberately: this file now EXPLAINS
  // `n_live_tup` at length, and a check that could not tell an explanation from a use would force
  // the next reader to delete the explanation to keep the check green.
  const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const fn = code.slice(code.indexOf('export async function vacuumTableFull'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))

  it('reads count(*), not n_live_tup', () => {
    expect(body).toMatch(/SELECT count\(\*\)::bigint AS rows FROM \$\{table\}/)
    expect(body).not.toContain('n_live_tup')
  })

  // The sibling sweep, frozen: `n_live_tup` was in exactly two places in the whole tree and this
  // file held both.
  it('leaves no other n_live_tup reaching a user or gating an action', () => {
    expect(code).not.toContain('n_live_tup')
  })
})
