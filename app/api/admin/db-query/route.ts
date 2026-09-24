import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getPool } from '@/lib/data/postgres/client'
import { getReadonlyPool, isReadonlyDbConfigured, describeReadonlyConnection } from '@/lib/data/postgres/readonly-client'
import { CLAUDE_RO_OWNER_UUID_RE } from '@/lib/data/postgres/claude-ro-owner'
import { requireAdmin, adminFailureOutcome } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { safeCompare } from '@/lib/security/constant-time'
import { reportServerError } from '@/lib/observability'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { clientIp } from '@trainingai/shared/http/client-ip'

// One SQL statement. The audit log truncates it at 20,000 characters, so 64 KB is generous past
// anything that is meaningfully recorded.
const MAX_BODY_BYTES = 64 * 1024

/**
 * Read-only production query endpoint (plan:
 * docs/superpowers/plans/2026-07-26-claude-readonly-prod-db-access.md).
 *
 * Runs a single SELECT against the `claude_ro` view schema so whole-history audits — counter drift,
 * null-rates, orphans, blast-radius measurement — can be done without the owner exporting dumps.
 *
 * Read-only is enforced by the `claude_readonly` Postgres role, NOT by inspecting the SQL. Keyword
 * checks lose to `WITH x AS (INSERT … RETURNING *) SELECT * FROM x`; a role with no write grants
 * does not. Everything in this file is bounds and bookkeeping on top of that.
 *
 * Disabled unless BOTH `CLAUDE_DB_QUERY_SECRET` and `CLAUDE_DB_READONLY_URL` are set — unset either
 * and the route rejects, never skips the check.
 */

/** Rows returned to the caller; one extra is fetched to detect truncation. */
const MAX_ROWS = 1000
/** Serialised-payload ceiling, so a wide SELECT can't return tens of megabytes. */
const MAX_BYTES = 5_000_000

type AuthOutcome =
  | { ok: true; via: 'session' | 'token' }
  | { ok: false; status: number; error: string }

async function authorize(req: NextRequest): Promise<AuthOutcome> {
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (bearer) {
    const ip = clientIp(req)
    // Bound every attempt per IP BEFORE the compare so a brute-force can't run at full throughput,
    // and return the same 401 on trip as for a bad token.
    if (!rateLimit(`db-query-token:${ip}`, 10, 60_000)) {
      return { ok: false, status: 401, error: 'Unauthorized' }
    }
    const expected = process.env.CLAUDE_DB_QUERY_SECRET
    const exportUserId = process.env.ADMIN_EXPORT_USER_ID ?? process.env.WEBHOOK_USER_ID
    if (!expected || !exportUserId || !safeCompare(bearer, expected)) {
      return { ok: false, status: 401, error: 'Unauthorized' }
    }
    // The token names a caller; it does not confer a role. The user it resolves to must be an admin.
    try {
      await requireAdmin(exportUserId)
    } catch (err) {
      return adminFailureOutcome(err)
    }
    return { ok: true, via: 'token' }
  }

  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' }
  try {
    await requireAdmin(userId, session.user?.isAdmin)
  } catch (err) {
    return adminFailureOutcome(err)
  }
  return { ok: true, via: 'session' }
}

/** Best-effort audit row. A logging failure must never change the response. */
async function logQuery(entry: {
  sql: string; rowCount: number | null; durationMs: number
  truncated: boolean; ok: boolean; error: string | null; ip: string
  /** OR-138: the user this query was scoped to, when the caller pivoted away from the default. */
  pivotedTo?: string | null
}) {
  try {
    // OR-138 records the pivot as a leading comment rather than a column, so this stays one PR: a
    // dedicated `read_user_id` column is a migration, and a migration ships alone. The requirement
    // is that a cross-user read is attributable afterwards, and a comment on the same audit row as
    // the query it scoped satisfies that and greps cleanly. A column would be tidier — follow-up.
    const sqlText = entry.pivotedTo
      ? `-- claude_ro pivot: ${entry.pivotedTo}\n${entry.sql}`
      : entry.sql
    await getPool().query(
      `INSERT INTO db_query_log (sql_text, row_count, duration_ms, truncated, ok, error, caller_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sqlText.slice(0, 20_000), entry.rowCount, entry.durationMs, entry.truncated, entry.ok, entry.error, entry.ip],
    )
  } catch (err) {
    console.error('[admin/db-query] audit log write failed:', err)
  }
}

export async function POST(req: NextRequest) {
  const authed = await authorize(req)
  if (!authed.ok) return NextResponse.json({ error: authed.error }, { status: authed.status })

  // Fail closed: no read-only connection configured means the feature is off, not open.
  if (!isReadonlyDbConfigured()) {
    return NextResponse.json({ error: 'Read-only database access is not configured' }, { status: 503 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const sql = (read.body as { sql?: unknown } | null)?.sql
  if (typeof sql !== 'string' || !sql.trim()) {
    return NextResponse.json({ error: 'Body must be { sql: string }' }, { status: 400 })
  }
  // One statement per request. The role already makes multi-statement harmless, but this keeps the
  // audit log honest — one logged row must correspond to exactly one executed query.
  if (sql.replace(/;\s*$/, '').includes(';')) {
    return NextResponse.json({ error: 'Only a single statement per request' }, { status: 400 })
  }

  // OR-138: an optional pivot to the user who filed a feedback report. Absent, every line below
  // behaves exactly as before and the role's own `app.claude_ro_owner` default applies.
  const rawUserId = (read.body as { userId?: unknown } | null)?.userId
  let pivotTo: string | null = null
  if (rawUserId !== undefined && rawUserId !== null) {
    if (typeof rawUserId !== 'string' || !CLAUDE_RO_OWNER_UUID_RE.test(rawUserId)) {
      return NextResponse.json({ error: 'userId must be a uuid' }, { status: 400 })
    }
    // The pivot is allowed only to someone who actually filed feedback — the justification the
    // owner gave. This check runs on the APP's pool, not the read-only one: `claude_ro` views are
    // themselves scoped to the current owner, so asking the read-only role whether another user
    // filed feedback would always answer no. One predicate to delete if the scope is ever widened
    // deliberately; the narrow version costs nothing to reverse and the broad one cannot be
    // un-shipped.
    const { rows } = await getPool().query(
      `SELECT 1 FROM feedback_submissions WHERE user_id = $1 LIMIT 1`, [rawUserId],
    )
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'userId has filed no feedback — the read-only pivot is limited to reporters' },
        { status: 403 },
      )
    }
    pivotTo = rawUserId
  }

  const ip = clientIp(req)
  const started = Date.now()

  try {
    // Wrapping in a subquery bounds ANY submitted query without parsing it. MAX_ROWS + 1 detects
    // truncation rather than silently returning a capped set as if it were complete.
    const wrapped = `SELECT * FROM (${sql.replace(/;\s*$/, '')}) _q LIMIT ${MAX_ROWS + 1}`
    // `SET LOCAL` is not a style preference: this endpoint reads through a POOL, so a bare `SET`
    // would persist on that pooled connection and silently re-scope whichever later request reused
    // it. `SET LOCAL` cannot outlive its transaction — and outside one it warns and does nothing,
    // so the explicit BEGIN is load-bearing rather than decorative.
    //
    // A caller cannot reach this by hand: the wrapping above turns a submitted `SET …` into
    // `SELECT * FROM (SET …) _q`, which is a syntax error. Verified against Postgres rather than
    // assumed, for both `SET` and `SET LOCAL`, with the setting still null afterwards.
    let result
    if (pivotTo) {
      const client = await getReadonlyPool().connect()
      try {
        await client.query('BEGIN')
        await client.query(`SET LOCAL app.claude_ro_owner = '${pivotTo}'`)
        result = await client.query(wrapped)
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        throw e
      } finally {
        client.release()
      }
    } else {
      result = await getReadonlyPool().query(wrapped)
    }

    const truncated = result.rows.length > MAX_ROWS
    const rows = truncated ? result.rows.slice(0, MAX_ROWS) : result.rows
    const durationMs = Date.now() - started

    const payload = JSON.stringify(rows)
    if (payload.length > MAX_BYTES) {
      await logQuery({ sql, rowCount: rows.length, durationMs, truncated, ok: false, error: 'payload too large', ip, pivotedTo: pivotTo })
      return NextResponse.json(
        { error: `Result too large (${Math.round(payload.length / 1e6)} MB) — narrow the SELECT or add a LIMIT` },
        { status: 413 },
      )
    }

    await logQuery({ sql, rowCount: rows.length, durationMs, truncated, ok: true, error: null, ip, pivotedTo: pivotTo })
    return NextResponse.json({
      rows,
      rowCount: rows.length,
      truncated,
      durationMs,
      fields: result.fields?.map(f => f.name) ?? [],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logQuery({ sql, rowCount: null, durationMs: Date.now() - started, truncated: false, ok: false, error: message, ip, pivotedTo: pivotTo })
    // The DB error text is the useful part (permission denied, syntax, timeout) and this route is
    // admin-only, so it is surfaced rather than swallowed.
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

/** Schema discovery — the readable views and their columns, so queries needn't be written blind. */
export async function GET(req: NextRequest) {
  const authed = await authorize(req)
  if (!authed.ok) return NextResponse.json({ error: authed.error }, { status: authed.status })
  if (!isReadonlyDbConfigured()) {
    return NextResponse.json({ error: 'Read-only database access is not configured' }, { status: 503 })
  }

  try {
    const { rows } = await getReadonlyPool().query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'claude_ro'
      ORDER BY table_name, ordinal_position
    `)
    const views: Record<string, { column: string; type: string }[]> = {}
    for (const r of rows) {
      ;(views[r.table_name] ??= []).push({ column: r.column_name, type: r.data_type })
    }
    return NextResponse.json({
      schema: 'claude_ro',
      connection: describeReadonlyConnection(),
      viewCount: Object.keys(views).length,
      views,
    })
  } catch (err) {
    reportServerError(err, { url: '/api/admin/db-query' })
    console.error('[admin/db-query] schema read failed:', err)
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      // Which connection was actually attempted — no password, just the identity — so a bad
      // CLAUDE_DB_READONLY_URL is diagnosable without another deploy.
      connection: describeReadonlyConnection(),
    }, { status: 500 })
  }
}
