import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ, normalizeDateParamIso } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// A date, two ids and a multiplier. 8 KB is generous for four fields.
const MAX_BODY_BYTES = 8 * 1024

export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const rawDate = searchParams.get('date')
  const date = rawDate ? normalizeDateParamIso(rawDate) : formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  const repo = await getRepository()
  const logs = await repo.listFoodLogs(userId, date)
  return NextResponse.json(logs, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`food-logs:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  // Bare `req.json()` here also threw on malformed JSON, which Next turned into a 500 rather than
  // the 400 it is. `readJsonLimited` answers both cases.
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const body = read.body as Record<string, unknown>
  const { date: rawBodyDate, mealTypeId, foodItemId, quantityMultiplier } = body
  // Typed explicitly now the body is `unknown` rather than `any`. Both ids went straight into
  // `foodLogRefsValid` and `createFoodLog` with only a truthiness check before this.
  if (!rawBodyDate || typeof mealTypeId !== 'string' || typeof foodItemId !== 'string') {
    return NextResponse.json({ error: 'date, mealTypeId, foodItemId required' }, { status: 400 })
  }
  // The written row's key — an unvalidated one files the log under a day nothing can recover.
  const date = normalizeDateParamIso(String(rawBodyDate))
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  const qm = quantityMultiplier ?? 1.0
  if (typeof qm !== 'number' || qm < 0.01 || qm > 100) {
    return NextResponse.json({ error: 'quantityMultiplier must be between 0.01 and 100' }, { status: 400 })
  }
  const repo = await getRepository()
  if (!(await repo.foodLogRefsValid(userId, mealTypeId, foodItemId))) {
    return NextResponse.json({ error: 'Invalid mealTypeId or foodItemId' }, { status: 400 })
  }
  const log = await repo.createFoodLog(userId, {
    date, mealTypeId, foodItemId,
    quantityMultiplier: qm,
  })
  return NextResponse.json(log, { status: 201 })
}
