import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { describePersonalRecord } from '@trainingai/shared/1rm'
import { generateText } from 'ai'
import { aiModel, loggedGenerateText } from '@/lib/ai/instrument'
import { formatInTimeZone } from 'date-fns-tz'
import { createHash } from 'crypto'
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, startOfWeekInTz } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { projectWeeklyWeightChangeKg, stepsPaceToWeeklyGoal } from '@trainingai/shared/health/daily-digest-context'
import { buildAutomaticPhaseStatus } from '@trainingai/shared/phase-engine'
import { getScheduledSessionsPerWeek } from '@trainingai/shared/schedule-utils'

const CACHE_SECTION = 'daily-digest'

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let force = false
  try { force = Boolean((await req.json())?.force) } catch { /* no body */ }

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const todayIso = todayInTz(tz)
  const repo = await getRepository()

  const [sessionsToday, weekPrs, program, foodLogs, nutritionTargets, morningCheckin, userGoals, bodyMetricsToday, exerciseLibrary] = await Promise.all([
    // getDaySessionSummaries takes a slash-formatted date ("YYYY/MM/DD"), not the
    // hyphenated todayIso — matches the same conversion app/api/workout-sessions/day/route.ts uses.
    repo.getDaySessionSummaries(userId, todayIso.replace(/-/g, '/')),
    repo.listRecentPersonalRecords(userId, new Date(todayMidnightUtc(tz).getTime()), new Date()),
    repo.getActiveProgram(userId),
    repo.listFoodLogs(userId, todayIso),
    repo.getNutritionTargets(userId),
    repo.getDayCheckin(userId, todayIso, 'morning'),
    repo.getUserGoals(userId),
    repo.listBodyMetrics(userId, todayIso, todayIso),
    repo.listExerciseLibrary(),
  ])

  if (sessionsToday.length === 0 && foodLogs.length === 0 && !morningCheckin) {
    return NextResponse.json({ digest: null, date: todayIso, cached: false })
  }

  const lines: string[] = []

  if (sessionsToday.length > 0) {
    const exLogs = await repo.getWorkoutSessionsFrom(userId, new Date(todayMidnightUtc(tz).getTime()))
    const todaySession = exLogs.find(ws => ws.startedAt >= todayMidnightUtc(tz))
    const exCount = todaySession?.exercises.length ?? 0
    const volume = Math.round(todaySession?.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0) ?? 0)
    lines.push(`Trained today: ${sessionsToday[0].sessionName} (${exCount} exercises, ${volume} kg volume)`)
  } else {
    lines.push('Rest day: no training logged today')
  }

  if (weekPrs.length > 0) {
    const typeByName = new Map(exerciseLibrary.map(e => [e.name, e.exerciseType]))
    lines.push(`PR today: ${weekPrs.map(pr => describePersonalRecord(pr.exerciseName, pr.estimated1rm, typeByName.get(pr.exerciseName))).join(', ')}`)
  }

  if (foodLogs.length > 0 && nutritionTargets) {
    const totals = foodLogs.reduce((acc, l) => ({
      calories: acc.calories + l.calories, proteinG: acc.proteinG + l.proteinG,
      carbsG: acc.carbsG + l.carbsG, fatG: acc.fatG + l.fatG,
    }), { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })
    lines.push(`Nutrition today: ${Math.round(totals.calories)}/${nutritionTargets.calories ?? '?'} kcal, ${Math.round(totals.proteinG)}g/${nutritionTargets.proteinG ?? '?'}g protein`)
    if (nutritionTargets.calories != null) {
      const delta = totals.calories - nutritionTargets.calories
      const weeklyKg = projectWeeklyWeightChangeKg(delta)
      lines.push(`At today's rate: ${weeklyKg > 0 ? '+' : ''}${weeklyKg.toFixed(2)} kg/week`)
    }
  }

  const todaySteps = bodyMetricsToday[0]?.steps ?? null
  if (userGoals.stepsGoal != null && todaySteps != null) {
    if (userGoals.stepsGoalType === 'weekly') {
      // stepsGoal is always stored as a DAILY figure (matches home-card-widget.tsx's
      // `goalDisplay = stepsGoal * 7`) — the weekly target is 7x it, not the raw value.
      const weeklyTarget = userGoals.stepsGoal * 7
      const weekStart = startOfWeekInTz(tz)
      const weekMetrics = await repo.listBodyMetrics(userId, weekStart, todayIso)
      const stepsThisWeek = weekMetrics.reduce((s, m) => s + (m.steps ?? 0), 0)
      const todayDow = parseInt(formatInTimeZone(new Date(), tz, 'i'), 10) // 1=Mon..7=Sun
      const daysLeft = 7 - todayDow
      const pace = stepsPaceToWeeklyGoal(weeklyTarget, stepsThisWeek, daysLeft)
      lines.push(pace > 0
        ? `Steps: ${todaySteps} today. Walk ~${pace}/day for the rest of the week to hit your ${weeklyTarget} weekly goal.`
        : `Steps: ${todaySteps} today. Weekly goal already met.`)
    } else {
      lines.push(`Steps: ${todaySteps}/${userGoals.stepsGoal} today`)
    }
  }

  if (morningCheckin) {
    const parts: string[] = []
    if (morningCheckin.physicalTiredness != null) parts.push(`tiredness ${morningCheckin.physicalTiredness}/5`)
    if (morningCheckin.soreMuscles.length > 0) parts.push(`sore: ${morningCheckin.soreMuscles.join(', ')}`)
    if (parts.length > 0) lines.push(`This morning: ${parts.join(', ')}`)
  }

  if (sessionsToday.length > 0 && program && program.phaseMode === 'automatic') {
    const trainedName = sessionsToday[0].sessionName
    const programSession = program.sessions.find(s => s.name === trainedName)
    if (programSession) {
      const phases = await repo.listProgramPhases(userId, program.id)
      if (phases.length > 0) {
        const sessionCounts = await repo.countAllSessionsSinceStart(userId, program.id)
        const count = sessionCounts.get(programSession.id) ?? 0
        const totalPerWeek = getScheduledSessionsPerWeek(program)
        const sessionPerWeek = totalPerWeek / Math.max(1, program.sessions.length)
        const status = buildAutomaticPhaseStatus(phases, count, program, todayIso, sessionPerWeek)
        const cyclesLeft = status.totalPhaseCycles - status.cycleInPhase
        lines.push(cyclesLeft > 0
          ? `Phase: ${status.phase.name}, session ${status.cycleInPhase} of ${status.totalPhaseCycles}. ${cyclesLeft} more session${cyclesLeft === 1 ? '' : 's'} of progress and you'll move to the next phase.`
          : `Phase: ${status.phase.name} — this is the last session of this phase.`)
      }
    }
  }

  const context = lines.join('\n')
  const contextHash = createHash('sha256').update(context).digest('hex')

  if (!force) {
    const cached = await repo.getAiHealthInsightWithHash(userId, CACHE_SECTION, todayIso)
    if (cached && cached.contextHash === contextHash) {
      return NextResponse.json({ digest: cached.insight, date: todayIso, cached: true })
    }
  }

  if (!rateLimit(`${userId}:daily-digest`, 3, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let text: string
  try {
    ;({ text } = await loggedGenerateText(
      { section: 'daily-digest', userId, fingerprint: { date: todayIso, contextHash } },
      () => generateText({
        model: aiModel(),
        prompt: `You are a personal training coach. Write a 2-3 sentence end-of-day check-in — a quick reflection, not a report. Cover what stands out most (training, nutrition, or how the day compared to the morning check-in). Be specific, warm, and brief. Use the data below — quote its numbers, never invent or recompute any.\n\n${context}`,
        maxRetries: 0,
      }),
    ))
  } catch (err) {
    console.error('[daily-digest] generateText failed:', err)
    return NextResponse.json({ error: 'AI generation failed' }, { status: 502 })
  }

  const digest = text.trim()
  await repo.upsertAiHealthInsight(userId, CACHE_SECTION, todayIso, digest, contextHash)

  return NextResponse.json({ digest, date: todayIso, cached: false })
}
