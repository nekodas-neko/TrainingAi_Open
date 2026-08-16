'use client'

import { memo, useEffect, type ReactNode } from 'react'
import { useTransitionRouter } from "@/lib/view-transition";
import { ChevronRight, Footprints, Activity } from 'lucide-react'
import { hapticLight } from '@/lib/haptics'

interface Props {
  hasRunningPlan: boolean
  onLogActivity: () => void
  onPickTime: () => void
}

function Option({
  icon, iconColor, iconBg, name, badge, hint, onClick,
}: {
  icon: ReactNode; iconColor: string; iconBg: string
  name: string; badge?: string; hint: string; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={() => { hapticLight(); onClick() }}
      className="flex w-full items-center gap-2.5 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3 text-left transition active:scale-[0.985]"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: iconBg, color: iconColor }}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">
          {name}
          {badge && (
            <span
              className="ml-1.5 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
              style={{ background: 'color-mix(in oklch, var(--accent-cyan) 16%, transparent)', color: 'var(--accent-cyan)' }}
            >
              {badge}
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-[color:var(--muted-foreground)]">{hint}</span>
      </span>
      <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-[color:var(--muted-foreground)]" aria-hidden />
    </button>
  )
}

function ModalityPickerImpl({ hasRunningPlan, onLogActivity, onPickTime }: Props) {
  const router = useTransitionRouter()

  // Both destinations are static and this picker exists to send you to one of them, so
  // warm both rather than guessing. Button pushes get no automatic prefetch (#919).
  useEffect(() => {
    router.prefetch('/running')
    router.prefetch('/activity/guided-walk')
  }, [router])
  return (
    <div className="flex flex-col gap-2">
      {/* Once a running plan exists, its default session time + the Running screen's own
          +/- 10 min adjuster and run-type picker cover this — the standalone picker only
          still earns its place for Walk/Activity, or before a plan exists at all. */}
      {!hasRunningPlan && (
        <button
          type="button"
          onClick={onPickTime}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[color:var(--border)] bg-transparent p-3 text-sm font-semibold text-[color:var(--accent-cyan)] transition active:scale-[0.985]"
        >
          How much time do you have?
        </button>
      )}
      <Option
        icon={<Footprints className="h-4.5 w-4.5" />}
        iconColor="var(--accent-cyan)"
        iconBg="color-mix(in oklch, var(--accent-cyan) 15%, transparent)"
        name="Run"
        badge={hasRunningPlan ? 'Program' : undefined}
        hint={hasRunningPlan ? 'Your running plan' : 'Set up a running plan'}
        onClick={() => router.push('/running')}
      />
      <Option
        icon={<Footprints className="h-4.5 w-4.5" />}
        iconColor="#22c55e"
        iconBg="color-mix(in oklch, #22c55e 16%, transparent)"
        name="Guided walk"
        hint="Interval walk with fast and easy blocks"
        onClick={() => router.push('/activity/guided-walk')}
      />
      <Option
        icon={<Activity className="h-4.5 w-4.5" />}
        iconColor="var(--muted-foreground)"
        iconBg="var(--muted)"
        name="Other activity"
        hint="Treadmill, cycle, anything logged"
        onClick={onLogActivity}
      />
    </div>
  )
}

export const ModalityPicker = memo(ModalityPickerImpl)
