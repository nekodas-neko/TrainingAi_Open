import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { runComparison } from '@/lib/oura-comparison-harness'
import { ringVsH10HrAdapter, dhrvVsH10Adapter } from '@/lib/oura-comparison-harness-adapters'

// D6 admin spot-check: ring-derived HR vs Polar H10 HR (default) or D5's own daytime-HRV vs the
// H10's RR-derived rMSSD (?metric=hrv) over a recent window. Read-only, admin-only tooling — no
// live-path dependency.
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id
  try {
    await requireAdmin(userId, session.user.isAdmin)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!rateLimit(`oura-ble-comparison-harness:${userId}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const url = new URL(req.url)
  const startParam = url.searchParams.get('start')
  const endParam = url.searchParams.get('end')
  let startIso: string
  let endIso: string
  if (startParam && endParam) {
    startIso = startParam
    endIso = endParam
  } else {
    const minutesParam = Number(url.searchParams.get('minutes'))
    const minutes = Number.isFinite(minutesParam) && minutesParam > 0 ? Math.min(minutesParam, 24 * 60) : 15
    const now = new Date()
    startIso = new Date(now.getTime() - minutes * 60_000).toISOString()
    endIso = now.toISOString()
  }

  const metric = url.searchParams.get('metric') === 'hrv' ? 'hrv' : 'hr'
  const repo = await getRepositoryAsync()
  const adapter = metric === 'hrv' ? dhrvVsH10Adapter(repo) : ringVsH10HrAdapter(repo)
  const result = await runComparison(adapter, userId, startIso, endIso)
  return NextResponse.json(result)
}
