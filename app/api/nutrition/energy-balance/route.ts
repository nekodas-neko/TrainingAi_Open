import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, normalizeDateParamIso } from '@trainingai/shared/date-utils'
import { computeEnergyBalance, type EnergyBalanceResult } from '@/lib/health/energy-balance-service'

export type EnergyBalanceResponse = EnergyBalanceResult

export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const raw = req.nextUrl.searchParams.get('date')
  // Accepts both separators: clients fill this from localDateString(), which emits slashes.
  const date = raw ? normalizeDateParamIso(raw) : todayInTz(tz)
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  const repo = await getRepository()
  const result = await computeEnergyBalance(repo, userId, tz, date)

  return NextResponse.json<EnergyBalanceResponse>(result, {
    // Folds live today intake/activity totals — must never be served stale. Matches
    // /api/body-metadata's deliberate no-store, not the sibling SWR header.
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
