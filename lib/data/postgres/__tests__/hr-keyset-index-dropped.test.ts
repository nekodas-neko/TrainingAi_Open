/**
 * BF-55 — the largest index in the database served a code path nothing calls.
 *
 * `oura_heartrate_user_updated (user_id, updated_at, id)` is migration 130's keyset index for
 * `getOuraTimeseriesDelta`. Measured against production twice, a day apart: **`idx_scan` 0,
 * `idx_tup_read` 0, 21 MB** — a quarter of the whole database's 84 MB index budget — while
 * `oura_heartrate_user_id_timestamp_key` on the same table showed **47,922 scans / 22.7 M tuples
 * read**. Not a quiet table; an index the planner never chooses, taking write amplification on the
 * app's highest-volume insert.
 *
 * **Two things this file exists to hold, and the second is the one that will actually bite.**
 *
 * 1. The index stays dropped. A future migration that recreates it without a caller re-spends the
 *    21 MB silently.
 * 2. **Whoever writes the restore driver recreates it.** `getOuraTimeseriesDelta` still works
 *    without the index — it falls back to a scan, which is fine at test size and is not fine over
 *    87 k production rows. So the method's own tests pass either way, and nothing else would notice.
 *    The doc comment carries the `CREATE INDEX` statement; this asserts the comment is still there,
 *    because a paragraph is the only guard a not-yet-written driver can have.
 *
 * **⚠ Nothing else on this table is a drop candidate.** `idx_scan` counts READS, not constraint
 * enforcement: `oura_heartrate_pkey` also reads 0 and is consulted on every insert to reject a
 * duplicate, and `rr_intervals_pkey` read 0 on 2026-08-30 and 5,034 a day later. The entry's own
 * first draft got this wrong and corrected itself; the correction is worth keeping.
 *
 * Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canRun = !!process.env.DATABASE_URL
const ROOT = join(__dirname, '..', '..', '..', '..')

describe.skipIf(!canRun)('oura_heartrate indexes after BF-55', () => {
  let pool: import('pg').Pool

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
  })

  const indexes = async () => (await pool.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'oura_heartrate' ORDER BY indexname`
  )).rows.map(r => r.indexname)

  it('the unused keyset index is gone', async () => {
    expect(await indexes()).not.toContain('oura_heartrate_user_updated')
  })

  /**
   * The index that does the work stays. Dropping the wrong one is the failure this entry nearly
   * shipped, so the survivor is asserted by name rather than by "some index remains".
   */
  it('the index the planner actually uses is untouched, and so is the primary key', async () => {
    const names = await indexes()
    expect(names).toContain('oura_heartrate_user_id_timestamp_key')
    expect(names).toContain('oura_heartrate_pkey')
  })
})

/**
 * Source-level, so it holds in CI too — and because the thing being protected has not been written
 * yet. A restore driver added against a scan-backed query is slow in production and fast in every
 * test; the only place that can be said is beside the query itself.
 */
describe('the restore driver is told to recreate the index', () => {
  const src = readFileSync(join(ROOT, 'lib/data/postgres/slices/oura.ts'), 'utf8')
  const doc = src.slice(0, src.indexOf('export async function getOuraTimeseriesDelta'))

  it('names the index and carries the statement that recreates it', () => {
    expect(doc).toContain('oura_heartrate_user_updated')
    expect(doc).toMatch(/CREATE INDEX IF NOT EXISTS oura_heartrate_user_updated ON oura_heartrate\(user_id, updated_at, id\)/)
  })

  it('and retracts the claim that made it look free', () => {
    // Q-180 kept the method because it "costs nothing at runtime". That was true of the method and
    // not of its index, and the comment must keep saying so — the sentence is the whole correction.
    expect(doc).toMatch(/costs nothing at runtime/)
    expect(doc).toMatch(/the index was never in\s*\n?\s*\*?\s*that accounting/)
  })
})
