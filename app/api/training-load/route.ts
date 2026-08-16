import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { computeVolumeAcwr, computeMonotonyStrain, acwrBand } from '@trainingai/shared/ai-periodization/acwr'
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
  const acuteLoad = load.acuteLoadKg
  const chronicAvg = load.chronicWeeklyAvgKg

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

  if (load.acwr == null) {
    return NextResponse.json({
      acwr: null,
      acuteLoad: Math.round(acuteLoad),
      chronicLoad: Math.round(chronicAvg),
      interpretation: 'insufficient_data',
      monotony, strain,
    } satisfies TrainingLoadResponse, { headers: { "Cache-Control": "private, no-store" } })
  }

  // If the active program started within the last 28 days, the chronic baseline
  // still includes sessions from the previous routine — ACWR is unreliable.
  const program = await repo.getActiveProgram(userId)
  const programStart = program?.startedAt
    ? new Date(program.startedAt)
    : program?.createdAt ?? null
  if (programStart) {
    const daysSinceStart = Math.floor((todayMid.getTime() - programStart.getTime()) / 86_400_000)
    if (daysSinceStart < 28) {
      return NextResponse.json({
        acwr: null,
        acuteLoad: Math.round(acuteLoad),
        chronicLoad: Math.round(chronicAvg),
        interpretation: 'baselining',
        baselineDaysRemaining: 28 - daysSinceStart,
        monotony, strain,
      } satisfies TrainingLoadResponse, { headers: { "Cache-Control": "private, no-store" } })
    }
  }

  const acwr = load.acwr

  return NextResponse.json({
    acwr: parseFloat(acwr.toFixed(2)),
    acuteLoad: Math.round(acuteLoad),
    chronicLoad: Math.round(chronicAvg),
    interpretation: acwrBand(acwr).key,
    monotony, strain,
  } satisfies TrainingLoadResponse, { headers: { "Cache-Control": "private, no-store" } })
}
