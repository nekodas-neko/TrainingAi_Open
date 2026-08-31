import { classifyZone } from '@trainingai/shared/health/hr-zones'
import type { KindAggregate } from './segment-stats'

/**
 * The guided walk's live pacer (Q-410).
 *
 * The owner asked for a "walk faster" cue and, in the same breath, a "slow down" one for the slow
 * blocks — *"so pacer for speed/steps both ways"*. So a fast segment reads against a **floor** and a
 * slow segment against a **ceiling**, from one control and one bar; the direction is the only thing
 * that differs.
 *
 * Two decisions here are the reason this is a module rather than three expressions inside the
 * screen:
 *
 * 1. **The band is chosen by SIGNED distance from the target, so "the right direction" is never an
 *    error.** Twice the target on a fast set is the point of a fast set, and it stays green however
 *    far above. That is the owner's wording (*"slower than expected = green"* on a slow block) and
 *    it is not what an absolute-error band would do.
 * 2. **Which signal is pacing is a ladder — cadence → speed → heart rate — and it must be visible.**
 *    Cadence responds the instant the legs do; HR takes 30–60 s to catch up, so a prompt driven by
 *    it arrives after the moment it is about. But cadence is absent without a strap, so the ladder
 *    exists, and a user being paced by HR while believing it is cadence cannot understand why the
 *    prompt is late. Every reading below carries its unit and, off the top rung, a note saying so.
 */

export type PaceBand = 'green' | 'amber' | 'red' | 'stopped'
export type PacingSignal = 'cadence' | 'speed' | 'hr'
export type WorkKind = 'fast' | 'slow'

/** A fast floor and a slow ceiling, in whatever unit the signal is measured in. */
export interface TargetPair { fast: number; slow: number }

/**
 * How far outside the target still counts as *nearly*, as a fraction of the target.
 *
 * **A proposed starting value, not a measured one** — the owner's brief said "slightly out" without
 * a number. It lives here so a few real walks can move it in one place rather than in three
 * inlined expressions.
 */
export const BAND_TOLERANCE = 0.10

/**
 * Below this step rate the walk has stopped being a walk, and the pacer says so instead of scoring
 * it.
 *
 * Without this, standing still is *perfect* on a slow block: "under the ceiling" is green, and 0 spm
 * is very much under the ceiling. A stopped state is neutral rather than green — it does not scold a
 * pause at a crossing, and it does not congratulate one either.
 */
export const STOPPED_SPM = 40

/** The speed rung's equivalent of {@link STOPPED_SPM}, for the same reason. */
export const STOPPED_KMH = 1.5

/**
 * Fewest segments of a kind before that kind's historical pace may be used as a target.
 *
 * One recorded walk would otherwise set the bar for every walk after it, including a walk cut short
 * by a phone call.
 */
export const MIN_SEGMENTS_FOR_SPEED_TARGET = 3

/** What the pacer aims at when the config predates the cadence fields, or a user never set them. */
export const DEFAULT_CADENCE_TARGETS: TargetPair = { fast: 120, slow: 95 }

/**
 * Cadence targets off a persisted walk config.
 *
 * A config saved before these fields existed rehydrates without them, so neither may be read
 * directly — same hazard the `treadmill` flag's `=== true` checks guard against, one field wider.
 */
export function resolveCadenceTargets(
  cfg: { fastCadenceSpm?: number; slowCadenceSpm?: number } | null | undefined,
): TargetPair {
  const fast = cfg?.fastCadenceSpm
  const slow = cfg?.slowCadenceSpm
  return {
    fast: typeof fast === 'number' && fast > 0 ? fast : DEFAULT_CADENCE_TARGETS.fast,
    slow: typeof slow === 'number' && slow > 0 ? slow : DEFAULT_CADENCE_TARGETS.slow,
  }
}

/** km/h from a pace in seconds per kilometre. Null in, null out; a zero or negative pace is not a speed. */
export function kmhFromPace(secPerKm: number | null | undefined): number | null {
  if (secPerKm == null || secPerKm <= 0) return null
  return 3600 / secPerKm
}

/**
 * The speed rung's target pair, derived from the walker's own past fast/slow blocks rather than
 * asked for.
 *
 * `walk-config.tsx` already collects a cadence pair; asking for an HR pair, a cadence pair *and* a
 * speed pair would be three ways to state one intent. The history is already there —
 * `/api/guided-walk/segment-stats` aggregates `avgPaceSecPerKm` per kind across ~3 years of walks —
 * so the target is "your usual fast block", which is exactly the reference a mid-walk cue wants.
 *
 * Returns null rather than a half-pair whenever the history cannot support one, which drops the
 * ladder to heart rate: too few segments, no GPS-derived pace on either kind, or a degenerate pair
 * where the fast blocks were not actually faster than the slow ones.
 */
export function speedTargetsFromHistory(
  stats: { fast: KindAggregate; slow: KindAggregate } | null | undefined,
): TargetPair | null {
  if (!stats) return null
  const { fast, slow } = stats
  if (fast.count < MIN_SEGMENTS_FOR_SPEED_TARGET || slow.count < MIN_SEGMENTS_FOR_SPEED_TARGET) return null
  const fastKmh = kmhFromPace(fast.avgPaceSecPerKm)
  const slowKmh = kmhFromPace(slow.avgPaceSecPerKm)
  if (fastKmh == null || slowKmh == null) return null
  // Treadmill walks contribute heart rate but no pace, so a history of them leaves both averages
  // resting on a handful of outdoor blocks that may not separate. A pair that does not separate
  // cannot pace anything.
  if (fastKmh <= slowKmh) return null
  return { fast: fastKmh, slow: slowKmh }
}

/**
 * Which band a value falls in against its kind's target.
 *
 * The green/not-green threshold is `classifyZone`'s, called rather than restated — this adds the
 * amber ring around it and nothing else, so there is still one definition of "meeting the target".
 */
export function bandFor(
  value: number,
  kind: WorkKind,
  targets: TargetPair,
  tolerance: number = BAND_TOLERANCE,
): Exclude<PaceBand, 'stopped'> {
  if (classifyZone(value, kind, targets) === 'in') return 'green'
  if (kind === 'fast') return value >= targets.fast * (1 - tolerance) ? 'amber' : 'red'
  return value <= targets.slow * (1 + tolerance) ? 'amber' : 'red'
}

export interface PacerReading {
  signal: PacingSignal
  band: PaceBand
  /** Always rendered beside the colour — a coloured bar carrying no mark and no words is a contrast
   *  failure for anyone who cannot separate the hues, and this app forbids it outright. */
  mark: string
  message: string
  /** The value's fill against its target, clamped to 0..1, for the bar. */
  progress: number
  /** Why this rung and not the one above it. Null on cadence, the top rung. */
  fallbackNote: string | null
}

export interface PacerInput {
  kind: WorkKind
  cadenceSpm: number | null
  speedKmh: number | null
  bpm: number | null
  cadenceTargets: TargetPair
  speedTargets: TargetPair | null
  hrTargets: TargetPair
}

const FALLBACK_NOTE: Record<PacingSignal, string | null> = {
  cadence: null,
  speed: 'No cadence source — pacing by speed. Wear the strap for step pacing.',
  hr: 'No cadence or GPS — pacing by heart rate. Wear the strap for step pacing.',
}

function format(signal: PacingSignal, value: number): string {
  if (signal === 'cadence') return `${Math.round(value)} spm`
  if (signal === 'hr') return `${Math.round(value)} bpm`
  return `${value.toFixed(1)} km/h`
}

function unitTarget(signal: PacingSignal, kind: WorkKind, targets: TargetPair): string {
  const t = kind === 'fast' ? targets.fast : targets.slow
  const arrow = kind === 'fast' ? '≥' : '≤'
  return `${arrow}${format(signal, t)}`
}

function stoppedFloor(signal: PacingSignal): number | null {
  if (signal === 'cadence') return STOPPED_SPM
  if (signal === 'speed') return STOPPED_KMH
  // Heart rate has no stopped state: a resting pulse is a real reading, not an absent one, and a
  // walker standing still still has one. The pathology this guards against — stopping scoring
  // perfect on a slow block — is a movement-signal problem.
  return null
}

/**
 * The one reading the screen renders: which signal is pacing, how it is doing, and what to change.
 *
 * Null only when no rung has a live value at all — a treadmill walk with no strap and no chest
 * strap, where there is genuinely nothing to say.
 */
export function readPacer(input: PacerInput): PacerReading | null {
  const { kind } = input
  let signal: PacingSignal
  let value: number
  let targets: TargetPair

  if (input.cadenceSpm != null) {
    signal = 'cadence'; value = input.cadenceSpm; targets = input.cadenceTargets
  } else if (input.speedKmh != null && input.speedTargets != null) {
    signal = 'speed'; value = input.speedKmh; targets = input.speedTargets
  } else if (input.bpm != null) {
    signal = 'hr'; value = input.bpm; targets = input.hrTargets
  } else {
    return null
  }

  const fallbackNote = FALLBACK_NOTE[signal]
  const floor = stoppedFloor(signal)
  if (floor != null && value < floor) {
    return { signal, band: 'stopped', mark: '•', message: 'Stopped — start walking', progress: 0, fallbackNote }
  }

  const band = bandFor(value, kind, targets)
  const target = kind === 'fast' ? targets.fast : targets.slow
  const aim = unitTarget(signal, kind, targets)
  const progress = target > 0 ? Math.min(1, Math.max(0, value / target)) : 0

  const message = band === 'green' ? `On pace — ${aim}`
    : kind === 'fast'
      ? (band === 'amber' ? `Walk faster — aim ${aim}` : `Well under — aim ${aim}`)
      : (band === 'amber' ? `Ease off — aim ${aim}` : `Way over — ease off to ${aim}`)
  const mark = band === 'green' ? '✓' : kind === 'fast' ? '▲' : '▼'

  return { signal, band, mark, message, progress, fallbackNote }
}

/** Theme token for a band. Paired with {@link PacerReading.mark} at every call site, never alone. */
export function bandColor(band: PaceBand): string {
  if (band === 'green') return 'var(--color-brand)'
  if (band === 'amber') return 'var(--accent-amber)'
  if (band === 'red') return 'var(--color-destructive)'
  return 'var(--color-muted-foreground)'
}
