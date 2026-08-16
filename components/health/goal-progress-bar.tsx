export function GoalProgressBar({ value, goal, color = 'var(--color-brand)', weekly = false }: { value: number | null; goal: number | null; color?: string; weekly?: boolean }) {
  if (value == null || goal == null || goal <= 0) return null
  const pct = Math.min((value / goal) * 100, 100)
  return (
    <div className="mt-2 space-y-1">
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: `color-mix(in oklch, ${color} 15%, transparent)` }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct.toFixed(1)}%`, background: color }} />
      </div>
      <p className="text-[10px] text-muted-foreground tabular-nums">{weekly ? 'This week: ' : ''}{value.toLocaleString()} / {goal.toLocaleString()}{pct >= 100 ? ' ✓' : ''}</p>
    </div>
  )
}
