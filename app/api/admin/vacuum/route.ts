import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { VACUUM_FULL_TABLES, type VacuumFullTable } from '@/lib/data/postgres/slices/oura'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One table name. 4 KB is generous.
const MAX_BODY_BYTES = 4 * 1024

// Q-315 — admin-triggered `VACUUM FULL` on an allowlisted table.
//
// Generalised from the `oura_raw_samples`-only button because the same operation is now wanted in
// three places: after Q-541's packing backfill deletes the hot rows, after migration 193's index
// drop, and on `error_events` — which holds **4 live rows in 49 MB** (measured 2026-08-18), 6% of
// the whole database, left behind when Q-539 fixed the write path and the rows were pruned. MVCC
// frees dead tuples logically; only a rewrite returns the space to the OS.
//
// GET lists what may be vacuumed and its current size, so the reclaim can be read before and after.
//
// The table name is interpolated into the statement — `VACUUM` accepts no bind parameter — so the
// allowlist in `VACUUM_FULL_TABLES` is the safety boundary. A name outside it is rejected here and
// again in the slice.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }
  return NextResponse.json(
    { tables: Object.entries(VACUUM_FULL_TABLES).map(([table, what]) => ({ table, what })) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  // Whole-table maintenance holding an ACCESS EXCLUSIVE lock — keep it rare and deliberate.
  if (!rateLimit(`admin-vacuum:${session.user.id}`, 4, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // The allowlist below is the real guard — VACUUM takes no bind parameter — so an unreadable body
  // still falls through to it rather than short-circuiting here.
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok && read.reason === 'too_large') {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  }
  const raw = read.ok ? (read.body as { table?: unknown } | null)?.table : undefined
  const table = typeof raw === 'string' ? raw : undefined
  if (typeof table !== 'string' || !Object.prototype.hasOwnProperty.call(VACUUM_FULL_TABLES, table)) {
    return NextResponse.json(
      { error: 'Unknown table', allowed: Object.keys(VACUUM_FULL_TABLES) },
      { status: 400 },
    )
  }

  try {
    const repo = await getRepositoryAsync()
    const result = await repo.vacuumTableFull(table as VacuumFullTable)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    // A VACUUM FULL needs free disk equal to the table's current size, so "it failed" and "there was
    // nothing to reclaim" are very different answers and must not both read as a 200.
    console.error('[admin] vacuum full failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'vacuum failed' },
      { status: 500 },
    )
  }
}
