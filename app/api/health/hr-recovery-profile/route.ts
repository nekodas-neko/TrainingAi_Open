import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { computeHrRecoveryProfile } from '@trainingai/shared/health/compute-hr-recovery-profile'

// HR Recovery Profile (plan 2026-07-22-hr-recovery-profile.md) — recovery rate bucketed by the HR
// being recovered FROM, plus its month-over-month trend per band. Thin wrapper: all the fetch +
// detect + aggregate logic lives in computeHrRecoveryProfile, shared with the getHrRecoveryProfile
// AI-chat tool so the two surfaces can never drift. Derive-on-read — no persistence needed since
// set_hr_stats already survives the 180d oura_heartrate prune, and workout-cooldown episodes are
// cheap to re-detect on every read.
const DEFAULT_DAYS = 180
const MAX_DAYS = 730

export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:hr-recovery-profile`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const url = new URL(req.url)
  const daysParam = Number(url.searchParams.get('days'))
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.round(daysParam), MAX_DAYS) : DEFAULT_DAYS
  const tz = session.user?.timezone ?? DEFAULT_TZ

  const repo = await getRepository()
  const { profile, trend } = await computeHrRecoveryProfile(repo, userId, tz, days)

  return NextResponse.json({ ...profile, trend }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
