// Sleep Score vs the owner's own rating — a calibration record, not a scoring input.
//
// Owner decision (2026-07-27, audit finding Q-16): `day_checkins.sleep_quality_feel` stays OUT of
// the Sleep Score and becomes "something to look back on when tuning". This module is that look:
// it puts each night's model score next to what the owner said the next morning, so a systematic
// disagreement is visible and the curves can be tuned against it.
//
// The rank maths, bucketing and note rules live in `model-report-calibration.ts` — this file is the
// sleep-shaped adapter over them (Q-79 generalised the engine when Body Battery vs perceived
// recovery turned out to be the same question). Its own vocabulary is kept: this surface talks about
// nights and how they *felt*, and the battery one talks about days and recovery.
import {
  buildModelReportCalibration,
  ratingAsScore,
  MIN_PAIRED_FOR_CORRELATION,
  type CalibrationRange,
} from '@trainingai/shared/health/model-report-calibration'
import { storedOrderLabels } from '@trainingai/shared/types/day-checkin'

export { MIN_PAIRED_FOR_CORRELATION }

/** Stored 1 = slept great … 5 = terrible (the on-screen selector reverses this, the column does
 *  not). Index 0 holds stored value 1. Derived from the check-in's own copy rather than restated,
 *  so a reworded scale cannot leave this calibration labelling nights with the old words. */
export const SLEEP_FEEL_LABELS = storedOrderLabels('sleepQualityFeel')

export function sleepFeelLabel(stored: number): string {
  return SLEEP_FEEL_LABELS[stored - 1] ?? String(stored)
}

/**
 * The stored rating re-expressed on the model's "higher is better" 0–100 axis, so the two can be
 * plotted on one chart. Stored 1 (great) → 100, stored 5 (terrible) → 0.
 *
 * This is a presentation transform only. It is deliberately NOT treated as commensurable with the
 * model score — see the engine's module header.
 */
export const sleepFeelAsScore = ratingAsScore

export interface SleepFeelRow {
  /** Wake day, YYYY-MM-DD — the morning the rating was given, and the day the night ended. */
  date: string
  /** The Sleep Score the CURRENT model gives that night. Null when the night is unscorable. */
  modelScore: number | null
  /** The stored 1–5 rating. Null on a morning with no check-in. */
  feel: number | null
  feelLabel: string | null
  /** `feel` on the model's 0–100 axis, for plotting. Null when `feel` is null. */
  feelAsScore: number | null
  /**
   * How far apart the two put this night, in percentile points, over the nights that have both.
   * 0 = the model and the owner rank it identically; 100 = one calls it the best night and the
   * other the worst. Null unless the night has both a score and a rating.
   */
  rankGapPct: number | null
}

export interface SleepFeelBucket {
  feel: number
  label: string
  nights: number
  meanModelScore: number | null
  minModelScore: number | null
  maxModelScore: number | null
}

export interface SleepFeelCalibration {
  from: string
  to: string
  rows: SleepFeelRow[]
  /** One entry per stored rating 1–5, always all five, so an unused rating reads as `nights: 0`. */
  buckets: SleepFeelBucket[]
  /** Nights carrying both a model score and a rating — everything below is computed over these. */
  paired: number
  /**
   * Spearman rank correlation between the model score and the rating-as-goodness. +1 = the model
   * orders nights exactly as the owner does, 0 = no relationship, −1 = exactly inverted. Null with
   * fewer than {@link MIN_PAIRED_FOR_CORRELATION} paired nights, or when either side is constant.
   */
  spearman: number | null
  /** The model's observed spread over the window — how much range it actually uses. */
  modelRange: CalibrationRange | null
  /** The owner's observed spread, on the same 0–100 axis, for comparison against `modelRange`. */
  feelRange: CalibrationRange | null
  /** Nights where the two disagree most, worst first — the list worth inspecting when tuning. */
  worstDisagreements: SleepFeelRow[]
  /** Plain-language observations derived from the numbers above. Never a scoring input. */
  notes: string[]
}

export interface BuildSleepFeelCalibrationInput {
  from: string
  to: string
  /** Model Sleep Score per wake day. Produced by the real scorer — never recomputed here. */
  scoresByDate: Map<string, number | null>
  /** Stored `sleep_quality_feel` (1–5) per morning check-in date. */
  feelByDate: Map<string, number | null>
}

/** Join the model's scores to the owner's ratings and describe how well they agree. */
export function buildSleepFeelCalibration(
  { from, to, scoresByDate, feelByDate }: BuildSleepFeelCalibrationInput,
): SleepFeelCalibration {
  const c = buildModelReportCalibration({
    from,
    to,
    modelByDate: scoresByDate,
    ratingByDate: feelByDate,
    labels: SLEEP_FEEL_LABELS,
    copy: { unit: 'night', unitPlural: 'nights' },
  })
  const row = (r: typeof c.rows[number]): SleepFeelRow => ({
    date: r.date,
    modelScore: r.modelScore,
    feel: r.rating,
    feelLabel: r.ratingLabel,
    feelAsScore: r.ratingAsScore,
    rankGapPct: r.rankGapPct,
  })
  return {
    from: c.from,
    to: c.to,
    rows: c.rows.map(row),
    buckets: c.buckets.map(b => ({
      feel: b.rating,
      label: b.label,
      nights: b.count,
      meanModelScore: b.meanModelScore,
      minModelScore: b.minModelScore,
      maxModelScore: b.maxModelScore,
    })),
    paired: c.paired,
    spearman: c.spearman,
    modelRange: c.modelRange,
    feelRange: c.ratingRange,
    worstDisagreements: c.worstDisagreements.map(row),
    notes: c.notes,
  }
}
