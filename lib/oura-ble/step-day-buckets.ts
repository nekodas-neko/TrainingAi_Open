/**
 * Bucket the daily-steps inputs by local day, and compute each day's merged step total.
 *
 * ONE implementation, deliberately. The rollup (`aggregateOuraRawSamples`) and the backfill preview
 * (`previewStepsBackfill`) previously carried hand-copied duplicates of this logic — so the preview
 * an owner authorises a destructive backfill from was computed by different code than the write that
 * follows it. The 2026-07-28 midnight-split fix landed in one copy and not the other, which is
 * exactly how that drift manifests.
 *
 * Callers still own their own queries (the rollup applies `rollupCutoffDs`, the preview does not),
 * because that difference is intentional. Everything downstream of the rows is shared.
 */
import { resolveDsToMs, type ClockAnchor } from './clock'
import { runStepCounterPipeline, type RawFrame } from './step-counter-pipeline'
import { mergeStepCounterWithLive, type StepCountWindow } from '@trainingai/shared/health/step-estimate'
import { toAestDay, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { INGEST_FUTURE_TOLERANCE_MS } from '@trainingai/shared/validation/ingest-clock'

export interface StepFrameRow {
  ds: number | string
  tag: number
  bodyHex: string | null
}

export interface StepLiveWindowRow {
  startDs: number | string
  endDs: number | string
  steps: number
}

export interface StepDayInputs {
  stepFrames: StepFrameRow[]
  motionFrames: StepFrameRow[]
  liveWindows: StepLiveWindowRow[]
  /**
   * Every clock-anchor observation, not just the newest. A ds resolves against the observation
   * nearest *it* (see lib/oura-ble/clock.ts) — extrapolating everything from the latest anchor is
   * what let a mid-drain re-stamp throw frames minutes adrift.
   */
  anchors: ClockAnchor[]
  /** Defaults to the current epoch. A ds is never resolved across a ring clock reset. */
  epoch?: number
  timezone: string
  /** Injectable clock, so the future guard below is testable. */
  nowMs?: number
}

export interface StepDayBuckets {
  days: Set<string>
  stepFramesByDay: Map<string, RawFrame[]>
  motionFramesByDay: Map<string, RawFrame[]>
  liveByDay: Map<string, StepCountWindow[]>
  /** Frames and windows left out because they resolved to the future, or to no anchor at all. */
  droppedFrames: number
}

export function bucketStepInputsByDay(input: StepDayInputs): StepDayBuckets {
  const { anchors, epoch, timezone } = input
  const nowMs = input.nowMs ?? Date.now()
  // A sensor reading dated after the moment it was read is never right, whatever produced it —
  // the same judgement `resolveMeasuredAt` already makes on the scale ingest path, which is where
  // this tolerance comes from. Dropping beats clamping to today: `body_hex` is archival and the
  // rollup re-runs, so a frame skipped now is placed correctly by the next pass once a nearer
  // anchor exists. Clamping would fold a future day's steps into today and be unrecoverable.
  const latestPlausibleMs = nowMs + INGEST_FUTURE_TOLERANCE_MS
  let droppedFrames = 0
  const toMs = (ds: number): number | null => {
    const ms = resolveDsToMs(ds, anchors, epoch)
    if (ms == null || ms > latestPlausibleMs) return null
    return ms
  }
  const dayForDs = (ds: number): string | null => {
    const ms = toMs(ds)
    return ms == null ? null : toAestDay(new Date(ms), timezone)
  }

  // Raw frames bucket by the local day of their own ds — the 0x7e/0x7f pair sits ~1 ds apart, so a
  // pair never meaningfully straddles midnight.
  const byDayFrames = (rows: StepFrameRow[]): Map<string, RawFrame[]> => {
    const m = new Map<string, RawFrame[]>()
    for (const r of rows) {
      if (r.bodyHex == null) continue
      const dsNum = Number(r.ds)
      const day = dayForDs(dsNum)
      if (day == null) { droppedFrames += 1; continue }
      const list = m.get(day)
      if (list) list.push({ ringTimestampDs: dsNum, tag: r.tag, bodyHex: r.bodyHex })
      else m.set(day, [{ ringTimestampDs: dsNum, tag: r.tag, bodyHex: r.bodyHex }])
    }
    return m
  }

  // A live window that crosses local midnight is SPLIT across the days it actually covers, pro-rata
  // by duration. Crediting it whole to its start day double-counted the overlap: the start day got
  // steps belonging to the next day, AND the next day's model windows over that same span were never
  // dropped (no window in that day's list overlapped them), so the span was paid for twice.
  const liveByDay = new Map<string, StepCountWindow[]>()
  const addLive = (day: string, w: StepCountWindow) => {
    if (w.steps <= 0 && w.endMs <= w.startMs) return
    const list = liveByDay.get(day)
    if (list) list.push(w)
    else liveByDay.set(day, [w])
  }
  for (const r of input.liveWindows) {
    const startDs = Number(r.startDs)
    const endDs = Number(r.endDs)
    const startMs = toMs(startDs)
    const endMs = toMs(endDs)
    const startDay = dayForDs(startDs)
    const endDay = dayForDs(endDs)
    if (startMs == null || endMs == null || startDay == null || endDay == null) {
      droppedFrames += 1
      continue
    }
    if (startDay === endDay || endMs <= startMs) {
      addLive(startDay, { startMs, endMs, steps: r.steps })
      continue
    }
    // The boundary comes from the shared `dateStrMidnightInTz` so it uses the same tz rule as
    // `dayForDs` — not a second definition of midnight — and stays DST-correct.
    const boundaryMs = dateStrMidnightInTz(endDay, timezone).getTime()
    if (!Number.isFinite(boundaryMs) || boundaryMs <= startMs || boundaryMs >= endMs) {
      addLive(startDay, { startMs, endMs, steps: r.steps })
      continue
    }
    const firstShare = (boundaryMs - startMs) / (endMs - startMs)
    addLive(startDay, { startMs, endMs: boundaryMs, steps: r.steps * firstShare })
    addLive(endDay, { startMs: boundaryMs, endMs, steps: r.steps * (1 - firstShare) })
  }

  const stepFramesByDay = byDayFrames(input.stepFrames)
  const motionFramesByDay = byDayFrames(input.motionFrames)
  return {
    days: new Set([...stepFramesByDay.keys(), ...liveByDay.keys()]),
    stepFramesByDay,
    motionFramesByDay,
    liveByDay,
    droppedFrames,
  }
}

/** Each day's merged step total: `step_counter` over that day's frames, Tier-2 live windows winning
 *  the spans they cover. The number the rollup persists and the preview reports — same call. */
export async function computeStepsByDay(input: StepDayInputs): Promise<Map<string, number>> {
  const { days, stepFramesByDay, motionFramesByDay, liveByDay, droppedFrames } =
    bucketStepInputsByDay(input)
  if (droppedFrames > 0) {
    console.warn(`[oura-ble] steps rollup skipped ${droppedFrames} frame(s) that resolved to the future or to no anchor`)
  }
  // Only frames that resolved survive bucketing, so this cannot be null here. Asserting beats a
  // `?? 0` default, which would silently date a frame to 1970 and bucket it under a 1970 day.
  const toMs = (ds: number): number => {
    const ms = resolveDsToMs(ds, input.anchors, input.epoch)
    if (ms == null) throw new Error('step frame reached the pipeline with no clock anchor in its epoch')
    return ms
  }
  const out = new Map<string, number>()
  for (const day of days) {
    const result = await runStepCounterPipeline(
      stepFramesByDay.get(day) ?? [],
      motionFramesByDay.get(day) ?? [],
      toMs,
    )
    out.set(day, Math.round(mergeStepCounterWithLive(result?.stepWindows ?? [], liveByDay.get(day) ?? [])))
  }
  return out
}
