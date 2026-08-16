// Generic bucketed-correlation engine, extracted from
// app/api/sleep-performance-correlation/route.ts so all trend views share it.

export interface BucketDef { label: string; min: number; max: number } // [min, max)
export interface CorrelationBucket { label: string; avg: number; count: number }

export function bucketize(
  points: Array<{ x: number; y: number }>,
  defs: BucketDef[],
): CorrelationBucket[] {
  const acc = new Map<string, number[]>(defs.map(d => [d.label, []]))
  for (const p of points) {
    const def = defs.find(d => p.x >= d.min && p.x < d.max)
    if (def) acc.get(def.label)!.push(p.y)
  }
  return defs
    .map(d => {
      const ys = acc.get(d.label)!
      return {
        label: d.label,
        avg: ys.length ? parseFloat((ys.reduce((a, v) => a + v, 0) / ys.length).toFixed(1)) : 0,
        count: ys.length,
      }
    })
    .filter(b => b.count > 0)
}

export function computeBaselines(
  valuesByKey: Map<string, number[]>,
  minSamples = 3,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const [key, vals] of valuesByKey) {
    if (vals.length >= minSamples) out.set(key, vals.reduce((a, v) => a + v, 0) / vals.length)
  }
  return out
}

export function pctFromBaseline(value: number, baseline: number): number {
  return ((value - baseline) / baseline) * 100
}

// ── Significance ────────────────────────────────────────────────────────────────────────────────
// Added 2026-08-05. Before this the engine rendered a confident sentence whenever the best and
// worst bucket differed by more than one raw unit, with no test of any kind. Measured against real
// production data, five strong-looking correlations were checked and ALL FIVE failed a control the
// engine did not apply: three vanished once the date trend was removed (overnight HRV correlates
// with the calendar at r = 0.79, so anything else drifting with date correlates with HRV for free),
// one was an artefact of degenerate rows, and one reversed direction under correct coding. The
// engine would have shipped every one as a finding about the owner's own body.

export interface CorrelationStats {
  /** Paired observations behind the claim. */
  n: number
  /** Pearson r over the raw pairs. */
  r: number
  /** Two-tailed p for r. */
  p: number
  /** r with the covariate partialled out, when a control series was supplied. */
  partialR?: number
  /** p for partialR. */
  partialP?: number
}

/** Pearson r. Null below 3 pairs, or when either series is constant. */
export function pearson(points: Array<{ x: number; y: number }>): number | null {
  const n = points.length
  if (n < 3) return null
  let sx = 0, sy = 0
  for (const p of points) { sx += p.x; sy += p.y }
  const mx = sx / n, my = sy / n
  let sxy = 0, sxx = 0, syy = 0
  for (const p of points) {
    const dx = p.x - mx, dy = p.y - my
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy
  }
  // A constant series has no correlation — which is not the same as r = 0, and returning 0 here
  // would let it pass a "no relationship" check as if it had been measured.
  if (sxx === 0 || syy === 0) return null
  return sxy / Math.sqrt(sxx * syy)
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 erf approximation, |error| < 1.5e-7). */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

/**
 * Two-tailed p for a Pearson r, via the Fisher z-transform.
 *
 * The exact test is a Student-t on n−2 df, which needs an incomplete beta function. Fisher z with a
 * normal approximation is a few lines, is accurate from roughly n ≥ 10, and this is a **filter**
 * rather than a published statistic — its job is to stop an unchecked claim reaching the owner, and
 * the sample-size floor below refuses anything small enough for the approximation to matter.
 * Returns 1 ("no evidence") below 4 pairs, where z is not usable.
 */
export function pValueForR(r: number, n: number): number {
  if (n < 4 || !Number.isFinite(r)) return 1
  if (Math.abs(r) >= 1) return 0
  const z = Math.atanh(r) * Math.sqrt(n - 3)
  return 2 * (1 - normalCdf(Math.abs(z)))
}

/**
 * r between x and y with `c` partialled out — the control the review found mattered most.
 *
 * Any two series that both drift with the calendar correlate with each other for free. Passing the
 * day index as `c` asks whether the relationship survives once that shared drift is removed.
 */
export function partialCorrelation(points: Array<{ x: number; y: number; c: number }>): number | null {
  const rxy = pearson(points)
  const rxc = pearson(points.map(p => ({ x: p.x, y: p.c })))
  const ryc = pearson(points.map(p => ({ x: p.y, y: p.c })))
  if (rxy === null || rxc === null || ryc === null) return null
  const denom = Math.sqrt((1 - rxc * rxc) * (1 - ryc * ryc))
  if (denom === 0) return null
  return (rxy - rxc * ryc) / denom
}

/** Why a sentence was withheld. Each gets its own copy — "we checked and found nothing" and "we
 *  did not check" must never read the same, which is exactly what the old single fallback did. */
export type WithheldReason = 'sample' | 'significance' | 'confounded' | 'effect'

export interface CorrelationOptions {
  /** The raw pairs behind the buckets. Without them no test can run and the gate is skipped —
   *  the pre-2026-08-05 behaviour, kept only so an un-migrated caller still compiles. */
  points?: Array<{ x: number; y: number }>
  /** Covariate per point, same order as `points` — the day index in every current caller. */
  control?: number[]
  /** Two-tailed significance threshold. */
  alpha?: number
  /** Minimum paired observations. Below this nothing is claimed, whatever r says. */
  minN?: number
}

export interface CorrelationResult {
  insight: string
  hasSufficientData: boolean
  stats?: CorrelationStats
  withheld?: WithheldReason
}

const DEFAULT_ALPHA = 0.05
const DEFAULT_MIN_N = 20

// Best-vs-worst sentence used by every bucketed view. minCount guards noise.
//
// minCount default raised 3 → 5 on 2026-08-05: three observations in a bucket cannot support a
// claim about someone's body, and the old default let a bucket of exactly three set the headline.
export function correlationInsight(
  buckets: CorrelationBucket[],
  render: (best: CorrelationBucket, worst: CorrelationBucket) => string,
  minCount = 5,
  texts?: { insufficient?: string; noDifference?: string },
  opts?: CorrelationOptions,
): CorrelationResult {
  const eligible = buckets.filter(b => b.count >= minCount)
  const hasSufficientData = eligible.length >= 2
  if (!hasSufficientData) {
    return { insight: texts?.insufficient ?? 'Not enough paired data yet.', hasSufficientData }
  }
  const best = [...eligible].sort((a, b) => b.avg - a.avg)[0]
  const worst = [...eligible].sort((a, b) => a.avg - b.avg)[0]

  const points = opts?.points
  if (!points) {
    // Untested path: no pairs supplied, so only the raw effect size is checked — as before.
    if (best.label === worst.label || Math.abs(best.avg - worst.avg) <= 1) {
      return { insight: texts?.noDifference ?? 'No meaningful difference across buckets so far.', hasSufficientData, withheld: 'effect' }
    }
    return { insight: render(best, worst), hasSufficientData }
  }

  const alpha = opts?.alpha ?? DEFAULT_ALPHA
  const minN = opts?.minN ?? DEFAULT_MIN_N
  const n = points.length
  const r = pearson(points) ?? 0
  const p = pValueForR(r, n)
  const stats: CorrelationStats = { n, r: round3(r), p: round3(p) }

  if (n < minN) {
    return { insight: `Only ${n} paired days so far — not enough to say anything either way.`, hasSufficientData, stats, withheld: 'sample' }
  }

  if (p > alpha) {
    return { insight: `No reliable relationship across ${n} paired days — the pattern is within what chance alone would produce.`, hasSufficientData, stats, withheld: 'significance' }
  }

  if (opts?.control && opts.control.length === n) {
    const control = opts.control
    const pr = partialCorrelation(points.map((pt, i) => ({ ...pt, c: control[i] })))
    if (pr !== null) {
      const pp = pValueForR(pr, n)
      stats.partialR = round3(pr)
      stats.partialP = round3(pp)
      if (pp > alpha) {
        return {
          insight: `This pattern disappears once the calendar trend is removed — both measures have simply been drifting together over ${n} days.`,
          hasSufficientData, stats, withheld: 'confounded',
        }
      }
    }
  }

  if (best.label === worst.label || Math.abs(best.avg - worst.avg) <= 1) {
    return { insight: texts?.noDifference ?? 'No meaningful difference across buckets so far.', hasSufficientData, stats, withheld: 'effect' }
  }

  return { insight: `${render(best, worst)} (${n} paired days)`, hasSufficientData, stats }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}
