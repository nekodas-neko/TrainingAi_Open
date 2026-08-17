'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ACTIVITY_LEVELS, type ActivityLevel } from '@trainingai/shared/types/user'

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
  heightCm: string
  onHeightChange: (value: string) => void
  birthYear: string
  onBirthYearChange: (value: string) => void
  sex: string
  onSexChange: (value: string) => void
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
  heightCm,
  onHeightChange,
  birthYear,
  onBirthYearChange,
  sex,
  onSexChange,
  activityLevel,
  onActivityLevelChange,
  saving,
}: RequiredInfoSectionProps) {
  const router = useRouter()

  return (
    <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden divide-y divide-border">
      <div className="px-4 pt-3 pb-1.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Required Information</p>
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

      {/* Height */}
      <div className="px-4 py-3">
        <Label htmlFor="goals-height" className="text-xs text-muted-foreground">Height (cm)</Label>
        <Input
          id="goals-height"
          type="number"
          value={heightCm}
          onChange={e => onHeightChange(e.target.value)}
          placeholder="175"
          min={50}
          max={300}
          disabled={saving}
          className="mt-0.5 border-0 bg-transparent p-0 h-auto text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
        />
      </div>

      {/* Biological Sex */}
      <div className="px-4 py-3 space-y-1.5">
        <p id="goals-sex-label" className="flex items-center gap-2 text-xs leading-none font-medium text-muted-foreground select-none">Biological Sex</p>
        <div className="flex gap-2" role="radiogroup" aria-labelledby="goals-sex-label">
          {(['male', 'female', 'other'] as const).map(opt => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={sex === opt}
              disabled={saving}
              onClick={() => onSexChange(sex === opt ? '' : opt)}
              className={[
                'flex-1 rounded-xl border px-3 py-2 text-xs font-semibold capitalize transition',
                sex === opt
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-muted border-transparent text-muted-foreground',
              ].join(' ')}
            >
              {opt === 'male' ? 'Male' : opt === 'female' ? 'Female' : 'Other'}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">Used for BMI and energy balance estimates</p>
      </div>

      {/* Birth Year */}
      <div className="px-4 py-3">
        <Label htmlFor="goals-birthYear" className="text-xs text-muted-foreground">Birth Year</Label>
        <Input
          id="goals-birthYear"
          type="number"
          value={birthYear}
          onChange={e => onBirthYearChange(e.target.value)}
          placeholder="1990"
          min={1920}
          max={new Date().getFullYear() - 10}
          disabled={saving}
          className="mt-0.5 border-0 bg-transparent p-0 h-auto text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
        />
      </div>

      {/* Activity Level */}
      <div className="px-4 py-3 space-y-2">
        <p id="goals-activityLevel-label" className="flex items-center gap-2 text-xs leading-none font-medium text-muted-foreground select-none">Activity Level</p>
        <div className="space-y-1.5" role="radiogroup" aria-labelledby="goals-activityLevel-label">
          {ACTIVITY_LEVELS.map(level => {
            const active = activityLevel === level
            return (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={saving}
                onClick={() => onActivityLevelChange(active ? null : level)}
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
