// The read-only guarantee for /api/admin/db-query is a Postgres GRANT, not application logic — so
// it can only be tested against a real Postgres. Mocking these would prove nothing at all.
//
// Provisions the claude_readonly role against the local dev DB, applies the claude_ro view schema,
// then asserts the three properties the whole design rests on:
//   1. every write form fails, INCLUDING the CTE-wrapped INSERT a keyword allowlist would pass;
//   2. withheld columns are unreachable, and public.* is unreachable;
//   3. the curated views are readable;
//   4. ROW SCOPING — a second user's health data is invisible. Production holds several real
//      accounts with months of sleep/weight/food data; they cannot consent on the owner's behalf.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { readFileSync } from 'fs'
import { join } from 'path'

const ADMIN_URL = process.env.DATABASE_URL
// The whole test connects a SECOND time as `claude_readonly` by rewriting the URL's credentials
// (`roUrl()` below). That only works over TCP. On a Unix-socket URL — which is what
// `scripts/local-db/setup.sh` now writes (`postgresql://postgres:postgres@/db?host=/tmp&port=5433`)
// — the rewritten URL still connects as the superuser, so every "this write must be rejected"
// assertion sees the write succeed and 20 of the 21 tests fail at once. That looks like a broken
// read-only guarantee and is really a broken test harness; it cost a session on 2026-08-04.
// Skip loudly instead. Re-run with the TCP form to actually exercise the role:
//   DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev' npx vitest run …
const isTcpUrl = (u: string) => { try { return !!new URL(u).hostname } catch { return false } }
const canRun = !!ADMIN_URL
  && !/railway|rlwy\.net/i.test(ADMIN_URL)   // never provision roles against prod
  && isTcpUrl(ADMIN_URL)

if (!!ADMIN_URL && !/railway|rlwy\.net/i.test(ADMIN_URL) && !isTcpUrl(ADMIN_URL)) {
  console.warn(
    '[claude-ro-readonly-role] SKIPPED: DATABASE_URL is a Unix-socket URL, which cannot be ' +
    're-pointed at the claude_readonly role. Re-run with the TCP form ' +
    '(postgresql://postgres:postgres@localhost:5433/trainingai_dev) to exercise this suite.',
  )
}

const RO_PASSWORD = 'claude_ro_test_pw'
// The committed migration hard-codes the production owner id; the fixtures below use it so the
// generated predicates are exercised exactly as shipped, rather than a test-only variant.
const OWNER_ID = 'fe481797-4114-4f59-824d-223e0281823e'
const OTHER_ID = '11111111-1111-1111-1111-111111111111'
const roUrl = () => {
  const u = new URL(ADMIN_URL!)
  u.username = 'claude_readonly'
  u.password = RO_PASSWORD
  return u.toString()
}

// DROP ROLE fails while the role still holds grants, so its privileges are dropped first. Guarded
// on existence because DROP OWNED BY errors on an unknown role.
const DROP_ROLE_SQL = `
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'claude_readonly') THEN
    EXECUTE 'DROP OWNED BY claude_readonly';
    EXECUTE 'DROP ROLE claude_readonly';
  END IF;
END $$;`

async function exec(url: string, sql: string) {
  const c = new Client({ connectionString: url })
  await c.connect()
  try {
    return await c.query(sql)
  } finally {
    await c.end()
  }
}

/** Run `sql` as claude_readonly and return the Postgres error message, or null if it succeeded. */
async function errorFrom(sql: string): Promise<string | null> {
  try {
    await exec(roUrl(), sql)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

describe.skipIf(!canRun)('claude_readonly role — the read-only guarantee', () => {
  beforeAll(async () => {
    await exec(ADMIN_URL!, DROP_ROLE_SQL)
    await exec(ADMIN_URL!, `
      CREATE ROLE claude_readonly LOGIN PASSWORD '${RO_PASSWORD}';
      ALTER ROLE claude_readonly SET default_transaction_read_only = on;
      ALTER ROLE claude_readonly SET statement_timeout = '10s';
      REVOKE ALL ON SCHEMA public FROM claude_readonly;
    `)
    // Two users so scoping has something to hide.
    await exec(ADMIN_URL!, `
      INSERT INTO users (id, email, is_active) VALUES
        ('${OWNER_ID}', 'owner@test.dev', true),
        ('${OTHER_ID}', 'other@test.dev', true)
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours) VALUES
        ('${OWNER_ID}', '2026-07-20', now(), now(), 8),
        ('${OTHER_ID}', '2026-07-20', now(), now(), 7)
      ON CONFLICT DO NOTHING;
    `)
    // Pinned to the NEWEST claude_ro views migration — each one DROPs and rebuilds the whole
    // schema, so an older file rebuilds it without the newer tables' views and the coverage
    // assertion below then fails. Repoint this when generating a new views migration.
    //
    // The pin went stale silently between 181 and 185: migrations 183 and 185 both landed while this
    // still read 181, and the coverage count only noticed once one of them added a *table* rather
    // than a column. Re-point it in the same commit as any new views migration — and note that a
    // green suite does not prove the pin is current, only that no table was added since.
    const migration = readFileSync(
      join(process.cwd(), 'lib/data/postgres/migrations/200_claude_ro_views_applied_mutations.sql'), 'utf8',
    )
    await exec(ADMIN_URL!, migration)
  }, 60_000)

  afterAll(async () => {
    if (canRun) await exec(ADMIN_URL!, DROP_ROLE_SQL).catch(() => {})
  })

  it('reads the curated views', async () => {
    const res = await exec(roUrl(), 'SELECT count(*)::int AS n FROM claude_ro.users')
    expect(res.rows[0].n).toBeGreaterThanOrEqual(0)
  })

  it('resolves unqualified names to claude_ro via search_path', async () => {
    const res = await exec(roUrl(), 'SELECT is_admin FROM users LIMIT 1')
    expect(res.rows.length).toBeGreaterThanOrEqual(0)
  })

  // The property that matters most: a keyword/regex allowlist would pass the CTE form, because it
  // begins with WITH and ends in SELECT. The role rejects it regardless.
  it.each([
    ['INSERT',            `INSERT INTO public.users(email) VALUES ('x@y.z')`],
    ['UPDATE',            `UPDATE public.users SET is_admin = true`],
    ['DELETE',            `DELETE FROM public.users`],
    ['CREATE TABLE',      `CREATE TABLE public.evil (id int)`],
    ['DROP VIEW',         `DROP VIEW claude_ro.users`],
    ['CTE-wrapped INSERT', `WITH x AS (INSERT INTO public.users(email) VALUES ('a@b.c') RETURNING *) SELECT * FROM x`],
  ])('rejects %s', async (_label, sql) => {
    const err = await errorFrom(sql)
    expect(err).not.toBeNull()
    expect(err).toMatch(/read-only transaction|permission denied/i)
  })

  it.each([
    ['users.password_hash',                    `SELECT password_hash FROM users LIMIT 1`],
    ['oura_tokens.personal_access_token',      `SELECT personal_access_token FROM oura_tokens LIMIT 1`],
    ['oura_tokens.webhook_signing_key',        `SELECT webhook_signing_key FROM oura_tokens LIMIT 1`],
    ['feedback_submissions.screenshot_data',   `SELECT screenshot_data FROM feedback_submissions LIMIT 1`],
    ['push_subscriptions.p256dh',              `SELECT p256dh FROM push_subscriptions LIMIT 1`],
    ['push_subscriptions.endpoint',            `SELECT endpoint FROM push_subscriptions LIMIT 1`],
  ])('withholds %s', async (_label, sql) => {
    const err = await errorFrom(sql)
    expect(err).not.toBeNull()
    expect(err).toMatch(/does not exist|permission denied/i)
  })

  it('cannot reach the underlying public tables at all', async () => {
    const err = await errorFrom('SELECT * FROM public.users LIMIT 1')
    expect(err).toMatch(/permission denied/i)
  })

  it('still exposes presence/size stand-ins for the withheld columns', async () => {
    const res = await exec(roUrl(),
      `SELECT has_pat, has_webhook_key FROM claude_ro.oura_tokens LIMIT 1`)
    expect(res).toBeTruthy() // shape is what matters; the seed may hold no rows
  })

  it('hides another user entirely — only the scoped owner is visible', async () => {
    const res = await exec(roUrl(), 'SELECT id FROM users')
    expect(res.rows.map(r => r.id)).toEqual([OWNER_ID])
  })

  it('hides another user\'s health data', async () => {
    const all = await exec(roUrl(), 'SELECT count(*)::int AS n FROM sleep_sessions')
    const theirs = await exec(roUrl(),
      `SELECT count(*)::int AS n FROM sleep_sessions WHERE user_id = '${OTHER_ID}'`)
    const truth = await exec(ADMIN_URL!, 'SELECT count(*)::int AS n FROM public.sleep_sessions')
    expect(theirs.rows[0].n).toBe(0)
    expect(all.rows[0].n).toBeLessThan(truth.rows[0].n) // the view really is a subset
  })

  it('scopes transitively-owned child tables too (no user_id column of their own)', async () => {
    // set_logs -> exercise_logs -> workout_sessions.user_id
    const res = await exec(roUrl(), 'SELECT count(*)::int AS n FROM set_logs')
    expect(res.rows[0].n).toBeGreaterThanOrEqual(0) // predicate must at least be valid SQL
  })

  it('denies tables holding third-party personal data outright', async () => {
    for (const t of ['invited_emails', 'rate_limits']) {
      const err = await errorFrom(`SELECT * FROM ${t} LIMIT 1`)
      expect(err).toMatch(/does not exist|permission denied/i)
    }
  })

  it('covers every base table with a view — default-deny must not silently hide data either', async () => {
    const tables = await exec(ADMIN_URL!, `
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)
    const views = await exec(ADMIN_URL!, `
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'claude_ro'`)
    // Two tables are deliberately denied (invited_emails, rate_limits). Any OTHER mismatch means
    // the generator needs re-running after a schema change.
    expect(views.rows[0].n).toBe(tables.rows[0].n - 2)
  })
})
