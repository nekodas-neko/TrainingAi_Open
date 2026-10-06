import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { DetectionEventBatchSchema } from '@trainingai/shared/validation/detection-event'
import { rateLimit } from '@/lib/rate-limit'

// #2478. Walk auto-detection's funnel (candidate → confirmed → notified → offered → saved |
// dismissed), posted by the phone's outbox in `lib/activity/detection-events.ts`. Found by #2471:
// detection is right about one time in ten, and every event that could say why lived only on the
// phone.
//
// A new route rather than the sync push: the sync engine carries rows the device stores and reads
// back, and nothing on the device reads these. They are append-only telemetry with their own
// natural key, so a retried batch is a no-op here (insert ... on conflict do nothing).
//
// Session-authenticated, not admin-gated: detection runs for every user, and these are that user's
// own rows. Ownership comes from the session; the one client-supplied id (`detectionId`) only ever
// lands under this user, and an existing row is never updated.
const MAX_BODY_BYTES = 32 * 1024

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  // The outbox flushes after each event (debounced), on resume and on start, ≤50 events a post. A
  // probe emits two or three events, so this bounds a loop, not a busy walking day.
  if (!rateLimit(`detection-events:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const parsed = DetectionEventBatchSchema.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const repo = await getRepositoryAsync()
  const inserted = await repo.insertDetectionEvents(userId, parsed.data.events.map(e => ({
    detectionId: e.detectionId.toLowerCase(),
    kind: e.kind,
    gate: e.gate,
    occurredAt: new Date(e.occurredAt),
    triggerSource: e.trigger ?? null,
    activityType: e.activityType ?? null,
    sessionStartAt: e.sessionStartAt != null ? new Date(e.sessionStartAt) : null,
    distanceM: e.distanceM ?? null,
    elapsedSec: e.elapsedSec ?? null,
    pointCount: e.pointCount ?? null,
    avgSpeedMs: e.avgSpeedMs ?? null,
  })))
  return NextResponse.json({ ok: true, inserted }, { headers: { 'Cache-Control': 'private, no-store' } })
}
