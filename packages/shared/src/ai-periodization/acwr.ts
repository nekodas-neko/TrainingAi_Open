export interface AcwrSession { startedAt: Date; volumeKg: number }
export interface AcwrOptions { minSpanDays?: number; minSessions?: number; minChronicWeeklyLoadKg?: number }
export interface AcwrResult {
  acwr: number | null
  acuteLoadKg: number
  chronicWeeklyAvgKg: number
  dataSpanWeeks: number
  todayVolumeKg: number
  typicalSessionVolumeKg: number
}

// Volume-load acute:chronic workload ratio over ALL sessions (not one session type).
// Chronic load divides by the REAL data span in weeks, so a 3-week-old program is judged
// against 3 weeks of history, not an imaginary 4 — the flat ÷4 inflated ACWR ~2× on new
// programs and fired spurious emergency deloads.
export function computeVolumeAcwr(sessions: AcwrSession[], todayMid: Date, opts: AcwrOptions = {}): AcwrResult {
  const { minSpanDays = 21, minSessions = 6, minChronicWeeklyLoadKg = 100 } = opts
  const from7d = todayMid.getTime() - 7 * 86_400_000
  let acuteLoadKg = 0, chronicLoad = 0, todayVolumeKg = 0
  let earliest: number | null = null
  const vols: number[] = []
  for (const s of sessions) {
    const t = s.startedAt.getTime()
    chronicLoad += s.volumeKg
    if (t >= from7d) acuteLoadKg += s.volumeKg
    if (t >= todayMid.getTime()) todayVolumeKg += s.volumeKg
    if (s.volumeKg > 0) vols.push(s.volumeKg)
    if (earliest == null || t < earliest) earliest = t
  }
  const spanMs = earliest != null ? todayMid.getTime() - earliest : 0
  // Round to whole days so a session logged a few hours into "21 days ago" still counts
  // as a full 21-day span, rather than being nudged just under the gate by its time-of-day.
  const spanDays = Math.round(spanMs / 86_400_000)
  const dataSpanWeeks = Math.max(1, spanDays / 7)
  const chronicWeeklyAvgKg = chronicLoad / dataSpanWeeks
  const sorted = [...vols].sort((a, b) => a - b)
  const typicalSessionVolumeKg = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
  const gatesPass =
    spanDays >= minSpanDays &&
    sessions.length >= minSessions &&
    chronicWeeklyAvgKg > minChronicWeeklyLoadKg
  return {
    acwr: gatesPass ? acuteLoadKg / chronicWeeklyAvgKg : null,
    acuteLoadKg, chronicWeeklyAvgKg, dataSpanWeeks, todayVolumeKg, typicalSessionVolumeKg,
  }
}

export interface AcwrBand {
  key: 'low' | 'optimal' | 'high' | 'very_high'
  label: string
  color: string
}

// Canonical ACWR band boundaries — the readiness-score route's modifier logic imports
// these instead of re-hardcoding the same numbers.
export const ACWR_THRESHOLDS = { lowMax: 0.8, optimalMax: 1.3, highMax: 1.5 } as const

// Single agreed ACWR band, consumed everywhere a band/label/color is displayed —
// never re-derive from the raw acwr number at the call site (four divergent
// threshold sets existed before this: the training-load route, the Home widget,
// the Health explainer copy, and the readiness-score modifier all disagreed).
export function acwrBand(acwr: number): AcwrBand {
  if (acwr < ACWR_THRESHOLDS.lowMax) return { key: 'low', label: 'Undertraining', color: '#94a3b8' }
  if (acwr <= ACWR_THRESHOLDS.optimalMax) return { key: 'optimal', label: 'Optimal', color: '#22c55e' }
  if (acwr <= ACWR_THRESHOLDS.highMax) return { key: 'high', label: 'High', color: '#f59e0b' }
  return { key: 'very_high', label: 'Very High', color: '#ef4444' }
}

// For clients that only have the server-reported interpretation key (e.g. from
// TrainingLoadResponse) and must render its label/color without re-banding the
// raw number themselves.
const ACWR_BAND_BY_KEY: Record<AcwrBand['key'], AcwrBand> = {
  low: acwrBand(0),
  optimal: acwrBand(1),
  high: acwrBand(1.4),
  very_high: acwrBand(2),
}
export function acwrBandByKey(key: AcwrBand['key']): AcwrBand {
  return ACWR_BAND_BY_KEY[key]
}

export interface MonotonyStrainResult {
  monotony: number | null
  strain: number | null
  weeklyLoadKg: number
}

// Training monotony (Foster) — mean-over-SD of daily load across the window.
// Low day-to-day variability (few rest days, near-identical load every day)
// inflates monotony and strain even at a moderate ACWR — a distinct
// injury-risk signal ACWR alone misses. `dailyLoadsKg` must be one entry per
// calendar day in the window (0 for rest days), not per session.
export function computeMonotonyStrain(dailyLoadsKg: number[]): MonotonyStrainResult {
  const n = dailyLoadsKg.length
  if (n === 0) return { monotony: null, strain: null, weeklyLoadKg: 0 }
  const weeklyLoadKg = dailyLoadsKg.reduce((a, b) => a + b, 0)
  const mean = weeklyLoadKg / n
  const variance = dailyLoadsKg.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n
  const sd = Math.sqrt(variance)
  if (sd === 0) return { monotony: null, strain: null, weeklyLoadKg }
  const monotony = mean / sd
  return { monotony, strain: weeklyLoadKg * monotony, weeklyLoadKg }
}
