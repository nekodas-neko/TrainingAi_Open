/**
 * Backfill of `oura_daytime_stress_buckets` over stored history (issue 2236).
 *
 * The forward writer (the rollup's resilience step) persists a day's 30-minute stress series only
 * for the trailing ~21 days it recomputes, so history before the table existed has no buckets.
 * This adds them, from what is already stored: the raw frames (hot and packed tiers, read through
 * `readRawFrames`), the per-night summary (HRV and resting-HR baselines), the fitted daytime-HRV
 * model and the recorded sleep windows. It calls the SAME `buildDayStressSeries` the rollup does,
 * so there is one definition of the series.
 *
 * The rules, each one deliberate:
 *
 * - ADD-ONLY. It never deletes a bucket and never changes one. A day that already has any bucket is
 *   skipped whole ("populated"), and each insert is `ON CONFLICT DO NOTHING` on the table's natural
 *   key `(user_id, bucket_mid)`, so even a bucket that exists under another day is left alone. The
 *   forward writer's whole-day REPLACE is a different operation and is not used here.
 * - DRY RUN FIRST. The default computes the full plan and writes nothing. A write recomputes the
 *   same plan, then inserts it in ONE transaction that rolls back unless the rows written equal the
 *   rows planned.
 * - NOTHING IS GUESSED. A day that cannot be scored is reported with the reason (no raw data, no
 *   model, no baseline...) and gets no buckets. Today is left to the forward writer: a partial day
 *   would be added now and replaced by the rollup anyway.
 * - The raw archive is read, never written.
 *
 * Runtime-agnostic: every store goes through `StressBackfillIO`, bound to one user by its
 * implementation, so this module never handles a user id.
 */
import { decodeEventBody, hexToBytes } from '@/lib/oura-ble/decode'
import { resolveDsToMs, type ClockAnchor } from '@/lib/oura-ble/clock'
import { aestMidnight, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import type { DaytimeHrvModelRow, OuraDailySummaryRow } from '@/lib/data/repository'
import type { RollupFrame, RollupFrameQuery } from './rollup/io'
import {
  ALL_STRESS_SERIES_TAGS,
  buildDayStressSeries,
  collectStressInputs,
  nightHrvMsOf,
  sliceWindow,
  type StressSeriesInputs,
  type StressSeriesSkipReason,
} from './rollup/stress-series'

export interface StressBucketToAdd { day: string; bucketMid: Date; level: number }

export interface StressBackfillIO {
  readClockAnchors(): Promise<ClockAnchor[]>
  readRawFrames(q: RollupFrameQuery): Promise<RollupFrame[]>
  readDaytimeHrvModel(): Promise<DaytimeHrvModelRow | null>
  /** Every stored nightly summary row, oldest first. These are the days history exists for. */
  readDailySummaries(): Promise<OuraDailySummaryRow[]>
  readSleepWindows(from: string, to: string): Promise<{ sleepStart: Date; sleepEnd: Date }[]>
  /** Every stored bucket's day and instant: the "already populated" test and the conflict check. */
  readStressBucketKeys(): Promise<{ day: string; bucketMid: Date }[]>
  /**
   * Insert these rows, add-only, in ONE transaction that rolls back (throws) unless exactly
   * `rows.length` rows were inserted. Returns the number inserted.
   */
  addStressBuckets(rows: StressBucketToAdd[]): Promise<number>
}

export type StressBackfillSkipReason = StressSeriesSkipReason | 'no-raw-data'

export interface StressBackfillReport {
  dryRun: boolean
  timezone: string
  /** First and last day considered (completed days that have a nightly summary); null when none. */
  range: { from: string; to: string } | null
  /** Completed days with a nightly summary: the days this run looked at. */
  daysConsidered: number
  /** Days that already have buckets: left exactly as they are. */
  daysSkippedPopulated: number
  /** Days newer than yesterday: the forward writer owns them. */
  daysSkippedNotComplete: number
  daysToGain: number
  bucketsToAdd: number
  /** Planned buckets whose instant already exists (filed under another day): not added. */
  bucketsAlreadyPresent: number
  daysCannotCompute: number
  cannotComputeByReason: Partial<Record<StressBackfillSkipReason, number>>
  cannotCompute: { day: string; reason: StressBackfillSkipReason }[]
  /** Per gaining day, how many buckets it would gain. */
  gaining: { day: string; buckets: number }[]
  /** Achieved depth: the first and last day that would gain buckets (or did). */
  depth: { from: string; to: string } | null
  /** Rows actually inserted. Always 0 on a dry run. */
  bucketsWritten: number
}

export interface StressBackfillPlan {
  report: StressBackfillReport
  rows: StressBucketToAdd[]
}

/** Compute what a backfill would add, writing nothing. */
export async function planStressBackfill(
  io: StressBackfillIO,
  timezone: string,
): Promise<StressBackfillPlan> {
  const today = todayInTz(timezone)
  const [summaries, model, anchors, existing] = await Promise.all([
    io.readDailySummaries(), io.readDaytimeHrvModel(), io.readClockAnchors(), io.readStressBucketKeys(),
  ])

  const populatedDays = new Set(existing.map(e => e.day))
  const existingInstants = new Set(existing.map(e => e.bucketMid.getTime()))

  const complete = summaries.filter(r => r.date < today)
  const report: StressBackfillReport = {
    dryRun: true,
    timezone,
    range: complete.length ? { from: complete[0].date, to: complete[complete.length - 1].date } : null,
    daysConsidered: complete.length,
    daysSkippedPopulated: 0,
    daysSkippedNotComplete: summaries.length - complete.length,
    daysToGain: 0,
    bucketsToAdd: 0,
    bucketsAlreadyPresent: 0,
    daysCannotCompute: 0,
    cannotComputeByReason: {},
    cannotCompute: [],
    gaining: [],
    depth: null,
    bucketsWritten: 0,
  }
  const rows: StressBucketToAdd[] = []
  const cannot = (day: string, reason: StressBackfillSkipReason) => {
    report.daysCannotCompute++
    report.cannotComputeByReason[reason] = (report.cannotComputeByReason[reason] ?? 0) + 1
    report.cannotCompute.push({ day, reason })
  }

  const todo = complete.filter(r => {
    if (populatedDays.has(r.date)) { report.daysSkippedPopulated++; return false }
    return true
  })
  if (todo.length === 0) return { report, rows }

  // Only the frames the series reads, decoded and reduced to their numbers at once so the decoded
  // objects are not held. The ds→instant conversion is the rollup's (`resolveDsToMs`).
  const frames = await io.readRawFrames({ tags: ALL_STRESS_SERIES_TAGS })
  const toMs = (ds: number): number => resolveDsToMs(ds, anchors) ?? Number.NaN
  const decodedRows = frames
    .map(f => ({
      ds: f.ds, tag: f.tag,
      decoded: f.decoded ?? (f.bodyHex ? decodeEventBody(f.tag, hexToBytes(f.bodyHex)) : null),
    }))
    .filter(r => r.decoded != null)
  // A frame no anchor can place (NaN) is dropped by `collectStressInputs`, not filed at a made-up time.
  const inputs: StressSeriesInputs = collectStressInputs(decodedRows, toMs)

  // One day of margin each side: a night is keyed by its WAKE date, so the night that starts on the
  // last day is filed under the next one.
  const sleepWindows = await io.readSleepWindows(
    shiftDateStr(todo[0].date, -1), shiftDateStr(todo[todo.length - 1].date, 1),
  )

  for (const r of todo) {
    const [y, m, d] = r.date.split('-').map(Number)
    const dayStartMs = aestMidnight(y, m, d, timezone).getTime()
    const dayEndMs = aestMidnight(y, m, d + 1, timezone).getTime()

    if (sliceWindow(inputs.hr, dayStartMs, dayEndMs).length === 0
      && sliceWindow(inputs.temp, dayStartMs, dayEndMs).length === 0
      && sliceWindow(inputs.met, dayStartMs, dayEndMs).length === 0) {
      cannot(r.date, 'no-raw-data')
      continue
    }
    const built = buildDayStressSeries({
      dayStartMs, dayEndMs, inputs, model,
      nightHrvMs: nightHrvMsOf(r), rhrLowBpm: r.rhrLowBpm, sleepWindows,
    })
    if (built.skipped != null) { cannot(r.date, built.skipped); continue }

    const fresh = built.points.filter(p => {
      if (existingInstants.has(p.t)) { report.bucketsAlreadyPresent++; return false }
      return true
    })
    if (fresh.length === 0) continue
    for (const p of fresh) rows.push({ day: r.date, bucketMid: new Date(p.t), level: p.stressLevel })
    report.daysToGain++
    report.bucketsToAdd += fresh.length
    report.gaining.push({ day: r.date, buckets: fresh.length })
  }
  if (report.gaining.length) {
    report.depth = { from: report.gaining[0].day, to: report.gaining[report.gaining.length - 1].day }
  }
  return { report, rows }
}

/**
 * Plan, and — unless `dryRun` — add. A write re-plans first, so what it inserts is what the data
 * says now, and the transaction inside `addStressBuckets` refuses to commit any other count.
 */
export async function runStressBackfill(
  io: StressBackfillIO,
  timezone: string,
  opts: { dryRun: boolean },
): Promise<StressBackfillReport> {
  const { report, rows } = await planStressBackfill(io, timezone)
  report.dryRun = opts.dryRun
  if (opts.dryRun || rows.length === 0) return report
  report.bucketsWritten = await io.addStressBuckets(rows)
  return report
}
