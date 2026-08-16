'use client'

import { memo } from 'react'

interface Props {
  today: number
  todayGoal: number
  week: number
  weekGoal: number
}

function StepBar({ value, goal, label }: { value: number; goal: number; label: string }) {
  const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between font-mono text-xs tabular-nums">
        <span>{value.toLocaleString()}</span>
        <span className="text-[10px] text-[color:var(--muted-foreground)]">/ {goal.toLocaleString()} {label}</span>
      </div>
      <div
        className="flex h-1.5 overflow-hidden rounded-full bg-[color:var(--muted)]"
        role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
        aria-label={`Steps ${label}`}
      >
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent-cyan)' }} />
      </div>
    </div>
  )
}

function StepsQuotaCardImpl({ today, todayGoal, week, weekGoal }: Props) {
  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
      <p className="mb-2.5 font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">Steps</p>
      <div className="grid grid-cols-2 gap-3">
        <StepBar value={today} goal={todayGoal} label="today" />
        <StepBar value={week} goal={weekGoal} label="wk" />
      </div>
    </div>
  )
}

export const StepsQuotaCard = memo(StepsQuotaCardImpl)
