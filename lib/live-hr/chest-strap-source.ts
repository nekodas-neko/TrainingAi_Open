// lib/live-hr/chest-strap-source.ts
// LiveHrSource backed by a standard BLE chest strap (Polar H10: Heart Rate
// Service 0x180d / Heart Rate Measurement 0x2a37) via
// @capacitor-community/bluetooth-le. See the polar-h10-ble skill for protocol
// details and quirks.
import type { LiveHrSample, LiveHrSource, SourceConnectionState } from '@/lib/live-hr/types'
import { parseHeartRateMeasurement } from '@/lib/live-hr/hr-measurement'
import { getPairedStrap } from '@/lib/live-hr/paired-strap'
import { getPolarBle, type PolarBlePlugin, type PolarBleStatus } from '@/lib/polar-ble/plugin'
import type { PluginListenerHandle } from '@capacitor/core'

export const HR_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb'
export const HR_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb'

// Keep ~1 sample per `gapMs` from an ambient (all-day) window, dropping the rest
// from persistence only. `lastSentAt` carries across flushes so the cadence holds
// regardless of flush timing. Pure so the all-day DB-volume behaviour is testable.
export function thinAmbientSamples<T extends { at: number }>(
  samples: T[],
  lastSentAt: number | null,
  gapMs: number,
): { kept: T[]; lastSentAt: number | null } {
  const kept: T[] = []
  let last = lastSentAt
  for (const s of samples) {
    if (last === null || s.at - last >= gapMs) { kept.push(s); last = s.at }
  }
  return { kept, lastSentAt: last }
}

const NOT_WORN_GRACE_MS = 15_000
const RECONNECT_DELAYS_MS = [2_000, 5_000, 10_000]
const FLUSH_EVERY_MS = 10_000
const FLUSH_AT_COUNT = 40
// Ambient (all-day, non-workout) mode: thin what we PERSIST to ~1 sample / 30 s so
// all-day 1 Hz streaming doesn't bloat oura_heartrate. Live subscribers (the UI)
// still receive every beat — only the /api/hr-ingest body is thinned. Full 1 Hz is
// kept during a workout (ambient=false).
const AMBIENT_INGEST_GAP_MS = 30_000
// K5: on a failed flush, re-buffer the window so the next flush/stop retries it
// instead of losing it (a no-signal gym otherwise dropped the whole session's HR
// series). Capped so a prolonged outage can't grow the buffer unbounded — ~1 Hz,
// so this keeps roughly the last 20 minutes; older samples are dropped first.
const MAX_BUFFER_SAMPLES = 1_200

// Guarded dynamic import: a browser / an older APK without the plugin degrades to
// inert (state stays 'disconnected'), matching getOuraBle()'s pattern.
async function getBle() {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return null
    const { BleClient } = await import('@capacitor-community/bluetooth-le')
    return BleClient
  } catch { return null }
}

/** The native foreground service's own state vocabulary. Reused from the plugin contract rather
 *  than re-declared, so the two can't drift. */
export type StrapState = PolarBleStatus['state']

export interface StrapLinkStatus {
  /** Raw GATT truth — NOT the worn-gated view the manager sees. */
  gattConnected: boolean
  /** Sensor-contact state (false = clipped in but not on the chest). */
  worn: boolean
  /** True between start() and stop() — i.e. the app is actively trying to use the strap. */
  active: boolean
  /**
   * The native service's state, or the in-WebView fallback path's one bit mapped onto the same
   * vocabulary. `gattConnected` + `active` alone cannot tell "connecting" from "gave up" — which
   * is why the card read "Connecting…" permanently (2026-08-02).
   */
  state: StrapState
}

// The manager constructs the app's single ChestStrapSource; the pairing card reads
// its link status through this accessor (the LiveHrSource interface deliberately
// only exposes the worn-gated state, which would misreport "not connected" for an
// unworn-but-linked strap — the opposite of what a trust readout needs).
let lastInstance: ChestStrapSource | null = null
function registerInstance(s: ChestStrapSource) { lastInstance = s }
export function getChestStrapLinkStatus(): StrapLinkStatus {
  return lastInstance?.linkStatus() ?? { gattConnected: false, worn: true, active: false, state: 'stopped' }
}

export class ChestStrapSource implements LiveHrSource {
  readonly id = 'chest_strap' as const
  private gattConnected = false
  private worn = true
  private notWornSince: number | null = null
  private listeners: Array<(s: Omit<LiveHrSample, 'sourceId'>) => void> = []
  private deviceId: string | null = null
  private stopping = false
  private reconnectAttempt = 0
  private buffer: Array<{ at: number; bpm: number; rr: number[] }> = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private started = false
  private ambient = false
  private lastAmbientSentAt: number | null = null
  private active = false

  // Native-service delegation (APK): when the native PolarBle foreground service is
  // available it owns the connection + ingest (all-day, survives backgrounding — the
  // in-WebView path below is suspended when backgrounded). This source then only
  // relays the service's live beats to the UI. `nativePlugin != null` ⇒ native mode.
  private nativePlugin: PolarBlePlugin | null = null
  private nativeState: string = 'stopped'
  private polarHandles: PluginListenerHandle[] = []

  constructor() { registerInstance(this) }

  // Native mode has no GATT connection in this process (the foreground service owns it) —
  // `nativeState === 'ready'` is the equivalent "raw link" truth for that mode.
  linkStatus(): StrapLinkStatus {
    const gattConnected = this.nativePlugin ? this.nativeState === 'ready' : this.gattConnected
    // The in-WebView fallback path has no service state machine — map its one bit onto the same
    // vocabulary so the label function has a single input shape.
    const state: StrapState = this.nativePlugin
      ? (this.nativeState as StrapState)
      : this.gattConnected ? 'ready' : this.started ? 'connecting' : 'stopped'
    return { gattConnected, worn: this.worn, active: this.active, state }
  }

  // Ambient thinning applies to persistence only; live listeners get every beat.
  setAmbient(ambient: boolean): void {
    if (ambient && !this.ambient) this.lastAmbientSentAt = null
    this.ambient = ambient
    if (this.nativePlugin) this.nativePlugin.setAmbient({ ambient }).catch(() => {})
  }

  connectionState(): SourceConnectionState {
    if (this.nativePlugin) {
      // Native mode: the service reports its state + worn flag.
      if (this.nativeState !== 'ready' || !this.worn) return 'disconnected'
      return 'connected'
    }
    if (!this.gattConnected) return 'disconnected'
    // Worn-gate: report disconnected while off the chest so the manager falls
    // back to the ring (activeSourceId picks the first non-disconnected source).
    return this.worn ? 'connected' : 'disconnected'
  }

  subscribe(cb: (s: Omit<LiveHrSample, 'sourceId'>) => void): () => void {
    this.listeners.push(cb)
    return () => { this.listeners = this.listeners.filter(l => l !== cb) }
  }

  /**
   * Re-arm a connection that has been given up on. Both paths stop trying by design:
   *
   *  - Native (APK): the foreground service exhausts its 6-step ladder (~4 min) and calls
   *    stopSelf(), reasoning that an unreachable strap usually just isn't being worn. Its comment
   *    says "JS restarts it on the next app open" — but nothing did, because startAmbient() is
   *    guarded by `if (ambientWanted) return` and the ambient provider only mounts once. So a strap
   *    put on after launch never connected until the app was restarted (owner report, 2026-08-04).
   *  - Web/older-APK fallback: RECONNECT_DELAYS_MS runs out after ~17 s and onDisconnected returns.
   *
   * Cheap to over-call. The native service ignores a start command while it already has a client,
   * and the fallback path exits immediately while the GATT link is up.
   */
  async retry(): Promise<void> {
    if (!this.started || this.stopping) return
    if (this.nativePlugin) {
      if (this.nativeState === 'ready' || this.nativeState === 'connecting') return
      try {
        await this.nativePlugin.ensurePermissions()
        await this.nativePlugin.startService()
        const s = await this.nativePlugin.getStatus()
        this.nativeState = s.state
        if (typeof s.worn === 'boolean') this.worn = s.worn
      } catch { /* permission declined / older APK — ring covers */ }
      return
    }
    if (this.gattConnected || !this.deviceId) return
    const ble = await getBle()
    if (!ble) return
    this.reconnectAttempt = 0 // fresh ladder, not a resumption of the exhausted one
    await this.connect(ble)
  }

  async start(): Promise<void> {
    // Already started but possibly given up — re-arm rather than returning inert. A workout
    // starting is a strong signal the strap is wanted now, and it used to be silently ignored.
    if (this.started) return this.retry()
    this.stopping = false
    this.active = true
    this.reconnectAttempt = 0
    const paired = getPairedStrap()
    if (!paired) return // no strap paired → inert

    // Prefer the native foreground service (all-day / background-capable). It owns
    // the connection + ingest; this source only relays live beats + status.
    const native = await getPolarBle()
    if (native) {
      this.started = true
      this.nativePlugin = native.plugin
      this.polarHandles.push(await native.plugin.addListener('polarHr', d => {
        this.worn = true
        for (const l of this.listeners) l({ bpm: d.bpm, at: d.at })
      }))
      this.polarHandles.push(await native.plugin.addListener('polarStatus', s => {
        this.nativeState = s.state
        if (typeof s.worn === 'boolean') this.worn = s.worn
      }))
      try {
        await native.plugin.setDevice({ deviceId: paired.deviceId })
        await native.plugin.setIngestUrl({ url: window.location.origin })
        await native.plugin.setAmbient({ ambient: this.ambient })
        await native.plugin.ensurePermissions()
        await native.plugin.startService()
        const s = await native.plugin.getStatus()
        this.nativeState = s.state
        if (typeof s.worn === 'boolean') this.worn = s.worn
      } catch { /* older APK / permission declined — status stays 'stopped', ring covers */ }
      return
    }

    // Web / older APK fallback: in-WebView community BLE plugin (foreground-only).
    const ble = await getBle()
    if (!ble) return
    this.started = true
    this.deviceId = paired.deviceId
    this.flushTimer = setInterval(() => this.flush(), FLUSH_EVERY_MS)
    await this.connect(ble)
  }

  private async connect(ble: NonNullable<Awaited<ReturnType<typeof getBle>>>): Promise<void> {
    if (this.stopping || !this.deviceId) return
    try {
      await ble.initialize()
      await ble.connect(this.deviceId, () => { this.onDisconnected(ble) })
      await ble.startNotifications(this.deviceId, HR_SERVICE, HR_MEASUREMENT, value => {
        const parsed = parseHeartRateMeasurement(new Uint8Array(value.buffer))
        if (!parsed) return
        this.gattConnected = true
        this.reconnectAttempt = 0
        this.updateWorn(parsed.contact)
        if (!this.worn) return // off the chest — drop; ring is covering
        const at = Date.now()
        this.buffer.push({ at, bpm: parsed.bpm, rr: parsed.rr })
        if (this.buffer.length >= FLUSH_AT_COUNT) this.flush()
        for (const l of this.listeners) l({ bpm: parsed.bpm, at })
      })
    } catch {
      this.onDisconnected(ble)
    }
  }

  // contact === null would mean a strap without contact detection — treat as worn.
  private updateWorn(contact: boolean | null) {
    if (contact !== false) {
      this.worn = true
      this.notWornSince = null
      return
    }
    if (this.notWornSince === null) this.notWornSince = Date.now()
    if (Date.now() - this.notWornSince > NOT_WORN_GRACE_MS) this.worn = false
  }

  // Samsung's stack doesn't honour autoConnect — direct connect + bounded retry,
  // same lesson as the ring. After the retries are exhausted the source stays
  // disconnected until something calls retry() (app resume, More tab re-show, or a
  // workout starting — see LiveHrAmbientProvider).
  private onDisconnected(ble: NonNullable<Awaited<ReturnType<typeof getBle>>>) {
    this.gattConnected = false
    if (this.stopping) return
    const delay = RECONNECT_DELAYS_MS[this.reconnectAttempt]
    if (delay === undefined) return
    this.reconnectAttempt += 1
    setTimeout(() => { void this.connect(ble) }, delay)
  }

  private flush() {
    if (this.buffer.length === 0) return
    let samples = this.buffer.splice(0)
    if (this.ambient) {
      const thinned = thinAmbientSamples(samples, this.lastAmbientSentAt, AMBIENT_INGEST_GAP_MS)
      samples = thinned.kept
      this.lastAmbientSentAt = thinned.lastSentAt
    }
    if (samples.length === 0) return
    // Fire-and-forget, but re-buffer on failure (K5): a rejected/non-ok POST used
    // to discard the window permanently, so a flaky-signal session lost its whole
    // strap HR series. The ring's background drain covers ambient HR, but the
    // strap stream has no second chance without this.
    fetch('/api/hr-ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ samples }),
    }).then(res => { if (!res.ok) this.rebuffer(samples) })
      .catch(() => this.rebuffer(samples))
  }

  private rebuffer(samples: Array<{ at: number; bpm: number; rr: number[] }>) {
    // Put the failed (older) window back at the front so the next flush retries it
    // ahead of newly-arrived samples; trim the oldest if the cap is exceeded.
    this.buffer.unshift(...samples)
    if (this.buffer.length > MAX_BUFFER_SAMPLES) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_SAMPLES)
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.active = false

    // Native mode: detach the live relay but LEAVE the foreground service running —
    // it's all-day (like the Oura ring service), independent of workout/ambient
    // toggles. Only unmounting the app (or unpairing) tears it down.
    if (this.nativePlugin) {
      for (const h of this.polarHandles) { try { await h.remove() } catch { /* already gone */ } }
      this.polarHandles = []
      this.listeners = []
      this.nativePlugin = null
      this.nativeState = 'stopped'
      this.started = false
      this.worn = true
      return
    }

    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null }
    this.flush()
    const ble = await getBle()
    if (ble && this.deviceId) {
      try { await ble.stopNotifications(this.deviceId, HR_SERVICE, HR_MEASUREMENT) } catch { /* gone */ }
      try { await ble.disconnect(this.deviceId) } catch { /* gone */ }
    }
    this.listeners = []
    this.deviceId = null
    this.gattConnected = false
    this.worn = true
    this.notWornSince = null
    this.started = false
    this.lastAmbientSentAt = null
  }
}
