/**
 * #2377 — the shadow readiness scorer. **Pure**: it takes already-fetched unit inputs and returns
 * unit scores, pillar scores, readiness, the maturity stage and `inputs_through`. No I/O, no clock;
 * the same input always gives the same row. Gathering inputs is `assemble.ts` (pure) and
 * `lib/health/shadow-readiness-service.ts` (the reads and the one write).
 *
 * The rules, all from `docs/architecture/readiness-tree.md`:
 *
 * - **Level + Day.** A unit is `clamp(Level + Day, 0, 100)`: Level grades the person's normal
 *   against an absolute yardstick, Day is today against that normal in robust spreads. Sweet-spot
 *   units grade both on the range shape, so their score is the range score of the day.
 * - **Learned, guarded, constant.** A learned normal is the median of the last 30 valid days; a
 *   guarded sweet spot is the person's own band clamped inside the research range; a constant band
 *   never moves.
 * - **Maturity.** 0–13 valid days learning (Level from the population yardstick applied to the day,
 *   Day withheld; a unit with no yardstick does not score), 14–29 provisional, 30+ settled.
 * - **Minimum meaningful change** floors the spread (edge case #4).
 * - **Missing is missing.** A unit with no input drops out and its pillar renormalises over the units
 *   that scored, and the pillar detail says which dropped and why. A pillar with no unit is null and
 *   readiness renormalises over the pillars that scored. Nothing is ever a stand-in 0 or 50.
 * - **Settled days only.** A daytime unit whose input is not from a completed day is refused.
 */
import { median, quantile } from '@trainingai/shared/stats'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import type { ShadowReadinessPillar, ShadowReadinessStage } from '@trainingai/shared/types/body'
import {
  BASELINE_WINDOW_DAYS,
  CONTEXT_ADJUSTMENTS,
  CYCLE_PHASE_LOOKBACK_DAYS,
  CYCLE_PHASE_MIN_SAMPLES,
  DAY_MAX,
  DAY_MIN,
  DAY_POINTS_PER_SIGMA,
  FUEL_BANDS,
  IQR_TO_SIGMA,
  LEARNED_BASE,
  MATURITY_LOOKBACK_DAYS,
  MATURITY_PROVISIONAL_DAYS,
  MATURITY_SETTLED_DAYS,
  MIN_WINDOW_SAMPLES,
  NEW_UNIT_WEIGHT_FACTOR,
  PILLAR_WEIGHTS,
  REGIME_HOLD_DAYS,
  REGIME_SHIFT_SIGMA,
  SHADOW_MODEL_VERSION,
  SHADOW_PILLARS,
  SHADOW_UNIT_IDS,
  UNIT_DEFS,
  type Band,
  type ShadowPillarDetail,
  type ShadowUnitId,
  type ShadowUnitResult,
  type UnitDef,
  type UnitGap,
  type UnitProvenance,
  type Yardstick,
} from './model'

// ── Inputs ───────────────────────────────────────────────────────────────────────────────────────

/** One day's value for a unit. `date` is the day the value belongs to: the readiness date for a
 *  night unit, a completed earlier day for a daytime unit. */
export interface UnitObservation {
  date: string
  value: number
  /** Device or store that supplied it. Baselines are kept per source (edge case #11). */
  source?: string | null
  rung?: UnitProvenance['rung']
  /** Menstrual-cycle phase on that day, when tracked (edge case #9). */
  phase?: string | null
}

export interface UnitInput {
  /** The value to score, or null when nothing filled it on any rung. */
  today: UnitObservation | null
  /** Earlier days. Anything on or after `today.date` is ignored, so the scored day never sits in
   *  its own normal. Excluded dates are dropped by the scorer, not the caller. */
  history: readonly UnitObservation[]
  /** Per-person band edges that the model leaves to the caller (the steps floor by age). */
  band?: Partial<Band>
  /** A note to carry into the stored unit (e.g. how the value was assembled). */
  note?: string
}

export interface ShadowContext {
  /** Declared beta-blocker use (edge case #10). */
  betaBlocker?: boolean
  /** Declared altitude in metres (edge case #10). */
  altitudeM?: number | null
}

export interface ShadowScoreInput {
  /** The readiness day, `YYYY-MM-DD`. */
  date: string
  units: Partial<Record<ShadowUnitId, UnitInput>>
  /** Days excluded from every window (edge case #7): low-wear days and days flagged unwell. The
   *  scored day itself is never excluded by this — it is judged, not used as a reference. */
  excludedDates?: ReadonlyMap<string, 'low_wear' | 'unwell'>
  context?: ShadowContext
}

export interface ShadowScoreResult {
  date: string
  modelVersion: number
  shadowReadiness: number | null
  pillars: Record<ShadowReadinessPillar, number | null>
  pillarDetail: Record<ShadowReadinessPillar, ShadowPillarDetail>
  units: Record<ShadowUnitId, ShadowUnitResult>
  maturityStage: ShadowReadinessStage
  inputsThrough: string | null
}

// ── Small pure helpers ───────────────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round1 = (v: number) => Math.round(v * 10) / 10

/** Piecewise-linear interpolation over a yardstick, clamped at its ends. Works for descending
 *  value axes too (resting HR: lower is better) because points are taken in the order given. */
export function gradeOnYardstick(value: number, points: Yardstick): number {
  const pts = [...points].sort((a, b) => a[0] - b[0])
  if (value <= pts[0][0]) return pts[0][1]
  const last = pts[pts.length - 1]
  if (value >= last[0]) return last[1]
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x0, y0] = pts[i - 1]
    if (value <= x1) return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0)
  }
  return last[1]
}

/** The sweet-spot shape: 100 inside `[lo, hi]`, falling linearly to 0 across `belowSpan` below and
 *  `aboveSpan` above. The two sides fall at their own rates (tree, *Three scoring shapes*). */
export function rangeScore(value: number, band: Band): number {
  if (value < band.lo) return clamp(100 - ((band.lo - value) / band.belowSpan) * 100, 0, 100)
  if (value > band.hi && band.aboveSpan != null) return clamp(100 - ((value - band.hi) / band.aboveSpan) * 100, 0, 100)
  return 100
}

/** Robust spread: IQR / 1.349, floored at the unit's minimum meaningful change (edge case #4). */
export function robustSpread(values: number[], minMeaningfulChange: number): number {
  const p25 = quantile(values, 0.25)
  const p75 = quantile(values, 0.75)
  const iqrSigma = p25 != null && p75 != null ? (p75 - p25) / IQR_TO_SIGMA : 0
  return Math.max(iqrSigma, minMeaningfulChange)
}

export function stageFor(validDays: number): ShadowReadinessStage {
  if (validDays >= MATURITY_SETTLED_DAYS) return 'settled'
  if (validDays >= MATURITY_PROVISIONAL_DAYS) return 'provisional'
  return 'learning'
}

const STAGE_RANK: Record<ShadowReadinessStage, number> = { learning: 0, provisional: 1, settled: 2 }
const lessMature = (a: ShadowReadinessStage, b: ShadowReadinessStage) => (STAGE_RANK[a] <= STAGE_RANK[b] ? a : b)

/** Fuel's parts, each 0–100 or null when not logged (edge case #12). */
export interface FuelParts {
  /** kcal eaten minus the day's budget. Null when the day was not marked fully logged. */
  energyDeviationKcal: number | null
  /** Protein eaten ÷ the day's protein target. */
  proteinRatio: number | null
  /** Water drunk ÷ the water goal. */
  hydrationRatio: number | null
}

/** Fuel as one unit: the mean of the parts that were logged, or null when none was. */
export function scoreFuel(parts: FuelParts): { score: number | null; parts: Record<keyof FuelParts, number | null> } {
  const out: Record<keyof FuelParts, number | null> = {
    energyDeviationKcal: parts.energyDeviationKcal == null ? null : rangeScore(parts.energyDeviationKcal, FUEL_BANDS.energy),
    proteinRatio: parts.proteinRatio == null ? null : rangeScore(parts.proteinRatio, FUEL_BANDS.protein),
    hydrationRatio: parts.hydrationRatio == null ? null : rangeScore(parts.hydrationRatio, FUEL_BANDS.hydration),
  }
  const present = Object.values(out).filter((v): v is number => v != null)
  return { score: present.length === 0 ? null : present.reduce((a, b) => a + b, 0) / present.length, parts: out }
}

// ── Context ──────────────────────────────────────────────────────────────────────────────────────

function levelFor(def: UnitDef, context: ShadowContext | undefined): Yardstick | undefined {
  if (!def.level) return undefined
  if (def.id === 'heart.overnight_rhr' && context?.betaBlocker) {
    const shift = CONTEXT_ADJUSTMENTS.betaBlockerRhrShiftBpm
    return def.level.map(([x, y]) => [x - shift, y] as const)
  }
  return def.level
}

function bandFor(def: UnitDef, input: UnitInput, context: ShadowContext | undefined): Band | undefined {
  if (!def.band) return undefined
  const band: Band = { ...def.band, ...input.band }
  if (def.id === 'body.spo2' && context?.altitudeM != null && context.altitudeM > CONTEXT_ADJUSTMENTS.altitudeSpo2FromM) {
    const drop = ((context.altitudeM - CONTEXT_ADJUSTMENTS.altitudeSpo2FromM) / 1000) * CONTEXT_ADJUSTMENTS.altitudeSpo2PerKm
    band.lo -= drop
  }
  return band
}

// ── One unit ─────────────────────────────────────────────────────────────────────────────────────

function emptyUnit(def: UnitDef, gap: UnitGap, note: string | null): ShadowUnitResult {
  return {
    score: null, level: null, day: null, weight: 0, stage: 'learning', validDays: 0, value: null, normal: null,
    provenance: null, daytimeThrough: null, gap, note, flags: [],
  }
}

interface Normal {
  normal: number
  spread: number
  windowValues: number[]
  flags: string[]
  /** A regime change or a cycle-aware normal caps maturity at provisional. */
  capAtProvisional: boolean
}

/**
 * The person's normal for a learned unit: median and robust spread of the last 30 valid days, with
 * the cycle-aware normal (edge case #9) and the regime change (edge case #8) applied. Null when the
 * window holds too few days to say.
 */
function learnedNormal(def: UnitDef, today: UnitObservation, history: UnitObservation[]): Normal | null {
  const mmc = def.minMeaningfulChange ?? 0
  const flags: string[] = []
  let capAtProvisional = false

  // Edge case #9 — a per-phase normal when the cycle is tracked and the phase has enough days.
  if (today.phase) {
    const from = shiftDateStr(today.date, -CYCLE_PHASE_LOOKBACK_DAYS)
    const samePhase = history.filter(o => o.phase === today.phase && o.date >= from).map(o => o.value)
    if (samePhase.length >= CYCLE_PHASE_MIN_SAMPLES) {
      flags.push(`cycle_phase:${today.phase}`)
      return { normal: median(samePhase)!, spread: robustSpread(samePhase, mmc), windowValues: samePhase, flags, capAtProvisional }
    }
  }

  const from = shiftDateStr(today.date, -BASELINE_WINDOW_DAYS)
  const window = history.filter(o => o.date >= from).sort((a, b) => a.date.localeCompare(b.date))
  if (window.length < MIN_WINDOW_SAMPLES) return null
  const values = window.map(o => o.value)
  let normal = median(values)!
  let spread = robustSpread(values, mmc)

  // Edge case #8 — a step change that has held for the last 7 valid days is a new routine: the
  // normal re-baselines on those days instead of scoring every one of them as an anomaly.
  if (window.length >= REGIME_HOLD_DAYS * 2) {
    const held = values.slice(-REGIME_HOLD_DAYS)
    const prior = values.slice(0, -REGIME_HOLD_DAYS)
    const priorMedian = median(prior)!
    const priorSpread = robustSpread(prior, mmc)
    const heldMedian = median(held)!
    const allAbove = held.every(v => v > priorMedian)
    const allBelow = held.every(v => v < priorMedian)
    if ((allAbove || allBelow) && Math.abs(heldMedian - priorMedian) >= REGIME_SHIFT_SIGMA * priorSpread) {
      normal = heldMedian
      spread = robustSpread(held, mmc)
      flags.push('regime_change')
      capAtProvisional = true
    }
  }
  return { normal, spread, windowValues: values, flags, capAtProvisional }
}

/** The guarded sweet spot: the person's own band, clamped inside the research guardrails. */
function guardedBand(guard: Band, windowValues: number[]): Band {
  if (!Number.isFinite(guard.hi)) {
    // Open-topped guard (steps): the floor is research, the upper edge is the person's own 90th
    // percentile, never closer to the floor than half its value again.
    const p90 = quantile(windowValues, 0.9)
    return { ...guard, hi: Math.max(p90 ?? guard.lo * 1.5, guard.lo * 1.5) }
  }
  const width = guard.hi - guard.lo
  const p25 = quantile(windowValues, 0.25)!
  const p75 = quantile(windowValues, 0.75)!
  const w = Math.min(width, Math.max(p75 - p25, width / 2))
  const centre = clamp(median(windowValues)!, guard.lo + w / 2, guard.hi - w / 2)
  return { ...guard, lo: centre - w / 2, hi: centre + w / 2 }
}

export function scoreUnit(
  def: UnitDef,
  input: UnitInput | undefined,
  date: string,
  excluded: ReadonlyMap<string, string>,
  context?: ShadowContext,
): ShadowUnitResult {
  if (def.unavailable) return emptyUnit(def, 'unavailable', def.unavailable)
  const today = input?.today ?? null
  if (today == null || !Number.isFinite(today.value)) {
    return emptyUnit(def, 'missing', input?.note ?? 'No input on any rung for this day.')
  }

  // Settled days only (owner, 2026-08-26). A daytime unit reads a completed day; a night unit reads
  // the night that ended on the morning of `date`, never anything later.
  if ((def.daytime && today.date >= date) || (!def.daytime && today.date > date)) {
    return emptyUnit(def, 'unsettled', `Input dated ${today.date} is not a completed day for ${date}.`)
  }

  const source = today.source ?? 'unknown'
  const provenance: UnitProvenance = { source, rung: today.rung ?? null }
  const flags: string[] = []

  // Edge case #7 — excluded days leave every window; edge case #11 — baselines stay per source.
  const prior = (input?.history ?? []).filter(o => o.date < today.date && !excluded.has(o.date) && Number.isFinite(o.value))
  const lookbackFrom = shiftDateStr(today.date, -MATURITY_LOOKBACK_DAYS)
  const inLookback = prior.filter(o => o.date >= lookbackFrom)
  const sameSource = inLookback.filter(o => (o.source ?? 'unknown') === source)
  const otherSourceDays = inLookback.length - sameSource.length
  const validDays = sameSource.length
  // A constant reference has nothing to learn, so it is settled from its first day; its history
  // only feeds the Level shown beside it.
  let stage = def.reference === 'constant' ? 'settled' : stageFor(validDays)
  // A source change restarts the unit as provisional (edge case #11): the old source's days are
  // not mixed into the new normal, and they are not thrown away as if the person were new either.
  const sourceRestarted = otherSourceDays > 0 && validDays < MATURITY_PROVISIONAL_DAYS && inLookback.length >= MATURITY_PROVISIONAL_DAYS
  if (sourceRestarted) {
    stage = 'provisional'
    flags.push('source_changed')
  }

  const base: Omit<ShadowUnitResult, 'score' | 'level' | 'day' | 'normal' | 'gap' | 'note'> = {
    weight: 0, stage, validDays, value: round1Maybe(today.value), provenance,
    daytimeThrough: def.daytime ? today.date : null, flags,
  }

  // Fuel is scored from its parts by the caller (`scoreFuel`); the unit carries the result.
  if (def.id === 'body.fuel') {
    return { ...base, stage: 'settled', score: round1(clamp(today.value, 0, 100)), level: null, day: null, normal: null, gap: null, note: input?.note ?? null }
  }

  const band = bandFor(def, input!, context)
  const usableHistory = !sourceRestarted && stage !== 'learning'
  const normal = usableHistory ? learnedNormal(def, today, sameSource) : null
  if (normal) {
    flags.push(...normal.flags)
    if (normal.capAtProvisional) base.stage = lessMature(base.stage, 'provisional')
  }

  // ── Bands: sweet spot, and steady units scored against a constant band (weight vs plan) ──
  if (band) {
    // A constant band never moves; a guarded one is learned inside its guardrails once the unit has
    // a normal; while learning it is the research default (edge case #14).
    const effective = def.reference === 'guarded' && normal ? guardedBand(band, normal.windowValues) : band
    const score = rangeScore(today.value, effective)
    // Level grades the normal on the research band itself, so a chronic 5½ h is graded as 5½ h however
    // consistent it is (edge case #2). Without a normal yet, the Level is the day graded on the
    // research band and Day is withheld (edge case #14). Steady units have no Level.
    const level = def.shape !== 'sweet_spot' ? null : normal ? rangeScore(normal.normal, band) : score
    return {
      ...base,
      score: round1(score),
      level: level == null ? null : round1(level),
      day: level == null || !normal ? null : round1(score - level),
      normal: normal ? round1Maybe(normal.normal) : null,
      gap: null,
      note: input?.note ?? (def.reference === 'guarded' && normal
        ? `Personal band ${fmt(effective.lo)}–${fmt(effective.hi)} inside the research range.`
        : null),
    }
  }

  // ── Directional and steady: Level + Day ──
  const yardstick = levelFor(def, context)
  if (!normal) {
    // Learning, a long gap, or a source restart: no personal normal yet. Level from the population
    // yardstick applied to the day itself; Day withheld. No yardstick means nothing honest to say.
    if (!yardstick) {
      return { ...base, score: null, level: null, day: null, normal: null, gap: 'learning', note: 'Learning: no personal normal yet, and this unit has no population yardstick.' }
    }
    const level = gradeOnYardstick(today.value, yardstick)
    return { ...base, score: round1(clamp(level, 0, 100)), level: round1(level), day: null, normal: null, gap: null, note: 'Learning: Level from the population yardstick, Day withheld.' }
  }

  const deviation = (today.value - normal.normal) / normal.spread
  let level: number | null
  let day: number
  let start: number
  if (def.shape === 'steady') {
    level = yardstick ? gradeOnYardstick(normal.normal, yardstick) : null
    start = level ?? 100
    day = -Math.min(100, Math.abs(deviation) * DAY_POINTS_PER_SIGMA)
  } else {
    level = yardstick ? gradeOnYardstick(normal.normal, yardstick) : null
    start = level ?? LEARNED_BASE
    const good = def.direction === 'down' ? -deviation : deviation
    day = clamp(good * DAY_POINTS_PER_SIGMA, DAY_MIN, DAY_MAX)
  }
  return {
    ...base,
    score: round1(clamp(start + day, 0, 100)),
    level: level == null ? null : round1(level),
    day: round1(day),
    normal: round1Maybe(normal.normal),
    gap: null,
    note: input?.note ?? (level == null && def.shape === 'directional' ? `No Level yardstick: learned base ${LEARNED_BASE} at the normal.` : null),
  }
}

function round1Maybe(v: number): number {
  return Math.round(v * 1000) / 1000
}

function fmt(v: number): string {
  return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '∞'
}

// ── Pillars and readiness ────────────────────────────────────────────────────────────────────────

export function scoreShadowReadiness(input: ShadowScoreInput): ShadowScoreResult {
  const excluded = input.excludedDates ?? new Map<string, 'low_wear' | 'unwell'>()
  const units = {} as Record<ShadowUnitId, ShadowUnitResult>
  for (const id of SHADOW_UNIT_IDS) {
    units[id] = scoreUnit(UNIT_DEFS[id], input.units[id], input.date, excluded, input.context)
  }

  const pillars = {} as Record<ShadowReadinessPillar, number | null>
  const pillarDetail = {} as Record<ShadowReadinessPillar, ShadowPillarDetail>
  for (const pillar of SHADOW_PILLARS) {
    const members = SHADOW_UNIT_IDS.filter(id => UNIT_DEFS[id].pillar === pillar)
    const dropped: Record<string, UnitGap> = {}
    let sumW = 0
    let sumWS = 0
    for (const id of members) {
      const u = units[id]
      if (u.score == null) {
        dropped[id] = u.gap ?? 'missing'
        continue
      }
      const def = UNIT_DEFS[id]
      // #2356: a new unit counts half until it has settled.
      u.weight = def.weight * (def.isNew && u.stage !== 'settled' ? NEW_UNIT_WEIGHT_FACTOR : 1)
      sumW += u.weight
      sumWS += u.weight * u.score
    }
    const scored: Record<string, number> = {}
    for (const id of members) if (units[id].score != null) scored[id] = round3(units[id].weight / sumW)
    pillars[pillar] = sumW > 0 ? round1(sumWS / sumW) : null
    pillarDetail[pillar] = { effectiveWeight: 0, scored, dropped }
  }

  let sumW = 0
  let sumWS = 0
  for (const p of SHADOW_PILLARS) {
    const v = pillars[p]
    if (v == null) continue
    sumW += PILLAR_WEIGHTS[p]
    sumWS += PILLAR_WEIGHTS[p] * v
  }
  for (const p of SHADOW_PILLARS) {
    pillarDetail[p].effectiveWeight = pillars[p] == null || sumW === 0 ? 0 : round3(PILLAR_WEIGHTS[p] / sumW)
  }
  const shadowReadiness = sumW > 0 ? round1(clamp(sumWS / sumW, 0, 100)) : null

  // The row's stage is the least mature unit that scored; with nothing scored it is learning.
  let maturityStage: ShadowReadinessStage | null = null
  let inputsThrough: string | null = null
  for (const id of SHADOW_UNIT_IDS) {
    const u = units[id]
    if (u.score != null) maturityStage = maturityStage == null ? u.stage : lessMature(maturityStage, u.stage)
    if (u.daytimeThrough != null && u.gap !== 'unsettled' && (inputsThrough == null || u.daytimeThrough > inputsThrough)) {
      inputsThrough = u.daytimeThrough
    }
  }

  return {
    date: input.date,
    modelVersion: SHADOW_MODEL_VERSION,
    shadowReadiness,
    pillars,
    pillarDetail,
    units,
    maturityStage: maturityStage ?? 'learning',
    inputsThrough,
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000
