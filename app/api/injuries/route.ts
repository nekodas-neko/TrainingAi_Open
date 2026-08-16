import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { todayInTz, DEFAULT_TZ } from '@trainingai/shared/date-utils'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const repo = await getRepository()
  const injuries = await repo.listInjuries(session.user.id)
  return NextResponse.json(injuries, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { muscleName, severity, notes, startedDate } = body

  if (!muscleName?.trim()) return NextResponse.json({ error: 'muscleName required' }, { status: 400 })
  if (!['mild', 'moderate', 'severe'].includes(severity)) return NextResponse.json({ error: 'invalid severity' }, { status: 400 })

  const tz = session.user.timezone ?? DEFAULT_TZ
  const date = startedDate ?? todayInTz(tz)

  const repo = await getRepository()
  const injury = await repo.createInjury(session.user.id, {
    muscleName: muscleName.trim(),
    severity,
    notes: notes?.trim() || null,
    startedDate: date,
    resolvedDate: null,
  })
  return NextResponse.json(injury, { status: 201 })
}
