// Peak-HR-band recovery aggregation (plan 2026-07-22-hr-recovery-profile.md, HRP-1). Buckets
// recovery episodes by the HR being recovered FROM and reports a median recovery rate per band —
// an intensity-normalised, cross-modal fitness signal ("from 150 bpm you shed ~X bpm/min"), distinct
// from the per-exercise Heart & Recovery card (which only compares sets of the SAME lift).
//
// Phase 1 seeds exclusively from the durable set_hr_stats rows (between-set rests during workouts) —
// zero new detection. Later phases (HRP-2) add run/interval episodes via the same RecoveryEpisode
// shape, detected directly from oura_heartrate. One Formula, One Place: episode-level math (drop
// curve, secToResting, recoveredResting) is NOT re-derived here — it comes from set-hr-stats.ts via
// the already-persisted set_hr_stats columns. This module only buckets + aggregates.
//
// CAVEAT (spec §6, load-bearing — surface in any UI): recovery rate depends on what you're doing
// during the rest (standing between sets vs. walking a cool-down) — cross-modal comparison is only
// safe once posture/source is held constant or explicitly labelled. Phase 1 is ALL set_rest (standing
// between-set rests), so this doesn't yet bite — it matters once HRP-2 mixes in run cool-downs.
import { median } from './daily-medians'

export interface PeakBand {
  label: string
  min: number
  /** Exclusive upper bound; Infinity for the top band. */
  max: number
}

// Bands, not exact bpm, for stable per-bucket sample sizes (spec §3).
export const PEAK_BANDS: PeakBand[] = [
  { label: '<110', min: 0, max: 110 },
  { label: '110–129', min: 110, max: 130 },
  { label: '130–149', min: 130, max: 150 },
  { label: '150–169', min: 150, max: 170 },
  { label: '170+', min: 170, max: Infinity },
]

// Below this peak, recovery is near-meaningless (barely elevated HR) and mostly measurement noise —
// callers should de-emphasise this band rather than surface it with the same weight (spec §6).
export const LOW_SIGNAL_BAND_LABEL = '<110'

export function bandForPeak(peakBpm: number): PeakBand | null {
  return PEAK_BANDS.find(b => peakBpm >= b.min && peakBpm < b.max) ?? null
}

/** A source-agnostic recovery episode. Phase 1 episodes are all normalised from set_hr_stats rows
 *  (`episodeFromSetHrStats`); HRP-2 will detect `run_cooldown`/`interval`/`ambient` episodes directly
 *  from oura_heartrate and feed them into the same aggregator. */
export interface RecoveryEpisode {
  peakBpm: number
  loggedAt: Date | null
  source: 'set_rest' | 'run_cooldown' | 'interval' | 'ambient'
  drop30s: number | null
  drop60s: number | null
  drop90s: number | null
  drop120s: number | null
  secToResting: number | null
  recoveredResting: boolean | null
}

/** Recovery rate in bpm/min, from the LARGEST available drop point (most decline observed = least
 *  sensitive to a single noisy early reading). Null if no drop point is available. */
export function recoveryRateBpmPerMin(ep: RecoveryEpisode): number | null {
  const points: [number, number | null][] = [
    [120, ep.drop120s], [90, ep.drop90s], [60, ep.drop60s], [30, ep.drop30s],
  ]
  for (const [sec, drop] of points) {
    if (drop != null) return (drop / sec) * 60
  }
  return null
}

export interface BandSummary {
  label: string
  n: number
  /** Median recovery rate across episodes in this band, bpm/min. Null if no episode had a drop point. */
  medianRateBpmMin: number | null
  /** Median seconds to reach the day's resting HR (censored episodes excluded — see recoveredPct). */
  medianSecToResting: number | null
  /** % of episodes (with a known outcome) that reached resting HR within the rest actually taken. */
  recoveredPct: number | null
  lowSignal: boolean
  /** Episode count by source. Surfaced so a band mixing sources (e.g. lifting rests + run
   *  cool-downs) is visible rather than silently averaged together — different activities recover
   *  at different rates even at the same peak HR (spec §6's single biggest confound). Only ever has
   *  one key while Phase 1's set_rest is the sole source; gains entries as later phases add sources. */
  bySource: Partial<Record<RecoveryEpisode['source'], number>>
}

export interface HrRecoveryProfile {
  bands: BandSummary[]
  totalEpisodes: number
}

/** Aggregate episodes into per-band medians. Bands with zero episodes are omitted entirely (never a
 *  fabricated 0). Median, not mean, per the existing HRR-trend convention (lib/workout/hrr-trend.ts)
 *  — one anomalous episode can't skew a band. */
export function aggregateHrRecoveryProfile(episodes: RecoveryEpisode[]): HrRecoveryProfile {
  const byBand = new Map<string, RecoveryEpisode[]>()
  for (const ep of episodes) {
    const band = bandForPeak(ep.peakBpm)
    if (!band) continue
    const arr = byBand.get(band.label) ?? []
    arr.push(ep)
    byBand.set(band.label, arr)
  }

  const bands: BandSummary[] = PEAK_BANDS
    .map((b): BandSummary | null => {
      const eps = byBand.get(b.label)
      if (!eps || eps.length === 0) return null

      const rates = eps.map(recoveryRateBpmPerMin).filter((r): r is number => r != null)
      const medianRate = median(rates)

      const secs = eps.map(e => e.secToResting).filter((s): s is number => s != null)
      const medianSec = median(secs)

      const outcomes = eps.map(e => e.recoveredResting).filter((r): r is boolean => r != null)

      const bySource: BandSummary['bySource'] = {}
      for (const e of eps) bySource[e.source] = (bySource[e.source] ?? 0) + 1

      return {
        label: b.label,
        n: eps.length,
        medianRateBpmMin: medianRate != null ? Math.round(medianRate * 10) / 10 : null,
        medianSecToResting: medianSec != null ? Math.round(medianSec) : null,
        recoveredPct: outcomes.length ? Math.round((outcomes.filter(Boolean).length / outcomes.length) * 100) : null,
        lowSignal: b.label === LOW_SIGNAL_BAND_LABEL,
        bySource,
      }
    })
    .filter((b): b is BandSummary => b != null)

  return { bands, totalEpisodes: episodes.length }
}

/** Normalise a durable per-set HR row (set_hr_stats) into a recovery episode — Phase 1's only
 *  source. Sets with no covered peak (never had trustworthy HR) don't become episodes. */
export function episodeFromSetHrStats(row: {
  peakBpm: number | null
  loggedAt: Date | null
  drop30s: number | null
  drop60s: number | null
  drop90s: number | null
  drop120s: number | null
  secToResting: number | null
  recoveredResting: boolean | null
}): RecoveryEpisode | null {
  if (row.peakBpm == null) return null
  return {
    peakBpm: row.peakBpm,
    loggedAt: row.loggedAt,
    source: 'set_rest',
    drop30s: row.drop30s, drop60s: row.drop60s, drop90s: row.drop90s, drop120s: row.drop120s,
    secToResting: row.secToResting, recoveredResting: row.recoveredResting,
  }
}
