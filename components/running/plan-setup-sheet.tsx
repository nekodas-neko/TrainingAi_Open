'use client'

import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { invalidateRunningPlan } from '@/lib/cache-groups'
import { hapticSuccess } from '@/lib/haptics'
import { toast } from 'sonner'
import { SELECTABLE_CARDIO_GOALS } from '@trainingai/shared/running/cardio-goals'
import type { GoalKind } from '@trainingai/shared/running/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

// Common target distances (km) offered when a goal needs one.
const DISTANCES: { km: number; label: string }[] = [
  { km: 3, label: '3K' },
  { km: 5, label: '5K' },
  { km: 10, label: '10K' },
  { km: 21.1, label: 'Half' },
  { km: 42.2, label: 'Marathon' },
]

export function PlanSetupSheet({ open, onOpenChange, onCreated }: Props) {
  const [goalKind, setGoalKind] = useState<GoalKind>('heart_health')
  const [targetDistanceKm, setTargetDistanceKm] = useState<number>(5)
  const [sessionMode, setSessionMode] = useState<'growing' | 'fixed'>('growing')
  const [timePerSessionMinutes, setTimePerSessionMinutes] = useState<number>(30)
  const [saving, setSaving] = useState(false)

  const selectedGoal = SELECTABLE_CARDIO_GOALS.find((g) => g.key === goalKind)
  const needsDistance = selectedGoal?.needsTargetDistance ?? false

  async function submit() {
    setSaving(true)
    try {
      const body: Record<string, unknown> = needsDistance ? { goalKind, targetDistanceKm } : { goalKind }
      // The default session time is always saved, regardless of framework — it's the seed
      // the Running screen's +/- 10 min adjuster starts from, not just the density-progression
      // "fixed time" framework's own duration driver.
      body.timePerSessionMinutes = timePerSessionMinutes
      if (sessionMode === 'fixed') {
        body.frameworkKey = 'density-progression'
      }
      const res = await fetch('/api/running-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('failed')
      hapticSuccess()
      await invalidateRunningPlan()
      onOpenChange(false)
      onCreated()
    } catch {
      // Keep the sheet open for retry, but surface the failure (A-2).
      toast.error('Couldn’t create your plan — try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Set up your running plan</SheetTitle>
        </SheetHeader>
        <div className="space-y-2 px-4 py-2">
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Pick a goal — the app prescribes each run deterministically and adapts to your recovery.
          </p>
          {SELECTABLE_CARDIO_GOALS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGoalKind(g.key)}
              className="w-full rounded-xl border p-3 text-left transition-colors"
              style={
                goalKind === g.key
                  ? { borderColor: 'var(--accent-cyan)', background: 'color-mix(in oklch, var(--accent-cyan) 10%, transparent)' }
                  : { borderColor: 'var(--border)', background: 'var(--card)' }
              }
            >
              <div className="font-semibold">{g.label}</div>
              <div className="text-sm text-[color:var(--muted-foreground)]">{g.blurb}</div>
            </button>
          ))}

          {needsDistance && (
            <div className="pt-1">
              <p className="mb-1.5 text-xs font-medium text-[color:var(--muted-foreground)]">Target distance</p>
              <div className="flex flex-wrap gap-2">
                {DISTANCES.map((d) => (
                  <button
                    key={d.km}
                    type="button"
                    onClick={() => setTargetDistanceKm(d.km)}
                    className="rounded-lg border px-3 py-1.5 text-sm transition-colors"
                    style={
                      targetDistanceKm === d.km
                        ? { borderColor: 'var(--accent-cyan)', background: 'color-mix(in oklch, var(--accent-cyan) 12%, transparent)', fontWeight: 600 }
                        : { borderColor: 'var(--border)', background: 'var(--card)' }
                    }
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="pt-1">
            <p className="mb-1.5 text-xs font-medium text-[color:var(--muted-foreground)]">Session length</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSessionMode('growing')}
                className="flex-1 rounded-xl border p-2.5 text-left text-sm transition-colors"
                style={
                  sessionMode === 'growing'
                    ? { borderColor: 'var(--accent-cyan)', background: 'color-mix(in oklch, var(--accent-cyan) 10%, transparent)' }
                    : { borderColor: 'var(--border)', background: 'var(--card)' }
                }
              >
                <div className="font-semibold">Grows over time</div>
                <div className="text-xs text-[color:var(--muted-foreground)]">Sessions get longer as you build up</div>
              </button>
              <button
                type="button"
                onClick={() => setSessionMode('fixed')}
                className="flex-1 rounded-xl border p-2.5 text-left text-sm transition-colors"
                style={
                  sessionMode === 'fixed'
                    ? { borderColor: 'var(--accent-cyan)', background: 'color-mix(in oklch, var(--accent-cyan) 10%, transparent)' }
                    : { borderColor: 'var(--border)', background: 'var(--card)' }
                }
              >
                <div className="font-semibold">Fixed time</div>
                <div className="text-xs text-[color:var(--muted-foreground)]">Same time each session — do more in it</div>
              </button>
            </div>
          </div>

          <div className="pt-1">
            <p className="mb-1.5 text-xs font-medium text-[color:var(--muted-foreground)]">
              Default session length
            </p>
            <div className="flex flex-wrap gap-2">
              {[15, 20, 30, 45, 60].map((min) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => setTimePerSessionMinutes(min)}
                  className="rounded-lg border px-3 py-1.5 text-sm transition-colors"
                  style={
                    timePerSessionMinutes === min
                      ? { borderColor: 'var(--accent-cyan)', background: 'color-mix(in oklch, var(--accent-cyan) 12%, transparent)', fontWeight: 600 }
                      : { borderColor: 'var(--border)', background: 'var(--card)' }
                  }
                >
                  {min} min
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-[color:var(--muted-foreground)]">
              You can adjust this ±10 min per session, or swap the run type, from the Running screen.
            </p>
          </div>
        </div>
        <SheetFooter>
          <Button className="w-full" onClick={submit} disabled={saving}>
            {saving ? 'Creating…' : 'Create plan'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
