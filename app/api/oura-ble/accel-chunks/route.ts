import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { dsFromMeasuredAtMs } from '@/lib/oura-ble/decode'
import { countGaitGatedSteps } from '@/lib/oura-ble/gait-step-count'
import { isPlausibleStepWindow } from '@trainingai/shared/health/step-estimate'

// Continuous-capture ingest (ring-only accurate step counter, Chunk 1). The phone streams
// the ring's realtime 0x33 accel and posts raw magnitude chunks (~2 min each); this route
// gait-counts each chunk server-side (countGaitGatedSteps — the ONE counting implementation)
// and writes the result as a Tier-2 step_live_windows row, which the rollup's Tier-2-wins
// merge makes the step source for the covered span. Raw chunks are stored 7 days for
// recount/calibration (pruned on ingest), then deleted.
//
// Counting is per-chunk: a gait window straddling a chunk boundary is dropped, which
// slightly under-counts (safe direction) — bounded by the client's ~2-min chunk size.
const AccelChunkSchema = z.object({
  startedAt: z.string().datetime(),
  // The client's wall clock for the last frame in the chunk. Optional: an older client omits it and
  // falls back to the sample-derived end below.
  endedAt: z.string().datetime().optional(),
  sampleRate: z.number().int().min(1).max(200),
  magnitudes: z.array(z.number().int().min(0).max(1_000_000)).min(25).max(20_000),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`oura-ble-accel-chunks:${session.user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const parsed = AccelChunkSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { startedAt, endedAt, sampleRate, magnitudes } = parsed.data
  const startedAtMs = new Date(startedAt).getTime()
  // Reject chunks claiming to start in the future or absurdly far in the past — a bad
  // phone clock would otherwise plant a live window over a span the ring never covered.
  if (startedAtMs > Date.now() + 60_000 || startedAtMs < Date.now() - 7 * 24 * 3600_000) {
    return NextResponse.json({ error: 'startedAt out of range' }, { status: 400 })
  }

  const steps = countGaitGatedSteps(magnitudes, sampleRate)
  const repo = await getRepositoryAsync()

  const { inserted } = await repo.insertOuraAccelChunk(session.user.id, {
    startedAt: new Date(startedAtMs),
    sampleRate,
    magnitudes,
    steps,
  })
  // Client retry of an already-stored chunk: its window was written on first ingest.
  if (!inserted) return NextResponse.json({ ok: true, duplicate: true, steps })

  // Wall-clock → ring deciseconds via the latest clock anchor (same conversion as
  // /api/oura-ble/live-steps). A missing anchor must not lose the RAW chunk (stored above) — but
  // note the Tier-2 STEP window IS lost here: there is no recount pass (the raw chunk is pruned at
  // 7 days), so a chunk captured before the first BLE drain establishes an anchor (fresh install /
  // post-re-key epoch) contributes zero steps permanently. Accepted: this is a rare edge state, and
  // it's exactly the window where the ring's own step signals are also disrupted (review G-7). If
  // this ever needs closing, recount un-windowed chunks ≤7d old on the next anchor write (`steps` is
  // already stored per chunk — only the ds conversion is missing).
  // The count here is computed server-side by countGaitGatedSteps, so an implausible result means
  // the counter itself faulted on this chunk (a wrong sampleRate shrinks the refractory and
  // double-counts). Keep the raw chunk — it is the evidence for a recount — but do not let the
  // faulty count become a Tier-2 window that overrides the ring's model for the span.
  // The window must span the wall clock these samples were collected over, not the duration of the
  // samples themselves. The accel stream gaps by design (firmware time-boxes it at ~5 min, a 90 s
  // stall watchdog re-arms it, a reconnect re-arms it), so a chunk that occupied 120 s of wall clock
  // routinely holds only 40-90 s of samples. Deriving the end from the sample count placed the
  // chunk's steps minutes before they happened AND surrendered the rest of the span to the model,
  // which then added its own count for minutes this chunk had already counted.
  //
  // Take the LONGER of the two, same rule as the step orchestrator: the sample-derived end is a
  // floor (the samples genuinely take that long), and over-stating a window only under-states
  // cadence, which is the safe direction. A client clock that runs backwards or a wild endedAt
  // therefore cannot shrink the window below the samples it holds.
  const sampleDerivedEndMs = startedAtMs + Math.round((magnitudes.length / sampleRate) * 1000)
  const clientEndMs = endedAt != null ? new Date(endedAt).getTime() : null
  const chunkEndedAtMs = clientEndMs != null && Number.isFinite(clientEndMs)
    ? Math.max(sampleDerivedEndMs, clientEndMs)
    : sampleDerivedEndMs
  const plausible = isPlausibleStepWindow(steps, startedAtMs, chunkEndedAtMs)

  let windowWritten = false
  if (steps > 0 && plausible) {
    const anchor = await repo.getOuraClockAnchor(session.user.id)
    if (anchor) {
      const anchorUtcMs = anchor.anchorUtc.getTime()
      const startDs = Math.round(dsFromMeasuredAtMs(startedAtMs, anchor.anchorDs, anchorUtcMs))
      const endDs = Math.round(dsFromMeasuredAtMs(chunkEndedAtMs, anchor.anchorDs, anchorUtcMs))
      await repo.upsertStepLiveWindow(session.user.id, { startDs, endDs, steps, source: 'continuous-accel' })
      windowWritten = true
    }
  }

  // `implausible` is surfaced so a silent zero-window response is distinguishable from a faulted
  // count — otherwise the client cannot tell "you were sitting still" from "the counter misfired".
  return NextResponse.json({ ok: true, steps, windowWritten, ...(plausible ? {} : { implausible: true }) })
}
