// D6 v1 adapter: ring-derived HR (oura_heartrate source='ble') vs Polar H10 HR
// (oura_heartrate source='chest_strap'). Both already land in the same table from two
// independent, already-wired ingest paths — no new ingest work, just a source-filtered read
// bucketed to 1-minute means. See docs/superpowers/plans/2026-07-26-d6-polar-h10-comparison-harness.md.

import type { WorkoutRepository } from '@/lib/data/repository'
import type { ComparisonAdapter } from '@/lib/oura-comparison-harness'
import { daytimeHrvEstimatesPerBucket } from '@trainingai/shared/health/daytime-hrv-model'
import { rmssdFromRr } from '@trainingai/shared/health/rmssd'

const HRV_BUCKET_MS = 5 * 60_000

/** Buckets raw {timestamp, bpm} rows into 1-minute means, keyed by the minute's ISO start. */
export function bucketHrToMinuteMeans(rows: { timestamp: Date; bpm: number }[]): { bucketStart: string; value: number }[] {
  const sums = new Map<string, { total: number; count: number }>()
  for (const r of rows) {
    const bucketStart = new Date(Math.floor(r.timestamp.getTime() / 60_000) * 60_000).toISOString()
    const entry = sums.get(bucketStart) ?? { total: 0, count: 0 }
    entry.total += r.bpm
    entry.count += 1
    sums.set(bucketStart, entry)
  }
  return [...sums.entries()]
    .map(([bucketStart, { total, count }]) => ({ bucketStart, value: total / count }))
    .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart))
}

export function ringVsH10HrAdapter(repo: WorkoutRepository): ComparisonAdapter {
  return {
    metric: 'heart_rate',
    unit: 'bpm',
    toleranceBand: 5,
    async ours(userId, startIso, endIso) {
      const rows = await repo.getOuraHeartrateBySource(userId, 'ble', new Date(startIso), new Date(endIso))
      return bucketHrToMinuteMeans(rows)
    },
    async reference(userId, startIso, endIso) {
      const rows = await repo.getOuraHeartrateBySource(userId, 'chest_strap', new Date(startIso), new Date(endIso))
      return bucketHrToMinuteMeans(rows)
    },
  }
}

/** Buckets beat-to-beat RR intervals into 5-minute groups and runs the app's one RR→rMSSD
 *  implementation (`rmssdFromRr`) per bucket — the D6 reference side for daytime-HRV. */
export function bucketRrToRmssd(rows: { at: Date; rrMs: number }[]): { bucketStart: string; value: number }[] {
  const buckets = new Map<string, number[]>()
  for (const r of rows) {
    const bucketStart = new Date(Math.floor(r.at.getTime() / HRV_BUCKET_MS) * HRV_BUCKET_MS).toISOString()
    const arr = buckets.get(bucketStart) ?? []
    if (!buckets.has(bucketStart)) buckets.set(bucketStart, arr)
    arr.push(r.rrMs)
  }
  const out: { bucketStart: string; value: number }[] = []
  for (const [bucketStart, rr] of buckets) {
    const rmssd = rmssdFromRr(rr)
    if (rmssd != null) out.push({ bucketStart, value: rmssd })
  }
  return out.sort((a, b) => a.bucketStart.localeCompare(b.bucketStart))
}

/**
 * D5 v1 adapter: our own daytime-HRV regression (`lib/health/daytime-hrv-model.ts`) vs the Polar
 * H10's RR-derived rMSSD. `ours` is empty until the user has a fitted model (cold start — same
 * "nothing to compare yet" outcome as D6's HR adapter would show for an unworn ring).
 */
export function dhrvVsH10Adapter(repo: WorkoutRepository): ComparisonAdapter {
  return {
    metric: 'daytime_hrv',
    unit: 'ms',
    toleranceBand: 10,
    async ours(userId, startIso, endIso) {
      const model = await repo.getDaytimeHrvModel(userId)
      if (!model) return []
      const from = new Date(startIso), to = new Date(endIso)
      const [signals, hrRows] = await Promise.all([
        repo.getOuraDaytimeSignals(userId, from, to),
        repo.getOuraHeartrateBySource(userId, 'ble', from, to),
      ])
      const hr = hrRows.map(r => ({ tsMs: r.timestamp.getTime(), bpm: r.bpm }))
      const estimates = daytimeHrvEstimatesPerBucket(model, signals.temp, signals.met, hr, from.getTime(), to.getTime(), HRV_BUCKET_MS)
      return estimates.map(e => ({ bucketStart: new Date(e.t - HRV_BUCKET_MS / 2).toISOString(), value: e.dhrv }))
    },
    async reference(userId, startIso, endIso) {
      const rows = await repo.getRrForWindow(userId, new Date(startIso), new Date(endIso))
      return bucketRrToRmssd(rows)
    },
  }
}
