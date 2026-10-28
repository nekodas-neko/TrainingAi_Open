


export interface MetricRow {
  date: string
  [field: string]: string | number | null
}

export interface MetricSpec {
  field: string
  label: string
  unit?: string
  
  dp?: number
  
  note?: string
}

export interface MetricGroup {
  title: string
  specs: MetricSpec[]
}

export interface MetricReading {
  label: string
  value: string
  
  asOf: string
  note?: string
}

export interface ReadingGroup {
  title: string
  readings: MetricReading[]
}


export const METRIC_GROUPS: MetricGroup[] = [
  {
    title: 'Body composition',
    specs: [
      { field: 'weightKg', label: 'Weight', unit: 'kg', dp: 1 },
      { field: 'bodyFatPct', label: 'Body fat', unit: '%', dp: 1 },
      { field: 'skeletalMusclePct', label: 'Skeletal muscle', unit: '%', dp: 1 },
      { field: 'muscleMassKg', label: 'Muscle mass', unit: 'kg', dp: 1 },
      { field: 'fatFreeMassKg', label: 'Fat-free mass', unit: 'kg', dp: 1 },
      { field: 'bodyWaterPct', label: 'Body water', unit: '%', dp: 1 },
      { field: 'boneMassKg', label: 'Bone mass', unit: 'kg', dp: 1 },
      { field: 'proteinPct', label: 'Protein', unit: '%', dp: 1 },
      { field: 'subcutaneousFatPct', label: 'Subcutaneous fat', unit: '%', dp: 1 },
      { field: 'visceralFatIndex', label: 'Visceral fat index', dp: 1 },
    ],
  },
  {
    title: 'Vitals',
    specs: [
      { field: 'restingHeartRate', label: 'Resting heart rate', unit: 'bpm' },
      { field: 'hrvMs', label: 'HRV', unit: 'ms' },
      { field: 'spo2Pct', label: 'Blood oxygen', unit: '%' },
    ],
  },
  {
    title: 'Metabolism',
    specs: [
      {
        field: 'bmrKcal',
        label: 'Resting rate',
        unit: 'kcal',
        note: 'estimated by the scale — a lab-measured one, if you have had one, is under Tests and scans',
      },
      { field: 'metabolicAge', label: 'Metabolic age', unit: 'years' },
    ],
  },
  {
    title: 'Daily movement',
    specs: [
      { field: 'steps', label: 'Steps' },
      { field: 'distanceKm', label: 'Distance', unit: 'km', dp: 1 },
    ],
  },
]


export function latestReading(rows: MetricRow[], spec: MetricSpec): MetricReading | null {
  let best: { value: number; date: string } | null = null
  for (const row of rows) {
    const raw = row[spec.field]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    if (!best || row.date > best.date) best = { value: raw, date: row.date }
  }
  if (!best) return null
  return {
    label: spec.label,
    value: format(best.value, spec),
    asOf: best.date,
    note: spec.note,
  }
}


export function readingGroups(rows: MetricRow[], groups: MetricGroup[] = METRIC_GROUPS): ReadingGroup[] {
  return groups
    .map(g => ({
      title: g.title,
      readings: g.specs.map(s => latestReading(rows, s)).filter((r): r is MetricReading => r !== null),
    }))
    .filter(g => g.readings.length > 0)
}

function format(value: number, spec: MetricSpec): string {
  const n = spec.dp == null ? Math.round(value).toLocaleString() : value.toFixed(spec.dp)
  return spec.unit ? `${n} ${spec.unit}` : n
}

export interface SleepNight {
  date: string
  durationHours: number | null
  efficiency: number | null
  
  sleepStart: string | null
  lowestHeartRate: number | null
  respiratoryRate: number | null
  /** #2265: the owner's partial-night mark; such a night keeps its heart rate and breathing in the averages. */
  partialNightAt?: string | null
}

export interface SleepAverages {
  nights: number
  durationHours: number | null
  efficiency: number | null
  
  bedtimeMinutes: number | null
  lowestHeartRate: number | null
  respiratoryRate: number | null
}

export function sleepAverages(nights: SleepNight[]): SleepAverages | null {
  if (nights.length === 0) return null
  // #2265: a night marked partial keeps its physiology in the averages and loses its hours,
  // efficiency and bedtime. It is still a night, so it still counts in `nights`.
  const full = nights.filter(n => n.partialNightAt == null)
  return {
    nights: nights.length,
    durationHours: mean(full.map(n => n.durationHours)),
    efficiency: mean(full.map(n => n.efficiency)),
    bedtimeMinutes: circularMeanMinutes(full.map(n => n.sleepStart)),
    lowestHeartRate: mean(nights.map(n => n.lowestHeartRate)),
    respiratoryRate: mean(nights.map(n => n.respiratoryRate)),
  }
}

function mean(values: (number | null)[]): number | null {
  const real = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (real.length === 0) return null
  return real.reduce((a, b) => a + b, 0) / real.length
}


export function circularMeanMinutes(instants: (string | null)[], minutesOfDay?: (iso: string) => number | null): number | null {
  const toMinutes = minutesOfDay ?? defaultMinutesOfDay
  const angles: number[] = []
  for (const iso of instants) {
    if (!iso) continue
    const m = toMinutes(iso)
    if (m == null || !Number.isFinite(m)) continue
    angles.push((m / 1440) * 2 * Math.PI)
  }
  if (angles.length === 0) return null
  const x = angles.reduce((a, t) => a + Math.cos(t), 0) / angles.length
  const y = angles.reduce((a, t) => a + Math.sin(t), 0) / angles.length
  if (Math.hypot(x, y) < 1e-9) return null
  const theta = Math.atan2(y, x)
  const minutes = ((theta / (2 * Math.PI)) * 1440 + 1440) % 1440
  return minutes
}


function defaultMinutesOfDay(iso: string): number | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}


export function clockFromMinutes(minutes: number): string {
  const m = Math.round(minutes) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
