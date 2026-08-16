import type { PluginListenerHandle } from '@capacitor/core'

export interface PolarBleStatus {
  state: 'stopped' | 'idle' | 'connecting' | 'preparing' | 'ready' | 'closed' | 'disconnected'
  worn?: boolean
  ambient?: boolean
  failures?: number
  /** Strap battery %, from the standard Battery Service. Null until the first read
   *  completes after connecting; also shown in the persistent connection notification. */
  battery?: number | null
  /** Whether the cadence accelerometer stream is running (opt-in, run/walk only). */
  accStreaming?: boolean
  /** PMD frame encoding the strap is actually emitting; -1 until a frame arrives. */
  accFrameType?: number
  accFramesSeen?: number
  accSampleRate?: number
}

/** One batch of accelerometer magnitudes from the strap (~1 s worth per event). */
export interface PolarAccelBatch {
  magnitudes: number[]
  sampleRate: number
  frameType: number
  /** Wall-clock ms at the END of the batch. */
  at: number
}

export interface PolarBlePlugin {
  /** Store the strap's stable MAC so the native service connects directly. */
  setDevice(opts: { deviceId: string }): Promise<void>
  hasDevice(): Promise<{ hasDevice: boolean }>
  clearDevice(): Promise<void>
  ensurePermissions(): Promise<{ granted: boolean }>
  startService(): Promise<void>
  stopService(): Promise<void>
  getStatus(): Promise<PolarBleStatus>
  setIngestUrl(opts: { url: string }): Promise<void>
  /** Ambient (all-day, thinned persistence) vs full (in-workout, 1 Hz). */
  setAmbient(opts: { ambient: boolean }): Promise<void>
  /** Start/stop the cadence accelerometer stream. Bounded to an activity — never all-day. */
  setAccStreaming(opts: { enabled: boolean }): Promise<void>
  addListener(event: 'polarLog', cb: (data: { line: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'polarStatus', cb: (data: PolarBleStatus) => void): Promise<PluginListenerHandle>
  addListener(event: 'polarHr', cb: (data: { bpm: number; at: number }) => void): Promise<PluginListenerHandle>
  addListener(event: 'polarAccel', cb: (data: PolarAccelBatch) => void): Promise<PluginListenerHandle>
}

/**
 * Returns the native PolarBle plugin, or null when unavailable: plain browser, or
 * an APK built before this plugin existed (the WebView JS ships from Railway
 * independently of the APK — the two can be out of step). Callers fall back to the
 * in-WebView `@capacitor-community/bluetooth-le` path.
 *
 * Returns `{ plugin }` rather than the raw proxy for the thenable-footgun reason
 * documented in lib/oura-ble/plugin.ts.
 */
export async function getPolarBle(): Promise<{ plugin: PolarBlePlugin } | null> {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return null
    if (!Capacitor.isPluginAvailable('PolarBle')) return null
    return { plugin: registerPlugin<PolarBlePlugin>('PolarBle') }
  } catch {
    return null
  }
}
