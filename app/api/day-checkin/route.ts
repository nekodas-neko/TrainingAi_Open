import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { z } from 'zod'
import { todayInTz, DEFAULT_TZ, normalizeDateParamIso } from '@trainingai/shared/date-utils'
import { DayCheckinScalesSchema, DayCheckinExtrasSchema, dayCheckinHasAnswers } from '@trainingai/shared/validation/day-checkin'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One check-in's answers.
const MAX_BODY_BYTES = 16 * 1024

const Body = DayCheckinScalesSchema.extend(DayCheckinExtrasSchema.shape).extend({
  // Both separators: the client fills this from localDateString(), which emits slashes —
  // a dash-only regex rejects every real request before the handler runs (Q-130).
  date: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).optional(),
  phase: z.enum(['evening', 'morning']).default('evening'),
})

export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const rawDate = url.searchParams.get('date')
  const date = rawDate ? normalizeDateParamIso(rawDate) : todayInTz(session.user?.timezone ?? DEFAULT_TZ)
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  // phase reached the repo unvalidated, so any string became a lookup key (Q-130).
  const phase = url.searchParams.get('phase') ?? 'evening'
  if (phase !== 'evening' && phase !== 'morning') {
    return NextResponse.json({ error: 'Invalid phase' }, { status: 400 })
  }
  const repo = await getRepository()
  return NextResponse.json(await repo.getDayCheckin(userId, date, phase), { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`day-checkin:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = Body.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const b = parsed.data
  // Q-465: a body of `{}` used to return 201 and write a row with every metric null — a row
  // indistinguishable from a real check-in in which the user answered nothing. Readiness is exactly
  // the pillar where those two must not collapse to the same value, and the row also moves
  // `reevaluationKey(...)` in `/api/workout-data`, so it can trigger a re-evaluation carrying no
  // new information. The same guard runs in `pushMutations`, since the outbox reaches this table too.
  if (!dayCheckinHasAnswers(b)) {
    return NextResponse.json({ error: 'Check-in carries no answers' }, { status: 400 })
  }
  // Q-496: the GET above already routes its param through `normalizeDateParamIso`; this POST did
  // not, so the schema's shape-only regex let `2026-13-45` reach the driver — measured as a 500 plus
  // an `error_events` row, a client input error filed as a server fault.
  const date = b.date ? normalizeDateParamIso(b.date) : todayInTz(session.user?.timezone ?? DEFAULT_TZ)
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  const repo = await getRepository()
  const saved = await repo.saveDayCheckin(userId, {
    logDate: date,
    phase: b.phase,
    physicalTiredness: b.physicalTiredness ?? null,
    mentalDrain: b.mentalDrain ?? null,
    barelyMoved: b.barelyMoved ?? null,
    hydration: b.hydration ?? null,
    lateHeavyMeal: b.lateHeavyMeal ?? null,
    wakeMood: b.wakeMood ?? null,
    perceivedRecovery: b.perceivedRecovery ?? null,
    motivation: b.motivation ?? null,
    sleepQualityFeel: b.sleepQualityFeel ?? null,
    restingSoreness: b.restingSoreness ?? null,
    illnessContext: b.illnessContext ?? null,
    perceivedRecoveryTouched: b.perceivedRecoveryTouched ?? false,
    sleepQualityFeelTouched: b.sleepQualityFeelTouched ?? false,
    soreMuscles: b.soreMuscles,
    journal: b.journal ?? null,
  })
  return NextResponse.json(saved, { status: 201 })
}
