import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// A single tuning number (or a short note). The body is optional on all of these.
const MAX_BODY_BYTES = 4 * 1024

// Culling Lever 1b — DATA-DROPPING, admin-triggered only (never auto-run on deploy/migration).
// Nulls the `decoded` JSONB on oura_raw_samples rows written before Lever 1a (which stops writing
// it going forward). body_hex is untouched; every nulled row already falls back to decoding from
// body_hex (Lever 1a). Defaults to clearing the whole backlog in one call (owner-requested); still
// batched internally (500 rows/UPDATE) so no single statement risks the pool's statement_timeout.
// A resumable `maxRows` override is still accepted if a smaller/incremental pass is ever wanted.
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  // A batched full-table backfill pass — keep it rare, same posture as redecode.
  if (!rateLimit(`oura-ble-backfill-null-decoded:${session.user.id}`, 4, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let maxRows: number | undefined
  try {
    const read = await readJsonLimited(req, MAX_BODY_BYTES)
    if (!read.ok && read.reason === 'too_large') {
      return NextResponse.json({ error: 'Request too large' }, { status: 413 })
    }
    const n = read.ok ? (read.body as { maxRows?: unknown } | null)?.maxRows : undefined
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) maxRows = Math.min(n, 1_000_000)
  } catch {
    // no/invalid body — use the repo's default
  }

  const repo = await getRepositoryAsync()
  const result = await repo.nullHistoricalDecoded(session.user.id, maxRows)
  return NextResponse.json(result)
}
