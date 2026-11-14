import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { buildRecapFacts } from '@trainingai/shared/workout/session-recap'
import { recapText } from '@trainingai/shared/workout/recap-text'
import { sessionActiveMin } from '@trainingai/shared/workout/active-duration'
import { errorLog } from '@trainingai/shared/logger'
import { reportServerError } from '@/lib/observability'
import { invalidUuidResponse } from '@/lib/api/route-errors'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: sessionId } = await params
    const badId = invalidUuidResponse(sessionId)
    if (badId) return badId
    const repo = await getRepository()

    const workoutSession = await repo.getWorkoutSessionDetail(userId, sessionId)
    if (!workoutSession) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [recentSessions, styles, recentPRs] = await Promise.all([
      workoutSession.sessionId
        ? repo.getRecentSessionsOfType(userId, workoutSession.sessionId, 6)
        : Promise.resolve([]),
      repo.listProgressionStyles(userId),
      repo.listRecentPersonalRecords(
        userId,
        workoutSession.startedAt,
        new Date((workoutSession.completedAt ?? workoutSession.startedAt).getTime() + 15 * 60 * 1000),
      ),
    ])

    const recentDurationsMin = recentSessions
      .filter(s => s.id !== sessionId && s.completedAt != null)
      .map(s => sessionActiveMin(s.startedAt, s.completedAt!, s.pausedSec))

    const restSecByStyleSet = new Map<string, number>()
    for (const style of styles) {
      for (const set of style.sets) restSecByStyleSet.set(`${style.id}:${set.setNumber}`, set.restSec)
    }

    const facts = buildRecapFacts({
      session: workoutSession,
      recentDurationsMin,
      restSecByStyleSet,
      prCount: recentPRs.length,
    })

    // No model, no cache, no rate limit (#3748, after RV-201). The recap is a pure function of the
    // facts above, so the same session reads the same on every open and it answers with the AI
    // provider paused.
    //
    // What went with the model: the `ai_health_insights` read and write (a cache exists to avoid a
    // paid call), the 20/hour limit (nothing to rate-limit), and the degraded readout with its
    // `degraded: true` flag (there is no failure left to degrade from). Rows stored under
    // `session-recap:<id>` stay for history and nothing reads them.
    return NextResponse.json({ recap: recapText(facts) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    reportServerError(error, { url: '/api/workout-sessions/[id]/recap' })
    // Q-483: `errorLog` returns `[ERROR]: ${error}`, and returning that as the body published the
    // whole failing statement — every column of `workout_sessions` — to the client. Measured on a
    // malformed id, which reaches the driver as 22P02. The log line above keeps the full detail and
    // `reportServerError` already banked it, so redacting the response costs no diagnostics.
    errorLog(error, 'GET /api/workout-sessions/[id]/recap')
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
