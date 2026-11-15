import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { reportServerError } from '@/lib/observability'
import { heartHealthRescoreReport } from '@/lib/health/heart-health-rescore-report'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

/**
 * Re-score past heart-health days under the measured-minutes rule (issue 2093; floor moved to
 * moderate effort, 40% of reserve, by issue 2746).
 *
 * Until 2093 a prescription completed only when an activity was started from it, so past days with
 * a walk on them stayed `pending`. This applies `heartHealthRescore` (the same rule the device uses
 * for this week) to the admin's own stored rows: a `pending` day whose activities reached the
 * prescribed minutes at moderate effort or above becomes `completed`, linked to the credited activity. A
 * completed row is never taken back and a skipped one is never touched. It writes only
 * `prescribed_runs.status`, `activity_log_id` and `completed_as`, every value derived here.
 *
 * Admin session only, own rows only. POST because it writes. Owner-run: snapshot first, dry run,
 * then `dryRun=false` (docs/admin-actions.md). Today is left to the device, which records it as
 * the minutes arrive.
 */

const DATE = z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/)
const QuerySchema = z.object({
  from: DATE,
  to: DATE,
  dryRun: z.enum(['true', 'false']).optional(),
}).strict()

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(userId, session.user?.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  // Each call reads the heart-rate series under every activity in up to 31 days.
  if (!rateLimit(`${userId}:backfill-heart-health`, 4, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const parsed = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Expected from and to as YYYY-MM-DD or YYYY/MM/DD, and dryRun=true|false' }, { status: 400 })
  }

  // Fail closed on the write: only an explicit `dryRun=false` commits.
  const dryRun = parsed.data.dryRun !== 'false'
  const tz = session.user?.timezone ?? DEFAULT_TZ

  try {
    const repo = await getRepository()
    const result = await heartHealthRescoreReport(repo, userId, tz, parsed.data.from, parsed.data.to, dryRun)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result.report)
  } catch (err) {
    reportServerError(err, { userId, url: 'admin/backfill-heart-health' })
    return NextResponse.json({ error: 'Back-fill failed' }, { status: 500 })
  }
}
