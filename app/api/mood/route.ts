import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { MoodFieldsSchema } from '@trainingai/shared/validation/mood-log'
import { rateLimit } from '@/lib/rate-limit'
import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ, normalizeDateParamIso } from '@trainingai/shared/date-utils'

// Shared with the outbox's mood_logs branch in pushMutations, which used to cast straight
// through with no validation at all (Q-131).
const MoodSchema = MoodFieldsSchema

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user.timezone ?? DEFAULT_TZ
  const { searchParams } = new URL(req.url)
  const raw = searchParams.get('date')
  // Q-130: a raw param reaching date arithmetic downstream is the RangeError shape the guard
  // exists to prevent. Accepts both separators, since clients fill this from localDateString().
  const date = raw ? normalizeDateParamIso(raw) : formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  const repo = await getRepositoryAsync()
  const log = await repo.getMoodLog(session.user.id, date)
  return NextResponse.json(log ?? null, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`mood:${session.user.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const tz = session.user.timezone ?? DEFAULT_TZ
  const parsed = MoodSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const { energyLevel, sleepQuality, bodyState, soreMuscles } = parsed.data

  const logDate = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
  const repo = await getRepositoryAsync()
  const log = await repo.saveMoodLog(session.user.id, {
    logDate,
    energyLevel,
    sleepQuality: sleepQuality ?? 'ok',
    bodyState: bodyState ?? [],
    soreMuscles: soreMuscles ?? [],
  })
  return NextResponse.json(log)
}
