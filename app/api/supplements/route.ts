import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { todayInTz, DEFAULT_TZ } from '@trainingai/shared/date-utils'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tz = session.user.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  const supplements = await repo.listSupplements(session.user.id, todayInTz(tz))
  return NextResponse.json(supplements, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const repo = await getRepository()
  const supplement = await repo.createSupplement(session.user.id, {
    name: body.name.trim(),
    dose: body.dose?.trim() || null,
    reminderEnabled: body.reminderEnabled ?? false,
    reminderTime: body.reminderTime ?? null,
    sortOrder: body.sortOrder ?? 0,
    active: body.active ?? true,
  })
  return NextResponse.json(supplement, { status: 201 })
}
