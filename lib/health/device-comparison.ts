// Aligning several devices' series onto one time grid, and scoring how far apart they are.
//
// `lib/oura-comparison-harness.ts` answers "ours vs one reference" and is the right tool for a
// single pairing. This is the N-device view the owner asked for — three devices side by side in one
// table — which that harness cannot express, since a `ComparisonPoint` holds exactly two values.
//
// PURE: no I/O, no clock.
//
// **Bucket width is the whole game and the default is wrong for rings.** These three devices sample
// at wildly different cadences: the Polar H10 emits ~1 Hz, the Oura ring's rollup bins at 5 minutes,
// and the Colmi's heart-rate log runs at whatever interval its switch is set to (5 minutes at the
// finest). Align two 5-minute devices on a 1-minute grid and they land in the same bucket only when
// their phases happen to coincide — so `overlap` reads 0, every statistic returns null, and the
// output looks like two devices that never agreed rather than two that were never compared.
//
// Bucket to the COARSEST cadence among the devices being compared, not the finest.
import { spearman } from '@trainingai/shared/health/correlation'

export interface NamedSeries {
  device: string
  points: { bucketStart: string; value: number }[]
  /**
   * What the values are in. Two series with different units can be compared for **rank agreement**
   * and for nothing else (PS-15): Oura's daytime stress is normalised −1..+1 and the Colmi's is raw
   * 0..100, so a mean bias between them is a number in mixed units — which is worse than no number,
   * because it prints and looks like a measurement.
   */
  unit?: string
  /**
   * The series' own sampling interval in minutes, where it is known from the source rather than
   * guessed. Feeds `coarsestCadenceMinutes`.
   */
  cadenceMinutes?: number
}

export interface AlignedRow {
  bucketStart: string
  /** One entry per device. `null` where that device has no sample in the bucket — which is a
   *  finding in itself (coverage), not a gap to be interpolated over. */
  values: Record<string, number | null>
}

/**
 * Why a pair has no statistics — the distinction PS-15 was filed for.
 *
 * `overlap: 0` used to be the whole story, and it reads as "these two devices never agreed". Three
 * different situations produce it and only one of them is a disagreement:
 *
 *  - `no-data` — at least one device reported nothing in the window. Nothing to compare.
 *  - `out-of-phase` — both reported, and they never once landed in the same bucket. **This is a
 *    grid problem, not a device problem.** Oura's stress buckets sit at :15 and :45 and the Colmi's
 *    at :00 and :30, permanently 15 minutes apart, so at a 5-minute width no pair can ever form.
 *    Widen the bucket and the same two series correlate at rho = 0.64.
 *  - `compared` — they overlapped, and the numbers below mean something.
 */
export type PairVerdict = 'compared' | 'out-of-phase' | 'no-data'

export interface PairSummary {
  a: string
  b: string
  /** Buckets where BOTH devices reported. Every statistic below is over these only. */
  overlap: number
  verdict: PairVerdict
  /** Null when the two series are in different units — see `NamedSeries.unit`. A magnitude across
   *  incommensurable scales is not a weaker measurement, it is not one. */
  meanAbsDelta: number | null
  maxAbsDelta: number | null
  /** Mean signed `a - b`. Separated from `meanAbsDelta` on purpose: a device reading 5 high all day
   *  and one alternating ±5 have the same mean absolute error and are different problems. */
  meanBias: number | null
  /** Rank agreement. The one statistic that survives a unit mismatch, so it is reported for every
   *  compared pair rather than only the mismatched ones. */
  spearman: number | null
  /** Set when the magnitude statistics were suppressed, naming the two units. */
  unitsDiffer: string | null
}

/**
 * Bucket raw `(timestamp, value)` samples into means over `minutes`-wide windows, keyed by the
 * window's ISO start. Windows are anchored to the epoch, so every device lands on the same grid
 * regardless of when it happened to sample — which is what makes two devices comparable at all.
 */
export function bucketSeries(
  rows: { timestamp: Date; value: number }[],
  minutes: number,
): { bucketStart: string; value: number }[] {
  const width = Math.max(1, Math.round(minutes)) * 60_000
  const sums = new Map<number, { total: number; count: number }>()
  for (const r of rows) {
    const t = r.timestamp.getTime()
    if (!Number.isFinite(t)) continue
    const start = Math.floor(t / width) * width
    const entry = sums.get(start) ?? { total: 0, count: 0 }
    entry.total += r.value
    entry.count += 1
    sums.set(start, entry)
  }
  return [...sums.entries()]
    .map(([start, { total, count }]) => ({ bucketStart: new Date(start).toISOString(), value: total / count }))
    .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart))
}

/** Merge N series onto the union of their bucket starts, sorted. */
export function alignSeries(series: NamedSeries[]): AlignedRow[] {
  const byBucket = new Map<string, Record<string, number | null>>()
  const devices = series.map(s => s.device)

  for (const s of series) {
    for (const p of s.points) {
      let row = byBucket.get(p.bucketStart)
      if (!row) {
        row = {}
        for (const d of devices) row[d] = null
        byBucket.set(p.bucketStart, row)
      }
      row[s.device] = p.value
    }
  }

  return [...byBucket.entries()]
    .map(([bucketStart, values]) => ({ bucketStart, values }))
    .sort((x, y) => x.bucketStart.localeCompare(y.bucketStart))
}

/**
 * The bucket width two or more series can actually be compared at.
 *
 * **Bucketing finer than the coarsest device is why a comparison returns nothing** — it is the thing
 * this module's header has said since it was written and nothing implemented. A series sampled every
 * 30 minutes and another sampled every 30 minutes fifteen minutes out of phase share no 5-minute
 * bucket, ever; at 30 minutes, anchored to the epoch, they do.
 *
 * Cadence comes from the caller when the source knows it, and is otherwise estimated as the
 * **median** gap between consecutive samples — median, not mean, because one overnight gap in an
 * otherwise 5-minute series would drag a mean into hours.
 */
export function coarsestCadenceMinutes(series: NamedSeries[], fallbackMinutes = 5): number {
  let coarsest = 0
  for (const s of series) {
    const declared = s.cadenceMinutes
    const cadence = declared ?? medianGapMinutes(s.points)
    if (cadence != null && cadence > coarsest) coarsest = cadence
  }
  return coarsest > 0 ? Math.ceil(coarsest) : fallbackMinutes
}

function medianGapMinutes(points: { bucketStart: string }[]): number | null {
  if (points.length < 2) return null
  const times = points.map(p => Date.parse(p.bucketStart)).filter(Number.isFinite).sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1]
    if (gap > 0) gaps.push(gap)
  }
  if (gaps.length === 0) return null
  gaps.sort((a, b) => a - b)
  const mid = Math.floor(gaps.length / 2)
  const ms = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2
  return ms / 60_000
}

/**
 * Score one pair over the buckets where both reported.
 *
 * `units` decides which statistics are meaningful: matching units get magnitudes, mismatched ones
 * get rank agreement only. Omit it and both are reported, which is the old behaviour and right when
 * every device is in bpm.
 */
export function pairSummary(
  rows: AlignedRow[], a: string, b: string,
  units?: Record<string, string | undefined>,
): PairSummary {
  let absTotal = 0
  let signedTotal = 0
  let maxAbs: number | null = null
  const paired: { x: number; y: number }[] = []
  const seen = { [a]: false, [b]: false } as Record<string, boolean>

  for (const row of rows) {
    const va = row.values[a]
    const vb = row.values[b]
    if (va !== null && va !== undefined) seen[a] = true
    if (vb !== null && vb !== undefined) seen[b] = true
    if (va === null || va === undefined || vb === null || vb === undefined) continue
    paired.push({ x: va, y: vb })
    const delta = va - vb
    signedTotal += delta
    const abs = Math.abs(delta)
    absTotal += abs
    if (maxAbs === null || abs > maxAbs) maxAbs = abs
  }

  const overlap = paired.length
  const ua = units?.[a]
  const ub = units?.[b]
  const mismatch = ua != null && ub != null && ua !== ub
  // Both devices reported and still never shared a bucket: the grid is too fine for them, which is
  // not the same finding as "they disagree" and must not be reported as one.
  const verdict: PairVerdict = overlap > 0 ? 'compared' : (seen[a] && seen[b]) ? 'out-of-phase' : 'no-data'

  return {
    a, b, overlap, verdict,
    meanAbsDelta: overlap > 0 && !mismatch ? absTotal / overlap : null,
    maxAbsDelta: mismatch ? null : maxAbs,
    meanBias: overlap > 0 && !mismatch ? signedTotal / overlap : null,
    spearman: spearman(paired),
    unitsDiffer: mismatch ? `${ua} vs ${ub}` : null,
  }
}

/** Every unordered pair, in the order the devices were given. */
export function allPairSummaries(
  rows: AlignedRow[], devices: string[],
  units?: Record<string, string | undefined>,
): PairSummary[] {
  const out: PairSummary[] = []
  for (let i = 0; i < devices.length; i++) {
    for (let j = i + 1; j < devices.length; j++) out.push(pairSummary(rows, devices[i], devices[j], units))
  }
  return out
}

/** How many buckets each device covered — the denominator for every claim above. */
export function coverage(rows: AlignedRow[], devices: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of devices) out[d] = 0
  for (const row of rows) {
    for (const d of devices) {
      const v = row.values[d]
      if (v !== null && v !== undefined) out[d]++
    }
  }
  return out
}
