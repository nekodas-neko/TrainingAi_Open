import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { z } from 'zod'
import { invalidUuidResponse } from '@/lib/api/route-errors'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { serveStoredPrescription } from '@trainingai/shared/ai-periodization/program-phase'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

// One response to a prescription.
const MAX_BODY_BYTES = 16 * 1024

const BodySchema = z.object({
  action: z.enum(['accept', 'dismiss']),
}).strict()

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: z.infer<typeof BodySchema>
  try {
    const read = await readJsonLimited(req, MAX_BODY_BYTES)
    if (!read.ok) {
      return read.reason === 'too_large'
        ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
        : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    body = BodySchema.parse(read.body)
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { sessionId } = await params
  const badId = invalidUuidResponse(sessionId)
  if (badId) return badId
  const repo = await getRepository()

  const state = await repo.getSessionPeriodization(userId, sessionId)
  if (!state) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!state.prescription) return NextResponse.json({ error: 'No prescription' }, { status: 400 })
  // #3716: an aged-out prescription is no longer shown, so an Accept that reaches it was made on a
  // plan the lifter never saw (a stale screen, a queued tap). Refused; opening the session makes a
  // fresh one. A Dismiss would only bury a plan that is already being replaced, so it is refused too.
  // #3907: the same served-plan check as the card's read, so a plan whose deload has ended (#3876),
  // which the card no longer shows, is refused as well.
  const program = await repo.getActiveProgram(userId)
  const owner = program?.sessions.some(s => s.id === sessionId) ? program : null
  const served = await serveStoredPrescription(repo, userId, owner, state, session?.user?.timezone ?? DEFAULT_TZ)
  if (served.prescriptionAgedOut) {
    return NextResponse.json({ error: 'This prescription has expired. Reopen the session for a fresh one.' }, { status: 409 })
  }

  const newStatus = body.action === 'accept' ? 'accepted' : 'dismissed'

  // #3799: accepting a deload offer only takes today's lighter session. It used to move the
  // session type's phase to `deload` too, which held the loads down until two deload sessions were
  // completed and "Move to accumulation" was tapped: two or three weeks for a weekly session, from
  // one day's reason. The accepted prescription carries the deloaded rows itself
  // (`prescriptionDrivesLoad`), and the next session is planned from the phase as it was. A planned
  // deload moves the phase through the transition route instead.
  await repo.updatePrescriptionStatus(userId, sessionId, newStatus)

  return NextResponse.json({ prescriptionStatus: newStatus })
}
