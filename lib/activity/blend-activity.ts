// Blend app-logged gym training load into the Oura Activity score.
//
// Oura's daily Activity score derives its `training_volume` / `training_frequency`
// contributors from movement and heart rate, so resistance training is badly under-counted
// (a heavy leg day barely raises HR → low training_volume → deflated Activity score). This
// nudges the displayed score up when a gym session was logged that Oura under-credited —
// the same idea as ACWR adjusting Readiness in `app/api/readiness-score/route.ts`.
//
// Constants are heuristic and intentionally bounded; tune against real data over time.
const TRAIN_CREDIT_BASE = 6   // points just for having trained today
const TRAIN_CREDIT_VOL  = 8   // additional points scaled by volume vs. a typical session
const MAX_ADJ           = 14  // hard cap on the bump

export interface ActivityBlendInput {
  /** Oura daily_activity.score (0–100), or null when no Oura activity data for the day. */
  ouraActivityScore: number | null
  /** Oura contributors.training_volume (0–100), or null. Used to avoid double-counting. */
  trainingVolumeContrib: number | null
  /** Sum of logged set tonnage (kg) for the day — 0 if no gym session was logged. */
  todayWorkoutVolumeKg: number
  /** The user's typical (median) logged session volume in kg — the scaling baseline. */
  typicalSessionVolumeKg: number
}

export interface ActivityBlendResult {
  base: number | null   // Oura score, unchanged
  adjustment: number    // points added (0 when no gym session today or no Oura base)
  final: number | null  // clamp(base + adjustment, 0, 100)
  trained: boolean      // a gym session was logged today
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export function blendActivityScore(input: ActivityBlendInput): ActivityBlendResult {
  const { ouraActivityScore, trainingVolumeContrib, todayWorkoutVolumeKg, typicalSessionVolumeKg } = input
  const base = ouraActivityScore
  const trained = todayWorkoutVolumeKg > 0

  // No logged session, or no Oura score to anchor onto → leave the score untouched.
  if (!trained || base == null) {
    return { base, adjustment: 0, final: base, trained }
  }

  // A session at/above the user's typical volume earns the full volume credit.
  const volRatio = clamp01(todayWorkoutVolumeKg / Math.max(typicalSessionVolumeKg, 1))
  const raw = TRAIN_CREDIT_BASE + TRAIN_CREDIT_VOL * volRatio

  // Only credit what Oura missed — if its training_volume contributor is already high, add
  // little (it captured the session); if it's low, add the most.
  const missed = 1 - clamp01((trainingVolumeContrib ?? 0) / 100)
  const adjustment = Math.round(Math.max(0, Math.min(MAX_ADJ, raw * missed)))
  const final = Math.max(0, Math.min(100, base + adjustment))

  return { base, adjustment, final, trained: true }
}
