import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { todayInTz, shiftDateStr, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { computeAdherenceRatio } from '@trainingai/shared/nutrition/adherence'

export interface NutritionAdherenceResponse {
  requiredMealTypeCount: number
  adherence7d: number | null
  adherence28d: number | null
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tz = session.user.timezone ?? DEFAULT_TZ

  const repo = await getRepository()
  const today = todayInTz(tz)
  const from28d = shiftDateStr(today, -27)

  const { requiredMealTypeCount, loggedByDay } = await repo.getRequiredMealTypeLogDays(userId, from28d, today)
  const loggedByDayMap = new Map(loggedByDay.map(r => [r.date, r.requiredMealTypesLogged]))

  const days28d = Array.from({ length: 28 }, (_, i) => shiftDateStr(today, -i))
  const days7d = days28d.slice(0, 7)

  return NextResponse.json({
    requiredMealTypeCount,
    adherence7d: computeAdherenceRatio(days7d, requiredMealTypeCount, loggedByDayMap),
    adherence28d: computeAdherenceRatio(days28d, requiredMealTypeCount, loggedByDayMap),
  } satisfies NutritionAdherenceResponse, { headers: { "Cache-Control": "private, no-store" } })
}
