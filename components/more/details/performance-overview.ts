import type { ReadingGroup } from './measured-overview'

/**
 * The clinical and test half of BF-133's overview — what a lab, a scan or a timed test measured, as
 * opposed to what a scale or a ring reads day to day.
 *
 * **These are one-off measurements sitting beside daily series, which is the whole reason the date
 * is not optional here.** A DEXA from one visit and a lab RMR from another read as current unless
 * each says when it was taken; the daily rows above them genuinely are.
 *
 * **Every number here has a same-named neighbour that is a DIFFERENT measurement**, and that is what
 * these labels and notes are for. The scale estimates a resting rate and a lab measures one; the
 * scale reads a body-fat percentage and so does a DEXA; `body_metrics.resting_heart_rate` is a daily
 * figure and a fitness test's is one morning's. Rendering any of these as a bare label would merge
 * two numbers that disagree by construction — the same class BF-33 settled for measured-vs-estimated
 * and this follows rather than inventing a second convention.
 */

export interface FitnessTestRow {
  date: string
  testType?: string | null
  durationSec?: number | null
  distanceM?: number | null
  avgHr?: number | null
  maxHr?: number | null
  restingHr?: number | null
  hrr1Bpm?: number | null
  vo2maxEst?: number | null
  method?: string | null
}

export interface DexaScanRow {
  scannedOn: string
  pctFat?: number | null
  leanPlusBmcG?: number | null
  fatG?: number | null
  totalBmd?: number | null
  tScore?: number | null
  vatMassG?: number | null
  androidGynoidRatio?: number | null
}

export interface MeasuredRmrRow {
  measuredOn: string
  rmrKcal?: number | null
  ffmKgAtTest?: number | null
}

interface Reading { label: string; value: string; asOf: string; note?: string }

/** The latest row carrying a real number for `pick`, with the date it was taken. */
function latestOf<T>(
  rows: T[],
  dateOf: (row: T) => string,
  pick: (row: T) => number | null | undefined,
): { value: number; asOf: string } | null {
  let best: { value: number; asOf: string } | null = null
  for (const row of rows) {
    const raw = pick(row)
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    const asOf = dateOf(row)
    if (!best || asOf > best.asOf) best = { value: raw, asOf }
  }
  return best
}

interface Field<T> {
  label: string
  pick: (row: T) => number | null | undefined
  /** Applied to the picked number before formatting — grams to kilograms, seconds to minutes. */
  scale?: (n: number) => number
  unit?: string
  dp?: number
  note?: string
}

function readingsFor<T>(rows: T[], dateOf: (row: T) => string, fields: Field<T>[]): Reading[] {
  const out: Reading[] = []
  for (const f of fields) {
    const best = latestOf(rows, dateOf, f.pick)
    if (!best) continue
    const n = f.scale ? f.scale(best.value) : best.value
    const text = f.dp == null ? Math.round(n).toLocaleString() : n.toFixed(f.dp)
    out.push({
      label: f.label,
      value: f.unit ? `${text} ${f.unit}` : text,
      asOf: best.asOf,
      note: f.note,
    })
  }
  return out
}

const G_TO_KG = (g: number) => g / 1000

/**
 * A timed or measured test result, per metric rather than per test.
 *
 * Per metric because the tests do not agree on what they produce: the two rows in production are a
 * six-minute walk that yields a VO₂max estimate and a resting-HRR test that yields a heart rate, so
 * a row per *test* would print two cards with one number each and no way to see a metric's history.
 * Latest-carrying-a-value is the same rule the daily metrics use.
 */
export function fitnessTestReadings(tests: FitnessTestRow[]): Reading[] {
  return readingsFor(tests, t => t.date, [
    {
      label: 'VO₂max',
      pick: t => t.vo2maxEst,
      unit: 'ml/kg/min',
      dp: 1,
      // The column is `vo2max_est` and the test is a submaximal walk. Printing it as VO₂max full
      // stop would present a formula's output as a laboratory measurement.
      note: 'estimated from a submaximal test, not measured directly',
    },
    { label: 'Heart-rate recovery, 1 min', pick: t => t.hrr1Bpm, unit: 'bpm' },
    {
      label: 'Resting heart rate at test',
      pick: t => t.restingHr,
      unit: 'bpm',
      // Deliberately not "Resting heart rate": Vitals above carries the daily figure from the ring,
      // and this is one morning's, taken under test conditions. Two rows, two windows, two numbers.
      note: 'one test morning — the daily figure is under Vitals',
    },
    { label: 'Peak heart rate at test', pick: t => t.maxHr, unit: 'bpm' },
    { label: 'Distance covered', pick: t => t.distanceM, unit: 'm' },
  ])
}

/**
 * The scan, summarised.
 *
 * A DEXA report has forty-odd columns and the full one already has a home at More → DEXA & RMR
 * results. What belongs in a dense overview is the handful nothing else in the app measures at all —
 * bone density, visceral fat as a mass, fat-free mass — plus the body-fat percentage, which
 * everything else measures differently and which is the number a reader will compare first.
 */
export function dexaReadings(scans: DexaScanRow[]): Reading[] {
  return readingsFor(scans, s => s.scannedOn, [
    {
      label: 'Body fat',
      pick: s => s.pctFat,
      unit: '%',
      dp: 1,
      note: 'from the scan — the scale reads its own figure under Body composition',
    },
    { label: 'Fat-free mass', pick: s => s.leanPlusBmcG, scale: G_TO_KG, unit: 'kg', dp: 1 },
    { label: 'Fat mass', pick: s => s.fatG, scale: G_TO_KG, unit: 'kg', dp: 1 },
    { label: 'Bone density', pick: s => s.totalBmd, unit: 'g/cm²', dp: 3 },
    {
      label: 'Bone density T-score',
      pick: s => s.tScore,
      dp: 1,
      note: 'standard deviations from a young-adult reference',
    },
    { label: 'Visceral fat', pick: s => s.vatMassG, scale: G_TO_KG, unit: 'kg', dp: 2 },
    { label: 'Android/gynoid ratio', pick: s => s.androidGynoidRatio, dp: 2 },
  ])
}

/** The lab-measured resting rate, which is a different number from the scale's estimate. */
export function measuredRmrReadings(tests: MeasuredRmrRow[]): Reading[] {
  return readingsFor(tests, t => t.measuredOn, [
    {
      label: 'Resting rate, measured',
      pick: t => t.rmrKcal,
      unit: 'kcal',
      note: 'a real measurement — the scale estimates its own under Metabolism',
    },
    { label: 'Fat-free mass at test', pick: t => t.ffmKgAtTest, unit: 'kg', dp: 1 },
  ])
}

/**
 * The performance half as groups, with anything empty dropped whole.
 *
 * `blood_panels` has never had a row and `fitness_tests` has two, so a fixed set of cards would ship
 * a screen mostly made of headings. Same rule as the daily half: no reading, no row; no row, no
 * group.
 */
export function performanceGroups(input: {
  fitnessTests?: FitnessTestRow[]
  dexaScans?: DexaScanRow[]
  measuredRmr?: MeasuredRmrRow[]
}): ReadingGroup[] {
  return [
    { title: 'Performance tests', readings: fitnessTestReadings(input.fitnessTests ?? []) },
    { title: 'Body scan', readings: dexaReadings(input.dexaScans ?? []) },
    { title: 'Metabolic test', readings: measuredRmrReadings(input.measuredRmr ?? []) },
  ].filter(g => g.readings.length > 0)
}
