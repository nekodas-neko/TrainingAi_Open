// Is today's readiness score unusual for this person? The readiness half of the outlier-gated
// rating prompt (#2105), shaped on `sleep-verdict.ts` for the same reasons that file gives:
//
//  1. **Median ± IQR over a trailing window, not mean ± sd.** Readiness is bounded 0–100 and
//     skewed, and one bad day must not widen the band that judges the next.
//  2. **The caller snapshots the score, the band and the contributors beside the verdict.**
//     `oura_daily_derived.readiness_score` is rewritten on every `/api/readiness-score` read, and a
//     model change re-scores the day on its next read. A rating stored without the number it was
//     answering would decay into noise when either happens, with no sign that it had.
//  3. **A rule version beside the verdict**, so a recalibration cannot leave two rules sharing one.
//
// What does NOT carry over from sleep: the sleep verdict announces and takes a correction, while
// readiness asks for a rating on an unusual day. That interaction belongs to the surface (LB-193);
// this module only decides whether today is unusual.
//
// **This is not a scoring change.** It reads scores the readiness model already stored and moves
// none of them. Nothing here may feed back into `computeReadinessComposite`.

import { iqrBand } from '@trainingai/shared/stats'

/** Scored days of history the band needs before it may judge anything. A window of 28 needs 28. */
export const READINESS_VERDICT_BASELINE_DAYS = 28

/**
 * How far outside the interquartile range a score must sit to be called unusual, in IQRs.
 *
 * **0.65, calibrated on the owner's real readiness scores (#2430, signed off 2026-10-06) to about
 * five prompts a month.** It was 1.00, copied from the sleep verdict's `VERDICT_IQR_MULTIPLIER`:
 * sleep's 1.00 was swept over his nights to give 4–6 a month, and readiness has its own spread, so
 * the copy gave an unknown rate. The rate is the target and this number is only how it is reached.
 * **Confidence is low** (the sweep judged 55 days, so a handful of prompts decides it): the owner's
 * instruction is to re-check after 30 more days of scores, and a change then moves
 * `READINESS_VERDICT_MODEL_VERSION` with it.
 *
 * A separate constant rather than an import on purpose: a later sleep recalibration must not
 * silently move the readiness rule without bumping this file's version.
 */
export const READINESS_VERDICT_IQR_MULTIPLIER = 0.65

/** Bumped whenever the verdict rule changes, so a stored snapshot says which rule produced it.
 *  v1: trailing 28 scored days, median ± 1.00 × IQR, strict inequality at the band edges.
 *  v2: the same, with the multiplier calibrated to 0.65 (#2430).
 *  v3: the baseline holds only days on the target's readiness SCALE (#3778). */
export const READINESS_VERDICT_MODEL_VERSION = 3

/** Readiness model v18 moved the centre to 75 (#3778). */
const CENTRE_75_FROM_MODEL = 18

/**
 * #3778. Which scale a stored score is on: readiness v18 moved the centre from 50 to 75, which lifts
 * an ordinary day by about 6 points. A v18 day judged against 28 days of the old scale reads "better
 * than usual" for four weeks for no reason in the person, so the baseline keeps only days on the
 * target's scale and the verdict is silent until 28 of them exist, as it is for any short baseline.
 * Unstamped rows predate the stamp (Q-273), so they are on the old scale. Other version bumps do not
 * split the baseline; `baselineSameVersionDays` still reports those.
 */
export function readinessScaleOf(modelVersion: string | null): 'centre-50' | 'centre-75' {
  const n = modelVersion == null ? NaN : Number(/^v(\d+):/.exec(modelVersion)?.[1])
  return Number.isFinite(n) && n >= CENTRE_75_FROM_MODEL ? 'centre-75' : 'centre-50'
}

export type ReadinessVerdict = 'normal' | 'poor' | 'good'

/** One day's stored readiness, reduced to what the verdict reads. */
export interface ReadinessVerdictDay {
  /** The readiness day, `YYYY-MM-DD` — the same key as `oura_daily_derived.day`. */
  date: string
  score: number | null
  /** `model_versions.readiness` stamped on the row. Null on rows written before 2026-08-18. */
  modelVersion: string | null
}

export interface ReadinessVerdictBand {
  median: number
  low: number
  high: number
}

export interface ReadinessVerdictResult {
  verdict: ReadinessVerdict
  /** The score as judged. Snapshot it. */
  score: number
  /** The band it was judged against. Snapshot it too — see the header. */
  band: ReadinessVerdictBand
  /** Scored days that fed the band. Never below READINESS_VERDICT_BASELINE_DAYS. */
  baselineDays: number
  /**
   * How many of `baselineDays` were scored by the SAME readiness model as `score`.
   *
   * The band is built from whatever scores are stored, and the readiness model changes often (five
   * versions between 2026-08-18 and 2026-10-06, two of them on 10-06), so a 28-day window usually
   * mixes them. Requiring a single version would leave the verdict silent for 28 days after every
   * model change, which so far is most of the time. So the window mixes versions, and this count
   * says by how much — a verdict whose band is all one model has `baselineSameVersionDays ===
   * baselineDays`, and analysis can filter on exactly that.
   */
  baselineSameVersionDays: number
  modelVersion: number
}

/** `model_versions.readiness` out of the row's JSONB, or null when the row carries no stamp. */
export function readinessModelVersionOf(modelVersions: unknown): string | null {
  if (modelVersions == null || typeof modelVersions !== 'object' || Array.isArray(modelVersions)) return null
  const v = (modelVersions as { readiness?: unknown }).readiness
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** Stored derived rows, reduced to the shape the verdict reads. */
export function toReadinessVerdictDays(
  rows: readonly { day: string; readinessScore: number | null; modelVersions: unknown }[],
): ReadinessVerdictDay[] {
  return rows.map(r => ({
    date: r.day,
    score: r.readinessScore,
    modelVersion: readinessModelVersionOf(r.modelVersions),
  }))
}

/**
 * Judge `target`'s score against the scored days before it.
 *
 * `history` is every day available; days on or after the target are ignored, so a day never helps
 * judge itself and a re-run over old data gives the answer it gave at the time. The band uses the
 * most recent `READINESS_VERDICT_BASELINE_DAYS` days that carry a score — days with no stored score
 * (the app was not opened, or nothing could be computed) are skipped rather than counted.
 *
 * Returns `null` when the target has no score or the baseline is short: there is nothing honest to
 * say off a thin baseline, and silence is the correct output rather than a guess.
 */
export function readinessVerdictForDay(
  target: ReadinessVerdictDay,
  history: readonly ReadinessVerdictDay[],
): ReadinessVerdictResult | null {
  const score = target.score
  if (score === null || !Number.isFinite(score)) return null

  const scale = readinessScaleOf(target.modelVersion)
  const baseline = history
    .filter(d => d.date < target.date && d.score !== null && Number.isFinite(d.score))
    .filter(d => readinessScaleOf(d.modelVersion) === scale)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, READINESS_VERDICT_BASELINE_DAYS)
  if (baseline.length < READINESS_VERDICT_BASELINE_DAYS) return null

  const band = iqrBand(baseline.map(d => d.score as number), READINESS_VERDICT_IQR_MULTIPLIER)
  if (!band) return null

  const verdict: ReadinessVerdict = score < band.low ? 'poor' : score > band.high ? 'good' : 'normal'
  const baselineSameVersionDays = target.modelVersion === null
    ? 0
    : baseline.filter(d => d.modelVersion === target.modelVersion).length

  return {
    verdict,
    score,
    band,
    baselineDays: baseline.length,
    baselineSameVersionDays,
    modelVersion: READINESS_VERDICT_MODEL_VERSION,
  }
}
