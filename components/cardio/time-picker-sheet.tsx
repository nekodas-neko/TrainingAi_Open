'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTransitionRouter } from "@/lib/view-transition";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { hapticLight } from '@/lib/haptics'
import { Info } from 'lucide-react'
import { recommendSession, type RunningPlanForRecommend, type SessionModality } from '@trainingai/shared/health/session-picker'
import type { ZoneQuota } from '@trainingai/shared/health/zone-quota'

const MINUTES_OPTIONS = [15, 30, 45, 60]

const MODALITY_LABEL: Record<SessionModality, string> = {
  run: 'Run', walk: 'Guided walk', activity: 'Other activity',
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  quota: ZoneQuota
  runningPlan: RunningPlanForRecommend
  onLogActivity: () => void
}

export function TimePickerSheet({ open, onOpenChange, quota, runningPlan, onLogActivity }: Props) {
  const router = useTransitionRouter()
  const [minutes, setMinutes] = useState(30)

  const rec = useMemo(
    () => recommendSession({ minutesAvailable: minutes, runningPlan, quota }),
    [minutes, runningPlan, quota],
  )

  // Both routes are reachable from here regardless of the recommendation — the explicit
  // Run/Walk buttons sit alongside the recommended Start — so warm both, but only while
  // the sheet is open. Button pushes get no automatic prefetch (#919).
  useEffect(() => {
    if (!open) return
    router.prefetch('/running')
    router.prefetch('/activity/guided-walk')
  }, [open, router])

  function start(modality: SessionModality) {
    hapticLight()
    onOpenChange(false)
    if (modality === 'run') router.push('/running')
    else if (modality === 'walk') router.push('/activity/guided-walk')
    else onLogActivity()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>How much time do you have?</SheetTitle>
        </SheetHeader>

        <div className="space-y-3 px-4 py-2">
          <div className="flex flex-wrap gap-2">
            {MINUTES_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { hapticLight(); setMinutes(m) }}
                className="rounded-lg border px-3 py-1.5 text-sm transition-colors"
                style={
                  minutes === m
                    ? { borderColor: 'var(--accent-cyan)', background: 'color-mix(in oklch, var(--accent-cyan) 12%, transparent)', fontWeight: 600 }
                    : { borderColor: 'var(--border)', background: 'var(--card)' }
                }
              >
                {m} min
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
            <p className="text-sm font-semibold">{MODALITY_LABEL[rec.modality]}</p>
            <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">{rec.reason}</p>
            {rec.gate && (
              <div
                className="mt-2.5 flex gap-2 rounded-lg border p-2.5"
                style={{
                  borderColor: 'color-mix(in oklch, var(--accent-amber) 30%, transparent)',
                  background: 'color-mix(in oklch, var(--accent-amber) 10%, transparent)',
                }}
              >
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent-amber)' }} aria-hidden />
                <p className="text-xs">{rec.gate.reasons.join(' ')}</p>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => start('run')}>Run</Button>
            <Button variant="outline" className="flex-1" onClick={() => start('walk')}>Walk</Button>
            <Button variant="outline" className="flex-1" onClick={() => start('activity')}>Activity</Button>
          </div>
        </div>

        <SheetFooter>
          <Button className="w-full" onClick={() => start(rec.modality)}>
            Start {MODALITY_LABEL[rec.modality]}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
