import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { todayInTz, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { withRouteErrors, invalidUuidResponse } from '@/lib/api/route-errors'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const tz = session.user.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  // Q-463: logging a supplement that is not yours (or does not exist) answered 500 with an EMPTY
  // body, so the sync path read a permanent refusal as transient and retried it, and the client's
  // res.json() threw on top of the failure.
  return withRouteErrors(async () => {
    await repo.logSupplement(id, session.user!.id!, todayInTz(tz))
    return NextResponse.json({ ok: true })
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const tz = session.user.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  return withRouteErrors(async () => {
    await repo.unlogSupplement(id, session.user!.id!, todayInTz(tz))
    return NextResponse.json({ ok: true })
  })
}
