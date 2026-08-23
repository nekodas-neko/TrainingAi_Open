import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz, startOfWeekInTz, todayMidnightUtc, toAestDay, ageFromDob } from '@trainingai/shared/date-utils'
import { resolveHrProfile } from '@trainingai/shared/health/hr-profile'
import { computeObservedHr } from '@trainingai/shared/health/observed-hr'
import { getDailyGoals } from '@trainingai/shared/health/daily-goals'
import { resolveFitnessSnapshot } from '@trainingai/shared/running/fitness-snapshot'
import { weeklyZoneTargets } from '@trainingai/shared/running/zone-targets'
import { computeZoneQuota, weekWindow } from '@trainingai/shared/health/zone-quota'

// The Cardiovascular hub's week payload: HR profile + per-zone quota + steps.
// Server-derived read only — no user writes here, so no outbox/local-store domain (spec D-9).
const OBSERVED_WINDOW_DAYS = 30
const WEIGHT_LOOKBACK_DAYS = 28

/** Average of measured (non-null, positive) resting-HR readings in a body-metrics window,
 *  or null if none — mirrors resolveHrProfile's method, just re-windowed for the card's
 *  own rolling current/prior comparison rather than that resolver's fixed 28-day window. */
function avgRestingHr(rows: { restingHeartRate?: number | null }[]): number | null {
  const vals = rows.filter((r) => r.restingHeartRate != null && r.restingHeartRate > 0).map((r) => r.restingHeartRate!)
  if (!vals.length) return null
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:cardio-week`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()

  const today = todayInTz(tz)
  const { from, to } = weekWindow(today, startOfWeekInTz(tz))
  const from28dIso = toAestDay(new Date(todayMidnightUtc(tz).getTime() - WEIGHT_LOOKBACK_DAYS * 86_400_000), tz)

  const profile = await resolveHrProfile(repo, userId, tz)

  const observedTo = new Date()
  const observedFrom = new Date(todayMidnightUtc(tz).getTime() - OBSERVED_WINDOW_DAYS * 86_400_000)
  // Rolling prior window (the 30 days immediately before the current one) — the baseline
  // the "how does this compare to last month" delta on the heart card is measured against.
  const priorTo = observedFrom
  const priorFrom = new Date(observedFrom.getTime() - OBSERVED_WINDOW_DAYS * 86_400_000)
  const currentWindowFromIso = toAestDay(observedFrom, tz)
  const priorWindowFromIso = toAestDay(priorFrom, tz)
  const priorWindowToIso = toAestDay(priorTo, tz)

  const [days, hrRows, priorHrRows, user, weekMetrics, lookbackMetrics, currentRestingMetrics, priorRestingMetrics, plan, dayExercises, todayActivityLogs] = await Promise.all([
    repo.getZoneMinutesRange(userId, from, to, tz, profile).catch(() => []),
    repo.getHrForWindow(userId, observedFrom, observedTo).catch(() => []),
    repo.getHrForWindow(userId, priorFrom, priorTo).catch(() => []),
    repo.getUserById(userId),
    repo.listBodyMetrics(userId, from, to).catch(() => []),
    // Wider window for weight resolution — weight isn't logged daily, so the week window
    // alone is too narrow to reliably find a recent reading (mirrors readiness-score's pattern).
    repo.listBodyMetrics(userId, from28dIso, today).catch(() => []),
    repo.listBodyMetrics(userId, currentWindowFromIso, today).catch(() => []),
    repo.listBodyMetrics(userId, priorWindowFromIso, priorWindowToIso).catch(() => []),
    repo.getActiveRunningPlan(userId).catch(() => null),
    // "No dedicated workout today" (Q-88 lazy-day credit) reuses the same lightweight
    // lifting check progress-summary's trainedToday uses, plus any logged cardio/guided-walk
    // activity for today — either one means today isn't a lazy day.
    repo.getDayExerciseNames(userId, today.replace(/-/g, '/'), tz).catch(() => []),
    repo.listActivityLogs(userId, today, today).catch(() => []),
  ])
  const trainedToday = dayExercises.length > 0 || todayActivityLogs.length > 0

  // Zone targets: the active running plan's framework supplies the SHAPE; a resolved fitness
  // snapshot supplies the SIZE via weeklyBaseMinutes (spec D-11 — research split, personalised
  // volume). No fitness-test baseline lookup here — Phase 1 only needs a reasonable personalised
  // floor, not the exact running-plan volume; resolveFitnessSnapshot already floors it at 60min.
  const restingHr = [...lookbackMetrics].reverse().find((m) => m.restingHeartRate != null && m.restingHeartRate > 0)?.restingHeartRate ?? null
  const ageYears = ageFromDob(user?.dateOfBirth, todayMidnightUtc(tz))
  const fitness = resolveFitnessSnapshot({ age: ageYears, restingHr, baseline: null })

  const targets = weeklyZoneTargets(plan?.frameworkKey ?? 'zone2-base', fitness.weeklyBaseMinutes)
  const quota = computeZoneQuota(targets.perZone, days)

  // Daily quota alongside the weekly one — the weekly-only view otherwise can't answer
  // "did I clear today's floor" without doing the division in your head.
  const dailyTargets = targets.perZone.map((t) => ({ zoneId: t.zoneId, minutes: t.minutes / 7 }))
  const dayQuota = computeZoneQuota(dailyTargets, days.filter((d) => d.day === today))

  const observed = computeObservedHr(hrRows.map((r) => r.bpm))
  const observedPrior = computeObservedHr(priorHrRows.map((r) => r.bpm))
  const restingHrNow = avgRestingHr(currentRestingMetrics)
  const restingHrPrior = avgRestingHr(priorRestingMetrics)
  const restingHrDeltaBpm = restingHrNow != null && restingHrPrior != null ? restingHrNow - restingHrPrior : null
  const avgHrDeltaBpm = observed.avg != null && observedPrior.avg != null ? observed.avg - observedPrior.avg : null
  const maxHrDeltaBpm = observed.isReliable && observedPrior.isReliable && observed.max != null && observedPrior.max != null
    ? observed.max - observedPrior.max
    : null

  const latestWeightKg = [...lookbackMetrics].reverse().find((m) => m.weightKg != null && m.weightKg > 0)?.weightKg ?? null
  const goals = getDailyGoals({
    weightKg: latestWeightKg,
    heightCm: user?.heightCm ?? null,
    ageYears,
    sex: user?.sex ?? null,
    activityLevel: user?.activityLevel ?? null,
  })

  const stepsToday = weekMetrics.find((m) => m.date === today)?.steps ?? 0
  const stepsWeek = weekMetrics.reduce((s, m) => s + (m.steps ?? 0), 0)
  const daysElapsed = days.length || 1

  return NextResponse.json(
    {
      week: { from, to },
      heart: {
        restingHr: restingHrNow ?? profile.restingHr,
        restingHrDeltaBpm,
        avgHr: observed.avg,
        avgHrDeltaBpm,
        maxHr: observed.max ?? profile.maxHr,
        maxHrDeltaBpm,
        isReliable: observed.isReliable,
      },
      quota,
      dayQuota,
      guideline: {
        frameworkKey: targets.frameworkKey,
        totalMinutes: targets.totalMinutes,
        note: targets.guidelineNote,
        meets: targets.meetsActivityGuideline,
      },
      steps: {
        today: stepsToday,
        todayGoal: goals.stepGoal,
        week: stepsWeek,
        weekGoal: goals.stepGoal * 7,
        weekGoalSoFar: goals.stepGoal * daysElapsed,
      },
      hasRunningPlan: plan != null,
      trainedToday,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
