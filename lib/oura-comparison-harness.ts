// D6 — generic "ours vs reference" comparison harness. Thin, reference-pluggable: an adapter
// supplies two point series keyed by bucket start, this file merges + scores them. No I/O here —
// adapters own the DB reads, this stays a pure function so it's testable without a database.
// See docs/superpowers/plans/2026-07-26-d6-polar-h10-comparison-harness.md.

export interface ComparisonPoint {
  bucketStart: string
  ours: number | null
  reference: number | null
}

export interface ComparisonResult {
  metric: string
  unit: string
  toleranceBand: number
  points: ComparisonPoint[]
  summary: { withinCount: number; outOfBandCount: number; meanAbsDelta: number | null }
}

export interface ComparisonAdapter {
  metric: string
  unit: string
  toleranceBand: number
  ours(userId: string, startIso: string, endIso: string): Promise<{ bucketStart: string; value: number }[]>
  reference(userId: string, startIso: string, endIso: string): Promise<{ bucketStart: string; value: number }[]>
}

export async function runComparison(
  adapter: ComparisonAdapter,
  userId: string,
  startIso: string,
  endIso: string,
): Promise<ComparisonResult> {
  const [oursPoints, referencePoints] = await Promise.all([
    adapter.ours(userId, startIso, endIso),
    adapter.reference(userId, startIso, endIso),
  ])
  return mergeComparisonPoints(adapter.metric, adapter.unit, adapter.toleranceBand, oursPoints, referencePoints)
}

/** Merge + score step, split out so tests can exercise it without adapter I/O. */
export function mergeComparisonPoints(
  metric: string,
  unit: string,
  toleranceBand: number,
  oursPoints: { bucketStart: string; value: number }[],
  referencePoints: { bucketStart: string; value: number }[],
): ComparisonResult {
  const byBucket = new Map<string, ComparisonPoint>()
  for (const p of oursPoints) {
    byBucket.set(p.bucketStart, { bucketStart: p.bucketStart, ours: p.value, reference: null })
  }
  for (const p of referencePoints) {
    const existing = byBucket.get(p.bucketStart)
    if (existing) existing.reference = p.value
    else byBucket.set(p.bucketStart, { bucketStart: p.bucketStart, ours: null, reference: p.value })
  }
  const points = [...byBucket.values()].sort((a, b) => a.bucketStart.localeCompare(b.bucketStart))

  let withinCount = 0
  let outOfBandCount = 0
  let absDeltaSum = 0
  let scoredCount = 0
  for (const p of points) {
    if (p.ours === null || p.reference === null) continue
    const absDelta = Math.abs(p.ours - p.reference)
    absDeltaSum += absDelta
    scoredCount++
    if (absDelta <= toleranceBand) withinCount++
    else outOfBandCount++
  }

  return {
    metric,
    unit,
    toleranceBand,
    points,
    summary: {
      withinCount,
      outOfBandCount,
      meanAbsDelta: scoredCount > 0 ? absDeltaSum / scoredCount : null,
    },
  }
}
