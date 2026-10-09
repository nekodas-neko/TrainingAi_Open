import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { reportServerError } from '@/lib/observability'
import { rescoreHeartHealth } from '@/lib/health/heart-health-service'
import { DEFAULT_TZ, todayInTz, normalizeDateParamIso, shiftDateStr, daysBetweenDateStrs } from '@trainingai/shared/date-utils'

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

/** Hard ceiling per request. A longer history is re-scored by paging through several calls. */
const MAX_RANGE_DAYS = 31

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
  const start = parsed.success ? normalizeDateParamIso(parsed.data.from) : null
  const end = parsed.success ? normalizeDateParamIso(parsed.data.to) : null
  if (!parsed.success || !start || !end) {
    return NextResponse.json({ error: 'Expected from and to as YYYY-MM-DD or YYYY/MM/DD, and dryRun=true|false' }, { status: 400 })
  }
  if (end < start) {
    return NextResponse.json({ error: '`to` must not precede `from`' }, { status: 400 })
  }
  const span = daysBetweenDateStrs(start, end) + 1
  if (span > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `Range too wide — ${span} days requested, ${MAX_RANGE_DAYS} is the maximum` },
      { status: 400 },
    )
  }

  // Fail closed on the write: only an explicit `dryRun=false` commits.
  const dryRun = parsed.data.dryRun !== 'false'

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const yesterday = shiftDateStr(todayInTz(tz), -1)
  const last = end > yesterday ? yesterday : end

  try {
    const repo = await getRepository()
    const result = start > last
      ? { days: [], changes: [], written: 0 }
      : await rescoreHeartHealth(repo, userId, tz, start, last, { write: !dryRun })
    const count = (pred: (d: (typeof result.days)[number]) => boolean) => result.days.filter(pred).length
    return NextResponse.json({
      from: start,
      to: last,
      requestedTo: end,
      timezone: tz,
      dryRun,
      generatedAt: new Date().toISOString(),
      summary: {
        daysExamined: result.days.length,
        // The headline the PR and the owner check against: how many past days move.
        wouldComplete: result.changes.length,
        written: result.written,
        alreadyCompleted: count((d) => d.status === 'completed'),
        pendingNotMet: count((d) => d.status === 'pending' && !d.met),
        // Reported, never written: a skip was the user's choice.
        skippedThatMet: count((d) => d.status === 'skipped' && d.met),
        noHeartRate: count((d) => d.activities.length > 0 && d.activities.every((a) => a.effortMin == null)),
      },
      changes: result.changes,
      days: result.days.map((d) => ({
        date: d.date,
        status: d.status,
        targetMin: d.targetMin,
        countedMin: d.countedMin,
        met: d.met,
        activities: d.activities.map((a) => ({ title: a.title, activityType: a.activityType, durationMin: a.durationMin, effortMin: a.effortMin })),
      })),
    })
  } catch (err) {
    reportServerError(err, { userId, url: 'admin/backfill-heart-health' })
    return NextResponse.json({ error: 'Back-fill failed' }, { status: 500 })
  }
}
