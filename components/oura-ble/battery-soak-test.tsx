'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useCopy } from '@/lib/use-copy'
import { getBatterySoak, type SoakStatus } from '@/lib/oura-ble/battery-soak'

/**
 * One-tap daytime battery soak for the continuous-streaming step architecture.
 * Start with the ring charged, wear it through a normal day, Stop before charging,
 * then Copy JSON and send the drain curve. The singleton owns the run — navigating
 * away doesn't end it; only Stop (or an app kill) does.
 */
export function BatterySoakTest() {
  const [status, setStatus] = useState<SoakStatus | null>(null)
  const [note, setNote] = useState('')
  const { copied, copy } = useCopy()
  const [, forceTick] = useState(0)

  useEffect(() => {
    const soak = getBatterySoak()
    setStatus(soak.getStatus())
    return soak.subscribe(setStatus)
  }, [])

  // Coarse elapsed-time refresh while running — leaf card only, nothing heavy re-renders.
  useEffect(() => {
    if (!status?.running) return
    const t = setInterval(() => forceTick((n) => n + 1), 10_000)
    return () => clearInterval(t)
  }, [status?.running])

  const start = useCallback(async () => {
    setNote('')
    const res = await getBatterySoak().start()
    if (!res.ok) setNote(res.error ?? 'Failed to start.')
  }, [])

  const stop = useCallback(async () => {
    await getBatterySoak().stop()
    setNote('Stopped — measurements restored (steps recording back ON). Copy the JSON and send it.')
  }, [])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const json = !status?.running ? getBatterySoak().exportJson() : null
  const copyJson = useCallback(() => copy(json ?? '', textareaRef.current), [copy, json])

  const log = status?.log ?? null
  const elapsedMin = status?.running && log
    ? Math.round((Date.now() - new Date(log.startedAt).getTime()) / 60_000)
    : null

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Measures the production design&apos;s real battery cost: REAL_STEPS off, HR/SpO₂ still
        recording, accel streaming continuously with watchdog re-arm. Start with the ring
        charged, use the phone normally, Stop before the next charge.{' '}
        <span className="font-medium">Stop restores steps recording automatically</span> (and the
        ring self-heals on reconnect if the app dies mid-run). Stalls in the log show where
        screen-off throttled the stream — that&apos;s data too.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {status?.running
          ? <Button size="sm" variant="destructive" onClick={stop}>Stop soak</Button>
          : <Button size="sm" onClick={start}>Start soak</Button>}
        {status?.running && elapsedMin != null && (
          <span className="text-xs text-muted-foreground">running {elapsedMin} min</span>
        )}
      </div>
      {status && (status.running || log) && (
        <div className="text-xs text-muted-foreground">
          battery {status.lastBattery != null ? `${status.lastBattery}%` : '—'} ·
          frames {status.frames} · samples {log?.samples.length ?? 0} ·
          stalls {status.stalls} · reconnect re-arms {status.rearms}
        </div>
      )}
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
      {!status?.running && json && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={copyJson}>{copied ? 'Copied ✓' : 'Copy soak JSON'}</Button>
            <span className="text-xs text-muted-foreground">drain curve + stream reliability</span>
          </div>
          <textarea
            ref={textareaRef}
            readOnly
            spellCheck={false}
            value={json}
            onFocus={(e) => { e.currentTarget.select() }}
            className="h-24 w-full rounded-md border border-input bg-transparent p-2 font-mono text-[10px]"
          />
        </div>
      )}
    </div>
  )
}
