// Transforms Oura's sleep_phase_5_min string ('1'=deep '2'=light '3'=REM '4'=awake,
// one char per 5 minutes) into merged, timed segments for a stepped hypnogram.
export type SleepStage = 'deep' | 'light' | 'rem' | 'awake'
export interface HypnogramSegment { stage: SleepStage; startMin: number; durationMin: number }

const STAGE_BY_CODE: Record<string, SleepStage> = { '1': 'deep', '2': 'light', '3': 'rem', '4': 'awake' }
const INTERVAL_MIN = 5

// Vertical order for the stepped band: awake on top, deep at the bottom.
export const STAGE_LEVEL: Record<SleepStage, number> = { awake: 0, rem: 1, light: 2, deep: 3 }

// Canonical sleep-stage palette (One Formula, One Place) — every UI surface showing sleep
// stages imports this instead of re-declaring its own colours.
export const STAGE_COLOR: Record<SleepStage, string> = {
  deep: '#1e3a70', light: '#3f7dc9', rem: '#7ec3ea', awake: '#e9d9c8',
}

export function hypnogramSegments(phase5Min: string): HypnogramSegment[] {
  const segments: HypnogramSegment[] = []
  for (let i = 0; i < phase5Min.length; i++) {
    const stage = STAGE_BY_CODE[phase5Min[i]]
    if (!stage) continue
    const startMin = i * INTERVAL_MIN
    const last = segments[segments.length - 1]
    if (last && last.stage === stage && last.startMin + last.durationMin === startMin) {
      last.durationMin += INTERVAL_MIN
    } else {
      segments.push({ stage, startMin, durationMin: INTERVAL_MIN })
    }
  }
  return segments
}

export type StageTotals = Record<SleepStage, number>

export function stageTotals(segments: HypnogramSegment[]): StageTotals {
  const totals: StageTotals = { deep: 0, light: 0, rem: 0, awake: 0 }
  for (const s of segments) totals[s.stage] += s.durationMin
  return totals
}

const CODE_BY_STAGE: Record<SleepStage, string> = { deep: '1', light: '2', rem: '3', awake: '4' }
// Tie-break when a 5-min bucket splits evenly: prefer the deeper / more-notable stage.
const STAGE_TIEBREAK: SleepStage[] = ['deep', 'rem', 'light', 'awake']
const CODES_PER_5MIN = 10 // the ring emits 30-second stage codes → 10 per 5-min bucket

// Maps a per-5-min stage array (our own stager's output — one entry per 5-min epoch)
// straight to the `sleep_phase_5_min` string. Unknown/absent stages become awake ('4').
export function stagesToPhase5Min(stages: readonly SleepStage[]): string {
  return stages.map(s => CODE_BY_STAGE[s] ?? '4').join('')
}

// Downsamples the ring's 30-second hypnogram codes (from decodeSleepPhases' `phases`
// array) into the 5-min `sleep_phase_5_min` string the rest of the app reads. Each
// output char is the majority stage over its 10-code (5-min) bucket. Unknown codes are
// ignored; an all-unknown bucket emits nothing. Pure + deterministic — see the BLE
// rollup for where the 30-second/single-tag assumption is (provisionally) applied.
export function phasesToPhase5Min(phases: readonly string[]): string {
  let out = ''
  for (let i = 0; i < phases.length; i += CODES_PER_5MIN) {
    const counts: Record<SleepStage, number> = { deep: 0, light: 0, rem: 0, awake: 0 }
    let any = false
    for (let j = i; j < Math.min(i + CODES_PER_5MIN, phases.length); j++) {
      const p = phases[j]
      if (p === 'deep' || p === 'light' || p === 'rem' || p === 'awake') { counts[p]++; any = true }
    }
    if (!any) continue
    let best: SleepStage = STAGE_TIEBREAK[0]
    for (const stage of STAGE_TIEBREAK) if (counts[stage] > counts[best]) best = stage
    out += CODE_BY_STAGE[best]
  }
  return out
}

/** A wall-clock stage interval. `stage` is null for a span the provider could not stage
 *  (Health Connect's generic SLEEPING / UNKNOWN) — carried through rather than dropped so
 *  the rasteriser can tell "unstaged" apart from "not covered". */
export interface StageInterval { startMs: number; endMs: number; stage: SleepStage | null }

/**
 * Rasterises wall-clock stage intervals onto the 5-min grid the `sleep_phase_5_min` string
 * encodes, anchored at `sleepStartMs`. Each bucket takes the stage with the most overlap.
 *
 * Returns null unless EVERY bucket in [sleepStartMs, sleepEndMs) is covered by at least one
 * staged interval. The encoding is positional — index i is minutes i*5 to i*5+5 — so a gap
 * cannot be skipped without shifting the whole night, and it has no code for "unstaged", so
 * a gap cannot be filled without inventing a stage. A provider that only reports generic
 * sleep therefore gets no hypnogram at all, and the caller keeps its four honest stage
 * totals instead. Half a hypnogram reads as fact and is worse than no hypnogram.
 */
export function intervalsToPhase5Min(
  intervals: readonly StageInterval[],
  sleepStartMs: number,
  sleepEndMs: number,
): string | null {
  if (!intervals.length || !(sleepEndMs > sleepStartMs)) return null
  const bucketMs = INTERVAL_MIN * 60_000
  let out = ''
  for (let start = sleepStartMs; start < sleepEndMs; start += bucketMs) {
    const end = Math.min(start + bucketMs, sleepEndMs)
    const counts: Record<SleepStage, number> = { deep: 0, light: 0, rem: 0, awake: 0 }
    let covered = 0
    for (const iv of intervals) {
      if (iv.stage == null) continue
      const overlap = Math.min(end, iv.endMs) - Math.max(start, iv.startMs)
      if (overlap <= 0) continue
      counts[iv.stage] += overlap
      covered += overlap
    }
    if (covered <= 0) return null
    let best: SleepStage = STAGE_TIEBREAK[0]
    for (const stage of STAGE_TIEBREAK) if (counts[stage] > counts[best]) best = stage
    out += CODE_BY_STAGE[best]
  }
  return out || null
}

export interface SleepCycles { count: number; boundaries: number[] }

// Oura's v2 API exposes no official cycle boundaries — these are estimated from
// the 5-min phases using the standard heuristic (a new cycle begins at each
// REM -> deep/light descent) and should be labeled as approximate in the UI.
export function sleepCycles(segments: HypnogramSegment[]): SleepCycles {
  const boundaries: number[] = []
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1]
    const cur = segments[i]
    if (prev.stage === 'rem' && (cur.stage === 'deep' || cur.stage === 'light')) {
      boundaries.push(cur.startMin)
    }
  }
  return { count: segments.length === 0 ? 0 : boundaries.length + 1, boundaries }
}
