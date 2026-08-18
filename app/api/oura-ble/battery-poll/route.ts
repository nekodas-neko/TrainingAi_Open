import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { rateLimit } from '@/lib/rate-limit'

// Direct-BLE: the native service persists its live keepalive battery poll here (migration 133).
// measured_at is server-stamped (the poll is live, so receive ≈ measure). Admin-gated (spike),
// same as the sample-ingest route. A dropped poll is inconsequential — the next tick re-posts.
const MAX_BODY_BYTES = 4 * 1024
const BodySchema = z.object({
  percent: z.number().int().min(0).max(100),
  charging: z.boolean().nullable().optional(),
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

  if (!rateLimit(`oura-ble-battery-poll:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const parsed = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason }, { status: 400 })
  const result = BodySchema.safeParse(parsed.body)
  if (!result.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const repo = await getRepositoryAsync()
  await repo.insertOuraBatteryPoll(userId, result.data.percent, result.data.charging ?? null)
  return NextResponse.json({ ok: true })
}
