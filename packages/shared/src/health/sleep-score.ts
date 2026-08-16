import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import type { SleepSession } from '@trainingai/shared/types/body'

// Our own 0–100 Sleep Score. The weights are the ecore combiner weights recovered by
// open_health (`Th0rgal/open_health`, docs/algorithms/score-weights.md) by regressing an
// Oura Trends export against each night's contributor sub-scores — Sleep Score reproduced
// at R²=0.9987, so these are Oura's actual weights, not a guess. The per-contributor curves
// below approximate open_health's fitted sub-score functions (isotonic for the duration
// metrics, a U-curve for latency, a circadian peak for timing). This is our own computation
// from ring data — it is NOT Oura's proprietary scoring model, and BLE nights without a
// hypnogram legitimately lack the REM/Deep contributors, so the combiner renormalises over
// whichever contributors are actually available and never fabricates a missing one.

// Weights recalibrated 2026-07-27 (owner-directed, see docs/reviews/2026-07-27-night-2026-07-25-case-study.md).
// The night of 2026-07-25 was rated "Terrible" by the owner and scored 80: it was normal on every
// contributor the model had (duration/efficiency/stages/latency) and abnormal only in autonomic state
// (HRV −2.76σ, overnight HR +10bpm) and wake time (~2h early). Two contributors were added for exactly
// those axes — `hr` and `schedule` — and the sleep-architecture weights were trimmed to fund them
// without letting the total drift. Autonomic state (hrv + hr) is now 28 of 110 (25%) rather than 12 of
// 100 (12%). `totalSleep` remains the single largest term.
export const SLEEP_WEIGHTS = {
  totalSleep: 24,
  restfulness: 9,
  efficiency: 9,
  rem: 10,
  deep: 10,
  latency: 6,
  timing: 6,
  /** Bed/wake time vs the sleeper's own habitual schedule. */
  schedule: 8,
  hrv: 14,
  /** Overnight average HR vs the sleeper's own baseline. */
  hr: 14,
} as const

/** Piecewise-linear interpolation over ascending (x, y) anchor points, clamped at both ends. */
function interp(x: number, pts: readonly (readonly [number, number])[]): number {
  if (x <= pts[0][0]) return pts[0][1]
  const last = pts[pts.length - 1]
  if (x >= last[0]) return last[1]
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
  }
  return last[1]
}

// Curves recalibrated 2026-07-22 (core-cards overhaul) so a *genuinely excellent* night can reach
// ~100 while a normal-good night still stays under 90 (the session-245 intent — a very-good-but-normal
// night must NOT approach the ceiling; only long+efficient+well-staged+HRV-strong nights do). Two
// concrete structural fixes over the 2026-07-09 curves: (1) the latency and timing sub-scores now
// peak at a true 100 (they were capped at 98/97, making an overall 100 impossible by construction);
// (2) overnight HRV is folded in as a contributor (`hrv`, opt-in via a baseline — the biggest recovery
// signal the score previously ignored). Duration/efficiency top-ends were lifted modestly so an
// excellent night reaches the high 90s, but the low-mid of each curve was kept compressed so a normal
// night lands in the 80s. Contributor *shapes* (isotonic durations, latency U-curve, circadian timing)
// are unchanged. See docs/superpowers/plans/2026-07-22-core-score-cards-and-activity-overhaul.md (W-C).
// Total sleep duration (hours) → sub-score. 100 at ~9h; 8h is excellent (~92); 7.6h normal-good (~86).
const TOTAL_SLEEP = [[0, 0], [3, 10], [4, 22], [5, 42], [6, 60], [7, 76], [7.5, 84], [8, 92], [8.5, 97], [9, 100], [10, 99]] as const
// Sleep efficiency (%) → sub-score. 90% good (~82); 96%+ near-perfect.
const EFFICIENCY = [[60, 8], [70, 26], [80, 52], [85, 66], [88, 76], [90, 82], [92, 90], [94, 96], [96, 100]] as const
// REM / Deep duration (hours) → sub-score. 100 at realistic excellent stage hours (~1.8h REM, ~1.7h deep).
const REM = [[0, 0], [0.4, 24], [0.75, 50], [1.1, 72], [1.5, 90], [1.8, 97], [2.2, 100]] as const
const DEEP = [[0, 0], [0.4, 34], [0.75, 62], [1.1, 84], [1.4, 96], [1.7, 100]] as const
// Sleep-onset latency (minutes) → sub-score. Non-monotone U-curve peaking at a TRUE 100 (~12 min):
// both instant sleep (a sign of sleep debt) and a long time to fall asleep are penalised.
const LATENCY = [[0, 78], [5, 92], [12, 100], [18, 97], [25, 86], [35, 70], [50, 50], [70, 30], [100, 12]] as const
// Sleep-timing: circular distance (hours) of the sleep midpoint from ~03:00 → sub-score. Peaks at a
// TRUE 100 at a 03:00 midpoint (open_health's circadian finding, corr +0.91 with that ideal).
const TIMING = [[0, 100], [0.75, 93], [1.5, 80], [2.5, 60], [3.5, 40], [5, 20]] as const
// Overnight HRV (rMSSD ms) as a ratio to the personal baseline → sub-score. At/above your own norm
// scores high (100 at ≥1.1×); a depressed night scores low. Opt-in: only added when a baseline is
// supplied (see `opts.hrvBaselineMs`), so nights/callers without a baseline renormalise as before.
const HRV_RATIO = [[0.6, 30], [0.75, 50], [0.85, 66], [1.0, 90], [1.1, 100], [1.4, 100]] as const
// Overnight average HR as a ratio to the personal baseline → sub-score. LOWER is better (the mirror of
// HRV_RATIO): a night spent at or below your own norm scores 100, an elevated night falls away fast.
// This is the axis the 2026-07-25 night failed on (+10bpm against a 65.8bpm baseline) and that nothing
// scored before. Opt-in via `opts.hrBaselineBpm`, same as `hrv`.
const HR_RATIO = [[0.90, 100], [0.96, 100], [1.0, 86], [1.04, 68], [1.08, 50], [1.15, 26], [1.30, 6]] as const
// Schedule deviation (hours) from the sleeper's habitual bed/wake times → sub-score.
//
// Two deliberate choices, both visible in the 2026-07-25 night:
//  - the WORSE of the two endpoints drives it, not their mean. Going to bed on time and waking two
//    hours early is a disrupted night; averaging that against a perfect bedtime hides exactly the
//    thing being measured.
//  - it is DIRECTIONAL. Only a *late* bedtime and an *early* wake are penalised — those curtail or
//    fragment the night. Going to bed early or sleeping in is not a defect (it is usually recovery
//    behaviour), and whatever it costs is already priced by `totalSleep` and `timing`. Scoring it
//    symmetrically marked 2026-07-27 down from 94 to 89 for the crime of an early night after a bad
//    one, which is the opposite of the intended signal.
const SCHEDULE_DEV = [[0, 100], [0.5, 97], [1.0, 88], [1.5, 74], [2.5, 50], [4, 22]] as const
// `restlessPeriods` is deliberately NOT scored (audit finding Q-3). The column holds two
// incommensurable quantities: Cloud-era nights carry Oura's own restlessness measure (138–330 in
// this history) and BLE nights carry `model.awakenings` (0–5). One curve cannot serve both, and the
// one that existed — topping out at 50 — served neither: measured over the full production history,
// EVERY Cloud night clamped to the maximum 32-point penalty while BLE nights drew 0–2.5. That made
// restfulness read 48.6 on Cloud nights against 86.3 on BLE ones, a 37.7-point gap that was purely
// units, and it depressed every pre-cutover score by ~2.6 points.
//
// There is no honest conversion — a count of movement periods and a count of wake events are
// different quantities, not the same one in different units. So the term is dropped rather than
// guessed at. `efficiency` and the awake fraction below did not change units across the cutover and
// already carry the restfulness signal; the BLE term was contributing ≤2.5 points, so nothing
// measurable is lost. Re-introducing an awakenings-calibrated penalty is a tuning decision — see the
// backlog, and the Admin → Day Review calibration card is the tool for it.
//
// Awake fraction of the sleep window → penalty subtracted from the restfulness base.
const AWAKE_PENALTY = [[0, 0], [0.05, 4], [0.1, 10], [0.2, 22], [0.35, 38]] as const

// Awake-time fragmentation cap (2026-08-06, owner-directed — a night with repeated work-call
// wake-ups scored 89 "High" despite fragmented sleep, because normal duration/HRV/HR/timing
// diluted the small efficiency/restfulness hit). This is a STANDALONE cap applied after the
// weighted blend below, not another weighted contributor — see the "distinct, clearly-separable
// step" note on `computeSleepScore`. It never raises the score, only ever lowers it, and only
// once a mature personal baseline exists to compare against (a fresh dataset or a post-re-key
// history gap does nothing here, same as the hrv/hr/schedule contributors).
//
// `restlessPeriods` (the ring's wake-event count) was tried first and rejected as the driving
// signal: on the calibration month, the disrupted night and the single BEST-rated night of the
// month both carried the SAME restlessPeriods value (4) — it's noise in this range for this
// ring, not a separator. Awake-time FRACTION is: the disrupted night's 0.184 was the 2nd-highest
// of 29 nights against a personal mean of 0.079 (sd 0.043), a genuine ~2.4sd outlier. Keyed on
// standard deviations from the sleeper's own trailing mean so it self-calibrates per person
// rather than assuming a fixed fraction is universally abnormal.
const AWAKE_FRAGMENTATION_CAP = [[0, 100], [1, 100], [1.5, 88], [2, 72], [2.5, 52], [3, 32], [4, 15]] as const

const clamp100 = (n: number) => Math.max(0, Math.min(100, n))

/** Local hour the `timing` contributor treats as the ideal sleep midpoint. */
const IDEAL_MIDPOINT_HOUR = 3
/** Restfulness base when there's no efficiency reading to base it on. */
const RESTFULNESS_FALLBACK_BASE = 72

/**
 * Minimum prior nights with an overnight-HRV reading before a personal HRV baseline is trusted
 * enough to add the `hrv` contributor. Callers that build the baseline themselves (the
 * readiness-score route, the admin day audit) share this so they can't drift apart.
 */
export const SLEEP_HRV_BASELINE_MIN_NIGHTS = 7

/** Minimum prior nights with an overnight-HR reading before the `hr` contributor is added. */
export const SLEEP_HR_BASELINE_MIN_NIGHTS = 7
/** Minimum prior nights before habitual bed/wake times are trusted enough to add `schedule`. */
export const SLEEP_SCHEDULE_MIN_NIGHTS = 7

/**
 * How many recent nights the autonomic baselines (`hrv`, `hr`) are computed over — Q-72.
 *
 * These were an **expanding all-time mean**, which is why `hrv` and `hr` sat pinned at 100 on
 * almost every night and diluted the six contributors that do discriminate. Measured over the
 * owner's real history: overnight HRV rose from ~24.8 ms (first ten nights) to ~62.7 ms (last
 * ten) and average HR fell from 74.0 to 60.2 bpm. That is a genuine multi-month improvement — and
 * against an all-time mean of 47.2 ms every recent night scored 1.3–1.8× "better than baseline",
 * far past the curve's 1.1 ceiling. 40 of 44 nights hit exactly 100 on `hrv`, 36 of 44 on `hr`.
 *
 * So the curves were never the problem: they discriminate fine against a baseline that tracks
 * the sleeper. An all-time mean structurally cannot, and the harder someone improves the more
 * completely it pins. A trailing window is also what the comparable products use (Oura's HRV
 * balance, Whoop's and Garmin's baselines) — none of them average your whole history.
 *
 * Median rather than mean: one travel or illness night should move the norm a little, not reset
 * it. Measured over the same history, a 14-night median takes `hrv` spread from sd 5.2 to 12.9
 * and pinning from 40/44 to 25/44.
 */
export const SLEEP_AUTONOMIC_BASELINE_WINDOW_NIGHTS = 14
/**
 * Minimum prior nights with an awake-time reading before the fragmentation cap's personal
 * mean/sd baseline is trusted. Deliberately higher than the other baselines (7) — a hard CAP
 * misfiring off a noisy few-night sd estimate is a bigger risk than a smoothly-blended weighted
 * contributor being slightly off.
 */
export const SLEEP_AWAKE_FRACTION_BASELINE_MIN_NIGHTS = 14
/**
 * Shortest session that counts as a night for baseline purposes. Naps and the sub-hour "rest"
 * fragments the ring emits carry real HRV/HR readings taken in a completely different state, so
 * folding them into a *sleep* baseline drags it toward daytime values. Baselines are built from
 * main sleeps only.
 */
export const MAIN_SLEEP_MIN_HOURS = 4

/**
 * The Sleep Score model in serialisable form — every weight, curve anchor and constant the score
 * is built from. Exported so tooling (the admin day-review audit) can present a score alongside
 * the exact model that produced it without copying any of it. Read-only mirror of the constants
 * above; there is still exactly one definition of each.
 */
export const SLEEP_MODEL = {
  weights: SLEEP_WEIGHTS,
  idealMidpointHour: IDEAL_MIDPOINT_HOUR,
  restfulnessFallbackBase: RESTFULNESS_FALLBACK_BASE,
  hrvBaselineMinNights: SLEEP_HRV_BASELINE_MIN_NIGHTS,
  autonomicBaselineWindowNights: SLEEP_AUTONOMIC_BASELINE_WINDOW_NIGHTS,
  curves: {
    totalSleepHours: TOTAL_SLEEP,
    efficiencyPct: EFFICIENCY,
    remHours: REM,
    deepHours: DEEP,
    latencyMinutes: LATENCY,
    timingMidpointDistanceHours: TIMING,
    hrvRatioToBaseline: HRV_RATIO,
    hrRatioToBaseline: HR_RATIO,
    scheduleWorstEndpointDeviationHours: SCHEDULE_DEV,
    awakeFractionPenalty: AWAKE_PENALTY,
    awakeFractionFragmentationCapByPersonalSd: AWAKE_FRAGMENTATION_CAP,
  },
  hrBaselineMinNights: SLEEP_HR_BASELINE_MIN_NIGHTS,
  scheduleMinNights: SLEEP_SCHEDULE_MIN_NIGHTS,
  mainSleepMinHours: MAIN_SLEEP_MIN_HOURS,
  awakeFractionBaselineMinNights: SLEEP_AWAKE_FRACTION_BASELINE_MIN_NIGHTS,
} as const

/**
 * Score a whole history at once, each night against baselines built from the nights that PRECEDE it
 * (never itself, never the future). Returned newest-first, which is how the trend and digest callers
 * consume it. Exists so those callers don't each re-derive "which nights count as prior" — that
 * question has exactly one answer and it lives here.
 */
export function computeSleepScoreSeries(
  sessions: SleepSession[],
  tz: string = DEFAULT_TZ,
): { session: SleepSession; result: SleepScoreResult | null }[] {
  const oldestFirst = [...sessions].sort((a, b) => a.sleepEnd.getTime() - b.sleepEnd.getTime())
  const out = oldestFirst.map((session, i) => ({
    session,
    result: computeSleepScore(session, tz, sleepScoreBaselines(oldestFirst.slice(0, i), tz)),
  }))
  return out.reverse()
}

/** Local hour-of-day (0–24, fractional) of a single instant, in the user's timezone. */
function midpointHourOf(at: Date, tz: string): number {
  const [h, m] = formatInTimeZone(at, tz, 'HH:mm').split(':').map(Number)
  return h + m / 60
}

/** Local hour-of-day (0–24, fractional) of the sleep midpoint, in the user's timezone. */
function midpointHour(start: Date, end: Date, tz: string): number {
  return midpointHourOf(new Date((start.getTime() + end.getTime()) / 2), tz)
}

export interface SleepScoreResult {
  score: number
  /** Each available contributor's 0–100 sub-score (missing contributors are absent). */
  components: Record<string, number>
  /**
   * The weighted-blend score BEFORE the awake-time fragmentation cap, if any. Equal to `score`
   * whenever the cap didn't fire — which is most nights; it's a floor, not a rescale.
   */
  preCapScore: number
  /**
   * Set only when the fragmentation cap actually lowered the score below the weighted blend.
   * Null on every night where it didn't apply (no mature baseline, or the night wasn't a personal
   * outlier) — including every night before this feature shipped.
   */
  fragmentationCap: {
    awakeFraction: number
    baselineMean: number
    baselineSd: number
    /** Standard deviations above the sleeper's own trailing mean. */
    z: number
    cap: number
  } | null
}

export interface SleepScoreOptions {
  /**
   * The user's personal overnight-HRV baseline (rMSSD ms) — typically the trailing ~28-night mean of
   * `averageHrvMs`. When supplied (and this night has an `averageHrvMs`), an `hrv` contributor is added
   * scoring the night's HRV against this baseline. Omit it and the score renormalises over the other
   * contributors exactly as before (BLE nights and callers without history are unaffected).
   */
  hrvBaselineMs?: number | null
  /** Personal overnight average-HR baseline (bpm). Adds the `hr` contributor when supplied. */
  hrBaselineBpm?: number | null
  /** Habitual bedtime as a local hour (0–24, fractional). Adds `schedule` with `habitualWakeHour`. */
  habitualBedHour?: number | null
  /** Habitual wake time as a local hour (0–24, fractional). Adds `schedule` with `habitualBedHour`. */
  habitualWakeHour?: number | null
  /**
   * Personal trailing mean/sd of awake-time fraction (awake ÷ (asleep+awake)) — see
   * `sleepScoreBaselines`. Both must be supplied, with `awakeFractionBaselineSd > 0`, for the
   * fragmentation cap to be evaluated at all.
   */
  awakeFractionBaselineMean?: number | null
  awakeFractionBaselineSd?: number | null
}

/** The personal baselines the opt-in contributors and the fragmentation cap need. Any may be null
 * (not enough history). */
export interface SleepScoreBaselines {
  hrvBaselineMs: number | null
  hrBaselineBpm: number | null
  habitualBedHour: number | null
  habitualWakeHour: number | null
  awakeFractionBaselineMean: number | null
  awakeFractionBaselineSd: number | null
}

/** Minimal shape `sleepScoreBaselines` needs from a prior session. */
export interface BaselineSessionInput {
  sleepStart: Date
  sleepEnd: Date
  durationHours?: number | null
  averageHrvMs?: number | null
  avgHeartRate?: number | null
  awakHours?: number | null
}

/** Mean of a set of clock hours, taken on the circle so 23:50 and 00:10 average to midnight. */
function circularMeanHour(hours: number[]): number {
  const t = (2 * Math.PI) / 24
  const x = hours.reduce((s, h) => s + Math.cos(h * t), 0)
  const y = hours.reduce((s, h) => s + Math.sin(h * t), 0)
  if (x === 0 && y === 0) return 0
  return ((Math.atan2(y, x) / t) + 24) % 24
}

/**
 * Derive every personal baseline the Sleep Score's opt-in contributors need, from the sleeper's own
 * prior nights. **One derivation, one place** — every `computeSleepScore` caller goes through this, so
 * the Health screen, the weekly digest, the sleep trend, the body-battery anchor and the score audit
 * cannot produce different scores for the same night (they did: four of six callers passed no baseline
 * at all, which is worth ~3 points on a typical night and more on an outlier one).
 *
 * `priorSessions` must EXCLUDE the night being scored. Naps and rest fragments are filtered out —
 * they carry HRV/HR readings taken awake, and folding them into a sleep baseline drags it off.
 */
export function sleepScoreBaselines(priorSessions: BaselineSessionInput[], tz: string = DEFAULT_TZ): SleepScoreBaselines {
  const nights = priorSessions.filter(s => (s.durationHours ?? 0) >= MAIN_SLEEP_MIN_HOURS)
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

  // Trailing window, newest last — see SLEEP_AUTONOMIC_BASELINE_WINDOW_NIGHTS for why these two
  // are not an all-time mean. The min-nights gates below still count the windowed sample.
  const recent = <T,>(xs: T[]) => xs.slice(-SLEEP_AUTONOMIC_BASELINE_WINDOW_NIGHTS)
  const median = (xs: number[]) => {
    const a = [...xs].sort((p, q) => p - q)
    const mid = a.length >> 1
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2
  }
  const hrv = recent(nights.map(s => s.averageHrvMs).filter((v): v is number => v != null && v > 0))
  const hr = recent(nights.map(s => s.avgHeartRate).filter((v): v is number => v != null && v > 0))
  const localHour = (d: Date) => {
    const [h, m] = formatInTimeZone(d, tz, 'HH:mm').split(':').map(Number)
    return h + m / 60
  }

  const awakeFractions = nights
    .filter(s => s.awakHours != null && s.awakHours >= 0 && (s.durationHours ?? 0) > 0)
    .map(s => s.awakHours! / (s.durationHours! + s.awakHours!))
  const awakeFractionBaselineMean = awakeFractions.length >= SLEEP_AWAKE_FRACTION_BASELINE_MIN_NIGHTS
    ? mean(awakeFractions) : null
  const awakeFractionBaselineSd = awakeFractionBaselineMean != null
    ? Math.sqrt(mean(awakeFractions.map(v => (v - awakeFractionBaselineMean) ** 2)))
    : null

  return {
    hrvBaselineMs: hrv.length >= SLEEP_HRV_BASELINE_MIN_NIGHTS ? median(hrv) : null,
    hrBaselineBpm: hr.length >= SLEEP_HR_BASELINE_MIN_NIGHTS ? median(hr) : null,
    habitualBedHour: nights.length >= SLEEP_SCHEDULE_MIN_NIGHTS ? circularMeanHour(nights.map(s => localHour(s.sleepStart))) : null,
    habitualWakeHour: nights.length >= SLEEP_SCHEDULE_MIN_NIGHTS ? circularMeanHour(nights.map(s => localHour(s.sleepEnd))) : null,
    awakeFractionBaselineMean,
    awakeFractionBaselineSd,
  }
}

/**
 * Compute our own 0–100 Sleep Score from a sleep session. Returns null when there isn't even a
 * duration to score. Contributors are included only when their input is present, and the
 * weighted mean is renormalised over the included weights.
 */
export function computeSleepScore(
  session: SleepSession,
  tz: string = DEFAULT_TZ,
  opts: SleepScoreOptions = {},
): SleepScoreResult | null {
  const duration = session.durationHours
  if (duration == null || duration <= 0) return null

  const parts: { key: string; weight: number; sub: number }[] = []
  const add = (key: string, weight: number, sub: number) => parts.push({ key, weight, sub: clamp100(sub) })

  add('totalSleep', SLEEP_WEIGHTS.totalSleep, interp(duration, TOTAL_SLEEP))

  if (session.efficiency != null) add('efficiency', SLEEP_WEIGHTS.efficiency, interp(session.efficiency, EFFICIENCY))
  if (session.remSleepHours != null) add('rem', SLEEP_WEIGHTS.rem, interp(session.remSleepHours, REM))
  if (session.deepSleepHours != null) add('deep', SLEEP_WEIGHTS.deep, interp(session.deepSleepHours, DEEP))
  if (session.onsetLatencySec != null) add('latency', SLEEP_WEIGHTS.latency, interp(session.onsetLatencySec / 60, LATENCY))

  add('timing', SLEEP_WEIGHTS.timing, interp(circularDist(midpointHour(session.sleepStart, session.sleepEnd, tz), IDEAL_MIDPOINT_HOUR), TIMING))

  // Overnight HRV vs the personal baseline — the strongest recovery signal, opt-in via a supplied
  // baseline so it never fabricates a value for callers/nights that lack one.
  if (opts.hrvBaselineMs != null && opts.hrvBaselineMs > 0 && session.averageHrvMs != null && session.averageHrvMs > 0) {
    add('hrv', SLEEP_WEIGHTS.hrv, interp(session.averageHrvMs / opts.hrvBaselineMs, HRV_RATIO))
  }

  // Overnight average HR vs the personal baseline — the other half of the autonomic picture, and the
  // signal that separated the 2026-07-25 night from a normal one. Same opt-in shape as `hrv`.
  if (opts.hrBaselineBpm != null && opts.hrBaselineBpm > 0 && session.avgHeartRate != null && session.avgHeartRate > 0) {
    add('hr', SLEEP_WEIGHTS.hr, interp(session.avgHeartRate / opts.hrBaselineBpm, HR_RATIO))
  }

  // Schedule — how far this night's bed and wake times sat from the sleeper's habitual ones. Catches
  // the early awakening that a duration-only view hides (7.00 h looks fine; waking at 05:19 against a
  // 06:35 habit does not). Circular distance, so a post-midnight bedtime doesn't read as ~24 h off.
  if (opts.habitualBedHour != null && opts.habitualWakeHour != null) {
    const lateBed = signedHourDelta(midpointHourOf(session.sleepStart, tz), opts.habitualBedHour)
    const earlyWake = -signedHourDelta(midpointHourOf(session.sleepEnd, tz), opts.habitualWakeHour)
    add('schedule', SLEEP_WEIGHTS.schedule, interp(Math.max(0, lateBed, earlyWake), SCHEDULE_DEV))
  }

  // Restfulness — efficiency, less time spent awake inside the window. `restlessPeriods` is not
  // read here: see the note on AWAKE_PENALTY above (finding Q-3).
  const awakeFrac = session.awakHours != null && session.awakHours >= 0
    ? session.awakHours / (duration + session.awakHours)
    : null
  if (session.efficiency != null || session.awakHours != null) {
    const base = session.efficiency ?? RESTFULNESS_FALLBACK_BASE
    const awakePenalty = awakeFrac != null ? interp(awakeFrac, AWAKE_PENALTY) : 0
    add('restfulness', SLEEP_WEIGHTS.restfulness, base - awakePenalty)
  }

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0)
  const preCapScore = clamp100(Math.round(parts.reduce((s, p) => s + p.weight * p.sub, 0) / totalWeight))

  const components: Record<string, number> = {}
  for (const p of parts) components[p.key] = Math.round(p.sub)

  // Awake-time fragmentation cap — standalone, see AWAKE_FRAGMENTATION_CAP above. Only ever lowers
  // the score, and only once a mature personal baseline exists; every other night is unaffected.
  let score = preCapScore
  let fragmentationCap: SleepScoreResult['fragmentationCap'] = null
  if (
    awakeFrac != null &&
    opts.awakeFractionBaselineMean != null &&
    opts.awakeFractionBaselineSd != null &&
    opts.awakeFractionBaselineSd > 0
  ) {
    const z = (awakeFrac - opts.awakeFractionBaselineMean) / opts.awakeFractionBaselineSd
    const cap = Math.round(interp(z, AWAKE_FRAGMENTATION_CAP))
    if (cap < preCapScore) {
      score = cap
      fragmentationCap = {
        awakeFraction: Math.round(awakeFrac * 1000) / 1000,
        baselineMean: Math.round(opts.awakeFractionBaselineMean * 1000) / 1000,
        baselineSd: Math.round(opts.awakeFractionBaselineSd * 1000) / 1000,
        z: Math.round(z * 100) / 100,
        cap,
      }
    }
  }

  return { score: clamp100(score), preCapScore, components, fragmentationCap }
}

/** Signed hours from `ref` to `h` on a 24-hour clock, in [−12, 12). Positive = later than `ref`.
 *  The +36 keeps the modulo operand positive for any plausible input before recentring on zero. */
function signedHourDelta(h: number, ref: number): number {
  return ((h - ref + 36) % 24) - 12
}

/** Circular distance between two hours on a 24-hour clock (0..12). */
function circularDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 24
  return Math.min(d, 24 - d)
}

// SleepScoreResult.components keys → the Oura Cloud daily_sleep contributor key names
// (the vocabulary oura_daily.sleep_contributors already uses and ContributorBars renders).
// One mapping, one place — both the oura_daily_derived persist and the readiness-score
// response fallback go through this, so own-data bars are indistinguishable from Cloud bars.
const CONTRIBUTOR_KEYS: Record<string, string> = {
  totalSleep: 'total_sleep',
  rem: 'rem_sleep',
  deep: 'deep_sleep',
  efficiency: 'efficiency',
  latency: 'latency',
  timing: 'timing',
  restfulness: 'restfulness',
}

export function sleepComponentsToContributors(components: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(components)) out[CONTRIBUTOR_KEYS[k] ?? k] = v
  return out
}
