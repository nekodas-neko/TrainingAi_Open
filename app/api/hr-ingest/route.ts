// app/api/hr-ingest/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import {
  MIN_PLAUSIBLE_BPM, MAX_PLAUSIBLE_BPM,
  MIN_PLAUSIBLE_RR_MS, MAX_PLAUSIBLE_RR_MS,
  rrContradictsBpm,
} from '@trainingai/shared/validation/plausibility'

// Structural validation only — value ranges are filtered per-sample below, never rejected as a
// batch. The H10 routinely emits bpm=0 during signal acquisition at strap-on and RR artifacts
// during poor contact; one such sample must not Zod-reject an entire 40-sample flush (the client
// swallows the 400 and drops the batch — the classic poison-pill class, review G-2). The .max()
// caps stay structural (payload-size / DoS protection).
const BodySchema = z.object({
  samples: z.array(z.object({
    // SEC-I1: bound `at` structurally — an unbounded epoch (`> 8.64e15`) makes
    // `new Date(at)` Invalid and 500s the driver. This cap is DoS-only (real
    // timestamps are ~1.7e12); a bad-but-valid clock is filtered per-sample below,
    // never batch-rejected (poison-pill rule G-2).
    at: z.number().int().min(0).max(8_640_000_000_000_000), // epoch ms (client receive time)
    bpm: z.number().int(),
    rr: z.array(z.number().int()).max(16).optional(),  // ms per beat
  })).min(1).max(2000),
})

const BPM_MIN = MIN_PLAUSIBLE_BPM, BPM_MAX = MAX_PLAUSIBLE_BPM
const RR_MIN = MIN_PLAUSIBLE_RR_MS, RR_MAX = MAX_PLAUSIBLE_RR_MS
// The backwards walk may only be moved by an interval that could be real elapsed time. `rr` is
// `z.number().int()`, so a NEGATIVE artifact walks the cursor FORWARD past the packet's own
// timestamp — planting later beats in the future, where the `inWindow` filter (which only ever
// sees `s.at`) cannot reach them. The ceiling is deliberately far above RR_MAX: an interval of
// 5 s is out of band as a heartbeat but is still real elapsed time and must move the cursor.
const RR_WALK_MAX_MS = 60_000
// SEC-I1: reject timestamps a bad phone clock (or a crafted call) would plant far
// outside the window the strap could actually cover — mirrors accel-chunks. Dropped
// per-sample, so one bad row doesn't lose the flush.
const FUTURE_TOLERANCE_MS = 60_000
const PAST_TOLERANCE_MS = 7 * 24 * 60 * 60_000

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id
  if (!rateLimit(`hr-ingest:${userId}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const repo = await getRepositoryAsync()
  const now = Date.now()
  const inWindow = (at: number) => at >= now - PAST_TOLERANCE_MS && at <= now + FUTURE_TOLERANCE_MS
  const samples = parsed.data.samples.filter(s => inWindow(s.at))
  // Exact-timestamp collisions with ring rollup rows keep the first writer
  // (onConflictDoNothing); the read-side bucket precedence is the real merge rule.
  const hrSamples = samples
    .filter(s => s.bpm >= BPM_MIN && s.bpm <= BPM_MAX)
    .map(s => ({ timestamp: new Date(s.at), bpm: s.bpm, source: 'chest_strap' as const }))
  if (hrSamples.length > 0) await repo.upsertOuraHeartrate(userId, hrSamples)

  // Reconstruct per-beat wall-clock times by walking BACKWARDS from the packet
  // receive time: the last RR ended at `at`, the one before ended rr[last] earlier.
  // The cursor advances by every reported beat (elapsed time is still real), but only
  // physiologically plausible intervals are stored — one artifact drops itself, not the batch.
  const rrRows: { at: Date; rrMs: number }[] = []
  for (const s of samples) {
    if (!s.rr?.length) continue
    if (rrContradictsBpm(s.rr, s.bpm)) continue
    let end = s.at
    for (let i = s.rr.length - 1; i >= 0; i--) {
      const rrMs = s.rr[i]
      if (rrMs >= RR_MIN && rrMs <= RR_MAX) rrRows.push({ at: new Date(end), rrMs })
      if (rrMs > 0 && rrMs <= RR_WALK_MAX_MS) end -= rrMs
    }
  }
  if (rrRows.length > 0) await repo.insertRrIntervals(userId, rrRows)

  return NextResponse.json({ ok: true, stored: hrSamples.length, rrStored: rrRows.length })
}
