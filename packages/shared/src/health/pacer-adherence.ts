/**
 * How well a guided-walk segment met the pacer's target (LA-48, issue 2242).
 *
 * The pacer (`lib/walk/walk-pacer.ts`) shows the walker one band about once a second. This is the
 * ONE place those shown bands become a stored number, so a segment's adherence cannot be derived
 * two ways. The counts are what the walker was actually shown: they are accumulated live and never
 * reconstructed from the 10 s binned cadence series, which bands differently either side of a
 * target (a bin median versus the instantaneous reading).
 */

export type PacerBand = 'green' | 'amber' | 'red' | 'stopped'
export type PacerSignal = 'cadence' | 'speed' | 'hr'

/** Seconds the walker was shown each band. One tick is one second of pacer display. */
export interface PacerBandCounts { green: number; amber: number; red: number; stopped: number }

export const PACER_SIGNALS: readonly PacerSignal[] = ['cadence', 'speed', 'hr']

/** The live tally for one segment: band counts per signal, because the ladder can change rung. */
export type PacerSegmentTally = Partial<Record<PacerSignal, PacerBandCounts>>

/** What a stored segment carries. All three are absent on a segment with no pacer reading. */
export interface PacerSegmentSummary {
  pacerSignal: PacerSignal
  pacerAdherence: number | null
  pacerTicks: PacerBandCounts
}

export function emptyBandCounts(): PacerBandCounts {
  return { green: 0, amber: 0, red: 0, stopped: 0 }
}

/**
 * Adherence is in-band ticks over ticks in which a target was being judged.
 *
 * `stopped` is left out of the denominator: the pacer calls a pause neutral, neither scolding nor
 * praising it, so it counts neither for nor against. It stays in the stored counts so the choice
 * can be revisited. Null, never 0, when nothing was judged: no readings is not zero adherence.
 */
export function pacerAdherence(counts: PacerBandCounts): number | null {
  const judged = counts.green + counts.amber + counts.red
  if (judged <= 0) return null
  return Math.round((counts.green / judged) * 1000) / 1000
}

/**
 * Summarises one segment's tally. Null when the pacer never showed a reading in it (warm-up,
 * cool-down, or a walk with no signal), so the stored field is absent rather than a false zero.
 *
 * The signal is the one that showed for the most ticks; the counts are summed across signals.
 */
export function summarisePacerTally(tally: PacerSegmentTally | null | undefined): PacerSegmentSummary | null {
  if (!tally) return null
  const total = emptyBandCounts()
  let signal: PacerSignal | null = null
  let best = 0
  for (const s of PACER_SIGNALS) {
    const c = tally[s]
    if (!c) continue
    const n = c.green + c.amber + c.red + c.stopped
    total.green += c.green; total.amber += c.amber; total.red += c.red; total.stopped += c.stopped
    if (n > best) { best = n; signal = s }
  }
  if (signal == null) return null
  return { pacerSignal: signal, pacerAdherence: pacerAdherence(total), pacerTicks: total }
}

/** Adds one shown tick to a tally, returning a new tally. */
export function addPacerTick(
  tally: PacerSegmentTally | undefined,
  signal: PacerSignal,
  band: PacerBand,
): PacerSegmentTally {
  const prev = tally?.[signal] ?? emptyBandCounts()
  return { ...tally, [signal]: { ...prev, [band]: prev[band] + 1 } }
}
