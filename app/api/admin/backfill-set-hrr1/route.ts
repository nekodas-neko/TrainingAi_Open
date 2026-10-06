import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, toAestDateStr } from '@trainingai/shared/date-utils'
import { planHrr1Backfill, summariseHrr1Changes, type Hrr1Change } from '@trainingai/shared/workout/hrr1-backfill'
import { HRR60_ANCHOR_TOL_MS } from '@trainingai/shared/workout/hrr60'

/**
 * Fill `set_hr_stats.hrr1_bpm` for stored rows and rewrite `rest_adequate` from it (#2457, step 1
 * of #2299 v2). Every stored row is re-measured from the merged HR series with the dense rule
 * (`deriveHrr60`); a row the series cannot serve gets null in BOTH columns. That is the purpose:
 * old ring verdicts and shortcut-era `true`s clear, which the COALESCE upsert could never do.
 *
 * **This rewrites existing values, so it is a production data change.** Policy
 * (docs/rules/git-safety-and-packages.md): a verified snapshot — taken AND restored — first, then a
 * dry run whose counts are the prediction, then the real run, whose `written` must equal that
 * prediction (the repo write is one transaction and rolls back on a count mismatch).
 *
 * Admin-only, POST because it writes, `dryRun` unless `dryRun=false`. Scope: the caller's own rows,
 * full history. Reads `oura_heartrate` only; never touches the raw archive. Idempotent: a second
 * real run finds nothing to change. Rows older than the 180-day `oura_heartrate` retention have no
 * series left and therefore go to null — the dry run counts them under `noSeries`.
 */

/** How much series is fetched past the last set end in a session: the +60 s anchor and its tolerance. */
const WINDOW_TAIL_MS = 60_000 + HRR60_ANCHOR_TOL_MS
const SAMPLE_LIMIT = 50

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(userId, session.user?.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }
  if (!rateLimit(`${userId}:backfill-set-hrr1`, 4, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const raw = req.nextUrl.searchParams.get('dryRun')
  if (raw != null && raw !== 'true' && raw !== 'false') {
    return NextResponse.json({ error: '`dryRun` must be true or false' }, { status: 400 })
  }
  const dryRun = raw !== 'false'
  const tz = session.user?.timezone ?? DEFAULT_TZ

  const repo = await getRepositoryAsync()
  const rows = await repo.listSetHrStatsForHrr1Backfill(userId)

  const bySession = new Map<string, typeof rows>()
  for (const r of rows) {
    const list = bySession.get(r.workoutSessionId)
    if (list) list.push(r)
    else bySession.set(r.workoutSessionId, [r])
  }

  const changes: Hrr1Change[] = []
  let noSeries = 0
  let measured = 0
  for (const sessionRows of bySession.values()) {
    const ends = sessionRows.map(r => r.loggedAt?.getTime()).filter((t): t is number => t != null)
    const readings = ends.length
      ? await repo.getHrForWindow(
        userId,
        new Date(Math.min(...ends) - HRR60_ANCHOR_TOL_MS),
        new Date(Math.max(...ends) + WINDOW_TAIL_MS),
      )
      : []
    if (readings.length === 0) noSeries += sessionRows.length
    const planned = planHrr1Backfill(sessionRows, readings)
    changes.push(...planned)
    const afterById = new Map(planned.map(c => [c.setLogId, c.after.hrr1Bpm]))
    measured += sessionRows
      .filter(r => (afterById.has(r.setLogId) ? afterById.get(r.setLogId) : r.hrr1Bpm) != null).length
  }

  const written = dryRun
    ? 0
    : await repo.writeSetHrr1(userId, changes.map(c => ({ setLogId: c.setLogId, ...c.after })))

  const days = new Set(changes.filter(c => c.loggedAt).map(c => toAestDateStr(c.loggedAt!, tz)))

  return NextResponse.json({
    dryRun,
    timezone: tz,
    generatedAt: new Date().toISOString(),
    summary: {
      rowsExamined: rows.length,
      sessionsExamined: bySession.size,
      rowsWithHrr1After: measured,
      rowsWithNoSeries: noSeries,
      ...summariseHrr1Changes(changes),
      daysChanged: days.size,
      written,
    },
    sample: changes.slice(0, SAMPLE_LIMIT).map(c => ({
      setLogId: c.setLogId, loggedAt: c.loggedAt?.toISOString() ?? null, before: c.before, after: c.after,
    })),
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
