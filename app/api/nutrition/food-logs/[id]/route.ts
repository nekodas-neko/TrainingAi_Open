import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { invalidUuidResponse } from '@/lib/api/route-errors'

// One number. 4 KB is already two orders of magnitude of headroom.
const MAX_BODY_BYTES = 4 * 1024

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  // Q-482's id guard runs before Q-322's body read: refusing a malformed id costs nothing, and
  // there is no reason to buffer a body for a request that cannot succeed.
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { quantityMultiplier } = (read.body ?? {}) as { quantityMultiplier?: unknown }
  if (typeof quantityMultiplier !== 'number' || quantityMultiplier < 0.01 || quantityMultiplier > 100) {
    return NextResponse.json({ error: 'quantityMultiplier must be between 0.01 and 100' }, { status: 400 })
  }
  const repo = await getRepository()
  const log = await repo.updateFoodLog(id, userId, quantityMultiplier)
  return NextResponse.json(log)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const repo = await getRepository()
  await repo.deleteFoodLog(id, userId)
  return NextResponse.json({ success: true })
}
