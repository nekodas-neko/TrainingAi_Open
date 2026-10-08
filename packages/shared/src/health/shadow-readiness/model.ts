/**
 * #2377 — the shadow readiness model: units → pillars → readiness, computed beside the live score
 * and shown nowhere (`shadow_readiness`). Design: `docs/architecture/readiness-tree.md`; starting
 * weights: the #2356 tuning proposal, as written.
 *
 * **This file is the model as data.** The unit-id vocabulary, each unit's shape, reference kind,
 * yardstick, weight and minimum meaningful change, the pillar weights, and the JSON shape a unit
 * and a pillar are stored in. The scorer (`score.ts`) reads these and nothing else, so a weight or
 * a band is changed here, once, with a bump of {@link SHADOW_MODEL_VERSION}.
 *
 * **Bump the version whenever anything in here changes a score.** The table keeps one row per
 * (user, date, model version): a new version is stored beside the old rows, never over them, so the
 * days-moved comparison between two weight sets survives.
 *
 * Every number that is a modelling choice rather than a published value is marked `MODEL` in its
 * comment, so the owner's review of the weights can find them. None of them reaches a user: the
 * shadow is shown nowhere.
 */
import { ACWR_THRESHOLDS } from '@trainingai/shared/ai-periodization/acwr'
import { ON_TARGET_KCAL, OUTER_KCAL } from '@trainingai/shared/nutrition/calorie-balance'
import { KCAL_PER_KG } from '@trainingai/shared/nutrition/tdee-adaptation'
import type { ShadowReadinessPillar, ShadowReadinessStage } from '@trainingai/shared/types/body'

/**
 * Version 1 = the #2356 starting weights, as written (Orchestrator, 2026-10-07).
 * Version 2 = version 1 plus `sleep.deep_rem_share` scored (steady around the person's own normal,
 * learned; issue 2635). Its 10 Sleep points were reserved in version 1 and dropped out.
 */
export const SHADOW_MODEL_VERSION = 2

// ── Unit ids ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The stable unit-id vocabulary. A stored row's `units` JSONB is keyed by these, so **an id is
 * never renamed or reused**: a unit whose meaning changes gets a new id, and the old one stays
 * readable in old rows.
 */
export const SHADOW_UNIT_IDS = [
  'sleep.duration',
  'sleep.efficiency',
  'sleep.deep_rem_share',
  'sleep.latency',
  'sleep.timing',
  'sleep.balance',
  'heart.overnight_hrv',
  'heart.overnight_rhr',
  'heart.overnight_settling',
  'heart.daytime_rhr',
  'heart.hr_recovery',
  'activity.yesterday_movement',
  'activity.zone_minutes_week',
  'activity.training_load',
  'activity.block_trend',
  'body.temperature',
  'body.breathing_rate',
  'body.spo2',
  'body.weight_vs_plan',
  'body.fuel',
  'body.daytime_stress',
] as const

export type ShadowUnitId = typeof SHADOW_UNIT_IDS[number]

// ── Unit definitions ─────────────────────────────────────────────────────────────────────────────

/**
 * The three shapes of `readiness-tree.md`, plus `target` for the "reach target" units (protein,
 * hydration, SpO₂'s threshold): a sweet spot whose band has no upper edge.
 *
 * - `sweet_spot`: 100 inside the band, falling on both sides at their own rates.
 * - `steady`: 100 at the person's normal, falling as it drifts either way. No Level unless the
 *   definition gives one.
 * - `directional`: Level (how good the normal is) + Day (today against the normal, in spreads).
 */
export type UnitShape = 'sweet_spot' | 'steady' | 'directional'

/** `readiness-tree.md` → *Where each number comes from*. */
export type ReferenceKind = 'learned' | 'guarded' | 'constant'

/** Piecewise-linear yardstick: `[value, score]` points, ascending by value, clamped at the ends. */
export type Yardstick = readonly (readonly [number, number])[]

/** A sweet-spot band and how fast each side falls: the score is 0 at `lo − belowSpan` and at
 *  `hi + aboveSpan`. `aboveSpan: null` means no upper edge (a "reach target" unit). */
export interface Band {
  lo: number
  hi: number
  belowSpan: number
  aboveSpan: number | null
}

export interface UnitDef {
  id: ShadowUnitId
  pillar: ShadowReadinessPillar
  shape: UnitShape
  reference: ReferenceKind
  /** Weight inside the pillar, #2356 as written. Renormalised over the units that scored. */
  weight: number
  /** For directional units, which way is good. */
  direction?: 'up' | 'down'
  /** Directional/steady units only: the Level yardstick that grades the person's normal. Absent =
   *  the unit has no Level — steady units start from 100, directional ones from {@link LEARNED_BASE}. */
  level?: Yardstick
  /** Sweet-spot units: the research band (constant), or the guardrails a personal band is learned
   *  inside (guarded). */
  band?: Band
  /** Edge case #4 — the smallest change that means anything, which floors the spread. */
  minMeaningfulChange?: number
  /** True when the unit reads DAYTIME data. Its input must come from a completed day (`date − 1` or
   *  earlier) and it counts toward `inputs_through`. Night units read the night keyed to `date`. */
  daytime: boolean
  /** Marked **new** in the readiness tree: starts at half weight until it is settled (#2356). */
  isNew?: boolean
  /**
   * Set when the unit cannot be scored from what the app stores, or the docs leave it undecided.
   * The unit then always drops out and its pillar renormalises, and this says why. Never invented.
   */
  unavailable?: string
}

/** MODEL. Points per robust spread (σ ≈ IQR / 1.349) that Day moves a directional or steady unit.
 *  Fitted to the readiness tree's examples: an average sleeper's great night is about +15, a bad
 *  one about −25, which is +0.75σ and −1.25σ here. */
export const DAY_POINTS_PER_SIGMA = 20
/** MODEL. Day's range for directional units. The downside is deeper than the upside: a great day on
 *  an average normal reaches 100 (70 + 30), and a bad one can take the unit to 0. */
export const DAY_MIN = -70
export const DAY_MAX = 30
/** MODEL. Where a directional unit with no Level yardstick sits at the person's normal — the
 *  learned reference's "median = 70" (readiness-tree, *Where each number comes from*). */
export const LEARNED_BASE = 70
/** IQR → σ for a normal distribution. The spread is robust (quartiles, not a standard deviation),
 *  so one bad week cannot widen the band that judges the next (edge case #7). */
export const IQR_TO_SIGMA = 1.349

// Maturity, readiness-tree → *Maturity*: valid days per unit.
export const MATURITY_PROVISIONAL_DAYS = 14
export const MATURITY_SETTLED_DAYS = 30
/** The normal is the person's last 30 days (readiness-tree: "normal is the 30-day baseline"). */
export const BASELINE_WINDOW_DAYS = 30
/** Days looked back to count a unit's maturity. Longer than the window, so a unit with 30 valid
 *  days spread over a patchy two months still settles. */
export const MATURITY_LOOKBACK_DAYS = 90
/** MODEL. Fewer valid days than this inside the 30-day window and there is no usable normal, so
 *  Day is withheld even for a mature unit (a long gap, not a short history). */
export const MIN_WINDOW_SAMPLES = 7

/** Edge case #8 — a step change that holds this many days is a new routine, not seven anomalies. */
export const REGIME_HOLD_DAYS = 7
/** MODEL. How far (in spreads of the old normal) the held days' median must sit from it. */
export const REGIME_SHIFT_SIGMA = 1.5

/** Edge case #9 — fewest same-phase days before the cycle-aware normal replaces the plain one. */
export const CYCLE_PHASE_MIN_SAMPLES = 7
/** The per-phase normal looks further back, since only about a quarter of days share a phase. */
export const CYCLE_PHASE_LOOKBACK_DAYS = 90

/**
 * Edge case #10 — a declared context adjusts a yardstick. MODEL values, written down so the
 * mechanism is reviewable; nothing in the app stores a declared context yet, so in practice they
 * never apply (see the PR).
 */
export const CONTEXT_ADJUSTMENTS = {
  /** Beta-blockers lower resting HR; the RHR yardstick moves down by this many bpm. */
  betaBlockerRhrShiftBpm: 10,
  /** SpO₂ falls with altitude; per 1000 m above 1500 m the threshold drops by this many points. */
  altitudeSpo2PerKm: 2,
  altitudeSpo2FromM: 1500,
} as const

/** Weight-vs-plan's dead band, from the calorie budget's own on-target band: ±150 kcal/day held for
 *  a week is ±0.136 kg/week (`calorie-balance.ts`). */
const WEIGHT_ON_TARGET_KG_PER_WEEK = (ON_TARGET_KCAL * 7) / KCAL_PER_KG
/** …and its outer band, ±400 kcal/day, scores 50. */
const WEIGHT_OUTER_KG_PER_WEEK = (OUTER_KCAL * 7) / KCAL_PER_KG

/**
 * The tree, unit by unit. Weights are #2356's "Unit weights inside each pillar", as written.
 */
export const UNIT_DEFS: Record<ShadowUnitId, UnitDef> = {
  // ── Sleep: duration 30 · efficiency 20 · sleep balance 15 · timing/consistency 15 · deep+REM 10 · latency 10
  'sleep.duration': {
    id: 'sleep.duration', pillar: 'sleep', shape: 'sweet_spot', reference: 'guarded', weight: 30, daytime: false,
    // 7–9 h (AASM/SRS consensus, component-references [1]). MODEL spans: 5½ h every night scores 40
    // (the tree's example), 4½ h scores 0; above 9 h falls more slowly, 12 h is 0.
    band: { lo: 7, hi: 9, belowSpan: 2.5, aboveSpan: 3 },
    minMeaningfulChange: 0.5,
  },
  'sleep.efficiency': {
    id: 'sleep.efficiency', pillar: 'sleep', shape: 'directional', reference: 'learned', weight: 20, daytime: false,
    direction: 'up',
    // NSF: ≥ 85 % is good (component-references [2]) → 85 % ≈ 70, 95 % ≈ 100.
    level: [[75, 40], [85, 70], [95, 100]],
    minMeaningfulChange: 2,
  },
  'sleep.deep_rem_share': {
    id: 'sleep.deep_rem_share', pillar: 'sleep', shape: 'steady', reference: 'learned', weight: 10, daytime: false,
    // Deep + REM minutes over total sleep, in percent, against the person's own rolling 30-day normal.
    // No fixed band and no Level: component-references.md finds no consensus on stage amounts and
    // recommends the personal baseline only (decision on issue 2635, Orchestrator, 2026-10-07).
    // MODEL: 2 percentage points is the smallest change that means anything (ring stage scoring
    // wobbles by about that much night to night). A night with no staging has no value.
    minMeaningfulChange: 2,
  },
  'sleep.latency': {
    id: 'sleep.latency', pillar: 'sleep', shape: 'sweet_spot', reference: 'constant', weight: 10, daytime: false,
    // Minutes. NSF: ≤ 30 min is good, ≤ 15 min clearest (component-references [2], [2b]); falling
    // asleep instantly is a sign of debt (tree). MODEL band 10–20 min, the top of today's Sleep Score
    // latency curve; 0 min scores 50 (as that curve does), 30 min ≈ 70, 53 min is 0.
    band: { lo: 10, hi: 20, belowSpan: 20, aboveSpan: 33 },
    minMeaningfulChange: 5,
  },
  'sleep.timing': {
    id: 'sleep.timing', pillar: 'sleep', shape: 'steady', reference: 'learned', weight: 15, daytime: false,
    // Mid-sleep, minutes from local noon, against the person's usual. No Level (MODEL): regularity
    // has outcome evidence (component-references [3]) but no yardstick for a single night.
    minMeaningfulChange: 20,
  },
  'sleep.balance': {
    id: 'sleep.balance', pillar: 'sleep', shape: 'sweet_spot', reference: 'guarded', weight: 15, daytime: false,
    // The mean of the last 7 nights against the same guarded 7–9 h band as duration: a week below
    // it is debt; a week far above it falls too.
    band: { lo: 7, hi: 9, belowSpan: 2.5, aboveSpan: 3 },
    minMeaningfulChange: 0.25,
  },

  // ── Heart: overnight HRV 35 · overnight resting HR 30 · overnight settling 15 · daytime resting HR 10 · HR recovery 10
  'heart.overnight_hrv': {
    id: 'heart.overnight_hrv', pillar: 'heart', shape: 'directional', reference: 'learned', weight: 35, daytime: false,
    direction: 'up',
    // Edge case #3: highly genetic, so Level spans only 60–90. Population short-term rMSSD spans
    // roughly 19–75 ms (Nunan 2010, component-references [4]).
    level: [[20, 60], [75, 90]],
    minMeaningfulChange: 3,
  },
  'heart.overnight_rhr': {
    id: 'heart.overnight_rhr', pillar: 'heart', shape: 'directional', reference: 'learned', weight: 30, daytime: false,
    direction: 'down',
    // Edge case #3: Level 60–90. MODEL anchors 50 bpm → 90, 80 bpm → 60.
    level: [[50, 90], [80, 60]],
    minMeaningfulChange: 2,
  },
  'heart.overnight_settling': {
    id: 'heart.overnight_settling', pillar: 'heart', shape: 'directional', reference: 'learned', weight: 15, daytime: false,
    direction: 'up',
    // Recovery index, hours from the overnight HR minimum to wake. No published norm
    // (component-references), so no Level: learned only.
    minMeaningfulChange: 0.25,
  },
  'heart.daytime_rhr': {
    id: 'heart.daytime_rhr', pillar: 'heart', shape: 'directional', reference: 'learned', weight: 10, daytime: true,
    direction: 'down', isNew: true, minMeaningfulChange: 2,
    unavailable:
      'No per-day "resting HR in still daytime periods" is stored. It needs a rollup step that '
      + 'takes the median HR of still minutes (MET below the active threshold, `medianGated` over '
      + '`metActiveWindows`) for each completed day and writes it beside the other daily metrics.',
  },
  'heart.hr_recovery': {
    id: 'heart.hr_recovery', pillar: 'heart', shape: 'directional', reference: 'learned', weight: 10, daytime: true,
    direction: 'up', isNew: true,
    // HRR60 between sets, median of the most recent training day in the last week. No yardstick
    // for between-set recovery, so no Level.
    minMeaningfulChange: 3,
  },

  // ── Activity: yesterday's movement 35 · training load 7:28 30 · zone minutes (week) 20 · block trend 28:90 15
  'activity.yesterday_movement': {
    id: 'activity.yesterday_movement', pillar: 'activity', shape: 'sweet_spot', reference: 'guarded', weight: 35, daytime: true,
    // Steps. The lower edge is the research plateau (Paluch 2022, component-references [6]): 8,000
    // under 60, 6,000 from 60 (see `stepsFloorForAge`). There is no published upper edge, so the
    // upper edge is learned: the person's own 90th percentile, never below 1.5× the floor. MODEL
    // spans: 0 steps is 0; two floors' worth above the upper edge is 0.
    band: { lo: 8000, hi: Number.POSITIVE_INFINITY, belowSpan: 8000, aboveSpan: 16000 },
  },
  'activity.zone_minutes_week': {
    id: 'activity.zone_minutes_week', pillar: 'activity', shape: 'sweet_spot', reference: 'constant', weight: 20, daytime: true,
    // WHO 150–300 moderate-equivalent minutes a week, vigorous counted double (component-references
    // [7]; `activeMinutesFromZoneSeconds`). MODEL spans: 0 is 0; 900 is 0.
    band: { lo: 150, hi: 300, belowSpan: 150, aboveSpan: 600 },
  },
  'activity.training_load': {
    id: 'activity.training_load', pillar: 'activity', shape: 'sweet_spot', reference: 'constant', weight: 30, daytime: true,
    // ACWR 7:28 inside 0.8–1.3 = 100 (#2194, `ACWR_THRESHOLDS`). MODEL spans: 0 is 0, 1.8 is 0.
    band: { lo: ACWR_THRESHOLDS.lowMax, hi: ACWR_THRESHOLDS.optimalMax, belowSpan: ACWR_THRESHOLDS.lowMax, aboveSpan: 0.5 },
  },
  'activity.block_trend': {
    id: 'activity.block_trend', pillar: 'activity', shape: 'sweet_spot', reference: 'constant', weight: 15, daytime: true,
    unavailable:
      'The 28:90 ratio and its band are #2340, still open: the tuning proposal that sets the band '
      + 'has not been written, and no shared function computes a 28:90 ratio. Needs #2340.',
  },

  // ── Body: temperature 25 · breathing rate 20 · fuel 20 · SpO₂ 15 · daytime stress 10 · weight vs plan 10
  'body.temperature': {
    id: 'body.temperature', pillar: 'body', shape: 'steady', reference: 'learned', weight: 25, daytime: false,
    minMeaningfulChange: 0.15,
  },
  'body.breathing_rate': {
    id: 'body.breathing_rate', pillar: 'body', shape: 'steady', reference: 'learned', weight: 20, daytime: false,
    // MODEL: half a breath a minute.
    minMeaningfulChange: 0.5,
  },
  'body.fuel': {
    id: 'body.fuel', pillar: 'body', shape: 'sweet_spot', reference: 'constant', weight: 20, daytime: true,
    // Scored by `scoreFuel` from its three parts (energy balance, protein, hydration); see FUEL_BANDS.
  },
  'body.spo2': {
    id: 'body.spo2', pillar: 'body', shape: 'sweet_spot', reference: 'constant', weight: 15, daytime: true,
    // Fine at ≥ 95 % (tree), falls below. MODEL: 85 % is 0. Daytime because the ring's SpO₂ is
    // stored per calendar day, so today's row is still filling.
    band: { lo: 95, hi: 100, belowSpan: 10, aboveSpan: null },
  },
  'body.weight_vs_plan': {
    id: 'body.weight_vs_plan', pillar: 'body', shape: 'steady', reference: 'constant', weight: 10, daytime: true,
    // kg/week against the goal's planned pace. In band within the calorie budget's on-target band
    // expressed as weight; its outer band scores 50.
    band: {
      lo: -WEIGHT_ON_TARGET_KG_PER_WEEK, hi: WEIGHT_ON_TARGET_KG_PER_WEEK,
      belowSpan: 2 * (WEIGHT_OUTER_KG_PER_WEEK - WEIGHT_ON_TARGET_KG_PER_WEEK),
      aboveSpan: 2 * (WEIGHT_OUTER_KG_PER_WEEK - WEIGHT_ON_TARGET_KG_PER_WEEK),
    },
  },
  'body.daytime_stress': {
    id: 'body.daytime_stress', pillar: 'body', shape: 'directional', reference: 'learned', weight: 10, daytime: true,
    direction: 'down',
    // Minutes of high stress. MODEL: ten minutes.
    minMeaningfulChange: 10,
  },
}

/**
 * Fuel's three parts (tree: "energy balance | sweet spot | guarded" and "protein, hydration | reach
 * target | constant"). #2356 weights them as one unit, so they are one here, scored as the mean of
 * the parts that were logged. A part not logged is missing, never zero (edge case #12).
 */
export const FUEL_BANDS = {
  /** kcal from the day's budget. "Guarded": the budget is the person's calibrated maintenance
   *  (`computeEnergyBalance`), so the reference is learned and the band is the calorie budget's own:
   *  on target within ±150 kcal, ±400 kcal scores 50. */
  energy: { lo: -ON_TARGET_KCAL, hi: ON_TARGET_KCAL, belowSpan: 2 * (OUTER_KCAL - ON_TARGET_KCAL), aboveSpan: 2 * (OUTER_KCAL - ON_TARGET_KCAL) },
  /** Share of the day's protein target eaten, 0–1+. Reach target: at or above it is 100. */
  protein: { lo: 1, hi: Number.POSITIVE_INFINITY, belowSpan: 1, aboveSpan: null },
  /** Share of the water goal drunk. */
  hydration: { lo: 1, hi: Number.POSITIVE_INFINITY, belowSpan: 1, aboveSpan: null },
} as const satisfies Record<string, Band>

/** Research step plateau by age (Paluch 2022): 6,000 from 60, 8,000 under. Unknown age → 8,000. */
export function stepsFloorForAge(ageYears: number | null): number {
  return ageYears != null && ageYears >= 60 ? 6000 : 8000
}

// ── Pillar weights ───────────────────────────────────────────────────────────────────────────────

/** #2356 pillar weights, as written: Sleep 30 · Heart 30 · Activity 20 · Body 20. */
export const PILLAR_WEIGHTS: Record<ShadowReadinessPillar, number> = {
  sleep: 30,
  heart: 30,
  activity: 20,
  body: 20,
}

export const SHADOW_PILLARS: readonly ShadowReadinessPillar[] = ['sleep', 'heart', 'activity', 'body']

/** #2356: "A new unit starts at half weight until it has 30 valid days." */
export const NEW_UNIT_WEIGHT_FACTOR = 0.5

// ── The stored JSON shapes ───────────────────────────────────────────────────────────────────────

/** Why a unit did not score. `null` on the unit means it scored. */
export type UnitGap =
  /** The unit cannot be built from what the app stores, or the docs leave it undecided. */
  | 'unavailable'
  /** No input on any rung for the day — dropped, never 0 (edge case #12). */
  | 'missing'
  /** Too little history for a unit that has no Level to grade the day with (edge case #14). */
  | 'learning'
  /** The input read the current, unsettled day and was refused (owner, 2026-08-26). */
  | 'unsettled'

/** Where a unit's value came from — the input cascade's provenance (`inputs/cascade.ts`). */
export interface UnitProvenance {
  source: string
  /** `provided` / `derived` / `estimated`, when the input layer knows it. */
  rung: 'provided' | 'derived' | 'estimated' | null
}

/**
 * One unit's stored result, under its id in `shadow_readiness.units`. **A field is null, never 0,
 * when it was not computed.**
 */
export interface ShadowUnitResult {
  /** 0–100, or null when the unit dropped out. */
  score: number | null
  /** How good the person's normal is, 0–100, or null (no Level for this unit, or not computable). */
  level: number | null
  /** Today against the normal, in points, or null while learning. score = clamp(level + day). */
  day: number | null
  /** Weight inside the pillar after the new-unit halving, before renormalisation. 0 when dropped. */
  weight: number
  /** This unit's own maturity: 0–13 valid days learning, 14–29 provisional, 30+ settled. */
  stage: ShadowReadinessStage
  /** Valid days of history behind the normal (same source; edge case #11). */
  validDays: number
  /** The day's raw value the unit scored, in the unit's own unit, or null. */
  value: number | null
  /** The person's normal it was judged against, or null. */
  normal: number | null
  provenance: UnitProvenance | null
  /** Last calendar day of daytime data the unit read; null for night units. Always before the date. */
  daytimeThrough: string | null
  gap: UnitGap | null
  /** Plain-language reason for a gap, or a note on how the unit was scored. */
  note: string | null
  /** Edge cases #8, #9, #11: what changed how the normal was built, when anything did. */
  flags: string[]
}

/** One pillar's stored detail, under its name in `shadow_readiness.pillar_detail`. */
export interface ShadowPillarDetail {
  /** The pillar's weight in readiness after renormalisation over the pillars that scored. 0 when
   *  the pillar did not score. */
  effectiveWeight: number
  /** Units that scored, each with its share of the pillar after renormalisation. */
  scored: Record<string, number>
  /** Units that dropped out, with why. The pillar renormalised over the rest and says so. */
  dropped: Record<string, UnitGap>
}
