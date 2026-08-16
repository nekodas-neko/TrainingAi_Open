'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useCopy } from '@/lib/use-copy'
import {
  getContinuousCapture,
  isContinuousCaptureEnabled,
  DAY_START_HOUR,
  DAY_END_HOUR,
  type ContinuousCaptureStatus,
} from '@/lib/oura-ble/continuous-capture'

const STATE_LABEL: Record<ContinuousCaptureStatus['state'], string> = {
  'off': 'off',
  'no-plugin': 'plugin unavailable (web)',
  'night': `night — resumes ${String(DAY_START_HOUR).padStart(2, '0')}:00`,
  'streaming': 'streaming',
  'paused-live-hr': 'paused (live HR has the radio)',
}

/**
 * Production continuous step capture — the default-off toggle for day one of the
 * ring-only accurate step counter. While ON: REAL_STEPS off during the day window,
 * accel streams continuously, chunks post to the server for gait counting, battery is
 * logged every 5 min (day one doubles as the battery soak).
 */
export function ContinuousCaptureCard() {
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState<ContinuousCaptureStatus | null>(null)
  const [diagJson, setDiagJson] = useState<string | null>(null)
  const { copied, copy } = useCopy()

  useEffect(() => {
    setEnabled(isContinuousCaptureEnabled())
    const cap = getContinuousCapture()
    setStatus(cap.getStatus())
    return cap.subscribe(setStatus)
  }, [])

  const toggle = useCallback(async () => {
    const next = !enabled
    setEnabled(next)
    setDiagJson(null)
    await getContinuousCapture().setEnabled(next)
  }, [enabled])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const exportDiag = useCallback(() => {
    setDiagJson(getContinuousCapture().exportDiagnostics())
  }, [])
  const copyDiag = useCallback(() => copy(diagJson ?? '', textareaRef.current), [copy, diagJson])

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        The real ring-only step counter. While ON: steps recording is paused and the accel
        streams continuously {String(DAY_START_HOUR).padStart(2, '0')}:00–{String(DAY_END_HOUR).padStart(2, '0')}:00
        (HR/SpO₂ recording untouched, ring fully stock at night); raw chunks post every ~2 min and the
        server gait-counts them into step windows. Live HR (workouts) takes the radio — capture pauses
        and resumes automatically. Battery is logged every 5 min, so day one doubles as the battery
        soak. Requires the app to stay alive (killed app = steps gap until reopen; recording self-heals).
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={enabled ? 'default' : 'outline'} onClick={toggle}>
          Continuous capture: {enabled ? 'ON' : 'OFF'}
        </Button>
        {status && <span className="text-xs text-muted-foreground">{STATE_LABEL[status.state]}</span>}
      </div>
      {status && (enabled || status.postedChunks > 0) && (
        <div className="text-xs text-muted-foreground">
          steps posted {status.postedSteps} · chunks {status.postedChunks}
          {status.pendingChunks > 0 && <> · queued {status.pendingChunks}</>}
          {status.droppedChunks > 0 && <> · dropped {status.droppedChunks}</>}
          {' '}· frames {status.frames} · battery {status.lastBattery != null ? `${status.lastBattery}%` : '—'} ·
          stalls {status.stalls} · re-arms {status.rearms}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={exportDiag}>Diagnostics JSON</Button>
        {diagJson && <Button size="sm" onClick={copyDiag}>{copied ? 'Copied ✓' : 'Copy'}</Button>}
      </div>
      {diagJson && (
        <textarea
          ref={textareaRef}
          readOnly
          spellCheck={false}
          value={diagJson}
          onFocus={(e) => { e.currentTarget.select() }}
          className="h-24 w-full rounded-md border border-input bg-transparent p-2 font-mono text-[10px]"
        />
      )}
    </div>
  )
}
