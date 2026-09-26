import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { z } from 'zod'
import { todayInTz, DEFAULT_TZ, normalizeDateParamIso, shiftDateStr } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import {
  sleepVerdictForNight,
  toVerdictNights,
  VERDICT_BASELINE_NIGHTS,
} from '@trainingai/shared/health/sleep-verdict'

// One date and one word.
const MAX_BODY_BYTES = 1024

/**
 * How much history to read for the baselines (TN-81/LA-149).
 *
 * Generous on purpose: the window is `VERDICT_BASELINE_NIGHTS` nights *with a value*, counted
 * per component after nulls are dropped, and nights go missing. Measured against production
 * 2026-09-26 — 119 sleep rows in the last 120 days, of which 112 carry an efficiency — so 120
 * days reliably yields a full 28 for every component while staying one indexed range read.
 */
const HISTORY_DAYS = 120

// Matches /api/day-checkin: the sheet reads this once on open and writes at most one response.
const READ_LIMIT = { max: 60, windowMs: 60 * 60 * 1000 }
const WRITE_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 }

const ResponseBody = z.object({
  // Both separators. The client fills this from `localDateString()`, which emits SLASHES, so a
  // dash-only regex rejects every real request with a Zod error before the handler runs (Q-130).
  date: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).optional(),
  state: z.enum(['acknowledged', 'corrected']),
}).strict()

/**
 * GET — the verdict for a night, computing and storing it on first read.
 *
 * **A stored verdict is returned as-is and never recomputed.** That is the whole point of TN-81:
 * the announcement is snapshotted with the values and bands behind it, so a later scoring change
 * cannot rewrite what a correction was disagreeing with. Recomputing here would quietly undo it.
 *
 * Writing on a read is deliberate rather than sloppy — the row records that an announcement was
 * MADE, and an announcement happens exactly when the sheet reads this. If nobody opens the sheet
 * there was no announcement and correctly no row. It is safe to repeat: `upsertSleepVerdict` is
 * idempotent per `(user, date)` and never touches `response_state`.
 */
export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`sleep-verdict:${userId}`, READ_LIMIT.max, READ_LIMIT.windowMs)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const raw = new URL(req.url).searchParams.get('date')
  const date = raw ? normalizeDateParamIso(raw) : todayInTz(tz)
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  const repo = await getRepository()

  const stored = await repo.getSleepVerdict(userId, date)
  if (stored) return json({ verdict: stored })

  const sessions = await repo.listSleepSessions(userId, shiftDateStr(date, -HISTORY_DAYS), date)
  const nights = toVerdictNights(sessions, tz)
  const target = nights.find(n => n.date === date)
  // No sleep session for the night yet — the ring may not have drained. Say nothing and store
  // nothing, so the snapshot is not frozen against data that had not arrived.
  if (!target) return json({ verdict: null })

  const computed = sleepVerdictForNight(target, nights)
  // Below the coverage floor there is nothing honest to announce. Not an error state.
  if (!computed) return json({ verdict: null, baselineNightsRequired: VERDICT_BASELINE_NIGHTS })

  const record = {
    date,
    verdict: computed.verdict,
    triggered: computed.triggered,
    components: {
      durationHours: computed.components.duration,
      onsetMinutes: computed.components.onset,
      efficiency: computed.components.efficiency,
    },
    bands: {
      durationLow: computed.bands.duration?.low ?? null,
      durationHigh: computed.bands.duration?.high ?? null,
      onsetLow: computed.bands.onset?.low ?? null,
      onsetHigh: computed.bands.onset?.high ?? null,
      efficiencyLow: computed.bands.efficiency?.low ?? null,
      efficiencyHigh: computed.bands.efficiency?.high ?? null,
    },
    baselineNights: computed.baselineNights,
    modelVersion: computed.modelVersion,
  }
  await repo.upsertSleepVerdict(userId, record)
  return json({ verdict: { ...record, responseState: 'none' as const } })
}

/**
 * POST — record that the lifter answered the announcement.
 *
 * This route writes `response_state` and NOTHING else. It must never set a `touched` flag: an
 * announcement is the app's guess, and only the lifter's own correction is his answer (TN-57).
 * The correction's VALUE is written by the check-in save path, which already owns that column
 * and its touched flag.
 */
export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`sleep-verdict-respond:${userId}`, WRITE_LIMIT.max, WRITE_LIMIT.windowMs)) {
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

  const repo = await getRepository()
  const updated = await repo.setSleepVerdictResponse(userId, date, parsed.data.state)
  // Nothing was announced for that day, so there is nothing to answer. A 404 rather than a silent
  // 200: a response recorded against no announcement would be a label with no verdict beside it.
  if (!updated) return NextResponse.json({ error: 'No verdict announced for that date' }, { status: 404 })
  return json({ ok: true })
}

/** The app manages its own freshness through cache groups; a second HTTP cache underneath it is
 *  the one `invalidateCache()` cannot reach. */
function json(body: unknown) {
  return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })
}
