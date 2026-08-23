import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { runStepCounterPipeline, type RawFrame } from '@/lib/oura-ble/step-counter-pipeline'
import { nodeModelRuntime } from '@/lib/oura-models/inference/runtime-node'
import { ensureServerOuraConstants } from '@/lib/oura-models/constants-inject'
import { resolveDsToMs } from '@/lib/oura-ble/clock'

// Admin validation console (owner-only): runs the real-data step pipeline
// (0x7e/0x7f → steps_motion_decoder → step_counter) over the newest stored raw frames and returns
// the step counts + decoded stride-frequency summary, so the owner can compare against a phone's
// count and confirm the unpack27 → data_columns column mapping. Read-only; server-only ONNX.
//
// NB: this is a VALIDATION tool, not a trusted count — see lib/oura-ble/step-counter-pipeline.ts.

const STEP_TAGS = [0x7e, 0x7f]
const MOTION_TAG = 0x47

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(50).max(1000).default(1000),
})

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  if (!rateLimit(`oura-ble-step-export:${session.user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const parsed = QuerySchema.safeParse({ limit: req.nextUrl.searchParams.get('limit') ?? undefined })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  const { limit } = parsed.data

  const repo = await getRepositoryAsync()
  const anchors = await repo.getOuraClockAnchors(session.user.id)
  if (anchors.length === 0) return NextResponse.json({ hasAnchor: false })

  // Newest `limit` frames for each stream (the reader caps at 1000 and returns newest-first).
  const [stepRows, motionRows] = await Promise.all([
    repo.getOuraRawSamplesByTags(session.user.id, STEP_TAGS, limit),
    repo.getOuraRawSamplesByTags(session.user.id, [MOTION_TAG], limit),
  ])
  const toFrame = (r: { ringTimestampDs: number; tag: number; bodyHex: string }): RawFrame => ({
    ringTimestampDs: r.ringTimestampDs,
    tag: r.tag,
    bodyHex: r.bodyHex,
  })
  // Chronological order (the reader returns newest-first).
  const byDs = (a: RawFrame, b: RawFrame): number => a.ringTimestampDs - b.ringTimestampDs
  const stepFrames = stepRows.map(toFrame).sort(byDs)
  const motionFrames = motionRows.map(toFrame).sort(byDs)

  ensureServerOuraConstants()
  const result = await runStepCounterPipeline(stepFrames, motionFrames, (ds) => resolveDsToMs(ds, anchors) ?? 0, nodeModelRuntime)
  if (!result) {
    return NextResponse.json({ hasAnchor: true, pairedWindows: 0, message: 'No paired 0x7e/0x7f step windows in the stored frames.' })
  }

  const hz = result.strideFrequencyHz.filter((v) => Number.isFinite(v))
  const sorted = [...hz].sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null
  // Typical walking cadence lands ~1.5–3 Hz — a coarse sanity band for the decoded stride frequency.
  const inWalkingBand = hz.filter((v) => v >= 1.5 && v <= 3).length

  return NextResponse.json(
    {
      hasAnchor: true,
      generatedAtDs: { first: stepFrames[0]?.ringTimestampDs ?? null, last: stepFrames[stepFrames.length - 1]?.ringTimestampDs ?? null },
      stepFrames: stepFrames.length,
      motionFramesUsed: result.motionFrames,
      pairedWindows: result.pairedWindows,
      stepCounterTotal: Math.round(result.totalSteps),
      gateEstimateSteps: result.gateEstimateSteps,
      strideFrequencyHz: {
        subRows: hz.length,
        min: sorted[0] ?? null,
        median,
        max: sorted[sorted.length - 1] ?? null,
        inWalkingBand,
      },
      stepWindows: result.stepWindows.map((w) => ({ startMs: w.startMs, endMs: w.endMs, steps: Math.round(w.steps * 100) / 100 })),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
