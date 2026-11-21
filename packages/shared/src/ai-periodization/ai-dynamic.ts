import { toAestDay } from '@trainingai/shared/date-utils'
import { soreTickProvenance } from '@trainingai/shared/checkin/suggested-soreness'
import { normalizeMuscle, moodMuscleMatches } from '@trainingai/shared/muscles'
import type { ProgramSession, MuscleAssignment, NextSessionRecommendation } from '@trainingai/shared/types/program'
import type { IllnessFlag } from '@trainingai/shared/health/illness-radar'
import { loggedAsSession, programSessionFor } from '@trainingai/shared/workout/session-identity'
import { cutFor } from '@trainingai/shared/health/readiness-decision-thresholds'
import type { TrendReading } from '@trainingai/shared/health/sleep-trend'
import { decideDailyRest, restRuleSleepTrend } from './daily-rest-decision'

export interface MuscleRecovery {
  muscle: string
  pct: number
  hoursAgo: number
}

export interface SessionHistory {
  sessionName: string
  /** `workout_sessions.session_id`: the identity matched first (#3665). Null on an unlinked row. */
  programSessionId?: string | null
  startedAt: Date
  hasExercises: boolean
}

export interface AiDynamicInput {
  sessions: ProgramSession[]
  muscleAssignments: Record<string, MuscleAssignment[]>
  muscleRecovery: MuscleRecovery[]
  history: SessionHistory[]
  soreMuscles: string[]
  /**
   * BF-173. The subset of `soreMuscles` the model itself pre-ticked. Absent or `null` means the
   * log predates provenance, and every tick clamps as it did before — never assume "none".
   */
  suggestedSoreMuscles?: string[] | null
  readinessScore: number | null
  /** `model_versions.readiness` of the row `readinessScore` came from. Its cuts are chosen for that
   *  score's scale (#3824): a row written before #3778 shipped is judged by the old cuts. */
  readinessModelVersion: string | null
  temperatureDeviation: number | null
  // Nights of accrued temperature baseline. The elevated-temp deload only fires once this is
  // solid (≥ TEMP_BASELINE_MIN_DAYS) so an immature baseline (or the frozen pre-re-key Cloud value)
  // can't trigger a deload off noise. Absent ⇒ treated as 0 (won't fire).
  temperatureBaselineDays?: number
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
  /**
   * TN-18: is the temperature baseline centred enough for `temperatureDeviation` to mean anything?
   *
   * Computed by `isTemperatureBaselineCentred` over the trailing summaries — the SAME condition
   * readiness uses, imported rather than re-derived, because two answers to "is temperature
   * trustworthy" is how the owner ended up with a 80/100 contributor and a deload banner
   * disagreeing about one night.
   *
   * **Absent ⇒ NOT trusted**, which suppresses the alert. That default is the safe direction and
   * it is the opposite of `temperatureBaselineDays`': an omitted maturity count reads as 0 and
   * also suppresses, so both unknowns fail the same way. A caller that has the summaries passes
   * the real value; one that does not should not be firing this alert.
   */
  temperatureTrusted?: boolean
  /**
   * #3718: the trends the AI prescription prompt's rest-day rule reads, each with its newest night,
   * from the same helpers `signals.ts` uses (`sleep-trend.ts`, `recovery-trends.ts`). Absent ⇒ none
   * of the trend rest signals can fire; a stale one (newest night not today) never fires either.
   */
  restTrends?: {
    sleepScore: TrendReading | null
    sleepDuration: TrendReading | null
    hrv: TrendReading | null
    spo2: TrendReading | null
  }
}

// ── Muscle recovery helpers ───────────────────────────────────────────────────

/**
 * BF-171. Both sides go through `normalizeMuscle`, because a miss here returns 100 — "fully
 * recovered" — and a synonym mismatch is therefore indistinguishable from a rested muscle.
 * `computeMuscleRecovery` keys its output through the same normaliser, so it emits `abs` where an
 * assignment says `core`; raw comparison missed and threw away a real 86%.
 */
function recoveryPct(muscle: string, recoveries: MuscleRecovery[]): number {
  const target = normalizeMuscle(muscle)
  const r = recoveries.find(m => normalizeMuscle(m.muscle) === target)
  if (!r) return 100
  return r.pct
}

/**
 * BF-173. A sore tick only carries information the recovery model does not already have when the
 * lifter put it there. `suggestedSoreMuscles` pre-ticks any muscle trained within 48 h and under
 * 85% recovered — reading the very recovery feed this function is about to score — so clamping an
 * accepted suggestion counts one fact twice, and the clamp is a flat floor, so the second count
 * also destroys the ordering the first one computed (quads 69 and chest 49 both become 40).
 *
 * `suggested` is `null` for a log written before provenance was stored: unknown, so every tick
 * clamps, exactly as before. An accepted suggestion falls through to its own recovery pct, which
 * already encodes "you trained this recently and it is not recovered".
 */
function sessionRecoveryScore(
  session: ProgramSession,
  muscleAssignments: Record<string, MuscleAssignment[]>,
  recoveries: MuscleRecovery[],
  soreMuscles: string[],
  suggestedSoreMuscles: string[] | null | undefined,
): number {
  // A tick penalises only if the lifter added it. On `null` (unknown provenance) nothing is
  // treated as suggested, so the pre-BF-173 behaviour is preserved rather than guessed at.
  //
  // BF-171: kept as a LIST of labels rather than a set of muscle names. A pill is a broad region
  // ("Back") that covers several catalogue muscles, so membership is not the question —
  // `moodMuscleMatches` is. Both sides of the provenance filter are pill labels from one
  // vocabulary, so they still compare directly, through the normaliser for the same reason
  // everything else here does.
  const lifterAdded = soreTickProvenance(soreMuscles, suggestedSoreMuscles).lifterReported
  // BF-171. This is the only soreness consumer in the repo that matched raw; the other six go
  // through `moodMuscleMatches`. "Back" is a pill the picker offers and the exercise library has no
  // muscle of that name — it has `lats`, `upper back` and `traps` — so exact equality clamped
  // nothing, and a lifter with a wrecked back was recommended Pull at full confidence.
  const isSore = (muscle: string) => lifterAdded.some(label => moodMuscleMatches(muscle, label))
  let weightedSum = 0
  let totalWeight = 0

  for (const ex of session.exercises) {
    const assignments = muscleAssignments[ex.exerciseName] ?? ex.muscleGroups.map(m => ({ muscle: m, role: 'main' as const }))
    for (const { muscle, role } of assignments) {
      const weight = role === 'main' ? 1.0 : 0.5
      let pct = recoveryPct(muscle, recoveries)
      const sore = isSore(muscle)
      if (role === 'main' && sore) {
        pct = Math.min(pct, 40)
      } else if (role === 'secondary' && sore) {
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
  const ids = new Set(sessions.map(x => x.id))
  const lastDoneMs = (s: ProgramSession): number => {
    const entry = history.find(h => h.hasExercises && loggedAsSession(h, s, ids))
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

function sessionFreshnessScore(
  session: ProgramSession,
  sessions: ProgramSession[],
  history: SessionHistory[],
  now: Date,
): number {
  const ids = new Set(sessions.map(x => x.id))
  const last = history.find(h => h.hasExercises && loggedAsSession(h, session, ids))
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

// The grade itself (fever, temperature, illness, the training streak, the AI rule's three rest
// signals, sick and energy) is `decideDailyRest` in `daily-rest-decision.ts` (#3718), a pure function
// a replay over past days can call.

// ── Main entry point ──────────────────────────────────────────────────────────

export function computeAiDynamicNextSession(input: AiDynamicInput): NextSessionRecommendation {
  const {
    sessions, muscleAssignments, muscleRecovery, history, soreMuscles, suggestedSoreMuscles,
    readinessScore, readinessModelVersion, temperatureDeviation, temperatureBaselineDays, timezone,
    reminderEnabled, reminderTime, sleepTrend, energyLevel, selfReportedSick, hrvTrend, illnessFlag,
    temperatureTrusted, restTrends,
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
    const sess = programSessionFor(todaySession, sessions)
    if (sess) return { isRestDay: false, session: sess, reason: `Already trained: ${sess.name}`, ...rem }
  }

  // Shift recovery weight up when readiness or sleep quality is low (#3778: the cut was 60 before the
  // readiness centre moved to 75; #3824: a score from before the move is still judged at 60)
  const lowReadiness = readinessScore != null && readinessScore < cutFor('sessionLowReadiness', readinessModelVersion)
  const lowSleep = sleepTrend != null && sleepTrend < 0.85
  const wRecovery  = (lowReadiness || lowSleep) ? 0.55 : 0.40
  const wBalance   = (lowReadiness || lowSleep) ? 0.25 : 0.35
  const wFreshness = (lowReadiness || lowSleep) ? 0.20 : 0.25

  // Score every session and capture component scores for the explain page
  const scoredRaw = sessions.map(s => {
    const recoveryScore  = sessionRecoveryScore(s, muscleAssignments, muscleRecovery, soreMuscles, suggestedSoreMuscles)
    const balanceScore   = sessionBalanceScore(s, sessions, history, now)
    const freshnessScore = sessionFreshnessScore(s, sessions, history, now)
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

  const deload = decideDailyRest({
    today: todayStr,
    consecutiveTrainingDays,
    readinessScore,
    readinessModelVersion,
    temperatureDeviation,
    temperatureBaselineDays: temperatureBaselineDays ?? 0,
    temperatureTrusted: temperatureTrusted ?? false,
    illnessFlag,
    selfReportedSick: selfReportedSick ?? false,
    energyLevel,
    sleepTrend: restRuleSleepTrend(restTrends?.sleepScore ?? null, restTrends?.sleepDuration ?? null),
    hrvTrend: restTrends?.hrv ?? null,
    spo2Trend: restTrends?.spo2 ?? null,
  })
  const recommended = deload.recommended
  const strength = deload.strength

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
    ...(deload.restSignals.length > 0 ? { restSignals: deload.restSignals } : {}),
    weightedComponents,
    scoredSessions,
    hrvWarning,
    ...rem,
  }
}
