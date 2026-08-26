// Shared shapes for the admin day-review audit — a per-pillar, per-day explanation of how a score
// was arrived at: the raw signals that fed it, the model constants that shaped it, each
// contributor's sub-score and how much of the final number it actually moved, and what was missing.
//
// The audit never re-implements a formula: it calls the same compute functions the app serves from
// and reads the same exported model constants. Its one job is to make the arithmetic legible.

export type PillarKey = 'sleep' | 'readiness' | 'activity' | 'heartRate'

/** A single raw measurement, with the unit and where it came from — the "what went in" layer. */
export interface AuditSignal {
  value: number | string | boolean | null
  unit?: string
  /** Which table/route the value came from, so a wrong number can be traced to its writer. */
  source?: string
  note?: string
}

export interface AuditContributor {
  key: string
  label: string
  /** The measurement this contributor scored, in real units. */
  input: AuditSignal
  /** The 0–100 sub-score the model derived from `input`. Null when the contributor didn't run. */
  subScore: number | null
  /** The contributor's raw weight in the model, before renormalisation over included contributors. */
  weight: number
  /** `weight` as a share of the weight actually used (sums to 1 across included contributors). */
  effectiveWeight: number | null
  /** `subScore × effectiveWeight` — the points this contributor put into the final score. */
  contribution: number | null
  /** True when the contributor fell back to a neutral value instead of a real measurement. */
  provisional: boolean
  /** Set when the contributor was excluded, explaining why (and therefore who absorbed its weight). */
  excludedReason: string | null
}

export interface PillarAudit {
  pillar: PillarKey
  label: string
  /** The score this audit recomputed for the day, from the inputs listed below. */
  score: number | null
  band: string | null
  /** Which branch of the model produced `score` (e.g. 'own-composite', 'oura-cloud', 'no-data'). */
  source: string
  /** The model's own constants — weights, curve anchors, thresholds — read from the score module. */
  model: unknown
  /** Every raw signal that fed the pillar, keyed by name. */
  inputs: Record<string, AuditSignal>
  contributors: AuditContributor[]
  /** What was missing, and what the model did about it. */
  gaps: string[]
  /** The value persisted for this day, for drift-checking against the live recompute. */
  stored: {
    score: number | null
    contributors: unknown
    source: string | null
    /**
     * Whether the stored score follows from the inputs stored beside it, under the current model —
     * readiness only, and null for a row written before those inputs were persisted (Q-501).
     *
     * This is what separates the two ways a stored score can disagree with a fresh recompute. If the
     * stored score is reproducible from its own stored inputs, the model has not moved and the
     * disagreement is an INPUT change (a summary recomputed after the fact). If it is not
     * reproducible, the MODEL moved. Without the inputs on the row neither question had an answer,
     * and the panel's pairing of a stored score with today's raw inputs was simply a guess.
     */
    rederived?: import('../readiness-composite').ReadinessRederivation | null
  }
  /** False when `stored.score` and `score` disagree — i.e. what was shown ≠ what the model says now. */
  storedMatchesRecompute: boolean | null
  notes: string[]
  /**
   * The recomputed score and contributor breakdown in the exact shape the live route persists to
   * `oura_daily_derived`, or null when this pillar has nothing to persist for the day.
   *
   * Present so the historical backfill (finding F-2) writes the same values the live route would,
   * without re-deriving them from the presentation `contributors` above — which are a different
   * shape and would be a second, drifting definition of "what gets stored".
   */
  persist?: { score: number; contributors: unknown } | null
}

/** Everything else about the day that plausibly explains how it felt, but isn't a scored pillar. */
export interface DayContext {
  checkin: Record<string, unknown> | null
  /** The morning check-in's own ratings, including the sleep rating the score deliberately
   *  ignores (finding Q-16) — present so the model's verdict and the owner's sit side by side. */
  morningCheckin: Record<string, unknown> | null
  workouts: Record<string, unknown>[]
  activities: Record<string, unknown>[]
  nutrition: Record<string, unknown> | null
  bodyMetrics: Record<string, unknown> | null
  sleepSession: Record<string, unknown> | null
  /** Baseline maturity + wear confidence — the two things that most often explain a "wrong" score. */
  dataQuality: Record<string, AuditSignal>
}

export interface DayAudit {
  date: string
  timezone: string
  generatedAt: string
  /** Trailing window (days) of history the baselines below were built from. */
  historyWindowDays: number
  pillars: PillarAudit[]
  context: DayContext
  /** Non-fatal problems hit while assembling (one pillar failing never blanks the rest). */
  warnings: string[]
}
