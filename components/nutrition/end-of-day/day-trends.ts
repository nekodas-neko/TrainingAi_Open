import type { WeekWindowDay, WeekWindowResponse } from '@/app/api/day-review/week-window/route'

/** The four stats the week-window route serves, and the only four the plan says earn a trend. */
export type TrendKey = 'restingHeartRate' | 'steps' | 'sessionVolumeKg' | 'weightKg'

export interface TrendSpec {
  key: TrendKey
  label: string
  color: string
  /** Today's reading, rendered with its unit. */
  format: (value: number) => string
  /** A DIFFERENCE, rendered with its unit. Separate from `format` because a delta rounds
   *  differently from a level — 0.4 kg matters where a 0.4 kg body weight does not exist. */
  formatDelta: (value: number) => string
}

const int = (n: number) => Math.round(n).toLocaleString()

/**
 * Deliberately ordered body-first, and deliberately not coloured by whether a move is *good*.
 *
 * Three of the four have no fixed good direction: session volume is meant to fall in a deload,
 * and body weight rising is the point of a `build_muscle` goal and the problem under `lose_weight`.
 * Only resting heart rate reads one way, and colouring one row by valence while three are neutral
 * teaches that the colours mean nothing — so each stat keeps its own identifying colour and the
 * direction is carried by an arrow and a word, which is also what the colour-only-state rule wants.
 */
export const TREND_SPECS: TrendSpec[] = [
  {
    key: 'restingHeartRate', label: 'Resting heart rate', color: '#f87171',
    format: v => `${int(v)} bpm`, formatDelta: v => `${int(v)} bpm`,
  },
  {
    key: 'steps', label: 'Steps', color: '#22c55e',
    format: int, formatDelta: int,
  },
  {
    key: 'sessionVolumeKg', label: 'Session volume', color: '#a78bfa',
    format: v => `${int(v)} kg`, formatDelta: v => `${int(v)} kg`,
  },
  {
    key: 'weightKg', label: 'Weight', color: '#38bdf8',
    format: v => `${v.toFixed(1)} kg`, formatDelta: v => `${v.toFixed(1)} kg`,
  },
]

export type Direction = 'up' | 'down' | 'level'

export interface TrendDelta {
  direction: Direction
  /** Always positive — the direction carries the sign, so nothing has to render a minus. */
  magnitude: number
}

/**
 * `null` when either side is missing, which is a different statement from a zero delta and must
 * not be flattened into one: "no reading today" and "exactly the week's average" look identical
 * once a missing value becomes 0.
 */
export function trendDelta(today: number | null, average: number | null): TrendDelta | null {
  if (today == null || average == null) return null
  const diff = today - average
  // A delta is `level` only when it rounds away entirely at the precision it would be shown at.
  // Weight is the tightest of the four at one decimal, so that is the threshold for all of them —
  // a 0.02 kg difference printed as "0.0 kg above" is a difference the reader cannot see.
  if (Math.abs(diff) < 0.05) return { direction: 'level', magnitude: 0 }
  return { direction: diff > 0 ? 'up' : 'down', magnitude: Math.abs(diff) }
}

export function deltaSentence(spec: TrendSpec, delta: TrendDelta): string {
  if (delta.direction === 'level') return 'Level with the last 7 days'
  const word = delta.direction === 'up' ? 'above' : 'below'
  return `${spec.formatDelta(delta.magnitude)} ${word} the last 7 days`
}

export interface TrendSeries {
  values: number[]
  /** Day index within the window, 0…7. Paired with `values` so a stat recorded on three of eight
   *  days draws at the three positions it was recorded, rather than stretched across the width. */
  times: number[]
}

/** `null` when there are fewer than two points, which is what `Sparkline` refuses to draw. */
export function trendSeries(days: WeekWindowDay[], key: TrendKey): TrendSeries | null {
  const values: number[] = []
  const times: number[] = []
  days.forEach((d, i) => {
    const v = d[key]
    if (v == null) return
    values.push(v)
    times.push(i)
  })
  return values.length < 2 ? null : { values, times }
}

export interface TrendRow {
  spec: TrendSpec
  today: number | null
  delta: TrendDelta | null
  series: TrendSeries | null
}

/**
 * The rows to draw, in order. A stat with **no** reading anywhere in the eight days is omitted
 * rather than shown empty — that is a stat this user does not record, and a permanently blank row
 * is worse than an absent one. A stat with some history but nothing today keeps its row, because
 * the week is still an answer and the gap is itself worth seeing.
 */
export function trendRows(data: WeekWindowResponse): TrendRow[] {
  const today = data.days[data.days.length - 1]
  return TREND_SPECS.flatMap(spec => {
    const series = trendSeries(data.days, spec.key)
    const value = today?.[spec.key] ?? null
    if (series === null && value == null) return []
    return [{
      spec,
      today: value,
      delta: trendDelta(value, data.sevenDayAverages[spec.key]),
      series,
    }]
  })
}

/** The domain every row's sparkline projects into, so four charts of different coverage still line
 *  up day-for-day with each other. */
export const TREND_TIME_DOMAIN: [number, number] = [0, 7]
