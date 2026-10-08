'use client'

import { memo, useState } from 'react'
import { usePersistedPreference } from '@/lib/user/preferences-sync'
import { Footprints, Flame, Droplet, Moon, Dumbbell, type LucideIcon } from 'lucide-react'
import { accentCardStyle } from '@trainingai/shared/utils'
import { GoalProgressBar } from './goal-progress-bar'
import { EmptyState } from '@/components/ui/empty-state'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'
import { useEnergyBalanceToday } from '@/app/health/hooks/use-health-calcs'
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
  /** LB-176 — a read feeding these rows FAILED, as opposed to there being no goals set. */
  failed?: boolean
}

const GOALS_VIEW_KEY = 'ta_goals_progress_view'

export const GoalsProgressCard = memo(function GoalsProgressCard({ metaToday, weekToDate, userGoals, progressSummary, failed = false }: GoalsProgressCardProps) {
  const [view, setView] = useState<'today' | 'week'>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem(GOALS_VIEW_KEY) : null
      return (saved === 'week' ? 'week' : 'today') as 'today' | 'week'
    } catch { return 'today' }
  })

  // Mirrors state, so it must not PATCH on mount — this card renders inside Health's launch burst.
  usePersistedPreference('goalsProgressView', view)

  // #2071. The Calories row measures eating against the day's BUDGET — the one number every other
  // surface prints — not the typed `calorie_goal`, which is no longer shown as a budget anywhere.
  // Same cache key as Home and Nutrition, so this adds no request. The week view is the budget × 7,
  // as Home's nutrition card already does for a weekly user: there is no per-day budget history.
  const balance = useEnergyBalanceToday()?.balance ?? null
  const dayBudgetKcal = balance ? budgetProvenance(balance).total : null

  // Built per view, because the card has to know whether the OTHER view has anything (#2337 below).
  const rowsFor = (view: 'today' | 'week'): GoalRow[] => {
    const rows: GoalRow[] = []

    if (userGoals?.stepsGoal != null) {
      rows.push({
        key: 'Steps', icon: Footprints, color: '#22c55e', weekly: view === 'week',
        value: view === 'today' ? metaToday?.steps ?? null : weekToDate?.steps ?? null,
        goal: normalizeGoal(userGoals.stepsGoal, userGoals.stepsGoalType ?? 'daily', view),
      })
    }

    // Issue 2675. The row exists whenever the day has a budget — derived for everyone, the own target
    // when one is set (it is the budget then). A stored calorie goal is no longer a precondition.
    if (dayBudgetKcal != null) {
      rows.push({
        key: 'Calories', icon: Flame, color: '#f97316', weekly: view === 'week',
        value: view === 'today' ? metaToday?.calories ?? null : weekToDate?.calories ?? null,
        goal: view === 'today' ? dayBudgetKcal : dayBudgetKcal * 7,
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
      // #2337: `thisWeekHours` is null when no night this week recorded sleep, as `lastNightHours`
      // already was. A null value drops the row in `visibleRows` below rather than drawing "0 h"
      // against the goal; a payload cached before the change still carries its number.
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

    return rows.filter(r => r.value != null && r.goal != null && r.goal > 0)
  }

  const visibleRows = rowsFor(view)
  // #2337. A view can be empty while the other is not — a sleep goal with no night recorded this week
  // used to draw "0 h" and now has no row. Vanishing then would take the toggle with it, and the view
  // is persisted, so the card would stay gone. Keep the card and say the view is empty instead.
  const otherViewHasRows = rowsFor(view === 'today' ? 'week' : 'today').length > 0
  // LB-176. `return null` is right for an account with no goals set and wrong for a read that failed —
  // the card simply left the screen. A vanish is the other half of the same rule as a false "No data"
  // (RV-150): say which happened.
  if (visibleRows.length === 0 && !otherViewHasRows) {
    return failed
      ? <EmptyState title="Couldn't load your goals" />
      : null
  }

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
        {visibleRows.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nothing recorded {view === 'today' ? 'today' : 'this week'} yet.
          </p>
        )}
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
