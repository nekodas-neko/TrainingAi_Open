// lib/health/hr-window-merge.ts
// Merge precedence for HR time-series reads: where the chest strap (1 Hz,
// beat-accurate) and the ring (5-min binned) both cover a 10 s bucket, the
// strap's rows win and the ring's are dropped. Buckets with only one source
// pass through untouched — the strap never thins its own dense stream.
export interface HrRow { timestamp: Date; bpm: number; source: string | null }

const BUCKET_MS = 10_000

export function preferStrapBuckets(rows: HrRow[]): HrRow[] {
  const strapBuckets = new Set<number>()
  for (const r of rows) {
    if (r.source === 'chest_strap') strapBuckets.add(Math.floor(r.timestamp.getTime() / BUCKET_MS))
  }
  return rows
    .filter(r => r.source === 'chest_strap' || !strapBuckets.has(Math.floor(r.timestamp.getTime() / BUCKET_MS)))
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}
