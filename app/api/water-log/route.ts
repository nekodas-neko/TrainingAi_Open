import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ, shiftDateStr } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// An optional local date and a millilitre count. 4 KB is generous.
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

  const body = (read.body ?? {}) as { ml?: unknown; localDate?: unknown }
  const ml = body.ml
  if (typeof ml !== 'number' || ml <= 0 || ml > 5000) {
    return NextResponse.json({ error: 'ml must be a positive number ≤ 5000' }, { status: 400 })
  }

  const tz = session.user.timezone ?? DEFAULT_TZ
  const serverToday = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')

  // PS-37: this route keyed the increment to SERVER-now while the outbox path keys the identical
  // write to the client's own day (`incrementWaterLogOnce(userId, mut.date, …)`), so the same quick
  // add landed on a different date depending on which path carried it. The file's own header said
  // "a date and a millilitre count" — the date was never read.
  //
  // Both separators, because `localDateString()` emits `YYYY/MM/DD` and a dash-only regex would
  // reject every request from a client that fills the field from it (the ai-chat `localDate` bug).
  // Bounded to today or yesterday in the user's timezone: the only honest reason for the client's
  // day to differ from the server's is a request that crossed midnight, and an unbounded date on a
  // running total is a way to rewrite history one accepted request at a time.
  const raw = typeof body.localDate === 'string' && /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(body.localDate)
    ? body.localDate.replace(/\//g, '-')
    : null
  const yesterday = shiftDateStr(serverToday, -1)
  const date = raw === serverToday || raw === yesterday ? raw : serverToday

  const repo = await getRepository()
  await repo.incrementWaterLog(userId, date, Math.round(ml))

  return NextResponse.json({ success: true, date })
}
