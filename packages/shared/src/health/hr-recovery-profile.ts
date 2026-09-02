// Peak-HR-band recovery aggregation (plan 2026-07-22-hr-recovery-profile.md, HRP-1). Buckets
// recovery episodes by the HR being recovered FROM and reports a median recovery rate per band —
// an intensity-normalised, cross-modal fitness signal ("from 150 bpm you shed ~X bpm/min"), distinct
// from the per-exercise Heart & Recovery card (which only compares sets of the SAME lift).
//
// **HRP-2 IS BUILT — this module is no longer strength-only, and the comment that said so cost
// Q-516 its conclusion.** `hr-episode-detection.ts` detects workout cool-downs from completed
// workouts + oura_heartrate and feeds them in as `run_cooldown` episodes, so the profile pools
// lifting rests AND cardio. Any claim about "the range this feature sees" measured over
// set_hr_stats alone is a claim about half of it. One Formula, One Place: episode-level math (drop
// curve, secToResting, recoveredResting) is NOT re-derived here — it comes from set-hr-stats.ts via
// the already-persisted set_hr_stats columns. This module only buckets + aggregates.
//
// CAVEAT (spec §6, load-bearing — surface in any UI): recovery rate depends on what you're doing
// during the rest (standing between sets vs. walking a cool-down) — cross-modal comparison is only
// safe once posture/source is held constant or explicitly labelled. **This DOES bite now**: cool-down
// episodes are mixed in, and they are the only ones reaching the top bands, so a top-band figure is
// a cardio figure. `bySource` on every band is what makes that visible; render it.
import { median } from './daily-medians'

export interface PeakBand {
  label: string
  min: number
  /** Exclusive upper bound; Infinity for the top band. */
  max: number
}

// Bands sized to the range these episodes actually reach (Q-516). The spec's original five —
// `<110 · 110–129 · 130–149 · 150–169 · 170+` — were justified as giving "stable per-bucket sample
// sizes", which is an empirical claim, and it was wrong at the bottom: `<110` sat at the p75 of
// strength peaks and held 75% of the data in the bucket the UI dims.
//
// **The `<110` boundary cut through the MIDDLE of the informative range.** Measured over 312 covered
// `set_hr_stats` episodes, the mean 60-second drop is **−3.5** under 90 and **5.1** at 90–104 —
// genuinely noise — against **12.2** at 105–119. So 42 episodes peaking 105–109 and shedding
// **11.5 bpm** in their first minute were dimmed as noise. Splitting the old bottom band at 90 and
// 105 is what this fixes; two of the three bottom bands stay marked low-signal, because they are.
//
// **The top bands stay, and Q-516's own proposal to collapse them into `120+` must not be shipped.**
// That measurement was taken over `set_hr_stats` alone — strength only, max 132 — while this profile
// ALSO ingests workout cool-downs (`hr-episode-detection.ts`, source `run_cooldown`), which reach
// **168**. Of 13 cardio workouts carrying HR, 2 peak at ≥130 and 1 at ≥150, so `130–149` and
// `150–169` are reachable, not unreachable; collapsing them would put a 168 bpm cool-down in the
// same bucket as a 120 bpm lifting rest and destroy the cross-modal comparison this module exists
// for. Only `170+` was genuinely empty across BOTH sources, and only it is removed.
//
// **Read `LOW_SIGNAL_MAX_BPM` before adding a band.** The bands and the low-signal rule are one
// decision, and expressing "the low ones are noise" as a single label match is what made the old
// version brittle. `lib/ai-chat/tools.ts` names these labels in a tool description — update it too.
export const PEAK_BANDS: PeakBand[] = [
  { label: '<90', min: 0, max: 90 },
  { label: '90–104', min: 90, max: 105 },
  { label: '105–119', min: 105, max: 120 },
  { label: '120–149', min: 120, max: 150 },
  { label: '150+', min: 150, max: Infinity },
]

// At or below this peak, recovery is near-meaningless (barely elevated HR) and mostly measurement
// noise — callers de-emphasise those bands rather than surface them with the same weight (spec §6).
// 105 is where the measured 60-second drop roughly doubles; see the band comment above.
export const LOW_SIGNAL_MAX_BPM = 105

/** Whether a band sits entirely inside the range where recovery carries no signal. A threshold, not
 *  a label match — with five bands "the low ones" is no longer expressible as one string. */
export function isLowSignalBand(band: PeakBand): boolean {
  return band.max <= LOW_SIGNAL_MAX_BPM
}

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
  /**
   * Episodes peaking above `LOW_SIGNAL_MAX_BPM`, as a share of all banded episodes — the fraction of
   * this profile that carries signal at all.
   *
   * Surfaced because the honest version of Q-516 is not the re-banding: it is saying out loud that
   * HR recovery informs a MINORITY of lifting sets (39% of the owner's covered episodes). Four
   * populated buckets look like a working feature whether or not they are, and a caller that renders
   * them without this number is the failure mode the entry named.
   */
  informativeShare: number | null
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
        lowSignal: isLowSignalBand(b),
        bySource,
      }
    })
    .filter((b): b is BandSummary => b != null)

  const banded = bands.reduce((sum, b) => sum + b.n, 0)
  const informative = bands.filter(b => !b.lowSignal).reduce((sum, b) => sum + b.n, 0)
  return {
    bands,
    totalEpisodes: episodes.length,
    informativeShare: banded > 0 ? Math.round((informative / banded) * 100) / 100 : null,
  }
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
