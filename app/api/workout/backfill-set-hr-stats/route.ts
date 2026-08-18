import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { computeWorkoutHr } from '@trainingai/shared/workout/compute-workout-hr'

// Per-set HR snapshot backfill (plan 2026-07-21-per-set-hr-metrics) — admin-triggered, bounded,
// resumable. Materialises set_hr_stats (migration 139) for completed sessions still inside the 180d
// oura_heartrate retention window that have logged sets but no per-set snapshot yet, so their
// per-set/per-exercise HR detail survives the prune. Additive: reads the same live series the recap
// reads and persists the rows — no source data mutated. Oldest-first; re-run until `remaining` is 0.
const RETENTION_DAYS = 180

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  if (!rateLimit(`workout-backfill-set-hr-stats:${session.user.id}`, 6, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let maxRows = 100
  const body = await req.json().catch(() => null)
  const n = body?.maxRows
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) maxRows = Math.min(Math.round(n), 1000)

  const repo = await getRepositoryAsync()
  const since = new Date(Date.now() - RETENTION_DAYS * 86_400_000)
  const pending = await repo.listSessionsMissingSetHrStats(session.user.id, since, maxRows)

  let processed = 0
  let withData = 0
  for (const ws of pending) {
    const computed = await computeWorkoutHr(repo, session.user.id, ws, session.user.timezone)
    if (!computed) continue
    // Persist unconditionally, including 0-reading rows (with null metrics) — this stamps
    // `computed_at` even when the strap/ring hadn't landed data yet. It does NOT mark the session
    // done: listSessionsMissingSetHrStats (Q-11 Defect B) is coverage-aware and re-lists a session
    // whose rows are all readings_count=0, so a later fuller compute still gets attempted, and
    // still wins when it lands.
    await repo.upsertSetHrStats(session.user.id, ws.id, computed.setHrRows)
    processed++
    if (computed.setHrRows.some(r => r.readingsCount > 0)) withData++
  }

  return NextResponse.json({
    processed,
    withData,
    remaining: pending.length === maxRows,
  })
}
