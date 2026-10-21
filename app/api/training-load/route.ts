import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { computeVolumeAcwr, computeMonotonyStrain, computeBlockTrendSeries, trainingLoadBand, LOAD_WINDOW_DAYS, type BlockTrendSeries } from '@trainingai/shared/ai-periodization/acwr'
import { toAestDay, todayInTz, dateStrMidnightInTz, shiftDateStr, DEFAULT_TZ } from '@trainingai/shared/date-utils'

export interface TrainingLoadResponse {
  acwr: number | null
  acuteLoad: number
  chronicLoad: number
  interpretation: 'optimal' | 'high' | 'very_high' | 'low' | 'insufficient_data' | 'baselining'
  baselineDaysRemaining?: number
  monotony: number | null
  strain: number | null
  /** 28:90 block trend: a trend line and an insight only, it gates nothing (#2740). */
  blockTrend: BlockTrendSeries
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tz = session.user.timezone ?? DEFAULT_TZ

  const repo = await getRepository()
  const today = todayInTz(tz)
  const todayMid = dateStrMidnightInTz(today, tz)

  // One 90-day read feeds the 7:28 ACWR, the monotony week and the 28:90 block trend: each window
  // filters what it needs, so the superset changes none of the existing numbers.
  const from90d = dateStrMidnightInTz(shiftDateStr(today, -LOAD_WINDOW_DAYS.block), tz)
  const sessions = await repo.getSessionLoadsFrom(userId, from90d)

  const load = computeVolumeAcwr(
    sessions.map(ws => ({ startedAt: ws.startedAt, volumeKg: ws.volume })),
    todayMid,
    { tz },
  )
  // Training monotony (Foster) — mean/SD of the last 7 local calendar days' load.
  // Independent of the ACWR gates below: it only needs a week of history, so it
  // can render even while ACWR itself is still "insufficient_data"/"baselining".
  const last7Days = Array.from({ length: 7 }, (_, i) => shiftDateStr(today, -i))
  const loadByDay = new Map(last7Days.map(d => [d, 0]))
  for (const ws of sessions) {
    const day = toAestDay(ws.startedAt, tz)
    if (loadByDay.has(day)) loadByDay.set(day, (loadByDay.get(day) ?? 0) + ws.volume)
  }
  const { monotony, strain } = computeMonotonyStrain([...loadByDay.values()])

  // One band builder shared with the chat tool (OR-210): insufficient data, then a program too young
  // for its chronic baseline, then the band. The program is read for every response so a young program
  // is reported as baselining rather than as a number.
  const program = await repo.getActiveProgram(userId)
  const band = trainingLoadBand(load, program, todayMid)

  return NextResponse.json({
    ...band,
    monotony, strain,
    blockTrend: computeBlockTrendSeries(
      sessions.map(ws => ({ startedAt: ws.startedAt, volumeKg: ws.volume })), today, { tz },
    ),
  } satisfies TrainingLoadResponse, { headers: { "Cache-Control": "private, no-store" } })
}
