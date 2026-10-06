import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { rateLimit } from '@/lib/rate-limit'

// #2469. `OuraRingService` counts connects, drops and connected time and kept them in memory, so a
// gap in `oura_ble_battery_poll` could not be read as "link down" versus "no network". The WebView
// reads them from `getStatus()` and posts them here (`lib/oura-ble/link-stats.ts`); the service
// itself is unchanged. Admin-gated like its siblings `battery-poll` and `samples`: the ring is the
// owner's, and a stranger's counters have nowhere meaningful to go.
const MAX_BODY_BYTES = 4 * 1024

// Bounds are structural, not plausibility checks: they keep a value out of `new Date()`'s Invalid
// range and inside the columns' types. A real but surprising number (a churn storm) must record.
const MAX_EPOCH_MS = 8_640_000_000_000_000
const MAX_DURATION_MS = 1_000_000_000_000 // ~31 years, inside BIGINT and Number.MAX_SAFE_INTEGER
const MAX_COUNT = 2_000_000_000 // INTEGER

const BodySchema = z.object({
  /** Epoch ms the service instance started (device: now − serviceUptimeMs). The reset key. */
  serviceStartedAt: z.number().int().min(0).max(MAX_EPOCH_MS),
  serviceUptimeMs: z.number().int().min(0).max(MAX_DURATION_MS),
  // A bounded string, not an enum: the states are the service's own, and a new one must be
  // recordable without deploying both halves.
  state: z.string().min(1).max(40),
  connectCount: z.number().int().min(0).max(MAX_COUNT),
  dropCount: z.number().int().min(0).max(MAX_COUNT),
  totalConnectedMs: z.number().int().min(0).max(MAX_DURATION_MS),
  lastTimeToConnectMs: z.number().int().min(0).max(MAX_COUNT).nullable().optional(),
  consecutiveFailures: z.number().int().min(0).max(MAX_COUNT).nullable().optional(),
}).strict()

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  try {
    await requireAdmin(userId, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  // The client posts at most once every 15 minutes; this bounds a loop, not normal use.
  if (!rateLimit(`oura-ble-link-stats:${userId}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const parsed = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason }, { status: 400 })
  const result = BodySchema.safeParse(parsed.body)
  if (!result.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const b = result.data
  const repo = await getRepositoryAsync()
  await repo.insertOuraLinkStats(userId, {
    serviceStartedAt: new Date(b.serviceStartedAt),
    serviceUptimeMs: b.serviceUptimeMs,
    state: b.state,
    connectCount: b.connectCount,
    dropCount: b.dropCount,
    totalConnectedMs: b.totalConnectedMs,
    lastTimeToConnectMs: b.lastTimeToConnectMs ?? null,
    consecutiveFailures: b.consecutiveFailures ?? null,
  })
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
}
