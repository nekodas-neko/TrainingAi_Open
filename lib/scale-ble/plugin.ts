import type { PluginListenerHandle } from '@capacitor/core'

export interface ScaleBleStatus {
  state: 'idle' | 'connecting' | 'preparing' | 'waiting' | 'retrying' | 'closed' | 'stopped'
}

/** Terminal outcome of one weigh-in wake — fires exactly once per wake, after all retries
 *  (ScaleBleService.MAX_ATTEMPTS) either produced a reading or gave up. Drives the live
 *  in-app toast (capacitor-native-init.tsx) since the OS notification-shade notifications
 *  aren't visible while the app is open. */
export interface ScaleBleResult {
  outcome: 'logged' | 'pending' | 'skipped' | 'failed'
  weightKg?: number
  isAdditionalReadingToday?: boolean
}

export interface ScaleBlePlugin {
  /** Store the scale's stable MAC so the native service connects directly. */
  setDevice(opts: { deviceId: string }): Promise<void>
  hasDevice(): Promise<{ hasDevice: boolean }>
  clearDevice(): Promise<void>
  ensurePermissions(): Promise<{ granted: boolean }>
  /** Opt-in background sync — starts the periodic-connect foreground service. */
  startService(): Promise<void>
  stopService(): Promise<void>
  getStatus(): Promise<ScaleBleStatus>
  setIngestUrl(opts: { url: string }): Promise<void>
  /** Scopes the live foreground BLE scan (fast path added in #956) to the home screen
   *  specifically — native has no visibility into client-side route changes on its own. */
  setHomeScreenActive(opts: { active: boolean }): Promise<void>
  addListener(event: 'scaleLog', cb: (data: { line: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'scaleStatus', cb: (data: ScaleBleStatus) => void): Promise<PluginListenerHandle>
  addListener(event: 'scaleResult', cb: (data: ScaleBleResult) => void): Promise<PluginListenerHandle>
}

/**
 * Returns the native ScaleBle plugin, or null when unavailable: plain browser, or an APK built
 * before this plugin existed (the WebView JS ships from Railway independently of the APK — the
 * two can be out of step).
 *
 * Returns `{ plugin }` rather than the raw proxy for the thenable-footgun reason documented in
 * lib/oura-ble/plugin.ts.
 */
export async function getScaleBle(): Promise<{ plugin: ScaleBlePlugin } | null> {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return null
    if (!Capacitor.isPluginAvailable('ScaleBle')) return null
    return { plugin: registerPlugin<ScaleBlePlugin>('ScaleBle') }
  } catch {
    return null
  }
}
