// lib/live-hr/oura-ring-source.ts
// LiveHrSource backed by the Oura ring over the existing native BLE plugin.
//
// The ring will NOT stream HR live over BLE for us (confirmed on-device 2026-07-09:
// it acks CONNECTED_LIVE + fast-HR but sends zero HR frames — only accel streams).
// So this is "near-live" (path B): the ring records HR to its own history the whole
// time it's worn, and we periodically `drainHistory()` during the workout to pull the
// most-recently-recorded beat. The drained frames already flow through `ouraFrames`;
// we decode the newest one and surface it. Lags ~1 drain interval — no native change.
import { getOuraBle, type OuraBlePlugin, type OuraFrameEvent } from '@/lib/oura-ble/plugin'
import type { PluginListenerHandle } from '@capacitor/core'
import { smoothedBpmFromFrames } from '@/lib/live-hr/decode-live-hr'
import type { LiveHrDiagnostics, LiveHrSample, LiveHrSource, SourceConnectionState } from '@/lib/live-hr/types'

// Tags that can carry a heart rate: aohr (always-on HR), the two IBI events, and
// the 5-min HRV summary. Used only to tag diagnostic counters, not for decoding.
const HR_TAGS = new Set([0x86, 0x80, 0x60, 0x5d])
const MAX_SAMPLE_HEXES = 10
// Re-fire the DHR on-demand burst well inside the ring's ~20 s auto-revert so it stays
// continuously engaged (no lull between triggers) — this is the true-live path.
const BURST_INTERVAL_MS = 10_000
// Drain recorded history less often, purely as a fallback for when the burst isn't
// streaming (already-synced → cheap no-op most ticks).
const DRAIN_INTERVAL_MS = 20_000

interface DiagState {
  framesSeen: number
  hrFramesSeen: number
  decodeHits: number
  tagCounts: Record<string, number>
  lastBpm: number | null
  lastBpmAt: number | null
  sampleHexes: string[]
}

function freshDiag(): DiagState {
  return { framesSeen: 0, hrFramesSeen: 0, decodeHits: 0, tagCounts: {}, lastBpm: null, lastBpmAt: null, sampleHexes: [] }
}

export class OuraRingSource implements LiveHrSource {
  readonly id = 'oura_ble' as const
  private state: SourceConnectionState = 'disconnected'
  private listeners: Array<(s: Omit<LiveHrSample, 'sourceId'>) => void> = []
  private handles: PluginListenerHandle[] = []
  private diag: DiagState = freshDiag()
  private plugin: OuraBlePlugin | null = null
  private burstTimer: ReturnType<typeof setInterval> | null = null
  private drainTimer: ReturnType<typeof setInterval> | null = null
  // Drive the on-demand burst only while true (rest between sets). During a set this is
  // false: the burst timer coasts (no PPG power spent on a motion-corrupted reading) and
  // only the light history drain keeps the readout alive. Defaults on.
  private forced = true
  // Greatest ring timestamp surfaced so far — only a newer beat updates the readout,
  // so re-draining the same tail can't keep the value looking "fresh" forever.
  private lastRingTs = 0

  connectionState(): SourceConnectionState {
    return this.state
  }

  subscribe(cb: (s: Omit<LiveHrSample, 'sourceId'>) => void): () => void {
    this.listeners.push(cb)
    return () => { this.listeners = this.listeners.filter(l => l !== cb) }
  }

  getDiagnostics(): LiveHrDiagnostics {
    return {
      sourceId: this.id,
      connectionState: this.state,
      framesSeen: this.diag.framesSeen,
      hrFramesSeen: this.diag.hrFramesSeen,
      decodeHits: this.diag.decodeHits,
      tagCounts: { ...this.diag.tagCounts },
      lastBpm: this.diag.lastBpm,
      lastBpmAt: this.diag.lastBpmAt,
      sampleHexes: [...this.diag.sampleHexes],
    }
  }

  private emitFrames(frames: OuraFrameEvent[]) {
    // Record what arrived BEFORE any decode filtering — the whole point of the
    // diagnostic is the case where frames arrive but none decode to a BPM.
    for (const f of frames) {
      this.diag.framesSeen++
      const key = '0x' + f.tag.toString(16).padStart(2, '0')
      this.diag.tagCounts[key] = (this.diag.tagCounts[key] ?? 0) + 1
      if (HR_TAGS.has(f.tag)) {
        this.diag.hrFramesSeen++
        this.diag.sampleHexes.push(f.hex)
        if (this.diag.sampleHexes.length > MAX_SAMPLE_HEXES) this.diag.sampleHexes.shift()
      }
    }
    // Median over the recent fresh beats (never a single newest beat) — a lone
    // motion/decode artifact can't move the readout. smoothedBpmFromFrames returns
    // null when no frame newer than lastRingTs carries a usable beat, which also
    // enforces the near-live guard (a re-drained old tail contributes nothing, so a
    // stalled feed stays blank for the hook's staleness gate).
    const smoothed = smoothedBpmFromFrames(frames.map(f => f.hex), this.lastRingTs)
    if (smoothed == null) return
    this.diag.decodeHits++
    this.lastRingTs = smoothed.ringTs
    this.diag.lastBpm = smoothed.bpm
    this.diag.lastBpmAt = Date.now()
    const sample = { bpm: smoothed.bpm, at: Date.now() }
    this.state = 'connected'
    for (const l of this.listeners) l(sample)
  }

  async start(): Promise<void> {
    this.diag = freshDiag()
    this.lastRingTs = 0
    const ble = await getOuraBle()
    if (!ble) { this.state = 'disconnected'; return } // web sandbox / old APK — inert
    this.plugin = ble.plugin
    this.state = 'connecting'
    try {
      this.handles.push(await ble.plugin.addListener('ouraFrames', d => this.emitFrames(d.frames)))
      this.handles.push(await ble.plugin.addListener('ouraFrame', d => this.emitFrames([d])))
      // CONNECTED_LIVE + fast-HR; may also make the ring record HR more densely.
      await ble.plugin.startLiveHr()
      // Fire the on-demand burst immediately, then keep it engaged on its own timer
      // (only while forced); drain history less often as the always-on fallback.
      this.fireBurst()
      this.fireDrain()
      this.burstTimer = setInterval(() => { if (this.forced) this.fireBurst() }, BURST_INTERVAL_MS)
      this.drainTimer = setInterval(() => this.fireDrain(), DRAIN_INTERVAL_MS)
    } catch {
      this.state = 'disconnected'
    }
  }

  // The DHR on-demand burst ("measure now") — the ring streams live 0x80/0x60 HR events
  // for ~20 s. triggerHrBurst is absent on older APKs; the optional chain + catch keeps
  // those on the drain-only path. Frames arrive via the `ouraFrames` listener.
  private fireBurst() {
    this.plugin?.triggerHrBurst?.().catch(() => { /* old APK / not connected */ })
  }

  // Fallback: pull the ring's freshly-recorded HR from history (no-op if already synced
  // or the service is mid-drain / disconnected — rejects, caught).
  private fireDrain() {
    this.plugin?.drainHistory().catch(() => { /* not connected / mid-drain */ })
  }

  // User tapped "Measure": kick a burst (and a drain) right now, off the timer.
  async measureNow(): Promise<void> {
    this.fireBurst()
    this.fireDrain()
  }

  // Rest → force the burst (and fire one now so HR appears fast); set → coast on drains.
  setForced(forced: boolean): void {
    if (forced && !this.forced) this.fireBurst()
    this.forced = forced
  }

  async stop(): Promise<void> {
    if (this.burstTimer) { clearInterval(this.burstTimer); this.burstTimer = null }
    if (this.drainTimer) { clearInterval(this.drainTimer); this.drainTimer = null }
    try { await this.plugin?.stopLiveHr() } catch { /* ring/service gone — nothing to stop */ }
    for (const h of this.handles) { try { await h.remove() } catch { /* already removed */ } }
    this.handles = []
    this.listeners = []
    this.plugin = null
    this.state = 'disconnected'
  }
}
