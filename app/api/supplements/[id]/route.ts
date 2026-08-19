import { NextRequest, NextResponse } from 'next/server'
import { withRouteErrors } from '@/lib/api/route-errors'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { SupplementPatchSchema } from '@trainingai/shared/validation/supplement'


export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const parsed = SupplementPatchSchema.safeParse(await req.json().catch(() => null))
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
  const repo = await getRepository()
  return withRouteErrors(async () => {
    await repo.deleteSupplement(id, session.user!.id!)
    return NextResponse.json({ ok: true })
  })
}
