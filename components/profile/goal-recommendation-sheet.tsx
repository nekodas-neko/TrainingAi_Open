'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { User } from '@trainingai/shared/types'
import type { ActivityLevel } from '@trainingai/shared/types/user'
import { invalidateGoalRecommendations } from '@/lib/cache-groups'
import { STEPS_GOAL_KEY, CALORIE_GOAL_KEY, WATER_GOAL_KEY } from '@/lib/home/home-prefs'

export interface GoalRecommendationData {
  id: string
  current: {
    stepsGoal: number | null
    stepsGoalType: 'daily' | 'weekly' | null
    calorieGoal: number | null
    calorieGoalType: 'daily' | 'weekly' | null
    waterGoalMl: number | null
    waterGoalType: 'daily' | 'weekly' | null
    proteinG: number | null
    carbsG: number | null
    fatG: number | null
    activityLevel: ActivityLevel | null
  }
  recommended: {
    stepsGoal: number
    calories: number
    proteinG: number
    carbsG: number
    fatG: number
    waterMl: number
    activityLevel: ActivityLevel | null
  }
  reasoning: string
  insights: string
  dataQualityNote: string
}

interface GoalRecommendationSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: GoalRecommendationData | null
  onUserSaved: (updated: User) => void
  // Called with whichever of stepsGoal/calorieGoal/waterGoalMl were applied, so the
  // caller can update its own already-rendered state (these values also live in
  // localStorage, which this component writes through to directly).
  onGoalsApplied?: (applied: { stepsGoal?: number; calorieGoal?: number; waterGoalMl?: number }) => void
  // Called after a successful apply, regardless of which rows were toggled — lets
  // the caller refresh anything derived from the applied recommendation (e.g. the
  // macro targets pane, which is updated server-side via /api/nutrition/targets).
  onApplied?: () => void
}

type MetricKey = 'steps' | 'calories' | 'protein' | 'carbs' | 'fat' | 'water'

interface MetricRow {
  key: MetricKey
  label: string
  unit: string
  current: number | null
  suggested: number
}

function multiplier(goalType: 'daily' | 'weekly' | null): number {
  return goalType === 'weekly' ? 7 : 1
}

function formatActivityLevel(level: ActivityLevel | null): string {
  return level ? level.replaceAll('_', ' ') : 'unset'
}

export function GoalRecommendationSheet({ open, onOpenChange, data, onUserSaved, onGoalsApplied, onApplied }: GoalRecommendationSheetProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [applying, setApplying] = useState(false)
  const [dismissing, setDismissing] = useState(false)

  useEffect(() => {
    if (!data) return
    setChecked({
      steps: true, calories: true, protein: true, carbs: true, fat: true, water: true,
      activityLevel: true,
    })
  }, [data])

  if (!data) return null
  const rec = data

  const rows: MetricRow[] = [
    { key: 'steps', label: 'Steps Goal', unit: '', current: data.current.stepsGoal, suggested: data.recommended.stepsGoal * multiplier(data.current.stepsGoalType) },
    { key: 'calories', label: 'Calories', unit: ' kcal', current: data.current.calorieGoal, suggested: data.recommended.calories * multiplier(data.current.calorieGoalType) },
    { key: 'protein', label: 'Protein', unit: 'g', current: data.current.proteinG, suggested: data.recommended.proteinG },
    { key: 'carbs', label: 'Carbs', unit: 'g', current: data.current.carbsG, suggested: data.recommended.carbsG },
    { key: 'fat', label: 'Fat', unit: 'g', current: data.current.fatG, suggested: data.recommended.fatG },
    { key: 'water', label: 'Water', unit: 'ml', current: data.current.waterGoalMl, suggested: data.recommended.waterMl * multiplier(data.current.waterGoalType) },
  ]

  const showActivityRow = data.recommended.activityLevel != null && data.recommended.activityLevel !== data.current.activityLevel

  async function handleApply() {
    setApplying(true)
    try {
      const goalsPatch: Record<string, number> = {}
      const stepsRow = rows.find(r => r.key === 'steps')!
      const caloriesRow = rows.find(r => r.key === 'calories')!
      const waterRow = rows.find(r => r.key === 'water')!
      if (checked.steps) goalsPatch.stepsGoal = Math.round(stepsRow.suggested)
      if (checked.calories) goalsPatch.calorieGoal = Math.round(caloriesRow.suggested)
      if (checked.water) goalsPatch.waterGoalMl = Math.round(waterRow.suggested)
      if (Object.keys(goalsPatch).length > 0) {
        await fetch('/api/user/goals', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(goalsPatch),
        })
        // Update the first-paint seed so the home widgets, which still read it synchronously,
        // reflect the applied suggestion without waiting for a refetch. Since Q-241 this is a
        // cache of the server value rather than a second source of truth — the PATCH above is what
        // actually stores the goal, and `invalidateGoalRecommendations()` below drops the
        // `user-goals` entry so the next read comes from the server.
        if (goalsPatch.stepsGoal != null) localStorage.setItem(STEPS_GOAL_KEY, String(goalsPatch.stepsGoal))
        if (goalsPatch.calorieGoal != null) localStorage.setItem(CALORIE_GOAL_KEY, String(goalsPatch.calorieGoal))
        if (goalsPatch.waterGoalMl != null) localStorage.setItem(WATER_GOAL_KEY, String(goalsPatch.waterGoalMl))
        onGoalsApplied?.(goalsPatch)
      }

      const targetsPatch: Record<string, number> = {}
      if (checked.calories) targetsPatch.calories = rec.recommended.calories
      if (checked.protein) targetsPatch.proteinG = rec.recommended.proteinG
      if (checked.carbs) targetsPatch.carbsG = rec.recommended.carbsG
      if (checked.fat) targetsPatch.fatG = rec.recommended.fatG
      if (Object.keys(targetsPatch).length > 0) {
        await fetch('/api/nutrition/targets', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(targetsPatch),
        })
      }

      if (showActivityRow && checked.activityLevel) {
        const res = await fetch('/api/user/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activityLevel: rec.recommended.activityLevel }),
        })
        if (res.ok) {
          const d = await res.json()
          onUserSaved(d.user)
        }
      }

      await fetch(`/api/nutrition-goals/${rec.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'applied' }),
      })
      await invalidateGoalRecommendations()
      onApplied?.()
      toast.success('Goals updated')
      onOpenChange(false)
    } catch {
      toast.error('Failed to apply changes')
    } finally {
      setApplying(false)
    }
  }

  async function handleDismiss() {
    setDismissing(true)
    try {
      await fetch(`/api/nutrition-goals/${rec.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'dismissed' }),
      })
      onOpenChange(false)
    } catch {
      toast.error('Failed to dismiss')
    } finally {
      setDismissing(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl px-0">
        <SheetHeader className="px-4 pb-3 border-b border-border">
          <SheetTitle>Goal Recommendation</SheetTitle>
        </SheetHeader>

        {data.dataQualityNote && (
          <div className="px-4 py-3 border-b border-border bg-amber-500/10">
            <p className="text-xs text-amber-700 dark:text-amber-400">{data.dataQualityNote}</p>
          </div>
        )}

        <div className="divide-y divide-border border-b border-border">
          {rows.map(row => (
            <div key={row.key} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{row.label}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {row.current != null ? `${Math.round(row.current).toLocaleString()}${row.unit}` : '—'}
                  {' → '}
                  <span className="font-semibold text-foreground">{Math.round(row.suggested).toLocaleString()}{row.unit}</span>
                </p>
              </div>
              <Switch checked={checked[row.key] ?? false} onCheckedChange={v => setChecked(prev => ({ ...prev, [row.key]: v }))} />
            </div>
          ))}

          {showActivityRow && (
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Activity Level</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {formatActivityLevel(data.current.activityLevel)}
                  {' → '}
                  <span className="font-semibold text-foreground">{formatActivityLevel(data.recommended.activityLevel)}</span>
                </p>
              </div>
              <Switch checked={checked.activityLevel ?? false} onCheckedChange={v => setChecked(prev => ({ ...prev, activityLevel: v }))} />
            </div>
          )}
        </div>

        <div className="px-4 py-3 space-y-1 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reasoning</p>
          <p className="text-sm text-foreground/90 leading-relaxed">{data.reasoning}</p>
        </div>

        {data.insights && (
          <div className="px-4 py-3 space-y-1 border-b border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Insights</p>
            <p className="text-sm text-foreground/90 leading-relaxed">{data.insights}</p>
          </div>
        )}

        <div className="px-4 pt-3 pb-6 flex gap-2">
          <Button variant="outline" className="flex-1 h-11" onClick={handleDismiss} disabled={applying || dismissing}>
            {dismissing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Dismiss'}
          </Button>
          <Button className="flex-1 h-11" onClick={handleApply} disabled={applying || dismissing}>
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply Selected'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
