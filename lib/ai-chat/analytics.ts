import { linearFit } from '@trainingai/shared/health/strength-projection'

export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null
  const n = xs.length
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let cov = 0, varX = 0, varY = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    cov += dx * dy
    varX += dx * dx
    varY += dy * dy
  }
  if (varX === 0 || varY === 0) return null
  return cov / Math.sqrt(varX * varY)
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export type DayOfWeekAverages = Record<typeof DOW_LABELS[number], number | null>

export function averageByDayOfWeek(entries: { date: string; value: number }[]): DayOfWeekAverages {
  const buckets: Record<string, number[]> = {}
  for (const label of DOW_LABELS) buckets[label] = []
  for (const e of entries) {
    const dow = new Date(e.date + 'T12:00:00Z').getUTCDay() // noon UTC avoids local-tz date-rollback
    buckets[DOW_LABELS[dow]].push(e.value)
  }
  const result = {} as DayOfWeekAverages
  for (const label of DOW_LABELS) {
    const vals = buckets[label]
    result[label] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }
  return result
}

export type TrendClassification = 'improving' | 'plateaued' | 'declining'

// Index-spaced linear-regression slope on an ordered series (oldest first), normalized
// by the series' own mean so the "meaningful slope" threshold scales with the
// exercise's typical numbers (a 2kg/session slope means something different for a
// 20kg curl than a 150kg deadlift). For non-dated/equal-spacing series only — a dated
// series should use the day-spaced projectRm() from lib/health/strength-projection.ts
// instead (see getPlateauReport in tools.ts, which owns the "plateaued" verdict).
export function classifyTrend(values: number[]): TrendClassification {
  if (values.length < 3) return 'plateaued'
  const fit = linearFit(values.map((y, x) => ({ x, y })))
  if (!fit) return 'plateaued'
  const meanY = values.reduce((a, b) => a + b, 0) / values.length
  const normalizedSlope = meanY !== 0 ? fit.slope / meanY : 0
  if (normalizedSlope > 0.01) return 'improving'
  if (normalizedSlope < -0.01) return 'declining'
  return 'plateaued'
}
