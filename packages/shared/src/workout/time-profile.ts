// Measured per-set time profiles from logged history ("time based on sets + pct",
// owner request 2026-07-10; spec 2026-07-07-extended-metrics §B3). Read-time
// derivation only — nothing stored (Stored Counters rule). Work time scales with
// reps (measured sec/rep, pooled per exercise); rest scales with effort (%1RM
// band). intensity_pct is the session-estimate basis (spec §B5.1) — the 10-wide
// bands absorb that drift, so do not switch the divisor here.

import { SET_SETUP_SEC } from '@trainingai/shared/workout/duration-model'
import { robustStats } from '@trainingai/shared/workout/time-audit'

export const PCT_BANDS = ['light', 'moderate', 'heavy', 'max'] as const
export type PctBand = (typeof PCT_BANDS)[number]

export function pctBand(pct: number): PctBand {
  if (pct < 70) return 'light'
  if (pct < 80) return 'moderate'
  if (pct < 90) return 'heavy'
  return 'max'
}

// A measured median is only trusted once this many outlier-excluded sets back it
// (owner-chosen). A phase's working band accumulates this within ~2-3 sessions, so
// estimates calibrate mid-phase and revert to defaults when a new phase moves the pct.
export const MIN_PROFILE_SAMPLES = 10

export interface TimingRow {
  exerciseName: string
  reps: number
  setTimeSec: number | null
  restTimeSec: number | null
  intensityPct: number | null
}

export interface ExerciseTimeProfile {
  // Measured tempo: median of (setTimeSec − SET_SETUP_SEC) / reps, null under the gate.
  secPerRep: number | null
  secPerRepSamples: number
  restSecByBand: Record<PctBand, number | null>
  restSamplesByBand: Record<PctBand, number>
  // All rest samples pooled (including null-pct rows) — the band's fallback.
  restSecOverall: number | null
  restSamplesOverall: number
}

function gatedMedian(values: number[]): { median: number | null; samples: number } {
  const stats = robustStats(values)
  return {
    median: stats.count >= MIN_PROFILE_SAMPLES ? stats.median : null,
    samples: stats.count,
  }
}

export function buildTimeProfiles(rows: TimingRow[]): Record<string, ExerciseTimeProfile> {
  const byName = new Map<string, TimingRow[]>()
  for (const r of rows) {
    const arr = byName.get(r.exerciseName) ?? []
    arr.push(r)
    byName.set(r.exerciseName, arr)
  }

  const out: Record<string, ExerciseTimeProfile> = {}
  for (const [name, exRows] of byName) {
    const perRepValues = exRows
      .filter(r => r.setTimeSec != null && r.setTimeSec > 0 && r.reps > 0)
      .map(r => Math.max(1, (r.setTimeSec! - SET_SETUP_SEC) / r.reps))
    const perRep = gatedMedian(perRepValues)

    const restRows = exRows.filter(r => r.restTimeSec != null && r.restTimeSec > 0)
    const restSecByBand = {} as Record<PctBand, number | null>
    const restSamplesByBand = {} as Record<PctBand, number>
    for (const band of PCT_BANDS) {
      const banded = gatedMedian(
        restRows.filter(r => r.intensityPct != null && pctBand(r.intensityPct) === band)
          .map(r => r.restTimeSec!),
      )
      restSecByBand[band] = banded.median
      restSamplesByBand[band] = banded.samples
    }
    const overall = gatedMedian(restRows.map(r => r.restTimeSec!))

    out[name] = {
      secPerRep: perRep.median,
      secPerRepSamples: perRep.samples,
      restSecByBand,
      restSamplesByBand,
      restSecOverall: overall.median,
      restSamplesOverall: overall.samples,
    }
  }
  return out
}

// Fallback ladder: prescribed-pct band median → exercise-overall median → null
// (caller falls back to the planned/prescribed restSec).
export function resolveMeasuredRestSec(profile: ExerciseTimeProfile | null, pct: number): number | null {
  if (!profile) return null
  return profile.restSecByBand[pctBand(pct)] ?? profile.restSecOverall
}
