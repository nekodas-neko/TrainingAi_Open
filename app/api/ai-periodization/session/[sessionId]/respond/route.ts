import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { z } from 'zod'
import { invalidUuidResponse } from '@/lib/api/route-errors'

const BodySchema = z.object({
  action: z.enum(['accept', 'dismiss']),
})

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
  if (!state.prescription) return NextResponse.json({ error: 'No prescription' }, { status: 400 })

  const newStatus = body.action === 'accept' ? 'accepted' : 'dismissed'

  // Accepting an emergency/regular deload is the moment the phase actually flips — not
  // when it was generated. advancePhase nulls the stored prescription as a side effect,
  // so re-store it afterward or the accepted deload never reaches the bar.
  const p = state.prescription
  if (body.action === 'accept' && p.deload && p.phaseAction === 'deload_recommended' && state.phase !== 'deload') {
    await repo.advancePhase(userId, sessionId, 'deload')
    await repo.storePrescription(userId, sessionId, p, state.prescriptionExpiresAt ?? new Date(Date.now() + 7 * 86_400_000))
  }

  await repo.updatePrescriptionStatus(userId, sessionId, newStatus)

  return NextResponse.json({ prescriptionStatus: newStatus })
}
