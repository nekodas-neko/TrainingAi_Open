import { NextRequest, NextResponse } from 'next/server'
import { refusalResponse, isRefusal, invalidUuidResponse } from '@/lib/api/route-errors'
import { reportServerError } from '@/lib/observability'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import type { EditablePhase } from '@/components/config/phase-editor'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// A phase set: a name and its phases.
const MAX_BODY_BYTES = 256 * 1024

async function getUserId() {
  const session = await auth()
  return session?.user?.id
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const body = (read.body ?? {}) as { name: string; phases: EditablePhase[] }

  const repo = await getRepository()
  try {
    const ownedStyles = await repo.listProgressionStyles(userId)
    const ownedStyleIds = new Set(ownedStyles.map(s => s.id))
    const phases = (body.phases ?? []).map((p, i) => ({
      position: i,
      name: p.name,
      durationCycles: p.durationCycles,
      phaseType: p.phaseType,
      primaryStyleId: p.primaryStyleId,
      secondaryStyleId: p.secondaryStyleId,
    }))
    for (const p of phases) {
      if (p.primaryStyleId && !ownedStyleIds.has(p.primaryStyleId)) {
        return NextResponse.json({ error: 'Invalid primaryStyleId' }, { status: 400 })
      }
      if (p.secondaryStyleId && !ownedStyleIds.has(p.secondaryStyleId)) {
        return NextResponse.json({ error: 'Invalid secondaryStyleId' }, { status: 400 })
      }
    }
    const phaseSet = await repo.updatePhaseSet(
      id,
      userId,
      body.name?.trim() ?? '',
      phases,
    )
    return NextResponse.json({ phaseSet })
  } catch (e: unknown) {
    // Q-463: "Phase set not found" is a 404, not a 400. This verb and DELETE below answered the
    // SAME condition with two different wrong statuses — 400 here, 500 there.
    if (!isRefusal(e)) reportServerError(e, { userId, url: '/api/phase-sets/[id]' })
    return refusalResponse(e, 'Could not save that phase set')
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const repo = await getRepository()
  try {
    await repo.deletePhaseSet(id, userId)
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    // The status used to be matched out of the message text — `msg.includes('default')` fired on
    // any error carrying the word. It now travels on the thrown UserFacingError (Q-320).
    if (!isRefusal(e)) reportServerError(e, { userId, url: '/api/phase-sets/[id]' })
    return refusalResponse(e, 'Could not delete that phase set')
  }
}
