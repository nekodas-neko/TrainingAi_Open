import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { todayInTz, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { InjuryCreateSchema } from '@trainingai/shared/validation/injury'

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

  // Q-484: this route had no schema while its PATCH sibling had a complete one, so a 10 MB `notes`
  // was accepted and stored, and an unvalidated `startedDate` of "not-a-date" reached the date
  // arithmetic and 500'd. Same bounds as the PATCH now, from one definition.
  const parsed = InjuryCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { muscleName, severity, notes, startedDate } = parsed.data

  const tz = session.user.timezone ?? DEFAULT_TZ
  // Slashes are accepted by the schema (localDateString's shape); the DATE column must get dashes.
  const date = startedDate?.replace(/\//g, '-') ?? todayInTz(tz)

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
