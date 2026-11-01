import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/data/postgres/client'
import { getReadonlyPool, isReadonlyDbConfigured, describeReadonlyConnection, runScoped } from '@/lib/data/postgres/readonly-client'
import { authorizeAdminRequest } from '@/lib/admin/claude-token-auth'
import { reportServerError } from '@/lib/observability'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { clientIp } from '@trainingai/shared/http/client-ip'
import { isUuid } from '@trainingai/shared/validation/uuid'
import { z } from 'zod'

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
 * **Scope.** A query runs as the owner (the role's `app.claude_ro_owner`) unless the body also names
 * `userId`, which re-scopes the views to that user for that one query — so the triaging agent can
 * read the data of someone who filed feedback (#2119). The owner asked for exactly that and no more,
 * so `userId` is honoured only for a user with a `feedback_submissions` row; every other value —
 * malformed, unknown, or a user who never filed — gets the same 404 body, so the route does not say
 * which ids exist. A named scope never falls back to the owner or to anything unscoped: it is applied
 * or the query does not run. Each pivoted query records the user in `db_query_log.scoped_user_id`,
 * and that row is written BEFORE the query runs: if it cannot be written the route answers 503 and
 * runs nothing, because another user's data must never leave without a trace. (An owner query's
 * audit row stays best-effort and is written after.) An explicit `userId: null` is refused like any
 * other bad value; only an absent `userId` means the owner.
 *
 * **What the scope limit is — and is not.** The feedback-only rule stops an accidental cross-user
 * read. It does not stop a deliberate one: per #3360 a hand-written SELECT can re-scope itself with
 * `set_config`, so anyone holding the token can read any user. Closing that is the owner's decision
 * (#3360), not something this route claims to do.
 *
 * Disabled unless BOTH `CLAUDE_DB_QUERY_SECRET` and `CLAUDE_DB_READONLY_URL` are set — unset either
 * and the route rejects, never skips the check.
 */

const bodySchema = z.object({ sql: z.string(), userId: z.unknown().optional() }).strict()

/** Rows returned to the caller; one extra is fetched to detect truncation. */
const MAX_ROWS = 1000
/** Serialised-payload ceiling, so a wide SELECT can't return tens of megabytes. */
const MAX_BYTES = 5_000_000

/** The shared admin authorisation (session, or the Claude token resolving to an admin). The rate
 *  key prefix is this route's own, unchanged from before the helper existed. */
const authorize = (req: NextRequest) => authorizeAdminRequest(req, 'db-query-token')

/** Best-effort audit row. A logging failure must never change the response. */
async function logQuery(entry: {
  sql: string; rowCount: number | null; durationMs: number
  truncated: boolean; ok: boolean; error: string | null; ip: string; scopedUserId?: string | null
}) {
  try {
    await getPool().query(
      `INSERT INTO db_query_log (sql_text, row_count, duration_ms, truncated, ok, error, caller_ip, scoped_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entry.sql.slice(0, 20_000), entry.rowCount, entry.durationMs, entry.truncated, entry.ok, entry.error, entry.ip, entry.scopedUserId ?? null],
    )
  } catch (err) {
    console.error('[admin/db-query] audit log write failed:', err)
  }
}

/**
 * The audit row for a scoped read, written before the query. It starts as a not-ok "started" row so
 * a crash between here and the answer still leaves the trace; {@link finishScopedLog} fills in the
 * outcome. Throws on failure — the caller turns that into a 503 and runs nothing.
 */
async function startScopedLog(entry: { sql: string; ip: string; scopedUserId: string }): Promise<string | null> {
  const { rows } = await getPool().query(
    `INSERT INTO db_query_log (sql_text, row_count, duration_ms, truncated, ok, error, caller_ip, scoped_user_id)
     VALUES ($1, NULL, NULL, false, false, 'started', $2, $3)
     RETURNING id`,
    [entry.sql.slice(0, 20_000), entry.ip, entry.scopedUserId],
  )
  return rows[0]?.id ?? null
}

/** Records how a scoped read ended. Best-effort: the row already exists, so a failure here only
 *  leaves it saying "started". */
async function finishScopedLog(id: string | null, outcome: {
  rowCount: number | null; durationMs: number; truncated: boolean; ok: boolean; error: string | null
}) {
  if (!id) return
  try {
    await getPool().query(
      `UPDATE db_query_log SET row_count = $2, duration_ms = $3, truncated = $4, ok = $5, error = $6 WHERE id = $1`,
      [id, outcome.rowCount, outcome.durationMs, outcome.truncated, outcome.ok, outcome.error],
    )
  } catch (err) {
    console.error('[admin/db-query] audit log update failed:', err)
  }
}

/** The one body every refused scope gets, whatever the reason, so it can't be used to probe for ids. */
const scopeNotFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

/** True when the user has filed feedback — the only users the agent may read as (#2119). */
async function hasFeedback(userId: string): Promise<boolean> {
  const { rows } = await getPool().query(
    'SELECT 1 FROM feedback_submissions WHERE user_id = $1 LIMIT 1',
    [userId],
  )
  return rows.length > 0
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

  // `userId` stays `unknown` on purpose: its refusals (including null) are one 404 body below, not a
  // 400 from the schema, so a bad value can't be told apart from an unknown user.
  const parsed = bodySchema.safeParse(read.body ?? {})
  if (!parsed.success || !parsed.data.sql.trim()) {
    return NextResponse.json({ error: 'Body must be { sql: string }' }, { status: 400 })
  }
  const { sql, userId } = parsed.data
  // One statement per request. The role already makes multi-statement harmless, but this keeps the
  // audit log honest — one logged row must correspond to exactly one executed query.
  if (sql.replace(/;\s*$/, '').includes(';')) {
    return NextResponse.json({ error: 'Only a single statement per request' }, { status: 400 })
  }

  const ip = clientIp(req)
  const started = Date.now()

  // Absent means the owner scope. Present — null included — means a named user or a refusal: an id
  // that is not a uuid, not a user, or not a user with feedback is never quietly run as the owner,
  // because the caller would read the owner's rows believing they were that user's.
  let scopedUserId: string | undefined
  let scopedLogId: string | null = null
  if (userId !== undefined) {
    const requested = isUuid(userId) ? userId.toLowerCase() : null
    let allowed = false
    if (requested) {
      try {
        allowed = await hasFeedback(requested)
      } catch (err) {
        console.error('[admin/db-query] scope check failed:', err)
        return NextResponse.json({ error: 'Could not verify the requested scope' }, { status: 503 })
      }
    }
    if (!allowed) {
      await logQuery({
        sql, rowCount: null, durationMs: 0, truncated: false, ok: false, ip,
        error: requested ? `scope refused: ${requested}` : 'scope refused: not a uuid',
      })
      return scopeNotFound()
    }
    scopedUserId = requested!
    try {
      scopedLogId = await startScopedLog({ sql, ip, scopedUserId })
    } catch (err) {
      console.error('[admin/db-query] scoped audit write failed, query not run:', err)
      return NextResponse.json({ error: 'Could not record the audit entry; nothing was run' }, { status: 503 })
    }
  }

  // An owner query logs after, best-effort; a scoped one already has its row and only finishes it.
  const record = (entry: Parameters<typeof logQuery>[0]) =>
    scopedUserId ? finishScopedLog(scopedLogId, entry) : logQuery(entry)

  try {
    // Wrapping in a subquery bounds ANY submitted query without parsing it. MAX_ROWS + 1 detects
    // truncation rather than silently returning a capped set as if it were complete.
    const wrapped = `SELECT * FROM (${sql.replace(/;\s*$/, '')}) _q LIMIT ${MAX_ROWS + 1}`
    // RV-190: through `runScoped`, never `pool.query`. The role's read-only flag, statement
    // timeout and owner scope are session DEFAULTS that a submitted query can simply `SET` — and
    // on a pool that is never reset, the override rode the connection into the next request.
    const result = await runScoped(getReadonlyPool(), wrapped, { ownerId: scopedUserId })

    const truncated = result.rows.length > MAX_ROWS
    const rows = truncated ? result.rows.slice(0, MAX_ROWS) : result.rows
    const durationMs = Date.now() - started

    const payload = JSON.stringify(rows)
    if (payload.length > MAX_BYTES) {
      await record({ sql, rowCount: rows.length, durationMs, truncated, ok: false, error: 'payload too large', ip, scopedUserId })
      return NextResponse.json(
        { error: `Result too large (${Math.round(payload.length / 1e6)} MB) — narrow the SELECT or add a LIMIT` },
        { status: 413 },
      )
    }

    await record({ sql, rowCount: rows.length, durationMs, truncated, ok: true, error: null, ip, scopedUserId })
    return NextResponse.json({
      rows,
      rowCount: rows.length,
      truncated,
      durationMs,
      fields: result.fields?.map(f => f.name) ?? [],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await record({ sql, rowCount: null, durationMs: Date.now() - started, truncated: false, ok: false, error: message, ip, scopedUserId })
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
    const { rows } = await runScoped(getReadonlyPool(), `
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
