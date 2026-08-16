// Does a model order days the way the person living them does?
//
// THE one implementation of that question. It was written for the Sleep Score vs the owner's morning
// rating (finding Q-16) and generalised when Body Battery vs perceived recovery needed exactly the
// same treatment (Q-79) — same 1–5 self-report, same 0–100 model output, same failure modes. A
// second copy of the rank maths and the note rules is how two calibration surfaces start disagreeing
// about what "agreement" means.
//
// ## Why the comparisons here are rank-based
//
// The two scales are not commensurable. A 1–5 self-report spans its full range, while a model's
// observed range in production is often a narrow band near the top — so a raw `modelScore − rating`
// difference reads as a huge disagreement on nearly every day and says nothing. Rank correlation and
// per-bucket means are scale-free, so they measure the thing that matters: does the model put the
// days in the same order?
//
// ## The self-report convention
//
// Every 1–5 scale in `MORNING_SCALES` stores **1 = best … 5 = worst** (the on-screen selector may
// reverse this; the column does not). `ratingAsScore` inverts that onto the model's higher-is-better
// axis. Getting it backwards inverts every correlation reported, which is why it has its own test.

export interface CalibrationCopy {
  /** Singular noun for one observation — 'night', 'day'. */
  unit: string
  /** Plural of the above. */
  unitPlural: string
}

/** Stored 1 (best) … 5 (worst) re-expressed on a higher-is-better 0–100 axis, for plotting. */
export function ratingAsScore(stored: number): number {
  return ((5 - stored) / 4) * 100
}

export interface CalibrationRow {
  /** The day the model scored and the rating describes, YYYY-MM-DD. */
  date: string
  /** What the model gives that day. Null when the day is unscorable. */
  modelScore: number | null
  /** The stored 1–5 rating. Null on a day with no check-in. */
  rating: number | null
  ratingLabel: string | null
  /** `rating` on the model's 0–100 axis. Null when `rating` is null. */
  ratingAsScore: number | null
  /**
   * How far apart the two put this day, in percentile points, over the days that have both.
   * 0 = ranked identically; 100 = one calls it the best day and the other the worst. Null unless the
   * day has both a score and a rating.
   */
  rankGapPct: number | null
}

export interface CalibrationBucket {
  rating: number
  label: string
  count: number
  meanModelScore: number | null
  minModelScore: number | null
  maxModelScore: number | null
}

export interface CalibrationRange {
  min: number
  max: number
  spread: number
}

export interface ModelReportCalibration {
  from: string
  to: string
  rows: CalibrationRow[]
  /** One entry per stored rating 1–5, always all five, so an unused rating reads as `count: 0`. */
  buckets: CalibrationBucket[]
  /** Days carrying both a model score and a rating — everything below is computed over these. */
  paired: number
  /**
   * Spearman rank correlation between the model score and the rating-as-goodness. +1 = the model
   * orders days exactly as the person does, 0 = no relationship, −1 = exactly inverted. Null with
   * fewer than {@link MIN_PAIRED_FOR_CORRELATION} paired days, or when either side is constant.
   */
  spearman: number | null
  /** The model's observed spread over the window — how much range it actually uses. */
  modelRange: CalibrationRange | null
  /** The person's observed spread, on the same 0–100 axis, for comparison against `modelRange`. */
  ratingRange: CalibrationRange | null
  /** Days where the two disagree most, worst first — the list worth inspecting when tuning. */
  worstDisagreements: CalibrationRow[]
  /** Plain-language observations derived from the numbers above. Never a scoring input. */
  notes: string[]
}

/** Below this, a correlation over daily self-ratings is noise and is not reported. */
export const MIN_PAIRED_FOR_CORRELATION = 8
/** How many disagreement rows to surface. */
const WORST_LIMIT = 5
/** A bucket mean is only compared against its neighbours when it has at least this many days. */
const MIN_BUCKET_FOR_MONOTONICITY = 2

/** Average ranks (1-based), ties sharing the mean of the positions they span. */
function averageRanks(values: number[]): number[] {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b])
  const ranks = new Array<number>(values.length)
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && values[order[j + 1]] === values[order[i]]) j++
    const shared = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[order[k]] = shared
    i = j + 1
  }
  return ranks
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    dx += (xs[i] - mx) ** 2
    dy += (ys[i] - my) ** 2
  }
  const den = Math.sqrt(dx * dy)
  // A constant series has zero variance — the correlation is undefined, not zero.
  return den > 0 ? num / den : null
}

const round1 = (v: number) => Math.round(v * 10) / 10

export interface BuildCalibrationInput {
  from: string
  to: string
  /** Model output per date. Produced by the real model — never recomputed here. */
  modelByDate: Map<string, number | null>
  /** Stored 1–5 self-report per check-in date. */
  ratingByDate: Map<string, number | null>
  /** Labels for stored 1…5, index 0 = stored 1 (the best end). */
  labels: readonly string[]
  copy: CalibrationCopy
}

/**
 * Join a model's output to the matching self-report and describe how well they agree.
 *
 * Pure: it receives already-computed model values and never computes one itself, so it cannot become
 * a second implementation of whatever model it is checking.
 */
export function buildModelReportCalibration(
  { from, to, modelByDate, ratingByDate, labels, copy }: BuildCalibrationInput,
): ModelReportCalibration {
  const { unit, unitPlural } = copy
  const labelOf = (stored: number) => labels[stored - 1] ?? String(stored)

  const dates = [...new Set([...modelByDate.keys(), ...ratingByDate.keys()])]
    .filter(d => d >= from && d <= to)
    .sort()

  const rows: CalibrationRow[] = dates.map(date => {
    const modelScore = modelByDate.get(date) ?? null
    const rating = ratingByDate.get(date) ?? null
    return {
      date,
      modelScore,
      rating,
      ratingLabel: rating != null ? labelOf(rating) : null,
      ratingAsScore: rating != null ? ratingAsScore(rating) : null,
      rankGapPct: null,
    }
  })

  const pairedRows = rows.filter(r => r.modelScore != null && r.rating != null)
  const paired = pairedRows.length

  const buckets: CalibrationBucket[] = [1, 2, 3, 4, 5].map(rating => {
    const scores = pairedRows.filter(r => r.rating === rating).map(r => r.modelScore!)
    return {
      rating,
      label: labelOf(rating),
      count: scores.length,
      meanModelScore: scores.length ? round1(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      minModelScore: scores.length ? Math.min(...scores) : null,
      maxModelScore: scores.length ? Math.max(...scores) : null,
    }
  })

  let spearman: number | null = null
  if (paired >= MIN_PAIRED_FOR_CORRELATION) {
    const modelRanks = averageRanks(pairedRows.map(r => r.modelScore!))
    const ratingRanks = averageRanks(pairedRows.map(r => ratingAsScore(r.rating!)))
    const rho = pearson(modelRanks, ratingRanks)
    spearman = rho == null ? null : Math.round(rho * 1000) / 1000

    // Percentile position on each scale, so the gap is comparable across differently-sized windows.
    const pct = (rank: number) => (paired > 1 ? ((rank - 1) / (paired - 1)) * 100 : 0)
    pairedRows.forEach((row, i) => {
      row.rankGapPct = Math.round(Math.abs(pct(modelRanks[i]) - pct(ratingRanks[i])))
    })
  }

  const spread = (vals: number[]): CalibrationRange | null =>
    vals.length ? { min: Math.min(...vals), max: Math.max(...vals), spread: round1(Math.max(...vals) - Math.min(...vals)) } : null
  const modelRange = spread(pairedRows.map(r => r.modelScore!))
  const ratingRange = spread(pairedRows.map(r => ratingAsScore(r.rating!)))

  const worstDisagreements = pairedRows
    .filter(r => r.rankGapPct != null)
    .sort((a, b) => b.rankGapPct! - a.rankGapPct!)
    .slice(0, WORST_LIMIT)

  const notes: string[] = []
  if (paired < MIN_PAIRED_FOR_CORRELATION) {
    notes.push(`Only ${paired} ${paired === 1 ? unit : unitPlural} carry both a score and a rating — ${MIN_PAIRED_FOR_CORRELATION} are needed before a correlation means anything.`)
  } else {
    if (spearman == null) {
      notes.push('One of the two series is constant over this window, so a rank correlation is undefined.')
    } else if (spearman >= 0.7) {
      notes.push(`The model orders ${unitPlural} close to the way you do.`)
    } else if (spearman >= 0.3) {
      notes.push('The model agrees on direction but not strongly — worth looking at the disagreements below.')
    } else if (spearman > -0.3) {
      notes.push('The model and your rating are close to unrelated over this window.')
    } else {
      notes.push(`The model is ordering ${unitPlural} roughly OPPOSITE to the way you do — check the contributor weights before tuning anything else.`)
    }

    if (modelRange && ratingRange && modelRange.spread < ratingRange.spread / 2) {
      notes.push(`Compression: the model uses ${modelRange.spread} points (${modelRange.min}–${modelRange.max}) where you use ${ratingRange.spread}. Even a ${unit} you rate badly still scores high, so the score reads flatter than the ${unitPlural} felt.`)
    }

    // Non-monotonicity is the most actionable finding — it means a worse-rated day scores HIGHER on
    // average than a better-rated one, which no amount of rescaling fixes.
    const usable = buckets.filter(b => b.count >= MIN_BUCKET_FOR_MONOTONICITY && b.meanModelScore != null)
    for (let i = 1; i < usable.length; i++) {
      const better = usable[i - 1]
      const worse = usable[i]
      if (worse.meanModelScore! > better.meanModelScore!) {
        notes.push(`Out of order: ${unitPlural} you rated "${worse.label}" average ${worse.meanModelScore} — higher than the "${better.label}" ${unitPlural} at ${better.meanModelScore}.`)
      }
    }
  }

  return { from, to, rows, buckets, paired, spearman, modelRange, ratingRange, worstDisagreements, notes }
}
