import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { errorLog } from '@trainingai/shared/logger'
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { reportServerError } from '@/lib/observability'
import { buildSessionInsightText } from '@trainingai/shared/session-explain/insight-text'

export async function GET() {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Every open of "Why this session" reaches this now that the text is a template with no cache
    // in front of it; the limit only guards the database reads.
    if (!rateLimit(`session-explain:${userId}`, 120, 60 * 60 * 1000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const tz = session.user?.timezone ?? DEFAULT_TZ
    const repo = await getRepository()

    // Q-293 removed a fast path that read a cached narrative from the `sessionId` query param
    // alone: signals move during the day, and this explains why today's session was chosen, so it
    // is rebuilt from `getNextSession` every time. The param is still accepted and ignored, so an
    // older client keeps working.
    const recommendation = await repo.getNextSession(userId, tz)
    if (!recommendation.session || !recommendation.signals || !recommendation.weightedComponents) {
      return NextResponse.json({ error: 'No AI dynamic recommendation available' }, { status: 404 })
    }

    // The text is built from the scorer's own figures; there is no model call, so nothing is cached
    // or streamed (#3286). The body stays text/plain, which is what both apps read.
    const text = buildSessionInsightText({
      sessionName: recommendation.session.name,
      weightedComponents: recommendation.weightedComponents,
      signals: recommendation.signals,
      consecutiveTrainingDays: recommendation.consecutiveTrainingDays,
      deloadOrRestRecommended: recommendation.deloadOrRestRecommended,
      deloadStrength: recommendation.deloadStrength,
    })

    return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  } catch (error) {
    reportServerError(error, { url: '/api/session-explain/insight' })
    // Q-483: `errorLog` returns `[ERROR]: ${error}`, and returning that as the body published the
    // whole failing statement — every column of `workout_sessions` — to the client. Measured on a
    // malformed id, which reaches the driver as 22P02. The log line above keeps the full detail and
    // `reportServerError` already banked it, so redacting the response costs no diagnostics.
    errorLog(error, 'GET /api/session-explain/insight')
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
