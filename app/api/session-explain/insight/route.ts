import { aiModel, loggedStreamText } from '@/lib/ai/instrument'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { errorLog } from '@trainingai/shared/logger'
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'
import { textStreamResponse } from '@/lib/ai/stream'
import { reportServerError } from '@/lib/observability'
import { hashInsightContext, readFreshInsight } from '@/lib/ai/insight-cache'
import { PROSE_GUARDS } from '@/lib/ai/prompt-guards'

export async function GET() {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const tz = session.user?.timezone ?? DEFAULT_TZ
    const today = todayInTz(tz)
    const repo = await getRepository()

    // Q-293 removed a fast path here that read the cached narrative from the `sessionId` query
    // param alone, skipping `getNextSession` entirely. That read cannot know whether the signals
    // the narrative describes still hold, and signals moving during the day is this route's whole
    // subject — it explains *why today's session was chosen*. `getNextSession` is what builds the
    // context, so the hash needs it, and the Home card now pays for that call. The `sessionId`
    // param is still accepted and ignored, so an older client keeps working.
    const recommendation = await repo.getNextSession(userId, tz)
    if (!recommendation.session || !recommendation.signals || !recommendation.weightedComponents) {
      return NextResponse.json({ error: 'No AI dynamic recommendation available' }, { status: 404 })
    }

    const cacheSection = `session-explain:${recommendation.session.id}`

    const sig = recommendation.signals
    const wc = recommendation.weightedComponents
    const sessionName = recommendation.session.name

    const prompt = `You are a concise personal training assistant. Explain in 2–3 sentences why ${sessionName} was chosen for today's workout.

Key signals:
- Muscle recovery: ${wc.recovery.score}% (weight ${Math.round(wc.recovery.weight * 100)}%)
- Session balance (how overdue): ${wc.balance.score}% (weight ${Math.round(wc.balance.weight * 100)}%)
- Freshness: ${wc.freshness.score}% (weight ${Math.round(wc.freshness.weight * 100)}%)
- Oura readiness: ${sig.ouraReadiness != null ? sig.ouraReadiness : 'not connected'}
- Sleep trend vs baseline: ${sig.sleepTrend != null ? `${Math.round(sig.sleepTrend * 100)}%` : 'no data'}
- HRV trend vs baseline: ${sig.hrvTrend != null ? `${Math.round(sig.hrvTrend * 100)}%` : 'no data'}
- Energy level: ${sig.energyLevel ?? 'not logged today'}
- Sore muscles: ${sig.soreMuscles.length > 0 ? sig.soreMuscles.join(', ') : 'none'}
- Consecutive training days: ${recommendation.consecutiveTrainingDays ?? 0}
- Deload recommended: ${recommendation.deloadOrRestRecommended ? `yes (${recommendation.deloadStrength})` : 'no'}

Write in second person. Be specific about which signals mattered. Do not use bullet points or headers.

${PROSE_GUARDS}`

    const contextHash = hashInsightContext(prompt)
    const cached = await readFreshInsight(repo, userId, cacheSection, today, contextHash)
    if (cached) {
      return new Response(cached, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }

    if (!rateLimit(`session-explain:${userId}`, 20, 60 * 60 * 1000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const result = loggedStreamText(
      { section: 'session-explain', userId, fingerprint: { sessionId: recommendation.session.id, today, contextHash } },
      { model: aiModel(), prompt },
    )

    return textStreamResponse(result.textStream, {
      onComplete: text => repo.upsertAiHealthInsight(userId, cacheSection, today, text.trim(), contextHash),
    })
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
