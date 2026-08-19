/**
 * Q-414 — the arithmetic behind "energy in against energy out, on one timeline".
 *
 * A `.ts` beside the chart rather than a `.tsx`: both vitest projects are `environment: 'node'`
 * with no `@testing-library/react`, so anything inside a component file cannot be unit-tested at
 * all. Keeping the maths here is the only way this is checkable, and it is maths worth checking.
 *
 * **The design decision this encodes, because it is not obvious and was nearly got wrong.**
 * The chart needs to say *when* energy was spent. The app's own expenditure model
 * (`computeActiveEnergy`) is MET × duration and returns **one number for the day** — its dominant
 * term is passive step energy, derived from a daily pedometer total with no timestamps anywhere.
 * Measured on production 2026-08-19: `step_live_windows`, which looks like the intra-day source,
 * holds 11 rows and 8,261 steps in its whole history against 668,749 counted in `body_metrics`.
 * 1.2%. There is no per-hour step data to draw.
 *
 * So this does **not** recompute expenditure per hour. It **distributes the day's already-computed
 * total** across the day, weighted by heart rate above resting:
 *
 *   - The total is exactly what `computeActiveEnergy` returned, untouched. One model, one answer —
 *     the chart cannot disagree with the figure printed above it, which is the entire reason
 *     **Q-401** exists (there were two TDEE models and they differed by 271 kcal).
 *   - The *shape* is measured, not assumed: `oura_heartrate` is timestamped and covers all 24
 *     hours — the ring alone lands a sample every 3–7 minutes around the clock, plus the chest
 *     strap during workouts.
 *
 * Both of the entry's rules then hold at once, which they could not under the first reading: the
 * curve ends exactly on the day's burn *because it is a partition of it*, and it is not smoother
 * than its data *because its shape comes from measurements*.
 *
 * **The honest limit, which the chart must state and this function cannot fix:** heart rate rises
 * for reasons that are not metabolic — stress, caffeine, standing up. This is a good proxy for when
 * energy went, not a measurement of it.
 */

/**
 * One bucket of the day's HR trace — `minute` from local midnight, `bpm` the bucket's MEAN.
 * This is `/api/day-log`'s `hr` payload verbatim (15-minute buckets, mean bpm), so the screen
 * already holds it and no extra request is needed.
 */
export interface HrBucket {
  minute: number
  bpm: number
}

/** One eaten thing, already resolved to when it was eaten (Q-413). */
export interface IntakeEvent {
  atMs: number
  kcal: number
}

export interface EnergyTimelineInput {
  /** Local-midnight instant of the day being drawn, in the user's timezone. */
  dayStartMs: number
  /** Resting heart rate, from `/api/hr-profile`. Buckets at or below it carry no active weight. */
  restingHr: number
  /** The day's resting/BMR term. Spread flat across the 24 hours. */
  restingBaseKcal: number
  /** The day's active term, exactly as `computeActiveEnergy` totalled it. Distributed by HR. */
  activeKcal: number
  hr: HrBucket[]
  intake: IntakeEvent[]
  /** Bucket width. 60 keeps every bucket comfortably above the ring's sample rate. */
  bucketMinutes?: number
}

export interface EnergyBucket {
  /** Minutes from local midnight at the bucket's start. */
  startMin: number
  /** Calories eaten inside this bucket — a discrete event total, not a rate. */
  intakeKcal: number
  /** Calories burned inside this bucket: its flat BMR share plus its HR-weighted active share. */
  burnKcal: number
  /** Cumulative intake through the end of this bucket. */
  intakeCumKcal: number
  /** Cumulative burn through the end of this bucket. */
  burnCumKcal: number
  /** True when no HR reading covers this bucket, so its active share was zero by absence. */
  hrGap: boolean
}

export interface EnergyTimeline {
  buckets: EnergyBucket[]
  /** Reconciliation handles, so a caller can assert the curve ends where the day's figures do. */
  totals: { intakeKcal: number; burnKcal: number }
  /** Buckets with no HR reading. All-24 means the day has no HR at all and the shape is flat. */
  hrGapBuckets: number
}

const MINUTES_PER_DAY = 24 * 60

/**
 * Build the day's two series.
 *
 * Distribution rule: each bucket's active share is proportional to its **mean** elevation above
 * resting, floored at zero, across equal-width buckets — which approximates ∫(bpm − resting)dt,
 * the thing that actually tracks energy.
 *
 * **Averaged, not summed, and the difference is not cosmetic.** Summing raw samples estimates that
 * integral only when the sampling rate is constant, and here it is emphatically not: measured over
 * 14 days, the chest strap logged 26,034 samples against the ring's 3,810, and it is only worn
 * during workouts. Weighting by sample count would hand a strap-worn workout on the order of a
 * hundred times the energy of an equally long, equally intense ring-only walk. The first draft of
 * this function summed, for the plausible-sounding reason that the ring wakes when you move — that
 * reasoning holds within one source and breaks completely across two.
 *
 * When no bucket clears resting anywhere in the day, the active term is spread flat rather than
 * dropped — dropping it would break the reconciliation the whole design rests on.
 */
export function buildEnergyTimeline(
  { dayStartMs, restingHr, restingBaseKcal, activeKcal, hr, intake, bucketMinutes = 60 }: EnergyTimelineInput,
): EnergyTimeline {
  const width = bucketMinutes > 0 ? bucketMinutes : 60
  const count = Math.ceil(MINUTES_PER_DAY / width)

  const elevationSum = new Array<number>(count).fill(0)
  const readings = new Array<number>(count).fill(0)
  const intakeKcal = new Array<number>(count).fill(0)

  const indexFor = (atMs: number): number | null => {
    const min = Math.floor((atMs - dayStartMs) / 60_000)
    if (min < 0 || min >= MINUTES_PER_DAY) return null
    return Math.floor(min / width)
  }

  for (const b of hr) {
    if (b.minute < 0 || b.minute >= MINUTES_PER_DAY) continue
    const i = Math.floor(b.minute / width)
    readings[i] += 1
    elevationSum[i] += Math.max(0, b.bpm - restingHr)
  }

  // Mean per bucket, so a bucket covered by many source readings does not out-vote one covered by
  // few. Buckets are equal width, so the means are directly comparable as a share of the day.
  const weight = elevationSum.map((sum, i) => (readings[i] > 0 ? sum / readings[i] : 0))

  for (const e of intake) {
    const i = indexFor(e.atMs)
    if (i === null) continue
    intakeKcal[i] += e.kcal
  }

  const weightTotal = weight.reduce((a, b) => a + b, 0)
  const restPerBucket = restingBaseKcal / count

  let intakeCum = 0
  let burnCum = 0
  const buckets: EnergyBucket[] = []
  for (let i = 0; i < count; i++) {
    // No usable HR anywhere in the day → flat, rather than an active term silently lost.
    const activeShare = weightTotal > 0 ? activeKcal * (weight[i] / weightTotal) : activeKcal / count
    const burn = restPerBucket + activeShare
    intakeCum += intakeKcal[i]
    burnCum += burn
    buckets.push({
      startMin: i * width,
      intakeKcal: intakeKcal[i],
      burnKcal: burn,
      intakeCumKcal: intakeCum,
      burnCumKcal: burnCum,
      hrGap: readings[i] === 0,
    })
  }

  return {
    buckets,
    totals: { intakeKcal: intakeCum, burnKcal: burnCum },
    hrGapBuckets: buckets.filter(b => b.hrGap).length,
  }
}
