import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { rederiveStylelessOneRm } from '@/lib/workout/rederive-styleless-one-rm'

/**
 * Re-derive the stored 1RMs of styleless working sets without the AMRAP discount (issue 2357,
 * owner-signed 2026-10-06). The work is `rederiveStylelessOneRm`
 * (`lib/workout/rederive-styleless-one-rm.ts`), shared with the agent key's
 * `rederive-styleless-one-rm` job; this route is the admin-session door to it.
 *
 * Admin-only, POST because it writes, `dryRun` unless `dryRun=false`, the caller's own logs only.
 * It overwrites stored 1RMs: a verified snapshot first (docs/admin-actions.md section 11).
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
  if (!rateLimit(`${userId}:rederive-styleless-one-rm`, 4, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const raw = req.nextUrl.searchParams.get('dryRun')
  if (raw != null && raw !== 'true' && raw !== 'false') {
    return NextResponse.json({ error: '`dryRun` must be true or false' }, { status: 400 })
  }
  const dryRun = raw !== 'false'
  const tz = session.user?.timezone ?? DEFAULT_TZ

  const repo = await getRepository()
  const result = await rederiveStylelessOneRm({ repo, userId, tz, dryRun })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } })
  return NextResponse.json(result.report, { headers: { 'Cache-Control': 'private, no-store' } })
}
