import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import {
  DEFAULT_TZ, normalizeDateParamIso, shiftDateStr, dateStrMidnightInTz, toAestDay,
  startOfWeekInTz, weekStartForDay,
} from '@trainingai/shared/date-utils'

/** How many completed weeks the window covers, the last being the recap week itself.
 *  Five points is "a monthly scale" with four prior weeks to average against — the same
 *  shape as the day route's eight points and seven prior. */
const WEEKS = 5

/** One completed Mon–Sun week. A stat is null when nothing was recorded for it that week —
 *  never 0, which would read as "you did nothing" rather than "nothing was measured". */
export interface MonthWindowWeek {
  /** The week's Monday, `YYYY-MM-DD`. */
  weekStart: string
  /** Mean of the days that recorded one. */
  restingHeartRate: number | null
  /** Mean DAILY steps, not the week's total — a total silently rewards a week with more
   *  recorded days, and days go unrecorded often enough here to matter. */
  steps: number | null
  /** SUM over the week. Volume is additive and a weekly total is the training-load reading the
   *  digest itself uses; a mean would answer a different question. */
  sessionVolumeKg: number | null
  /** Mean of the week's weigh-ins. */
  weightKg: number | null
}

export interface MonthWindowResponse {
  /** Echoed so a caller can tell which week it got — the Q-453 lesson from the sibling routes. */
  weekStart: string
  /** Ascending, `weekStart - 4 weeks` … `weekStart` inclusive: five points, the last being
   *  `weekStart` itself. */
  weeks: MonthWindowWeek[]
  /** Mean over the four weeks BEFORE `weekStart`, nulls excluded. Null when those weeks
   *  recorded nothing. */
  priorAverages: Omit<MonthWindowWeek, 'weekStart'>
}

// GET /api/weekly-review/month-window?weekStart=YYYY-MM-DD — the five-week series behind the
// weekly recap (LB-64).
//
// **Why a route rather than widening `/api/weekly-digest`.** That endpoint already computes these
// numbers and throws them away, returning only the model's prose, so returning them there looks
// cheaper. It is the wrong home: it is a POST that runs an LLM, rate-limited and cached as prose,
// and Q-293's note in its own source says the digest is deliberately re-derived because a late ring
// back-fill changes its inputs. A chart wants that freshness on a different clock from a paragraph
// the model wrote, and it wants a cacheable GET with its own TTL and invalidation entry.
//
// Deliberately the same four stats as `/api/day-review/week-window`, at weekly buckets. That route's
// own comment explains what is excluded and why (body composition moves too slowly to read as
// anything but noise; scores already carry `scoreBand()`'s word), and the reasoning does not change
// by widening the bucket.
export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const raw = new URL(req.url).searchParams.get('weekStart')
  // Absent means the last COMPLETED week, which is what the recap reviews — never the in-progress
  // one, where a Monday morning reads as a ~100% drop against the prior full week.
  // Present-but-malformed is a caller who asked for a specific week and mistyped it; answering with
  // a different week under their date is the silent substitution Q-453 found in a sibling route.
  const normalized = raw ? normalizeDateParamIso(raw) : shiftDateStr(startOfWeekInTz(tz), -7)
  if (!normalized) return NextResponse.json({ error: 'Invalid weekStart' }, { status: 400 })
  // Any day in the week is accepted and snapped to its Monday, so a caller need not know the
  // convention — but the response echoes the snapped value, so it can see which week it got.
  const weekStart = weekStartForDay(normalized)

  if (!rateLimit(`${userId}:weekly-review-month-window`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const from = shiftDateStr(weekStart, -7 * (WEEKS - 1))
  const to = shiftDateStr(weekStart, 6) // the recap week's Sunday, inclusive
  const repo = await getRepository()

  const [metrics, sessions] = await Promise.all([
    repo.listBodyMetrics(userId, from, to),
    // Anchored at the window's own local midnight, never `Date.now() - N × 86_400_000` — an
    // ms-offset window straddles two local days and merges them (CLAUDE.md, six prior copies).
    repo.getWorkoutSessionsFrom(userId, dateStrMidnightInTz(from, tz)),
  ])

  const weekKeys = Array.from({ length: WEEKS }, (_, i) => shiftDateStr(from, i * 7))
  const inWindow = new Set(weekKeys)

  const rhr = new Map<string, number[]>()
  const steps = new Map<string, number[]>()
  const weight = new Map<string, number[]>()
  const push = (m: Map<string, number[]>, key: string, v: number) => {
    const bucket = m.get(key)
    if (bucket) bucket.push(v); else m.set(key, [v])
  }
  for (const m of metrics) {
    const key = weekStartForDay(m.date)
    if (!inWindow.has(key)) continue
    if (m.restingHeartRate != null) push(rhr, key, m.restingHeartRate)
    if (m.steps != null) push(steps, key, m.steps)
    if (m.weightKg != null) push(weight, key, m.weightKg)
  }

  // Several sessions can share a week, so volume is summed rather than last-write-wins.
  const volumeByWeek = new Map<string, number>()
  for (const ws of sessions) {
    if (ws.exercises.length === 0) continue
    const day = toAestDay(ws.startedAt, tz)
    if (day < from || day > to) continue
    const key = weekStartForDay(day)
    const volume = ws.exercises.reduce((sum, ex) => sum + (ex.volume ?? 0), 0)
    volumeByWeek.set(key, (volumeByWeek.get(key) ?? 0) + volume)
  }

  const mean = (values: number[] | undefined): number | null =>
    values && values.length ? values.reduce((a, b) => a + b, 0) / values.length : null

  const weeks: MonthWindowWeek[] = weekKeys.map(key => {
    const volume = volumeByWeek.get(key)
    return {
      weekStart: key,
      restingHeartRate: mean(rhr.get(key)),
      steps: mean(steps.get(key)),
      sessionVolumeKg: volume == null ? null : Math.round(volume),
      weightKg: mean(weight.get(key)),
    }
  })

  // The mean excludes the recap week itself — comparing a week against a window it is inside pulls
  // the baseline toward the value being judged, which is what makes a delta read smaller than it is.
  const prior = weeks.slice(0, WEEKS - 1)
  const priorMean = (pick: (w: MonthWindowWeek) => number | null): number | null =>
    mean(prior.map(pick).filter((v): v is number => v != null))

  const body: MonthWindowResponse = {
    weekStart,
    weeks,
    priorAverages: {
      restingHeartRate: priorMean(w => w.restingHeartRate),
      steps: priorMean(w => w.steps),
      sessionVolumeKg: priorMean(w => w.sessionVolumeKg),
      weightKg: priorMean(w => w.weightKg),
    },
  }

  return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })
}
