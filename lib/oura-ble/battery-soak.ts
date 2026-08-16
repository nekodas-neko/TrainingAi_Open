/**
 * Battery-soak manager: measures the real battery cost of the production step-counter
 * design — REAL_STEPS off, DAYTIME_HR/SpO₂ still recording internally, 0x33 accel
 * streaming continuously — over a multi-hour daytime run.
 *
 * Self-contained singleton (not component state): the run survives navigation, keeps its
 * own watchdog/re-arm timers, samples `{time, battery%, frames, drops}` on an interval,
 * and persists the log to localStorage after every sample so an app kill loses at most
 * one interval. The exported JSON is the drain curve + stream-reliability record that
 * decides how much of Chunk 3 must move native.
 *
 * Safety: only REAL_STEPS (0x0b) is turned off — proven on-device to be the sole blocker
 * of the 0x33 stream; HR/SpO₂ keep recording. Stop restores all measurements via
 * `enableMeasurement`, and the native service re-enables them on every reconnect anyway,
 * so an app kill mid-soak self-heals on the next connect.
 */
import { getOuraBle, type OuraBlePlugin, type OuraBleStatus, type OuraFrameEvent } from './plugin'
import { ACCEL_FRAME_TAG } from './accel'
import { restoreAutoMeasurements, FEATURE_REAL_STEPS, FEATURE_MODE_OFF } from './accel-capture'
import { getStepOrchestrator } from './step-orchestrator'
import { getLiveHrManager } from '@/lib/live-hr/manager'

// The 0x33 stream is firmware time-boxed (~5 min per SetRealtime) — re-arm under that.
const REARM_MS = 4 * 60 * 1000
const WATCHDOG_MS = 30 * 1000
// No accel frame for this long while soaking = the stream died (throttled timer, missed
// re-arm, reconnect re-enabling REAL_STEPS). The watchdog logs it and re-arms.
const STALL_AFTER_MS = 90 * 1000
const SAMPLE_MS = 5 * 60 * 1000
// readBattery is async over BLE — give the response time to land in status.
const BATTERY_SETTLE_MS = 3 * 1000
const STORAGE_KEY = 'ta-oura-ble-soak-log'

export interface SoakSample {
  t: string
  battery: number | null
  /** Cumulative accel frames this run. */
  frames: number
  /** Service-lifetime cumulative drop count (deltas between samples = disconnects). */
  drops: number | null
  state: string | null
  stalls: number
  rearms: number
}

export interface SoakEventEntry {
  t: string
  type: 'start' | 'stall-rearm' | 'reconnect-rearm' | 'stop' | 'app-restart'
  detail?: string
}

export interface SoakLog {
  startedAt: string
  endedAt: string | null
  samples: SoakSample[]
  events: SoakEventEntry[]
}

export interface SoakStatus {
  running: boolean
  log: SoakLog | null
  frames: number
  lastBattery: number | null
  stalls: number
  rearms: number
}

function readStoredLog(): SoakLog | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SoakLog) : null
  } catch {
    return null
  }
}

function persistLog(log: SoakLog | null) {
  try {
    if (log) localStorage.setItem(STORAGE_KEY, JSON.stringify(log))
    else localStorage.removeItem(STORAGE_KEY)
  } catch { /* storage unavailable — the run still works, just won't survive a kill */ }
}

export interface BatterySoak {
  start(): Promise<{ ok: boolean; error?: string }>
  stop(): Promise<void>
  subscribe(cb: (s: SoakStatus) => void): () => void
  getStatus(): SoakStatus
  exportJson(): string | null
}

function createBatterySoak(): BatterySoak {
  let running = false
  let log: SoakLog | null = null
  let frames = 0
  let stalls = 0
  let rearms = 0
  let lastFrameAt = 0
  let lastBattery: number | null = null
  let lastState: string | null = null
  let lastDrops: number | null = null
  let plugin: OuraBlePlugin | null = null
  let handles: Array<{ remove: () => Promise<void> }> = []
  let timers: Array<ReturnType<typeof setInterval>> = []
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let resumeLiveHr = false
  let subscribers: Array<(s: SoakStatus) => void> = []

  // A stored log with no endedAt means the app was killed mid-soak — close it out so the
  // partial curve is still exportable (measurements self-healed on the service's reconnect).
  const stored = readStoredLog()
  if (stored) {
    if (stored.endedAt == null) {
      stored.endedAt = stored.samples[stored.samples.length - 1]?.t ?? stored.startedAt
      stored.events.push({ t: new Date().toISOString(), type: 'app-restart', detail: 'soak ended by app restart' })
      persistLog(stored)
    }
    log = stored
  }

  function status(): SoakStatus {
    return { running, log, frames, lastBattery, stalls, rearms }
  }

  function notify() {
    const s = status()
    for (const cb of subscribers) cb(s)
  }

  function addEvent(type: SoakEventEntry['type'], detail?: string) {
    log?.events.push({ t: new Date().toISOString(), type, detail })
  }

  // REAL_STEPS OFF + startAccel — the arm sequence, re-run by the watchdog and on
  // reconnect (the service re-enables all measurements on every connect, which turns
  // REAL_STEPS back on and kills the stream).
  async function armStream() {
    const p = plugin
    if (!p) return
    try { await p.setFeatureMode({ feature: FEATURE_REAL_STEPS, mode: FEATURE_MODE_OFF }) } catch { /* older APK */ }
    try { await p.startAccel() } catch { /* retried by watchdog */ }
  }

  function onFrames(events: OuraFrameEvent[]) {
    if (!running) return
    let saw = 0
    for (const f of events) if (f.tag === ACCEL_FRAME_TAG) saw++
    if (saw > 0) {
      frames += saw
      lastFrameAt = Date.now()
    }
  }

  function onStatus(s: OuraBleStatus) {
    if (s.battery != null) lastBattery = s.battery
    if (typeof s.dropCount === 'number') lastDrops = s.dropCount
    const prev = lastState
    lastState = s.state
    // Reconnect while soaking: the service just forced measurements back to AUTOMATIC —
    // re-apply REAL_STEPS off and restart the stream.
    if (running && s.state === 'ready' && prev !== 'ready' && prev != null) {
      rearms++
      addEvent('reconnect-rearm', `from ${prev}`)
      void armStream()
      notify()
    }
  }

  function takeSample() {
    const p = plugin
    if (!p || !running) return
    void p.readBattery().catch(() => {})
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(async () => {
      try {
        const s = await p.getStatus()
        if ('battery' in s && s.battery != null) lastBattery = s.battery
        if ('dropCount' in s && typeof s.dropCount === 'number') lastDrops = s.dropCount
        if ('state' in s) lastState = s.state
      } catch { /* sample still records last-known values */ }
      log?.samples.push({
        t: new Date().toISOString(),
        battery: lastBattery,
        frames,
        drops: lastDrops,
        state: lastState,
        stalls,
        rearms,
      })
      persistLog(log)
      notify()
    }, BATTERY_SETTLE_MS)
  }

  return {
    async start() {
      if (running) return { ok: true }
      const ble = await getOuraBle()
      if (!ble) return { ok: false, error: 'Native plugin unavailable (web).' }
      plugin = ble.plugin

      // Exclusive realtime radio, same as the live test: the orchestrator's stopAccel is a
      // global realtime-off and would tear the soak stream down.
      getStepOrchestrator().stop()
      resumeLiveHr = getLiveHrManager().isRunning()
      if (resumeLiveHr) { try { await getLiveHrManager().stop() } catch { /* best effort */ } }

      running = true
      frames = 0; stalls = 0; rearms = 0
      lastFrameAt = Date.now()
      log = { startedAt: new Date().toISOString(), endedAt: null, samples: [], events: [] }
      addEvent('start')
      persistLog(log)

      handles.push(await ble.plugin.addListener('ouraFrame', (f) => onFrames([f])))
      handles.push(await ble.plugin.addListener('ouraFrames', ({ frames: fs }) => onFrames(fs)))
      handles.push(await ble.plugin.addListener('ouraStatus', onStatus))

      await armStream()
      takeSample() // t0 point so the curve starts at the charged reading

      timers.push(setInterval(() => { if (running) void plugin?.startAccel().catch(() => {}) }, REARM_MS))
      timers.push(setInterval(() => {
        if (!running) return
        if (Date.now() - lastFrameAt > STALL_AFTER_MS) {
          stalls++
          lastFrameAt = Date.now() // one stall event per detection, not one per tick
          addEvent('stall-rearm', `no frames for >${Math.round(STALL_AFTER_MS / 1000)}s`)
          void armStream()
          notify()
        }
      }, WATCHDOG_MS))
      timers.push(setInterval(takeSample, SAMPLE_MS))

      notify()
      return { ok: true }
    },

    async stop() {
      if (!running) return
      running = false
      for (const t of timers) clearInterval(t)
      timers = []
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null }
      for (const h of handles) void h.remove().catch(() => {})
      handles = []

      const p = plugin
      if (p) {
        try { await p.stopAccel() } catch { /* stream also self-expires */ }
        // Load-bearing: put REAL_STEPS (and everything else) back to AUTOMATIC.
        await restoreAutoMeasurements(p)
      }
      if (log) {
        log.samples.push({ t: new Date().toISOString(), battery: lastBattery, frames, drops: lastDrops, state: lastState, stalls, rearms })
        log.endedAt = new Date().toISOString()
        addEvent('stop')
        persistLog(log)
      }
      plugin = null

      void getStepOrchestrator().start()
      if (resumeLiveHr) {
        resumeLiveHr = false
        try { await getLiveHrManager().start() } catch { /* best effort */ }
      }
      notify()
    },

    subscribe(cb) {
      subscribers.push(cb)
      return () => { subscribers = subscribers.filter((s) => s !== cb) }
    },
    getStatus: status,
    exportJson() {
      return log ? JSON.stringify(log) : null
    },
  }
}

let appSoak: BatterySoak | null = null
export function getBatterySoak(): BatterySoak {
  if (!appSoak) appSoak = createBatterySoak()
  return appSoak
}
