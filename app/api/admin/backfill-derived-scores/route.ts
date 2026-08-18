import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz, normalizeDateParamIso, shiftDateStr, daysBetweenDateStrs } from '@trainingai/shared/date-utils'
import { buildDayAudit } from '@trainingai/shared/health/score-audit/build-day-audit'

/**
 * Backfill the persisted Sleep and Readiness scores across history (audit finding F-2).
 *
 * `oura_daily_derived` only ever gained a score as a side effect of loading `/api/readiness-score`,
 * which writes today and nothing else — 12 of 70 rows carried one, so any calibration analysis over
 * that table was working from a 21% sample. This recomputes each day through `buildDayAudit` (the
 * same compute functions the live route serves from, no formula restated) and persists exactly the
 * values the live route would have written, via `PillarAudit.persist`.
 *
 * Admin-only. POST because it writes. Bounded and sequential — each day runs ~12 queries against a
 * `max: 10` pool, so fanning a range out concurrently would starve the rest of the app (the failure
 * mode that took production down in session 165).
 *
 * `dryRun` (the default) reports what WOULD change without writing, so a range can be inspected
 * before it is committed.
 */

/** Hard ceiling per request. A longer history is backfilled by paging through several calls. */
const MAX_RANGE_DAYS = 31
const DEFAULT_RANGE_DAYS = 31

interface DayOutcome {
  date: string
  sleep: { stored: number | null; recomputed: number | null; action: 'written' | 'unchanged' | 'no-score' }
  readiness: { stored: number | null; recomputed: number | null; action: 'written' | 'unchanged' | 'no-score' }
  error?: string
}

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(userId, session.user?.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  // Deliberately tighter than the read routes' 20/min: each call can run ~370 queries.
  if (!rateLimit(`${userId}:backfill-derived-scores`, 4, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const q = req.nextUrl.searchParams
  const parse = (raw: string | null) => (raw ? normalizeDateParamIso(raw) : null)
  const from = parse(q.get('from'))
  const to = parse(q.get('to'))
  if ((q.get('from') && !from) || (q.get('to') && !to)) {
    return NextResponse.json({ error: 'Invalid date — expected YYYY-MM-DD or YYYY/MM/DD' }, { status: 400 })
  }

  // Fail closed on the write: only an explicit `dryRun=false` commits.
  const dryRun = q.get('dryRun') !== 'false'

  const end = to ?? todayInTz(tz)
  const start = from ?? shiftDateStr(end, -(DEFAULT_RANGE_DAYS - 1))
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

  const repo = await getRepository()
  const days: DayOutcome[] = []

  for (let d = start; d <= end; d = shiftDateStr(d, 1)) {
    try {
      const audit = await buildDayAudit({ repo, userId, date: d, tz })
      const pillar = (key: 'sleep' | 'readiness') => audit.pillars.find(p => p.pillar === key) ?? null

      const outcome: DayOutcome = {
        date: d,
        sleep: { stored: null, recomputed: null, action: 'no-score' },
        readiness: { stored: null, recomputed: null, action: 'no-score' },
      }

      const sleep = pillar('sleep')
      const readiness = pillar('readiness')
      outcome.sleep.stored = (sleep?.stored.score ?? null)
      outcome.readiness.stored = (readiness?.stored.score ?? null)
      outcome.sleep.recomputed = sleep?.persist?.score ?? null
      outcome.readiness.recomputed = readiness?.persist?.score ?? null

      // Two separate upserts with disjoint column sets, mirroring the live route: the shared
      // `source`/`model_versions` columns are replaced wholesale by the upsert, so writing them
      // here would clobber body_comp/illness provenance on the same row.
      if (sleep?.persist) {
        outcome.sleep.action = outcome.sleep.stored === sleep.persist.score ? 'unchanged' : 'written'
        if (!dryRun && outcome.sleep.action === 'written') {
          await repo.upsertOuraDailyDerived(userId, d, {
            sleepScore: sleep.persist.score,
            sleepContributors: sleep.persist.contributors,
          })
        }
      }
      if (readiness?.persist) {
        outcome.readiness.action = outcome.readiness.stored === readiness.persist.score ? 'unchanged' : 'written'
        if (!dryRun && outcome.readiness.action === 'written') {
          await repo.upsertOuraDailyDerived(userId, d, {
            readinessScore: readiness.persist.score,
            readinessContributors: readiness.persist.contributors,
            readinessSource: 'ble-derived',
          })
        }
      }

      days.push(outcome)
    } catch (err) {
      // One unscoreable day must never abort the range — record it and carry on.
      console.error(`[backfill-derived-scores] ${d} failed:`, err)
      days.push({
        date: d,
        sleep: { stored: null, recomputed: null, action: 'no-score' },
        readiness: { stored: null, recomputed: null, action: 'no-score' },
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const count = (k: 'sleep' | 'readiness', a: DayOutcome['sleep']['action']) =>
    days.filter(x => x[k].action === a).length

  return NextResponse.json({
    from: start,
    to: end,
    timezone: tz,
    dryRun,
    generatedAt: new Date().toISOString(),
    summary: {
      daysExamined: days.length,
      failed: days.filter(d => d.error).length,
      sleep: { written: count('sleep', 'written'), unchanged: count('sleep', 'unchanged'), noScore: count('sleep', 'no-score') },
      readiness: { written: count('readiness', 'written'), unchanged: count('readiness', 'unchanged'), noScore: count('readiness', 'no-score') },
    },
    days,
  })
}
