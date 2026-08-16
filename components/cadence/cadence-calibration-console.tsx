'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Square, Footprints, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCopy } from '@/lib/use-copy'
import {
  CadenceTracker,
  dateRingWindows,
  ringWindowsWithin,
  type CadenceTrackerSnapshot,
} from '@/lib/activity/cadence-tracker'
import { getOuraBle } from '@/lib/oura-ble/plugin'
import {
  RING_STRIDE_INTERPRETATIONS,
  RING_STRIDE_HZ_TO_SPM,
  cadenceFromStrideHz,
  compareCadence,
  type CadenceSummary,
} from '@trainingai/shared/health/cadence'

/**
 * Treadmill calibration console.
 *
 * This exists to answer three questions that cannot be answered in a sandbox, and that
 * block trusting cadence at all:
 *
 *  1. Are the ring's `stride_frequency` units steps/s or strides/s? The two differ by
 *     exactly 2x, so a treadmill's displayed cadence separates them in one walk. Both
 *     candidate conversions are rendered side by side rather than assumed.
 *  2. Does the strap's own DSP agree with the ring? Two independent derivations agreeing
 *     is the only real evidence either is right — neither can validate itself.
 *  3. Is the PMD stream even delivering, and in which frame encoding? Frames-seen and the
 *     observed frame type are surfaced because a silent zero here looks identical to
 *     "standing still".
 */

interface Capture {
  startedAt: string
  endedAt: string
  groundTruthSpm: number | null
  ringStrideHz: number | null
  ringWindowCount: number
  ringLocomotorWindowCount: number
  ringGaitState: string | null
  strapStrength: number | null
  ringSpmAt60: number | null
  ringSpmAt120: number | null
  strapSpm: number | null
  strapSampleRate: number | null
  strapFrameType: number | null
  summary: CadenceSummary | null
}

/**
 * How long to wait after requesting a drain before reading the ring's windows. A drain burst
 * lands within a few seconds (observed 3–7 s across owner captures); this is deliberately
 * generous because the alternative is exporting a capture the ring never delivered.
 */
const RING_DRAIN_WAIT_MS = 8_000

/** Nominal spacing between ring gait windows, used to judge whether coverage reaches the end. */
const RING_WINDOW_SPACING_SEC = 30

const PENDING_KEY = 'ta-cadence-captures'

function readPending(): Capture[] {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') } catch { return [] }
}
function writePending(items: Capture[]) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(items)) } catch { /* storage unavailable */ }
}

export function CadenceCalibrationConsole() {
  const [running, setRunning] = useState(false)
  const [snap, setSnap] = useState<CadenceTrackerSnapshot | null>(null)
  const [groundTruth, setGroundTruth] = useState('')
  const [captureJson, setCaptureJson] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const { copied, copy } = useCopy()

  const [ringSyncing, setRingSyncing] = useState(false)
  const [ringNote, setRingNote] = useState<string | null>(null)

  const trackerRef = useRef<CadenceTracker | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setPendingCount(readPending().length) }, [])

  // Repaint on a timer as well as on tracker events: staleness is time-based, so a source
  // that stops reporting has to visibly go blank rather than sit there looking live.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      const t = trackerRef.current
      if (t) setSnap(t.snapshot())
    }, 1000)
    return () => clearInterval(id)
  }, [running])

  useEffect(() => () => { void trackerRef.current?.stop() }, [])

  const start = useCallback(async () => {
    const tracker = new CadenceTracker()
    trackerRef.current = tracker
    startedAtRef.current = Date.now()
    setCaptureJson(null)
    setRunning(true)
    tracker.subscribe(setSnap)
    await tracker.start(startedAtRef.current, { retainRaw: true })
  }, [])

  const stop = useCallback(async () => {
    const tracker = trackerRef.current
    setRunning(false)
    if (!tracker) return
    const endedAtMs = Date.now()

    // Drain the ring BEFORE reading its windows, and wait for the burst to land.
    //
    // Gait windows only reach JS on a drain, which is otherwise hourly. Without this, whether a
    // capture sees any ring data at all depends on where the hourly drain happened to fall: the
    // owner's 150 bpm capture was drained 16 s in, so the walk itself was never delivered.
    let drained = false
    try {
      const oura = await getOuraBle()
      if (oura) {
        const status = await oura.plugin.getStatus()
        if (status.state === 'ready') {
          const res = await oura.plugin.drainHistory()
          drained = res.sent
          if (drained) await new Promise(r => setTimeout(r, RING_DRAIN_WAIT_MS))
        }
      }
    } catch {
      // A failed drain must not lose the strap capture — it is the source that actually works.
    }

    const finalSnap = tracker.snapshot()
    const summary = tracker.summary()
    await tracker.stop()
    trackerRef.current = null

    const strideHz = finalSnap.ringStrideHz
    const capture: Capture = {
      startedAt: new Date(startedAtRef.current ?? endedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      groundTruthSpm: groundTruth.trim() ? Number(groundTruth) : null,
      ringStrideHz: strideHz,
      ringWindowCount: finalSnap.ringWindowCount,
      ringLocomotorWindowCount: finalSnap.ringLocomotorWindowCount,
      ringGaitState: finalSnap.ringGaitState,
      strapStrength: finalSnap.strapStrength,
      ringSpmAt60: strideHz != null ? cadenceFromStrideHz(strideHz, 60) : null,
      ringSpmAt120: strideHz != null ? cadenceFromStrideHz(strideHz, 120) : null,
      strapSpm: finalSnap.strap?.spm ?? null,
      strapSampleRate: finalSnap.strapSampleRate,
      strapFrameType: finalSnap.strapFrameType,
      summary,
    }
    // The raw signal is the only thing that makes a wrong reading diagnosable offline —
    // summary stats alone cannot tell a mis-locked peak from a genuinely odd gait.
    const raw = tracker.raw()
    const ringWindows = tracker.ringWindowSamples()

    // Restrict to windows from THIS capture before taking a median.
    //
    // A drain replays the ring's whole backlog: one 3.4-minute capture arrived with 19 MINUTES
    // of history attached, most of it from earlier, faster walking. Taking a median over all of
    // it reported 140.8 spm for a counted 64 spm walk — describing the wrong walk entirely.
    //
    // Scoped by reconstructed OCCURRENCE time, not by a ds offset from the newest window: the
    // latter assumes the newest window sits at the capture's end, which is false whenever the
    // drain lands early (see `dateRingWindows`).
    const startMs = startedAtRef.current ?? endedAtMs
    const dated = dateRingWindows(ringWindows)
    const inCapture = ringWindowsWithin(ringWindows, startMs, endedAtMs)

    // How much of the capture the ring actually covered. Without this, "5 windows in capture"
    // reads as full coverage even when the drain delivered only the first 20 seconds.
    const newestOccurredMs = dated.reduce((m, w) => Math.max(m, w.occurredAtMs), 0)
    const coveredToSec = dated.length
      ? Math.round(Math.min(endedAtMs, newestOccurredMs) - startMs) / 1000
      : null
    const captureSec = Math.round(endedAtMs - startMs) / 1000

    // Motion, not the walk/run band, decides inclusion: those bands start at ~84 spm, so a
    // genuine slow walk classifies 'idle' and would be discarded exactly when it matters.
    const usable = inCapture.filter(w => w.strideHz > 0).map(w => w.strideHz).sort((a, b) => a - b)
    const medianLocomotorHz = usable.length ? usable[usable.length >> 1] : null
    setCaptureJson(JSON.stringify({
      ...capture,
      ringLocomotorMedianHz: medianLocomotorHz,
      ringLocomotorSpmAt60: medianLocomotorHz != null ? medianLocomotorHz * 60 : null,
      ringLocomotorSpmAt120: medianLocomotorHz != null ? medianLocomotorHz * 120 : null,
      ringWindowsInCapture: inCapture.length,
      // Coverage, so a capture the ring only partly saw is never read as a full one.
      ringDrainRequested: drained,
      ringCaptureSec: captureSec,
      ringCoveredToSec: coveredToSec,
      ringCoversCapture: coveredToSec != null && coveredToSec >= captureSec - RING_WINDOW_SPACING_SEC,
      ringWindows: dated,
      raw,
    }, null, 2))
    const next = [...readPending(), capture]
    writePending(next)
    setPendingCount(next.length)
  }, [groundTruth])

  /**
   * Force a ring history drain.
   *
   * The native service drains on connect then only HOURLY, and gait windows reach JS with
   * that drain — so a short capture would otherwise show nothing from the ring no matter how
   * long you walk. This makes the ring testable on demand instead of on the hour.
   */
  const syncRing = useCallback(async () => {
    setRingSyncing(true)
    setRingNote(null)
    try {
      const oura = await getOuraBle()
      if (!oura) { setRingNote('Ring plugin unavailable (web, or an older APK).'); return }
      const status = await oura.plugin.getStatus()
      if (status.state !== 'ready') {
        setRingNote(`Ring not connected (state: ${status.state}). Gait windows only arrive over a live link.`)
        return
      }
      const res = await oura.plugin.drainHistory()
      setRingNote(res.sent
        ? 'Drain requested — gait windows should arrive within a few seconds.'
        : 'Ring busy (a drain is already running); try again shortly.')
    } catch (e) {
      setRingNote(e instanceof Error ? e.message : String(e))
    } finally {
      setRingSyncing(false)
    }
  }, [])

  const clearPending = useCallback(() => { writePending([]); setPendingCount(0) }, [])
  const copyCapture = useCallback(
    () => copy(captureJson ?? '', textareaRef.current),
    [copy, captureJson],
  )

  const truth = groundTruth.trim() ? Number(groundTruth) : null
  const strideHz = snap?.ringStrideHz ?? null

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-md border border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            placeholder="treadmill spm"
            value={groundTruth}
            onChange={e => setGroundTruth(e.target.value.replace(/[^0-9]/g, ''))}
            className="h-10 w-36 rounded-md border border-input bg-transparent px-2 text-sm"
          />
          {running ? (
            <Button size="sm" variant="destructive" onClick={stop}>
              <Square className="mr-1 h-4 w-4" /> Stop
            </Button>
          ) : (
            <Button size="sm" onClick={start}>
              <Play className="mr-1 h-4 w-4" /> Start capture
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Walk or run at a steady pace for at least a minute. If the treadmill shows cadence,
          enter it; otherwise count your steps for 30 s and double it.
        </p>
      </section>

      <section className="space-y-3 rounded-md border border-border p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Footprints className="h-4 w-4" /> Live comparison
        </h2>

        <div className="grid grid-cols-2 gap-2 text-center">
          <Stat
            label="Strap (own DSP)"
            value={snap?.strap ? Math.round(snap.strap.spm).toString() : '—'}
            unit="spm"
            delta={snap?.strap && truth ? Math.round(snap.strap.spm - truth) : null}
            sub={snap?.strapStrength != null ? `rhythm ${snap.strapStrength.toFixed(2)}` : null}
          />
          <Stat
            label={`Ring (x${RING_STRIDE_HZ_TO_SPM})`}
            value={snap?.ring ? Math.round(snap.ring.spm).toString() : '—'}
            unit="spm"
            delta={snap?.ring && truth ? Math.round(snap.ring.spm - truth) : null}
          />
        </div>

        {/* The units question, made decidable: whichever row lands on the treadmill's
            number is the correct reading of stride_frequency. */}
        <div className="space-y-1 rounded-md bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">
              Ring stride frequency: {strideHz != null ? `${strideHz.toFixed(3)} Hz` : '—'}
            </p>
            <Button size="sm" variant="ghost" onClick={syncRing} disabled={ringSyncing}>
              <RefreshCw className={`mr-1 h-3 w-3 ${ringSyncing ? 'animate-spin' : ''}`} />
              Sync ring
            </Button>
          </div>
          {/* Windows-seen separates "the ring sent nothing" from "the ring sent windows but
              none were locomotor" — indistinguishable from the stride row alone. */}
          <p className="text-[10px] text-muted-foreground">
            gait windows: {snap?.ringWindowCount ?? 0} delivered ·{' '}
            {snap?.ringLocomotorWindowCount ?? 0} locomotor
            {snap?.ringGaitState ? ` · last: ${snap.ringGaitState}` : ''}
          </p>
          {(snap?.ringWindowCount ?? 0) === 0 && (
            <p className="text-[10px] text-muted-foreground">
              The ring drains hourly — walk first, then tap Sync ring so the drain covers the
              walk you just did.
            </p>
          )}
          {(snap?.ringWindowCount ?? 0) > 0 && (snap?.ringLocomotorWindowCount ?? 0) === 0 && (
            <p className="text-[10px] text-amber-500">
              Windows arrived but none were classified as walking — these are from a
              non-walking span, so the stride rows below do not describe your walk.
            </p>
          )}
          {ringNote && <p className="text-[10px] text-amber-500">{ringNote}</p>}
          {RING_STRIDE_INTERPRETATIONS.map(({ label, factor }) => {
            const spm = strideHz != null ? cadenceFromStrideHz(strideHz, factor) : null
            const diff = spm != null && truth != null ? spm - truth : null
            const isMatch = diff != null && Math.abs(diff) <= 8
            return (
              <div key={label} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span className="flex items-center gap-1 tabular-nums">
                  {spm != null ? `${Math.round(spm)} spm` : '—'}
                  {diff != null && (
                    <span className={isMatch ? 'text-emerald-500' : 'text-muted-foreground'}>
                      ({diff > 0 ? '+' : ''}{Math.round(diff)})
                      {isMatch && ' match'}
                    </span>
                  )}
                </span>
              </div>
            )
          })}
        </div>

        {snap?.agreement && (
          <div className="flex items-start gap-2 rounded-md bg-muted/40 p-3 text-xs">
            {snap.agreement.agree
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
            <span>
              {snap.agreement.agree
                ? `Ring and strap agree (${snap.agreement.deltaSpm > 0 ? '+' : ''}${snap.agreement.deltaSpm} spm apart).`
                : snap.agreement.octaveMismatch
                  ? `Roughly 2x apart (${snap.agreement.deltaSpm} spm) — a units or octave error, not noise. Check which stride interpretation matches the treadmill above.`
                  : `Ring and strap disagree by ${snap.agreement.deltaSpm} spm.`}
            </span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 text-center text-[10px] text-muted-foreground">
          <div>
            <div className="text-sm font-semibold tabular-nums text-foreground">
              {snap?.strapSampleRate ?? '—'}
            </div>
            strap Hz
          </div>
          <div>
            <div className="text-sm font-semibold tabular-nums text-foreground">
              {snap?.strapFrameType != null && snap.strapFrameType >= 0
                ? `0x${snap.strapFrameType.toString(16)}`
                : '—'}
            </div>
            frame type
          </div>
          <div>
            <div className="text-sm font-semibold tabular-nums text-foreground">
              {snap?.liveSource ?? '—'}
            </div>
            leading
          </div>
        </div>

        {running && !snap?.strap && !snap?.ring && (
          <p className="text-xs text-amber-500">
            No readings yet. Both sources need a real BLE connection — on web, and on an APK
            older than this build, neither will ever report.
          </p>
        )}
      </section>

      {captureJson && (
        <section className="space-y-2 rounded-md border border-border p-4">
          <h2 className="text-sm font-medium">Capture</h2>
          <Button size="sm" onClick={copyCapture}>
            {copied ? 'Copied' : 'Copy capture JSON'}
          </Button>
          <textarea
            ref={textareaRef}
            readOnly
            spellCheck={false}
            value={captureJson}
            onFocus={e => e.currentTarget.select()}
            className="h-40 w-full rounded-md border border-input bg-transparent p-2 font-mono text-[10px]"
          />
        </section>
      )}

      {pendingCount > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{pendingCount} capture(s) saved on this device.</span>
          <Button size="sm" variant="ghost" onClick={clearPending}>Clear</Button>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, unit, delta, sub }: {
  label: string; value: string; unit: string; delta: number | null; sub?: string | null
}) {
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <div className="text-2xl font-semibold tabular-nums text-foreground">
        {value}
        <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>
      </div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      {delta !== null && (
        <div className="text-[10px] tabular-nums text-muted-foreground">
          {delta > 0 ? '+' : ''}{delta} vs treadmill
        </div>
      )}
      {sub && <div className="text-[10px] tabular-nums text-muted-foreground">{sub}</div>}
    </div>
  )
}
