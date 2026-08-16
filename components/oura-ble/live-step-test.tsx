'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useCopy } from '@/lib/use-copy'
import { getOuraBle, type OuraFrameEvent } from '@/lib/oura-ble/plugin'
import { hexToBytes } from '@/lib/oura-ble/decode'
import { decodeAccelFrame, StepPeakCounter, ACCEL_FRAME_TAG } from '@/lib/oura-ble/accel'
import { countGaitGatedSteps } from '@/lib/oura-ble/gait-step-count'
import { disableAutoMeasurements, restoreAutoMeasurements, isAutoCaptureEnabled, setAutoCaptureEnabled } from '@/lib/oura-ble/accel-capture'
import { getStepOrchestrator, type StepOrchestratorStatus } from '@/lib/oura-ble/step-orchestrator'
import { getLiveHrManager } from '@/lib/live-hr/manager'

/**
 * Tier-2 spike: live step counting from the ring's realtime accel stream (0x33).
 * Answers the on-device go/no-go for the accurate step path: does `SetRealtime(ACM)`
 * actually deliver 0x33 samples on our ring worn+moving, and does a naive peak-counter
 * over the magnitude land near a counted walk? Everything here is JS — the native
 * service already bridges all frames — but ONLY provable on-device (BLE inert on web).
 *
 * The stream is firmware time-boxed (~5 min per SetRealtime), so while running we
 * re-arm startAccel every 4 min.
 */

const REARM_MS = 4 * 60 * 1000
// Rolling raw-magnitude buffer cap for the capture/export (~3 min at 50 Hz). Enough to
// characterise a labelled walk vs hand-motion sample offline without unbounded memory.
const MAX_ACCEL_SAMPLES = 9000

// localStorage retry buffer for saved windows that failed to POST — flushed on mount
// and after every successful save. Keyed by startedAt so a re-flush of an already-saved
// window is a harmless idempotent re-post (the server's UNIQUE(user_id, start_ds) makes
// it a no-op). Full outbox-domain machinery is overkill for this manual/tester flow.
const PENDING_KEY = 'ta-oura-ble-pending-live-steps'
interface PendingWindow { startedAt: string; endedAt: string; steps: number }

function readPending(): PendingWindow[] {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') } catch { return [] }
}
function writePending(items: PendingWindow[]) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(items)) } catch { /* storage unavailable */ }
}
async function postLiveSteps(w: PendingWindow): Promise<boolean> {
  try {
    const res = await fetch('/api/oura-ble/live-steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(w),
    })
    return res.ok
  } catch {
    return false
  }
}

export function LiveStepTest() {
  const [running, setRunning] = useState(false)
  const [frames, setFrames] = useState(0)
  const [count, setCount] = useState(0)
  const [samples, setSamples] = useState(0)
  const [sampleRate, setSampleRate] = useState<number | null>(null)
  const [magnitude, setMagnitude] = useState<{ last: number; baseline: number } | null>(null)
  const [note, setNote] = useState('')
  const [lastResult, setLastResult] = useState<PendingWindow | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [pendingCount, setPendingCount] = useState(0)
  const [orchestratorStatus, setOrchestratorStatus] = useState<StepOrchestratorStatus | null>(null)
  const [autoCapture, setAutoCapture] = useState(false)

  // Read the flag in an effect (never a lazy initializer — cache/localStorage reads there
  // caused hydration mismatches, per CLAUDE.md).
  useEffect(() => { setAutoCapture(isAutoCaptureEnabled()) }, [])

  useEffect(() => {
    const orchestrator = getStepOrchestrator()
    setOrchestratorStatus(orchestrator.getStatus())
    return orchestrator.subscribe(setOrchestratorStatus)
  }, [])

  const counterRef = useRef(new StepPeakCounter())
  const runningRef = useRef(false)
  const startedAtRef = useRef<number | null>(null)
  // Raw-magnitude capture for building a gait-aware (cadence-gated) counter offline —
  // a naive peak count treats hand motion as steps, so we need labelled walk vs
  // hand-motion sample series to separate them. Mirrors the col14 calibration tester.
  const samplesBufRef = useRef<number[]>([])
  const rateRef = useRef<number | null>(null)
  const [label, setLabel] = useState('walk')
  const [expected, setExpected] = useState('')
  const [accelJson, setAccelJson] = useState<string | null>(null)
  const [gatedCount, setGatedCount] = useState<number | null>(null)
  const { copied, copy } = useCopy()
  // The ring exposes ONE SetRealtime session, and the step orchestrator's stopAccel is a
  // global reqRealtimeOff — with it running, this test's 0x33 stream gets torn down almost
  // immediately (0 frames), so we suspend it for the test. Live-HR is NOT a realtime
  // session (it's feature-modes + the DHR burst) and was proven on-device 2026-07-13 to
  // coexist with the accel stream — we still pause it here only to keep the test's frame
  // tally clean. Both are restored on stop/unmount.
  const resumeLiveHrRef = useRef(false)

  const acquireRadio = useCallback(async () => {
    getStepOrchestrator().stop()
    resumeLiveHrRef.current = getLiveHrManager().isRunning()
    if (resumeLiveHrRef.current) { try { await getLiveHrManager().stop() } catch { /* best effort */ } }
    // Free the accelerometer: the automatic measurements preempt the 0x33 stream, so this is
    // the full self-contained capture — no manual "Measure OFF" needed. Restored in releaseRadio.
    const ble = await getOuraBle()
    if (ble) await disableAutoMeasurements(ble.plugin)
  }, [])

  const releaseRadio = useCallback(async () => {
    // Restore FIRST (load-bearing — leaving measurements off silently stops HR/SpO₂/steps
    // recording), then hand the radio back to the orchestrator / live-HR.
    const ble = await getOuraBle()
    if (ble) await restoreAutoMeasurements(ble.plugin)
    void getStepOrchestrator().start()
    if (resumeLiveHrRef.current) {
      resumeLiveHrRef.current = false
      try { await getLiveHrManager().start() } catch { /* best effort */ }
    }
  }, [])

  const flushPending = useCallback(async () => {
    const pending = readPending()
    if (pending.length === 0) { setPendingCount(0); return }
    const remaining: PendingWindow[] = []
    for (const w of pending) {
      if (!(await postLiveSteps(w))) remaining.push(w)
    }
    writePending(remaining)
    setPendingCount(remaining.length)
  }, [])

  useEffect(() => { void flushPending() }, [flushPending])

  const onFrames = useCallback((events: OuraFrameEvent[]) => {
    if (!runningRef.current) return
    let sawAccel = false
    for (const f of events) {
      if (f.tag !== ACCEL_FRAME_TAG || !f.hex) continue
      const decoded = decodeAccelFrame(hexToBytes(f.hex))
      if (!decoded) continue
      sawAccel = true
      counterRef.current.addFrame(decoded)
      setSampleRate(decoded.sampleRate)
      rateRef.current = decoded.sampleRate
      const buf = samplesBufRef.current
      for (const s of decoded.samples) buf.push(Math.round(s.magnitude))
      if (buf.length > MAX_ACCEL_SAMPLES) buf.splice(0, buf.length - MAX_ACCEL_SAMPLES)
    }
    if (sawAccel) {
      const c = counterRef.current
      setFrames((n) => n + events.filter((f) => f.tag === ACCEL_FRAME_TAG).length)
      setCount(c.count)
      setSamples(c.samplesSeen)
      setMagnitude({ last: Math.round(c.lastMagnitude), baseline: Math.round(c.baseline) })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const handles: Array<{ remove: () => Promise<void> }> = []
    let rearm: ReturnType<typeof setInterval> | null = null
    ;(async () => {
      const ble = await getOuraBle()
      if (!ble || cancelled) return
      handles.push(await ble.plugin.addListener('ouraFrame', (f) => onFrames([f])))
      handles.push(await ble.plugin.addListener('ouraFrames', ({ frames: fs }) => onFrames(fs)))
      rearm = setInterval(() => {
        if (runningRef.current) void ble.plugin.startAccel().catch(() => {})
      }, REARM_MS)
    })()
    return () => {
      cancelled = true
      if (rearm) clearInterval(rearm)
      for (const h of handles) void h.remove().catch(() => {})
    }
  }, [onFrames])

  const start = useCallback(async () => {
    const ble = await getOuraBle()
    if (!ble) { setNote('Native plugin unavailable (web).'); return }
    await acquireRadio() // exclusive realtime radio — stop the orchestrator/live-HR from tearing 0x33 down
    counterRef.current.reset()
    samplesBufRef.current = []; rateRef.current = null
    setFrames(0); setCount(0); setSamples(0); setSampleRate(null); setMagnitude(null)
    setLastResult(null); setSaveState('idle'); setAccelJson(null); setGatedCount(null)
    startedAtRef.current = Date.now()
    runningRef.current = true
    setRunning(true)
    setNote('Streaming… walk and count your real steps. No frames after ~10 s worn+moving means the ring is not delivering 0x33 — report that.')
    try { await ble.plugin.startAccel() } catch (e) {
      setNote(`startAccel failed: ${e instanceof Error ? e.message : String(e)}`)
      runningRef.current = false
      setRunning(false)
      void releaseRadio()
    }
  }, [acquireRadio, releaseRadio])

  const stop = useCallback(async () => {
    runningRef.current = false
    setRunning(false)
    const ble = await getOuraBle()
    try { await ble?.plugin.stopAccel() } catch { /* stream also self-expires */ }
    await releaseRadio() // hand the radio back to the orchestrator / live-HR
    setNote('Stopped. Compare the live count against your real count and report both.')
    if (startedAtRef.current != null && counterRef.current.count > 0) {
      setLastResult({
        startedAt: new Date(startedAtRef.current).toISOString(),
        endedAt: new Date().toISOString(),
        steps: counterRef.current.count,
      })
    }
    startedAtRef.current = null
    const mags = samplesBufRef.current
    if (mags.length > 0) {
      // Gait-gated count: rejects hand motion (cooking/gesturing), keeps real walking.
      setGatedCount(countGaitGatedSteps(mags, rateRef.current ?? 50))
      setAccelJson(JSON.stringify({
        label: label.trim() || 'unlabeled',
        realSteps: expected.trim() ? Number(expected) : null,
        counted: counterRef.current.count,
        sampleRate: rateRef.current,
        n: mags.length,
        magnitudes: mags,
      }))
    }
  }, [releaseRadio, label, expected])

  // Safety: if the tester unmounts (navigation away) while a test is running, hand the
  // radio back so the orchestrator/live-HR resume — otherwise they'd stay suspended.
  useEffect(() => () => { if (runningRef.current) void releaseRadio() }, [releaseRadio])

  const saveResult = useCallback(async () => {
    if (!lastResult) return
    setSaveState('saving')
    const ok = await postLiveSteps(lastResult)
    if (ok) {
      setSaveState('saved')
      void flushPending() // retry any earlier windows that failed to POST
    } else {
      writePending([...readPending(), lastResult])
      setPendingCount(readPending().length)
      setSaveState('failed')
    }
  }, [lastResult, flushPending])

  const accelTextareaRef = useRef<HTMLTextAreaElement>(null)
  const copyAccel = useCallback(() => copy(accelJson ?? '', accelTextareaRef.current), [copy, accelJson])

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Self-contained capture: Start auto-disables the ring&apos;s automatic measurements
        (DAYTIME_HR/SPO2/REAL_STEPS) so the 0x33 accel stream flows, then Stop restores them — no
        manual Measure OFF needed. Walk a counted number of steps, stop, compare naive vs gait-gated.
        <span className="font-medium"> After a run, tap Feature status and confirm all three are back
        ON</span> — that verifies the restore before this goes automatic.
      </p>
      {orchestratorStatus && (
        <div className="rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
          Auto-orchestrator:{' '}
          <span className="font-semibold text-foreground">
            {orchestratorStatus.state === 'counting'
              ? `counting (${orchestratorStatus.countingSteps})`
              : orchestratorStatus.state}
          </span>
          {orchestratorStatus.lastPosted && (
            <> · last posted {orchestratorStatus.lastPosted.steps} steps</>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 rounded-md border border-input px-2 py-1.5">
        <Button
          size="sm"
          variant={autoCapture ? 'default' : 'outline'}
          onClick={() => { const next = !autoCapture; setAutoCaptureEnabled(next); setAutoCapture(next) }}
        >
          Auto capture: {autoCapture ? 'ON' : 'OFF'}
        </Button>
        <span className="text-xs text-muted-foreground">
          When ON, detected walks auto-capture accel (measurements briefly off, then restored) and
          post gait-counted steps. Verify the restore first. Off by default.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="label (e.g. walk-30)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={running}
          className="h-8 w-36 rounded-md border border-input bg-transparent px-2 text-sm"
        />
        <input
          type="text"
          inputMode="numeric"
          placeholder="real steps"
          value={expected}
          onChange={(e) => setExpected(e.target.value.replace(/[^0-9]/g, ''))}
          disabled={running}
          className="h-8 w-24 rounded-md border border-input bg-transparent px-2 text-sm"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        For the gait detector: capture <span className="font-medium">walk-30</span> (walk 30 real
        steps) and <span className="font-medium">handwave-0</span> (wave your hand, real = 0), then
        Copy accel JSON and send both.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {running
          ? <Button size="sm" variant="destructive" onClick={stop}>Stop</Button>
          : <Button size="sm" onClick={start}>Start live test</Button>}
        <span className="text-lg font-semibold tabular-nums">{count}</span>
        <span className="text-xs text-muted-foreground">steps counted</span>
      </div>
      <div className="text-xs text-muted-foreground">
        frames {frames} · samples {samples} · rate byte {sampleRate ?? '—'}
        {magnitude && <> · mag {magnitude.last} / base {magnitude.baseline}</>}
      </div>
      {gatedCount != null && (
        <div className="text-xs">
          <span className="font-semibold text-foreground">gait-gated: {gatedCount}</span>
          <span className="text-muted-foreground"> · vs naive {count} — the gated count rejects hand motion, keeps walking</span>
        </div>
      )}
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
      {!running && lastResult && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={saveResult}
            disabled={saveState === 'saving' || saveState === 'saved'}
          >
            {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Save result'}
          </Button>
          {saveState === 'failed' && (
            <span className="text-xs text-amber-500">Save failed — queued, will retry on next open.</span>
          )}
        </div>
      )}
      {pendingCount > 0 && (
        <div className="text-xs text-amber-500">{pendingCount} unsaved window(s) queued for retry.</div>
      )}
      {!running && accelJson && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            Captured {samplesBufRef.current.length} raw accel samples — copy and send for the gait detector.
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={copyAccel}>{copied ? 'Copied ✓' : 'Copy accel JSON'}</Button>
          </div>
          <textarea
            ref={accelTextareaRef}
            readOnly
            spellCheck={false}
            value={accelJson}
            onFocus={(e) => { e.currentTarget.select() }}
            className="h-32 w-full rounded-md border border-input bg-transparent p-2 font-mono text-[10px]"
          />
        </div>
      )}
    </div>
  )
}
