import type { PluginListenerHandle } from '@capacitor/core'

export interface OuraBleStatus {
  state: 'stopped' | 'idle' | 'scanning' | 'connecting' | 'preparing' | 'authenticating' | 'ready' | 'closed' | 'disconnected'
  battery: number | null
  connectCount: number
  dropCount: number
  lastTimeToConnectMs: number
  totalConnectedMs: number
  serviceUptimeMs: number
  consecutiveFailures: number
  // Native-ingest fields — present only on APKs with the native-ingest build. Their
  // presence is how the tester detects that the SERVICE owns ingest (and disables
  // the legacy JS forwarding loop).
  draining?: boolean
  cursorDs?: number
  ingestPosted?: number
  ingestStored?: number
  lastIngestError?: string | null
  // Raw-store health. `rawStoreOpen: false` means oura_raw.db could not be opened and the
  // service has fallen back to gating the history cursor on the server's 2xx; `lowDisk`
  // means a local commit failed for space, so the cursor is held and the span re-drains.
  rawStoreOpen?: boolean
  lowDisk?: boolean
}

export interface OuraFrameEvent { tag: number; subOp: number | null; hex: string }

/** One row of the device-owned raw store (`oura_raw.db`). `bodyHex` is the frame payload
 *  after the 4-byte deciseconds timestamp — the same slice `oura_raw_samples.body_hex`
 *  holds server-side. `measuredAt` is null until the on-device clock anchor exists: ring
 *  deciseconds count from the ring's own epoch, not wall-clock. */
export interface OuraRawRow {
  ringTs: number
  tag: number
  eventName: string
  bodyHex: string
  measuredAt: number | null
}

/** One observed `(ringDs ↔ utc)` correspondence from the device's own `clock_anchors` table —
 *  shape matches `ClockAnchor` from `@trainingai/shared/oura-ble/clock` (`epoch`/`anchorDs`/
 *  `anchorUtcMs`) plus `observedSource`, so a bridge result can be passed straight into
 *  `resolveDsToMs`/`resolveMsToDs` without remapping. */
export interface OuraClockAnchor {
  epoch: number
  anchorDs: number
  anchorUtcMs: number
  observedSource: string
}

export interface OuraBlePlugin {
  setKey(opts: { hex: string }): Promise<void>
  hasKey(): Promise<{ hasKey: boolean }>
  clearKey(): Promise<void>
  /** The stored ring key, so it can be backed up (Q-537). Rejects with `no key stored` when
   *  there is none, and on any APK built before this method existed — callers must catch. */
  revealKey(): Promise<{ hex: string }>
  ensurePermissions(): Promise<{ granted: boolean }>
  startService(): Promise<void>
  stopService(): Promise<void>
  getStatus(): Promise<OuraBleStatus | { state: 'stopped' }>
  getLog(): Promise<{ lines: string[] }>
  readBattery(): Promise<{ sent: boolean }>
  readInfo(): Promise<{ sent: boolean }>
  syncTime(): Promise<{ sent: boolean }>
  startLiveHr(): Promise<void>
  stopLiveHr(): Promise<void>
  /** Live-HR investigation levers (isolate which command makes the ring stream).
   *  Not implemented on APKs older than this build — callers catch. */
  fastHr(opts: { on: boolean }): Promise<{ sent: boolean }>
  /** Set any feature to any mode (`2f 03 22 <feature> <mode>`). Also the steps lever:
   *  `{feature: 0x0b, mode: 0x01}` enables REAL_STEPS (the `0x7e`/`0x7f` step events). */
  setFeatureMode(opts: { feature: number; mode: number }): Promise<{ sent: boolean }>
  /** "Measure now" — DHR on-demand HR burst (open_ring's `0x26` sub-mode write).
   *  Not implemented on APKs older than this build — callers catch. */
  triggerHrBurst(): Promise<void>
  startAccel(): Promise<void>
  stopAccel(): Promise<void>
  drainHistory(opts?: { fromZero?: boolean }): Promise<{ sent: boolean; cursor: number }>
  confirmStored(opts: { ds: number }): Promise<{ ok: boolean }>
  /** Not implemented on APKs older than the native-ingest build — callers catch. */
  setIngestUrl(opts: { url: string }): Promise<void>
  /** Force DAYTIME_HR + SPO2 + REAL_STEPS to AUTOMATIC (the service does this on every
   *  connect). REAL_STEPS is what makes the ring emit step events. */
  enableMeasurement(): Promise<{ sent: boolean }>
  /** Query DAYTIME_HR + SPO2 + REAL_STEPS modes; responses arrive as ouraFrame events. */
  featureStatus(): Promise<{ sent: boolean }>
  /** Raw-store access. Native owns `oura_raw.db` outright — one SQLite library on the file,
   *  so the WebView reads and marks rows through these calls instead of opening it. All five
   *  are absent on APKs older than the raw-store build (the bridge rejects) and unreachable
   *  on web (`getOuraBle()` returns null off-device) — callers must handle both. */
  getUnrolledRaw(opts?: { limit?: number }): Promise<{ rows: OuraRawRow[] }>
  /** Marks every row at each listed `ringTs` as rolled up. `getUnrolledRaw` never splits a
   *  ringTs across calls, so marking by timestamp can't consume an unseen row. */
  markRolledUp(opts: { ringTsList: number[] }): Promise<{ updated: number }>
  markSynced(opts: { ringTsList: number[] }): Promise<{ updated: number }>
  /** Deletes rolled-up AND server-backed rows older than `olderThanMs`, stopping once free
   *  disk reaches `reserveBytes`. Nothing else is ever eligible — `bodyHex` is what a future
   *  decoder fix re-runs against. */
  pruneRaw(opts: { olderThanMs: number; reserveBytes?: number }): Promise<{ deleted: number }>
  rawStats(): Promise<{ totalRows: number; unrolledRows: number; bytes: number; lowDisk: boolean }>
  /** Every observed `(ringDs ↔ utc)` anchor from the device's own drain history — feed into
   *  `resolveDsToMs`/`resolveMsToDs` (`@trainingai/shared/oura-ble/clock`) to date a ds without
   *  a server round-trip. Absent on APKs older than this build — callers catch. */
  getClockAnchors(): Promise<{ anchors: OuraClockAnchor[] }>
  /** Battery-optimization exemption (keeps the service alive on Samsung). Not
   *  implemented on APKs older than this build — callers catch. */
  isBatteryExempt(): Promise<{ exempt: boolean }>
  requestBatteryExemption(): Promise<{ exempt: boolean; requested: boolean }>
  addListener(event: 'ouraLog', cb: (data: { line: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'ouraStatus', cb: (data: OuraBleStatus) => void): Promise<PluginListenerHandle>
  addListener(event: 'ouraFrame', cb: (data: OuraFrameEvent) => void): Promise<PluginListenerHandle>
  // Batched frames from the native-ingest build (one bridge crossing per ≤100 frames);
  // older APKs emit single `ouraFrame` events instead, so the tester listens to both.
  addListener(event: 'ouraFrames', cb: (data: { frames: OuraFrameEvent[] }) => void): Promise<PluginListenerHandle>
}

/**
 * Returns the native OuraBle plugin, or null when unavailable: plain browser,
 * or an APK built before the plugin existed (the WebView JS ships from Railway
 * independently of the APK — the two can be out of step). Callers must render
 * an explicit unavailable state, never fail silently.
 *
 * Returns `{ plugin }` rather than the plugin itself: `registerPlugin()`'s
 * return value is a Proxy whose `get` trap answers every property access
 * (including `then`) with a callable wrapper, so returning it directly from
 * this async function makes the JS promise-resolution algorithm treat it as
 * a thenable and invoke `plugin.then(...)` as a native call — which the
 * bridge rejects as unimplemented, permanently hanging this promise instead
 * of resolving. Wrapping it in a plain object (not itself thenable) avoids
 * the footgun; `gps-tracking.ts`'s `startGpsWatcher` never returns the raw
 * proxy for the same reason.
 */
export async function getOuraBle(): Promise<{ plugin: OuraBlePlugin } | null> {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return null
    if (!Capacitor.isPluginAvailable('OuraBle')) return null
    return { plugin: registerPlugin<OuraBlePlugin>('OuraBle') }
  } catch {
    return null
  }
}
