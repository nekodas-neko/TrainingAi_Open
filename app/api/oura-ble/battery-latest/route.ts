import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'

// User-scoped latest live ring-battery reading, from the direct-BLE keepalive polls
// (migration 133). Distinct from the frozen Oura Cloud battery (stale since the 2026-07-07
// re-key) — this is the value the Ring Status card should prefer when it's fresh. Read-only,
// authed as the owner (not admin-gated like the R&D analytics probe).
export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`oura-ble-battery-latest:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const to = new Date()
  const from = new Date(to.getTime() - 3 * 86_400_000) // 3-day window; older than that isn't "live"
  const repo = await getRepositoryAsync()
  const polls = await repo.getOuraBatteryPolls(userId, from, to)
  if (polls.length === 0) {
    return NextResponse.json(
      { latest: null },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  const latest = polls.reduce((a, b) => (b.tsMs > a.tsMs ? b : a))
  const ageMinutes = Math.round((to.getTime() - latest.tsMs) / 60_000)
  return NextResponse.json(
    { latest: { percent: latest.percent, charging: latest.charging, tsMs: latest.tsMs, ageMinutes } },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
