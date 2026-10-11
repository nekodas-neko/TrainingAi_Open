import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { recomputeHrr1Best } from '@/lib/workout/recompute-hrr1-best'

/**
 * Recompute `workout_hr_stats.hrr1_best` from the sessions' HRR60 (#2601, owner approved 2026-10-07).
 * The work is `recomputeHrr1Best` (`lib/workout/recompute-hrr1-best.ts`), shared with the agent key's
 * `recompute-hrr1-best` job; this route is the admin-session door.
 *
 * Admin-only, POST because it writes, `dryRun` unless `dryRun=false`, the caller's own sessions only.
 * It overwrites stored values: a verified snapshot first, and `backfill-set-hrr1` before it
 * (docs/admin-actions.md section 12).
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(userId, session.user?.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }
  if (!rateLimit(`${userId}:recompute-hrr1-best`, 4, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const raw = req.nextUrl.searchParams.get('dryRun')
  if (raw != null && raw !== 'true' && raw !== 'false') {
    return NextResponse.json({ error: '`dryRun` must be true or false' }, { status: 400 })
  }
  const dryRun = raw !== 'false'
  const tz = session.user?.timezone ?? DEFAULT_TZ

  const result = await recomputeHrr1Best({ userId, tz, dryRun })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } })
  return NextResponse.json(result.report, { headers: { 'Cache-Control': 'private, no-store' } })
}
