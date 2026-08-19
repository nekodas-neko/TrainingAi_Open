import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, toAestDay, todayInTz, todayMidnightUtc } from '@trainingai/shared/date-utils'
import { z } from 'zod'
import { ActivityLogBody, deriveEndTime } from '@trainingai/shared/validation/activity-log'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One activity log: a date, a type, a duration and a few optional numbers.
const MAX_BODY_BYTES = 8 * 1024

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

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const body = ActivityLogBody.safeParse(read.body)
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

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const body = DeleteBody.safeParse(read.body)
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const repo = await getRepository()
  const deleted = await repo.deleteActivityLog(session.user.id, body.data.id)
  // Q-556: this answered `{ success: true }` unconditionally, so a delete that matched nothing was
  // indistinguishable from one that worked.
  //
  // **It reports the outcome rather than 404-ing on a miss, and the order matters.** Every sibling
  // delete answers 404 for both a nonexistent id and someone else's, and matching that convention is
  // the eventual goal — but it cannot come first. Activity logs are CREATED through the outbox
  // (`exercise-review-sheet.tsx`, `done-activity-screen.tsx` both `queueMutation`), so a row exists
  // locally before its push lands; deleting it in that window matches no server row. The client
  // (`health-content.tsx`) treats any `!res.ok` as failure and skips its local delete, so a 404 here
  // would toast "Failed to delete" and leave a row the user just removed on screen — and there is no
  // outbox DELETE domain to reconcile it later, because delete is the one activity-log write that
  // never queues. Q-328 closes that gap; 404 belongs in the PR after it.
  return NextResponse.json({ success: true, deleted })
}
