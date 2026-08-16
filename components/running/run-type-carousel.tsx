'use client'

import { memo, useMemo } from 'react'
import { Feather, Footprints, Route, Flame, Zap, Minus, Plus, Sparkles } from 'lucide-react'
import { SwipeCarousel } from '@/components/ui/swipe-carousel'
import { targetsForRunType } from '@trainingai/shared/running/hr-targets'
import { HR_ZONE_META } from '@trainingai/shared/health/hr-zones'
import type { FitnessSnapshot, RunType } from '@trainingai/shared/running/types'
import { CarouselDots } from '@/components/ui/carousel-dots'

const TYPES: RunType[] = ['recovery', 'easy', 'long', 'tempo', 'interval']

const TYPE_LABEL: Record<RunType, string> = {
  recovery: 'Recovery', easy: 'Easy', long: 'Long', tempo: 'Tempo', interval: 'Interval',
}
const TYPE_BLURB: Record<RunType, string> = {
  recovery: 'Very light effort',
  easy: 'Conversational pace',
  long: 'Same easy effort, longer',
  tempo: 'Comfortably hard',
  interval: 'High-intensity work',
}
// Q-98-followup: per-run-type visual identity for the carousel-native redesign. Reuses the
// existing HR-zone icon/colour system (`HR_ZONE_META`, "One Formula, One Place") rather than
// commissioning new illustration assets — each type's icon badge is coloured by the top zone
// it actually targets (`hr-targets.ts`'s `ZONES_BY_TYPE`), so the colour always agrees with the
// "Zone N–M" text already printed on the slide.
const TYPE_ICON: Record<RunType, typeof Feather> = {
  recovery: Feather, easy: Footprints, long: Route, tempo: Flame, interval: Zap,
}

const STEP_MIN = 10
const MIN_DURATION = 10
const MAX_DURATION = 120

interface Props {
  index: number
  onIndexChange: (index: number) => void
  durationMin: number
  onDurationChange: (durationMin: number) => void
  fitness: FitnessSnapshot
  recommendedType: RunType | null
  recommendedReason: string | null
  disabled?: boolean
}

function RunTypeCarouselImpl({
  index, onIndexChange, durationMin, onDurationChange, fitness, recommendedType, recommendedReason, disabled,
}: Props) {
  const slides = useMemo(() => TYPES.map((type) => {
    const targets = targetsForRunType(type, fitness)
    const isRecommended = type === recommendedType
    const Icon = TYPE_ICON[type]
    const zoneColor = HR_ZONE_META.find((z) => z.id === targets.zoneIds[targets.zoneIds.length - 1])?.color
      ?? 'var(--accent-cyan)'
    return (
      <div key={type} className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={
            isRecommended
              ? { color: 'var(--accent-cyan)', background: 'color-mix(in oklch, var(--accent-cyan) 15%, transparent)' }
              : { visibility: 'hidden' }
          }
        >
          <Sparkles className="h-3 w-3" aria-hidden /> Recommended
        </span>
        <span
          className="grid h-11 w-11 place-items-center rounded-full"
          style={{ background: `color-mix(in oklch, ${zoneColor} 18%, transparent)` }}
        >
          <Icon className="h-5 w-5" style={{ color: zoneColor }} aria-hidden />
        </span>
        <p className="text-2xl font-black">{TYPE_LABEL[type]}</p>
        <p className="text-xs text-[color:var(--muted-foreground)]">{TYPE_BLURB[type]}</p>
        <p className="text-sm font-semibold">
          Zone {targets.zoneIds.join('–')} · {targets.hrLowBpm}–{targets.hrHighBpm} bpm
        </p>
        <p
          className="text-[11px]"
          style={isRecommended && recommendedReason ? { color: 'var(--accent-cyan)' } : { visibility: 'hidden' }}
        >
          {isRecommended && recommendedReason ? recommendedReason : ' '}
        </p>
      </div>
    )
  }), [fitness, recommendedType, recommendedReason])

  return (
    <div className="mb-3 space-y-2.5 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
      <p className="font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
        Not feeling it? Swipe to pick something else
      </p>

      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          disabled={disabled || durationMin <= MIN_DURATION}
          onClick={() => onDurationChange(Math.max(MIN_DURATION, durationMin - STEP_MIN))}
          className="grid h-9 w-9 place-items-center rounded-full border border-[color:var(--border)] transition active:scale-95 disabled:opacity-30"
          aria-label="Remove 10 minutes"
        >
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <span className="min-w-[4.5rem] text-center text-lg font-bold tabular-nums">{durationMin} min</span>
        <button
          type="button"
          disabled={disabled || durationMin >= MAX_DURATION}
          onClick={() => onDurationChange(Math.min(MAX_DURATION, durationMin + STEP_MIN))}
          className="grid h-9 w-9 place-items-center rounded-full border border-[color:var(--border)] transition active:scale-95 disabled:opacity-30"
          aria-label="Add 10 minutes"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <SwipeCarousel index={index} onIndexChange={disabled ? () => {} : onIndexChange} className="h-40">
        {slides}
      </SwipeCarousel>

      <CarouselDots
        count={TYPES.length}
        activeIndex={index}
        onSelect={onIndexChange}
        disabled={disabled}
        label={i => TYPE_LABEL[TYPES[i]]}
        activeColor="var(--accent-cyan)"
        inactiveColor={i => (TYPES[i] === recommendedType ? 'var(--muted-foreground)' : 'var(--border)')}
      />
    </div>
  )
}

export const RunTypeCarousel = memo(RunTypeCarouselImpl)
export { TYPES as RUN_TYPES, TYPE_LABEL }
