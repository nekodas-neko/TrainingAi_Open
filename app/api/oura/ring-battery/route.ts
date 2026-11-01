import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, midnightDaysAgoInTz } from '@trainingai/shared/date-utils'
import { summariseRingBattery } from '@trainingai/shared/health/ring-battery-health'

// The ring's battery and its health (#3069): the newest reading and how old it is, and the drain,
// days between charges, charge time and days left from every reading we hold, Bluetooth polls and
// Oura Cloud's `ring_battery_level` together (`oura_ble_battery_poll`, any `source`). Read-only, our
// own DB only; the Oura read happens on the webhook and the connect backfill. The window is 120 local
// days so the chart runs back through the Bluetooth history.
const WINDOW_DAYS = 120

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`oura-ring-battery:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const now = new Date()
  const repo = await getRepositoryAsync()
  const readings = await repo.getRingBatteryReadings(userId, midnightDaysAgoInTz(tz, WINDOW_DAYS - 1, now), now)
  return NextResponse.json(summariseRingBattery(readings, tz, now.getTime()), { headers: { 'Cache-Control': 'private, no-store' } })
}
