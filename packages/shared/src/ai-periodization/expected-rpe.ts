import { repFactor } from '@trainingai/shared/1rm'

// Reps-aware expected RPE, used by RPE autoregulation.
//
// RPE depends on BOTH the load and the reps performed — 70% for 3 reps is easy, 70% for 12
// reps is near-failure. The old %-only bucket model couldn't tell those apart. Here we invert
// the 1RM formula: at a given %1RM the reps-to-failure is `maxRepsAtPct`, so the reps-in-reserve
// on a set is `maxReps − reps` and the expected RPE is `10 − RIR`.
//
// This ties directly to the same `repFactor` curve the 1RM math uses, so the two stay
// consistent, and it makes an AMRAP set (reps ≈ maxReps) expect an RPE near 10 — which is why
// a hard last set produces a delta ≈ 0 rather than a false "too hard" flag.

// Reps to failure at a given %1RM — the inverse of repFactor. repFactor is monotonic in reps,
// so we scan integer reps and linearly interpolate for a smooth (fractional) result.
export function maxRepsAtPct(pct: number): number {
  if (pct >= 100) return 1
  if (pct <= 0) return 30
  const target = 100 / pct // = repFactor(reps) at failure
  let prev = repFactor(1)
  if (target <= prev) return 1
  for (let r = 2; r <= 30; r++) {
    const cur = repFactor(r)
    if (cur >= target) {
      // linear interpolation between (r-1, prev) and (r, cur)
      return r - 1 + (target - prev) / (cur - prev)
    }
    prev = cur
  }
  return 30
}

// Expected RPE for performing `reps` at `pct`% of 1RM. Clamped to the 5–10 slider range.
export function expectedRpe(pct: number, reps: number): number {
  if (!(pct > 0) || !(reps > 0)) return 7
  const rir = Math.max(0, maxRepsAtPct(pct) - reps)
  return Math.min(10, Math.max(5, 10 - rir))
}

// Inverse of expectedRpe: the %1RM at which performing `reps` reps yields ~targetRpe.
// expectedRpe(pct, reps) = 10 − (maxRepsAtPct(pct) − reps); solving for pct at a target
// RPE gives maxReps = reps + (10 − targetRpe), and at failure repFactor(maxReps) = 100/pct.
// Same repFactor curve as expectedRpe/the 1RM math, so the two can never drift.
export function pctForExpectedRpe(targetRpe: number, reps: number): number {
  const clampedRpe = Math.min(10, Math.max(5, targetRpe))
  const rir = 10 - clampedRpe
  const maxReps = Math.max(1, reps + rir)
  const pct = 100 / repFactor(maxReps)
  return Math.round(pct * 2) / 2 // 0.5 precision, matching the codebase's pct rounding
}

export interface RpeTrendInputSet { rpe: number | null; intensityPct: number | null; reps: number }

// Program-wide RPE trend used by the emergency-deload safety net. Reps-aware like
// expectedRpe, so an honest AMRAP set reads as on-target rather than a false "too hard".
export function rpeTrendFromSets(sets: RpeTrendInputSet[]): { avgActual: number; avgExpected: number; delta: number } | null {
  const rated = sets.filter(s => s.rpe != null && s.intensityPct != null)
  if (rated.length < 3) return null
  const avgActual = rated.reduce((sum, s) => sum + s.rpe!, 0) / rated.length
  const avgExpected = rated.reduce((sum, s) => sum + expectedRpe(s.intensityPct!, s.reps), 0) / rated.length
  return { avgActual, avgExpected, delta: avgActual - avgExpected }
}
