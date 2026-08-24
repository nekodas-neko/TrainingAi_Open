import type { ClockAnchor } from '../clock'
import type { BodyMetrics } from '@trainingai/shared/types'
import type {
  DaytimeHrvModelRow,
  OuraDailyDerivedPatch,
  OuraDailyDerivedRow,
  OuraDailyRow,
  OuraDailySummaryRow,
  OuraSleepUpsertRow,
} from '../../data/repository'

/** One decoded-or-decodable ring frame. Mirrors the Postgres two-tier reader's row shape; the
 *  device implementation produces the same shape from the local raw table. */
export interface RollupFrame {
  ds: number
  tag: number
  bodyHex: string
  decoded: Record<string, unknown> | null
}

export interface RollupFrameQuery {
  tags?: readonly number[]
  startDs?: number | null
}

export interface RollupStepLiveWindow {
  startDs: number
  endDs: number
  steps: number
}

export interface RollupExistingSteps {
  date: string
  steps: number | null
  sourceMap: Record<string, string> | null
}

export interface RollupWorkoutWindow {
  startedAt: Date
  completedAt: Date | null
}

/**
 * Every store the Oura rollup touches, narrowed to the operations it actually performs and bound to
 * a single user by the implementation — so the rollup itself never handles a `userId` and cannot
 * write across one. Two implementations: Postgres (`lib/data/postgres/rollup-io.ts`, what runs on
 * the server today) and, once D2 Task 3 lands, local SQLite on the device.
 *
 * Adding a method here is adding a store the rollup depends on. Prefer narrowing an existing one.
 */
export interface RollupIO {
  // ── clock ────────────────────────────────────────────────────────────────────────────────────
  /** Newest anchor only — used for cutoff/window bounds, which don't need display precision. */
  readClockAnchor(): Promise<{ anchorDs: number; anchorUtc: Date } | null>
  /** Every anchor observation in the table (Q-71) — the authoritative ds→wall-clock source. */
  readClockAnchors(): Promise<ClockAnchor[]>

  // ── incremental-window watermark ─────────────────────────────────────────────────────────────
  readRollupWatermark(currentEpoch: number): Promise<number | null>
  writeRollupWatermark(lastRolledDs: number, epoch: number): Promise<void>

  // ── raw frames ───────────────────────────────────────────────────────────────────────────────
  readRawFrames(q: RollupFrameQuery): Promise<RollupFrame[]>

  // ── sleep ────────────────────────────────────────────────────────────────────────────────────
  /** Delete every BLE-derived sleep row on these wake-days, so a reshaped night cannot orphan the
   *  rows of its previous shape. Must not touch rows from any other source. */
  deleteBleSleepSessionsForDates(dates: string[]): Promise<void>
  upsertSleepSessions(rows: OuraSleepUpsertRow[]): Promise<void>

  // ── steps / body metrics ─────────────────────────────────────────────────────────────────────
  readStepLiveWindows(): Promise<RollupStepLiveWindow[]>
  readExistingSteps(dates: string[]): Promise<RollupExistingSteps[]>
  upsertBodyMetrics(rows: Omit<BodyMetrics, 'id' | 'userId' | 'createdAt'>[]): Promise<void>

  // ── heart rate ───────────────────────────────────────────────────────────────────────────────
  /** Workout windows starting at or after `since`, excluding soft-deleted sessions. */
  readWorkoutWindows(since: Date): Promise<RollupWorkoutWindow[]>
  deleteBleHeartrateFrom(since: Date): Promise<void>
  upsertHeartrate(rows: { timestamp: Date; bpm: number; source: string | null }[]): Promise<void>
  /** Drop the derived zone-minutes cache from `fromDay` forward — it owns rows we just rewrote. */
  deleteZoneMinutesFrom(fromDay: string): Promise<void>

  // ── daily rollups ────────────────────────────────────────────────────────────────────────────
  upsertOuraDaily(rows: OuraDailyRow[]): Promise<void>
  readLatestDailySummaryBefore(date: string): Promise<OuraDailySummaryRow | null>
  /** Full-history path: replace the whole series rather than merging into it. */
  replaceDailySummary(rows: OuraDailySummaryRow[]): Promise<void>
  upsertDailySummary(rows: OuraDailySummaryRow[]): Promise<void>
  readDailyDerived(from: string, to: string): Promise<OuraDailyDerivedRow[]>
  upsertDailyDerived(day: string, patch: OuraDailyDerivedPatch): Promise<void>
  /** TN-3a — replace one local day's 30-minute stress buckets. Whole-day replace: the series is
   *  recomputed as a unit, so a re-run producing fewer buckets must shrink the stored day. */
  replaceStressBuckets(day: string, buckets: { bucketStart: Date; level: number }[]): Promise<void>

  // ── models / downstream derivations ──────────────────────────────────────────────────────────
  readDaytimeHrvModel(): Promise<DaytimeHrvModelRow | null>
  refitDaytimeHrvModel(timezone: string): Promise<void>
  persistBodyComp(): Promise<void>
}
