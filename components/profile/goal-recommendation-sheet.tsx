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

/**
 * A mutation that reports whether it landed, and never throws.
 *
 * RV-164: a network error must not abort the remaining writes — the point of checking is to name
 * every field that failed, and an early throw would report only the first. `null` means the write
 * did not land, whether the server refused it or the request never arrived.
 */
async function writeJson(url: string, method: 'PATCH' | 'PUT', body: unknown): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.ok ? res : null
  } catch {
    return null
  }
}

function joinLabels(labels: string[]): string {
  if (labels.length < 2) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
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
    // Every field the user ticked whose write did not land. The recommendation is marked applied
    // only when this is empty: the route takes 'applied' or 'dismissed' and nothing between, so a
    // partial apply must stay pending and retryable rather than record a state the data contradicts.
    const failed: string[] = []
    try {
      const goalsPatch: Record<string, number> = {}
      const stepsRow = rows.find(r => r.key === 'steps')!
      const caloriesRow = rows.find(r => r.key === 'calories')!
      const waterRow = rows.find(r => r.key === 'water')!
      if (checked.steps) goalsPatch.stepsGoal = Math.round(stepsRow.suggested)
      if (checked.calories) goalsPatch.calorieGoal = Math.round(caloriesRow.suggested)
      if (checked.water) goalsPatch.waterGoalMl = Math.round(waterRow.suggested)
      if (Object.keys(goalsPatch).length > 0) {
        if (await writeJson('/api/user/goals', 'PATCH', goalsPatch)) {
          // Seeds are written only once the PATCH has landed. Writing them regardless would leave
          // the home widgets — which read this synchronously — showing a goal the server rejected.
          // Since Q-241 this is a cache of the server value rather than a second source of truth;
          // `invalidateGoalRecommendations()` below drops the `user-goals` entry so the next read
          // comes from the server.
          if (goalsPatch.stepsGoal != null) localStorage.setItem(STEPS_GOAL_KEY, String(goalsPatch.stepsGoal))
          if (goalsPatch.calorieGoal != null) localStorage.setItem(CALORIE_GOAL_KEY, String(goalsPatch.calorieGoal))
          if (goalsPatch.waterGoalMl != null) localStorage.setItem(WATER_GOAL_KEY, String(goalsPatch.waterGoalMl))
          onGoalsApplied?.(goalsPatch)
        } else {
          if (checked.steps) failed.push('Steps Goal')
          if (checked.calories) failed.push('Calories')
          if (checked.water) failed.push('Water')
        }
      }

      const targetsPatch: Record<string, number> = {}
      if (checked.calories) targetsPatch.calories = rec.recommended.calories
      if (checked.protein) targetsPatch.proteinG = rec.recommended.proteinG
      if (checked.carbs) targetsPatch.carbsG = rec.recommended.carbsG
      if (checked.fat) targetsPatch.fatG = rec.recommended.fatG
      if (Object.keys(targetsPatch).length > 0) {
        if (!await writeJson('/api/nutrition/targets', 'PUT', targetsPatch)) {
          // Calories can already be here from the goals PATCH — it is one metric to the reader even
          // though two routes store it, so name it once.
          if (checked.calories && !failed.includes('Calories')) failed.push('Calories')
          if (checked.protein) failed.push('Protein')
          if (checked.carbs) failed.push('Carbs')
          if (checked.fat) failed.push('Fat')
        }
      }

      if (showActivityRow && checked.activityLevel) {
        const res = await writeJson('/api/user/profile', 'PATCH', { activityLevel: rec.recommended.activityLevel })
        if (res) {
          const d = await res.json()
          onUserSaved(d.user)
        } else {
          failed.push('Activity Level')
        }
      }

      if (failed.length === 0) {
        await writeJson(`/api/nutrition-goals/${rec.id}`, 'PATCH', { status: 'applied' })
      }
      // Runs either way: whatever did land has to be visible, and a partial apply is exactly the
      // case where a stale read would hide half the change.
      await invalidateGoalRecommendations()
      onApplied?.()

      if (failed.length === 0) {
        toast.success('Goals updated')
        onOpenChange(false)
      } else {
        // The sheet stays open with the toggles as they were, so retrying is one tap.
        toast.error(`Couldn't save ${joinLabels(failed)} — nothing was marked applied, try again`)
      }
    } catch {
      toast.error('Failed to apply changes')
    } finally {
      setApplying(false)
    }
  }

  async function handleDismiss() {
    setDismissing(true)
    try {
      // Same defect as apply had: closing on an unread response means a refused dismiss leaves the
      // recommendation pending and the sheet gone, so it returns on the next read looking untouched.
      if (await writeJson(`/api/nutrition-goals/${rec.id}`, 'PATCH', { status: 'dismissed' })) {
        onOpenChange(false)
      } else {
        toast.error('Failed to dismiss')
      }
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
              <Switch checked={checked[row.key] ?? false} onCheckedChange={v => setChecked(prev => ({ ...prev, [row.key]: v }))} aria-label={row.label} />
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
              <Switch aria-label="Activity Level" checked={checked.activityLevel ?? false} onCheckedChange={v => setChecked(prev => ({ ...prev, activityLevel: v }))} />
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
