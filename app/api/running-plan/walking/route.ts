import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { cardioPlanKind } from '@trainingai/shared/running/cardio-goals'
import { applyStepBack, MINUTES_CEILING, MINUTES_CEILING_PLUS, parseWalkingState, setMinutesCeiling } from '@trainingai/shared/running/walking-plan'
import { settleWalkingPlan, WALKING_STATE_KEY } from '@/lib/health/walking-plan-service'

// #3779 — the two choices the walking plan leaves to the person: accept an offered step back (a
// target never drops on its own), and the weekly minutes ceiling (150, or 300 for "heart health
// plus"). Every value written is built by `walking-plan.ts`; the body only names the choice.
const MAX_BODY_BYTES = 4 * 1024
const NO_STORE = 'private, no-store'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('step-back'), target: z.enum(['steps', 'minutes']) }).strict(),
  z.object({ action: z.literal('minutes-ceiling'), ceiling: z.union([z.literal(MINUTES_CEILING), z.literal(MINUTES_CEILING_PLUS)]) }).strict(),
])

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:running-plan`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = Body.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  const plan = await repo.getActiveRunningPlan(userId)
  if (!plan || cardioPlanKind(plan) !== 'walking') return NextResponse.json({ error: 'No active walking plan' }, { status: 404 })

  // Settle first, so the choice applies to the state with every ended week judged.
  await settleWalkingPlan(repo, userId, tz, { plan })
  const fresh = await repo.getActiveRunningPlan(userId)
  const snapshot = (fresh?.fitnessSnapshot && typeof fresh.fitnessSnapshot === 'object' ? fresh.fitnessSnapshot : {}) as Record<string, unknown>
  const state = parseWalkingState(snapshot[WALKING_STATE_KEY])
  if (!fresh || !state) return NextResponse.json({ error: 'No active walking plan' }, { status: 404 })

  const next = parsed.data.action === 'step-back'
    ? applyStepBack(state, parsed.data.target)
    : setMinutesCeiling(state, parsed.data.ceiling)
  if (!next) return NextResponse.json({ error: 'No step back is on offer for that target' }, { status: 409 })

  const updated = await repo.updateRunningPlanSnapshot(userId, fresh.id, { ...snapshot, [WALKING_STATE_KEY]: next })
  if (!updated) return NextResponse.json({ error: 'No active walking plan' }, { status: 404 })
  const walking = await settleWalkingPlan(repo, userId, tz, { plan: updated })
  return NextResponse.json({ walking }, { headers: { 'Cache-Control': NO_STORE } })
}
