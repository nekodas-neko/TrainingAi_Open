'use client'

import { memo, useState, useEffect } from 'react'
import { Footprints, Flame, Droplet, Moon, Dumbbell, type LucideIcon } from 'lucide-react'
import { accentCardStyle } from '@trainingai/shared/utils'
import { GoalProgressBar } from './goal-progress-bar'
import type { UserGoals } from '@/lib/data/repository'
import type { BodyMetaRow, WeekToDate } from '@/app/api/body-metadata/route'
import type { ProgressSummaryResponse } from '@/app/api/progress-summary/route'

function normalizeGoal(goal: number, goalType: 'daily' | 'weekly', view: 'today' | 'week'): number {
  if (goalType === 'daily') return view === 'today' ? goal : goal * 7
  return view === 'today' ? goal : goal * 7
}

interface GoalRow {
  key: string
  icon: LucideIcon
  color: string
  value: number | null
  goal: number | null
  weekly: boolean
}

interface GoalsProgressCardProps {
  metaToday: Pick<BodyMetaRow, 'steps' | 'calories' | 'waterMl'> | null
  weekToDate: WeekToDate | null
  userGoals: UserGoals | null
  progressSummary: ProgressSummaryResponse | null
}

const GOALS_VIEW_KEY = 'ta_goals_progress_view'

export const GoalsProgressCard = memo(function GoalsProgressCard({ metaToday, weekToDate, userGoals, progressSummary }: GoalsProgressCardProps) {
  const [view, setView] = useState<'today' | 'week'>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem(GOALS_VIEW_KEY) : null
      return (saved === 'week' ? 'week' : 'today') as 'today' | 'week'
    } catch { return 'today' }
  })

  useEffect(() => {
    try { localStorage.setItem(GOALS_VIEW_KEY, view) } catch { /* ignore */ }
  }, [view])

  const rows: GoalRow[] = []

  if (userGoals?.stepsGoal != null) {
    rows.push({
      key: 'Steps', icon: Footprints, color: '#22c55e', weekly: view === 'week',
      value: view === 'today' ? metaToday?.steps ?? null : weekToDate?.steps ?? null,
      goal: normalizeGoal(userGoals.stepsGoal, userGoals.stepsGoalType ?? 'daily', view),
    })
  }

  if (userGoals?.calorieGoal != null) {
    rows.push({
      key: 'Calories', icon: Flame, color: '#f97316', weekly: view === 'week',
      value: view === 'today' ? metaToday?.calories ?? null : weekToDate?.calories ?? null,
      goal: normalizeGoal(userGoals.calorieGoal, userGoals.calorieGoalType ?? 'daily', view),
    })
  }

  if (userGoals?.waterGoalMl != null) {
    rows.push({
      key: 'Water', icon: Droplet, color: '#38bdf8', weekly: view === 'week',
      value: view === 'today' ? metaToday?.waterMl ?? null : weekToDate?.waterMl ?? null,
      goal: normalizeGoal(userGoals.waterGoalMl, userGoals.waterGoalType ?? 'daily', view),
    })
  }

  if (userGoals?.sleepGoalHours != null) {
    rows.push({
      key: 'Sleep', icon: Moon, color: '#a78bfa', weekly: view === 'week',
      value: view === 'today' ? progressSummary?.sleep.lastNightHours ?? null : progressSummary?.sleep.thisWeekHours ?? null,
      goal: view === 'today' ? userGoals.sleepGoalHours : userGoals.sleepGoalHours * 7,
    })
  }

  if (progressSummary?.workouts) {
    rows.push({
      key: 'Workouts', icon: Dumbbell, color: '#fbbf24', weekly: view === 'week',
      value: view === 'today' ? (progressSummary.workouts.todayComplete ? 1 : 0) : progressSummary.workouts.completedThisWeek,
      goal: view === 'today' ? 1 : progressSummary.workouts.scheduledThisWeek,
    })
  }

  const visibleRows = rows.filter(r => r.value != null && r.goal != null && r.goal > 0)
  if (visibleRows.length === 0) return null

  return (
    <div className="rounded-2xl p-4" style={accentCardStyle('#22c55e')}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Goals</p>
        <div className="flex items-center gap-0.5 rounded-xl bg-muted p-0.5 text-xs font-semibold border border-border">
          <button
            type="button"
            onClick={() => setView('today')}
            className={`rounded-lg px-2.5 py-1 transition ${view === 'today' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setView('week')}
            className={`rounded-lg px-2.5 py-1 transition ${view === 'week' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
          >
            This Week
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {visibleRows.map(row => {
          const Icon = row.icon
          return (
            <div key={row.key}>
              <div className="flex items-center gap-2 text-xs font-medium">
                <Icon className="h-3.5 w-3.5" style={{ color: row.color }} />
                <span>{row.key}</span>
              </div>
              <GoalProgressBar value={row.value} goal={row.goal} color={row.color} weekly={row.weekly} />
            </div>
          )
        })}
      </div>
    </div>
  )
})
