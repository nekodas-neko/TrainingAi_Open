import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { computeVolumeAcwr, computeMonotonyStrain, trainingLoadBand } from '@trainingai/shared/ai-periodization/acwr'
import { toAestDay, todayInTz, todayMidnightUtc, shiftDateStr, DEFAULT_TZ } from '@trainingai/shared/date-utils'

export interface TrainingLoadResponse {
  acwr: number | null
  acuteLoad: number
  chronicLoad: number
  interpretation: 'optimal' | 'high' | 'very_high' | 'low' | 'insufficient_data' | 'baselining'
  baselineDaysRemaining?: number
  monotony: number | null
  strain: number | null
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tz = session.user.timezone ?? DEFAULT_TZ

  const repo = await getRepository()
  const todayMid = todayMidnightUtc(tz)
  const from28d = new Date(todayMid.getTime() - 28 * 86_400_000)

  const sessions = await repo.getSessionLoadsFrom(userId, from28d)

  const load = computeVolumeAcwr(
    sessions.map(ws => ({ startedAt: ws.startedAt, volumeKg: ws.volume })),
    todayMid,
  )
  // Training monotony (Foster) — mean/SD of the last 7 local calendar days' load.
  // Independent of the ACWR gates below: it only needs a week of history, so it
  // can render even while ACWR itself is still "insufficient_data"/"baselining".
  const today = todayInTz(tz)
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
  } satisfies TrainingLoadResponse, { headers: { "Cache-Control": "private, no-store" } })
}
