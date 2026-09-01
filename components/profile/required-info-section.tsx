'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRovingRadioGroup } from '@/lib/hooks/use-roving-radio-group'
import { ACTIVITY_LEVELS, type ActivityLevel } from '@trainingai/shared/types/user'

/**
 * The goal-side half of what used to be "Required Information".
 *
 * Height, birth year and biological sex left this component in BF-79 — they are personal details
 * and now live on `More → Profile details`, so a profile column is edited in exactly one place.
 * What stays is what is genuinely a goal or an input to one: the two body targets, each shown
 * against its latest measurement, and activity level.
 */

const ACTIVITY_LABELS: Record<ActivityLevel, { label: string; description: string }> = {
  sedentary:    { label: 'Sedentary',    description: 'Little to no exercise, desk job' },
  light:        { label: 'Light',        description: 'Light exercise 1-3 days/week' },
  moderate:     { label: 'Moderate',     description: 'Moderate exercise 3-5 days/week' },
  active:       { label: 'Active',       description: 'Hard exercise 6-7 days/week' },
  extra_active: { label: 'Extra Active', description: 'Very hard exercise & physical job' },
}

interface RequiredInfoSectionProps {
  latestWeightKg: number | null
  latestWeightLabel: string | null
  targetWeightStr: string
  onTargetWeightChange: (value: string) => void
  latestBfPct: number | null
  latestBfLabel: string | null
  targetBfStr: string
  onTargetBfChange: (value: string) => void
  activityLevel: ActivityLevel | null | undefined
  onActivityLevelChange: (level: ActivityLevel | null) => void
  saving: boolean
}

export function RequiredInfoSection({
  latestWeightKg,
  latestWeightLabel,
  targetWeightStr,
  onTargetWeightChange,
  latestBfPct,
  latestBfLabel,
  targetBfStr,
  onTargetBfChange,
  activityLevel,
  onActivityLevelChange,
  saving,
}: RequiredInfoSectionProps) {
  const activityGroup = useRovingRadioGroup(activityLevel != null)
  const router = useRouter()

  return (
    <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden divide-y divide-border">
      <div className="px-4 pt-3 pb-1.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Targets &amp; Activity</p>
      </div>

      {/* Weight — latest weigh-in -> target */}
      <div className="px-4 py-3">
        <Label htmlFor="goals-weight" className="text-xs text-muted-foreground">Weight</Label>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 min-w-0">
            {latestWeightKg != null ? (
              <p className="text-sm font-medium truncate">
                {latestWeightKg.toFixed(1)} kg
                {latestWeightLabel && <span className="text-muted-foreground"> · {latestWeightLabel}</span>}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No weigh-ins yet</p>
            )}
          </div>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground flex-none" />
          <div className="flex items-center gap-1 flex-none">
            <Input
              type="number"
              id="goals-weight"
              value={targetWeightStr}
              onChange={e => onTargetWeightChange(e.target.value)}
              placeholder="Target"
              min={30}
              max={300}
              step={0.5}
              className="w-20 h-8 text-sm font-medium text-right border-border bg-muted/60"
            />
            <span className="text-xs text-muted-foreground">kg</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push('/health?tab=body')}
          className="text-[10px] text-muted-foreground underline mt-1.5"
        >
          Log a new weigh-in on the Health page
        </button>
      </div>

      {/* Body Fat % — latest log -> target */}
      <div className="px-4 py-3">
        <Label htmlFor="goals-bodyFat" className="text-xs text-muted-foreground">Body Fat %</Label>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 min-w-0">
            {latestBfPct != null ? (
              <p className="text-sm font-medium truncate">
                {latestBfPct.toFixed(1)}%
                {latestBfLabel && <span className="text-muted-foreground"> · {latestBfLabel}</span>}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Not logged</p>
            )}
          </div>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground flex-none" />
          <div className="flex items-center gap-1 flex-none">
            <Input
              type="number"
              id="goals-bodyFat"
              value={targetBfStr}
              onChange={e => onTargetBfChange(e.target.value)}
              placeholder="Target"
              min={3}
              max={50}
              step={0.5}
              className="w-20 h-8 text-sm font-medium text-right border-border bg-muted/60"
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push('/health?tab=body')}
          className="text-[10px] text-muted-foreground underline mt-1.5"
        >
          Log body fat % on the Health page
        </button>
      </div>

      {/* Activity Level */}
      <div className="px-4 py-3 space-y-2">
        <p id="goals-activityLevel-label" className="flex items-center gap-2 text-xs leading-none font-medium text-muted-foreground select-none">Activity Level</p>
        <div className="space-y-1.5" {...activityGroup.groupProps} aria-labelledby="goals-activityLevel-label">
          {ACTIVITY_LEVELS.map((level, i) => {
            const active = activityLevel === level
            return (
              <button
                key={level}
                type="button"
                {...activityGroup.getRadioProps(active, i)}
                aria-disabled={saving}
                onClick={() => { if (saving) return; onActivityLevelChange(active ? null : level) }}
                className={[
                  'w-full text-left rounded-xl border px-3 py-2 transition',
                  active ? 'bg-foreground text-background border-foreground' : 'bg-muted border-transparent text-foreground',
                ].join(' ')}
              >
                <p className="text-sm font-semibold">{ACTIVITY_LABELS[level].label}</p>
                <p className={`text-[10px] ${active ? 'text-background/70' : 'text-muted-foreground'}`}>
                  {ACTIVITY_LABELS[level].description}
                </p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
