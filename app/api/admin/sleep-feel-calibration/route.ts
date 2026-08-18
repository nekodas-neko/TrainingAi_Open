import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz, normalizeDateParamIso, shiftDateStr, daysBetweenDateStrs } from '@trainingai/shared/date-utils'
import { computeSleepScoreSeries } from '@trainingai/shared/health/sleep-score'
import { nightSessions } from '@trainingai/shared/health/sleep-night'
import { buildSleepFeelCalibration } from '@trainingai/shared/health/sleep-feel-calibration'
import { reportServerError } from '@/lib/observability'

/**
 * Admin sleep-feel calibration: the model's Sleep Score for each night next to the rating the owner
 * gave the following morning, plus how well the two agree over the window.
 *
 * Read-only, GET-only, admin session required. Owner decision on audit finding Q-16 —
 * `sleep_quality_feel` stays out of the Sleep Score and is a record to tune the curves against.
 *
 * Scores are recomputed by the real scorer over the resolved nights (never read from
 * `oura_daily_derived`, which only carries a persisted score for a minority of days — finding F-2).
 */

/** Widest window a single request may cover. */
const MAX_RANGE_DAYS = 180
const DEFAULT_RANGE_DAYS = 60
/**
 * Extra history fetched before `from` so the earliest night in the window is scored against real
 * baselines. The HRV/HR/schedule contributors need 7 prior nights, and the baselines themselves are
 * built from a 28-day trailing window — scoring the requested window in isolation would strip those
 * contributors off its first nights and understate the model's spread.
 */
const BASELINE_LEAD_IN_DAYS = 28

export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(userId, session.user?.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  if (!rateLimit(`${userId}:sleep-feel-calibration`, 20, 60_000)) {
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

  // `days=N` is the shorthand the admin card uses; explicit from/to always wins.
  const rawDays = Number(q.get('days'))
  const days = Number.isFinite(rawDays) && rawDays >= 1
    ? Math.min(Math.floor(rawDays), MAX_RANGE_DAYS)
    : DEFAULT_RANGE_DAYS

  const end = to ?? todayInTz(tz)
  const start = from ?? shiftDateStr(end, -(days - 1))
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

  try {
    const repo = await getRepository()
    const [sleepRows, checkins] = await Promise.all([
      repo.listSleepSessions(userId, shiftDateStr(start, -BASELINE_LEAD_IN_DAYS), end),
      repo.listDayCheckins(userId, start, end, 'morning'),
    ])

    // Naps are excluded and fragmented nights reassembled before scoring — the same night selection
    // the readiness route and the day audit use (findings F-1/Q-1).
    const nights = nightSessions(sleepRows, tz)
    const scoresByDate = new Map<string, number | null>(
      computeSleepScoreSeries(nights, tz).map(r => [r.session.date, r.result?.score ?? null]),
    )
    const feelByDate = new Map<string, number | null>(
      checkins.map(c => [c.logDate, c.sleepQualityFeel]),
    )

    return NextResponse.json(
      { timezone: tz, generatedAt: new Date().toISOString(), ...buildSleepFeelCalibration({ from: start, to: end, scoresByDate, feelByDate }) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (err) {
    reportServerError(err, { userId, url: '/api/admin/sleep-feel-calibration' })
    console.error('[admin/sleep-feel-calibration] failed:', err)
    return NextResponse.json(
      { error: 'Failed to build the calibration', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
