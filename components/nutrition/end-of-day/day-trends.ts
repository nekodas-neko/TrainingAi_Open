import type { WeekWindowResponse } from '@/app/api/day-review/week-window/route'

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

/**
 * `comparison` names what the delta is measured against, because the same row now serves two
 * windows: the day review compares today with the last 7 days, the weekly recap compares the week
 * with the last 4 weeks. Defaulted to the daily phrasing so the original call site reads unchanged.
 */
export function deltaSentence(spec: TrendSpec, delta: TrendDelta, comparison = 'the last 7 days'): string {
  if (delta.direction === 'level') return `Level with ${comparison}`
  const word = delta.direction === 'up' ? 'above' : 'below'
  return `${spec.formatDelta(delta.magnitude)} ${word} ${comparison}`
}

export interface TrendSeries {
  values: number[]
  /** Index of the point within the window. Paired with `values` so a stat recorded on three of
   *  eight days draws at the three positions it was recorded, rather than stretched across the
   *  width — and the same for three of five weeks. */
  times: number[]
}

/**
 * One period of the window: a day for the day review, a week for the recap. Structural rather than
 * `WeekWindowDay`, which also carries a `date` the maths never reads — the two routes name their
 * period differently (`date` / `weekStart`) and that is the only thing that differs.
 */
export type TrendPoint = { [K in TrendKey]?: number | null }

/** `null` when there are fewer than two points, which is what `Sparkline` refuses to draw. */
export function trendSeries(points: TrendPoint[], key: TrendKey): TrendSeries | null {
  const values: number[] = []
  const times: number[] = []
  points.forEach((d, i) => {
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
 * A window of periods and the average to judge its last one against. Both routes serve this shape
 * under different names — `days`/`sevenDayAverages` and `weeks`/`priorAverages` — and the maths is
 * identical, so it is written once here and adapted at each call site (Q-112e).
 */
export interface TrendWindow {
  /** Oldest first. The LAST point is the period being reported on. */
  points: TrendPoint[]
  /** Mean over the points before the last one. */
  priorAverages: TrendPoint
}

/**
 * The rows to draw, in order. A stat with **no** reading anywhere in the window is omitted rather
 * than shown empty — that is a stat this user does not record, and a permanently blank row is worse
 * than an absent one. A stat with some history but nothing in the current period keeps its row,
 * because the window is still an answer and the gap is itself worth seeing.
 */
export function trendRowsFor(window: TrendWindow): TrendRow[] {
  const current = window.points[window.points.length - 1]
  return TREND_SPECS.flatMap(spec => {
    const series = trendSeries(window.points, spec.key)
    const value = current?.[spec.key] ?? null
    if (series === null && value == null) return []
    return [{
      spec,
      today: value,
      delta: trendDelta(value, window.priorAverages[spec.key] ?? null),
      series,
    }]
  })
}

/** The day review's window: eight days against the seven before today. */
export function trendRows(data: WeekWindowResponse): TrendRow[] {
  return trendRowsFor({ points: data.days, priorAverages: data.sevenDayAverages })
}

/** The domain every row's sparkline projects into, so four charts of different coverage still line
 *  up day-for-day with each other. */
export const TREND_TIME_DOMAIN: [number, number] = [0, 7]

/** The same, for the recap's five weekly points — four prior weeks plus the week being reported. */
export const TREND_WEEK_TIME_DOMAIN: [number, number] = [0, 4]
