import { DEFAULT_TZ, dateStrMidnightInTz, shiftDateStr, toAestDay, ageFromDob } from '@trainingai/shared/date-utils'
import { computeVolumeAcwr } from '@trainingai/shared/ai-periodization/acwr'
import { getDailyGoals } from '@trainingai/shared/health/daily-goals'
import { computeActivityScore } from '@trainingai/shared/health/activity-score'
import { hrMaxFromAge, computeHrZones } from '@trainingai/shared/health/hr-zones'
import { accumulateZoneSeconds, activeMinutesFromZoneSeconds } from '@trainingai/shared/health/zone-minutes'
import { computeMovedHours, moveHoursGoal } from '@trainingai/shared/health/hourly-movement'
import { excludeLowWearDays, toOuraByDate, isLowWearDay } from '@trainingai/shared/health/wear-confidence'
import { BASELINE_MIN_NIGHTS } from '@trainingai/shared/health/readiness-composite'
import type { WorkoutRepository } from '@/lib/data/repository'
import { sleepFeelLabel } from '@trainingai/shared/health/sleep-feel-calibration'
import { buildSleepAudit } from './sleep'
import { buildReadinessAudit } from './readiness'
import { buildActivityAudit } from './activity'
import { buildHeartRateAudit } from './heart-rate'
import type { DayAudit, PillarAudit } from './types'

/** Trailing history fetched so the 28-day baselines and the ACWR chronic window are complete. */
export const AUDIT_HISTORY_DAYS = 28

/** Minimum qualifying days before a 28-day HRV/resting-HR mean is trusted (mirrors the live route). */
const BASELINE_MIN_SAMPLE_DAYS = 5

export interface BuildDayAuditOptions {
  repo: WorkoutRepository
  userId: string
  /** Local day to audit, YYYY-MM-DD. */
  date: string
  tz?: string
}

/**
 * Assemble the full per-pillar audit for one local day.
 *
 * Every score here is produced by the SAME compute function the app serves from
 * (`computeSleepScore` / `computeActivityScore` / `computeReadinessComposite`) and every model
 * constant is read from that module's exported spec — this file gathers inputs for an arbitrary
 * date, it does not re-implement any formula. Where a recompute disagrees with the value persisted
 * for that day, the pillar reports `storedMatchesRecompute: false` rather than silently picking one.
 */
export async function buildDayAudit({ repo, userId, date, tz = DEFAULT_TZ }: BuildDayAuditOptions): Promise<DayAudit> {
  const warnings: string[] = []

  const dayMid = dateStrMidnightInTz(date, tz)
  const nextMid = new Date(dayMid.getTime() + 86_400_000)
  const fromIso = toAestDay(new Date(dayMid.getTime() - AUDIT_HISTORY_DAYS * 86_400_000), tz)
  const from7dIso = shiftDateStr(date, -7)
  const yesterdayIso = shiftDateStr(date, -1)

  const [
    bodyMetrics, sleepSessions, workoutSessions, ouraRows, program,
    hrRows, summaries, derivedRows, mood, user, activityLogs, nutrition, morningCheckin,
  ] = await Promise.all([
    repo.listBodyMetrics(userId, fromIso, date),
    repo.listSleepSessions(userId, fromIso, date),
    // ACWR needs the full chronic window ending at the audited day, not at today.
    repo.getWorkoutSessionsFrom(userId, new Date(dayMid.getTime() - AUDIT_HISTORY_DAYS * 86_400_000)),
    repo.getOuraDaily(userId, fromIso, date),
    repo.getActiveProgram(userId),
    repo.getHrForWindow(userId, dayMid, nextMid),
    repo.getOuraDailySummary(userId, fromIso, date),
    repo.getOuraDailyDerived(userId, fromIso, date),
    repo.getMoodLog(userId, date),
    repo.getUserById(userId),
    repo.listActivityLogs(userId, date, date),
    repo.listFoodLogsSummary(userId, date, date),
    // The morning check-in's own sleep rating. Deliberately NOT a scoring input (owner decision,
    // finding Q-16) — it sits in the audit context so "what the model said" and "what it felt
    // like" are readable side by side on the same day.
    repo.getDayCheckin(userId, date, 'morning'),
  ])

  // Everything below is scoped to the audited day, never "today".
  const sessionsUpToDay = workoutSessions.filter(ws => new Date(ws.startedAt).getTime() < nextMid.getTime())
  const ouraByDate = toOuraByDate(ouraRows)
  const ouraToday = ouraRows.find(r => r.date === date) ?? null
  const derivedForDay = derivedRows.find(r => r.day === date) ?? null
  const dayMetrics = bodyMetrics.find(m => m.date === date) ?? null
  const yesterdayMetrics = bodyMetrics.find(m => m.date === yesterdayIso) ?? null

  const summariesUpToDay = summaries.filter(s => s.date <= date)
  const summary = summariesUpToDay.find(s => s.date === date) ?? null
  const priorSummary = [...summariesUpToDay].reverse().find(s => s.date < date) ?? null

  // ── Personal baselines (28-day, low-wear days excluded — the live route's rule) ──
  const hrvRows = excludeLowWearDays(bodyMetrics.filter(m => m.hrvMs != null && m.hrvMs > 0), ouraByDate)
  const rhrRows = excludeLowWearDays(bodyMetrics.filter(m => m.restingHeartRate != null && m.restingHeartRate > 0), ouraByDate)
  const recentHrvRows = bodyMetrics.filter(m => m.date >= from7dIso && m.date <= date && m.hrvMs != null && m.hrvMs > 0)
  const recentRhrRows = bodyMetrics.filter(m => m.date >= from7dIso && m.date <= date && m.restingHeartRate != null && m.restingHeartRate > 0)

  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
  const baselineHrv = hrvRows.length >= BASELINE_MIN_SAMPLE_DAYS ? mean(hrvRows.map(m => m.hrvMs!)) : null
  const baselineRhr = rhrRows.length >= BASELINE_MIN_SAMPLE_DAYS ? mean(rhrRows.map(m => m.restingHeartRate!)) : null
  const recentHrv = mean(recentHrvRows.map(m => m.hrvMs!))
  const recentRhr = mean(recentRhrRows.map(m => m.restingHeartRate!))
  const lowWearExcluded =
    bodyMetrics.filter(m => m.hrvMs != null && m.hrvMs > 0).length - hrvRows.length

  // ── Goals + training load, anchored on the audited day ──
  const latestWeightKg = [...bodyMetrics].reverse().find(m => m.weightKg != null && m.weightKg > 0)?.weightKg ?? null
  const ageYears = ageFromDob(user?.dateOfBirth, dayMid)
  const goalProfile = {
    weightKg: latestWeightKg,
    heightCm: user?.heightCm ?? null,
    ageYears,
    sex: user?.sex ?? null,
    activityLevel: user?.activityLevel ?? null,
  }
  const goals = getDailyGoals(goalProfile)

  const load = computeVolumeAcwr(
    sessionsUpToDay.map(ws => ({
      startedAt: ws.startedAt,
      volumeKg: ws.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0),
    })),
    dayMid,
  )
  const programAgeMs = program?.startedAt ? dayMid.getTime() - new Date(program.startedAt).getTime() : Infinity
  const programTooNew = programAgeMs < 28 * 86_400_000
  const acwr = programTooNew ? null : load.acwr
  const acwrExcludedReason = programTooNew
    ? 'program is younger than 28 days, so the chronic-load baseline is not yet valid'
    : load.acwr == null
      ? 'not enough training history to form an acute:chronic ratio'
      : null

  const sessions7dRows = sessionsUpToDay.filter(ws => new Date(ws.startedAt).getTime() >= dayMid.getTime() - 7 * 86_400_000)
  const volume7dKg = sessions7dRows.reduce((s, ws) => s + ws.exercises.reduce((s2, ex) => s2 + (ex.volume ?? 0), 0), 0)

  // ── Zone minutes / moved hours from the audited day's intraday HR ──
  let zoneMinutes: number | null = null
  let moveHours: number | null = null
  if (baselineRhr != null && hrRows.length > 0) {
    const zones = computeHrZones({ maxHr: hrMaxFromAge(ageYears), restingHr: baselineRhr })
    zoneMinutes = activeMinutesFromZoneSeconds(
      accumulateZoneSeconds(hrRows.map(r => ({ timestamp: r.timestamp.getTime(), bpm: r.bpm })), zones),
    )
    moveHours = computeMovedHours({ hrRows, maxHr: hrMaxFromAge(ageYears), restingHr: baselineRhr, tz, dateIso: date })
  }

  const pillars: PillarAudit[] = []
  const safe = (label: string, fn: () => PillarAudit) => {
    try {
      pillars.push(fn())
    } catch (err) {
      warnings.push(`${label} audit failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const sleep = (() => {
    try {
      return buildSleepAudit({ date, tz, sleepSessions, derived: derivedForDay })
    } catch (err) {
      warnings.push(`Sleep audit failed: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  })()
  if (sleep) pillars.push(sleep)

  // Readiness reads the PRE-taper activity score, so compute the activity result first.
  const activityInput = {
    date, goals, goalProfile,
    steps: dayMetrics?.steps ?? null,
    activeCalories: dayMetrics?.activeCalories ?? null,
    zoneMinutes, moveHours,
    strengthSessionToday: sessionsUpToDay.some(ws => new Date(ws.startedAt).getTime() >= dayMid.getTime()),
    sessions7d: sessions7dRows.length,
    volume7dKg,
    typicalSessionVolumeKg: load.typicalSessionVolumeKg,
    acwr, acwrExcludedReason,
    derived: derivedForDay,
  }
  const preTaperActivity = computeActivityScore({
    steps: activityInput.steps, activeCalories: activityInput.activeCalories,
    zoneMinutes, moveHours, moveHoursGoal: moveHours != null ? moveHoursGoal() : null,
    strengthSessionToday: activityInput.strengthSessionToday,
    sessions7d: activityInput.sessions7d, volume7dKg, typicalSessionVolumeKg: load.typicalSessionVolumeKg,
    goals, acwr,
  })?.preTaperScore ?? null

  const prevDayActivityScore = (yesterdayMetrics || sessions7dRows.length > 0)
    ? computeActivityScore({
        steps: yesterdayMetrics?.steps ?? null,
        activeCalories: yesterdayMetrics?.activeCalories ?? null,
        sessions7d: activityInput.sessions7d, volume7dKg,
        typicalSessionVolumeKg: load.typicalSessionVolumeKg, goals,
      })?.preTaperScore ?? null
    : null

  safe('Readiness', () => buildReadinessAudit({
    date, summary, priorSummary,
    sleepScore: sleep?.score ?? null,
    activityScore: preTaperActivity,
    prevDayActivityScore,
    checkinEnergy: mood?.energyLevel ?? null,
    ouraDaily: ouraToday,
    derived: derivedForDay,
  }))

  safe('Activity', () => buildActivityAudit(activityInput))

  safe('Heart Rate', () => buildHeartRateAudit({
    date, hrRows, recentRhr, baselineRhr, recentHrv, baselineHrv, ageYears,
    rhrSampleDays: rhrRows.length,
    hrvSampleDays: hrvRows.length,
    lowWearDaysExcluded: Math.max(0, lowWearExcluded),
  }))

  const dayWorkouts = sessionsUpToDay.filter(ws => new Date(ws.startedAt).getTime() >= dayMid.getTime())
  const dayNutrition = nutrition.find(n => n.date === date) ?? null

  return {
    date,
    timezone: tz,
    generatedAt: new Date().toISOString(),
    historyWindowDays: AUDIT_HISTORY_DAYS,
    pillars,
    context: {
      checkin: mood
        ? {
            energyLevel: mood.energyLevel,
            sleepQuality: mood.sleepQuality,
            bodyState: mood.bodyState,
            soreMuscles: mood.soreMuscles,
            loggedAt: mood.createdAt.toISOString(),
          }
        : null,
      morningCheckin: morningCheckin
        ? {
            // Stored 1 = slept great … 5 = terrible (the on-screen selector reverses this).
            sleepQualityFeel: morningCheckin.sleepQualityFeel,
            sleepQualityFeelLabel:
              morningCheckin.sleepQualityFeel != null ? sleepFeelLabel(morningCheckin.sleepQualityFeel) : null,
            perceivedRecovery: morningCheckin.perceivedRecovery,
            motivation: morningCheckin.motivation,
            journal: morningCheckin.journal,
          }
        : null,
      workouts: dayWorkouts.map(ws => ({
        id: ws.id,
        startedAt: ws.startedAt.toISOString(),
        sessionName: ws.sessionName ?? null,
        exerciseCount: ws.exercises.length,
        volumeKg: Math.round(ws.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0)),
      })),
      activities: activityLogs.map(a => ({
        id: a.id, type: a.activityType, title: a.title,
        durationMin: a.durationMin ?? null, distanceKm: a.distanceKm ?? null,
        caloriesBurned: a.caloriesBurned ?? null, avgHr: a.avgHr ?? null, maxHr: a.maxHr ?? null,
        steps: a.steps ?? null,
      })),
      nutrition: dayNutrition
        ? { calories: dayNutrition.calories, proteinG: dayNutrition.proteinG, carbsG: dayNutrition.carbsG, fatG: dayNutrition.fatG }
        : null,
      bodyMetrics: dayMetrics
        ? {
            weightKg: dayMetrics.weightKg ?? null, bodyFatPct: dayMetrics.bodyFatPct ?? null,
            steps: dayMetrics.steps ?? null, activeCalories: dayMetrics.activeCalories ?? null,
            restingHeartRate: dayMetrics.restingHeartRate ?? null, hrvMs: dayMetrics.hrvMs ?? null,
            spo2Pct: dayMetrics.spo2Pct ?? null,
          }
        : null,
      // The night itself is already fully itemised under the Sleep pillar's `inputs` — not repeated here.
      sleepSession: null,
      dataQuality: {
        baselineNights: {
          value: summary?.nHistory ?? 0, unit: 'nights',
          note: `Readiness baselines mature at ${BASELINE_MIN_NIGHTS} nights; below that half the composite sits neutral.`,
        },
        hrvBaselineDays: { value: hrvRows.length, unit: 'days', note: `≥${BASELINE_MIN_SAMPLE_DAYS} required for a 28-day HRV baseline.` },
        rhrBaselineDays: { value: rhrRows.length, unit: 'days', note: `≥${BASELINE_MIN_SAMPLE_DAYS} required for a 28-day resting-HR baseline.` },
        intradayHrSamples: { value: hrRows.length, unit: 'samples', note: 'Drives zone-minutes, move-hours and the HR card.' },
        isLowWearDay: { value: isLowWearDay(ouraToday?.nonWearTimeSec), note: 'Low-wear days are excluded from baselines and skew same-day readings.' },
        sleepNightsInWindow: { value: sleepSessions.length, unit: 'nights' },
        hasDailySummary: { value: summary != null, note: 'Without an oura_daily_summary row the readiness composite cannot run at all.' },
      },
    },
    warnings,
  }
}
