'use client'

import { Input } from '@/components/ui/input'
import { useRovingRadioGroup } from '@/lib/hooks/use-roving-radio-group'
import { Label } from '@/components/ui/label'
import { FITNESS_GOALS, type FitnessGoal } from '@trainingai/shared/types/user'
import { GoalProgressBar } from '@/components/health/goal-progress-bar'
import type { BaselineResult } from '@trainingai/shared/nutrition/goal-recommendation'
import { RecommendedValue } from './recommended-value'
import { MacroTargetsPane } from './macro-targets-pane'

const FITNESS_GOAL_LABELS: Record<FitnessGoal, { label: string; description: string }> = {
  lose_weight:  { label: 'Lose Weight',                       description: 'Calorie deficit to reduce body fat' },
  maintain:     { label: 'Maintain',                          description: 'Stay at current weight and performance' },
  build_muscle: { label: 'Build Muscle',                      description: 'Calorie surplus to support muscle growth' },
  recomp:       { label: 'Lose fat & build muscle (recomp)',  description: 'Slight deficit with high protein' },
}

interface GoalTargetsSectionProps {
  fitnessGoal: FitnessGoal | null | undefined
  onFitnessGoalChange: (goal: FitnessGoal | null) => void
  saving: boolean

  stepsGoalStr: string
  onStepsGoalChange: (value: string) => void
  stepsGoalType: 'daily' | 'weekly'
  onStepsGoalTypeChange: (type: 'daily' | 'weekly') => void

  sleepGoalStr: string
  onSleepGoalChange: (value: string) => void

  calorieGoalStr: string
  onCalorieGoalChange: (value: string) => void
  calorieGoalType: 'daily' | 'weekly'
  onCalorieGoalTypeChange: (type: 'daily' | 'weekly') => void

  waterGoalStr: string
  onWaterGoalChange: (value: string) => void
  waterGoalType: 'daily' | 'weekly'
  onWaterGoalTypeChange: (type: 'daily' | 'weekly') => void

  todayMeta: { steps: number | null; waterMl: number | null; calories: number | null } | null
  weekToDate: { steps: number; calories: number; waterMl: number } | null
  macroRefreshKey: number
  /** BF-101: the deterministic per-field recommendation, or `null` on an incomplete profile. */
  baseline: BaselineResult | null
}

export function GoalTargetsSection({
  fitnessGoal, onFitnessGoalChange, saving,
  stepsGoalStr, onStepsGoalChange, stepsGoalType, onStepsGoalTypeChange,
  sleepGoalStr, onSleepGoalChange,
  calorieGoalStr, onCalorieGoalChange, calorieGoalType, onCalorieGoalTypeChange,
  waterGoalStr, onWaterGoalChange, waterGoalType, onWaterGoalTypeChange,
  todayMeta, weekToDate, macroRefreshKey, baseline,
}: GoalTargetsSectionProps) {
  const fitnessGoalGroup = useRovingRadioGroup(fitnessGoal != null)
  return (
    <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden divide-y divide-border">
      <div className="px-4 pt-3 pb-1.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Your Goals</p>
      </div>

      {/* Fitness Goal */}
      <div className="px-4 py-3 space-y-2">
        <p id="goals-fitnessGoal-label" className="flex items-center gap-2 text-xs leading-none font-medium text-muted-foreground select-none">Fitness Goal</p>
        <div className="space-y-1.5" {...fitnessGoalGroup.groupProps} aria-labelledby="goals-fitnessGoal-label">
          {FITNESS_GOALS.map((goal, i) => {
            const active = fitnessGoal === goal
            return (
              <button
                key={goal}
                type="button"
                {...fitnessGoalGroup.getRadioProps(active, i)}
                // `aria-disabled`, not `disabled`, with the guard moved into the handler (Q-355).
                // A native `disabled` still blocks the double-submit this is for, but the browser
                // also drops focus from an element that becomes disabled — so every arrow keypress
                // ejected the user from the group while the PATCH was in flight. This keeps the
                // protection and the focus. `useRovingRadioGroup` skips `aria-disabled` options.
                aria-disabled={saving}
                onClick={() => { if (saving) return; onFitnessGoalChange(active ? null : goal) }}
                className={[
                  'w-full text-left rounded-xl border px-3 py-2 transition',
                  active ? 'bg-foreground text-background border-foreground' : 'bg-muted border-transparent text-foreground',
                ].join(' ')}
              >
                <p className="text-sm font-semibold">{FITNESS_GOAL_LABELS[goal].label}</p>
                <p className={`text-[10px] ${active ? 'text-background/70' : 'text-muted-foreground'}`}>
                  {FITNESS_GOAL_LABELS[goal].description}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Steps Goal */}
      <div className="px-4 py-3 space-y-2">
        <Label htmlFor="goals-stepsGoal" className="text-xs text-muted-foreground">Steps Goal</Label>
        <Input
          type="number"
          id="goals-stepsGoal"
          value={stepsGoalStr}
          onChange={e => onStepsGoalChange(e.target.value)}
          placeholder="10000"
          min={1000}
          step={500}
          className="border-border bg-muted/60 text-sm font-medium"
        />
        <div className="flex items-center gap-0.5 rounded-xl bg-muted p-0.5 text-xs font-semibold border border-border self-start">
          <button type="button" onClick={() => onStepsGoalTypeChange('daily')}
            className={`rounded-lg px-4 py-1.5 transition ${stepsGoalType === 'daily' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}>Daily</button>
          <button type="button" onClick={() => onStepsGoalTypeChange('weekly')}
            className={`rounded-lg px-4 py-1.5 transition ${stepsGoalType === 'weekly' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}>Weekly</button>
        </div>
        {/* The stored figure is the DAILY goal in both modes — the weekly toggle multiplies it by 7
            for the bar below rather than changing what the field holds — so one recommendation is
            correct for either. */}
        <RecommendedValue
          recommended={baseline?.stepsGoal ?? null}
          current={parseInt(stepsGoalStr) || null}
          why="your activity level's step target"
          onApply={v => onStepsGoalChange(String(v))}
        />
        {(() => {
          const weekly = stepsGoalType === 'weekly'
          const goalNum = parseInt(stepsGoalStr) || null
          return (
            <GoalProgressBar
              value={weekly ? weekToDate?.steps ?? null : todayMeta?.steps ?? null}
              goal={weekly && goalNum != null ? goalNum * 7 : goalNum}
              weekly={weekly}
              color="#22c55e"
            />
          )
        })()}
      </div>

      {/* Sleep Goal */}
      <div className="px-4 py-3">
        <Label htmlFor="goals-sleepGoal" className="text-xs text-muted-foreground">Sleep Goal (hours)</Label>
        <Input
          type="number"
          id="goals-sleepGoal"
          value={sleepGoalStr}
          onChange={e => onSleepGoalChange(e.target.value)}
          placeholder="8"
          min={4}
          max={12}
          step={0.5}
          className="mt-0.5 border-0 bg-transparent p-0 h-auto text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
        />
      </div>

      {/* Water Goal */}
      <div className="px-4 py-3 space-y-2">
        <Label htmlFor="goals-waterGoal" className="text-xs text-muted-foreground">Daily Water Goal</Label>
        <Input
          type="number"
          id="goals-waterGoal"
          value={waterGoalStr}
          onChange={e => onWaterGoalChange(e.target.value)}
          placeholder="2500"
          min={500}
          step={250}
          className="border-border bg-muted/60 text-sm font-medium"
        />
        <div className="flex items-center gap-0.5 rounded-xl bg-muted p-0.5 text-xs font-semibold border border-border self-start">
          <button type="button" onClick={() => onWaterGoalTypeChange('daily')}
            className={`rounded-lg px-4 py-1.5 transition ${waterGoalType === 'daily' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}>Daily</button>
          <button type="button" onClick={() => onWaterGoalTypeChange('weekly')}
            className={`rounded-lg px-4 py-1.5 transition ${waterGoalType === 'weekly' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}>Weekly</button>
        </div>
        <RecommendedValue
          recommended={baseline?.waterMl ?? null}
          current={parseInt(waterGoalStr) || null}
          unit="ml"
          why="33 ml per kg of body weight, plus your activity bump"
          onApply={v => onWaterGoalChange(String(v))}
        />
        {(() => {
          const weekly = waterGoalType === 'weekly'
          const goalNum = parseInt(waterGoalStr) || null
          return (
            <GoalProgressBar
              value={weekly ? weekToDate?.waterMl ?? null : todayMeta?.waterMl ?? null}
              goal={weekly && goalNum != null ? goalNum * 7 : goalNum}
              weekly={weekly}
              color="#38bdf8"
            />
          )
        })()}
      </div>

      {/* Calorie Goal */}
      <div className="px-4 py-3 space-y-2">
        <Label htmlFor="goals-calorieGoal" className="text-xs text-muted-foreground">Calorie Goal</Label>
        <Input
          type="number"
          inputMode="decimal"
          id="goals-calorieGoal"
          value={calorieGoalStr}
          onChange={e => onCalorieGoalChange(e.target.value)}
          placeholder="e.g. 2500"
          className="border-border bg-muted/60 text-sm font-medium"
        />
        <div className="flex items-center gap-0.5 rounded-xl bg-muted p-0.5 text-xs font-semibold border border-border self-start">
          <button type="button" onClick={() => onCalorieGoalTypeChange('daily')}
            className={`rounded-lg px-4 py-1.5 transition ${calorieGoalType === 'daily' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}>Daily</button>
          <button type="button" onClick={() => onCalorieGoalTypeChange('weekly')}
            className={`rounded-lg px-4 py-1.5 transition ${calorieGoalType === 'weekly' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}>Weekly</button>
        </div>
        <RecommendedValue
          recommended={baseline?.calories ?? null}
          current={parseInt(calorieGoalStr) || null}
          unit="kcal"
          why="your resting rate on a rest day, adjusted for your fitness goal"
          onApply={v => onCalorieGoalChange(String(v))}
        />
        {(() => {
          const weekly = calorieGoalType === 'weekly'
          const goalNum = parseInt(calorieGoalStr) || null
          return (
            <GoalProgressBar
              value={weekly ? weekToDate?.calories ?? null : todayMeta?.calories ?? null}
              goal={weekly && goalNum != null ? goalNum * 7 : goalNum}
              weekly={weekly}
              color="#f97316"
            />
          )
        })()}
      </div>

      {/* Macro Targets — collapsible, auto-filled by AI recommendations */}
      <MacroTargetsPane refreshKey={macroRefreshKey} baseline={baseline} />
    </div>
  )
}
