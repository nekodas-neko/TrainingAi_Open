import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { dsFromMeasuredAtMs } from '@/lib/oura-ble/decode'
import { isPlausibleStepWindow } from '@trainingai/shared/health/step-estimate'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One step window: two timestamps and a count.
const MAX_BODY_BYTES = 4 * 1024

// Product write (not admin-gated, unlike the spike-ingest routes under app/api/oura-ble/samples/) —
// stores an accurate live-counted step window (Tier 2 of the step-orchestration plan). The rollup
// merges these with the gate estimate; see lib/health/step-estimate.ts (mergeStepSources).
//
// Accepts EITHER ring deciseconds or wall-clock time. The Chunk B auto-orchestrator triggers off
// gate frames (0x7e/0x7f, history events with a real embedded ring ds) and can send startDs/endDs
// directly. The Chunk A manual tester triggers off accel-only frames (0x33), which carry no ring
// timestamp at all (only sampleRate/seq/samples) — it sends wall-clock instants instead, and this
// route converts them to ds via the user's latest clock anchor (the same anchor the rollup itself
// uses for the reverse conversion).
const DsWindowSchema = z.object({
  startDs: z.number().int().nonnegative(),
  endDs: z.number().int().nonnegative(),
  steps: z.number().int().min(0).max(20_000),
}).refine(d => d.startDs < d.endDs, { message: 'startDs must be before endDs' })
  .refine(d => d.endDs - d.startDs <= 4 * 3600 * 10, { message: 'window must not exceed 4 hours' })

const WallClockWindowSchema = z.object({
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  steps: z.number().int().min(0).max(20_000),
}).refine(d => new Date(d.startedAt).getTime() < new Date(d.endedAt).getTime(), { message: 'startedAt must be before endedAt' })
  .refine(d => new Date(d.endedAt).getTime() - new Date(d.startedAt).getTime() <= 4 * 3600 * 1000, { message: 'window must not exceed 4 hours' })

const LiveStepsSchema = z.union([DsWindowSchema, WallClockWindowSchema])

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`oura-ble-live-steps:${session.user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = LiveStepsSchema.safeParse(read.body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const repo = await getRepositoryAsync()

  // A window written here OVERRIDES the ring's own step model for the span it covers, so an
  // impossible count does not merely add noise — it replaces good data. The schema's bounds (steps
  // <= 20k, window <= 4h) allowed 3,605 steps in 13 minutes (288/min) through, which turned a
  // 1,578-step day into a displayed 4,903. Reject rather than clamp: a count above the gait
  // detector's own cadence ceiling means the counter faulted, and there is no honest way to guess
  // what it should have been. Failing closed here matches the ingest posture everywhere else.
  const reject = () => NextResponse.json(
    { error: 'Implausible step cadence for the window duration', code: 'implausible_cadence' },
    { status: 400 },
  )

  if ('startDs' in parsed.data) {
    const { startDs, endDs, steps } = parsed.data
    // ds is deciseconds, so ×100 converts the span to the ms basis the shared check expects.
    if (!isPlausibleStepWindow(steps, startDs * 100, endDs * 100)) return reject()
    const row = await repo.upsertStepLiveWindow(session.user.id, { startDs, endDs, steps })
    return NextResponse.json(row)
  }

  const { startedAt, endedAt, steps } = parsed.data
  const startedAtMs = new Date(startedAt).getTime()
  const endedAtMs = new Date(endedAt).getTime()
  // Checked before the anchor lookup: an impossible window is invalid regardless of whether the ring
  // has ever been synced, and this keeps the response for bad input independent of account state.
  if (!isPlausibleStepWindow(steps, startedAtMs, endedAtMs)) return reject()

  const anchor = await repo.getOuraClockAnchor(session.user.id)
  if (!anchor) {
    return NextResponse.json({ error: 'No ring clock anchor yet — sync the ring at least once first' }, { status: 422 })
  }

  const anchorUtcMs = anchor.anchorUtc.getTime()
  const startDs = Math.round(dsFromMeasuredAtMs(startedAtMs, anchor.anchorDs, anchorUtcMs))
  const endDs = Math.round(dsFromMeasuredAtMs(endedAtMs, anchor.anchorDs, anchorUtcMs))

  const row = await repo.upsertStepLiveWindow(session.user.id, { startDs, endDs, steps })
  return NextResponse.json(row)
}
