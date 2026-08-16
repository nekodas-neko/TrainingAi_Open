import { tool } from 'ai'
import { z } from 'zod'
import { formatInTimeZone } from 'date-fns-tz'
import type { WorkoutRepository } from '@/lib/data/repository'
import { pearsonCorrelation, averageByDayOfWeek, type TrendClassification } from './analytics'
import { summarizePeriod } from './period-comparison'
import { computeVolumeAcwr } from '@trainingai/shared/ai-periodization/acwr'
import { projectRm } from '@trainingai/shared/health/strength-projection'
import { aggregateExerciseHrTrend, summarizeHrByExercise } from '@trainingai/shared/workout/exercise-hr-trend'
import { computeHrRecoveryProfile } from '@trainingai/shared/health/compute-hr-recovery-profile'
import { liveReadinessByDay } from '@trainingai/shared/health/live-readiness'
import { resilienceLevelToBand } from '@/lib/health/stress-resilience'
import { isBodyweightType, repMaxFromOneRm } from '@trainingai/shared/1rm'
import { todayMidnightUtc, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { nightSessions } from '@trainingai/shared/health/sleep-night'
import { computeEnergyBalance } from '@/lib/health/energy-balance-service'

export function buildChatTools(repo: WorkoutRepository, userId: string, tz: string, todayIso: string) {
  // User-local midnight, shared by every lookback window below — never Date.now(), which
  // straddles two AEST days depending on time of day (CLAUDE.md Date Arithmetic).
  const todayMid = todayMidnightUtc(tz)
  const daysAgo = (n: number) => new Date(todayMid.getTime() - n * 86_400_000)

  // Which exercises are bodyweight. Their stored 1RM is BW_REF-relative — an internal index, not a
  // weight anyone lifted — so it must reach the model as a rep max or it gets quoted at the user as
  // kilograms (finding Q-19). Fetched once per chat turn, and only if a 1RM-bearing tool runs.
  let typesPromise: Promise<Map<string, string>> | null = null
  const exerciseTypes = () => {
    typesPromise ??= repo.listExerciseLibrary().then(lib => new Map(lib.map(e => [e.name, e.exerciseType])))
    return typesPromise
  }
  /** The stored estimate rendered in the unit that means something for this exercise. */
  const oneRmFields = (oneRm: number | null | undefined, type: string | undefined) => {
    if (oneRm == null || oneRm <= 0) return { estimated1rm: null }
    return isBodyweightType(type)
      ? { estimated1rm: repMaxFromOneRm(oneRm), unit: 'reps (bodyweight — a rep max, NOT kilograms)' }
      : { estimated1rm: oneRm, unit: 'kg' }
  }

  return {
    getWorkoutsByExercise: tool({
      description: 'Set-by-set history for one exercise: date, session, weights (kg), reps, estimated 1RM and volume per occurrence. Use for progression questions, charts, and PR checks on a specific lift.',
      inputSchema: z.object({
        exerciseName: z.string().describe('Exact or close exercise name, e.g. "Barbell Bench Press"'),
        days: z.number().int().min(7).max(365).nullable().describe('Lookback window in days; null = 90'),
      }),
      execute: async ({ exerciseName, days }) => {
        const from = daysAgo(days ?? 90)
        const [sessions, types] = await Promise.all([
          repo.getWorkoutSessionsFrom(userId, from),
          exerciseTypes(),
        ])
        const needle = exerciseName.toLowerCase()
        const entries: object[] = []
        for (const ws of sessions) {
          for (const el of ws.exercises) {
            if (!el.exerciseName.toLowerCase().includes(needle)) continue
            entries.push({
              date: formatInTimeZone(ws.startedAt, tz, 'yyyy-MM-dd'),
              session: ws.sessionName,
              exercise: el.exerciseName,
              weightsKg: el.sets.map(s => s.weightKg),
              reps: el.sets.map(s => s.reps),
              ...oneRmFields(el.estimated1rm, types.get(el.exerciseName)),
              volumeKg: el.volume ?? null,
            })
          }
        }
        return { exerciseName, matches: entries.slice(-30) }
      },
    }),

    getRecoveryData: tool({
      description: 'Recovery data per day for a date range: readiness (the app\'s OWN BLE-derived composite score, not the frozen Cloud value), sleep scores/activity/temp deviation, sleep sessions (duration, efficiency, overnight HRV, lowest HR), body metrics (HRV, resting HR, SpO2, steps, weight), the app\'s illness-radar flag, daytime stress (dHRV level −1..+1, negative = stressed; minutes in high stress per day), stress-resilience level (1–5, higher = more resilient) and whole-day training-stress (OTS, with a HIGH flag). Use for recovery, sleep, HRV, SpO2, readiness, resilience, overtraining/training-load and "am I getting sick?" questions.',
      inputSchema: z.object({
        fromDate: z.string().describe('YYYY-MM-DD inclusive'),
        toDate: z.string().describe('YYYY-MM-DD inclusive'),
      }),
      execute: async ({ fromDate, toDate }) => {
        const [oura, sleep, metrics, derived] = await Promise.all([
          repo.getOuraDaily(userId, fromDate, toDate),
          repo.listSleepSessions(userId, fromDate, toDate),
          repo.listBodyMetrics(userId, fromDate, toDate),
          repo.getOuraDailyDerived(userId, fromDate, toDate),
        ])
        // Readiness must be the own BLE-derived composite, not the frozen Cloud column (F8).
        const readinessMap = liveReadinessByDay(derived, oura)
        return {
          ouraDaily: oura.map(r => ({
            date: r.date, readiness: readinessMap.get(r.date) ?? null, sleepScore: r.sleepScore ?? null,
            activityScore: r.activityScore ?? null, tempDeviationC: r.temperatureDeviation ?? null,
          })),
          // Nights, not rows (Q-76): the model reads this as one row per night, so a same-day nap
          // arrives as a second "night" with a 0.1 h duration and its own efficiency.
          sleepSessions: nightSessions(sleep, tz).map(s => ({
            date: s.date, durationHours: s.durationHours ?? null, efficiencyPct: s.efficiency ?? null,
            overnightHrvMs: s.averageHrvMs ?? null, lowestHrBpm: s.lowestHeartRate ?? null,
          })),
          bodyMetrics: metrics.map(m => ({
            date: m.date, hrvMs: m.hrvMs ?? null, restingHrBpm: m.restingHeartRate ?? null,
            spo2Pct: m.spo2Pct ?? null,
            steps: m.steps ?? null, weightKg: m.weightKg ?? null,
          })),
          illnessRadar: derived
            .filter(r => r.illnessFlag != null)
            .map(r => ({ date: r.day, flag: r.illnessFlag, score: r.illnessScore ?? null })),
          daytimeStress: derived
            .filter(d => d.daytimeStressScaled != null || d.stressHighMinutes != null)
            .map(d => ({ date: d.day, level: d.daytimeStressScaled ?? null, highMinutes: d.stressHighMinutes ?? null })),
          // Own stress-resilience level (1–5) + whole-day training-stress (OTS) — purpose-built
          // signals that were computed and stored but never surfaced to the chat (F9).
          resilience: derived
            .filter(d => d.resilienceLevel != null)
            .map(d => ({ date: d.day, level: d.resilienceLevel, band: d.resilienceLevel != null ? resilienceLevelToBand(d.resilienceLevel) : null })),
          trainingStress: derived
            .filter(d => d.trainingLoadOts != null)
            .map(d => ({ date: d.day, ots: d.trainingLoadOts, high: d.trainingLoadHigh ?? null })),
        }
      },
    }),

    getPersonalRecords: tool({
      description:
        'All-time estimated-1RM personal record per exercise. Each entry carries its own unit: ' +
        'weighted lifts are in kg, bodyweight movements are a REP MAX in reps. Never present a ' +
        'bodyweight record as a weight. Use to answer "what is my PR" and to flag new PRs.',
      inputSchema: z.object({}),
      execute: async () => {
        const [records, types] = await Promise.all([repo.listPersonalRecords(userId), exerciseTypes()])
        return {
          records: Object.fromEntries(
            Object.entries(records).map(([name, oneRm]) => [name, oneRmFields(oneRm as number, types.get(name))]),
          ),
        }
      },
    }),

    getNutritionDay: tool({
      description: 'Food logs and daily macro targets for one date: per-item calories/protein/carbs/fat plus totals and remaining calories.',
      inputSchema: z.object({
        date: z.string().nullable().describe('YYYY-MM-DD; null = today'),
      }),
      execute: async ({ date }) => {
        const d = date ?? todayIso
        const [logs, targets] = await Promise.all([
          repo.listFoodLogs(userId, d),
          repo.getNutritionTargets(userId),
        ])
        const totals = logs.reduce(
          (acc, l) => ({ calories: acc.calories + l.calories, proteinG: acc.proteinG + l.proteinG, carbsG: acc.carbsG + l.carbsG, fatG: acc.fatG + l.fatG }),
          { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
        )
        return {
          date: d,
          targets: targets ? { calories: targets.calories ?? null, proteinG: targets.proteinG ?? null, carbsG: targets.carbsG ?? null, fatG: targets.fatG ?? null } : null,
          totals: { calories: Math.round(totals.calories), proteinG: Math.round(totals.proteinG), carbsG: Math.round(totals.carbsG), fatG: Math.round(totals.fatG) },
          items: logs.map(l => ({ name: l.foodItem.name, meal: l.mealTypeId, calories: Math.round(l.calories), proteinG: Math.round(l.proteinG) })),
        }
      },
    }),

    getEnergyBalance: tool({
      description:
        'Calories in vs calories out for one date, and the user\'s CALIBRATED maintenance calories. ' +
        'Use this for any question about how much to eat, whether they are in a deficit or surplus, ' +
        'what their real TDEE/maintenance is, or how eating and training combine to hit a weight goal. ' +
        'The maintenance figure is measured from their own logged intake against their weight trend ' +
        'when `maintenance.source` is "calibrated" — prefer it over any formula. When it is "formula", ' +
        'say so and quote `maintenance.gapMessage`, which explains what is still needed to calibrate. ' +
        'Quote these numbers; never recompute them.',
      inputSchema: z.object({
        date: z.string().nullable().describe('YYYY-MM-DD; null = today'),
      }),
      execute: async ({ date }) => {
        const d = date ?? todayIso
        const r = await computeEnergyBalance(repo, userId, tz, d)
        if (r.balance == null) {
          return { date: d, available: false, missingProfileFields: r.missingProfileFields }
        }
        return {
          date: d,
          available: true,
          goal: r.goal,
          eatenKcal: r.balance.intakeKcal,
          burnedKcal: r.balance.expenditureKcal,
          restingBurnKcal: r.balance.restingBaseKcal,
          movementKcal: r.balance.activeKcal,
          movementBreakdown: r.activeBreakdown,
          netKcal: r.balance.netKcal,
          targetNetKcal: r.balance.targetNetKcal,
          kcalLeftToHitTarget: r.balance.remainingKcal,
          standing: r.balance.zoneLabel,
          projectedWeeklyKg: r.balance.projectedWeeklyKg,
          maintenance: r.maintenance,
          calorieTarget: r.target,
        }
      },
    }),

    getMealPlan: tool({
      description:
        "The user's active meal plan: its calorie/macro target, how many meals it splits into, and " +
        'each meal with its own targets. Use for "what should I eat tonight", "what is on my plan", ' +
        'or when suggesting a swap. Returns available:false when no plan is active — say so and ' +
        'offer to help them build one rather than inventing meals. Quote these numbers; never ' +
        'recompute them. If `staleDays` is set the plan is older than its review window, which is ' +
        'worth mentioning if their target has moved.',
      inputSchema: z.object({}),
      execute: async () => {
        const plan = await repo.getActiveMealPlan(userId)
        if (!plan) return { available: false }
        const reviewedAt = plan.lastReviewedAt ?? plan.generatedAt
        const ageDays = Math.floor((Date.now() - new Date(reviewedAt).getTime()) / 86_400_000)
        return {
          available: true,
          name: plan.name,
          mealsPerDay: plan.mealsPerDay,
          trainingTime: plan.trainingTime,
          // 'all' means one set of macros every day; otherwise a training/rest pair.
          variants: plan.variants.map(v => ({
            dayType: v.dayType,
            calories: v.targetCalories,
            proteinG: Math.round(v.targetProteinG),
            carbsG: Math.round(v.targetCarbsG),
            fatG: Math.round(v.targetFatG),
            meals: v.meals.map(m => ({
              name: m.name,
              notes: m.notes,
              calories: m.targetCalories,
              proteinG: Math.round(m.targetProteinG),
              carbsG: Math.round(m.targetCarbsG),
              fatG: Math.round(m.targetFatG),
            })),
          })),
          // Restrictions are carried so the coach does not suggest a swap the plan excluded.
          restrictions: plan.restrictionsSnapshot,
          staleDays: ageDays > 28 ? ageDays : null,
        }
      },
    }),

    getDayCheckins: tool({
      description: 'The subjective morning and evening wellness check-ins (1-5 scales: tiredness, mental drain, movement, hydration, late meal; sore muscles; journal) for one date.',
      inputSchema: z.object({
        date: z.string().nullable().describe('YYYY-MM-DD; null = today'),
      }),
      execute: async ({ date }) => {
        const d = date ?? todayIso
        const [morning, evening] = await Promise.all([
          repo.getDayCheckin(userId, d, 'morning'),
          repo.getDayCheckin(userId, d, 'evening'),
        ])
        return { date: d, morning, evening }
      },
    }),

    getReadinessExplanation: tool({
      description: "The app's own next-session recommendation engine output: which session it recommends today, its weighted scoring components (recovery/balance/freshness) and recovery signals. Use when asked why a session was recommended or what to train today.",
      inputSchema: z.object({}),
      execute: async () => {
        const rec = await repo.getNextSession(userId, tz)
        return {
          isRestDay: rec.isRestDay,
          recommendedSession: rec.session?.name ?? null,
          reason: rec.reason,
          weightedComponents: rec.weightedComponents ?? null,
          signals: rec.signals ?? null,
          deloadOrRestRecommended: rec.deloadOrRestRecommended ?? false,
          consecutiveTrainingDays: rec.consecutiveTrainingDays ?? 0,
        }
      },
    }),

    getRecoveryVsPerformance: tool({
      description: 'Correlates sleep/HRV/readiness and morning check-in soreness/energy against same-or-next-day training volume and RPE, with a computed correlation coefficient. Use for "does my sleep affect my lifting" type questions.',
      inputSchema: z.object({
        days: z.number().int().min(14).max(180).nullable().describe('Lookback window in days; null = 60'),
      }),
      execute: async ({ days }) => {
        const from = daysAgo(days ?? 60)
        const fromIso = formatInTimeZone(from, tz, 'yyyy-MM-dd')
        const [sessions, sleepSessions, ouraRows] = await Promise.all([
          repo.getWorkoutSessionsFrom(userId, from),
          repo.listSleepSessions(userId, fromIso, todayIso),
          repo.getOuraDaily(userId, fromIso, todayIso),
        ])
        const sessionsByDate = new Map<string, { volume: number; avgRpe: number | null }>()
        for (const ws of sessions) {
          if (ws.exercises.length === 0) continue
          const dateKey = formatInTimeZone(ws.startedAt, tz, 'yyyy-MM-dd')
          const volume = ws.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0)
          sessionsByDate.set(dateKey, { volume, avgRpe: ws.sessionRpe ?? null })
        }
        // Overnight HRV per night (Q-76) — a nap's HRV is not an overnight reading, and keying by
        // date let it overwrite the real one before this correlation ever ran.
        const hrvByDate = new Map(nightSessions(sleepSessions, tz).filter(s => s.averageHrvMs != null).map(s => [s.date, s.averageHrvMs!]))
        const readinessByDate = new Map(ouraRows.filter(r => r.readinessScore != null).map(r => [r.date, r.readinessScore!]))

        const hrvPairs: { hrv: number; volume: number }[] = []
        for (const [date, hrv] of hrvByDate) {
          const nextDay = shiftDateStr(date, 1)
          const same = sessionsByDate.get(date)
          const next = sessionsByDate.get(nextDay)
          if (same) hrvPairs.push({ hrv, volume: same.volume })
          else if (next) hrvPairs.push({ hrv, volume: next.volume })
        }
        const correlation = hrvPairs.length >= 3
          ? pearsonCorrelation(hrvPairs.map(p => p.hrv), hrvPairs.map(p => p.volume))
          : null

        return {
          pairedDays: hrvPairs.length,
          hrvVsVolumeCorrelation: correlation,
          readinessDatesAvailable: readinessByDate.size,
          note: correlation == null ? 'Not enough paired days yet for a reliable correlation.' : null,
        }
      },
    }),

    getDayOfWeekTrends: tool({
      description: 'Historical average training volume per weekday across all logged sessions. Use for "what day do I perform best" type questions.',
      inputSchema: z.object({}),
      execute: async () => {
        const from90d = daysAgo(90)
        const sessions = await repo.getWorkoutSessionsFrom(userId, from90d)
        const entries = sessions
          .filter(ws => ws.exercises.length > 0)
          .map(ws => ({
            date: formatInTimeZone(ws.startedAt, tz, 'yyyy-MM-dd'),
            value: ws.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0),
          }))
        return { avgVolumeByWeekday: averageByDayOfWeek(entries) }
      },
    }),

    getPlateauReport: tool({
      description: 'Per-exercise trend (improving/plateaued/declining) from estimated-1RM history, plus days since each exercise\'s last PR. Use for "what\'s stalled" type questions.',
      inputSchema: z.object({}),
      execute: async () => {
        const from180d = daysAgo(180)
        const from10y = daysAgo(10 * 365)
        const [sessions, recentPrs] = await Promise.all([
          repo.getWorkoutSessionsFrom(userId, from180d),
          repo.listRecentPersonalRecords(userId, from10y, new Date()),
        ])
        const byExercise = new Map<string, { date: Date; orm: number }[]>()
        for (const ws of sessions) {
          for (const el of ws.exercises) {
            if (el.estimated1rm == null || el.estimated1rm <= 0) continue
            const arr = byExercise.get(el.exerciseName) ?? []
            arr.push({ date: ws.startedAt, orm: el.estimated1rm })
            byExercise.set(el.exerciseName, arr)
          }
        }
        const recordDates = new Map(recentPrs.map(r => [r.exerciseName, r.achievedAt]))
        const now = Date.now()
        const report = [...byExercise.entries()]
          .filter(([, entries]) => entries.length >= 3)
          .map(([name, entries]) => {
            const sorted = entries.sort((a, b) => a.date.getTime() - b.date.getTime())
            // Day-spaced plateau verdict (projectRm) — shares the single definition the
            // Health screen's strength-projection card uses, instead of the index-spaced
            // classifyTrend, so the AI chat and Health screen never disagree on "plateaued".
            const proj = projectRm(sorted.map(e => ({ date: formatInTimeZone(e.date, tz, 'yyyy-MM-dd'), rm: e.orm })))
            const trend: TrendClassification =
              !proj ? 'plateaued'
              : proj.plateau ? 'plateaued'
              : proj.slopePerWeek > 0 ? 'improving'
              : 'declining'
            const prDate = recordDates.get(name)
            const daysSincePr = prDate ? Math.round((now - prDate.getTime()) / 86_400_000) : null
            return { exerciseName: name, trend, sessionsAnalyzed: sorted.length, daysSinceLastPr: daysSincePr }
          })
          .sort((a, b) => (b.daysSinceLastPr ?? 0) - (a.daysSinceLastPr ?? 0))
        return { exercises: report }
      },
    }),

    getProgressVsPast: tool({
      description: 'Compares training volume/session count now vs. a month or quarter ago. Use for "how am I doing vs last month" type questions.',
      inputSchema: z.object({
        period: z.enum(['month', 'quarter']),
      }),
      execute: async ({ period }) => {
        const windowDays = period === 'month' ? 30 : 90
        const currentEnd = todayMid
        const currentStart = daysAgo(windowDays)
        const pastStart = daysAgo(windowDays * 2)
        const sessions = await repo.getWorkoutSessionsFrom(userId, pastStart)
        return {
          period,
          current: summarizePeriod(sessions, currentStart, currentEnd),
          past: summarizePeriod(sessions, pastStart, currentStart),
        }
      },
    }),

    getTrainingLoadRisk: tool({
      description: 'Current training-load risk band (ACWR — acute:chronic workload ratio) and HRV deviation from baseline. Use for "am I overtraining" type questions.',
      inputSchema: z.object({}),
      execute: async () => {
        const from56d = daysAgo(56)
        const loads = await repo.getSessionLoadsFrom(userId, from56d)
        const acwr = computeVolumeAcwr(
          loads.map(l => ({ startedAt: l.startedAt, volumeKg: l.volume })),
          todayMid,
        )
        return { acwr }
      },
    }),

    getWorkoutHrTrends: tool({
      description: 'Intra-workout heart-rate trends per exercise, from HR recorded during sets (CARDIOVASCULAR ONLY — how fast the heart settles between sets. NOT CNS/muscular readiness, NOT a training-load, overtraining or illness signal; never advise on rest sufficiency for recovery beyond the cardiovascular sense). With no exerciseName: a one-row-per-exercise overview (sessions, avg peak HR during sets, avgDrop60 = mean beats the HR falls in the 60s of rest after a set, %HR-reserve recovered by the next set, avg seconds to return to the pre-set HR) — use to COMPARE exercises, e.g. "which lift recovers slowest" (a SMALLER avgDrop60 = slower recovery). With exerciseName: the detailed trend for that lift — per-session avg/max peak HR and rest recovery over time, plus a breakdown by working weight (byIntensity: %1RM band → avgDrop60/avgPeakBpm), so you can say e.g. "at 90% HR drops ~X bpm/min vs ~Y at 70%". A LARGER 60s drop = faster recovery = generally better conditioning; a FALLING peak HR at the same weight over months can indicate improved fitness. Only sets recorded with a HR monitor (chest strap / ring) appear — a lift with no monitored sets returns empty.',
      inputSchema: z.object({
        exerciseName: z.string().nullable().describe('Exact or close exercise name for the detailed view; null = overview across all exercises'),
        days: z.number().int().min(7).max(365).nullable().describe('Lookback window in days; null = 180'),
      }),
      execute: async ({ exerciseName, days }) => {
        const since = daysAgo(days ?? 180)
        const rows = await repo.getSetHrStatsSince(userId, since)
        if (exerciseName) {
          const needle = exerciseName.toLowerCase()
          const filtered = rows.filter(r => r.exerciseName.toLowerCase().includes(needle))
          return { exercise: exerciseName, ...aggregateExerciseHrTrend(filtered) }
        }
        return { byExercise: summarizeHrByExercise(rows) }
      },
    }),

    getHrRecoveryProfile: tool({
      description: 'Heart-rate recovery bucketed by the HR being recovered FROM ("peak bands": <110, 110-129, 130-149, 150-169, 170+), pooling EVERY monitored effort — weight-training rests AND completed-workout cooldowns (e.g. runs) — not just one exercise. This is CARDIOVASCULAR fitness only (never CNS/muscular readiness, never a training-load or overtraining signal). Use this instead of getWorkoutHrTrends when the question is intensity-normalised or cross-modal, e.g. "how does my recovery from a 150bpm effort compare to 180bpm", "is my cardio fitness improving", "am I recovering faster than a few months ago" — getWorkoutHrTrends is for comparing one exercise to itself/others, this tool is for comparing effort LEVEL regardless of what caused it. Returns `bands` (current snapshot per peak-HR band: medianRateBpmMin = bpm/min shed — HIGHER is better/faster recovery; medianSecToResting; recoveredPct; n; bySource = episode counts by origin, e.g. {set_rest: 5, run_cooldown: 2} — a band mixing sources should be described as such, since standing rests and workout cooldowns don\'t necessarily recover at the same rate) and `trend` (one array per band of {period: "yyyy-MM", medianRateBpmMin, n}, oldest first — compare early vs. recent periods to say whether recovery is trending faster). The <110 band is intentionally excluded from bands/trend below 110bpm — barely-elevated HR is noise, not signal. Empty bands/trend means no monitored effort in that range yet.',
      inputSchema: z.object({
        days: z.number().int().min(30).max(730).nullable().describe('Lookback window in days; null = 180'),
      }),
      execute: async ({ days }) => {
        const { profile, trend } = await computeHrRecoveryProfile(repo, userId, tz, days ?? 180)
        return { ...profile, trend }
      },
    }),

    getMilestones: tool({
      description: 'All-time totals: workouts logged, total volume lifted, PRs this year, longest training streak. Use for "how much have I done overall" type questions.',
      inputSchema: z.object({}),
      execute: async () => {
        const from10y = daysAgo(10 * 365)
        const jan1ThisYear = dateStrMidnightInTz(`${todayIso.slice(0, 4)}-01-01`, tz)
        const [sessions, records, prsThisYear] = await Promise.all([
          repo.getWorkoutSessionsFrom(userId, from10y),
          repo.listPersonalRecords(userId),
          repo.listRecentPersonalRecords(userId, jan1ThisYear, new Date()),
        ])
        const trained = sessions.filter(ws => ws.exercises.length > 0)
        const totalVolumeKg = Math.round(
          trained.reduce((s, ws) => s + ws.exercises.reduce((e, ex) => e + (ex.volume ?? 0), 0), 0),
        )
        return {
          totalWorkouts: trained.length,
          totalVolumeKg,
          prCount: records.size,
          prsThisYear: prsThisYear.length,
        }
      },
    }),
  }
}
