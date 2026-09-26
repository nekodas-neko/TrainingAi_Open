import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { computeWeeklyDigestMetrics } from './metrics'
import { buildWeeklyDigestText } from '@trainingai/shared/health/weekly-digest-metrics'

/**
 * The completed week's recap — its numbers and the sentences about them.
 *
 * **A GET, where this used to be a POST (RV-201).** It was a POST because it ran a model and
 * cached the prose in a `ai_health_insights` row; both are gone. Every number here was already
 * computed deterministically before the model was ever called — the model only wrote sentences
 * about them — so rendering those sentences in code costs less than the round-trip that read them
 * back, and, unlike the model, works with the network off.
 *
 * The method is the point, not a tidy-up: `cachedFetch` only caches GETs, so while this was a
 * POST the week page's charts had no offline copy to paint from and the whole screen showed its
 * error state with the radio off. There is deliberately no second method — a POST alias here
 * would be a path a future caller could take and silently lose that.
 *
 * What went with the model: the per-week cached row, the 3-per-minute rate limit, and the
 * `degradedFromFacts` catch path. The limiter guarded a paid call; a limiter over arithmetic is a
 * way to fail a request for no reason. Rows written before this change stay for history and
 * nothing reads them on this path.
 *
 * `private, no-store` per the app's standing rule: freshness is managed by the client's own cache
 * keys and invalidation groups, and an HTTP-cache layer underneath them is the one cache
 * `invalidateCache()` cannot reach.
 */
export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const { isoWeekKey, metrics } = await computeWeeklyDigestMetrics(userId, tz)

  return NextResponse.json({
    weekStart: isoWeekKey,
    digest: buildWeeklyDigestText(metrics),
    metrics,
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
