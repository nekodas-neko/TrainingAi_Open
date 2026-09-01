import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ, normalizeDateParamIso } from '@trainingai/shared/date-utils'
import { normalizeMealGroupName } from '@trainingai/shared/nutrition/meal-group-name'
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
  const { date: rawBodyDate, mealTypeId, foodItemId, quantityMultiplier, savedMealId, mealGroupId, mealGroupName } = body
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
  // BF-39. Both are optional and both are ids, so both are typed before they reach the DB — a
  // non-string here would otherwise go straight into a uuid column as a driver-level error.
  if (savedMealId != null && typeof savedMealId !== 'string') {
    return NextResponse.json({ error: 'savedMealId must be a string' }, { status: 400 })
  }
  if (mealGroupId != null && typeof mealGroupId !== 'string') {
    return NextResponse.json({ error: 'mealGroupId must be a string' }, { status: 400 })
  }
  const repo = await getRepository()
  // `savedMealId` is a client-supplied row id, so it is ownership-checked alongside the other two
  // rather than trusted — a log naming someone else's meal would render their name and picture in
  // this user's diary.
  if (!(await repo.foodLogRefsValid(userId, mealTypeId, foodItemId, savedMealId ?? null))) {
    return NextResponse.json({ error: 'Invalid mealTypeId, foodItemId or savedMealId' }, { status: 400 })
  }
  const log = await repo.createFoodLog(userId, {
    date, mealTypeId, foodItemId,
    quantityMultiplier: qm,
    savedMealId: savedMealId ?? null,
    mealGroupId: mealGroupId ?? null,
    // BF-97. Normalised rather than type-checked-and-rejected, and through the same helper the push
    // branch uses — a name is a display string, and no length of one makes the log wrong.
    mealGroupName: normalizeMealGroupName(mealGroupName),
  })
  return NextResponse.json(log, { status: 201 })
}
