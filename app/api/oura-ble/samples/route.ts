import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { rateLimit } from '@/lib/rate-limit'
import { historyEventFromHex } from '@/lib/oura-ble/decode'
import { shouldDropRawEvent } from '@/lib/oura-ble/raw-storage'
import { runRollupOffLoop } from '@/lib/oura-ble/rollup-worker'
import { createRollupDebouncer } from '@/lib/oura-ble/rollup-debounce'
import { reportServerError } from '@/lib/observability'
import { reportRollupStepErrors } from '@/lib/oura-ble/report-step-errors'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import type { OuraRawSampleInput, OuraRawAggregateResult } from '@/lib/data/repository'

// Direct-BLE ingest: the native plugin forwards raw ring history-event frames
// (hex) which we decode server-side and store in oura_raw_samples. Admin-gated
// (spike). Durability comes from the ring's history cursor — a failed POST just
// means the next drain re-sends, so no outbox is needed.
const MAX_BODY_BYTES = 512 * 1024
const MAX_FRAMES = 2000

// Coalescing the rollup (C-2, Q-213 Stage 3): the plugin drains ring history in ~255-event
// GetHistory batches, one POST each, in-order (docs/oura-ble-operations.md §2), and each rollup
// already re-derives the whole touched span — so re-rolling on every batch is waste.
//
// This is a **trailing-edge debounce with a max-wait**: run once the batches stop arriving, and at
// least every MAX_WAIT during a long continuous drain.
//
// It replaces `frames.length < 255 || elapsed >= 8s`, which was written to mean "the drain's LAST
// batch" and did not: §2 says a routine drain is 1–2 batches and almost always under 255 frames, so
// the predicate read as "any batch" and bypassed the window nearly every time — the exact case it
// existed to coalesce.
//
// Module-level (per warm instance), and the timer is `unref`'d so it can never hold the process
// open. A deploy between the last batch and the timer firing simply skips that run: the span is
// safe either way, because `oura_rollup_state` persists the watermark and the next run starts from
// it (that is the same guarantee that lets a coalesced batch be skipped rather than dropped).
const ROLLUP_DEBOUNCE_MS = 3000
const ROLLUP_MAX_WAIT_MS = 20_000

// Module-level, so it is per warm instance. `tz` is captured per user at schedule time — the same
// user's timezone cannot differ between two batches of one drain.
const tzForUser = new Map<string, string>()
const rollupDebouncer = createRollupDebouncer({
  debounceMs: ROLLUP_DEBOUNCE_MS,
  maxWaitMs: ROLLUP_MAX_WAIT_MS,
  run: (userId) => startRollup(userId, tzForUser.get(userId) ?? DEFAULT_TZ),
})

// The rollup must NEVER hold the HTTP response: a >30s hang trips the native client's 30s
// readTimeout (OuraRingService.kt), which reads as a non-2xx, holds the ring's history cursor
// (2xx-only advance) and re-drains the same batch — re-running this heavy rollup (now including
// the SleepNet ONNX inference, #722) and saturating the DB pool: a self-sustaining retry storm
// that starved the outbox sync (the "Sync failed" toast) AND stalled the sleep-staging write
// (missing hypnogram). Raw rows are durably stored BEFORE the rollup and it's idempotent +
// re-runnable, so the response NEVER awaits it — it runs fully in the background. A per-user
// in-flight guard prevents overlapping runs (concurrent delete+upsert on sleep_sessions/body_metrics).
const rollupInFlight = new Map<string, Promise<OuraRawAggregateResult | null>>()

// The oldest ring timestamp ingested but not yet rolled up, per user. The rollup only needs to
// re-derive the span a batch actually touched, and re-deriving all 35 days instead is what pegged the
// event loop (Q-213) — but "the span" is not this batch's span: coalescing skips batches, and a
// skipped batch's data must still be covered by whichever run happens next. Accumulating the minimum
// here is what makes narrowing safe; the map is cleared only once a run that covered it succeeds, and
// a failed run puts its span back.
const pendingSinceDs = new Map<string, number>()
// NOTE: there used to be a `fullWindowDone` set here forcing the first run in each process to
// re-derive the whole 35-day window, on the reasoning that a fresh process cannot know what an
// earlier one left un-rolled. The reasoning was right; the remedy was too expensive. Measured in
// production on 2026-08-13, that pass held the main thread for **six minutes** (CPU 1.5, memory
// 2.2 GB) and was paid on *every deploy* — the owner felt it each time. The watermark is persisted
// in `oura_rollup_state` instead (migration 184), so the repository narrows from the last successful
// run whether the process is warm or cold. Do not reintroduce a process-local equivalent.

const BodySchema = z.object({
  frames: z.array(z.object({ hex: z.string().regex(/^[0-9a-fA-F]*$/).max(2048) })).max(MAX_FRAMES),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  try {
    await requireAdmin(userId, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  if (!rateLimit(`oura-ble-ingest:${userId}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const parsed = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason }, { status: 400 })
  const result = BodySchema.safeParse(parsed.body)
  if (!result.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const rows: OuraRawSampleInput[] = []
  const byTag: Record<string, number> = {}
  for (const { hex } of result.data.frames) {
    const ev = historyEventFromHex(hex)
    if (!ev) continue // not a history event (command response / accel / malformed) — skip
    if (shouldDropRawEvent(ev.tag, ev.decoded)) continue // Lever 2, minus the 0x61 battery-telemetry keep
    rows.push({
      ringTimestampDs: ev.timestampDs,
      tag: ev.tag,
      eventName: ev.name,
      bodyHex: ev.bodyHex,
      decoded: ev.decoded,
    })
    const key = `0x${ev.tag.toString(16).padStart(2, '0')}`
    byTag[key] = (byTag[key] ?? 0) + 1
  }

  const repo = await getRepositoryAsync()
  const stored = await repo.insertOuraRawSamples(userId, rows)

  // Roll new biometric samples up into the product tables (sleep_sessions /
  // body_metrics) so the health screens see BLE data without a separate step.
  // Only when the batch actually carried sleep/HR/HRV/SpO₂ events — debug-only
  // batches skip the aggregation pass.
  // 0x7e/0x7f: paired step-feature frames — a drain carrying them re-derives the
  // day's estimated steps (lib/health/step-estimate.ts). 0x50 (activity_information / MET) is
  // consumed centrally by the rollup (MET-gated HRV/RHR, daily-summary metAvg, resilience), so a
  // MET-only batch must trigger it too — omitting 0x50 left those signals stale (C-2/G-3).
  const BIOMETRIC_TAGS = new Set([0x76, 0x4b, 0x4e, 0x5a, 0x5d, 0x80, 0x60, 0x6f, 0x8b, 0x86, 0x46, 0x69, 0x72, 0x75, 0x7e, 0x7f, 0x50])
  const aggregated = null
  // Errors now surface from the backgrounded rollup's .catch (console.error + reportServerError),
  // which may resolve after this response is sent — so the response field is always null now.
  const aggregateError: string | null = null
  let aggregateCoalesced = false
  if (stored > 0 && rows.some(r => BIOMETRIC_TAGS.has(r.tag))) {
    // Widen the pending span to cover this batch, whether or not this request ends up running the
    // rollup — a coalesced batch is skipped, never dropped.
    const batchMinDs = rows.reduce((min, r) => (r.ringTimestampDs < min ? r.ringTimestampDs : min), Infinity)
    if (Number.isFinite(batchMinDs)) {
      const prev = pendingSinceDs.get(userId)
      pendingSinceDs.set(userId, prev == null ? batchMinDs : Math.min(prev, batchMinDs))
    }
    tzForUser.set(userId, session.user.timezone ?? DEFAULT_TZ)
    rollupDebouncer.schedule(userId)
    aggregateCoalesced = true
  }

  return NextResponse.json({ received: result.data.frames.length, decoded: rows.length, stored, byTag, aggregated, aggregateError, aggregateCoalesced })
}

function startRollup(userId: string, tz: string): void {
  // The rollup is derived, re-runnable convenience (Redecode replays it over the archival body_hex),
  // and the raw rows are already durably stored by the time this is scheduled. It runs in the rollup
  // worker off a timer, so it holds neither this response nor the request loop — the two failure
  // modes that produced the 499 → cursor-hold → re-drain storm (I19/I20) and the 2026-08-13 outage
  // (I26). A failure here must still never reach the client.
  let inflight = rollupInFlight.get(userId)
  if (!inflight) {
    // Claim the pending span for this run and clear it, so batches arriving while the rollup is in
    // flight accumulate a fresh span for the next one rather than being marked done by this.
    // Omitting it is safe: the repository falls back to the persisted watermark, not to a full
    // re-derivation.
    const claimedSinceDs = pendingSinceDs.get(userId)
    pendingSinceDs.delete(userId)
    inflight = runRollupOffLoop(userId, tz, claimedSinceDs != null ? { sinceDs: claimedSinceDs } : undefined)
      // A step that failed did NOT throw — `step()` catches, files the message into `stepErrors`
      // and console.errors, so the `.catch` below can never see it. Without this the rollup's
      // ordinary failure mode (a lost connection mid-pass takes whichever writes are in flight)
      // reached Railway stdout and nothing else — not `error_events`, which is the table the
      // session-start ritual actually reads.
      .then((result) => {
        reportRollupStepErrors(result?.stepErrors, { userId, url: '/api/oura-ble/samples#aggregate' })
        return result
      })
      .catch((err) => {
        // Put the claimed span back: this run did not cover it, and the next one must.
        if (claimedSinceDs != null) {
          const prev = pendingSinceDs.get(userId)
          pendingSinceDs.set(userId, prev == null ? claimedSinceDs : Math.min(prev, claimedSinceDs))
        }
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[oura-ble] aggregation failed (samples still stored):', msg)
        // Surface it (K6): a repeating rollup failure otherwise only shows in Railway stdout while
        // raw rows pile up and health screens silently freeze (the BLE-3/4 symptom class).
        reportServerError(err, { userId, url: '/api/oura-ble/samples#aggregate' })
        return null
      })
      .finally(() => { rollupInFlight.delete(userId) })
    rollupInFlight.set(userId, inflight)
  }
  // Nothing waits on it. `inflight` stays referenced via rollupInFlight so the run (and its
  // .catch/.finally) lands; the response's `aggregated` field is always null (the native client
  // never reads it).
  void inflight
}
