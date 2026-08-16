// lib/live-hr/types.ts
// Shared contracts for the source-agnostic live-HR layer. A "source" is a device
// that streams heart rate (the Oura ring today; a BLE chest strap later). The
// manager picks one active source by precedence and exposes a single stream.

export type LiveHrSourceId = 'oura_ble' | 'chest_strap'

export interface LiveHrSample {
  bpm: number
  /** Wall-clock receive time (ms). We stamp on receipt — the ring's own clock is
   *  deciseconds since an arbitrary epoch and irrelevant for a live readout. */
  at: number
  sourceId: LiveHrSourceId
}

export type SourceConnectionState = 'connected' | 'connecting' | 'disconnected'

export interface LiveHrSource {
  id: LiveHrSourceId
  connectionState(): SourceConnectionState
  /** Begin live measurement. Must be a no-op (not throw) when the device/bridge is
   *  unavailable — e.g. the web sandbox. */
  start(): Promise<void>
  stop(): Promise<void>
  /** Register a callback for each decoded beat. Returns an unsubscribe fn. */
  subscribe(cb: (sample: Omit<LiveHrSample, 'sourceId'>) => void): () => void
  /** Force an immediate reading now (e.g. the user tapped "Measure"). Optional —
   *  a source with no on-demand trigger omits it. Must not throw when unavailable. */
  measureNow?(): Promise<void>
  /** Whether to actively drive live HR (the battery-costly on-demand burst) right now.
   *  On during rest between sets (still hand → good reading); off during a set (motion →
   *  useless reading + wasted power), when the source coasts on the light history fallback. */
  setForced?(forced: boolean): void
  /** Ambient (all-day, non-workout) vs full (in-workout) mode. In ambient mode a
   *  source may thin what it persists to keep all-day streaming from bloating the
   *  DB, while still emitting every beat to live subscribers. Optional — a source
   *  with nothing to throttle omits it. Must not throw. */
  setAmbient?(ambient: boolean): void
  /** Re-attempt a connection that has been given up on, WITHOUT tearing the source down and
   *  restarting it. Both strap paths stop trying after a bounded backoff ladder, so without this
   *  the only way back is an app restart. Idempotent, cheap while already connected, and must not
   *  throw. Optional — a source that never gives up omits it. */
  retry?(): Promise<void>
  /** On-device diagnostics for the "no HR" case: what frames arrived and whether
   *  any decoded to a usable BPM. Optional — a source that can't self-report omits it. */
  getDiagnostics?(): LiveHrDiagnostics
}

/**
 * Snapshot of what a source has seen since it started — surfaced on the workout
 * Live HR card (behind a toggle) so the "—" case can be diagnosed on-device
 * without the admin BLE tester. `framesSeen === 0` ⇒ nothing reaching JS (bridge/
 * service/capture problem); `hrFramesSeen > 0` but `decodeHits === 0` ⇒ HR frames
 * arrive but the decoder can't read them (decode-layout bug).
 */
export interface LiveHrDiagnostics {
  sourceId: LiveHrSourceId
  connectionState: SourceConnectionState
  /** Every frame forwarded by the native bridge, any tag. */
  framesSeen: number
  /** Frames whose tag can carry HR (aohr 0x86, IBI 0x80/0x60, hrv 0x5d). */
  hrFramesSeen: number
  /** Frame batches that yielded a valid in-range BPM. */
  decodeHits: number
  /** Histogram of frame tags seen, keyed as `'0x86'` etc. */
  tagCounts: Record<string, number>
  lastBpm: number | null
  lastBpmAt: number | null
  /** Most recent HR-tag frame hexes, newest last — copy these for offline decode. */
  sampleHexes: string[]
}

export interface LiveHrCurrent {
  bpm: number | null
  at: number | null
  sourceId: LiveHrSourceId | null
}
