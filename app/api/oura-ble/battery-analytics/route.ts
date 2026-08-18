import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { analyzeRingBattery } from '@trainingai/shared/health/ring-battery'

// Admin R&D probe: the owner's three battery questions (daily drain, charge-per-session, avg charging
// time) from the ring's 0x61 battery telemetry over the last N days. Read-only. History is forward-only
// from the un-drop — the console will read empty until the ring next drains post-deploy.
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id
  try {
    await requireAdmin(userId, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }
  if (!rateLimit(`oura-ble-battery:${userId}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const daysParam = Number(new URL(req.url).searchParams.get('days'))
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(30, Math.max(1, daysParam)) : 7

  const to = new Date()
  const from = new Date(to.getTime() - days * 86_400_000)
  const repo = await getRepositoryAsync()
  const events = await repo.getOuraBatteryEvents(userId, from, to)
  const analytics = analyzeRingBattery(events)
  // Live keepalive polls (migration 133): fine-grained drain samples captured only while the app
  // held the BLE link — a distinct, higher-resolution series alongside the forward-only 0x61 history.
  const livePolls = await repo.getOuraBatteryPolls(userId, from, to)
  return NextResponse.json({ days, eventCount: events.length, ...analytics, livePolls })
}
