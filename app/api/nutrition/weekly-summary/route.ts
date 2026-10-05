import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const today = todayInTz(tz)
  // Overflow-safe date arithmetic (shiftDateStr), matching the sibling adherence route — never
  // the banned Date.now() − N×86400000 ms-offset pattern (can straddle two local days).
  const from = shiftDateStr(today, -6)
  const repo = await getRepository()
  const summary = await repo.listFoodLogsSummary(userId, from, today)

  // RV-218 ④: always seven rows. The aggregate omits a day with no logs, so a "7-day" chart drew
  // five bars. This route is the only layer that knows the window, so the padding happens here.
  // An unlogged day is `logged: false` with zeros: the chart must not average it in or read it
  // as a day he ate nothing. `isToday` is marked here because this is where the user's timezone
  // is known. The chart used to take the last row as today, which was yesterday on any morning
  // before the first log.
  const byDate = new Map(summary.map(r => [r.date, r]))
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = shiftDateStr(from, i)
    const row = byDate.get(date)
    return row
      ? { ...row, logged: true, isToday: date === today }
      : { date, calories: 0, proteinG: 0, carbsG: 0, fatG: 0, logged: false, isToday: date === today }
  })
  return NextResponse.json(days, { headers: { "Cache-Control": "private, no-store" } })
}
