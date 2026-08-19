import { NextRequest, NextResponse } from 'next/server'
import { withRouteErrors } from '@/lib/api/route-errors'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { InjuryPatchSchema } from '@trainingai/shared/validation/injury'


export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const parsed = InjuryPatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const repo = await getRepository()
  // Q-463: an id that is not yours (or does not exist) answered 500 with an empty body.
  return withRouteErrors(async () => {
    // The schema accepts both separators (localDateString emits slashes); the DATE columns must get
    // dashes, since `2026/08/09` is DateStyle-dependent at the driver.
    const { startedDate, resolvedDate, ...rest } = parsed.data
    const injury = await repo.updateInjury(id, session.user!.id!, {
      ...rest,
      ...(startedDate !== undefined ? { startedDate: startedDate.replace(/\//g, '-') } : {}),
      ...(resolvedDate !== undefined ? { resolvedDate: resolvedDate?.replace(/\//g, '-') ?? null } : {}),
    })
    return NextResponse.json(injury)
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const repo = await getRepository()
  return withRouteErrors(async () => {
    await repo.deleteInjury(id, session.user!.id!)
    return NextResponse.json({ ok: true })
  })
}
