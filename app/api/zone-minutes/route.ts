import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, normalizeDateParamIso, toAestDay, todayMidnightUtc } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { resolveHrProfile } from '@trainingai/shared/health/hr-profile'

// Per-day time-in-HR-zone over a local-date range, reconcile-on-read cached (daily_zone_minutes).
// The zone profile is the canonical /api/hr-profile derivation (fixed 28-day RHR window), so the
// range view and the per-workout view use identical zones. Today is always recomputed (partial day).
export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:zone-minutes`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const today = todayInTz(tz)
  const toParam = req.nextUrl.searchParams.get('to')
  const fromParam = req.nextUrl.searchParams.get('from')
  // Q-453's sibling: the same `?? default` shape, and the same conflation of "absent" with
  // "malformed". A range route makes it worse than the single-date one — a mistyped `from` silently
  // widened the window to 30 days and answered as if that was what was asked for.
  const to = toParam ? normalizeDateParamIso(toParam) : today
  const from = fromParam
    ? normalizeDateParamIso(fromParam)
    : toAestDay(new Date(todayMidnightUtc(tz).getTime() - 29 * 86_400_000), tz) // default: last 30 days
  if (!to || !from) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  const repo = await getRepository()
  const profile = await resolveHrProfile(repo, userId, tz)
  const days = await repo.getZoneMinutesRange(userId, from, to, tz, profile)

  return NextResponse.json(
    { from, to, profile, days },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
