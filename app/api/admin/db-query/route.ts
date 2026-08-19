import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getPool } from '@/lib/data/postgres/client'
import { getReadonlyPool, isReadonlyDbConfigured, describeReadonlyConnection } from '@/lib/data/postgres/readonly-client'
import { requireAdmin, adminFailureOutcome } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { safeCompare } from '@/lib/security/constant-time'
import { reportServerError } from '@/lib/observability'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

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
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
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
}) {
  try {
    await getPool().query(
      `INSERT INTO db_query_log (sql_text, row_count, duration_ms, truncated, ok, error, caller_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entry.sql.slice(0, 20_000), entry.rowCount, entry.durationMs, entry.truncated, entry.ok, entry.error, entry.ip],
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

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const started = Date.now()

  try {
    // Wrapping in a subquery bounds ANY submitted query without parsing it. MAX_ROWS + 1 detects
    // truncation rather than silently returning a capped set as if it were complete.
    const wrapped = `SELECT * FROM (${sql.replace(/;\s*$/, '')}) _q LIMIT ${MAX_ROWS + 1}`
    const result = await getReadonlyPool().query(wrapped)

    const truncated = result.rows.length > MAX_ROWS
    const rows = truncated ? result.rows.slice(0, MAX_ROWS) : result.rows
    const durationMs = Date.now() - started

    const payload = JSON.stringify(rows)
    if (payload.length > MAX_BYTES) {
      await logQuery({ sql, rowCount: rows.length, durationMs, truncated, ok: false, error: 'payload too large', ip })
      return NextResponse.json(
        { error: `Result too large (${Math.round(payload.length / 1e6)} MB) — narrow the SELECT or add a LIMIT` },
        { status: 413 },
      )
    }

    await logQuery({ sql, rowCount: rows.length, durationMs, truncated, ok: true, error: null, ip })
    return NextResponse.json({
      rows,
      rowCount: rows.length,
      truncated,
      durationMs,
      fields: result.fields?.map(f => f.name) ?? [],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logQuery({ sql, rowCount: null, durationMs: Date.now() - started, truncated: false, ok: false, error: message, ip })
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
