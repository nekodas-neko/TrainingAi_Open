import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { normalizeDateParamIso, todayInTz, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { rateLimit } from '@/lib/rate-limit'
import { withRouteErrors } from '@/lib/api/route-errors'

const Body = z
  .object({
    date: z.string(),
    mealTypeId: z.uuid(),
    skipped: z.boolean(),
    decisionId: z.uuid(),
  })
  .strict()

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const raw = new URL(req.url).searchParams.get('date')
  const date =
    raw === null ? todayInTz(session.user.timezone ?? DEFAULT_TZ) : normalizeDateParamIso(raw)
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  const repo = await getRepository()
  if (date === todayInTz(session.user.timezone ?? DEFAULT_TZ))
    await repo.ensureMealLoggingDay(session.user.id, date)
  return NextResponse.json(
    { date, statuses: await repo.listMealLoggingStatuses(session.user.id, date) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${session.user.id}:meal-status`, 60, 60_000))
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  const read = await readJsonLimited(req, 4096)
  if (!read.ok)
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: read.reason === 'too_large' ? 413 : 400 },
    )
  const parsed = Body.safeParse(read.body)
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid meal status' }, { status: 400 })
  const date = normalizeDateParamIso(parsed.data.date)
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  const repo = await getRepository()
  return withRouteErrors(async () => {
    await repo.setMealLoggingStatus(
      session.user.id,
      date,
      parsed.data.mealTypeId,
      parsed.data.skipped,
      parsed.data.decisionId,
    )
    return NextResponse.json({ success: true })
  })
}
