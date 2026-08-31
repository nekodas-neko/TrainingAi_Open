// Our own 0–100 Activity score (W-B rewrite, 2026-07-22). Goal-anchored, not self-referential: the
// previous model scored steps/calories as a ratio to the user's OWN trailing average, so "100" just
// meant "as active as you usually are" — a lazy week lowered the bar. This version scores against
// absolute, personalised daily goals (`lib/health/daily-goals.ts`), so 100 means an objectively good
// day. Two lanes reconcile a DAILY score with the fact that training is intermittent:
//
//   • Daily-movement lane  — steps / active-energy / zone-minutes vs the day's goals. Resets daily;
//     can be maxed by normal movement every day.
//   • Strength lane        — a rolling 7-day window (session frequency + volume). A rest day still
//     scores here off the last week's training, so "did I lift today" never crashes the score to 0.
//
// Over-exertion taper: past the ACWR optimal band the final score eases DOWN — 100 means *optimal*,
// not *maximum effort*. Readiness reads the PRE-taper score (goal completion) so acute-load fatigue
// lives only in readiness's own ACWR term, never double-counted. See the W-B plan.

import { ACWR_THRESHOLDS } from '@trainingai/shared/ai-periodization/acwr'
import type { DailyGoals } from '@trainingai/shared/health/daily-goals'

// Lane weights (renormalised over whichever components have data). Daily-movement ≈ 55, strength ≈ 45.
const W_STEPS         = 18
const W_ACTIVE_ENERGY = 15
const W_ZONE_MINUTES  = 10
const W_MOVE_HOURS    = 12
const W_STRENGTH_FREQ = 25
const W_STRENGTH_VOL  = 20

// Over-exertion: taper starts once ACWR exceeds this and reaches the max penalty by +0.5 above it.
// Same boundary the emergency-deload trigger fires at — from the canonical set, not retyped (Q-306).
const ACWR_TAPER_START = ACWR_THRESHOLDS.highMax
const ACWR_TAPER_SPAN  = 0.5
const MAX_TAPER        = 0.15

const clamp01  = (n: number) => Math.max(0, Math.min(1, n))
const clamp100 = (n: number) => Math.max(0, Math.min(100, n))

/**
 * The 7-day volume target the strength-volume lane scores against.
 *
 * **One formula, one place (Q-190, 2026-08-11).** This lived in three copies — here, the score-audit
 * view, and a progress-bar `max` in `app/health/activity/activity-content.tsx`. Changing one and not
 * the others would have shown a different target from the one being scored, with nothing failing.
 *
 * It is built from `goals.sessionVolumeGoalKg`, an **absolute** per-session tonnage. It used to be
 * built from `typicalSessionVolumeKg` — the median of the user's *own* sessions — which made the
 * target chase the behaviour: train harder, the median rises, the target rises, the score stays put.
 * That is the treadmill the 2026-07-22 rewrite removed from the daily-movement lane and left here.
 */
export function volumeTargetKg(goals: Pick<DailyGoals, 'sessionVolumeGoalKg' | 'strengthFreqGoal'>): number {
  return Math.max(goals.sessionVolumeGoalKg, 1) * Math.max(goals.strengthFreqGoal, 1)
}

/** Piecewise-linear interpolation over ascending (x, y) anchors, clamped at both ends. */
function interp(x: number, pts: readonly (readonly [number, number])[]): number {
  if (x <= pts[0][0]) return pts[0][1]
  const last = pts[pts.length - 1]
  if (x >= last[0]) return last[1]
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
  }
  return last[1]
}

// Rolling-7-day session frequency as a ratio to the user's goal → sub-score. Hitting the goal scores
// 100; training beyond it saturates (never penalised here — over-reach is handled by the ACWR taper);
// below the goal is graded so 2 of a 3-goal still scores well but under a full 3. Ratio-based so it
// scales with each user's `strengthFreqGoal` rather than a fixed session count.
const STRENGTH_FREQ_CURVE = [[0, 0], [0.34, 50], [0.67, 80], [1.0, 100], [1.5, 100]] as const

/**
 * The Activity Score model in serialisable form — lane weights, the over-exertion taper constants
 * and the strength-frequency curve. Exported so tooling (the admin day-review audit) can present a
 * score alongside the exact model that produced it without copying any of it.
 */
export const ACTIVITY_MODEL = {
  weights: {
    steps: W_STEPS,
    activeEnergy: W_ACTIVE_ENERGY,
    zoneMinutes: W_ZONE_MINUTES,
    moveHours: W_MOVE_HOURS,
    strengthFreq: W_STRENGTH_FREQ,
    strengthVolume: W_STRENGTH_VOL,
  },
  taper: { acwrStart: ACWR_TAPER_START, acwrSpan: ACWR_TAPER_SPAN, maxTaper: MAX_TAPER },
  curves: { strengthFreqRatio: STRENGTH_FREQ_CURVE },
} as const

export interface ActivityScoreInput {
  /** Today's step count. */
  steps: number | null
  /** Today's active calories (kcal). */
  activeCalories: number | null
  /** Today's minutes in zone 2+ (moderate/vigorous). Vigorous minutes should be doubled by the
   *  caller before passing. Omit/null when no HR series is available (renormalises out). */
  zoneMinutes?: number | null
  /** Daytime hours with detected movement, and the goal for that (waking hours less an allowance).
   *  Omit both when not computed (the "move every hour" lane renormalises out). */
  moveHours?: number | null
  moveHoursGoal?: number | null
  /** Whether a strength session was logged TODAY — distinct from `sessions7d`, which is a rolling
   *  window. Only used to recognise a structural zero in the zone-minutes lane (see below). */
  strengthSessionToday?: boolean
  /** Rolling 7-day window (inclusive of today): number of logged strength sessions and total tonnage. */
  sessions7d: number
  volume7dKg: number
  /** Median single-session tonnage. **No longer sets the volume target** (Q-190), and no longer
   *  scored against either — `blend-activity` was deleted with Q-284. Kept because the audit view
   *  displays it. */
  typicalSessionVolumeKg: number
  /** The user's daily goals (single source — `getDailyGoals`). */
  goals: DailyGoals
  /** Acute:chronic workload ratio for the over-exertion taper. Null skips the taper. */
  acwr?: number | null
}

export interface ActivityScoreResult {
  /** Final displayed score — includes the over-exertion taper. */
  score: number
  /** Goal-completion score BEFORE the over-exertion taper — what readiness should read. */
  preTaperScore: number
  /** Each available contributor's 0–100 sub-score (missing contributors are absent). */
  components: Record<string, number>
  /** True when the over-exertion taper pulled the final below the pre-taper score. */
  taperApplied: boolean
}

/**
 * Compute the goal-anchored 0–100 Activity score. Returns null only when nothing at all is available
 * to score (no movement data and no training in the last week).
 */
export function computeActivityScore(input: ActivityScoreInput): ActivityScoreResult | null {
  const { steps, activeCalories, zoneMinutes, moveHours, moveHoursGoal, strengthSessionToday, sessions7d, volume7dKg, goals, acwr } = input

  const parts: { key: string; weight: number; sub: number }[] = []
  const add = (key: string, weight: number, sub: number) => parts.push({ key, weight, sub: clamp100(sub) })

  // ── Daily-movement lane — absolute goal completion ──
  if (steps != null && goals.stepGoal > 0) add('steps', W_STEPS, clamp01(steps / goals.stepGoal) * 100)
  if (activeCalories != null && goals.activeEnergyGoal > 0) add('activeEnergy', W_ACTIVE_ENERGY, clamp01(activeCalories / goals.activeEnergyGoal) * 100)
  // A lifting day that logs no zone-2+ minutes is not a missed cardio target — zone 1 starts around
  // 60% HRR and strength work with rest between sets rarely holds it. Scoring that zero at full
  // weight punished the user for the shape of their training rather than for what they did, so it
  // takes the path absent data already takes: excluded, weights renormalised. Measured over the
  // owner's last 45 days — 40 were exactly zero, and 32 of those were lifting days (2026-08-11).
  // Deliberately NOT extended to rest days: a zero there does mean no moderate activity happened.
  if (zoneMinutes != null && goals.zoneMinutesGoal > 0 && !(zoneMinutes === 0 && strengthSessionToday)) {
    add('zoneMinutes', W_ZONE_MINUTES, clamp01(zoneMinutes / goals.zoneMinutesGoal) * 100)
  }
  if (moveHours != null && moveHoursGoal != null && moveHoursGoal > 0) add('moveHours', W_MOVE_HOURS, clamp01(moveHours / moveHoursGoal) * 100)

  // ── Strength lane — rolling 7-day, so a rest day still scores off recent training ──
  if (sessions7d > 0 || volume7dKg > 0) {
    add('strengthFreq', W_STRENGTH_FREQ, interp(sessions7d / Math.max(goals.strengthFreqGoal, 1), STRENGTH_FREQ_CURVE))
    add('strengthVolume', W_STRENGTH_VOL, clamp01(volume7dKg / volumeTargetKg(goals)) * 100)
  }

  if (parts.length === 0) return null

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0)
  const preTaper = clamp100(Math.round(parts.reduce((s, p) => s + p.weight * p.sub, 0) / totalWeight))

  // Over-exertion taper — 100 = optimal, not maximum. Only bites past the ACWR optimal band.
  let taper = 0
  if (acwr != null && acwr > ACWR_TAPER_START) {
    taper = clamp01((acwr - ACWR_TAPER_START) / ACWR_TAPER_SPAN) * MAX_TAPER
  }
  const score = clamp100(Math.round(preTaper * (1 - taper)))

  const components: Record<string, number> = {}
  for (const p of parts) components[p.key] = Math.round(p.sub)

  return { score, preTaperScore: preTaper, components, taperApplied: taper > 0 && score < preTaper }
}
