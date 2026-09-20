import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { rateLimit } from '@/lib/rate-limit'

// TN-54. `PolarStrapService` already knows whether it is connected, what the battery reads and how
// many times it has failed — and kept every bit of it in memory. `status()` goes to the Capacitor
// event sink, so the only way to see a dying strap was to have the app open while it died. Five
// days of silence (2026-09-15 → 20) produced no row, no fault and no clue, while the ring wrote
// 455 samples the same night through this same phone.
//
// Session-authenticated, matching `/api/hr-ingest` — the strap's own poster attaches the WebView
// cookie, and this rides that path. Deliberately NOT admin-gated like `oura-ble/battery-poll`: a
// status this route rejects is a status nobody ever sees, which is the defect.
const MAX_BODY_BYTES = 4 * 1024

// `.strict()`, and the state is a bounded string rather than an enum: the states belong to the
// service (`idle`, `scanning`, `connected`, `retrying`, `gave-up`) and a new one must be RECORDABLE
// without a deploy on both sides. An enum here would reject exactly the novel state worth seeing.
const BodySchema = z.object({
  state: z.string().min(1).max(40),
  batteryPercent: z.number().int().min(0).max(100).nullable().optional(),
  /** Epoch ms of the strap's last good sample. Bounded structurally, like `hr-ingest`'s `at`: an
   *  unbounded value makes `new Date()` Invalid and 500s the driver. */
  lastSampleAt: z.number().int().min(0).max(8_640_000_000_000_000).nullable().optional(),
  consecutiveFailures: z.number().int().min(0).max(10_000).optional(),
  worn: z.boolean().nullable().optional(),
}).strict()

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  // The service posts on state changes, not on a timer, so this bounds a retry storm rather than
  // normal use — a strap reconnecting every few seconds is itself worth recording, up to a point.
  if (!rateLimit(`strap-status:${userId}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const parsed = BodySchema.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const repo = await getRepositoryAsync()
  await repo.insertStrapStatus(userId, {
    state: parsed.data.state,
    batteryPercent: parsed.data.batteryPercent ?? null,
    lastSampleAt: parsed.data.lastSampleAt != null ? new Date(parsed.data.lastSampleAt) : null,
    consecutiveFailures: parsed.data.consecutiveFailures ?? 0,
    worn: parsed.data.worn ?? null,
  })
  return NextResponse.json({ ok: true })
}

// The read half. The question it answers is the owner's own: "I slept with the strap on last night,
// did it record what we needed?" — which `latest` answers directly and `recent` explains.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepositoryAsync()
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000)
  const [latest, recent] = await Promise.all([
    repo.getLatestStrapStatus(session.user.id),
    repo.listStrapStatus(session.user.id, since, 200),
  ])
  // `null` is the honest answer for a device that has never reported, and it is what every day
  // before this route shipped looks like. A caller must be able to tell that from "reachable".
  return NextResponse.json({ latest, recent }, { headers: { 'Cache-Control': 'private, no-store' } })
}
