/**
 * Adapters: turn a source's rows into candidates for a named input (`cascade.ts`).
 *
 * An adapter only reshapes and labels — it never re-derives a metric that already lives elsewhere.
 * The step plausibility gate and overlap dedupe come from `health/step-estimate.ts`, the low-wear
 * test from `health/wear-confidence.ts`, the HR reserve from `health/hr-zones.ts`, the per-set drop
 * from `workout/set-hr-stats.ts` (passed in as rows), the ring MET grid from `metGridFromDaytimeSamples`
 * (passed in as its output) and a logged activity's Compendium MET from `metForActivity` (passed in as
 * a number, so this module does not pull the model-constants chain into the WebView).
 *
 * Every adapter drops what it cannot place rather than emitting a 0: an absent value must stay absent
 * so the resolver reports the slot as missing.
 */
import { MINUTE_MS, minuteOf, type Candidate, type Resolved } from './cascade'
import { isPlausibleStepWindow, dedupeOverlappingWindows, type StepCountWindow } from '@trainingai/shared/health/step-estimate'
import { isLowWearDay } from '@trainingai/shared/health/wear-confidence'
import { hrReserve } from '@trainingai/shared/health/hr-zones'

/** Resting VO₂ — one MET — in ml/kg/min. */
const ML_KG_MIN_PER_MET = 3.5

/**
 * Spread step-count windows across the minutes they cover, in proportion to overlap.
 *
 * Implausible windows are dropped whole (the `isPlausibleStepWindow` gate), and overlapping windows
 * from one route are de-duplicated first (`dedupeOverlappingWindows`) so no instant is counted twice.
 * Windows from the same route that share a minute are added — they are disjoint spans of one count.
 */
export function stepCandidates(
  windows: readonly StepCountWindow[], route: string, source: string,
): Candidate[] {
  const usable = dedupeOverlappingWindows(windows.filter((w) => isPlausibleStepWindow(w.steps, w.startMs, w.endMs)))
  const perMinute = new Map<number, number>()
  for (const w of usable) {
    const span = w.endMs - w.startMs
    for (let m = minuteOf(w.startMs); m < w.endMs; m += MINUTE_MS) {
      const overlap = Math.min(w.endMs, m + MINUTE_MS) - Math.max(w.startMs, m)
      if (overlap <= 0) continue
      perMinute.set(m, (perMinute.get(m) ?? 0) + (w.steps * overlap) / span)
    }
  }
  return [...perMinute].map(([slot, value]) => ({ slot, value, route, source }))
}

/**
 * The ring's 1-minute MET grid (the output of `metGridFromDaytimeSamples`) as `device_met`
 * candidates. Null bins — the gaps between activity events — stay absent.
 */
export function metGridCandidates(
  grid: { startTimestampMs: number; metsPerMinute: readonly (number | null)[] }, source: string,
): Candidate[] {
  const out: Candidate[] = []
  grid.metsPerMinute.forEach((v, i) => {
    if (v != null) out.push({ slot: minuteOf(grid.startTimestampMs + i * MINUTE_MS), value: v, route: 'device_met', source })
  })
  return out
}

/**
 * A timestamped series (HR samples, an accelerometer-derived MET stream) averaged per minute. Use for
 * any route whose source reports faster than once a minute.
 */
export function minuteMeanCandidates(
  points: readonly { tsMs: number; value: number }[], route: string, source: string,
): Candidate[] {
  const acc = new Map<number, { sum: number; n: number }>()
  for (const p of points) {
    if (!Number.isFinite(p.value)) continue
    const m = minuteOf(p.tsMs)
    const a = acc.get(m) ?? { sum: 0, n: 0 }
    a.sum += p.value; a.n++
    acc.set(m, a)
  }
  return [...acc].map(([slot, a]) => ({ slot, value: a.sum / a.n, route, source }))
}

export interface HrReserveMetContext {
  /** VO₂max in ml/kg/min (`health/vo2max.ts`). Without it the route cannot fill. */
  vo2maxMlKgMin: number | null
  maxHr: number
  /**
   * Resting HR **per HR source** (#2162 (e)): the ring reads ~10 bpm under the strap, so a reserve
   * built on the other source's resting HR would shift every estimate. A source with no resting HR
   * of its own does not fill.
   */
  restingHrBySource: Record<string, number | null | undefined>
}

/**
 * Rung-3 MET from heart rate: %HRR tracks %VO₂ reserve (Swain & Leutholtz 1997; ACSM), so
 *   MET = 1 + %HRR × (VO₂max/3.5 − 1)
 * with %HRR clamped to [0, 1]. Reads the resolved `HR/min` series, so each minute inherits that
 * minute's HR source and uses that source's own resting HR. Low wear carries through.
 */
export function hrReserveMetCandidates(hr: readonly Resolved[], ctx: HrReserveMetContext): Candidate[] {
  if (ctx.vo2maxMlKgMin == null || !(ctx.vo2maxMlKgMin > ML_KG_MIN_PER_MET)) return []
  const maxMet = ctx.vo2maxMlKgMin / ML_KG_MIN_PER_MET
  const out: Candidate[] = []
  for (const r of hr) {
    if (r.missing) continue
    const rest = ctx.restingHrBySource[r.provenance.source]
    if (rest == null || !(rest > 0)) continue
    const frac = Math.min(1, Math.max(0, (r.value - rest) / hrReserve(ctx.maxHr, rest)))
    out.push({
      slot: r.slot, value: 1 + frac * (maxMet - 1), route: 'hr_reserve_met', source: r.provenance.source,
      ...(r.provenance.lowWear ? { lowWear: true } : {}),
    })
  }
  return out
}

/**
 * Rung-3 MET from a logged activity: every minute it spans gets its Compendium MET. The caller looks
 * the MET up (`metForActivity(ouraIdForActivityType(type), intensity)`) and passes the number.
 */
export function compendiumMetCandidates(
  activities: readonly { startMs: number; endMs: number; met: number | null; source?: string }[],
): Candidate[] {
  const out: Candidate[] = []
  for (const a of activities) {
    if (a.met == null || !(a.endMs > a.startMs)) continue
    for (let m = minuteOf(a.startMs); m < a.endMs; m += MINUTE_MS) {
      out.push({ slot: m, value: a.met, route: 'compendium_met', source: a.source ?? 'manual' })
    }
  }
  return out
}

/**
 * Per-set HRR60 from `computeSetHrStats` rows. A set without enough readings (`coverageOk` false) or
 * whose rest ended before 60 s (`drop60s` null) is missing, not zero. Source is the row's own —
 * `'mixed'` when the window spanned devices, `'unknown'` when no reading carried one.
 */
export function hrr60Candidates(
  rows: readonly { setLogId: string; drop60s: number | null; coverageOk: boolean; source: string | null }[],
): Candidate[] {
  return rows
    .filter((r) => r.coverageOk && r.drop60s != null)
    .map((r) => ({ slot: r.setLogId, value: r.drop60s!, route: 'dense_hr_drop60', source: r.source ?? 'unknown' }))
}

/**
 * Nightly values (`HRV/night`, `RHR/night`) keyed by date, flagged low-wear by the same test the
 * readiness baselines use today (`isLowWearDay` on that date's wear row). A date with no wear row is
 * not flagged — there is nothing to judge it by — matching `excludeLowWearDays`.
 */
export function nightlyCandidates(
  rows: readonly { date: string; value: number | null | undefined; source?: string | null }[],
  route: 'night_hrv' | 'night_rhr',
  wearByDate: Map<string, { nonWearTimeSec?: number | null }>,
  defaultSource = 'unknown',
): Candidate[] {
  const out: Candidate[] = []
  for (const r of rows) {
    if (r.value == null) continue
    const lowWear = isLowWearDay(wearByDate.get(r.date)?.nonWearTimeSec)
    out.push({ slot: r.date, value: r.value, route, source: r.source ?? defaultSource, ...(lowWear ? { lowWear: true } : {}) })
  }
  return out
}
