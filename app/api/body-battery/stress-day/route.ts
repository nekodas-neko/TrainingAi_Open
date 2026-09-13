import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, normalizeDateParam } from '@trainingai/shared/date-utils'
import { fromZonedTime } from 'date-fns-tz'
import { rateLimit } from '@/lib/rate-limit'
import { reportServerError } from '@/lib/observability'

/**
 * The day's stress series, read back from storage (LB-102).
 *
 * `/api/body-battery` takes no parameters — `GET()` — and computes its series live from today's ring
 * dHRV. TN-3a's `oura_daytime_stress_buckets` has persisted 30-minute buckets since 2026-08-24 and
 * **nothing published them**, so a past day was unreachable from any surface. That blocked TN-3b's
 * owner-approved pass test, which is *"open a past day, read a stressed window off the axis, and say
 * whether it matches what you were doing"* — his recall being the ground truth, since TN-33 found no
 * independent target with variance (`perceived_recovery` reads 3 on all 17 days).
 *
 * **A sibling route rather than a `?date=` on the battery route, and the reason is not tidiness.**
 * The battery response is a live model anchored to `now` — the HR walk, the reserve, the label — and
 * none of it can be computed for a finished day. A parameter that changed the response's SHAPE is
 * the kind of thing that reads as one endpoint and behaves as two.
 *
 * **⚠ This series and `/api/body-battery`'s are built from DIFFERENT BASELINES, and that is
 * deliberate upstream.** The rollup writes these from `latest.rhrLowBpm` + `nightHrvMs`; the live
 * route builds its own from `restingHr` + a 28-day HRV mean. TN-3a chose to persist only the
 * rollup's — *"persisting both would put two numbers behind one metric"* — because it is the only
 * path that can reach history. So this route serves the stored series for **every** day, today
 * included, rather than special-casing today to the live one: one chart, one baseline, days that are
 * comparable with each other. Today's stored series therefore ends at the last rollup rather than at
 * this minute, which is the honest cost of that choice and is why `throughMs` is reported.
 */
export interface StressDayResponse {
  date: string
  /** 30-minute buckets, ascending. `level` is [−1,+1]; negative is stressed. */
  series: { t: number; level: number }[]
  /** Last bucket's start, or null when the day has none — a day the rollup has not reached yet. */
  throughMs: number | null
}

export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:stress-day`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const tz = session.user?.timezone ?? DEFAULT_TZ
  // `localDateString()` on the client emits `YYYY/MM/DD`, so the guard has to take both separators —
  // a dash-only check rejects every real request before the handler runs.
  const raw = req.nextUrl.searchParams.get('date')
  const norm = raw ? normalizeDateParam(raw) : todayInTz(tz).replace(/-/g, '/')
  if (!norm) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  const date = norm.replace(/\//g, '-')

  try {
    // The user's local day, not the server's. `fromZonedTime` is what `hr-day` uses for the same job.
    const [y, m, d] = date.split('-').map(Number)
    const from = fromZonedTime(new Date(y, m - 1, d, 0, 0, 0), tz)
    const to   = fromZonedTime(new Date(y, m - 1, d, 23, 59, 59), tz)

    const repo = await getRepositoryAsync()
    const rows = await repo.getOuraDaytimeStressBuckets(userId, from, to)

    // Ascending by query, but mapped without re-sorting on purpose: `toSegments` in the chart sorts
    // anyway, precisely because a day assembled from stored rows carries no ordering guarantee.
    const series = rows.map(r => ({ t: r.bucketStart.getTime(), level: r.level }))
    const body: StressDayResponse = {
      date,
      series,
      throughMs: series.length ? series[series.length - 1].t : null,
    }
    return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    reportServerError(err, { userId, url: '/api/body-battery/stress-day' })
    return NextResponse.json({ error: 'Stress day unavailable' }, { status: 500 })
  }
}
