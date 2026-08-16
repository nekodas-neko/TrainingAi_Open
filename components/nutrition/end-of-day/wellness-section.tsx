'use client'

import { EVENING_SCALES, type EveningScaleKey } from '@trainingai/shared/types/day-checkin'
import { ScaleSelector } from './scale-selector'

const MUSCLE_GROUPS = [
  { label: 'Upper Body', muscles: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'] },
  { label: 'Lower Body', muscles: ['Quads', 'Hamstrings', 'Glutes', 'Calves'] },
  { label: 'Core', muscles: ['Core'] },
]

interface Props {
  scales: Record<EveningScaleKey, number>
  onScale: (key: EveningScaleKey, v: number) => void
  soreMuscles: string[]
  onToggleMuscle: (m: string) => void
}

export function WellnessSection({ scales, onScale, soreMuscles, onToggleMuscle }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {EVENING_SCALES.map(scale => (
        <ScaleSelector
          key={scale.key}
          label={scale.label}
          low={scale.low}
          high={scale.high}
          value={scales[scale.key]}
          onChange={v => onScale(scale.key, v)}
          color={scale.color}
        />
      ))}

      <div className="flex flex-col gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Sore Muscles{soreMuscles.length > 0 ? ` · ${soreMuscles.length}` : ''}
        </span>
        {MUSCLE_GROUPS.map(group => (
          <div key={group.label}>
            <p className="text-[10px] text-muted-foreground mb-1.5">{group.label}</p>
            <div className="flex gap-2 flex-wrap">
              {group.muscles.map(m => {
                const isSelected = soreMuscles.includes(m)
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onToggleMuscle(m)}
                    className="rounded-full px-3 py-1.5 text-xs font-medium border transition-all"
                    style={{
                      borderColor: isSelected ? 'var(--accent-amber)' : undefined,
                      background: isSelected ? 'color-mix(in oklch, var(--accent-amber) 15%, transparent)' : undefined,
                      color: isSelected ? 'var(--accent-amber)' : undefined,
                    }}
                  >
                    {m}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
