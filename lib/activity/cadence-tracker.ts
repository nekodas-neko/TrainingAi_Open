/**
 * Live cadence during an activity, fused from the two sources that can measure it.
 *
 * Neither source is strictly better, so both run when available:
 *   strap — ~1 reading/second from the H10 accelerometer DSP. High resolution, responds to a
 *           pace change within seconds, but only exists while the PMD stream is running.
 *   ring  — one reading per ~30 s gait window, already decoded for step counting. Always
 *           there, costs nothing extra, but far too coarse to watch during intervals.
 *
 * So the strap leads when it is live and the ring covers everything else. Both are kept
 * separately as well, because two independent measurements of the same physical quantity are
 * the only way to tell whether either is right — see `agreement`, and the admin calibration
 * console that renders it against a treadmill's displayed cadence.
 */
import { subscribeGateFeed } from '@/lib/oura-ble/gate-feed'
import {
  runStepsMotionDecoder,
  hasStepsDecoderConstants,
  STRIDE_FREQUENCY_COLUMN,
  STRIDE_AMPLITUDE_FRAC_COLUMN,
  TOTAL_AMPLITUDE_MG_COLUMN,
} from '@/lib/oura-models/steps-motion-decoder'
import { classifyGait, hasGaitMotion } from '@trainingai/shared/health/gait-classifier'
import { getPolarBle, type PolarAccelBatch } from '@/lib/polar-ble/plugin'
import type { PluginListenerHandle } from '@capacitor/core'
import {
  detectCadence,
  cadenceFromStrideHz,
  compareCadence,
  summarizeCadence,
  RING_CADENCE_VALIDATED,
  type CadenceAgreement,
  type CadenceReading,
  type CadenceSource,
  type CadenceSummary,
} from '@trainingai/shared/health/cadence'

/** A reading older than this is no longer "live" and stops being shown or preferred. */
export const STRAP_STALE_MS = 5_000
/** Ring gait windows land every ~30 s, so tolerate two missed windows before going stale. */
export const RING_STALE_MS = 75_000

/** Rolling accelerometer window the strap DSP runs over. Long enough for the DSP's 3 s
 *  minimum plus margin, short enough to track a pace change rather than average it away. */
export const STRAP_WINDOW_SEC = 6

/**
 * Minimum wall-clock spacing between ring readings that reach the activity average.
 * Real windows are ~30 s apart; anything closer is a history drain replaying the past hour.
 * Slightly under 30 s so a genuine window is never dropped for arriving marginally early.
 */
export const RING_MIN_RECORD_GAP_MS = 25_000

/** ~4 minutes of 50 Hz magnitudes — enough to hold a calibration walk without unbounded growth. */
/** Ring windows are ~30 s apart, so this holds well over an hour of drained history. */
export const MAX_RING_WINDOWS = 300

export const MAX_RAW_SAMPLES = 12_000

/** Per-window ring detail retained during calibration. */
export interface RingWindowSample {
  /** Ring's own monotonic deciseconds counter. */
  ds: number
  strideHz: number
  state: string
  /** Wall-clock ms the window was received (NOT when it occurred — a drain replays history). */
  receivedAtMs: number
}

/** A ring window with its occurrence time reconstructed from the ds↔arrival anchor. */
export interface DatedRingWindow extends RingWindowSample {
  /** Estimated wall-clock ms the window OCCURRED (not when it arrived). */
  occurredAtMs: number
}

/**
 * Reconstruct when each ring window actually occurred.
 *
 * `ds` is monotonic deciseconds on the ring's own clock with no wall-clock epoch, so a single
 * window carries no absolute time. But a drain replays history *up to the present*, so the
 * NEWEST window in a burst occurred at approximately the moment that burst arrived. That gives
 * one (ds ↔ wall-clock) anchor, and every other window follows from its ds offset at 100 ms per
 * unit.
 *
 * Why this is needed: scoping a capture by `ds >= newestDs - captureDs` silently assumes the
 * newest window sits at the END of the capture. When a drain lands EARLY the window it anchors
 * to is near the capture's start, so that filter reaches backwards into pre-capture history and
 * reports it as capture data (owner 150 bpm capture: drain arrived 13% in, so ~87% of the
 * "in-capture" windows predated the walk entirely).
 */
export function dateRingWindows(windows: RingWindowSample[]): DatedRingWindow[] {
  if (windows.length === 0) return []
  // Anchor on the newest window BY ds, using its own arrival time.
  const anchor = windows.reduce((best, w) => (w.ds > best.ds ? w : best), windows[0])
  return windows.map(w => ({
    ...w,
    occurredAtMs: anchor.receivedAtMs - (anchor.ds - w.ds) * 100,
  }))
}

/** Ring windows whose reconstructed occurrence time falls inside [startMs, endMs]. */
export function ringWindowsWithin(
  windows: RingWindowSample[],
  startMs: number,
  endMs: number,
): DatedRingWindow[] {
  return dateRingWindows(windows).filter(w => w.occurredAtMs >= startMs && w.occurredAtMs <= endMs)
}

export interface TimedCadence {
  spm: number
  atMs: number
}

export interface CadenceTrackerSnapshot {
  /** The reading to display, after precedence and staleness. Null = not moving / no data. */
  liveSpm: number | null
  liveSource: CadenceSource | null
  ring: TimedCadence | null
  strap: TimedCadence | null
  /** Non-null only when both sources are simultaneously fresh. */
  agreement: CadenceAgreement | null
  /** Raw decoded stride frequency, carried through unconverted so the calibration console
   *  can show both candidate unit interpretations without re-deriving anything. */
  ringStrideHz: number | null
  /** Gait windows seen this session. 0 means the ring has delivered nothing at all —
   *  a very different problem from "delivered windows, but none looked locomotor". */
  ringWindowCount: number
  /** Of those, how many the gait classifier judged locomotor. */
  ringLocomotorWindowCount: number
  /** Classifier verdict on the most recent window ('idle' | 'walk' | 'run'). */
  ringGaitState: string | null
  /** Rhythm confidence behind the strap reading. A weak value that squeaked past the gate
   *  looks identical to a strong one in the number alone. */
  strapStrength: number | null
  strapSampleRate: number | null
  strapFrameType: number | null
}

/**
 * Choose which reading to show. Pure so precedence and staleness are testable without a
 * device — the part of this module most likely to be wrong in a way nothing else catches.
 *
 * The strap leads on freshness, not on principle: it updates ~30x more often, so preferring
 * it makes the number track reality during intervals. A stale strap must never win, or a
 * dropped BLE stream would freeze the display at whatever pace was last seen.
 */
export function pickLiveCadence(
  ring: TimedCadence | null,
  strap: TimedCadence | null,
  nowMs: number,
): { spm: number; source: CadenceSource } | null {
  const strapFresh = strap !== null && nowMs - strap.atMs <= STRAP_STALE_MS
  if (strapFresh) return { spm: strap!.spm, source: 'strap' }
  // Ring fallback is gated off until its signal is shown to track cadence at all.
  if (!RING_CADENCE_VALIDATED) return null
  const ringFresh = ring !== null && nowMs - ring.atMs <= RING_STALE_MS
  if (ringFresh) return { spm: ring!.spm, source: 'ring' }
  return null
}

type Listener = (snapshot: CadenceTrackerSnapshot) => void

export class CadenceTracker {
  private listeners: Listener[] = []
  private readings: CadenceReading[] = []
  private startMs = 0

  private ring: TimedCadence | null = null
  private strap: TimedCadence | null = null
  private ringStrideHz: number | null = null
  private ringWindowCount = 0
  private ringLocomotorWindowCount = 0
  private ringGaitState: string | null = null
  private strapStrength: number | null = null
  private rawMagnitudes: number[] = []
  private ringWindows: RingWindowSample[] = []
  private retainRaw = false
  private lastRingDs: number | null = null
  private lastRingRecordAt = -Infinity
  private ringBurstIdx: number | null = null
  private strapSampleRate: number | null = null
  private strapFrameType: number | null = null

  private accBuffer: number[] = []
  private unsubGateFeed: (() => void) | null = null
  private polarHandles: PluginListenerHandle[] = []
  private polarPlugin: Awaited<ReturnType<typeof getPolarBle>> = null
  private running = false

  isRunning() { return this.running }

  /**
   * Begin tracking. Each source attaches independently and a missing one is not an error:
   * no ring, no strap, or neither all degrade to fewer readings rather than a failure. On
   * web both are absent and the tracker simply reports nothing.
   */
  async start(startMs: number = Date.now(), opts?: { retainRaw?: boolean }): Promise<void> {
    if (this.running) return
    this.running = true
    this.retainRaw = opts?.retainRaw ?? false
    this.rawMagnitudes = []
    this.ringWindows = []
    this.ringLocomotorWindowCount = 0
    this.ringGaitState = null
    this.strapStrength = null
    this.startMs = startMs
    this.readings = []
    this.accBuffer = []
    this.ringWindowCount = 0
    this.lastRingDs = null
    this.lastRingRecordAt = -Infinity
    this.ringBurstIdx = null

    this.unsubGateFeed = await subscribeGateFeed(ev => {
      if (!this.running) return
      if (ev.type === 'disconnect') { this.ring = null; this.emit(); return }
      this.onRingWindow(ev.columns, ev.ds, Date.now())
    }).catch(() => null)

    const polar = await getPolarBle()
    if (polar) {
      this.polarPlugin = polar
      this.polarHandles.push(
        await polar.plugin.addListener('polarAccel', b => this.onStrapBatch(b)),
      )
      // Rejects when the strap service isn't running (no strap paired, or it never
      // connected). Cadence then comes from the ring alone — not a failure worth surfacing.
      await polar.plugin.setAccStreaming({ enabled: true }).catch(() => {})
    }
  }

  /**
   * One decoded ring gait window.
   *
   * Ring frames do NOT arrive in real time. The native service drains the ring's history
   * buffer on connect and then hourly (`DRAIN_INTERVAL_MS`), so a drain delivers a burst of
   * windows covering the whole preceding hour, all at once. Stamping those with `Date.now()`
   * — as this did originally — makes an hour of stale windows look like a hundred live
   * readings, which both jitters the displayed number and floods the activity average.
   *
   * `ds` is the ring's own monotonic deciseconds counter, so window-to-window SPACING is
   * trustworthy even though its epoch is not wall-clock. That is enough: a burst is
   * recognisable because its windows are ~30 s apart in ring time but arrive within
   * milliseconds of each other, and only the newest of them describes now.
   */
  private onRingWindow(columns: number[], ds: number, nowMs: number) {
    // Within a burst, only the newest window can plausibly describe the present moment.
    // Older ones are history and must not be recorded or displayed.
    if (this.lastRingDs !== null && ds < this.lastRingDs) return
    this.lastRingDs = ds

    // No table, no reading (Q-221 — see auto-detection-service). A cadence number decoded from an
    // absent dequantisation table would be plausible and wrong, which is worse than showing nothing.
    if (!hasStepsDecoderConstants()) return
    const decoded = runStepsMotionDecoder({ timestamps: [nowMs], data: [columns] })
    const strideHz = median(decoded.data.map(r => r[STRIDE_FREQUENCY_COLUMN]))
    const features = {
      strideHz,
      strideAmpFrac: median(decoded.data.map(r => r[STRIDE_AMPLITUDE_FRAC_COLUMN])),
      totalAmplitudeMg: median(decoded.data.map(r => r[TOTAL_AMPLITUDE_MG_COLUMN])),
    }
    const classification = classifyGait(features)
    this.ringStrideHz = strideHz
    // Counted BEFORE the idle branch: this is "windows the ring delivered", which is what
    // distinguishes "the ring sent nothing" from "sent windows, none of them locomotor".
    // Counting after the branch (as this first shipped) collapses those two very different
    // failures into an identical 0 — exactly the ambiguity the counter exists to remove.
    this.ringWindowCount += 1
    this.ringGaitState = classification.state

    // Retain EVERY window during calibration, not just the newest. Showing only the latest is
    // what made two captures look contradictory: the newest window is often a non-walking one,
    // so the walking windows — the only ones that say anything about units — were invisible.
    if (this.retainRaw) {
      this.ringWindows.push({ ds, strideHz, state: classification.state, receivedAtMs: nowMs })
      if (this.ringWindows.length > MAX_RING_WINDOWS) this.ringWindows.shift()
    }

    // Gate on MOTION, not on the walk/run Hz bands.
    //
    // `classifyGait` exists for AD-2's walk/run detection and its bands start at 1.4 Hz
    // (~84 spm). A real 64 spm walk sits below that and classifies as 'idle' — correct for
    // "is this a walk worth detecting", wrong for "what is this person's cadence". Gating
    // cadence on that verdict discarded a whole genuine slow walk (owner capture 2026-07-27)
    // while keeping older, faster history. Plausibility (60–220 spm) is cadence's own filter;
    // the band verdict is kept for reporting only.
    if (!hasGaitMotion(features)) { this.ring = null; this.emit(); return }

    const spm = cadenceFromStrideHz(strideHz)
    this.ring = spm === null ? null : { spm, atMs: nowMs }
    this.ringLocomotorWindowCount += 1

    // The ring is not a trusted cadence source: on-device it reported the same ~1.0 Hz for
    // walks 1.8x apart in counted cadence (see RING_CADENCE_VALIDATED). It stays visible on
    // the snapshot for the calibration console, but must not reach the live readout or the
    // saved activity — a number that does not move with pace is worse than no number.
    if (!RING_CADENCE_VALIDATED) { this.emit(); return }

    // Rate-limit what reaches the activity average. Genuine ring windows are ~30 s apart, so
    // anything arriving faster is a drain burst replaying history and must not contribute a
    // hundred readings to the mean.
    //
    // A burst arrives in ascending ds order, so the FIRST window through here is the oldest —
    // an hour stale. Recording it and skipping the rest would persist exactly the wrong window.
    // Instead the burst's later (newer) windows supersede it, leaving one reading: the newest.
    if (nowMs - this.lastRingRecordAt >= RING_MIN_RECORD_GAP_MS) {
      this.lastRingRecordAt = nowMs
      this.ringBurstIdx = this.readings.length
      this.record(nowMs)
    } else if (this.ringBurstIdx !== null && this.readings.length > this.ringBurstIdx) {
      this.readings.length = this.ringBurstIdx
      this.record(nowMs)
    }
    this.emit()
  }

  private onStrapBatch(batch: PolarAccelBatch) {
    if (!this.running) return
    this.strapSampleRate = batch.sampleRate
    this.strapFrameType = batch.frameType

    const rate = batch.sampleRate > 0 ? batch.sampleRate : 50
    this.accBuffer.push(...batch.magnitudes)
    const cap = Math.round(STRAP_WINDOW_SEC * rate)
    if (this.accBuffer.length > cap) this.accBuffer.splice(0, this.accBuffer.length - cap)

    // Calibration only: keep the raw signal so a capture can be replayed offline against the
    // DSP. Guessing at why a reading was wrong from summary stats alone does not work — the
    // 71.4 spm band-pinning was only diagnosable because the number happened to equal the
    // band floor exactly. Off by default so ordinary activities retain nothing.
    if (this.retainRaw) {
      this.rawMagnitudes.push(...batch.magnitudes)
      if (this.rawMagnitudes.length > MAX_RAW_SAMPLES) {
        this.rawMagnitudes.splice(0, this.rawMagnitudes.length - MAX_RAW_SAMPLES)
      }
    }

    const est = detectCadence(this.accBuffer, rate)
    const nowMs = batch.at
    this.strapStrength = est?.strength ?? null
    this.strap = est === null ? null : { spm: est.cadenceSpm, atMs: nowMs }
    this.record(nowMs)
    this.emit()
  }

  /** Record only the reading that won precedence, so the persisted average reflects one
   *  coherent measurement rather than a blend weighted by how often each source happened
   *  to report. Both sources still stay visible on the snapshot for cross-validation. */
  private record(nowMs: number) {
    const live = pickLiveCadence(this.ring, this.strap, nowMs)
    if (live) this.readings.push({ atMs: nowMs, spm: live.spm, source: live.source })
  }

  snapshot(nowMs: number = Date.now()): CadenceTrackerSnapshot {
    const live = pickLiveCadence(this.ring, this.strap, nowMs)
    const ringFresh = this.ring && nowMs - this.ring.atMs <= RING_STALE_MS ? this.ring : null
    const strapFresh = this.strap && nowMs - this.strap.atMs <= STRAP_STALE_MS ? this.strap : null
    return {
      liveSpm: live?.spm ?? null,
      liveSource: live?.source ?? null,
      ring: ringFresh,
      strap: strapFresh,
      agreement: ringFresh && strapFresh ? compareCadence(ringFresh.spm, strapFresh.spm) : null,
      ringStrideHz: this.ringStrideHz,
      ringWindowCount: this.ringWindowCount,
      ringLocomotorWindowCount: this.ringLocomotorWindowCount,
      ringGaitState: this.ringGaitState,
      strapStrength: this.strapStrength,
      strapSampleRate: this.strapSampleRate,
      strapFrameType: this.strapFrameType,
    }
  }

  /** Raw accelerometer magnitudes retained this session (calibration mode only). */
  raw(): { magnitudes: number[]; sampleRate: number | null } {
    return { magnitudes: this.rawMagnitudes, sampleRate: this.strapSampleRate }
  }

  /**
   * Every ring window seen this session, with its gait verdict (calibration mode only).
   *
   * The units question can only be answered from windows the classifier judged LOCOMOTOR —
   * an idle window's stride frequency describes whatever the ring was doing at the time, not
   * your walk. Reporting a single newest window conflated the two and made consecutive
   * captures look contradictory.
   */
  ringWindowSamples(): RingWindowSample[] {
    return this.ringWindows
  }

  /** What gets persisted on the activity row. */
  summary(): CadenceSummary {
    return summarizeCadence(this.readings, this.startMs)
  }

  subscribe(cb: Listener): () => void {
    this.listeners.push(cb)
    return () => { this.listeners = this.listeners.filter(l => l !== cb) }
  }

  private emit() {
    const snap = this.snapshot()
    for (const l of this.listeners) l(snap)
  }

  /**
   * Stop tracking and release both sources. Stopping the accelerometer stream matters more
   * than the rest: left running it would drain the strap for the rest of the day.
   */
  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false
    this.unsubGateFeed?.()
    this.unsubGateFeed = null
    for (const h of this.polarHandles) { try { await h.remove() } catch { /* already gone */ } }
    this.polarHandles = []
    if (this.polarPlugin) {
      await this.polarPlugin.plugin.setAccStreaming({ enabled: false }).catch(() => {})
      this.polarPlugin = null
    }
    this.listeners = []
    this.accBuffer = []
    this.ring = null
    this.strap = null
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
