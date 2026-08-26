// Aligning several devices' series onto one time grid, and scoring how far apart they are.
//
// `lib/oura-comparison-harness.ts` answers "ours vs one reference" and is the right tool for a
// single pairing. This is the N-device view the owner asked for — three devices side by side in one
// table — which that harness cannot express, since a `ComparisonPoint` holds exactly two values.
//
// PURE: no I/O, no clock. The caller buckets and supplies the series.
export interface NamedSeries {
  device: string
  points: { bucketStart: string; value: number }[]
}

export interface AlignedRow {
  bucketStart: string
  /** One entry per device. `null` where that device has no sample in the bucket — which is a
   *  finding in itself (coverage), not a gap to be interpolated over. */
  values: Record<string, number | null>
}

export interface PairSummary {
  a: string
  b: string
  /** Buckets where BOTH devices reported. Every statistic below is over these only. */
  overlap: number
  meanAbsDelta: number | null
  maxAbsDelta: number | null
  /** Mean signed `a - b`. Separated from `meanAbsDelta` on purpose: a device reading 5 high all day
   *  and one alternating ±5 have the same mean absolute error and are different problems. */
  meanBias: number | null
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

/** Score one pair over the buckets where both reported. */
export function pairSummary(rows: AlignedRow[], a: string, b: string): PairSummary {
  let overlap = 0
  let absTotal = 0
  let signedTotal = 0
  let maxAbs: number | null = null

  for (const row of rows) {
    const va = row.values[a]
    const vb = row.values[b]
    if (va === null || va === undefined || vb === null || vb === undefined) continue
    overlap++
    const delta = va - vb
    signedTotal += delta
    const abs = Math.abs(delta)
    absTotal += abs
    if (maxAbs === null || abs > maxAbs) maxAbs = abs
  }

  return {
    a, b, overlap,
    meanAbsDelta: overlap > 0 ? absTotal / overlap : null,
    maxAbsDelta: maxAbs,
    meanBias: overlap > 0 ? signedTotal / overlap : null,
  }
}

/** Every unordered pair, in the order the devices were given. */
export function allPairSummaries(rows: AlignedRow[], devices: string[]): PairSummary[] {
  const out: PairSummary[] = []
  for (let i = 0; i < devices.length; i++) {
    for (let j = i + 1; j < devices.length; j++) out.push(pairSummary(rows, devices[i], devices[j]))
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
