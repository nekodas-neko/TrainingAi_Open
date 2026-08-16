'use client'

import { cn } from '@trainingai/shared/utils'

export const GOAL_SPECTRUM = [
  {
    value:       'hypertrophy',
    label:       'Hypertrophy',
    shortLabel:  'Hyp',
    range:       '60–75%',
    focus:       'Volume',
    description: 'Maximise muscle size — high volume (4×10), moderate load. Builds through 4×8 → 4×6 as intensity rises.',
    color:       '#22c55e',
    phases: [
      { name: 'Accum',  sets: 4, reps: 10, pct: 65 },
      { name: 'Build',  sets: 4, reps: 8,  pct: 72 },
      { name: 'Peak',   sets: 4, reps: 6,  pct: 80 },
      { name: 'Deload', sets: 2, reps: 12, pct: 52 },
    ],
  },
  {
    value:       'strength+hypertrophy',
    label:       'Strength + Hypertrophy',
    shortLabel:  'S+H',
    range:       '65–80%',
    focus:       'Hybrid',
    description: 'Size foundation, strength finish — starts at 4×8@70%, builds through 4×6@75% to a 4×5@80% peak.',
    color:       '#00d4ff',
    phases: [
      { name: 'Accum',  sets: 4, reps: 8,  pct: 70 },
      { name: 'Build',  sets: 4, reps: 6,  pct: 75 },
      { name: 'Peak',   sets: 4, reps: 5,  pct: 82 },
      { name: 'Deload', sets: 2, reps: 11, pct: 52 },
    ],
  },
  {
    value:       'powerbuilding',
    label:       'Powerbuilding',
    shortLabel:  'PB',
    range:       '80–90%',
    focus:       'Crossover',
    description: 'Heavy compounds throughout — 4×6@80% → 5×5@85% → 3×3@90%. Strength and size together.',
    color:       '#f97316',
    phases: [
      { name: 'Accum',  sets: 4, reps: 6, pct: 80 },
      { name: 'Build',  sets: 5, reps: 5, pct: 85 },
      { name: 'Peak',   sets: 3, reps: 3, pct: 90 },
      { name: 'Deload', sets: 2, reps: 9, pct: 55 },
    ],
  },
  {
    value:       'strength',
    label:       'Strength',
    shortLabel:  'STR',
    range:       '85–92%',
    focus:       'Intensity',
    description: 'Maximise 1RM — near-maximal loads from day one. 5×4@85% → 5×3@90% → 4×2@92%. Pure neural strength.',
    color:       '#f43f5e',
    phases: [
      { name: 'Accum',  sets: 5, reps: 4, pct: 85 },
      { name: 'Build',  sets: 5, reps: 3, pct: 90 },
      { name: 'Peak',   sets: 4, reps: 2, pct: 92 },
      { name: 'Deload', sets: 2, reps: 6, pct: 55 },
    ],
  },
] as const

export function GoalSpectrum({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const selectedIdx = GOAL_SPECTRUM.findIndex(g => g.value === value)
  const selected = GOAL_SPECTRUM[selectedIdx] ?? GOAL_SPECTRUM[0]

  return (
    <div className="space-y-4">
      {/* Scale bar with stops */}
      <div className="px-2">
        {/* Axis labels */}
        <div className="flex justify-between mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Volume focus</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Intensity focus</span>
        </div>

        {/* Gradient track */}
        <div className="relative h-2 rounded-full" style={{ background: 'linear-gradient(90deg, #22c55e, #00d4ff 33%, #f97316 66%, #f43f5e)' }}>
          {/* Stop markers */}
          {GOAL_SPECTRUM.map((goal, i) => {
            const pct = (i / (GOAL_SPECTRUM.length - 1)) * 100
            const isSelected = goal.value === value
            return (
              <button
                key={goal.value}
                onClick={() => onChange(goal.value)}
                style={{ left: `${pct}%` }}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-transform"
                aria-label={goal.label}
              >
                <div
                  className={cn(
                    'rounded-full border-2 border-background transition-all',
                    isSelected ? 'w-5 h-5 shadow-lg' : 'w-3 h-3',
                  )}
                  style={{ background: goal.color }}
                />
              </button>
            )
          })}
        </div>

        {/* Stop labels */}
        <div className="relative h-7 mt-1">
          {GOAL_SPECTRUM.map((goal, i) => {
            const pct = (i / (GOAL_SPECTRUM.length - 1)) * 100
            return (
              <button
                key={goal.value}
                onClick={() => onChange(goal.value)}
                style={{ left: `${pct}%` }}
                className="absolute -translate-x-1/2 top-0 flex flex-col items-center gap-0.5"
              >
                <span
                  className={cn('text-[10px] font-bold whitespace-nowrap', goal.value === value ? 'text-foreground' : 'text-muted-foreground')}
                  style={goal.value === value ? { color: goal.color } : {}}
                >
                  {goal.shortLabel}
                </span>
                <span className="text-[9px] text-muted-foreground/60 tabular-nums">{goal.range}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Selected goal detail card */}
      <div
        className="rounded-2xl p-4 space-y-2 transition-all"
        style={{
          background: `color-mix(in oklab, ${selected.color} 10%, var(--color-muted))`,
          border: `1px solid color-mix(in oklch, ${selected.color} 30%, transparent)`,
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-bold text-base">{selected.label}</p>
            <p className="text-xs font-medium mt-0.5" style={{ color: selected.color }}>{selected.focus} · {selected.range}</p>
          </div>
          {/* Intensity bar */}
          <div className="flex flex-col items-end gap-1 flex-none">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Intensity</span>
            <div className="flex gap-0.5">
              {GOAL_SPECTRUM.map((g, i) => (
                <div
                  key={g.value}
                  className="h-2.5 w-3.5 rounded-sm transition-all"
                  style={{
                    background: i <= selectedIdx
                      ? selected.color
                      : 'color-mix(in oklch, var(--color-muted-foreground) 20%, transparent)',
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        <p className="text-sm text-muted-foreground leading-snug">{selected.description}</p>

        {/* Phase-progression chart — load climbs and reps drop across the cycle, then deload. */}
        <div className="pt-1">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">Phase progression · load climbs, reps drop</p>
          <div className="flex items-end gap-1.5">
            {selected.phases.map((ph) => {
              const isDeload = ph.name === 'Deload'
              const heightPct = Math.round((ph.pct / 95) * 100)
              return (
                <div key={ph.name} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] tabular-nums text-muted-foreground leading-none">{ph.sets}×{ph.reps}</span>
                  <div className="w-full h-12 flex items-end">
                    <div
                      className="w-full rounded-t-md transition-all"
                      style={{ height: `${heightPct}%`, background: selected.color, opacity: isDeload ? 0.35 : 1 }}
                    />
                  </div>
                  <span
                    className="text-[9px] tabular-nums font-bold leading-none"
                    style={{ color: isDeload ? 'var(--color-muted-foreground)' : selected.color }}
                  >{ph.pct}%</span>
                  <span className="text-[8px] text-muted-foreground leading-none">{ph.name}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* All options as a quick tap row */}
      <div className="grid grid-cols-2 gap-2">
        {GOAL_SPECTRUM.map(goal => (
          <button
            key={goal.value}
            onClick={() => onChange(goal.value)}
            className={cn(
              'rounded-xl border px-3 py-2.5 text-left transition',
              goal.value === value ? 'border-[2px]' : 'bg-muted border-transparent',
            )}
            style={goal.value === value ? { borderColor: goal.color, background: `color-mix(in oklab, ${goal.color} 8%, var(--color-muted))` } : {}}
          >
            <p className="text-xs font-bold">{goal.shortLabel}</p>
            <p className="text-[10px] text-muted-foreground tabular-nums">{goal.range}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
