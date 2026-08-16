'use client'
import { useEffect, useRef, useState } from 'react'
import { HeartPulseIcon } from 'lucide-react'
import { getLiveHrManager } from '@/lib/live-hr/manager'
import { useLiveHr } from '@/lib/live-hr/use-live-hr'
import { hapticLight } from '@/lib/haptics'

const MEASURE_MS = 30_000 // hold the burst engaged for one reading window, then release the ring

// One-shot "see my HR right now". Starts the live-HR manager on demand (inert in the web
// sandbox / on an APK without the ring plugin), fires a burst, shows the last-seen bpm, and
// stops the manager after the window — only if THIS component started it.
export function MeasureHrNow() {
  const { bpm, live, stale } = useLiveHr()
  const [measuring, setMeasuring] = useState(false)
  const startedByUs = useRef(false)
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (stopTimer.current) clearTimeout(stopTimer.current)
    if (startedByUs.current) getLiveHrManager().stop().catch(() => {})
  }, [])

  async function handleMeasure() {
    void hapticLight()
    const mgr = getLiveHrManager()
    setMeasuring(true)
    if (mgr.activeSourceId() == null) { startedByUs.current = true; await mgr.start().catch(() => {}) }
    mgr.setForced(true)
    await mgr.measureNow().catch(() => {})
    if (stopTimer.current) clearTimeout(stopTimer.current)
    stopTimer.current = setTimeout(() => {
      setMeasuring(false)
      if (startedByUs.current) { getLiveHrManager().stop().catch(() => {}); startedByUs.current = false }
    }, MEASURE_MS)
  }

  return (
    <div className="rounded-2xl bg-muted/30 border border-border/50 p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Live HR</p>
        <p className="flex items-baseline gap-1">
          <span
            className={`text-2xl font-bold leading-none tabular-nums transition-opacity ${stale ? 'opacity-40' : ''}`}
            style={{ color: 'var(--color-brand)' }}
          >
            {bpm ?? '—'}
          </span>
          <span className="text-[10px] font-medium text-muted-foreground">bpm</span>
          {measuring && !live && bpm == null && (
            <span className="text-[10px] text-muted-foreground">· reading…</span>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={handleMeasure}
        disabled={measuring}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-xs font-semibold text-white transition-opacity disabled:opacity-60"
        style={{ backgroundColor: 'var(--color-brand)' }}
      >
        <HeartPulseIcon className={`h-4 w-4 ${measuring ? 'animate-pulse' : ''}`} />
        {measuring ? 'Measuring…' : 'Measure now'}
      </button>
    </div>
  )
}
