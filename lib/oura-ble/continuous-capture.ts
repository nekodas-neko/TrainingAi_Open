/**
 * Continuous daytime accel capture — the production step counter's client half (Chunk 1
 * of the ring-accel step-counter plan, revised architecture).
 *
 * Day/night split: inside the day window, REAL_STEPS is off (proven sole blocker of the
 * 0x33 stream; DAYTIME_HR/SpO₂ keep recording internally), the accel stream runs
 * continuously, and raw magnitude chunks (~2 min) post to /api/oura-ble/accel-chunks
 * where the server gait-counts them into step_live_windows. At night — and whenever the
 * capture disengages — measurements are restored (ring fully stock).
 *
 * Radio ownership: while enabled, the gate-triggered step orchestrator stays stopped
 * (its stopAccel is a global realtime-off). Live-HR has priority — the stream pauses
 * while a live-HR session runs and resumes after.
 *
 * Reliability (all failure modes seen on-device): 4-min re-arm (stream is firmware
 * time-boxed ~5 min), 90-s stall watchdog, reconnect re-arm (the service re-enables all
 * measurements on every connect, silently killing the stream), bounded localStorage
 * retry queue for failed posts (drop-oldest, counted), and battery/diagnostics sampling
 * folded in so day one doubles as the battery soak.
 *
 * Honest limit (Chunk 3 fixes): this runs only while the WebView is alive. If Android
 * kills the app, the stream dies and steps gap until reopen — the ring self-heals its
 * recording on the service's next connect.
 */
import { getOuraBle, type OuraBlePlugin, type OuraBleStatus, type OuraFrameEvent } from './plugin'
import { hexToBytes } from './decode'
import { decodeAccelFrame, ACCEL_FRAME_TAG } from './accel'
import { restoreAutoMeasurements, FEATURE_REAL_STEPS, FEATURE_MODE_OFF } from './accel-capture'
import { getStepOrchestrator } from './step-orchestrator'
import { getBatterySoak } from './battery-soak'
import { getLiveHrManager } from '@/lib/live-hr/manager'

const TOGGLE_KEY = 'ta_ring_continuous_capture'
// Local device hours — the streaming day window. Outside it the ring is fully stock.
export const DAY_START_HOUR = 6
export const DAY_END_HOUR = 22

const REARM_MS = 4 * 60 * 1000
const TICK_MS = 30 * 1000
const STALL_AFTER_MS = 90 * 1000
const CHUNK_MS = 2 * 60 * 1000
const CHUNK_MAX_SAMPLES = 12_000
const DEFAULT_RATE_HZ = 50
const BATTERY_SAMPLE_MS = 5 * 60 * 1000
// Bounded offline retry queue (~30 min of chunks). Sensor telemetry, not user-entered
// data — beyond the cap the oldest chunk is dropped and counted, never queued unbounded.
const PENDING_KEY = 'ta-oura-ble-pending-accel-chunks'
const PENDING_CAP = 15
const DIAG_KEY = 'ta-oura-ble-continuous-diag'
const DIAG_CAP = 1500

export type ContinuousCaptureState =
  | 'off' | 'no-plugin' | 'night' | 'streaming' | 'paused-live-hr'

export interface ContinuousDiagEntry {
  t: string
  type: 'engage' | 'disengage' | 'day-start' | 'night' | 'live-hr-pause' | 'live-hr-resume'
      | 'stall-rearm' | 'reconnect-rearm' | 'chunk-posted' | 'chunk-queued' | 'chunk-dropped'
      | 'battery'
  battery?: number | null
  frames?: number
  steps?: number
  detail?: string
}

export interface ContinuousCaptureStatus {
  enabled: boolean
  state: ContinuousCaptureState
  frames: number
  postedSteps: number
  postedChunks: number
  pendingChunks: number
  droppedChunks: number
  stalls: number
  rearms: number
  lastBattery: number | null
}

interface PendingChunk {
  startedAt: string
  /** Wall clock of the LAST frame appended to this chunk. The server cannot derive it: the accel
   *  stream gaps by design (firmware time-boxes it at ~5 min, a 90 s stall watchdog re-arms it, and
   *  a reconnect re-arms it), so `samples / rate` is the stream's *duration*, not the *span* it
   *  covers. Deriving the end from the sample count planted a chunk's steps minutes before they
   *  happened — the same "count from one stream, window from another" fault as the 2026-07-28
   *  live-window over-count. Optional so an older client that omits it still works. */
  endedAt?: string
  sampleRate: number
  magnitudes: number[]
}

export function isContinuousCaptureEnabled(): boolean {
  try { return localStorage.getItem(TOGGLE_KEY) === '1' } catch { return false }
}

function persistToggle(on: boolean) {
  try { localStorage.setItem(TOGGLE_KEY, on ? '1' : '0') } catch { /* stays default-off */ }
}

function readPending(): PendingChunk[] {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') } catch { return [] }
}
function writePending(items: PendingChunk[]) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(items)) } catch { /* storage full — retry queue lost, drop counter still shows it */ }
}

async function postChunk(chunk: PendingChunk): Promise<{ ok: boolean; steps: number }> {
  try {
    const res = await fetch('/api/oura-ble/accel-chunks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk),
    })
    if (!res.ok) return { ok: false, steps: 0 }
    const body = await res.json().catch(() => null) as { steps?: number } | null
    return { ok: true, steps: typeof body?.steps === 'number' ? body.steps : 0 }
  } catch {
    return { ok: false, steps: 0 }
  }
}

export function isWithinDayWindow(hour: number): boolean {
  return hour >= DAY_START_HOUR && hour < DAY_END_HOUR
}

export interface ContinuousCapture {
  /** Mount (call once from sync-provider). Engages only if the toggle is on. */
  start(): Promise<void>
  /** Unmount — disengages and restores measurements if engaged. */
  stop(): void
  /** Flip the toggle at runtime (from the debug card). Engages/disengages live. */
  setEnabled(on: boolean): Promise<void>
  subscribe(cb: (s: ContinuousCaptureStatus) => void): () => void
  getStatus(): ContinuousCaptureStatus
  exportDiagnostics(): string
}

function createContinuousCapture(): ContinuousCapture {
  let engaged = false      // toggle on: listeners live, tick running
  let streaming = false    // actually inside the day window and not yielded to live-HR
  let state: ContinuousCaptureState = 'off'
  let plugin: OuraBlePlugin | null = null
  let handles: Array<{ remove: () => Promise<void> }> = []
  let timers: Array<ReturnType<typeof setInterval>> = []
  let subscribers: Array<(s: ContinuousCaptureStatus) => void> = []

  let frames = 0
  let stalls = 0
  let rearms = 0
  let postedSteps = 0
  let postedChunks = 0
  let droppedChunks = 0
  let lastFrameAt = 0
  let lastBattery: number | null = null
  let lastConnState: string | null = null
  let lastBatterySampleAt = 0
  let lastRearmAt = 0

  let chunkBuf: number[] = []
  let chunkRate = DEFAULT_RATE_HZ
  let chunkStartedAtMs = 0

  let diag: ContinuousDiagEntry[] = []
  try { diag = JSON.parse(localStorage.getItem(DIAG_KEY) ?? '[]') } catch { /* fresh */ }

  function log(type: ContinuousDiagEntry['type'], extra?: Partial<ContinuousDiagEntry>) {
    diag.push({ t: new Date().toISOString(), type, ...extra })
    if (diag.length > DIAG_CAP) diag.splice(0, diag.length - DIAG_CAP)
    try { localStorage.setItem(DIAG_KEY, JSON.stringify(diag)) } catch { /* diag only */ }
  }

  function status(): ContinuousCaptureStatus {
    return {
      enabled: isContinuousCaptureEnabled(),
      state,
      frames,
      postedSteps,
      postedChunks,
      pendingChunks: readPending().length,
      droppedChunks,
      stalls,
      rearms,
      lastBattery,
    }
  }

  function notify() {
    const s = status()
    for (const cb of subscribers) cb(s)
  }

  async function armStream() {
    const p = plugin
    if (!p) return
    lastRearmAt = Date.now()
    try { await p.setFeatureMode({ feature: FEATURE_REAL_STEPS, mode: FEATURE_MODE_OFF }) } catch { /* older APK */ }
    try { await p.startAccel() } catch { /* watchdog retries */ }
  }

  function onFrames(events: OuraFrameEvent[]) {
    if (!streaming) return
    for (const f of events) {
      if (f.tag !== ACCEL_FRAME_TAG || !f.hex) continue
      const decoded = decodeAccelFrame(hexToBytes(f.hex))
      if (!decoded) continue
      frames++
      lastFrameAt = Date.now()
      if (decoded.sampleRate > 0) chunkRate = decoded.sampleRate
      if (chunkBuf.length === 0) chunkStartedAtMs = Date.now() - Math.round((decoded.samples.length / chunkRate) * 1000)
      for (const s of decoded.samples) chunkBuf.push(Math.round(s.magnitude))
      if (chunkBuf.length >= CHUNK_MAX_SAMPLES) void flushChunk()
    }
  }

  async function flushChunk() {
    if (chunkBuf.length === 0) return
    const chunk: PendingChunk = {
      startedAt: new Date(chunkStartedAtMs).toISOString(),
      // `lastFrameAt` is when the final frame in this buffer actually arrived — the real end of the
      // span these samples cover, gaps included.
      endedAt: new Date(lastFrameAt).toISOString(),
      sampleRate: chunkRate,
      magnitudes: chunkBuf,
    }
    chunkBuf = []
    // Below the counter's ~2.5 s analysis window nothing can count — don't waste a post.
    if (chunk.magnitudes.length < 150) return
    const res = await postChunk(chunk)
    if (res.ok) {
      postedChunks++
      postedSteps += res.steps
      log('chunk-posted', { frames, steps: res.steps, detail: `${chunk.magnitudes.length} samples` })
      void flushPendingQueue()
    } else {
      const pending = [...readPending(), chunk]
      while (pending.length > PENDING_CAP) {
        pending.shift()
        droppedChunks++
        log('chunk-dropped')
      }
      writePending(pending)
      log('chunk-queued', { detail: `${chunk.magnitudes.length} samples` })
    }
    notify()
  }

  async function flushPendingQueue() {
    const pending = readPending()
    if (pending.length === 0) return
    const remaining: PendingChunk[] = []
    for (const c of pending) {
      const res = await postChunk(c)
      if (res.ok) { postedChunks++; postedSteps += res.steps } else remaining.push(c)
    }
    writePending(remaining)
  }

  async function enterStreaming(reason: 'day-start' | 'live-hr-resume' | 'engage') {
    streaming = true
    state = 'streaming'
    lastFrameAt = Date.now()
    log(reason === 'engage' ? 'engage' : reason)
    await armStream()
    notify()
  }

  async function exitStreaming(next: Exclude<ContinuousCaptureState, 'streaming'>, opts: { restore: boolean }) {
    const wasStreaming = streaming
    streaming = false
    state = next
    if (wasStreaming) await flushChunk()
    const p = plugin
    if (p) {
      try { await p.stopAccel() } catch { /* stream also self-expires */ }
      // Restore = ring fully stock (night/disengage). A live-HR pause keeps REAL_STEPS
      // off — the pause is minutes long and toggling it is itself a failure point.
      if (opts.restore) await restoreAutoMeasurements(p)
    }
    notify()
  }

  function onStatus(s: OuraBleStatus) {
    if (s.battery != null) lastBattery = s.battery
    const prev = lastConnState
    lastConnState = s.state
    // Reconnect: the service just re-enabled all measurements — REAL_STEPS is back on
    // and the stream is dead. Re-apply and restart if we should be streaming.
    if (streaming && s.state === 'ready' && prev !== 'ready' && prev != null) {
      rearms++
      log('reconnect-rearm', { detail: `from ${prev}` })
      void armStream()
      notify()
    }
  }

  async function tick() {
    if (!engaged) return
    const inDay = isWithinDayWindow(new Date().getHours())
    const liveHr = getLiveHrManager().isRunning()

    if (streaming) {
      if (!inDay) { await exitStreaming('night', { restore: true }); log('night'); return }
      if (liveHr) { await exitStreaming('paused-live-hr', { restore: false }); log('live-hr-pause'); return }
      // Stall watchdog — no frames despite worn+moving means throttled timers, a missed
      // re-arm, or a reconnect that beat the status listener. Re-arm is idempotent.
      if (Date.now() - lastFrameAt > STALL_AFTER_MS) {
        stalls++
        lastFrameAt = Date.now()
        log('stall-rearm')
        await armStream()
      } else if (Date.now() - lastRearmAt > REARM_MS) {
        // Routine re-arm: the stream is firmware time-boxed (~5 min per SetRealtime).
        lastRearmAt = Date.now()
        void plugin?.startAccel().catch(() => {})
      }
      // Chunk cadence — post every ~CHUNK_MS.
      if (chunkBuf.length > 0 && Date.now() - chunkStartedAtMs >= CHUNK_MS) await flushChunk()
    } else {
      if (inDay && !liveHr) {
        await enterStreaming(state === 'paused-live-hr' ? 'live-hr-resume' : 'day-start')
      }
    }

    if (Date.now() - lastBatterySampleAt >= BATTERY_SAMPLE_MS) {
      lastBatterySampleAt = Date.now()
      void plugin?.readBattery().catch(() => {})
      log('battery', { battery: lastBattery, frames, steps: postedSteps })
    }
    notify()
  }

  async function engage() {
    if (engaged) return
    const ble = await getOuraBle()
    if (!ble) { state = 'no-plugin'; notify(); return }
    plugin = ble.plugin
    engaged = true

    // Exclusive radio: the gate orchestrator's stopAccel is a global realtime-off, and a
    // running battery soak would fight over the stream. Both stay down while engaged.
    getStepOrchestrator().stop()
    if (getBatterySoak().getStatus().running) await getBatterySoak().stop()

    handles.push(await ble.plugin.addListener('ouraFrame', (f) => onFrames([f])))
    handles.push(await ble.plugin.addListener('ouraFrames', ({ frames: fs }) => onFrames(fs)))
    handles.push(await ble.plugin.addListener('ouraStatus', onStatus))

    lastBatterySampleAt = 0
    if (isWithinDayWindow(new Date().getHours()) && !getLiveHrManager().isRunning()) {
      await enterStreaming('engage')
    } else {
      state = getLiveHrManager().isRunning() ? 'paused-live-hr' : 'night'
      log('engage', { detail: state })
      notify()
    }
    timers.push(setInterval(() => { void tick() }, TICK_MS))
    void flushPendingQueue()
  }

  async function disengage(opts: { restartOrchestrator: boolean }) {
    if (!engaged) return
    engaged = false
    for (const t of timers) clearInterval(t)
    timers = []
    await exitStreaming('off', { restore: true })
    for (const h of handles) void h.remove().catch(() => {})
    handles = []
    log('disengage')
    plugin = null
    if (opts.restartOrchestrator) void getStepOrchestrator().start()
    notify()
  }

  return {
    async start() {
      if (isContinuousCaptureEnabled()) await engage()
      else notify()
    },
    stop() {
      void disengage({ restartOrchestrator: false })
    },
    async setEnabled(on: boolean) {
      persistToggle(on)
      if (on) await engage()
      else await disengage({ restartOrchestrator: true })
      notify()
    },
    subscribe(cb) {
      subscribers.push(cb)
      return () => { subscribers = subscribers.filter((s) => s !== cb) }
    },
    getStatus: status,
    exportDiagnostics() {
      return JSON.stringify({ exportedAt: new Date().toISOString(), status: status(), events: diag })
    },
  }
}

let appContinuousCapture: ContinuousCapture | null = null
export function getContinuousCapture(): ContinuousCapture {
  if (!appContinuousCapture) appContinuousCapture = createContinuousCapture()
  return appContinuousCapture
}
