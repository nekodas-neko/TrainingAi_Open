/**
 * What the app has MEASURED about the user, as opposed to what the user told it (BF-133).
 *
 * **A metric with no reading is omitted, never rendered blank.** That is the whole shape of this
 * card: `body_metrics` has six tape-measure columns nothing has ever written and a `sleep_score`
 * that has never been populated, so "render every column" would ship a screen of permanent dashes
 * and teach the reader to skip it.
 *
 * **Every value carries the date it was read.** A body-composition figure from a scale session weeks
 * ago sits beside today's step count, and without an "as of" the two read as equally current — which
 * is the misleading half of a dense card, not the useful half.
 */

/** One field of one day's row, as the local store holds it. */
export interface MetricRow {
  date: string
  [field: string]: string | number | null
}

export interface MetricSpec {
  field: string
  label: string
  unit?: string
  /** Decimal places; integers by default. */
  dp?: number
  /**
   * Said in the row itself when the number is not what its name implies. The BMR from a bathroom
   * scale and a lab-measured resting rate are both "RMR" to a reader, and the app holds both.
   */
  note?: string
}

export interface MetricGroup {
  title: string
  specs: MetricSpec[]
}

export interface MetricReading {
  label: string
  value: string
  /** `YYYY-MM-DD` of the row this came from. */
  asOf: string
  note?: string
}

export interface ReadingGroup {
  title: string
  readings: MetricReading[]
}

/**
 * Grouped by what a number is FOR, not by the table it came from — grouping by table puts a
 * metabolic rate next to a step count because they share a row.
 */
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
      // Named for the window it describes. The app holds three different heart rates — overnight
      // lowest and average, per-workout, and this daily resting figure — and a row labelled just
      // "heart rate" silently merges a sleeping one with a working one.
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

/** The most recent row carrying a number for `field`, or null when nothing ever has. */
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

/** Every group that has at least one reading; groups and metrics with none are dropped entirely. */
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

// ── Sleep, which is an average rather than a latest reading (BF-133) ─────────────────────────────

export interface SleepNight {
  date: string
  durationHours: number | null
  efficiency: number | null
  /** ISO instant. Rendered as a clock time in the USER's zone, never the device's. */
  sleepStart: string | null
  lowestHeartRate: number | null
  respiratoryRate: number | null
}

export interface SleepAverages {
  nights: number
  durationHours: number | null
  efficiency: number | null
  /** Minutes after midnight, circular-mean, so 23:50 and 00:10 average to 00:00 and not to noon. */
  bedtimeMinutes: number | null
  lowestHeartRate: number | null
  respiratoryRate: number | null
}

export function sleepAverages(nights: SleepNight[]): SleepAverages | null {
  if (nights.length === 0) return null
  return {
    nights: nights.length,
    durationHours: mean(nights.map(n => n.durationHours)),
    efficiency: mean(nights.map(n => n.efficiency)),
    bedtimeMinutes: circularMeanMinutes(nights.map(n => n.sleepStart)),
    lowestHeartRate: mean(nights.map(n => n.lowestHeartRate)),
    respiratoryRate: mean(nights.map(n => n.respiratoryRate)),
  }
}

function mean(values: (number | null)[]): number | null {
  const real = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (real.length === 0) return null
  return real.reduce((a, b) => a + b, 0) / real.length
}

/**
 * The mean of a set of clock times, taken on the circle.
 *
 * A plain average is wrong here and wrong in the direction that matters: bedtimes straddle midnight,
 * and 23:50 with 00:10 averages arithmetically to **12:00** — the middle of the following day, and a
 * number that looks like a real answer. Averaging the unit vectors instead gives 00:00.
 *
 * The minutes-of-day must already be in the user's timezone; this function only does the circle.
 */
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
  // Directions cancelling to the centre have no mean direction — 12 hours apart is genuinely
  // ambiguous, and returning either end of it would be inventing an answer.
  if (Math.hypot(x, y) < 1e-9) return null
  const theta = Math.atan2(y, x)
  const minutes = ((theta / (2 * Math.PI)) * 1440 + 1440) % 1440
  return minutes
}

/** UTC fallback — call sites pass a timezone-aware converter. */
function defaultMinutesOfDay(iso: string): number | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

/** `23:17` from minutes-after-midnight. */
export function clockFromMinutes(minutes: number): string {
  const m = Math.round(minutes) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
