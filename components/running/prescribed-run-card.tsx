'use client'

import { memo, useEffect, useState } from 'react'
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { Button } from '@/components/ui/button'
import { Footprints, TrendingUp, Info, Check } from 'lucide-react'
import type { RunType } from '@trainingai/shared/running/types'
import { readCacheSync, setCached } from '@/lib/sqlite/cache'
import { RUNNING_PLAN_EXPLAIN_TTL } from '@trainingai/shared/cache-ttl'
import { todayInTz } from '@trainingai/shared/date-utils'
import { runningPlanExplainCacheKey } from './prescribed-run-explain-key'

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
  const tz = useUserTimezone();
  const { type, durationMin, distanceKm, targets, rationale } = prescription

  // Warmer one-sentence AI restatement of the deterministic rationale (running-plan/explain).
  // Never load-bearing: `rationale` renders immediately and the AI copy only swaps in once it lands;
  // any failure/degraded response keeps the deterministic text. gateReasons is joined to a stable
  // string for the effect dep so a new array ref each render doesn't re-fire the fetch.
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const gateKey = gateReasons.join('|')

  // Cached on everything that can change the sentence — the local date plus the prescription
  // fingerprint — so a remount reuses the answer instead of re-asking (Q-469). The effect dep list
  // already guarded against a new array ref re-firing it; **mount was the remaining trigger**, and
  // every navigation back to this screen is a mount. Measured at 31 redundant calls across 9
  // distinct runs.
  //
  // The point is not the cost — the call is cheap and explicitly never load-bearing. It is that the
  // model rewords the same run each time, so the same prescribed session was described differently
  // on every visit. A cache makes the copy stable, which is what a user actually notices.
  //
  // Seeded in an effect rather than a `useState` initializer: a cache read in an initializer caused
  // hydration mismatches (CLAUDE.md, Instant paint).
  const cacheKey = runningPlanExplainCacheKey({ date: todayInTz(tz), type, durationMin, gateKey, rationale })

  useEffect(() => {
    const cached = readCacheSync<string>(cacheKey)
    if (cached) { setAiMessage(cached); return }

    let cancelled = false
    fetch('/api/running-plan/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, durationMin, rationale, gateReasons: gateKey ? gateKey.split('|') : [] }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d?.message || d.degraded) return
        const message = String(d.message)
        setAiMessage(message)
        // Only a real answer is cached. A degraded response is the deterministic text coming back
        // dressed as an AI one, and caching that would pin the fallback for the whole TTL.
        void setCached(cacheKey, message, RUNNING_PLAN_EXPLAIN_TTL)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [cacheKey, type, durationMin, rationale, gateKey])

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
