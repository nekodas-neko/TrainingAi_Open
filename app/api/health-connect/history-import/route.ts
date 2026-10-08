import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { DEFAULT_TZ, normalizeDateParamIso, todayInTz } from '@trainingai/shared/date-utils'
import { historyDayRejection } from '@/lib/health-connect-history-import'

// issue 2169. Where the signed-in user's explicit Health Connect "Import more history" run has got
// to: the oldest local calendar day imported, one value per account. The device walks back 30 days a
// window and records each window here once it has landed, so a second press - or a press after a
// reinstall - continues from this day instead of starting over.
//
// The row is the caller's own and keyed on the session's id; no id comes from the client. The writer
// only ever moves the day OLDER, so a late or replayed POST cannot rewind progress.

// One 10-character date. 1 KB is far past it and still a real cap.
const MAX_BODY_BYTES = 1024

const BodySchema = z.object({
  oldestDate: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/),
}).strict()

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  if (!rateLimit(`hc-history-import-read:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const repo = await getRepositoryAsync()
  const oldestDate = await repo.getHealthConnectHistoryOldest(userId)
  return NextResponse.json({ oldestDate }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  // A run posts once per 30-day window, and a window takes seconds, so this is generous.
  if (!rateLimit(`hc-history-import:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  // A day that is not a real day, is in the future, or is further back than an import goes is a
  // crafted call: refused, never stored. (Unlike a per-record sync field, this is the whole request.)
  const today = todayInTz(session.user.timezone ?? DEFAULT_TZ)
  const reason = historyDayRejection(parsed.data.oldestDate, today)
  if (reason) return NextResponse.json({ error: 'Invalid payload', reason }, { status: 400 })

  const repo = await getRepositoryAsync()
  // Stored as a dash date whichever separator the client used.
  const oldestDate = await repo.advanceHealthConnectHistoryOldest(userId, normalizeDateParamIso(parsed.data.oldestDate)!)
  return NextResponse.json({ oldestDate }, { headers: { 'Cache-Control': 'private, no-store' } })
}
