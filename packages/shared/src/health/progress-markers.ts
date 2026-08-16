// Progress-observation — turns a marker's time-series into a "baseline → current, are
// you improving?" verdict, so the user knows when training is working. Pure logic over
// series the app already computes (RHR, HRR1, HRV from /api/health/trends; VO₂max from
// baselines). Direction-aware (lower RHR = better; higher HRR1/VO₂max = better) with a
// meaningful-change threshold so day-to-day noise doesn't read as a trend. Absolute-value
// bands come from the 2026-07-20 training-science brief.

export type MarkerDirection = 'higher_better' | 'lower_better'
export type Trend = 'improving' | 'declining' | 'stable' | 'insufficient'

export interface MarkerBand {
  /** Inclusive lower bound; bands must be listed ascending by `min`. */
  min: number
  label: string
}

export interface MarkerConfig {
  key: string
  label: string
  unit: string
  direction: MarkerDirection
  /** |Δ| below this % of baseline is "stable" (noise floor). */
  meaningfulPct: number
  /** Optional absolute-value bands (ascending). */
  bands?: MarkerBand[]
  /** How often to re-test, for the UI. */
  retestCadence: string
}

export interface MarkerAssessment {
  key: string
  label: string
  unit: string
  current: number | null
  baseline: number | null
  deltaPct: number | null
  trend: Trend
  band: string | null
  summary: string
  retestCadence: string
}

// Grounded marker configs. HRR1 bands: >12 = normal floor (≤12 risk), ≥18 normal, 22–29
// good, ≥30 strong (Cole cutpoint + athletic ranges). RHR: lower better, no fixed bands.
export const MARKER_CONFIGS: Record<string, MarkerConfig> = {
  resting_hr: {
    key: 'resting_hr', label: 'Resting HR', unit: 'bpm', direction: 'lower_better',
    meaningfulPct: 3, retestCadence: 'Review monthly',
  },
  hrr1: {
    key: 'hrr1', label: 'HR recovery (60s)', unit: 'bpm', direction: 'higher_better',
    meaningfulPct: 8, retestCadence: 'Every 2–4 weeks',
    bands: [
      { min: 0, label: 'below normal' },
      { min: 13, label: 'normal' },
      { min: 18, label: 'good' },
      { min: 22, label: 'strong' },
      { min: 30, label: 'excellent' },
    ],
  },
  hrv: {
    key: 'hrv', label: 'HRV (overnight)', unit: 'ms', direction: 'higher_better',
    meaningfulPct: 8, retestCadence: 'Review monthly',
  },
  vo2max: {
    key: 'vo2max', label: 'VO₂max', unit: 'ml/kg/min', direction: 'higher_better',
    meaningfulPct: 3, retestCadence: 'Every 4–6 weeks',
    bands: [
      { min: 0, label: 'developing' },
      { min: 35, label: 'good' },
      { min: 45, label: 'strong' },
      { min: 55, label: 'excellent' },
    ],
  },
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

function bandFor(value: number, bands?: MarkerBand[]): string | null {
  if (!bands || !bands.length) return null
  let label: string | null = null
  for (const b of bands) if (value >= b.min) label = b.label
  return label
}

/** Assess a marker from its oldest→newest series. Baseline = mean of the first third of
 *  the non-null points, current = mean of the last third. Needs ≥4 non-null points. */
export function assessMarker(config: MarkerConfig, series: (number | null | undefined)[]): MarkerAssessment {
  const vals = series.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const base = { key: config.key, label: config.label, unit: config.unit, retestCadence: config.retestCadence }

  if (vals.length < 4) {
    return { ...base, current: null, baseline: null, deltaPct: null, trend: 'insufficient', band: null,
      summary: `Not enough data yet — keep logging to see your ${config.label.toLowerCase()} trend.` }
  }

  const third = Math.max(1, Math.floor(vals.length / 3))
  const baseline = Math.round((mean(vals.slice(0, third)) ?? 0) * 10) / 10
  const current = Math.round((mean(vals.slice(-third)) ?? 0) * 10) / 10
  const deltaPct = baseline !== 0 ? Math.round(((current - baseline) / Math.abs(baseline)) * 1000) / 10 : 0

  let trend: Trend
  if (Math.abs(deltaPct) < config.meaningfulPct) trend = 'stable'
  else {
    const rising = current > baseline
    const good = config.direction === 'higher_better' ? rising : !rising
    trend = good ? 'improving' : 'declining'
  }

  const band = bandFor(current, config.bands)
  const dirWord = trend === 'improving' ? 'improving' : trend === 'declining' ? 'slipping' : 'holding steady'
  const bandNote = band ? ` (${band})` : ''
  const summary =
    trend === 'stable'
      ? `${config.label} is holding steady around ${current} ${config.unit}${bandNote}.`
      : `${config.label} is ${dirWord}: ${baseline} → ${current} ${config.unit}${bandNote}.`

  return { ...base, current, baseline, deltaPct, trend, band, summary }
}

export interface TrendPoint {
  rhrBpm?: number | null
  hrr1Bpm?: number | null
  hrvMs?: number | null
}

/** Convenience: assess RHR / HRR1 / HRV from a health-trends series (oldest→newest). */
export function assessFromTrends(trends: TrendPoint[]): MarkerAssessment[] {
  return [
    assessMarker(MARKER_CONFIGS.resting_hr, trends.map((t) => t.rhrBpm)),
    assessMarker(MARKER_CONFIGS.hrr1, trends.map((t) => t.hrr1Bpm)),
    assessMarker(MARKER_CONFIGS.hrv, trends.map((t) => t.hrvMs)),
  ]
}
