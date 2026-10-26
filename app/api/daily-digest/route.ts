import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { describePersonalRecord } from '@trainingai/shared/1rm'
import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, startOfWeekInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { projectWeeklyWeightChangeKg, stepsPaceToWeeklyGoal } from '@trainingai/shared/health/daily-digest-context'
import { buildAutomaticPhaseStatus } from '@trainingai/shared/phase-engine'
import { getScheduledSessionsPerWeek } from '@trainingai/shared/schedule-utils'
import { MIN_LOGGED_DAYS, DEFAULT_WINDOW_DAYS } from '@trainingai/shared/nutrition/adaptive-tdee'
import { computeEnergyBalance } from '@/lib/health/energy-balance-service'
import { dayStepCount, dayStepCountsByDate } from '@trainingai/shared/health/activity-steps'
import { buildDailyDigestText, digestHasNothing, type DigestFacts } from '@trainingai/shared/health/daily-digest-text'

export async function POST(_req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // No request body is read: the digest is rebuilt from the day's own figures every time, so the
  // old `{ force }` flag (which skipped a cache that no longer exists) is ignored. With no cache in
  // front of it, every open of the End of Day card reaches this limit, and no model call sits behind
  // it any more, so the limit only guards the database reads.
  if (!rateLimit(`${userId}:daily-digest`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const todayIso = todayInTz(tz)
  const repo = await getRepository()

  const [sessionsToday, weekPrs, program, foodLogs, nutritionTargets, morningCheckin, userGoals, bodyMetricsToday, exerciseLibrary] = await Promise.all([
    // getDaySessionSummaries takes a slash-formatted date ("YYYY/MM/DD"), not the
    // hyphenated todayIso — matches the same conversion app/api/workout-sessions/day/route.ts uses.
    repo.getDaySessionSummaries(userId, todayIso.replace(/-/g, '/'), tz),
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

  // The facts the digest is written from. There is no model call (#3286), so nothing here is
  // cached either: the text is rebuilt from the day's own figures on every open.
  const facts: DigestFacts = { training: null, prs: [], nutrition: null, steps: null, checkin: null, phase: null }

  if (sessionsToday.length > 0) {
    const exLogs = await repo.getWorkoutSessionsFrom(userId, new Date(todayMidnightUtc(tz).getTime()))
    const todaySession = exLogs.find(ws => ws.startedAt >= todayMidnightUtc(tz))
    const exCount = todaySession?.exercises.length ?? 0
    const volume = Math.round(todaySession?.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0) ?? 0)
    facts.training = { name: sessionsToday[0].sessionName, exercises: exCount, volumeKg: volume }
  }

  if (weekPrs.length > 0) {
    const typeByName = new Map(exerciseLibrary.map(e => [e.name, e.exerciseType]))
    facts.prs = weekPrs.map(pr => describePersonalRecord(pr.exerciseName, pr.estimated1rm, typeByName.get(pr.exerciseName)))
  }

  // A day with food but no targets row still gets the eaten-so-far line, without a budget or a
  // protein target to set it against.
  if (foodLogs.length > 0) {
    const totals = foodLogs.reduce((acc, l) => ({
      calories: acc.calories + l.calories, proteinG: acc.proteinG + l.proteinG,
      carbsG: acc.carbsG + l.carbsG, fatG: acc.fatG + l.fatG,
    }), { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })
    // #2071. The denominator is the day's budget — the number the end-of-day review this digest sits
    // in prints above it — not the typed goal (`nutritionTargets.calories`). Read only when there is
    // food to judge, and a failed read costs the figure rather than the digest.
    const dayBudgetKcal = nutritionTargets
      ? await computeEnergyBalance(repo, userId, tz, todayIso)
        .then(r => r.balance?.budgetKcal ?? null)
        .catch(() => null)
      : null
    const weeklyKg = dayBudgetKcal != null ? projectWeeklyWeightChangeKg(totals.calories - dayBudgetKcal) : null

    // Q-303: a single logged day looks exactly like a representative one, so the digest says how
    // thin the history is. Reuse Q-302's own gate (MIN_LOGGED_DAYS over a 14-day window) rather
    // than inventing a second coverage floor.
    const windowStart = shiftDateStr(todayIso, -(DEFAULT_WINDOW_DAYS - 1))
    const nutritionWindow = await repo.listFoodLogsSummary(userId, windowStart, todayIso)
    facts.nutrition = {
      kcal: totals.calories,
      budgetKcal: dayBudgetKcal,
      proteinG: totals.proteinG,
      proteinTargetG: nutritionTargets?.proteinG ?? null,
      weeklyKg,
      loggedDays: nutritionWindow.length,
      windowDays: DEFAULT_WINDOW_DAYS,
      sparse: nutritionWindow.length < MIN_LOGGED_DAYS,
    }
  }

  // #3095: the day's steps through the shared builder, so the digest quotes the figure Home shows on a
  // treadmill day. Only read when a step goal makes the line appear.
  const stepActivities = userGoals.stepsGoal != null
    ? await repo.listActivityLogs(userId, startOfWeekInTz(tz), todayIso).catch(() => [])
    : []
  const todaySteps = dayStepCount(bodyMetricsToday[0]?.steps, stepActivities.filter(a => a.date === todayIso))
  if (userGoals.stepsGoal != null && todaySteps != null) {
    if (userGoals.stepsGoalType === 'weekly') {
      // stepsGoal is always stored as a DAILY figure (matches home-card-widget.tsx's
      // `goalDisplay = stepsGoal * 7`) — the weekly target is 7x it, not the raw value.
      const weeklyTarget = userGoals.stepsGoal * 7
      const weekStart = startOfWeekInTz(tz)
      const weekMetrics = await repo.listBodyMetrics(userId, weekStart, todayIso)
      const stepsThisWeek = [...dayStepCountsByDate(weekMetrics, stepActivities).values()].reduce((s, n) => s + n, 0)
      const todayDow = parseInt(formatInTimeZone(new Date(), tz, 'i'), 10) // 1=Mon..7=Sun
      const daysLeft = 7 - todayDow
      const pace = stepsPaceToWeeklyGoal(weeklyTarget, stepsThisWeek, daysLeft)
      facts.steps = { today: todaySteps, weeklyTarget, pacePerDay: pace, daysLeft }
    } else {
      facts.steps = { today: todaySteps, dailyGoal: userGoals.stepsGoal }
    }
  }

  if (morningCheckin) {
    const tiredness = morningCheckin.physicalTiredness ?? null
    if (tiredness != null || morningCheckin.soreMuscles.length > 0) {
      facts.checkin = { tiredness, soreMuscles: morningCheckin.soreMuscles }
    }
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
        facts.phase = { name: status.phase.name, cycleInPhase: status.cycleInPhase, totalPhaseCycles: status.totalPhaseCycles }
      }
    }
  }

  // Nothing to report once the optional reads are folded in (a check-in with no answered scales,
  // say): say nothing rather than render a sentence about an empty day.
  if (digestHasNothing(facts)) {
    return NextResponse.json({ digest: null, date: todayIso, cached: false })
  }

  return NextResponse.json({ digest: buildDailyDigestText(facts), date: todayIso, cached: false })
}
