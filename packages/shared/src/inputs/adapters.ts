/**
 * Adapters: turn a source's rows into candidates for a named input (`cascade.ts`).
 *
 * An adapter only reshapes and labels — it never re-derives a metric that already lives elsewhere.
 * The step plausibility gate and overlap dedupe come from `health/step-estimate.ts`, the low-wear
 * test from `health/wear-confidence.ts`, cadence → MET from `health/cadence.ts`, the per-set drop
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
import { cadenceToMet } from '@trainingai/shared/health/cadence'

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

/**
 * #2115 v4 constants for the `MET/min` routes below, each with its source.
 *
 * - `SLEEP_MET`: 2024 Adult Compendium code 07030 "Sleeping" is 1.0 (the 2011 edition's 0.95 is
 *   superseded). On the owner's ring, MET averages 1.01 over 28,793 in-session minutes, so 1.0 is also
 *   the unbiased value for a model that averages. Used for the ring's sleep-motion marker and for any
 *   device's sleep record, so there is one sleeping value, not two.
 * - `KCAL_PER_KG_MIN_PER_MET`: ACSM, kcal/min = MET × 3.5 × kg ÷ 200, so one MET is 0.0175 kcal/kg/min.
 * - `MAX_KCAL_RECORD_MIN`: an active-calorie record longer than this is too coarse to place in minutes,
 *   so its minutes stay empty rather than receive a smeared average.
 */
export const SLEEP_MET = 1.0
export const KCAL_PER_KG_MIN_PER_MET = 0.0175
export const MAX_KCAL_RECORD_MIN = 15

/**
 * Rung-1b MET from a device's active calories and the user's weight:
 *   MET = 1 + activeKcalPerMin ÷ (0.0175 × kg)
 * Health Connect's `ActiveCaloriesBurned` excludes BMR, and the ACSM identity is for gross energy, so
 * the `1 +` puts a resting minute at 1 MET rather than 0. A record is spread evenly over the minutes it
 * covers; one longer than `MAX_KCAL_RECORD_MIN` fills nothing, and without a weight nothing fills.
 * The caller passes only sources that provide active calories (a source flag, never a device name).
 */
export function activeKcalMetCandidates(
  records: readonly { startMs: number; endMs: number; kcal: number; source: string }[],
  weightKg: number | null,
): Candidate[] {
  if (weightKg == null || !(weightKg > 0)) return []
  const perMinute = new Map<number, { kcal: number; source: string }>()
  for (const r of records) {
    const span = r.endMs - r.startMs
    if (!(span > 0) || span > MAX_KCAL_RECORD_MIN * MINUTE_MS || !Number.isFinite(r.kcal) || r.kcal < 0) continue
    for (let m = minuteOf(r.startMs); m < r.endMs; m += MINUTE_MS) {
      const overlap = Math.min(r.endMs, m + MINUTE_MS) - Math.max(r.startMs, m)
      if (overlap <= 0) continue
      const prev = perMinute.get(m)
      perMinute.set(m, { kcal: (prev?.kcal ?? 0) + (r.kcal * overlap) / span, source: prev?.source ?? r.source })
    }
  }
  return [...perMinute].map(([slot, { kcal, source }]) => ({
    slot, value: 1 + kcal / (KCAL_PER_KG_MIN_PER_MET * weightKg), route: 'active_kcal_met', source,
  }))
}

/**
 * Rung-2c MET from step cadence, through `cadenceToMet` (CADENCE-adults). Reads the resolved
 * `steps/min` series, so each minute keeps its step source. Below 45 steps/min the minute stays empty;
 * above 129 the value is held at the table's top and marked `capped`.
 */
export function cadenceMetCandidates(steps: readonly Resolved[]): Candidate[] {
  const out: Candidate[] = []
  for (const r of steps) {
    if (r.missing) continue
    const m = cadenceToMet(r.value)
    if (!m) continue
    out.push({
      slot: r.slot, value: m.met, route: 'cadence_met', source: r.provenance.source,
      ...(m.capped ? { capped: true } : {}), ...(r.provenance.lowWear ? { lowWear: true } : {}),
    })
  }
  return out
}

/**
 * #2781: the default map from the ring's motion to MET (rung 2a of `MET/min`, #2115 v4), fitted by
 * the v4 proposer on alternate days of the owner's paired minutes (ring MET and `0x47` events) and
 * tested on the rest: MAE 0.138 against 0.287 for a constant; active (> 1.8) sensitivity 0.72 at PPV
 * 0.80. 92 bins, each of at least 60 paired minutes. Three adjacent steps run slightly downhill
 * (3.2 → 2.85 among them); the table ships exactly as evaluated, because the held-out figures
 * describe this table and no other.
 *
 * Feature `L(m)`: the summed low intensity of every `0x47` event in minute m − 1 or minute m (the
 * motion leads the ring's own MET by about a minute in the fit). An event belongs to the minute it
 * closes: `floor((ms − 1) / 60 000)`. Lookup: the last bin whose edge is ≤ L. `cut` is the Youden
 * point on the derived scale for "active" (a regression map shrinks toward the mean, so 1.8 would
 * under-detect); the active-hour rule (#2226) reads it, training load does not.
 */
export const RING_MOTION_MET_MAP_V1 = {
  edges: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 79, 81, 83, 85, 87, 90, 92, 96, 100, 104, 109, 113, 117, 129],
  met: [0.9, 1.0, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.7, 1.7, 1.7, 1.7, 1.7, 1.8, 1.8, 1.8, 1.9, 1.8, 1.9, 1.9, 1.9, 1.9, 1.9, 1.9, 2.0, 2.0, 2.0, 2.0, 2.1, 2.1, 2.3, 2.3, 2.3, 2.3, 2.3, 2.5, 2.5, 2.55, 2.8, 2.9, 3.0, 3.2, 2.85, 3.3, 3.6, 3.9, 4.0, 4.4, 4.8, 5.2, 5.4, 5.8, 5.3],
  cut: 1.5,
} as const

/** The map's MET for a summed low intensity: the last bin whose edge is ≤ `l`, never below the first. */
export function ringMotionMet(l: number, map: { edges: readonly number[]; met: readonly number[] } = RING_MOTION_MET_MAP_V1): number {
  let i = 0
  while (i + 1 < map.edges.length && map.edges[i + 1] <= l) i++
  return map.met[i]
}

/**
 * Rung-2a MET from the ring's `0x47` motion events through `RING_MOTION_MET_MAP_V1`. A minute gets a
 * value when it or the minute before holds at least one event; minutes with neither stay absent.
 */
export function ringMotionMetCandidates(
  events: readonly { tsMs: number; lowIntensity: number }[], source: string,
): Candidate[] {
  const sumByMinute = new Map<number, number>()
  for (const e of events) {
    if (!Number.isFinite(e.tsMs) || !Number.isFinite(e.lowIntensity)) continue
    const k = Math.floor((e.tsMs - 1) / MINUTE_MS)
    sumByMinute.set(k, (sumByMinute.get(k) ?? 0) + e.lowIntensity)
  }
  const minutes = new Set<number>()
  for (const k of sumByMinute.keys()) { minutes.add(k); minutes.add(k + 1) }
  return [...minutes].map((m) => ({
    slot: m * MINUTE_MS,
    value: ringMotionMet((sumByMinute.get(m - 1) ?? 0) + (sumByMinute.get(m) ?? 0)),
    route: 'accel_met',
    source,
  }))
}

/**
 * Rung-2b MET from the ring's sleep-motion marker (`0x72`, sleep_acm_period): a minute holding one
 * of its frames is a still minute and reads `SLEEP_MET`. Takes the frames' wall-clock instants.
 */
export function ringStillMetCandidates(frameTimesMs: readonly number[], source: string): Candidate[] {
  const minutes = new Set(frameTimesMs.filter(Number.isFinite).map(minuteOf))
  return [...minutes].map((slot) => ({ slot, value: SLEEP_MET, route: 'ring_still_met', source }))
}

/**
 * Rung-2d MET from a sleep record from any device: every minute inside the session reads
 * `SLEEP_MET`. The resolver gives it only the minutes no better route filled.
 */
export function sleepSessionMetCandidates(
  sessions: readonly { startMs: number; endMs: number; source: string }[],
): Candidate[] {
  const out: Candidate[] = []
  for (const sess of sessions) {
    if (!(sess.endMs > sess.startMs)) continue
    for (let m = minuteOf(sess.startMs); m < sess.endMs; m += MINUTE_MS) {
      out.push({ slot: m, value: SLEEP_MET, route: 'sleep_session_met', source: sess.source })
    }
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
 * Per-set HRR60 from `computeSetHrStats` rows: `hrr1Bpm`, the dense-HR measurement (`deriveHrr60`,
 * #2299 step 2). A set the series could not see — a ring-only set, a gap — is missing, not zero.
 * It used to read `drop60s` gated on `coverageOk`, which a ring set could pass with a noise drop.
 * Source is the row's own — `'mixed'` when the window spanned devices, `'unknown'` when no reading
 * carried one.
 */
export function hrr60Candidates(
  rows: readonly { setLogId: string; hrr1Bpm: number | null; source: string | null }[],
): Candidate[] {
  return rows
    .filter((r) => r.hrr1Bpm != null)
    .map((r) => ({ slot: r.setLogId, value: r.hrr1Bpm!, route: 'dense_hr_hrr60', source: r.source ?? 'unknown' }))
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
