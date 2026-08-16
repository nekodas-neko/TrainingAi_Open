import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { todayInTz, DEFAULT_TZ } from '@trainingai/shared/date-utils'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const tz = session.user.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  await repo.logSupplement(id, session.user.id, todayInTz(tz))
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const tz = session.user.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  await repo.unlogSupplement(id, session.user.id, todayInTz(tz))
  return NextResponse.json({ ok: true })
}
