import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// A date and a millilitre count. 4 KB is generous.
const MAX_BODY_BYTES = 4 * 1024

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Q-24 §6: this was the only write route with no limiter. It increments a running total,
  // so an unthrottled caller can drive the day's water arbitrarily high one accepted request
  // at a time — each individually inside the ≤5000 ml bound. Matched to its siblings
  // (day-checkin, food-logs): 60/min, far above the quick-add button's real cadence.
  if (!rateLimit(`water-log:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const ml = (read.body as { ml?: unknown } | null)?.ml
  if (typeof ml !== 'number' || ml <= 0 || ml > 5000) {
    return NextResponse.json({ error: 'ml must be a positive number ≤ 5000' }, { status: 400 })
  }

  const tz = session.user.timezone ?? DEFAULT_TZ
  const date = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')

  const repo = await getRepository()
  await repo.incrementWaterLog(userId, date, Math.round(ml))

  return NextResponse.json({ success: true, date })
}
