import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { reportServerError } from '@/lib/observability'
import { invalidUuidResponse } from '@/lib/api/route-errors'
import {
  generatePrescriptionForSession,
  type GeneratePrescriptionResult,
} from '@trainingai/shared/ai-periodization/generate-prescription'
import { regeneratePrescriptionInBackground as regeneratePrescriptionSingleFlight } from '@trainingai/shared/ai-periodization/regenerate-in-background'
import { isAiPrescriptionPending } from '@trainingai/shared/ai-periodization/prescription-pending'
import { prescriptionAgedOut } from '@trainingai/shared/ai-periodization/reevaluate'

/**
 * Warm today's prescription from Home, before the workout tab asks for it (#2155).
 *
 * Owner, 2026-09-30: generate when Home renders the recommendation — same day, standard length —
 * so it is ready when he looks at it, and nothing runs on a day the app is not opened. It replaces
 * generating at completion (which built a plan on the previous day's readiness and left it sitting)
 * without moving the wait onto the workout tab.
 *
 * **Generates only when opening the workout would.** That is the slot the last workout consumed, or
 * a stored plan that has aged out — the two cheap checks `workout-data` runs first. Everything else
 * answers `not_needed` without touching the model, so Home can call this on every visit. The rarer
 * reasons to regenerate (a soreness or emergency deload) need the day's full signals and stay with
 * the workout tab.
 *
 * **One generation, however it races the tab.** This goes through the same process-wide single
 * flight as `workout-data`'s background trigger, and through `generatePrescriptionForSession`'s
 * in-flight dedup with no preset — the key the workout tab's own POST uses. A tap that lands while
 * the warm is still running joins it instead of starting a second.
 *
 * Awaited, so Home learns when it lands and can clear the caches that still say "preparing".
 */
const WARM_PER_HOUR = 60
const PRESCRIBE_MODEL_PER_HOUR = 20

export const maxDuration = 30

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`prescribe-warm:${userId}`, WARM_PER_HOUR, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { sessionId: programSessionId } = await params
  const badId = invalidUuidResponse(programSessionId)
  if (badId) return badId

  const repo = await getRepository()
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const program = await repo.getActiveProgram(userId)
  if (!program?.sessions.some(s => s.id === programSessionId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const state = await repo.getSessionPeriodization(userId, programSessionId)
  const isAiDynamic = program.phaseMode === 'ai_dynamic'
  // An ai_dynamic program has no phase rows, so its baseline is this pair alone (workout-data).
  const isBaselinePhase = state?.phase === 'baseline' && !state.baselineComplete
  const needed = isAiDynamic && !isBaselinePhase && state != null && (
    isAiPrescriptionPending(state, { isAiDynamic, isBaselinePhase }) || prescriptionAgedOut(state)
  )
  if (!needed) return NextResponse.json({ status: 'not_needed' })

  // "Same day": once today's workout is done, Home recommends the NEXT session, and a plan built now
  // would carry today's readiness into tomorrow — what generating at completion did. The workout
  // tab still generates if he opens it anyway.
  const today = todayInTz(tz)
  // Slashes: this reader splits its date on '/', and a dashed one would match no day at all.
  const todaysSessions = await repo.getDaySessionSummaries(userId, today.replace(/-/g, '/'), tz)
  if (todaysSessions.some(s => s.completedAt != null)) {
    return NextResponse.json({ status: 'trained_today' })
  }

  const run: { generation?: Promise<GeneratePrescriptionResult> } = {}
  const started = regeneratePrescriptionSingleFlight(userId, programSessionId, {
    today,
    allow: () => rateLimit(`prescribe:${userId}`, PRESCRIBE_MODEL_PER_HOUR, 60 * 60 * 1000),
    run: () => (run.generation = generatePrescriptionForSession(userId, programSessionId, repo, tz)),
    onError: err => reportServerError(err, { userId, url: '/api/ai-periodization/session/warm' }),
  })
  // Already running (the workout tab got there first), or the model's hourly budget is spent.
  if (!started || !run.generation) return NextResponse.json({ status: 'skipped' })

  const result = await run.generation.catch(() => null)
  return NextResponse.json({ status: result?.ok ? 'generated' : 'failed' })
}
