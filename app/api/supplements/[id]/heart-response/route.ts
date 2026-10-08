import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { reportServerError } from '@/lib/observability'
import { invalidUuidResponse } from '@/lib/api/route-errors'
import { DEFAULT_TZ, todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import type { RecoveryDose, RecoveryNight } from '@/components/nutrition/reta/weight-response'

/**
 * Issue 2152 — the two inputs of `recoveryResponse` for ONE supplement: its dose logs (with the
 * time taken) and each night's resting HR and HRV. Raw inputs, not a verdict: the model runs in the
 * card so the reader gets the same numbers from the same function wherever it is shown.
 *
 * Resting HR is the night's LOW (`rhrLowBpm`), HRV the night's average, exactly as the dose/vitals
 * overlay reads them, so the two cards never disagree about what a night was.
 *
 * The window is the longest the overlay allows. The baseline is the nights BEFORE the first dose in
 * the window, so a window that opens after the first dose ever would fold dosed nights into the
 * reference; 180 days covers a course the owner has been on for weeks, not years.
 */
const WINDOW_DAYS = 180

export interface HeartResponseInputs {
  doses: RecoveryDose[]
  nights: RecoveryNight[]
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const bad = invalidUuidResponse(id)
  if (bad) return bad
  if (!rateLimit(`heart-response:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const to = todayInTz(session.user?.timezone ?? DEFAULT_TZ)
  const from = shiftDateStr(to, -(WINDOW_DAYS - 1))

  try {
    const repo = await getRepository()
    const [history, summaries] = await Promise.all([
      repo.listDoseHistory(userId, from, to),
      repo.getOuraDailySummary(userId, from, to),
    ])
    // `listDoseHistory` is already scoped to this user; filtering by the path id only narrows it.
    const doses: RecoveryDose[] = history.logs
      .filter(l => l.supplementId === id)
      .map(l => ({
        supplementId: l.supplementId, supplementName: l.supplementName, date: l.date,
        amount: l.amount, unit: l.unit, doseText: l.doseText, takenAt: l.takenAt,
      }))
    const nights: RecoveryNight[] = summaries.map(s => ({ date: s.date, restingHr: s.rhrLowBpm, hrvMs: s.hrvAvgMs }))
    const body: HeartResponseInputs = { doses, nights }
    return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    reportServerError(err, { userId, url: req.nextUrl.pathname })
    return NextResponse.json({ error: 'Could not load the heart response' }, { status: 500 })
  }
}
