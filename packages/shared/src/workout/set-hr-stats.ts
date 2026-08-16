// Per-SET HR metrics — the single formula for peak/avg HR during a set, the beat-drop during the rest
// that follows, and how long HR takes to return toward baseline under three "recovered" definitions.
// Persisted to set_hr_stats (migration 139) so per-set / per-exercise HR trends survive the 180d
// oura_heartrate prune. One Formula, One Place: the nearest-reading helper, the proxy-peak fallback,
// bpmAtLog, and the rest-adequacy heuristic come from analyseHrRecovery (lib/workout/hr-analysis.ts) —
// not re-implemented here. This module ADDS the rest-bounded drop curve (30/60/90/120s), the trough,
// the three time-to-recover models, and %HRR. NOTE: the persisted drop60s is REST-BOUNDED (null if the
// next set began first), which differs from the session summary's classic unbounded HRR1 (hrr1Best) —
// they coincide whenever the rest lasted ≥ 60s.
//
// IMPORTANT framing: the rest-adequacy signal is CARDIOVASCULAR recovery only. It says nothing about
// CNS / neuromuscular readiness — every surface that shows it must label it as such.
import { analyseHrRecovery, nearestBpm, type HrReading, type SetMarker } from './hr-analysis'

/** A logged set with the identity + prescription dimensions needed to snapshot and later trend it. */
export interface RichSetMarker {
  setLogId: string
  exerciseLogId: string | null
  exerciseId: string | null
  exerciseName: string
  setNumber: number
  phaseType: string | null
  intensityPct: number | null
  plannedPct: number | null
  plannedReps: number | null
  restTakenSec: number | null
  plannedRestSec: number | null
  setStartMs: number | null
  setEndMs: number | null
  loggedAt: Date | null
}

/** Canonical HR baseline (from resolveHrProfile) the recovery models anchor on. */
export interface HrBaseline {
  maxHr: number
  restingHr: number
}

/** One persisted per-set row — the shape written to set_hr_stats. */
export interface SetHrRow {
  setLogId: string
  exerciseLogId: string | null
  exerciseId: string | null
  exerciseName: string
  phaseType: string | null
  setNumber: number
  intensityPct: number | null
  plannedPct: number | null
  plannedReps: number | null
  restTakenSec: number | null
  plannedRestSec: number | null
  loggedAt: Date | null
  peakBpm: number | null
  avgBpm: number | null
  bpmAtEnd: number | null
  drop30s: number | null
  drop60s: number | null
  drop90s: number | null
  drop120s: number | null
  troughBpm: number | null
  secToPreset: number | null
  recoveredPreset: boolean | null
  secToResting: number | null
  recoveredResting: boolean | null
  pctHrrAtRestEnd: number | null
  secToHrr50: number | null
  restAdequate: boolean | null
  readingsCount: number
  coverageOk: boolean
  /** Which device measured this set: 'chest_strap' | 'oura_ble' | … , or 'mixed' when the working-set
   *  window spans more than one. Null when no reading in the window carried a source.
   *
   *  The column has existed since migration 139 and was never written — 582 production rows, all
   *  null — so a set's HR carried no provenance at all. That matters here more than most places:
   *  strap and ring differ in accuracy under load, and "were those sets ring-only?" is the first
   *  question asked of any suspect per-set HR. Same derivation as `summariseWorkoutHr`'s
   *  workout-level `source`, applied per set. */
  source: string | null
}

// Absolute cap on how far past a set's end we look for recovery when the next set's start is unknown
// (the last set of a workout, or a session logged without per-set timing). 5 minutes is longer than
// any normal inter-set rest, so a true recovery still lands; beyond it the "rest" isn't really rest.
const REST_SEARCH_CAP_MS = 300_000
// Tolerance for the drop-curve / rest-end point lookups — a sample within 30s of the target counts.
const NEAREST_TOL_MS = 30_000
// Below this many samples across the set+rest span, the derived metrics aren't trustworthy (ambient
// HR is thinned to ~1 sample / 30s; a real monitored set+rest at 1Hz has 100+).
const MIN_COVERAGE_SAMPLES = 5

function readingsInWindow(readings: HrReading[], fromMs: number, toMs: number): HrReading[] {
  return readings.filter(r => {
    const t = r.timestamp.getTime()
    return t >= fromMs && t <= toMs
  })
}

/** Seconds from `fromMs` to the first reading in (fromMs, toMs] with bpm ≤ threshold.
 *  `hadData` distinguishes "searched a populated window and never crossed" (censored →
 *  recovered=false) from "no readings to look at" (unknown → recovered=null). Readings are assumed
 *  sorted ascending by timestamp. */
function firstCrossingSec(
  readings: HrReading[], fromMs: number, toMs: number, threshold: number,
): { sec: number | null; hadData: boolean } {
  let hadData = false
  for (const r of readings) {
    const t = r.timestamp.getTime()
    if (t <= fromMs) continue
    if (t > toMs) break
    hadData = true
    if (r.bpm <= threshold) return { sec: Math.round((t - fromMs) / 1000), hadData: true }
  }
  return { sec: null, hadData }
}

/** Provenance for one set's working window. Mirrors `summariseWorkoutHr`: one distinct source wins,
 *  several become 'mixed', none stays null. Falls back to the whole reading set when the set has no
 *  usable window, so a set still reports the device it was measured on. */
function sourceOf(
  readings: (HrReading & { source?: string | null })[],
  startMs: number | null,
  endMs: number | null,
): string | null {
  const inWindow = startMs != null && endMs != null && endMs > startMs
    ? readings.filter(r => { const t = r.timestamp.getTime(); return t >= startMs && t <= endMs })
    : readings
  const sources = new Set(inWindow.map(r => r.source).filter((x): x is string => x != null))
  return sources.size === 0 ? null : sources.size > 1 ? 'mixed' : [...sources][0]
}

/** Compute per-set HR metrics for one workout. `readings` are the workout-window HR samples (sorted
 *  ascending); `sets` the logged sets; `baseline` the user's HR profile. Pure — never throws; any
 *  metric with insufficient data is null (with an explicit recovered_* flag where censoring matters). */
export function computeSetHrStats(
  readings: (HrReading & { source?: string | null })[],
  sets: RichSetMarker[],
  baseline: HrBaseline,
): SetHrRow[] {
  // Legacy per-set recovery (peak proxy, bpmAtLog, hrr1, adequate) — the single implementation, reused.
  const markers: SetMarker[] = sets.map(s => ({
    exerciseName: s.exerciseName,
    setNumber:    s.setNumber,
    loggedAt:     s.loggedAt,
    setStartMs:   s.setStartMs,
    setEndMs:     s.setEndMs,
  }))
  const legacy = analyseHrRecovery(readings, markers)

  // Chronological order gives each set its recovery horizon = the next set's start (a set's rest ends
  // when the next effort begins). Index into the original array so results map back 1:1.
  const startOf = (s: RichSetMarker) => s.setStartMs ?? s.loggedAt?.getTime() ?? Number.POSITIVE_INFINITY
  const order = sets.map((_, i) => i).sort((a, b) => startOf(sets[a]) - startOf(sets[b]))
  const nextStartByIndex = new Map<number, number | null>()
  for (let k = 0; k < order.length; k++) {
    const idx = order[k]
    const next = order[k + 1]
    const nextStart = next != null ? startOf(sets[next]) : null
    nextStartByIndex.set(idx, nextStart != null && Number.isFinite(nextStart) ? nextStart : null)
  }

  // %HRR here is recovery FROM the set's peak, so it anchors on peak−resting, not HRmax.
  const { restingHr } = baseline

  return sets.map((set, i): SetHrRow => {
    const leg = legacy[i]
    const endMs = set.setEndMs ?? set.loggedAt?.getTime() ?? null
    const startMs = set.setStartMs ?? null

    // Peak/avg over the TRUE working-set window when we have both bounds; else fall back to the
    // legacy proxy peak (90s pre-log) and leave avg null (no honest window to average over).
    let peakBpm = leg.peakBpm
    let avgBpm: number | null = null
    if (startMs != null && endMs != null && endMs > startMs) {
      const inSet = readingsInWindow(readings, startMs, endMs)
      if (inSet.length) {
        peakBpm = Math.max(...inSet.map(r => r.bpm))
        avgBpm = Math.round(inSet.reduce((a, r) => a + r.bpm, 0) / inSet.length)
      }
    }

    const bpmAtEnd = leg.bpmAtLog
    const nextStart = nextStartByIndex.get(i) ?? null

    // Empty defaults for a set we can't anchor a rest window on.
    const base = {
      setLogId: set.setLogId, exerciseLogId: set.exerciseLogId, exerciseId: set.exerciseId,
      exerciseName: set.exerciseName, phaseType: set.phaseType, setNumber: set.setNumber,
      intensityPct: set.intensityPct, plannedPct: set.plannedPct, plannedReps: set.plannedReps,
      restTakenSec: set.restTakenSec, plannedRestSec: set.plannedRestSec, loggedAt: set.loggedAt,
      peakBpm, avgBpm, bpmAtEnd,
      drop30s: null as number | null, drop60s: null as number | null, drop90s: null as number | null, drop120s: null as number | null,
      troughBpm: null as number | null,
      secToPreset: null as number | null, recoveredPreset: null as boolean | null,
      secToResting: null as number | null, recoveredResting: null as boolean | null,
      pctHrrAtRestEnd: null as number | null, secToHrr50: null as number | null,
      restAdequate: leg.adequate,
      readingsCount: 0, coverageOk: false,
      source: sourceOf(readings, startMs, endMs),
    }

    if (endMs == null) return base

    // Rest horizon: the next set's start, else end + (rest taken, capped) — bounded by the 5-min cap.
    const restBudgetMs = set.restTakenSec != null ? set.restTakenSec * 1000 : REST_SEARCH_CAP_MS
    const horizonEnd = Math.min(
      nextStart != null ? nextStart : Number.POSITIVE_INFINITY,
      endMs + Math.min(restBudgetMs, REST_SEARCH_CAP_MS),
    )

    const restReadings = readingsInWindow(readings, endMs, horizonEnd)
    const spanFrom = startMs ?? endMs
    const readingsCount = readingsInWindow(readings, spanFrom, horizonEnd).length
    const coverageOk = bpmAtEnd != null && readingsCount >= MIN_COVERAGE_SAMPLES

    // Drop curve — bpmAtEnd minus HR at +Ns, only if that point is still inside the rest window (a
    // reading taken once the next set has begun is under load, not recovery, so it can't score a drop).
    const dropAt = (offsetSec: number): number | null => {
      if (bpmAtEnd == null) return null
      const targetMs = endMs + offsetSec * 1000
      if (targetMs > horizonEnd) return null
      const b = nearestBpm(readings, new Date(targetMs), NEAREST_TOL_MS)
      return b != null ? bpmAtEnd - b : null
    }

    const troughBpm = restReadings.length ? Math.min(...restReadings.map(r => r.bpm)) : null

    // Recovery time — pre-set baseline = HR just before the set began.
    let secToPreset: number | null = null, recoveredPreset: boolean | null = null
    const preSetBpm = startMs != null ? nearestBpm(readings, new Date(startMs), 60_000) : null
    if (preSetBpm != null) {
      const { sec, hadData } = firstCrossingSec(readings, endMs, horizonEnd, preSetBpm)
      secToPreset = sec
      recoveredPreset = hadData ? sec != null : null
    }

    // Recovery time — return to the day's resting HR.
    let secToResting: number | null = null, recoveredResting: boolean | null = null
    {
      const { sec, hadData } = firstCrossingSec(readings, endMs, horizonEnd, restingHr)
      secToResting = sec
      recoveredResting = hadData ? sec != null : null
    }

    // %HRR recovered from peak by rest end, and time to cross 50% recovered (Karvonen reserve).
    let pctHrrAtRestEnd: number | null = null, secToHrr50: number | null = null
    const reserve = (peakBpm != null ? peakBpm : null) != null ? peakBpm! - restingHr : null
    if (reserve != null && reserve > 0) {
      const bpmAtRestEnd = restReadings.length
        ? nearestBpm(readings, new Date(horizonEnd), NEAREST_TOL_MS)
        : null
      if (bpmAtRestEnd != null) {
        const pct = ((peakBpm! - bpmAtRestEnd) / reserve) * 100
        pctHrrAtRestEnd = Math.max(0, Math.min(100, Math.round(pct)))
      }
      const hrr50Threshold = peakBpm! - 0.5 * reserve
      secToHrr50 = firstCrossingSec(readings, endMs, horizonEnd, hrr50Threshold).sec
    }

    return {
      ...base,
      drop30s: dropAt(30), drop60s: dropAt(60), drop90s: dropAt(90), drop120s: dropAt(120),
      troughBpm,
      secToPreset, recoveredPreset,
      secToResting, recoveredResting,
      pctHrrAtRestEnd, secToHrr50,
      readingsCount, coverageOk,
    }
  })
}
