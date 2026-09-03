// Integration tests for the Q-530 snapshot core against the real local Postgres, over a read-only
// role with the same shape as production's `claude_readonly` — the same TCP-only, non-production
// guard as `claude-ro-readonly-role.test.ts`, whose provisioning this mirrors rather than shares.
//
// **PS-23: this file uses its OWN role, and the name is the whole fix.** Both files used to
// `CREATE ROLE claude_readonly` in `beforeAll` and `DROP OWNED BY` + `DROP ROLE` it in `afterAll`.
// Vitest runs files in parallel, so together they collided — reproduced 5 of 5, and again 3 of 3
// before this change — in three ways, of which the third is the expensive one:
//   1. `duplicate key value violates unique constraint "pg_authid_rolname_index"` — both created it.
//   2. `permission denied for schema claude_ro` — one file's teardown revoked the other's grants.
//   3. **A false schema-drift error naming an innocent column.** `readTableColumns` reads
//      `information_schema.columns`, which is **privilege-filtered**: a revocation mid-read does not
//      raise, the columns simply stop being listed, and `checkDrift` reports whatever it reaches
//      first as drift. Indistinguishable from a genuinely missing view, and it points at a column
//      with nothing wrong with it.
// A lock would serialise the files; a rename removes the shared resource. This works because the
// view predicates key off `app.claude_ro_owner`, which is set **per role** rather than by name, and
// because this file grants itself everything it needs below. The role that must literally be called
// `claude_readonly` is the one the migrations GRANT to by name — `claude-ro-readonly-role.test.ts`
// keeps it, and that file is what proves the production grants.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client, Pool } from 'pg'
import { migrationTestLock } from '@/lib/data/postgres/__tests__/migration-test-lock'
import { readTableColumns, checkDrift, getPrimaryKeyColumns, streamTableRows } from '../db-snapshot'

const ADMIN_URL = process.env.DATABASE_URL
const isTcpUrl = (u: string) => { try { return !!new URL(u).hostname } catch { return false } }
const canRun = !!ADMIN_URL && !/railway|rlwy\.net/i.test(ADMIN_URL) && isTcpUrl(ADMIN_URL)

const RO_ROLE = 'claude_ro_snapshot_test'
const RO_PASSWORD = 'claude_ro_snapshot_test_pw'
const roUrl = () => {
  const u = new URL(ADMIN_URL!)
  u.username = RO_ROLE
  u.password = RO_PASSWORD
  return u.toString()
}

async function exec(url: string, sql: string) {
  const c = new Client({ connectionString: url })
  await c.connect()
  try { return await c.query(sql) } finally { await c.end() }
}

const DROP_ROLE_SQL = `
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RO_ROLE}') THEN
    EXECUTE 'DROP OWNED BY ${RO_ROLE}';
    EXECUTE 'DROP ROLE ${RO_ROLE}';
  END IF;
END $$;`

describe.skipIf(!canRun)('db-snapshot — against a real read-only role', () => {
  let roPool: Pool
  let adminPool: Pool
  // PS-23, the half a rename cannot reach. This file holds a GRANT on schema `claude_ro` for its
  // whole run, and `claude-ro-readonly-role.test.ts` applies a views migration that opens with
  // `DROP SCHEMA IF EXISTS claude_ro CASCADE` — taking the schema and every grant on it with it,
  // whatever this file's role is called. Measured: the rename alone still failed 3 of 5 paired runs.
  const lock = migrationTestLock(() => adminPool)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    adminPool = getPool()
    await lock.acquire()
    // The migrations already build claude_ro against the live schema (applied by
    // scripts/local-db/migrate.js as part of the session's local-DB setup) — this only
    // (re)provisions the ROLE, same shape as claude-ro-readonly-role.test.ts.
    await exec(ADMIN_URL!, DROP_ROLE_SQL)
    await exec(ADMIN_URL!, `
      CREATE ROLE ${RO_ROLE} LOGIN PASSWORD '${RO_PASSWORD}';
      ALTER ROLE ${RO_ROLE} SET default_transaction_read_only = on;
      ALTER ROLE ${RO_ROLE} SET statement_timeout = '10s';
      REVOKE ALL ON SCHEMA public FROM ${RO_ROLE};
      GRANT USAGE ON SCHEMA claude_ro TO ${RO_ROLE};
      GRANT SELECT ON ALL TABLES IN SCHEMA claude_ro TO ${RO_ROLE};
      ALTER ROLE ${RO_ROLE} SET search_path = claude_ro;
    `)
    await exec(ADMIN_URL!, `ALTER ROLE ${RO_ROLE} SET app.claude_ro_owner = 'fe481797-4114-4f59-824d-223e0281823e'`)
    roPool = new Pool({ connectionString: roUrl(), max: 2 })
  }, 30_000)

  afterAll(async () => {
    await roPool?.end()
    await exec(ADMIN_URL!, DROP_ROLE_SQL).catch(() => {})
    await lock.release()
  })

  it('reads pg_catalog for public tables/columns despite holding no SELECT grant there', async () => {
    const cols = await readTableColumns(roPool)
    expect(cols.publicTables.size).toBeGreaterThan(50) // ~83 in production; local schema is the same shape
    expect(cols.publicTables.has('workout_sessions')).toBe(true)
    expect(cols.views.has('workout_sessions')).toBe(true)
    expect(cols.excludedTables.has('invited_emails')).toBe(true)
    expect(cols.excludedTables.has('rate_limits')).toBe(true)
    expect(cols.withheldColumns.get('users')?.has('password_hash')).toBe(true)
  })

  it('the real schema has no drift — checkDrift passes against the actual local database', async () => {
    const cols = await readTableColumns(roPool)
    expect(() => checkDrift(cols)).not.toThrow()
  })

  it('gets primary key columns for a real table', async () => {
    const pk = await getPrimaryKeyColumns(roPool, 'workout_sessions')
    expect(pk).toEqual(['id'])
  })

  it('gets composite/scoped primary keys too', async () => {
    // set_logs has a plain uuid PK; body_metrics is a good composite-key stand-in.
    const pk = await getPrimaryKeyColumns(roPool, 'body_metrics')
    expect(pk.length).toBeGreaterThan(0)
  })

  it('streams every row of a table exactly once, across a chunk boundary', async () => {
    const userId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const admin = new Client({ connectionString: ADMIN_URL! })
    await admin.connect()
    try {
      await admin.query(`
        INSERT INTO users (id, email, is_active) VALUES ($1, 'snapshot-test@test.dev', true)
        ON CONFLICT (id) DO NOTHING;
      `, [userId])
      // Session-level GUC — only NEW connections see it, so the pool used for streamTableRows
      // below is created fresh after this, not reused from beforeAll's roPool.
      await admin.query(`ALTER ROLE ${RO_ROLE} SET app.claude_ro_owner = '${userId}'`)
      // 7 rows through a chunk size of 3 forces three pages (3, 3, 1) — exercises the keyset
      // cursor advancing and the final short page terminating the generator.
      for (let i = 0; i < 7; i++) {
        await admin.query(`
          INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, $2, 70)
          ON CONFLICT (user_id, date) DO NOTHING;
        `, [userId, `2026-01-${String(i + 1).padStart(2, '0')}`])
      }

      const scopedPool = new Pool({ connectionString: roUrl(), max: 1 })
      try {
        const pk = await getPrimaryKeyColumns(scopedPool, 'body_metrics')
        const rows: Record<string, unknown>[] = []
        for await (const row of streamTableRows(scopedPool, 'body_metrics', pk, 3)) rows.push(row)
        expect(rows.length).toBe(7)
        // No duplicate primary keys across pages — the keyset cursor must have advanced correctly.
        const keys = rows.map(r => pk.map(c => r[c]).join('|'))
        expect(new Set(keys).size).toBe(7)
      } finally {
        await scopedPool.end()
      }
    } finally {
      await admin.query('DELETE FROM body_metrics WHERE user_id = $1', [userId])
      await admin.query('DELETE FROM users WHERE id = $1', [userId])
      await admin.query(`ALTER ROLE ${RO_ROLE} SET app.claude_ro_owner = 'fe481797-4114-4f59-824d-223e0281823e'`)
      await admin.end()
    }
  }, 20_000)
})
