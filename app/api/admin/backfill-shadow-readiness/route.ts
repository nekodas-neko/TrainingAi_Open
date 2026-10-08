import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { reportServerError } from '@/lib/observability'
import { replayShadowReadiness } from '@/lib/health/shadow-readiness-service'
import { DEFAULT_TZ, todayInTz, normalizeDateParamIso, shiftDateStr, daysBetweenDateStrs } from '@trainingai/shared/date-utils'
import { SHADOW_MODEL_VERSION } from '@trainingai/shared/health/shadow-readiness/model'

/**
 * Back-fill the shadow readiness table across past days (issue 2636, follow-up to #2377).
 *
 * `shadow_readiness` only gains a row when the daily step runs, so a freshly released model starts
 * its comparison with the first day after release. This replays past days from stored history
 * through `replayShadowReadiness` (`computed_by = 'replay'`), which is the same scorer the daily
 * step uses. It writes ONLY `shadow_readiness`: nothing a user sees, nothing that scores a day for
 * them, and no other table.
 *
 * Admin session only (no bearer token). POST because it writes. Owner-run: snapshot first, dry run,
 * then `dryRun=false` (docs/admin-actions.md). Today is never replayed: it belongs to the daily
 * step and its live score is still moving. A replay replaces a same-version row for the same day
 * (the table's own upsert), and never another version's; the dry run reports how many that is.
 */

/** Hard ceiling per request. A longer history is back-filled by paging through several calls. */
const MAX_RANGE_DAYS = 31

// Shape only; the calendar check and the `-` / `/` normalisation happen below.
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

  // Each call scores up to 31 days, each with a calorie-budget computation.
  if (!rateLimit(`${userId}:backfill-shadow-readiness`, 4, 60_000)) {
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
  // The service clamps to yesterday as well; clamping here too keeps the report honest about it.
  const last = end > yesterday ? yesterday : end

  try {
    const repo = await getRepository()
    const existing = start > last
      ? []
      : await repo.getShadowReadiness(userId, start, last, SHADOW_MODEL_VERSION)
    const result = await replayShadowReadiness(userId, start, last, { tz, write: !dryRun })
    const scored = result.rows.filter(r => r.shadowReadiness != null).length
    return NextResponse.json({
      from: start,
      to: last,
      requestedTo: end,
      timezone: tz,
      dryRun,
      modelVersion: SHADOW_MODEL_VERSION,
      generatedAt: new Date().toISOString(),
      summary: {
        daysExamined: result.rows.length,
        scored,
        unscored: result.rows.length - scored,
        // Rows already at this model version that a write would replace.
        wouldReplace: existing.length,
        written: result.written,
      },
      days: result.rows.map(r => ({
        date: r.date,
        shadowReadiness: r.shadowReadiness,
        liveReadiness: r.liveReadiness,
        maturityStage: r.maturityStage,
      })),
    })
  } catch (err) {
    reportServerError(err, { userId, url: 'admin/backfill-shadow-readiness' })
    return NextResponse.json({ error: 'Back-fill failed' }, { status: 500 })
  }
}
