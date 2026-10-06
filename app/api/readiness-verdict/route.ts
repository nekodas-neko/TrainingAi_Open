import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { z } from 'zod'
import { todayInTz, DEFAULT_TZ, normalizeDateParamIso, shiftDateStr } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { reportServerError } from '@/lib/observability'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import {
  readinessVerdictForDay,
  readinessModelVersionOf,
  toReadinessVerdictDays,
  READINESS_VERDICT_BASELINE_DAYS,
} from '@trainingai/shared/health/readiness-verdict'

// One date and one word.
const MAX_BODY_BYTES = 1024

/**
 * How much history to read for the band (#2105).
 *
 * The band is the last `READINESS_VERDICT_BASELINE_DAYS` days that carry a stored score, and a day
 * has one only if the readiness route ran that day, so days go missing. 120 days mirrors the sleep
 * verdict's lookback and stays one indexed range read.
 */
const HISTORY_DAYS = 120

// Matches /api/sleep-verdict: the sheet reads this once on open and writes at most one response.
const READ_LIMIT = { max: 60, windowMs: 60 * 60 * 1000 }
const WRITE_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 }

// Both separators. A client fills dates from `localDateString()`, which emits SLASHES, so a
// dash-only regex rejects every real request before the handler runs (Q-130).
const DATE_PARAM = z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/)

const ResponseBody = z.object({
  date: DATE_PARAM.optional(),
  state: z.enum(['rated', 'dismissed']),
}).strict()

/**
 * GET — is this day's readiness score unusual? Computed and frozen on first read.
 *
 * **A stored verdict is returned as-is and never recomputed**, as on `/api/sleep-verdict`: the row
 * pins the score, band and contributors that were judged, so a later readiness rewrite or model
 * change cannot alter what a rating was answering.
 *
 * **Reads stored scores only, and writes nothing but its own table.** The score comes from
 * `oura_daily_derived`, written by `/api/readiness-score`; this route never computes readiness and
 * never writes that table. A day with no stored score yet is silence, not a trigger to compute one.
 *
 * Writing on a read is deliberate: the row records that the question was ASKED, which happens
 * exactly when the sheet reads this. `upsertReadinessVerdict` never touches `response_state`.
 */
export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`readiness-verdict:${userId}`, READ_LIMIT.max, READ_LIMIT.windowMs)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const raw = new URL(req.url).searchParams.get('date')
  let date: string | null
  if (raw === null) {
    date = todayInTz(tz)
  } else {
    const shape = DATE_PARAM.safeParse(raw)
    date = shape.success ? normalizeDateParamIso(shape.data) : null
  }
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  try {
    const repo = await getRepository()

    const stored = await repo.getReadinessVerdict(userId, date)
    if (stored) return json({ verdict: stored })

    const rows = await repo.getOuraDailyDerived(userId, shiftDateStr(date, -HISTORY_DAYS), date)
    const targetRow = rows.find(r => r.day === date)
    const contributors = targetRow?.readinessContributors
    const readinessModelVersion = readinessModelVersionOf(targetRow?.modelVersions)
    // No stored score for the day yet — readiness has not been computed. Say nothing and store
    // nothing, so the snapshot is not frozen against a score nobody has seen. The same silence
    // covers a row with no contributors or no model stamp: without them the snapshot could not say
    // what produced the score, which is the one thing it exists to say.
    if (
      targetRow?.readinessScore == null ||
      contributors == null || typeof contributors !== 'object' || Array.isArray(contributors) ||
      readinessModelVersion === null
    ) {
      return json({ verdict: null })
    }

    const computed = readinessVerdictForDay(
      { date, score: targetRow.readinessScore, modelVersion: readinessModelVersion },
      toReadinessVerdictDays(rows),
    )
    // Below the coverage floor there is nothing honest to say. Not an error state; the field tells
    // the surface which silence this is.
    if (!computed) return json({ verdict: null, baselineDaysRequired: READINESS_VERDICT_BASELINE_DAYS })

    const record = {
      date,
      verdict: computed.verdict,
      score: computed.score,
      band: computed.band,
      baselineDays: computed.baselineDays,
      baselineSameVersionDays: computed.baselineSameVersionDays,
      contributors: contributors as Record<string, unknown>,
      readinessModelVersion,
      modelVersion: computed.modelVersion,
    }
    await repo.upsertReadinessVerdict(userId, record)
    return json({ verdict: { ...record, responseState: 'none' as const } })
  } catch (err) {
    reportServerError(err, { userId, url: '/api/readiness-verdict' })
    return NextResponse.json({ error: 'Readiness verdict unavailable' }, { status: 500 })
  }
}

/**
 * POST — record that he answered the prompt: `rated` or `dismissed`.
 *
 * This writes `response_state` and NOTHING else. The rating's value belongs to whichever save path
 * the surface settles on (LB-193); this route only records that the question was answered.
 */
export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`readiness-verdict-respond:${userId}`, WRITE_LIMIT.max, WRITE_LIMIT.windowMs)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = ResponseBody.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const date = parsed.data.date ? normalizeDateParamIso(parsed.data.date) : todayInTz(tz)
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  try {
    const repo = await getRepository()
    const updated = await repo.setReadinessVerdictResponse(userId, date, parsed.data.state)
    // Nothing was judged for that day, so there is nothing to answer. A 404 rather than a silent
    // 200: a response recorded against no verdict would be a label with nothing beside it.
    if (!updated) return NextResponse.json({ error: 'No verdict for that date' }, { status: 404 })
    return json({ ok: true })
  } catch (err) {
    reportServerError(err, { userId, url: '/api/readiness-verdict' })
    return NextResponse.json({ error: 'Could not record the response' }, { status: 500 })
  }
}

/** The app manages its own freshness through cache groups; a second HTTP cache underneath it is
 *  the one `invalidateCache()` cannot reach. */
function json(body: unknown) {
  return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })
}
