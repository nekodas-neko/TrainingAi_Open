import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { ensureSchema } from '@/lib/data/postgres/client'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, shiftDateStr, startOfWeekInTz } from '@trainingai/shared/date-utils'

const WEEKS = 6

export interface MuscleTonnageTrendResponse {
  // Oldest → newest, one entry per week (Monday date, local tz)
  weekStarts: string[]
  // muscle name -> tonnage (kg) per week, same order/length as weekStarts
  muscles: Record<string, number[]>
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const tz = session.user.timezone ?? DEFAULT_TZ
  const thisWeekStart = startOfWeekInTz(tz)
  const weekStarts = Array.from({ length: WEEKS }, (_, i) => shiftDateStr(thisWeekStart, -7 * (WEEKS - 1 - i)))

  // #2420 — this used to carry its own copy of the muscle-attribution SQL (library roles at 1.0 main
  // / 0.5 secondary, free-text tags at full weight). It now reads the shared query in
  // slices/periodization.ts, which buckets each set by the LOCAL calendar date of its own
  // `logged_at` into weeks anchored on the oldest Monday — the week boundaries this chart always had.
  // Rows arrive with canonical muscle keys, so "core" and "abs" are one line, not two.
  const repo = await getRepository()
  const rows = await repo.getMuscleTonnageByWeek(userId, weekStarts[0], todayInTz(tz), tz)

  const muscles: Record<string, number[]> = {}
  for (const row of rows) {
    const weekIdx = weekStarts.indexOf(row.weekStart)
    if (weekIdx === -1) continue
    if (!muscles[row.muscle]) muscles[row.muscle] = new Array(WEEKS).fill(0)
    muscles[row.muscle][weekIdx] += row.tonnageKg
  }

  return NextResponse.json({
    weekStarts,
    muscles,
  } satisfies MuscleTonnageTrendResponse, { headers: { "Cache-Control": "private, no-store" } })
}
