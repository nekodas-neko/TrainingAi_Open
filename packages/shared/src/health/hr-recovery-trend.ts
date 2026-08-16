// Month-over-month HR Recovery Profile trend (HRP-3, plan 2026-07-22-hr-recovery-profile.md). Rolls
// the same recovery episodes the current-snapshot aggregator consumes (aggregateHrRecoveryProfile)
// up to one median rate per (peak-HR band, calendar month) — "is my recovery from 160 bpm getting
// faster over the last few months." Derive-on-read, never persisted (mirrors hrr-trend.ts's rollup
// shape). Median, not mean, per the same convention — one anomalous episode can't skew a period.
import { formatInTimeZone } from 'date-fns-tz'
import { median } from './daily-medians'
import { bandForPeak, recoveryRateBpmPerMin, LOW_SIGNAL_BAND_LABEL, type RecoveryEpisode } from './hr-recovery-profile'

export interface BandTrendPoint {
  /** Local calendar month, 'yyyy-MM'. */
  period: string
  medianRateBpmMin: number | null
  n: number
}

export interface BandTrend {
  label: string
  points: BandTrendPoint[]
}

/** Aggregate episodes into one median recovery-rate point per (band, local month), oldest month
 *  first. Bands are omitted entirely if no episode has a usable rate; the low-signal band (`<110`)
 *  is always omitted — a noise trend isn't worth showing. Episodes with no `loggedAt` are skipped
 *  (can't be placed on a timeline). `tz` is the caller's session timezone — months are local, not
 *  UTC, so a late-night episode lands in the correct month for the user. */
export function aggregateHrRecoveryTrend(episodes: RecoveryEpisode[], tz: string): BandTrend[] {
  // (band label, period) -> rates observed
  const byBandPeriod = new Map<string, Map<string, number[]>>()

  for (const ep of episodes) {
    if (ep.loggedAt == null) continue
    const band = bandForPeak(ep.peakBpm)
    if (!band || band.label === LOW_SIGNAL_BAND_LABEL) continue
    const rate = recoveryRateBpmPerMin(ep)
    if (rate == null) continue

    const period = formatInTimeZone(ep.loggedAt, tz, 'yyyy-MM')
    const byPeriod = byBandPeriod.get(band.label) ?? new Map<string, number[]>()
    const rates = byPeriod.get(period) ?? []
    rates.push(rate)
    byPeriod.set(period, rates)
    byBandPeriod.set(band.label, byPeriod)
  }

  const trends: BandTrend[] = []
  for (const [label, byPeriod] of byBandPeriod) {
    const points: BandTrendPoint[] = [...byPeriod.entries()]
      .map(([period, rates]): BandTrendPoint => {
        const m = median(rates)
        return { period, medianRateBpmMin: m != null ? Math.round(m * 10) / 10 : null, n: rates.length }
      })
      .sort((a, b) => a.period.localeCompare(b.period))
    trends.push({ label, points })
  }

  return trends
}
