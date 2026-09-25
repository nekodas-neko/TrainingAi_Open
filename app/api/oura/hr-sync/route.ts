import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { syncAndAttributeSessionHr } from '@/lib/workout/post-completion-hr'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { isUuid } from '@trainingai/shared/validation/uuid'

// One workout-session id.
const MAX_BODY_BYTES = 4 * 1024

// POST — fetch and store Oura HR data for a completed workout session.
// Body: { workoutSessionId: string }
// Called fire-and-forget from complete-workout immediately after session is saved.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Generous window — fire-and-forget from complete-workout, not user-interactive.
  if (!rateLimit(`oura-hr-sync:${session.user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { workoutSessionId } = (read.body ?? {}) as { workoutSessionId?: unknown }
  if (!workoutSessionId) return NextResponse.json({ error: 'Missing workoutSessionId' }, { status: 400 })
  // Truthiness alone let `5` and "not-a-uuid" through to a `uuid` column, where the driver's 22P02
  // became a bodiless 500 on what is plainly a 400 (RV-177, both measured 2026-09-25). Kept
  // separate from the check above so "you did not send one" and "that is not an id" stay
  // distinguishable, which `final-backfill-calibration-routes.test.ts` pins.
  if (!isUuid(workoutSessionId)) {
    return NextResponse.json({ error: 'workoutSessionId must be a uuid' }, { status: 400 })
  }

  const repo = await getRepositoryAsync()
  const ws = await repo.getWorkoutSessionById(session.user.id, workoutSessionId)
  if (!ws || !ws.completedAt) {
    return NextResponse.json({ error: 'Session not found or not completed' }, { status: 404 })
  }

  // Same shared pipeline the completion paths call directly — the route is now a thin
  // HTTP wrapper over it rather than the only way to reach the work (Q-122).
  const { readings } = await syncAndAttributeSessionHr(
    session.user.id,
    workoutSessionId,
    session.user.timezone,
  ).catch(err => {
    console.warn('[oura/hr-sync]', String(err).slice(0, 150))
    return { readings: 0, attributed: false }
  })

  return NextResponse.json({ success: true, readings })
}
