import type { ReadingGroup } from './measured-overview'



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


export function fitnessTestReadings(tests: FitnessTestRow[]): Reading[] {
  return readingsFor(tests, t => t.date, [
    {
      label: 'VO₂max',
      pick: t => t.vo2maxEst,
      unit: 'ml/kg/min',
      dp: 1,
      note: 'estimated from a submaximal test, not measured directly',
    },
    { label: 'Heart-rate recovery, 1 min', pick: t => t.hrr1Bpm, unit: 'bpm' },
    {
      label: 'Resting heart rate at test',
      pick: t => t.restingHr,
      unit: 'bpm',
      note: 'one test morning — the daily figure is under Vitals',
    },
    { label: 'Peak heart rate at test', pick: t => t.maxHr, unit: 'bpm' },
    { label: 'Distance covered', pick: t => t.distanceM, unit: 'm' },
  ])
}


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
