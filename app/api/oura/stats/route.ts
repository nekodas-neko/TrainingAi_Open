import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { todayInTz, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import type { OuraDailyRow } from '@/lib/data/repository'

// Reads today's Oura rollup from our own DB. It deliberately makes NO call to the
// Oura Cloud API: since the direct-BLE re-key the ring sends the Cloud nothing, so
// a live battery read returns a frozen value the UI already discards in favour of
// /api/oura-ble/battery-latest, and ring configuration is static (the firmware is
// pinned on purpose to keep the reverse-engineered BLE protocol stable).
//
// Those two calls used to run on every request and made this route take ~1.4 s —
// the whole of the blank second on the Health screen, spent fetching constants.
// Everything else on that screen returns in single-digit ms.
export interface OuraStatsResponse {
  /** The ring has produced data over BLE. Until 2026-08-13 this meant "an Oura Cloud credential is
   *  stored", which had stopped being true of the ring and only stayed true of the dead row left in
   *  `oura_tokens` — so removing the Cloud integration would have silently hidden the Health tab's
   *  whole Ring section. It is a direct-BLE fact now. */
  connected: boolean
  daily: OuraDailyRow | null
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user.id
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const today = todayInTz(tz)

  const repo = await getRepositoryAsync()

  const bleMeasuredAt = await repo.getLatestOuraBleMeasuredAt(userId)

  if (!bleMeasuredAt) {
    return NextResponse.json(
      { connected: false, daily: null } satisfies OuraStatsResponse,
      { headers: { "Cache-Control": "private, no-store" } },
    )
  }

  const ouraRows = await repo.getOuraDaily(userId, today, today)

  return NextResponse.json({
    connected: true,
    daily: ouraRows[0] ?? null,
  } satisfies OuraStatsResponse, { headers: { "Cache-Control": "private, no-store" } })
}
