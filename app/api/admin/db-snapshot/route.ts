import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getPool } from '@/lib/data/postgres/client'
import { getReadonlyPool, isReadonlyDbConfigured, describeReadonlyConnection } from '@/lib/data/postgres/readonly-client'
import { requireAdmin, adminFailureOutcome } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { safeCompare } from '@/lib/security/constant-time'
import { reportServerError } from '@/lib/observability'
import { clientIp } from '@trainingai/shared/http/client-ip'
import {
  readTableColumns, checkDrift, getPrimaryKeyColumns, streamTableRows,
  resolveRequestedTables, bulkWindowFor, quoteIdent,
} from '@/lib/export/db-snapshot'

/**
 * Admin DB snapshot: a prod-shaped copy of the owner's own data, for migration rehearsal and
 * `pnpm dev` realism (Q-530, docs/superpowers/plans/2026-08-17-admin-db-snapshot-endpoint.md).
 *
 * The sandbox that consumes this is the whole reason it exists — it reaches production over
 * 80/443 only (Railway's Postgres port is blocked by the network policy), so an HTTPS endpoint is
 * the sole transport into a session. The owner should use `pg_dump` directly
 * (docs/runbooks/db-backup-restore.md); this route is strictly worse for them (lower fidelity,
 * another secret) and exists for the consumer that cannot reach the database any other way.
 *
 * Read-only, GET-only, NDJSON with `Content-Disposition: attachment`. Reads `claude_ro` — the same
 * default-deny, per-user-scoped view schema `/api/admin/db-query` already reads — via a paginated
 * `SELECT *`, plus a drift gate that fails the export (not silently) if a table/column was added
 * without regenerating the views migration.
 *
 * Auth mirrors `app/api/admin/day-review/route.ts` exactly:
 *  1. `Authorization: Bearer <ADMIN_SNAPSHOT_SECRET>` — a SEPARATE secret from `ADMIN_EXPORT_SECRET`
 *     (day-review returns derived scores; this returns the database), rate-limited per IP before the
 *     compare, `safeCompare`, identical 401 for a trip and a bad token.
 *  2. An admin session cookie, same as day-review.
 * Both `ADMIN_SNAPSHOT_SECRET` and `ADMIN_EXPORT_USER_ID` (falling back to `WEBHOOK_USER_ID`) must
 * be set for the bearer path, or it is disabled — never skipped. The resolved user must still pass
 * `requireAdmin`; the token widens transport, never authority.
 */

const CHUNK_SIZE = 5_000

type AuthOutcome =
  | { ok: true; via: 'session' | 'token' }
  | { ok: false; status: number; error: string }

async function authorize(req: NextRequest): Promise<AuthOutcome> {
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (bearer) {
    const ip = clientIp(req)
    if (!rateLimit(`db-snapshot-token:${ip}`, 10, 60_000)) {
      return { ok: false, status: 401, error: 'Unauthorized' }
    }
    const expected = process.env.ADMIN_SNAPSHOT_SECRET
    const exportUserId = process.env.ADMIN_EXPORT_USER_ID ?? process.env.WEBHOOK_USER_ID
    if (!expected || !exportUserId || !safeCompare(bearer, expected)) {
      return { ok: false, status: 401, error: 'Unauthorized' }
    }
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

/** Best-effort audit row. A logging failure must never change the response — same pattern as
 *  /api/admin/db-query, and the reason the plan's §6 mitigations name an audit trail at all. */
async function logSnapshot(entry: { tables: string[]; bulk: string | null; ip: string; ok: boolean; error: string | null }) {
  try {
    await getPool().query(
      `INSERT INTO db_query_log (sql_text, row_count, duration_ms, truncated, ok, error, caller_ip)
       VALUES ($1, NULL, 0, false, $2, $3, $4)`,
      [`SNAPSHOT tables=${entry.tables.join(',')} bulk=${entry.bulk ?? '0'}`, entry.ok, entry.error, entry.ip],
    )
  } catch (err) {
    console.error('[admin/db-snapshot] audit log write failed:', err)
  }
}

export async function GET(req: NextRequest) {
  const authed = await authorize(req)
  if (!authed.ok) return NextResponse.json({ error: authed.error }, { status: authed.status })

  // Fail closed: no read-only connection configured means the feature is off, not open.
  if (!isReadonlyDbConfigured()) {
    return NextResponse.json({ error: 'Read-only database access is not configured' }, { status: 503 })
  }

  const ip = clientIp(req)
  const q = req.nextUrl.searchParams
  const bulk = q.get('bulk')
  const tablesParam = q.get('tables')
  const pool = getReadonlyPool()

  let cols
  try {
    cols = await readTableColumns(pool)
    checkDrift(cols)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    reportServerError(err, { url: '/api/admin/db-snapshot' })
    await logSnapshot({ tables: [], bulk, ip, ok: false, error: message })
    return NextResponse.json({
      error: 'Failed to prepare the snapshot',
      connection: describeReadonlyConnection(),
    }, { status: 500 })
  }

  const { toExport, omitted } = resolveRequestedTables(cols, tablesParam, bulk)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const push = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      try {
        // Manifest first — snapshot time, view count, per-table row counts (from the request's own
        // read, not a cached estimate), the resolved bulk window, and every omitted table with why.
        // A consumer must never have to infer completeness from what happens to be in the file.
        const rowCounts: Record<string, number | null> = {}
        for (const table of toExport) {
          try {
            const { rows } = await pool.query(`SELECT count(*)::int AS n FROM claude_ro.${quoteIdent(table)}`)
            rowCounts[table] = rows[0]?.n ?? null
          } catch {
            rowCounts[table] = null
          }
        }
        push({
          manifest: true,
          snapshotAt: new Date().toISOString(),
          viewCount: cols.views.size,
          tables: toExport,
          rowCounts,
          bulk: bulk ?? '0',
          omitted,
        })

        for (const table of toExport) {
          const pk = await getPrimaryKeyColumns(pool, table)
          const since = bulkWindowFor(table, bulk)
          let n = 0
          for await (const row of streamTableRows(pool, table, pk, CHUNK_SIZE, since ?? undefined)) {
            push({ table, row })
            n++
          }
          push({ tableComplete: table, rowCount: n })
        }
        await logSnapshot({ tables: toExport, bulk, ip, ok: true, error: null })
        controller.close()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        reportServerError(err, { url: '/api/admin/db-snapshot' })
        await logSnapshot({ tables: toExport, bulk, ip, ok: false, error: message })
        push({ error: 'Snapshot failed part-way through — see server logs' })
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Content-Disposition': 'attachment; filename="db-snapshot.ndjson"',
      'Cache-Control': 'private, no-store',
    },
  })
}
