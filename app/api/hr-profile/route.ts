import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { hrReserve } from '@trainingai/shared/health/hr-zones'
import { resolveHrProfile } from '@trainingai/shared/health/hr-profile'
import type { ObservedHrProfile } from '@trainingai/shared/health/observed-hr'

// Personal HR-zone anchors for the live workout chart. Every value here now comes from the
// single resolver (`resolveHrProfile`) rather than being recomputed — this route used to
// run its own `computeObservedHr` + `resolveMaxHr` pass alongside it, which is how the
// codebase ended up with divergent answers to "what is my max HR".
export interface HrProfileResponse {
  /** The effort ceiling — observed only when reliable AND >= the age estimate. */
  maxHr: number
  restingHr: number
  reserve: number
  /** Robust observed HR profile over the trailing window (spike-rejected). */
  observed: ObservedHrProfile
  /** Age-predicted (220 - age), for showing the estimate alongside the resolved value. */
  estimatedMax: number
  workingMax: number
  workingMaxSource: 'observed' | 'estimated'
  /** Anchor for reachable targets — see HrProfile.targetAnchorMax. */
  targetAnchorMax: number
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:hr-profile`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const repo = await getRepository()
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const profile = await resolveHrProfile(repo, userId, tz)

  return NextResponse.json(
    {
      maxHr: profile.maxHr,
      restingHr: profile.restingHr,
      reserve: hrReserve(profile.maxHr, profile.restingHr),
      observed: profile.observed,
      estimatedMax: profile.estimatedMax,
      workingMax: profile.maxHr,
      workingMaxSource: profile.maxHrSource,
      targetAnchorMax: profile.targetAnchorMax,
    } satisfies HrProfileResponse,
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
