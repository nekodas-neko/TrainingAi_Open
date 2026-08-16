import type { HrZone } from '@trainingai/shared/health/hr-zones'

export type RunType = 'easy' | 'long' | 'interval' | 'tempo' | 'recovery'

export interface FitnessSnapshot {
  maxHr: number
  restingHr: number
  vo2max: number | null
  thresholdHr: number | null            // lactate/ventilatory threshold HR from baseline; null → derived
  weeklyBaseMinutes: number             // starting weekly easy-run minutes (from baseline or a floor)
  source: 'baseline' | 'age-estimate'
}

export interface RunTargets {
  zoneIds: HrZone['id'][]               // target zone(s), e.g. [1,2] for easy, [4,5] for interval
  hrLowBpm: number
  hrHighBpm: number
}

export interface Prescription {
  type: RunType
  durationMin: number | null
  distanceKm: number | null
  targets: RunTargets
  rationale: string                     // deterministic, template-generated — NEVER an AI string
  frameworkKey: string
}

// Cardio goals (Phase 2). The first four are user-selectable; `cardio_health` and
// `distance_event` are legacy aliases kept so pre-Phase-2 plans still resolve (see
// cardio-goals.ts). goal_kind is a free-text DB column, so this list is additive.
export type GoalKind =
  | 'speed'          // faster 5K/3K + VO₂max
  | 'endurance'      // go further
  | 'heart_health'   // general cardiovascular health
  | 'recovery'       // improve heart-rate recovery / resting HR
  | 'intervals'      // Norwegian 4×4 — structured VO₂max interval protocol
  | 'cardio_health'  // legacy alias → heart_health-style
  | 'distance_event' // legacy alias → endurance-style
export interface RunningGoal {
  kind: GoalKind
  targetDistanceKm: number | null
  targetDate: string | null             // YYYY-MM-DD (user-tz), normalized on write
  /** Fixed minutes per session, when the user chose a fixed-time plan (density-progression).
   *  Null for the four existing frameworks, which grow session length over time instead. */
  timePerSessionMinutes: number | null
}

export interface FrameworkContext {
  fitness: FitnessSnapshot
  weekIndex: number                     // 0-based week since plan start
  runsThisWeek: { type: RunType; durationMin: number | null }[]
  goal: RunningGoal
}

export interface RunFramework {
  key: string
  label: string
  /** The ideal next run BEFORE the recovery gate softens it. */
  nextRun(ctx: FrameworkContext): Prescription
}
