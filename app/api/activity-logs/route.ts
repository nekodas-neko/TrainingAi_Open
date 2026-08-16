import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, toAestDay, todayInTz, todayMidnightUtc } from '@trainingai/shared/date-utils'
import { z } from 'zod'
import { ActivityLogBody, deriveEndTime } from '@trainingai/shared/validation/activity-log'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user.timezone ?? DEFAULT_TZ
  const { searchParams } = new URL(req.url)
  const days = Math.min(parseInt(searchParams.get('days') ?? '14', 10) || 14, 90)

  const today = todayInTz(tz)
  const from = toAestDay(new Date(todayMidnightUtc(tz).getTime() - (days - 1) * 86_400_000), tz)

  const repo = await getRepository()
  const activityLogs = await repo.listActivityLogs(session.user.id, from, today)
  return NextResponse.json({ activityLogs }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = ActivityLogBody.safeParse(await req.json())
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { startTime, durationMin, endTime: providedEndTime } = body.data
  const endTime = deriveEndTime(startTime, durationMin, providedEndTime)

  const repo = await getRepository()
  const activityLog = await repo.saveActivityLog(session.user.id, { ...body.data, endTime })
  return NextResponse.json({ activityLog }, { status: 201 })
}

const DeleteBody = z.object({ id: z.string().uuid() })

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = DeleteBody.safeParse(await req.json())
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const repo = await getRepository()
  await repo.deleteActivityLog(session.user.id, body.data.id)
  return NextResponse.json({ success: true })
}
