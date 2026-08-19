import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { computeWorkoutHr } from '@trainingai/shared/workout/compute-workout-hr'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// A single tuning number (or a short note). The body is optional on all of these.
const MAX_BODY_BYTES = 4 * 1024

// Lever W backfill (review H-3) — admin-triggered, bounded, resumable. Materialises the durable
// per-workout HR snapshot for completed sessions still inside the 180d oura_heartrate retention
// window that have no snapshot yet, so their avg/peak/HRR1/HRV survive the prune (the first BLE-era
// workout hits 180d ~2027-01; this must land before then). Additive: reads the same live series the
// recap already reads and persists the summary — no source data is mutated. Oldest-first, so each
// pass drains the sessions nearest the prune edge; re-run until `remaining` is 0.
const RETENTION_DAYS = 180

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  if (!rateLimit(`oura-ble-backfill-hr-stats:${session.user.id}`, 6, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let maxRows = 200
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok && read.reason === 'too_large') {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  }
  const n = read.ok ? (read.body as { maxRows?: unknown } | null)?.maxRows : undefined
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) maxRows = Math.min(Math.round(n), 2000)

  const repo = await getRepositoryAsync()
  const since = new Date(Date.now() - RETENTION_DAYS * 86_400_000)
  const pending = await repo.listSessionsMissingHrStats(session.user.id, since, maxRows)

  let processed = 0
  let withData = 0
  for (const ws of pending) {
    const computed = await computeWorkoutHr(repo, session.user.id, ws)
    if (!computed) continue
    // Persist unconditionally — a 0-reading historical session (HR never captured, or not landed
    // yet) gets an empty snapshot so `computed_at` reflects the attempt. It does NOT mark the
    // session done: listSessionsMissingHrStats (Q-11 Defect B) is coverage-aware and re-lists a
    // session whose stored readings_count is 0, so a later fuller compute still gets attempted, and
    // still wins (the upsert is gated on readings_count).
    await repo.upsertWorkoutHrStats(session.user.id, ws.id, computed.summary)
    processed++
    if (computed.summary.readingsCount > 0) withData++
  }

  return NextResponse.json({
    processed,
    withData,
    // A full batch means more may remain; a short batch means the window is drained.
    remaining: pending.length === maxRows,
  })
}
