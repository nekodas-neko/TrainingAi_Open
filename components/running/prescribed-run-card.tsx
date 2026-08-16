'use client'

import { memo, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Footprints, TrendingUp, Info, Check } from 'lucide-react'
import type { RunType } from '@trainingai/shared/running/types'

export interface RunPrescription {
  type: RunType
  durationMin: number | null
  distanceKm: number | null
  targets: { zoneIds: number[]; hrLowBpm: number; hrHighBpm: number }
  rationale: string
}

const TYPE_LABEL: Record<RunType, string> = {
  recovery: 'Recovery run',
  easy: 'Easy run',
  long: 'Long run',
  tempo: 'Tempo run',
  interval: 'Interval session',
}

interface Props {
  prescription: RunPrescription
  gateAction: 'proceed' | 'soften' | 'rest'
  gateReasons: string[]
  isPushSession?: boolean
  onStart: () => void
}

function PrescribedRunCardImpl({ prescription, gateAction, gateReasons, isPushSession, onStart }: Props) {
  const { type, durationMin, distanceKm, targets, rationale } = prescription

  // Warmer one-sentence AI restatement of the deterministic rationale (running-plan/explain).
  // Never load-bearing: `rationale` renders immediately and the AI copy only swaps in once it lands;
  // any failure/degraded response keeps the deterministic text. gateReasons is joined to a stable
  // string for the effect dep so a new array ref each render doesn't re-fire the fetch.
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const gateKey = gateReasons.join('|')
  useEffect(() => {
    let cancelled = false
    fetch('/api/running-plan/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, durationMin, rationale, gateReasons: gateKey ? gateKey.split('|') : [] }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d?.message && !d.degraded) setAiMessage(String(d.message)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [type, durationMin, rationale, gateKey])

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-4 shadow-sm">
      <div className="flex items-center gap-2">
        {/* A-1: --accent-9/6/3/11 are undefined Radix-scale tokens (no @radix-ui/themes
            installed) → they resolved to unset. Use the app's real accent tokens: the
            running-brand cyan for the icon, an amber tint for the gate-softened callout. */}
        <Footprints className="h-5 w-5" style={{ color: 'var(--accent-cyan)' }} aria-hidden />
        <h2 className="text-lg font-bold">{TYPE_LABEL[type]}</h2>
        {isPushSession && (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ color: 'var(--accent-amber)', background: 'color-mix(in oklch, var(--accent-amber) 15%, transparent)' }}
          >
            Push
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[color:var(--muted-foreground)]">
        {durationMin != null && <span>{durationMin} min</span>}
        {distanceKm != null && <span>{distanceKm.toFixed(2)} km target</span>}
        <span className="inline-flex items-center gap-1">
          <TrendingUp className="h-4 w-4" aria-hidden />
          Zone {targets.zoneIds.join('–')} · {targets.hrLowBpm}–{targets.hrHighBpm} bpm
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-[color:var(--foreground)]">{aiMessage ?? rationale}</p>

      {gateAction !== 'proceed' && gateReasons.length > 0 && (
        <div
          className="mt-3 flex gap-2 rounded-xl border p-3"
          style={{
            borderColor: 'color-mix(in oklch, var(--accent-amber) 30%, transparent)',
            background: 'color-mix(in oklch, var(--accent-amber) 10%, transparent)',
          }}
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--accent-amber)' }} aria-hidden />
          <div className="text-sm text-[color:var(--foreground)]">
            <p className="font-semibold">{gateAction === 'rest' ? 'Dialed back to recovery' : 'Eased off today'}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {gateReasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        </div>
      )}

      <Button className="mt-4 w-full" onClick={onStart}>
        <Check className="mr-1 h-4 w-4" aria-hidden /> Start run
      </Button>
    </div>
  )
}

export const PrescribedRunCard = memo(PrescribedRunCardImpl)
