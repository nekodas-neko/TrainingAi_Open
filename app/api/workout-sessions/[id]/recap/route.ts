import { generateText } from 'ai'
import { aiModel, loggedGenerateText } from '@/lib/ai/instrument'
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, toAestDay } from '@trainingai/shared/date-utils'
import { buildRecapFacts } from '@trainingai/shared/workout/session-recap'
import { errorLog } from '@trainingai/shared/logger'
import { reportServerError } from '@/lib/observability'
import { invalidUuidResponse } from '@/lib/api/route-errors'
import { hashInsightContext, readFreshInsight } from '@/lib/ai/insight-cache'
import { PROSE_GUARDS } from '@/lib/ai/prompt-guards'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: sessionId } = await params
    const badId = invalidUuidResponse(sessionId)
    if (badId) return badId
    const repo = await getRepository()
    const tz = session.user?.timezone ?? DEFAULT_TZ

    const workoutSession = await repo.getWorkoutSessionDetail(userId, sessionId)
    if (!workoutSession) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const date = toAestDay(workoutSession.startedAt, tz)
    const cacheSection = `session-recap:${sessionId}`

    // Q-293: the cache check used to sit here. A completed session is the most static subject of
    // the five cached insight surfaces — but not fully static: `durationVsMedianPct` moves as later
    // sessions of the same type change the median, and the PR count moves if records are recomputed.

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
      .map(s => (s.completedAt!.getTime() - s.startedAt.getTime()) / 60_000)

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

    const lines = [
      `Duration: ${facts.durationMin != null ? `${facts.durationMin} min` : 'unknown'}`,
      facts.durationVsMedianPct != null
        ? `Duration vs typical for this session: ${facts.durationVsMedianPct >= 0 ? '+' : ''}${facts.durationVsMedianPct}%`
        : null,
      `Total volume: ${facts.totalVolumeKg} kg`,
      `New personal records: ${facts.prCount}`,
      facts.rpeDrift != null
        ? `RPE drift within exercises (last set vs first): ${facts.rpeDrift >= 0 ? '+' : ''}${facts.rpeDrift}`
        : null,
      facts.restAdherencePct != null ? `Rest adherence: ${facts.restAdherencePct}% of prescribed rest` : null,
      facts.sessionRpe != null ? `Session RPE (self-reported effort): ${facts.sessionRpe}/10` : null,
    ].filter(Boolean).join('\n')

    const prompt = `You are a concise personal training assistant reviewing a just-completed workout.

${PROSE_GUARDS}

Facts:

${lines}

In at most 3 sentences: say what stood out about this session, and give one thing to watch next session. Write in second person. Do not use bullet points or headers.`

    const contextHash = hashInsightContext(prompt)
    const cached = await readFreshInsight(repo, userId, cacheSection, date, contextHash)
    if (cached) {
      return NextResponse.json({ recap: cached }, { headers: { 'Cache-Control': 'private, no-store' } })
    }

    if (!rateLimit(`session-recap:${userId}`, 20, 60 * 60 * 1000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { text } = await loggedGenerateText(
      { section: 'workout-recap', userId, fingerprint: { sessionId, contextHash } },
      () => generateText({ model: aiModel(), prompt, maxRetries: 0 }),
    )
    const recap = text.trim()
    await repo.upsertAiHealthInsight(userId, cacheSection, date, recap, contextHash)

    return NextResponse.json({ recap })
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
