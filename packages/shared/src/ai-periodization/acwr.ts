import { median } from '@trainingai/shared/stats'
import { DEFAULT_TZ, dateStrMidnightInTz, shiftDateStr, toAestDay } from '@trainingai/shared/date-utils'

export interface AcwrSession { startedAt: Date; volumeKg: number }
export interface AcwrOptions {
  minSpanDays?: number
  minSessions?: number
  minChronicWeeklyLoadKg?: number
  /** The user's timezone. The acute window starts at a LOCAL midnight, so a DST day is still a day. */
  tz?: string
}
export interface AcwrResult {
  acwr: number | null
  acuteLoadKg: number
  chronicWeeklyAvgKg: number
  dataSpanWeeks: number
  todayVolumeKg: number
  typicalSessionVolumeKg: number
}

/**
 * The training-load windows, in whole local days (issue 2194, issue 2340). Every ratio is
 * "weekly-average load over the short window ÷ weekly-average load over the long one", so 1.0 means
 * steady at every scale.
 *
 *   acute    7  this week, today inclusive. Issue 2194: it was 8 (`todayMid − 7d` plus today),
 *               which read ~14% hot against bands calibrated on a 7-day acute load. Owner-signed
 *               2026-10-05; every threshold kept.
 *   chronic 28  the 7:28 ACWR's reference. Unchanged.
 *   block   90  the 28:90 block trend's reference (issue 2340). A trend and an insight only: it
 *               gates no action, so no stored score moves. Owner-signed 2026-10-07. 90:365 is not
 *               built yet (it needs a year of history).
 */
export const LOAD_WINDOW_DAYS = { acute: 7, chronic: 28, block: 90 } as const

export interface LoadRatioOptions {
  /** Default: three quarters of the long window (21 for 7:28, the gate ACWR always had). */
  minSpanDays?: number
  /** Default 6. */
  minSessions?: number
  /** Default 100 kg/week. Below it the ratio is noise over a trivial base. */
  minLongWeeklyLoadKg?: number
  tz?: string
}

export interface LoadRatioResult {
  /** Null until the gates pass. */
  ratio: number | null
  /** Load in the short window: `shortDays` local days ending with `asOf`'s day, inclusive. */
  shortLoadKg: number
  shortWeeklyAvgKg: number
  longWeeklyAvgKg: number
  /** The long window's real data span, in weeks (never under 1). */
  dataSpanWeeks: number
  spanDays: number
  /** The sessions inside the long window — what the minimum-sessions gate counts. */
  sessions: AcwrSession[]
}

/** The local midnight `days` whole days before `asOf`'s local day. DST-safe: never `asOf − n×24h`. */
function localMidnightDaysBefore(asOf: Date, days: number, tz: string): number {
  return dateStrMidnightInTz(shiftDateStr(toAestDay(asOf, tz), -days), tz).getTime()
}

/**
 * One formula for every training-load ratio (issue 2340): 7:28 is the ACWR, 28:90 the block trend.
 *
 * `asOf` is the local midnight that starts the day being scored; that day's sessions count.
 * - The SHORT window is `shortDays` local days, today inclusive: 7 means today and the six before.
 * - The LONG window reaches back `longDays` whole local days before today, plus today. That is the
 *   shape the chronic window has always had (every caller fetches from `todayMid − 28d`), kept so
 *   issue 2194 moves the acute side alone.
 * - The long average divides by the REAL data span in weeks, measured from the earliest session in
 *   the window, so a 3-week-old program is judged against 3 weeks of history, not an imaginary 4 —
 *   the flat ÷4 inflated ACWR ~2× on new programs and fired spurious emergency deloads.
 */
export function loadRatio(
  sessions: AcwrSession[],
  shortDays: number,
  longDays: number,
  asOf: Date,
  opts: LoadRatioOptions = {},
): LoadRatioResult {
  const {
    minSpanDays = Math.round((longDays * 3) / 4),
    minSessions = 6,
    minLongWeeklyLoadKg = 100,
    tz = DEFAULT_TZ,
  } = opts
  const shortFrom = localMidnightDaysBefore(asOf, shortDays - 1, tz)
  const longFrom = localMidnightDaysBefore(asOf, longDays, tz)
  const inLong = sessions.filter(s => s.startedAt.getTime() >= longFrom)
  let shortLoadKg = 0, longLoadKg = 0
  let earliest: number | null = null
  for (const s of inLong) {
    const t = s.startedAt.getTime()
    longLoadKg += s.volumeKg
    if (t >= shortFrom) shortLoadKg += s.volumeKg
    if (earliest == null || t < earliest) earliest = t
  }
  const spanMs = earliest != null ? asOf.getTime() - earliest : 0
  // Round to whole days so a session logged a few hours into "21 days ago" still counts
  // as a full 21-day span, rather than being nudged just under the gate by its time-of-day.
  const spanDays = Math.round(spanMs / 86_400_000)
  const dataSpanWeeks = Math.max(1, spanDays / 7)
  const longWeeklyAvgKg = longLoadKg / dataSpanWeeks
  const shortWeeklyAvgKg = shortLoadKg / (shortDays / 7)
  const gatesPass =
    spanDays >= minSpanDays &&
    inLong.length >= minSessions &&
    longWeeklyAvgKg > minLongWeeklyLoadKg
  return {
    ratio: gatesPass ? shortWeeklyAvgKg / longWeeklyAvgKg : null,
    shortLoadKg, shortWeeklyAvgKg, longWeeklyAvgKg, dataSpanWeeks, spanDays, sessions: inLong,
  }
}

// Volume-load acute:chronic workload ratio over ALL sessions (not one session type): the 7:28
// `loadRatio`. Callers pass the chronic window's sessions (from `todayMid − 28d`) and today's.
export function computeVolumeAcwr(sessions: AcwrSession[], todayMid: Date, opts: AcwrOptions = {}): AcwrResult {
  const { minSpanDays = 21, minSessions = 6, minChronicWeeklyLoadKg = 100, tz } = opts
  const r = loadRatio(sessions, LOAD_WINDOW_DAYS.acute, LOAD_WINDOW_DAYS.chronic, todayMid, {
    minSpanDays, minSessions, minLongWeeklyLoadKg: minChronicWeeklyLoadKg, tz,
  })
  let todayVolumeKg = 0
  const vols: number[] = []
  for (const s of r.sessions) {
    if (s.startedAt.getTime() >= todayMid.getTime()) todayVolumeKg += s.volumeKg
    if (s.volumeKg > 0) vols.push(s.volumeKg)
  }
  // The shared median (LA-151). This read `sorted[floor(n/2)]` — the UPPER of the two middles —
  // which over the owner's real 119 sessions differs on 39% of rolling 28-day windows, always
  // upward, by a median 1.85% and up to 21%. It is REPORTED, not scored: Q-190 took the volume
  // lane off this number, so the bias reached the score audit's display and nothing that computes.
  // 0 for an empty window keeps the `number` contract every consumer is typed against, and the
  // window is gated by `minSessions` before anything acts on it.
  const typicalSessionVolumeKg = median(vols) ?? 0
  return {
    acwr: r.ratio,
    // A 7-day short window is exactly one week, so its sum is its weekly average.
    acuteLoadKg: r.shortLoadKg,
    chronicWeeklyAvgKg: r.longWeeklyAvgKg,
    dataSpanWeeks: r.dataSpanWeeks,
    todayVolumeKg,
    typicalSessionVolumeKg,
  }
}

/**
 * Issue 2340. Bands for the 28:90 block trend, the owner-approved starting point: under 0.8 the
 * block is detraining, 0.8–1.2 steady, over 1.2 building. To be refit per person under the adaptive
 * scoring rules. They gate nothing: the 28:90 ratio is a trend and an insight only.
 */
export const BLOCK_TREND_THRESHOLDS = { detrainingMax: 0.8, buildingMin: 1.2 } as const

export type BlockTrendBand = 'detraining' | 'steady' | 'building'

export function blockTrendBand(ratio: number): BlockTrendBand {
  if (ratio < BLOCK_TREND_THRESHOLDS.detrainingMax) return 'detraining'
  if (ratio > BLOCK_TREND_THRESHOLDS.buildingMin) return 'building'
  return 'steady'
}

export interface BlockTrendResult { ratio: number | null; band: BlockTrendBand | null }

/**
 * Issue 2340. Is this block building or detraining? The 28:90 `loadRatio`: weekly-average load over
 * the last 28 local days against the weekly average over the 90 before today. Additive: no score,
 * gate or prescription reads it yet. Callers pass at least the 90-day window's sessions.
 */
export function computeBlockTrend(sessions: AcwrSession[], todayMid: Date, opts: { tz?: string } = {}): BlockTrendResult {
  const { ratio } = loadRatio(sessions, LOAD_WINDOW_DAYS.chronic, LOAD_WINDOW_DAYS.block, todayMid, { tz: opts.tz })
  return { ratio, band: ratio == null ? null : blockTrendBand(ratio) }
}

/**
 * OR-210. How long a program must have run before its chronic load is a valid baseline. Until then
 * the chronic window still holds the PREVIOUS routine, so the ratio is unreliable and is withheld.
 */
export const ACWR_BASELINE_DAYS = 28

export interface ProgramAgeInput { startedAt?: Date | string | null; createdAt?: Date | string | null }

/**
 * Whole days since the program began, as of `asOf`: `startedAt`, else `createdAt`. A program with
 * no start date is still as old as its row, and that fallback is the whole point: three rules
 * existed for this one question. The Health route fell back to `createdAt`; readiness and the
 * score audit read `startedAt` alone and treated a missing one as INFINITELY old, so they never
 * baselined; and signals, chat and running did not ask. The owner's active program has
 * `started_at = NULL`, which is how July's early-deload card ran on live ACWR while the Health card
 * said "baselining". Null when there is no program or no usable date.
 */
export function programAgeDays(program: ProgramAgeInput | null | undefined, asOf: Date): number | null {
  const began = program?.startedAt ?? program?.createdAt ?? null
  if (began == null) return null
  const t = new Date(began).getTime()
  if (!Number.isFinite(t)) return null
  return Math.floor((asOf.getTime() - t) / 86_400_000)
}

/** Days until the chronic baseline is valid. 0 when it already is, and when there is no program to judge. */
export function acwrBaselineDaysRemaining(program: ProgramAgeInput | null | undefined, asOf: Date): number {
  const age = programAgeDays(program, asOf)
  return age == null ? 0 : Math.max(0, ACWR_BASELINE_DAYS - age)
}

export interface AcwrBand {
  key: 'low' | 'optimal' | 'high' | 'very_high'
  label: string
  color: string
}

// Canonical ACWR boundaries. Every threshold anywhere in the app that acts on an ACWR number
// comes from here — Q-306 found three sites deciding three different behaviours at numbers they
// each declared themselves (`acwr > 1.5` inline in emergency-deload, `ACWR_TAPER_START = 1.5` in
// activity-score, `EARLY_DELOAD_ACWR_MIN = 1.2` in readiness-payload), so nothing expressed that
// two of them were the same boundary and the third deliberately was not.
//
//   veryLowMax  0.6  well under the Undertraining floor — the legacy blended readiness score's −5
//                    detraining penalty. Lived inline in readiness-payload (#2375).
//   lowMax      0.8  band floor — below is Undertraining
//   optimalMax  1.3  band ceiling — above is amber. The running recovery gate holds back here.
//   elevatedMin 1.2  the ONE deliberate exception, and it is inside the optimal band: the
//                    early-deload card fires before the band turns amber because it is paired
//                    with a readiness score under 45 — the pair is the signal, not the number.
//                    Aligning it to optimalMax would change who sees the card.
//   highMax     1.5  where the two HARD actions fire — the emergency-deload trigger and the
//                    Activity-score over-exertion taper. Both were 1.5 by coincidence of typing.
export const ACWR_THRESHOLDS = { veryLowMax: 0.6, lowMax: 0.8, optimalMax: 1.3, elevatedMin: 1.2, highMax: 1.5 } as const

// Single agreed ACWR band, consumed everywhere a band/label/color is displayed —
// never re-derive from the raw acwr number at the call site (four divergent
// threshold sets existed before this: the training-load route, the Home widget,
// the Health explainer copy, and the readiness-score modifier all disagreed).
export function acwrBand(acwr: number): AcwrBand {
  if (acwr < ACWR_THRESHOLDS.lowMax) return { key: 'low', label: 'Undertraining', color: '#94a3b8' }
  if (acwr <= ACWR_THRESHOLDS.optimalMax) return { key: 'optimal', label: 'Optimal', color: '#22c55e' }
  if (acwr <= ACWR_THRESHOLDS.highMax) return { key: 'high', label: 'High', color: '#f59e0b' }
  return { key: 'very_high', label: 'Very High', color: '#ef4444' }
}

// For clients that only have the server-reported interpretation key (e.g. from
// TrainingLoadResponse) and must render its label/color without re-banding the
// raw number themselves.
const ACWR_BAND_BY_KEY: Record<AcwrBand['key'], AcwrBand> = {
  low: acwrBand(0),
  optimal: acwrBand(1),
  high: acwrBand(1.4),
  very_high: acwrBand(2),
}
export function acwrBandByKey(key: AcwrBand['key']): AcwrBand {
  return ACWR_BAND_BY_KEY[key]
}

export type TrainingLoadInterpretation = AcwrBand['key'] | 'insufficient_data' | 'baselining'

export interface TrainingLoadBand {
  /** The ratio, or null while it is insufficient or baselining. */
  acwr: number | null
  acuteLoad: number
  chronicLoad: number
  interpretation: TrainingLoadInterpretation
  baselineDaysRemaining?: number
}

/**
 * OR-210. The ONE place a volume-load ACWR becomes a band the user is shown. The Health route and
 * the chat tool both call this, so they cannot disagree: before it, the chat tool returned a raw
 * number over a 56-day window and the model banded it itself, and **32 of the owner's last 76 days
 * disagreed with the Health card**. Order matters and is the route's: too little data first, then a
 * program too young for its chronic baseline, then the band.
 */
export function trainingLoadBand(load: AcwrResult, program: ProgramAgeInput | null | undefined, todayMid: Date): TrainingLoadBand {
  const acuteLoad = Math.round(load.acuteLoadKg)
  const chronicLoad = Math.round(load.chronicWeeklyAvgKg)
  if (load.acwr == null) return { acwr: null, acuteLoad, chronicLoad, interpretation: 'insufficient_data' }
  const remaining = acwrBaselineDaysRemaining(program, todayMid)
  if (remaining > 0) return { acwr: null, acuteLoad, chronicLoad, interpretation: 'baselining', baselineDaysRemaining: remaining }
  return { acwr: parseFloat(load.acwr.toFixed(2)), acuteLoad, chronicLoad, interpretation: acwrBand(load.acwr).key }
}

export interface MonotonyStrainResult {
  monotony: number | null
  strain: number | null
  weeklyLoadKg: number
}

// Training monotony (Foster) — mean-over-SD of daily load across the window.
// Low day-to-day variability (few rest days, near-identical load every day)
// inflates monotony and strain even at a moderate ACWR — a distinct
// injury-risk signal ACWR alone misses. `dailyLoadsKg` must be one entry per
// calendar day in the window (0 for rest days), not per session.
export function computeMonotonyStrain(dailyLoadsKg: number[]): MonotonyStrainResult {
  const n = dailyLoadsKg.length
  if (n === 0) return { monotony: null, strain: null, weeklyLoadKg: 0 }
  const weeklyLoadKg = dailyLoadsKg.reduce((a, b) => a + b, 0)
  const mean = weeklyLoadKg / n
  const variance = dailyLoadsKg.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n
  const sd = Math.sqrt(variance)
  if (sd === 0) return { monotony: null, strain: null, weeklyLoadKg }
  const monotony = mean / sd
  return { monotony, strain: weeklyLoadKg * monotony, weeklyLoadKg }
}
