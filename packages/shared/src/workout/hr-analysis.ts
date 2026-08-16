export interface HrReading {
  timestamp: Date
  bpm: number
}

export interface SetMarker {
  exerciseName: string
  setNumber: number
  loggedAt: Date | null
  // Working-set interval (epoch ms) — present for sessions logged with per-set
  // timing; absent for older/seeded sessions, in which case the chart shades nothing.
  setStartMs?: number | null
  setEndMs?: number | null
}

export interface SetHrStats {
  exerciseName: string
  setNumber: number
  loggedAt: Date | null
  setStartMs?: number | null
  setEndMs?: number | null
  peakBpm: number | null      // max HR in 90s before logged_at
  bpmAtLog: number | null     // nearest HR reading to logged_at
  hrr1: number | null         // bpmAtLog - bpm 60s later (drop = good recovery)
  adequate: boolean | null    // hrr1 >= ADEQUATE_HRR1_BPM; null when hrr1 was not measurable
}

// Find the nearest HR reading within ±windowMs of a target timestamp. Exported so the richer
// per-set analysis (lib/workout/set-hr-stats.ts) reuses the one nearest-reading implementation.
export function nearestBpm(readings: HrReading[], target: Date, windowMs = 90_000): number | null {
  let best: HrReading | null = null
  let bestDiff = Infinity
  for (const r of readings) {
    const diff = Math.abs(r.timestamp.getTime() - target.getTime())
    if (diff < windowMs && diff < bestDiff) {
      best = r
      bestDiff = diff
    }
  }
  return best?.bpm ?? null
}

// Max HR in the window [target - windowMs, target + 30s]
function peakBpmBefore(readings: HrReading[], target: Date, windowMs = 90_000): number | null {
  const from = target.getTime() - windowMs
  const to   = target.getTime() + 30_000
  const inWindow = readings.filter(r => r.timestamp.getTime() >= from && r.timestamp.getTime() <= to)
  if (inWindow.length === 0) return null
  return Math.max(...inWindow.map(r => r.bpm))
}

/**
 * How far HR must fall in the 60 s after a set for the rest to count as adequate. A real
 * physiological threshold applied to a real measurement, unlike the absolute-HR shortcut this
 * replaced (Q-149).
 */
export const ADEQUATE_HRR1_BPM = 15

export function analyseHrRecovery(
  readings: HrReading[],
  sets: SetMarker[],
): SetHrStats[] {
  return sets.map(set => {
    if (!set.loggedAt) {
      return { ...set, peakBpm: null, bpmAtLog: null, hrr1: null, adequate: null }
    }

    const bpmAtLog = nearestBpm(readings, set.loggedAt)
    const peakBpm  = peakBpmBefore(readings, set.loggedAt)

    // HRR1: bpm at log time vs bpm 60 seconds later
    const target60 = new Date(set.loggedAt.getTime() + 60_000)
    const bpm60 = nearestBpm(readings, target60, 45_000)
    const hrr1 = bpmAtLog != null && bpm60 != null ? bpmAtLog - bpm60 : null

    // Adequate rest: HR recovered >= 15 bpm in the 60 s after the set. A missing hrr1 is `null`
    // — unknown, not adequate.
    //
    // Q-149: this used to short-circuit to `true` whenever `bpmAtLog < 120`, and that branch
    // absorbed essentially everything. Measured over production (615 rows, 2026-08-08): 278
    // verdicts, **all true**, **271 of them (97.5%) via the shortcut**, and the highest
    // `bpm_at_end` in the entire table is 128. The 120 threshold assumes chest-strap-grade
    // end-of-set HR (140-170); the ring power-gates when worn-idle and samples at 1/min, so the
    // nearest reading within +/-90 s of the log is rarely near the true peak. The flag therefore
    // answered "was the sampled HR below 120?" — nearly always yes — and never reached the
    // recovery question it is named for. A constant is worse than an absence, because a reader
    // cannot tell it apart from a signal.
    //
    // So the shortcut is gone rather than re-tuned. Picking a *different* fixed number would be
    // the same population assumption with a different constant; requiring the measurement is the
    // honest version, and it leaves room for the source-aware threshold (per `set_hr_stats.source`)
    // to be added later without changing what the column means. Expect far fewer verdicts — 7 of
    // 278 on today's data — and `null` everywhere the ring simply did not sample the recovery.
    const adequate = hrr1 != null ? hrr1 >= ADEQUATE_HRR1_BPM : null

    return { ...set, peakBpm, bpmAtLog, hrr1, adequate }
  })
}
