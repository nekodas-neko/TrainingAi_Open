import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { z } from 'zod'
import { todayInTz, DEFAULT_TZ, normalizeDateParamIso } from '@trainingai/shared/date-utils'
import { DayCheckinScalesSchema, DayCheckinExtrasSchema, dayCheckinHasAnswers } from '@trainingai/shared/validation/day-checkin'
import { rateLimit } from '@/lib/rate-limit'
import { answeredMorningScales } from '@trainingai/shared/health/self-report'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One check-in's answers.
const MAX_BODY_BYTES = 16 * 1024

// LA-128. `.strict()` — an unknown key is a 400 naming it, not a silent strip.
//
// Zod drops a key it does not know unless told otherwise, so a sheet posting a field whose server
// half has not landed got **201 and wrote nothing**. That is the failure LB-124 was filed over
// rather than attempted: a control that looks like it works and stores nothing would have burned
// TN-58's two-week pass test, reporting "no self-report available" when the truth was a dropped
// field.
//
// **Safe to turn on: no current client sends an unknown key.** Checked key by key before flipping
// it — the morning sheet sends 13 and the evening review 9, all known. The retired scales
// (`motivation`, `restingSoreness`, `wakeMood`) look like a hazard and are not: the morning sheet
// sends them as null on purpose so a re-save clears a historical value, and they are still in
// `DayCheckinScalesSchema`.
const Body = DayCheckinScalesSchema.extend(DayCheckinExtrasSchema.shape).extend({
  // Both separators: the client fills this from localDateString(), which emits slashes —
  // a dash-only regex rejects every real request before the handler runs (Q-130).
  date: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).optional(),
  phase: z.enum(['evening', 'morning']).default('evening'),
}).strict()

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
  if (!parsed.success) {
    // LA-128: name the unknown key. The whole point of rejecting rather than stripping is that the
    // developer who added a field to the sheet learns the server has not caught up — "Invalid body"
    // alone sends them looking at the values they sent instead of at the key.
    const unknown = parsed.error.issues.flatMap(i => (i.code === 'unrecognized_keys' ? i.keys : []))
    return NextResponse.json(
      { error: unknown.length ? `Unknown field(s): ${unknown.join(', ')}` : 'Invalid body' },
      { status: 400 },
    )
  }
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
    // TN-57: an untouched scale is stored as null, so `count(perceived_recovery)` is the honest
    // count of real answers from here on. Deliberately AFTER the Q-465 guard above — the morning
    // sheet posts nothing else that counts as an answer, so nulling first would 400 an untouched
    // save and the sheet would re-prompt all day.
    ...answeredMorningScales({
      perceivedRecovery: b.perceivedRecovery ?? null,
      sleepQualityFeel: b.sleepQualityFeel ?? null,
      perceivedRecoveryTouched: b.perceivedRecoveryTouched ?? false,
      sleepQualityFeelTouched: b.sleepQualityFeelTouched ?? false,
    }),
    motivation: b.motivation ?? null,
    restingSoreness: b.restingSoreness ?? null,
    illnessContext: b.illnessContext ?? null,
    perceivedRecoveryTouched: b.perceivedRecoveryTouched ?? false,
    sleepQualityFeelTouched: b.sleepQualityFeelTouched ?? false,
    vsYesterday: b.vsYesterday ?? null,
    soreMuscles: b.soreMuscles,
    journal: b.journal ?? null,
  })
  return NextResponse.json(saved, { status: 201 })
}
