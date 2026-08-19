import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { z } from 'zod'
import type { PeriodizationPhase } from '@trainingai/shared/types/ai-periodization'
import { POST_TRANSITION_STATUS } from './status'
import { invalidUuidResponse } from '@/lib/api/route-errors'

const BodySchema = z.object({
  newPhase: z.enum(['accumulation', 'intensification', 'realisation', 'deload']),
  force: z.boolean().optional(),
})

// Natural cycle order the AI periodization engine progresses through — matches
// lib/ai-periodization/prompt.ts's documented transitions (accumulation→intensification→
// realisation→deload→accumulation). Deload is reachable from any phase (fatigue-driven
// early deload, not just the end of a realisation block).
const NEXT_PHASE: Record<PeriodizationPhase, PeriodizationPhase> = {
  baseline: 'accumulation',
  accumulation: 'intensification',
  intensification: 'realisation',
  realisation: 'deload',
  deload: 'accumulation',
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { sessionId } = await params
  const badId = invalidUuidResponse(sessionId)
  if (badId) return badId
  const repo = await getRepository()

  const state = await repo.getSessionPeriodization(userId, sessionId)
  if (!state) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The recommendation lives on the stored prescription (pendingTransition is currently
  // never written) — the card only offers this transition when phaseAction is
  // transition_recommended/deload_recommended and sends prescription.phase as newPhase.
  const isRecommended = state.prescription != null
    && (state.prescription.phaseAction === 'transition_recommended' || state.prescription.phaseAction === 'deload_recommended')
    && state.prescription.phase === body.newPhase
  const isAdjacent = NEXT_PHASE[state.phase] === body.newPhase
  if (!isRecommended && !isAdjacent && !body.force) {
    return NextResponse.json({ error: 'Transition not recommended — pass force:true to override' }, { status: 400 })
  }

  await repo.advancePhase(userId, sessionId, body.newPhase as PeriodizationPhase)
  await repo.updatePrescriptionStatus(userId, sessionId, POST_TRANSITION_STATUS)
  const updated = await repo.getSessionPeriodization(userId, sessionId)

  // Regeneration is fired by the CLIENT (see ai-prescription-card.tsx's executeTransition) — a
  // container→own-origin self-fetch is unreliable in prod, which is exactly why the open-time and
  // completion-time triggers already moved client-side (workout-screen.tsx). The slot is left in
  // POST_TRANSITION_STATUS, so even if that call is lost the pre-workout screen's existing poll
  // and prescribe trigger recover it on the next open.
  return NextResponse.json({ state: updated })
}
