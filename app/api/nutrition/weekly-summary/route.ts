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
  return NextResponse.json(summary, { headers: { "Cache-Control": "private, no-store" } })
}
