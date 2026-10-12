export interface RMStyleSet {
  pct: number
  reps: number
  useFor1rm?: boolean

  barKg?: number | null
  basisKg?: number | null
}

export function mround(value: number, multiple: number): number {
  return Math.round(value / multiple) * multiple
}
export const REP_CEILING = 30
export function repFactor(reps: number): number {
  const epley = 1 + reps / 30
  const brzycki = 36 / (37 - Math.min(reps, 20))
  return (epley + brzycki) / 2
}
export function calc1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return weight
  return mround(weight * repFactor(Math.min(reps, REP_CEILING)), 0.25)
}


const AMRAP_ANCHORS: readonly (readonly [reps: number, factor: number])[] = [
  [5, 1.0], [8, 0.97], [12, 0.93], [20, 0.88], [REP_CEILING, 0.82],
]

export function amrapScaleFactor(reps: number): number {
  const [firstReps, firstFactor] = AMRAP_ANCHORS[0]
  if (reps <= firstReps) return firstFactor
  for (let i = 1; i < AMRAP_ANCHORS.length; i++) {
    const [r1, f1] = AMRAP_ANCHORS[i]
    if (reps <= r1) {
      const [r0, f0] = AMRAP_ANCHORS[i - 1]
      return f0 + (f1 - f0) * (reps - r0) / (r1 - r0)
    }
  }
  return AMRAP_ANCHORS[AMRAP_ANCHORS.length - 1][1]
}
export function calcAmrap1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return weight
  const r = Math.min(reps, REP_CEILING)
  return mround(weight * repFactor(r) * amrapScaleFactor(r), 0.25)
}


export const MAX_BAR_ROUNDING_KG = 2.5
const MIN_BAR_KG = 5
const MAX_BAR_KG = 250


function barSharePct(set: RMStyleSet): number | null {
  const { pct, barKg, basisKg } = set
  if (barKg == null || basisKg == null) return null
  if (!Number.isFinite(barKg) || !Number.isFinite(basisKg) || barKg <= 0 || basisKg <= 0) return null
  const raw = basisKg * pct / 100
  const eps = 1e-6
  const roundedUp = barKg >= raw - eps && (barKg - raw <= MAX_BAR_ROUNDING_KG + eps || barKg <= MIN_BAR_KG + eps)
  const capped = barKg >= MAX_BAR_KG - eps && raw > MAX_BAR_KG
  if (!roundedUp && !capped) return null
  return barKg / basisKg * 100
}
function prescriptionFactor(set: RMStyleSet | undefined): number | null {
  if (!set) return null
  const { pct, reps: targetReps } = set
  if (!pct || pct <= 0 || !targetReps || targetReps <= 0 || targetReps >= 37) return null
  const share = barSharePct(set) ?? pct
  return 1 / ((share / 100) * repFactor(targetReps))
}


export function withPrescribedBars<T extends RMStyleSet>(
  style: T[] | null | undefined,
  bars: readonly (number | null | undefined)[] | null | undefined,
  basisKg: number | null | undefined,
): T[] | null {
  if (!style) return null
  if (!bars?.length || basisKg == null || !Number.isFinite(basisKg) || basisKg <= 0) return style
  return style.map((s, i) => {
    const bar = bars[i]
    return bar != null && Number.isFinite(bar) && bar > 0 ? { ...s, barKg: bar, basisKg } : s
  })
}

export function calculate1RM(
  weights: number[],
  reps: number[],
  style?: RMStyleSet[] | null,
): { estimated1rm: number; target80: number } {
  const indices = style?.some(s => s.useFor1rm)
    ? reps.map((_, i) => i).filter(i => style![i]?.useFor1rm)
    : reps.map((_, i) => i)
  const oneRMs = indices
    .map(i => {
      const w = weights[i] ?? weights[weights.length - 1] ?? 0
      const r = Math.min(reps[i] ?? 0, REP_CEILING)
      if (!(w && r)) return 0
      const factor = prescriptionFactor(style?.[i]) ?? 1
      return mround(w * repFactor(r) * factor, 0.25)
    })
    .filter(v => v > 0)
  const estimated1rm = oneRMs.length > 0 ? mround(oneRMs.reduce((a, b) => a + b, 0) / oneRMs.length, 0.25) : 0
  const target80 = mround(estimated1rm * 0.8, 0.25)
  return { estimated1rm, target80 }
}
export function runningEstimate1RM(
  weights: number[],
  reps: number[],
  style?: RMStyleSet[] | null,
): number {
  const primary = calculate1RM(weights, reps, style).estimated1rm
  if (primary > 0) return primary
  const flat = style?.map(s => ({ pct: s.pct, reps: s.reps, barKg: s.barKg, basisKg: s.basisKg }))
  return calculate1RM(weights, reps, flat).estimated1rm
}

export type OneRmTrend = 'up' | 'even' | 'down' | 'none'
export function oneRmTrendStatus(projected: number, previous: number | null): OneRmTrend {
  if (previous == null || previous <= 0) return 'none'
  const diff = projected - previous
  if (diff > 0.5) return 'up'
  if (diff < -0.5) return 'down'
  return 'even'
}
export const BW_REF = 100

export type OneRmExerciseType = 'weighted' | 'bodyweight'

export interface OneRmSetInput { weightKg: number; reps: number }

export interface OneRmEstimateOpts {
  exerciseType: OneRmExerciseType
  style?: RMStyleSet[] | null
  bwRef?: number
  isBaseline?: boolean
  targetPct?: number
  deloaded?: boolean
}

export interface OneRmEstimate { estimated1rm: number; target80: number; targetPct: number }
function amrapAverage1Rm(weights: number[], reps: number[], style?: RMStyleSet[] | null): number {
  const flagged = style?.some(s => s.useFor1rm)
  const indices = reps.map((_, i) => i).filter(i => !flagged || style![i]?.useFor1rm)
  const perSet = indices
    .map(i => {
      const w = weights[i] ?? 0
      const r = Math.min(reps[i] ?? 0, REP_CEILING)
      return w > 0 && r > 0 ? calcAmrap1RM(w, r) : 0
    })
    .filter(v => v > 0)
  return perSet.length ? mround(perSet.reduce((a, b) => a + b, 0) / perSet.length, 0.25) : 0
}

function styleTargetPct(style?: RMStyleSet[] | null): number | null {
  if (!style?.length) return null
  const flagged = style.filter(s => s.useFor1rm && s.pct > 0)
  const pool = flagged.length ? flagged : style.filter(s => s.pct > 0)
  return pool.length ? Math.max(...pool.map(s => s.pct)) : null
}

export function isDeloadedForEstimate(a: {
  exerciseDeloaded?: boolean
  isAnyDeload: boolean
  isBaseline: boolean
}): boolean {
  return a.exerciseDeloaded === true || (a.isAnyDeload && !a.isBaseline);
}

export function estimateOneRm(sets: OneRmSetInput[], opts: OneRmEstimateOpts): OneRmEstimate {
  const { exerciseType, style, bwRef = BW_REF, isBaseline = false, deloaded = false } = opts
  const targetPct = opts.targetPct ?? styleTargetPct(style) ?? 80
  if (deloaded) return { estimated1rm: 0, target80: 0, targetPct }
  const weights = sets.map(s => (exerciseType === 'bodyweight' ? Math.max(1, bwRef + s.weightKg) : s.weightKg))
  const reps = sets.map(s => s.reps)

  let estimated1rm: number
  if (exerciseType === 'bodyweight' || isBaseline) {
    estimated1rm = amrapAverage1Rm(weights, reps, style)
  } else {
    estimated1rm = calculate1RM(weights, reps, style).estimated1rm
  }
  return { estimated1rm, target80: mround(estimated1rm * targetPct / 100, 0.25), targetPct }
}
export function bestSetOneRm(sets: OneRmSetInput[], opts: Pick<OneRmEstimateOpts, 'exerciseType' | 'bwRef'>): number {
  const { exerciseType, bwRef = BW_REF } = opts
  let best = 0
  for (const s of sets) {
    const r = Math.min(s.reps, REP_CEILING)
    if (r <= 0) continue
    if (exerciseType === 'bodyweight') {
      const w = Math.max(1, bwRef + s.weightKg)
      best = Math.max(best, calcAmrap1RM(w, r))
    } else {
      if (s.weightKg <= 0) continue
      best = Math.max(best, calc1RM(s.weightKg, r))
    }
  }
  return best
}
export function repMaxFromOneRm(oneRm: number, addedKg = 0): number {
  if (oneRm <= 0) return 0
  const ref = Math.max(1, BW_REF + addedKg)
  let best = 1
  for (let r = 1; r <= REP_CEILING; r++) {
    if (calc1RM(ref, r) <= oneRm + 0.5) best = r
    else break
  }
  return best
}



export function bodyweightRepMax(
  { storedReps, oneRm, addedKg = 0 }:
  { storedReps?: number | null; oneRm?: number | null; addedKg?: number },
): number | null {
  if (typeof storedReps === 'number' && Number.isFinite(storedReps) && storedReps > 0) {
    return Math.round(storedReps)
  }
  if (typeof oneRm !== 'number' || !Number.isFinite(oneRm) || oneRm <= 0) return null
  return repMaxFromAmrapOneRm(oneRm, addedKg)
}


function legacySteppedAmrap1RM(weight: number, reps: number): number {
  const r = Math.min(reps, REP_CEILING)
  const f = r <= 5 ? 1.0 : r <= 8 ? 0.97 : r <= 12 ? 0.93 : r <= 20 ? 0.88 : 0.82
  return mround(calc1RM(weight, r) * f, 0.25)
}

export function repMaxFromAmrapOneRm(oneRm: number, addedKg = 0): number {
  if (oneRm <= 0) return 0
  const ref = Math.max(1, BW_REF + addedKg)
  let best = 0
  let bestDistance = Infinity
  for (let r = 1; r <= REP_CEILING; r++) {
    const distance = Math.min(
      Math.abs(calcAmrap1RM(ref, r) - oneRm),
      Math.abs(legacySteppedAmrap1RM(ref, r) - oneRm),
    )
    if (distance < bestDistance) { bestDistance = distance; best = r }
  }
  return best
}

export type OneRmUnit = 'kg' | 'RM'

export function isBodyweightType(exerciseType?: string | null): boolean {
  return exerciseType === 'bodyweight'
}

export function oneRmUnit(exerciseType?: string | null): OneRmUnit {
  return isBodyweightType(exerciseType) ? 'RM' : 'kg'
}


export function oneRmLabel(exerciseType?: string | null): string {
  return isBodyweightType(exerciseType) ? 'Rep Max' : 'Estimated 1RM'
}

export interface OneRmDisplay {

  value: number
  unit: OneRmUnit

  text: string
}


export function displayOneRm(
  oneRm: number,
  exerciseType?: string | null,
  addedKg = 0,
): OneRmDisplay {
  if (isBodyweightType(exerciseType)) {
    const reps = bodyweightRepMax({ oneRm, addedKg }) ?? 0
    return { value: reps, unit: 'RM', text: `${reps} RM` }
  }
  const kg = mround(oneRm, 0.25)
  return { value: kg, unit: 'kg', text: `${kg} kg` }
}


export function barShareOfOneRm(weightKg: number | null | undefined, oneRm: number | null | undefined): number | null {
  if (weightKg == null || oneRm == null) return null
  if (!Number.isFinite(weightKg) || !Number.isFinite(oneRm) || weightKg <= 0 || oneRm <= 0) return null
  return Math.round((weightKg / oneRm) * 1000) / 10
}


export function displayOneRmDelta(
  current: number,
  previous: number | null | undefined,
  exerciseType?: string | null,
  addedKg = 0,
): { value: number; unit: OneRmUnit; text: string } | null {
  if (previous == null || previous <= 0) return null
  const unit = oneRmUnit(exerciseType)
  const diff = isBodyweightType(exerciseType)
    ? (bodyweightRepMax({ oneRm: current, addedKg }) ?? 0) - (bodyweightRepMax({ oneRm: previous, addedKg }) ?? 0)
    : Math.round((current - previous) * 100) / 100
  const sign = diff > 0 ? '+' : ''
  const text = unit === 'RM'
    ? `${sign}${diff} rep${Math.abs(diff) === 1 ? '' : 's'}`
    : `${sign}${diff.toFixed(2)} kg`
  return { value: diff, unit, text }
}


export function describePersonalRecord(
  exerciseName: string,
  oneRm: number,
  exerciseType?: string | null,
): string {
  return isBodyweightType(exerciseType)
    ? `${exerciseName} ${displayOneRm(oneRm, exerciseType).text}`
    : `${exerciseName} ${Math.round(oneRm)}kg est. 1RM`
}


export function pickHeadlinePersonalRecord<T extends { estimated1rm: number; exerciseType?: string | null }>(
  records: readonly T[],
): T | null {
  const best = (rows: readonly T[]): T | null =>
    rows.length > 0 ? rows.reduce((max, r) => (r.estimated1rm > max.estimated1rm ? r : max)) : null
  return best(records.filter(r => !isBodyweightType(r.exerciseType))) ?? best(records)
}


export function displayOneRmSeries(
  values: number[],
  exerciseType?: string | null,
  addedKg = 0,
): number[] {
  if (!isBodyweightType(exerciseType)) return values
  return values.map(v => bodyweightRepMax({ oneRm: v, addedKg }) ?? 0)
}
export function rescaleBodyweightReps<T extends RMStyleSet>(style: T[], basis: number): T[] {
  const repMax = bodyweightRepMax({ oneRm: basis }) ?? 0
  if (repMax <= 0) return style
  return style.map(s => ({ ...s, reps: Math.max(1, Math.floor((s.pct / 100) * repMax)) }))
}
export function resolveBodyweightStyle<T extends RMStyleSet>(params: {
  bwType: string
  style: T[] | null
  isBaselinePhase: boolean
  aiStyleApplied: boolean
  basis: number
}): T[] | null {
  const { bwType, style, isBaselinePhase, aiStyleApplied, basis } = params
  if (bwType === 'bodyweight' && style && !isBaselinePhase && !aiStyleApplied) {
    return rescaleBodyweightReps(style, basis)
  }
  return style
}


export function resolveWorkingBasis(input: {

  lastNonDeload1rm?: number | null

  seedEstimate?: number | null

  allTimePr1rm?: number | null
}): number | null {
  return resolveWorkingBasisWithSource(input).kg
}


export function resolveWorkingBasisWithSource(input: {
  lastNonDeload1rm?: number | null
  seedEstimate?: number | null
  allTimePr1rm?: number | null
}): { kg: number | null; source: 'last_real' | 'seed' | 'pr' | null } {
  const usable = (v: number | null | undefined): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0

  if (usable(input.lastNonDeload1rm)) return { kg: input.lastNonDeload1rm, source: 'last_real' }

  const seed = usable(input.seedEstimate) ? input.seedEstimate : null
  const pr = usable(input.allTimePr1rm) ? input.allTimePr1rm : null
  if (seed == null && pr == null) return { kg: null, source: null }
  const kg = Math.max(seed ?? -Infinity, pr ?? -Infinity)
  return { kg, source: seed != null && seed >= (pr ?? -Infinity) ? 'seed' : 'pr' }
}
