import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { computeWorkoutHr } from '@trainingai/shared/workout/compute-workout-hr'
import { reportServerError } from '@/lib/observability'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workoutSessionId = req.nextUrl.searchParams.get('sessionId')
  if (!workoutSessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })

  const repo = await getRepositoryAsync()
  const ws = await repo.getWorkoutSessionById(session.user.id, workoutSessionId)
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!ws.completedAt) return NextResponse.json({ ready: false }, { headers: { 'Cache-Control': 'private, no-store' } })

  const computed = await computeWorkoutHr(repo, session.user.id, ws, session.user.timezone)
  // ws.completedAt is non-null (guarded above), so computeWorkoutHr never returns null here.
  const { readings, stats, summary, setHrRows } = computed!
  let workoutHrvMs = computed!.workoutHrvMs

  // Durable snapshot (review H-3 / Lever W): the scalars above are erased for workouts older than
  // the 180d oura_heartrate / 90d rr_intervals prunes. On any recap with live data, persist the
  // summary fire-and-forget (COALESCE upsert — a fuller later compute wins, a partial never
  // clobbers). When the raw series has already thinned, fall back to the persisted snapshot so old
  // recaps keep avg/peak/HRR1/HRV even though the trace and per-set detail are gone.
  if (readings.length > 0) {
    // Report, don't just log. A console.error here is invisible in production, which is how this
    // write failed on every single recap for months without anyone noticing — the recap renders
    // either way, so a silent persist failure has no user-facing symptom at all.
    void repo.upsertWorkoutHrStats(session.user.id, workoutSessionId, summary)
      .catch(err => reportServerError(err, { userId: session.user.id, url: '/api/oura/hr-data#workout-hr-stats' }))
    // Durable per-set snapshot (migration 139) — same fuller-wins contract, so per-exercise HR
    // trends survive the 180d prune. Fire-and-forget; the recap render doesn't wait on it.
    void repo.upsertSetHrStats(session.user.id, workoutSessionId, setHrRows)
      .catch(err => reportServerError(err, { userId: session.user.id, url: '/api/oura/hr-data#set-hr-stats' }))
  }

  let snapshot: Awaited<ReturnType<typeof repo.getWorkoutHrStats>> | null = null
  if (readings.length === 0 || workoutHrvMs == null) {
    snapshot = await repo.getWorkoutHrStats(session.user.id, workoutSessionId)
    // The rest-window HRV specifically dies at 90d (rr prune) while the HR trace still renders up to
    // 180d — fill it from the snapshot when live RR yielded nothing.
    if (workoutHrvMs == null && snapshot?.workoutHrvMs != null) workoutHrvMs = snapshot.workoutHrvMs
  }

  return NextResponse.json({
    ready:    true,
    hasData:  readings.length > 0,
    workoutHrvMs,
    // Durable summary — live values when readings exist, else the persisted snapshot (or null if a
    // pre-Lever-W workout aged out before it was ever snapshotted).
    summary: readings.length > 0
      ? { ...summary, fromSnapshot: false }
      : snapshot
        ? { avgBpm: snapshot.avgBpm, peakBpm: snapshot.peakBpm, hrr1Best: snapshot.hrr1Best, workoutHrvMs: snapshot.workoutHrvMs, readingsCount: snapshot.readingsCount, source: snapshot.source, fromSnapshot: true }
        : null,
    startedAt: ws.startedAt.toISOString(),
    readings: readings.map(r => ({ timestamp: r.timestamp.toISOString(), bpm: r.bpm })),
    setStats: stats.map(s => ({
      exerciseName: s.exerciseName,
      setNumber:    s.setNumber,
      loggedAt:     s.loggedAt?.toISOString() ?? null,
      setStartMs:   s.setStartMs ?? null,
      setEndMs:     s.setEndMs ?? null,
      peakBpm:      s.peakBpm,
      bpmAtLog:     s.bpmAtLog,
      hrr1:         s.hrr1,
      adequate:     s.adequate,
    })),
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
