import { toAestDay } from '@trainingai/shared/date-utils'
import { normalizeMuscle, moodMuscleMatches } from '@trainingai/shared/muscles'
import type { ProgramSession, MuscleAssignment, NextSessionRecommendation } from '@trainingai/shared/types/program'
import type { IllnessFlag } from '@trainingai/shared/health/illness-radar'

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
  /**
   * BF-173. The subset of `soreMuscles` the model itself pre-ticked. Absent or `null` means the
   * log predates provenance, and every tick clamps as it did before — never assume "none".
   */
  suggestedSoreMuscles?: string[] | null
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
  const suggestedSet = new Set((suggestedSoreMuscles ?? []).map(normalizeMuscle))
  // A tick penalises only if the lifter added it. On `null` (unknown provenance) nothing is
  // treated as suggested, so the pre-BF-173 behaviour is preserved rather than guessed at.
  //
  // BF-171: kept as a LIST of labels rather than a set of muscle names. A pill is a broad region
  // ("Back") that covers several catalogue muscles, so membership is not the question —
  // `moodMuscleMatches` is. Both sides of the provenance filter are pill labels from one
  // vocabulary, so they still compare directly, through the normaliser for the same reason
  // everything else here does.
  const lifterAdded = soreMuscles.filter(m => !suggestedSet.has(normalizeMuscle(m)))
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
  temperatureTrusted: boolean,
): { recommended: boolean; strength: 'soft' | 'recommended' | 'strong'; temperatureAlert: boolean } {
  // Fever overrides everything — the strongest "don't train hard" signal we have.
  // temperatureAlert stays tied to the Cloud temp-deviation field (its own UI copy).
  if (illnessFlag === 'fever') {
    return { recommended: true, strength: 'strong', temperatureAlert: false }
  }

  // Only trust an elevated temperature once the baseline is mature enough to define "normal" AND
  // centred enough for the deviation to mean anything (TN-18).
  //
  // The maturity count alone was never sufficient and the owner's screenshot showed why: on
  // 2026-08-31 the stored deviation was 0.519 °C — over the 0.5 threshold, so this banner said
  // "Body temp elevated — rest or deload recommended" — while readiness scored temperature
  // **80/100** on the same night, because its baseline sd is 12x too wide. Two paths, one broken
  // baseline, opposite verdicts, same frame.
  //
  // TN-6a shipped the suspension and said it "must cover all three consumers"; it covered one, and
  // it was the readiness ladder — the path the owner does not read. This is the path behind the
  // report that started it: *"its often triggering deload days. its not trustable yet."*
  //
  // **Do NOT fix this by raising TEMP_ALERT_THRESHOLD_C.** That is the Q-504 mistake and would be
  // the fourth "the threshold is right, the input is wrong" in this pillar. The condition is
  // computed, not a TODO, so it lifts on its own once a re-derivation centres the deviations.
  const tempAlert = temperatureTrusted
    && temperatureDeviation != null && temperatureDeviation > TEMP_ALERT_THRESHOLD_C
    && temperatureBaselineDays >= TEMP_BASELINE_MIN_DAYS
  // TN-34: the derived arm is UNWIRED (owner-approved 2026-09-10, *"yes lets do all that"*).
  // `stressHighMinutes >= STRESS_HIGH_DAY_THRESHOLD_MIN` recommended a deload on **83% of the
  // owner's days** (15 of 18 recomputed; 7 of 10 on stored values since the 2026-08-31 fix). A flag
  // that fires four days in five carries no information, and the input is the number TN-33 measured
  // as carrying none: the daily scalar is 57% NIGHT buckets, night runs systematically positive
  // (+0.266 against the day's −0.405), and its correlation with readiness is +0.072 over 18 days
  // with the two halves pointing opposite ways.
  //
  // **Do NOT restore this by raising STRESS_HIGH_DAY_THRESHOLD_MIN.** That is the mistake the
  // TEMP_ALERT_THRESHOLD_C comment above warns about — it would be the fifth "the threshold is
  // right, the input is wrong" in this pillar. The threshold is a documented ~2 h judgement; the
  // input is a sleep-weighted average wearing a daytime label. Re-wire it when TN-33's level-2 test
  // passes, ideally against this user's own distribution (a percentile, not a constant).
  //
  // The frozen Cloud `day_summary` arm stays, and temperature and illness still override.
  const stressOverride = daySummary === 'very_stressful'

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
    sessions, muscleAssignments, muscleRecovery, history, soreMuscles, suggestedSoreMuscles,
    readinessScore, temperatureDeviation, temperatureBaselineDays, daySummary, timezone,
    reminderEnabled, reminderTime, sleepTrend, energyLevel, selfReportedSick, hrvTrend, illnessFlag, stressHighMinutes,
    temperatureTrusted,
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
    const recoveryScore  = sessionRecoveryScore(s, muscleAssignments, muscleRecovery, soreMuscles, suggestedSoreMuscles)
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
    daySummary, illnessFlag, stressHighMinutes, temperatureTrusted ?? false,
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
