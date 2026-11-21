import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { reportServerError } from '@/lib/observability'
import { DEFAULT_TZ, normalizeDateParamIso, shiftDateStr, daysBetweenDateStrs, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { replaySessionReads } from '@trainingai/shared/ai-periodization/session-read'
import { weightStepFor } from '@trainingai/shared/workout/load-rounding'

/**
 * The session read in shadow, replayed over past workouts (#3893, for #3889's decisions).
 *
 * For every readable exercise log of the admin's own workouts started in the range, it runs the
 * session read and asks: at that session's own first-set pct, would the next bar have differed from
 * today's rule, and which way. It answers COUNTS ONLY, per exercise name: no weights, reps or health
 * values leave.
 *
 * READ ONLY. There is no write: `dryRun=false` is refused, so the admin console's write step never
 * applies. Admin session only, 31 days per call, as the other admin replays.
 */

const MAX_RANGE_DAYS = 31

// Shape only; the calendar check and the `-` / `/` normalisation happen below.
const DATE = z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/)
const QuerySchema = z.object({
  from: DATE,
  to: DATE,
  dryRun: z.literal('true').optional(),
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

  if (!rateLimit(`${userId}:session-read-replay`, 4, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const parsed = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  const start = parsed.success ? normalizeDateParamIso(parsed.data.from) : null
  const end = parsed.success ? normalizeDateParamIso(parsed.data.to) : null
  if (!parsed.success || !start || !end) {
    return NextResponse.json(
      { error: 'Expected from and to as YYYY-MM-DD or YYYY/MM/DD. This job is a dry run only: dryRun may only be true.' },
      { status: 400 },
    )
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

  const tz = session.user?.timezone ?? DEFAULT_TZ
  try {
    const repo = await getRepository()
    const logs = await repo.getSessionReadLogs(
      userId, dateStrMidnightInTz(start, tz), dateStrMidnightInTz(shiftDateStr(end, 1), tz),
    )
    const equipment = await repo.getExerciseEquipment([...new Set(logs.map(l => l.exerciseName))])
    const { skipped, perExercise } = replaySessionReads(logs, name => weightStepFor(equipment[name]))
    const rows = Object.values(perExercise)
    const sum = (k: 'sessions' | 'notComparable' | 'sameNextWeight' | 'heavierNextWeight' | 'lighterNextWeight') =>
      rows.reduce((n, r) => n + r[k], 0)
    return NextResponse.json({
      from: start,
      to: end,
      timezone: tz,
      dryRun: true,
      generatedAt: new Date().toISOString(),
      summary: {
        exerciseLogs: logs.length,
        notReadable: skipped,
        read: sum('sessions'),
        notComparable: sum('notComparable'),
        sameNextWeight: sum('sameNextWeight'),
        heavierNextWeight: sum('heavierNextWeight'),
        lighterNextWeight: sum('lighterNextWeight'),
        // One line per exercise that would have moved, so the admin card can show it.
        changed: Object.fromEntries(
          Object.entries(perExercise)
            .filter(([, r]) => r.heavierNextWeight + r.lighterNextWeight > 0)
            .map(([name, r]) => [name, `${r.lighterNextWeight} lighter, ${r.heavierNextWeight} heavier of ${r.sessions}`]),
        ),
      },
      perExercise,
    })
  } catch (err) {
    reportServerError(err, { userId, url: 'admin/session-read-replay' })
    return NextResponse.json({ error: 'Replay failed' }, { status: 500 })
  }
}
