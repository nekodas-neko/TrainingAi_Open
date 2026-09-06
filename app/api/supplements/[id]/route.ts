import { NextRequest, NextResponse } from 'next/server'
import { withRouteErrors, invalidUuidResponse } from '@/lib/api/route-errors'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { SupplementPatchSchema } from '@trainingai/shared/validation/supplement'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One supplement.
const MAX_BODY_BYTES = 16 * 1024


export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = SupplementPatchSchema.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const repo = await getRepository()
  // Q-463: an id that is not yours (or does not exist) answered 500 with an empty body.
  return withRouteErrors(async () => {
    const supplement = await repo.updateSupplement(id, session.user!.id!, parsed.data)
    return NextResponse.json(supplement)
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const repo = await getRepository()
  return withRouteErrors(async () => {
    // RV-45: a delete that matched no row is reported as one that removed something, and the
    // sheets that call this do `if (!res.ok) throw` — so a refused cross-account delete, or a
    // stale id, confirms itself to the user and the row returns on the next pull. 404 matches
    // the Q-556 reference on activity-logs.
    const deleted = await repo.deleteSupplement(id, session.user!.id!)
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  })
}
