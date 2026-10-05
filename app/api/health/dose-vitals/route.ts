import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { reportServerError } from '@/lib/observability'
import { DEFAULT_TZ, todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { DOSE_EFFECT_LOOKBACK_DAYS, type DoseEvent } from '@trainingai/shared/health/dose-context'

/**
 * TN-46 — the two halves the app already held and never joined: vial-dosed administrations, and
 * each night's resting HR and HRV beside the baseline stored FOR THAT NIGHT. The per-night baseline
 * is the pre-intervention reference: the row before a first dose keeps its baseline however far the
 * live one adapts afterwards, so no snapshot is needed.
 *
 * For an overlay (Lane B). The response is lag-aware on purpose: `effectLookbackDays` says how far
 * after a dose an effect was measured to last, because a same-day comparison finds nothing.
 */

const DEFAULT_DAYS = 60
const MAX_DAYS = 180

export interface DoseVitalsNight {
  date: string
  restingHr: number | null
  hrvMs: number | null
  restingHrBaseline: number | null
  hrvBaseline: number | null
}

export interface DoseVitalsResponse {
  from: string
  to: string
  effectLookbackDays: number
  doses: DoseEvent[]
  nights: DoseVitalsNight[]
}

const fromX8 = (x: number | null | undefined) => (x == null ? null : Math.round((x / 8) * 10) / 10)

export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`dose-vitals:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const raw = Number(req.nextUrl.searchParams.get('days') ?? DEFAULT_DAYS)
  const days = Number.isFinite(raw) ? Math.min(MAX_DAYS, Math.max(7, Math.round(raw))) : DEFAULT_DAYS
  const to = todayInTz(session.user?.timezone ?? DEFAULT_TZ)
  const from = shiftDateStr(to, -(days - 1))

  try {
    const repo = await getRepository()
    const [doses, summaries] = await Promise.all([
      repo.listDoseEvents(userId, from, to),
      repo.getOuraDailySummary(userId, from, to),
    ])
    const nights: DoseVitalsNight[] = summaries.map(s => ({
      date: s.date,
      // The night's LOW, not its mean: the stored baseline tracks the lows (09-06: low 51.7, mean
      // 59.9, baseline 52.9), so a mean would sit ~7 bpm above its own reference every night.
      restingHr: s.rhrLowBpm,
      hrvMs: s.hrvAvgMs,
      restingHrBaseline: fromX8(s.rhrBaseline?.meanX8),
      hrvBaseline: fromX8(s.hrvBaseline?.meanX8),
    }))
    const body: DoseVitalsResponse = { from, to, effectLookbackDays: DOSE_EFFECT_LOOKBACK_DAYS, doses, nights }
    return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    reportServerError(err, { userId, url: req.nextUrl.pathname })
    return NextResponse.json({ error: 'Could not load dose and vitals' }, { status: 500 })
  }
}
