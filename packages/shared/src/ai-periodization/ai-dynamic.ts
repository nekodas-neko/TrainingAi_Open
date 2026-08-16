import { toAestDay } from '@trainingai/shared/date-utils'
import type { ProgramSession, MuscleAssignment, NextSessionRecommendation } from '@trainingai/shared/types/program'
import type { IllnessFlag } from '@trainingai/shared/health/illness-radar'
import { STRESS_HIGH_DAY_THRESHOLD_MIN } from '@/lib/health/daytime-stress'

export interface MuscleRecovery {
  muscle: string
  pct: number
  hoursAgo: number
}

export interface SessionHistory {
  sessionName: string
  startedAt: Date
  hasExercises: boolean
}

export interface AiDynamicInput {
  sessions: ProgramSession[]
  muscleAssignments: Record<string, MuscleAssignment[]>
  muscleRecovery: MuscleRecovery[]
  history: SessionHistory[]
  soreMuscles: string[]
  readinessScore: number | null
  temperatureDeviation: number | null
  // Nights of accrued temperature baseline. The elevated-temp deload only fires once this is
  // solid (≥ TEMP_BASELINE_MIN_DAYS) so an immature baseline (or the frozen pre-re-key Cloud value)
  // can't trigger a deload off noise. Absent ⇒ treated as 0 (won't fire).
  temperatureBaselineDays?: number
  daySummary: string | null
  timezone: string
  reminderEnabled: boolean
  reminderTime: string | null
  sleepTrend: number | null
  energyLevel: string | null
  /** Lifter selected "Sick / Unwell" in today's readiness check-in. */
  selfReportedSick?: boolean
  hrvTrend: number | null
  // Latest persisted illness-radar flag (null = no data / learning). elevated/fever are the
  // only action-bearing values — watch is advisory-only, mirroring READINESS_SUPPRESSION.
  illnessFlag: IllnessFlag | null
  /** today's derived stress-high minutes (oura_daily_derived) — null when not computed yet */
  stressHighMinutes: number | null
}

// ── Muscle recovery helpers ───────────────────────────────────────────────────

function recoveryPct(muscle: string, recoveries: MuscleRecovery[]): number {
  const r = recoveries.find(m => m.muscle.toLowerCase() === muscle.toLowerCase())
  if (!r) return 100
  return r.pct
}

function sessionRecoveryScore(
  session: ProgramSession,
  muscleAssignments: Record<string, MuscleAssignment[]>,
  recoveries: MuscleRecovery[],
  soreMuscles: string[],
): number {
  const soreSet = new Set(soreMuscles.map(m => m.toLowerCase()))
  let weightedSum = 0
  let totalWeight = 0

  for (const ex of session.exercises) {
    const assignments = muscleAssignments[ex.exerciseName] ?? ex.muscleGroups.map(m => ({ muscle: m, role: 'main' as const }))
    for (const { muscle, role } of assignments) {
      const weight = role === 'main' ? 1.0 : 0.5
      let pct = recoveryPct(muscle, recoveries)
      if (role === 'main' && soreSet.has(muscle.toLowerCase())) {
        pct = Math.min(pct, 40)
      } else if (role === 'secondary' && soreSet.has(muscle.toLowerCase())) {
        pct = pct * 0.75
      }
      weightedSum += pct * weight
      totalWeight += weight
    }
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 100
}

// ── Balance score — how overdue is this session? ──────────────────────────────

const THIRTY_DAYS_MS = 30 * 86_400_000

function sessionBalanceScore(
  session: ProgramSession,
  sessions: ProgramSession[],
  history: SessionHistory[],
  now: Date,
): number {
  const lastDoneMs = (s: ProgramSession): number => {
    const entry = history.find(h => h.sessionName.toLowerCase() === s.name.toLowerCase() && h.hasExercises)
    // Use 30-day fallback for never-done sessions, not Unix epoch
    return entry ? entry.startedAt.getTime() : now.getTime() - THIRTY_DAYS_MS
  }
  const myMs = lastDoneMs(session)
  const allMs = sessions.map(lastDoneMs)
  const minMs = Math.min(...allMs)
  const maxMs = Math.max(...allMs)
  if (maxMs === minMs) return 50
  const daysSince = (now.getTime() - myMs) / 86_400_000
  const maxDaysSince = (now.getTime() - minMs) / 86_400_000
  return Math.min(100, (daysSince / maxDaysSince) * 100)
}

// ── Freshness score — inverse of recency ─────────────────────────────────────

function sessionFreshnessScore(session: ProgramSession, history: SessionHistory[], now: Date): number {
  const last = history.find(h => h.sessionName.toLowerCase() === session.name.toLowerCase() && h.hasExercises)
  if (!last) return 100
  const hoursAgo = (now.getTime() - last.startedAt.getTime()) / 3_600_000
  return Math.min(100, (hoursAgo / 48) * 100)
}

// ── Consecutive day counters ──────────────────────────────────────────────────

export function countConsecutiveTrainingDays(history: SessionHistory[], now: Date, tz: string): number {
  const trainedDays = new Set(
    history
      .filter(h => h.hasExercises)
      .map(h => toAestDay(h.startedAt, tz)),
  )
  let count = 0
  const cursor = new Date(now)
  cursor.setDate(cursor.getDate() - 1)
  for (let i = 0; i < 30; i++) {
    const dayStr = toAestDay(cursor, tz)
    if (trainedDays.has(dayStr)) {
      count++
      cursor.setDate(cursor.getDate() - 1)
    } else {
      break
    }
  }
  return count
}

export function countConsecutiveRestDays(history: SessionHistory[], now: Date, tz: string): number {
  const trainedDays = new Set(
    history
      .filter(h => h.hasExercises)
      .map(h => toAestDay(h.startedAt, tz)),
  )
  let count = 0
  const cursor = new Date(now)
  cursor.setDate(cursor.getDate() - 1)
  for (let i = 0; i < 30; i++) {
    const dayStr = toAestDay(cursor, tz)
    if (!trainedDays.has(dayStr)) {
      count++
      cursor.setDate(cursor.getDate() - 1)
    } else {
      break
    }
  }
  return count
}

// ── Deload strength from readiness ───────────────────────────────────────────

// Defined in `deload-constants.ts` (import-free) and re-exported here so every existing importer
// is unchanged. Client components must import them from there instead: this module transitively
// pulls the ONNX runtime, so a client import of even a bare number fails the build.
import { TEMP_BASELINE_MIN_DAYS, TEMP_ALERT_THRESHOLD_C } from './deload-constants'
export { TEMP_BASELINE_MIN_DAYS, TEMP_ALERT_THRESHOLD_C }

function computeDeloadStrength(
  consecutiveTrainingDays: number,
  readinessScore: number | null,
  temperatureDeviation: number | null,
  temperatureBaselineDays: number,
  daySummary: string | null,
  illnessFlag: IllnessFlag | null,
  stressHighMinutes: number | null,
): { recommended: boolean; strength: 'soft' | 'recommended' | 'strong'; temperatureAlert: boolean } {
  // Fever overrides everything — the strongest "don't train hard" signal we have.
  // temperatureAlert stays tied to the Cloud temp-deviation field (its own UI copy).
  if (illnessFlag === 'fever') {
    return { recommended: true, strength: 'strong', temperatureAlert: false }
  }

  // Only trust an elevated temperature once the baseline is mature enough to define "normal".
  const tempAlert = temperatureDeviation != null && temperatureDeviation > TEMP_ALERT_THRESHOLD_C
    && temperatureBaselineDays >= TEMP_BASELINE_MIN_DAYS
  // Derived-first: a non-null derived value means the ring measured today, and it decides.
  // Only with no derived stress at all does the frozen Cloud day_summary still count (S5).
  const stressOverride = stressHighMinutes != null
    ? stressHighMinutes >= STRESS_HIGH_DAY_THRESHOLD_MIN
    : daySummary === 'very_stressful'

  if (tempAlert || stressOverride || illnessFlag === 'elevated') {
    return { recommended: true, strength: 'recommended', temperatureAlert: tempAlert }
  }

  if (consecutiveTrainingDays < 3) {   // was < 4
    return { recommended: false, strength: 'soft', temperatureAlert: false }
  }

  const r = readinessScore ?? 70
  if (r >= 70) return { recommended: true, strength: 'soft', temperatureAlert: false }
  if (r >= 50) return { recommended: true, strength: 'recommended', temperatureAlert: false }
  return { recommended: true, strength: 'strong', temperatureAlert: false }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function computeAiDynamicNextSession(input: AiDynamicInput): NextSessionRecommendation {
  const {
    sessions, muscleAssignments, muscleRecovery, history, soreMuscles,
    readinessScore, temperatureDeviation, temperatureBaselineDays, daySummary, timezone,
    reminderEnabled, reminderTime, sleepTrend, energyLevel, selfReportedSick, hrvTrend, illnessFlag, stressHighMinutes,
  } = input

  const now = new Date()
  const rem = { reminderEnabled, reminderTime }

  if (sessions.length === 0) {
    return { isRestDay: false, reason: 'No sessions in program', ...rem }
  }

  // Already trained today — show today's session
  const todayStr = toAestDay(now, timezone)
  const todaySession = history.find(h => h.hasExercises && toAestDay(h.startedAt, timezone) === todayStr)
  if (todaySession) {
    const sess = sessions.find(s => s.name.toLowerCase() === todaySession.sessionName.toLowerCase())
    if (sess) return { isRestDay: false, session: sess, reason: `Already trained: ${sess.name}`, ...rem }
  }

  // Shift recovery weight up when readiness or sleep quality is low
  const lowReadiness = readinessScore != null && readinessScore < 60
  const lowSleep = sleepTrend != null && sleepTrend < 0.85
  const wRecovery  = (lowReadiness || lowSleep) ? 0.55 : 0.40
  const wBalance   = (lowReadiness || lowSleep) ? 0.25 : 0.35
  const wFreshness = (lowReadiness || lowSleep) ? 0.20 : 0.25

  // Score every session and capture component scores for the explain page
  const scoredRaw = sessions.map(s => {
    const recoveryScore  = sessionRecoveryScore(s, muscleAssignments, muscleRecovery, soreMuscles)
    const balanceScore   = sessionBalanceScore(s, sessions, history, now)
    const freshnessScore = sessionFreshnessScore(s, history, now)
    return {
      session: s,
      recoveryScore,
      balanceScore,
      freshnessScore,
      overallScore: recoveryScore * wRecovery + balanceScore * wBalance + freshnessScore * wFreshness,
    }
  }).sort((a, b) => b.overallScore - a.overallScore)

  const bestRaw = scoredRaw[0]
  const best = bestRaw.session
  const recovery = Math.round(bestRaw.recoveryScore)

  const consecutiveTrainingDays = countConsecutiveTrainingDays(history, now, timezone)
  const consecutiveRestDays = countConsecutiveRestDays(history, now, timezone)

  const deload = computeDeloadStrength(
    consecutiveTrainingDays, readinessScore, temperatureDeviation, temperatureBaselineDays ?? 0,
    daySummary, illnessFlag, stressHighMinutes,
  )
  let recommended = deload.recommended
  let strength = deload.strength

  // Self-reported illness is the strongest subjective signal there is — the lifter knows they
  // have a fever before any of our biometrics do (owner call 2026-07-29). It forces the strongest
  // recommendation, which the home surfaces render as "rest today"; it never blocks training.
  if (selfReportedSick) {
    recommended = true
    strength = 'strong'
  }

  // Energy level can push deload strength up one level or force 'strong'
  if (energyLevel === 'drained') {
    recommended = true
    strength = 'strong'
  } else if (energyLevel === 'low') {
    if (!recommended) {
      recommended = true
      strength = 'soft'
    } else if (strength === 'soft') {
      strength = 'recommended'
    } else if (strength === 'recommended') {
      strength = 'strong'
    }
  }

  const hrvWarning = hrvTrend != null && hrvTrend < 0.85

  const weightedComponents = {
    recovery:  { score: Math.round(bestRaw.recoveryScore),  weight: wRecovery },
    balance:   { score: Math.round(bestRaw.balanceScore),   weight: wBalance },
    freshness: { score: Math.round(bestRaw.freshnessScore), weight: wFreshness },
  }

  const scoredSessions = scoredRaw.map(s => ({
    session:       s.session,
    overallScore:  Math.round(s.overallScore),
    recoveryScore: Math.round(s.recoveryScore),
    balanceScore:  Math.round(s.balanceScore),
    freshnessScore: Math.round(s.freshnessScore),
  }))

  const reason = `${best.name} · recovery ${recovery}% · ${consecutiveTrainingDays} training days`

  return {
    isRestDay: false,
    session: best,
    reason,
    deloadOrRestRecommended: recommended,
    deloadStrength: strength,
    consecutiveTrainingDays,
    consecutiveRestDays,
    streakWarning: consecutiveRestDays === 2,
    streakBroken: consecutiveRestDays >= 3,
    temperatureAlert: deload.temperatureAlert,
    weightedComponents,
    scoredSessions,
    hrvWarning,
    ...rem,
  }
}
