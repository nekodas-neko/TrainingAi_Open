'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CalorieProgressBar } from '@/components/nutrition/calorie-progress-bar'
import { useEnergyBalanceToday } from '@/app/health/hooks/use-health-calcs'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'
import { GOAL_RATE_PCT_PER_WEEK } from '@trainingai/shared/nutrition/calorie-budget'
import { ownCalorieTargetReason } from '@trainingai/shared/validation/plausibility'
import type { FitnessGoal } from '@trainingai/shared/types/user'

/**
 * Profile → Goals → the day's calorie budget (issue 2622).
 *
 * Replaces the typed "Calorie Goal" box, its Daily/Weekly switch and the "Recommended … Use" line.
 * The default is a read-only line: today's budget and the terms it is made of, straight from the one
 * budget function (`budgetProvenance` → `calorieBudget`), so the rows here add up to the figure on
 * Nutrition and Home. "Set my own target instead" opens a number field; while one is set it IS the
 * budget everywhere (the function returns `ownTarget ?? derived`) and this card says so, plus what
 * the worked-out budget would be.
 *
 * Nothing here computes calories. The numbers are read, never derived, so this screen cannot show a
 * second one.
 */

const DEFICIT_NAME: Record<FitnessGoal, string> = {
  lose_weight: 'Weight-loss deficit',
  recomp: 'Recomp deficit',
  build_muscle: 'Muscle-gain surplus',
  maintain: 'Goal deficit',
}

function ratePct(goal: FitnessGoal): string {
  return String(Math.abs(GOAL_RATE_PCT_PER_WEEK[goal]) * 100)
}

function signed(n: number): string {
  return `${n < 0 ? '−' : '+'}${Math.abs(n).toLocaleString()}`
}

interface CalorieBudgetSectionProps {
  /** The stored own target (`calorie_goal` flagged 'own'), or null while the worked-out budget rules. */
  ownTargetKcal: number | null
  /** Resolves null on success, or the message to show under the field. */
  onSetOwnTarget: (kcal: number) => Promise<string | null>
  /** Resolves null on success, or a message. */
  onClearOwnTarget: () => Promise<string | null>
}

export function CalorieBudgetSection({ ownTargetKcal, onSetOwnTarget, onClearOwnTarget }: CalorieBudgetSectionProps) {
  const data = useEnergyBalanceToday()
  const balance = data?.balance ?? null
  const budget = balance ? budgetProvenance(balance) : null

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const hasOwn = ownTargetKcal != null
  const showField = hasOwn || editing
  // The own value being shown wins over a stale payload until the energy-balance refetch lands, so
  // the line never reads one number while the field above it holds another.
  const shownTotal = hasOwn ? ownTargetKcal : budget?.total ?? null
  const workedOut = budget?.ownTarget ? budget.workedOutTotal : null
  const chain = budget?.chain ?? null

  async function save() {
    const trimmed = (draft ?? (hasOwn ? String(ownTargetKcal) : '')).trim()
    const n = Number(trimmed)
    const reason = trimmed === '' ? 'Enter your daily target in kcal.' : ownCalorieTargetReason(n)
    if (reason) { setError(reason); return }
    setBusy(true)
    setError(null)
    const failure = await onSetOwnTarget(n)
    setBusy(false)
    if (failure) { setError(failure); return }
    setEditing(false)
    setDraft(null)
  }

  async function clear() {
    setBusy(true)
    setError(null)
    const failure = await onClearOwnTarget()
    setBusy(false)
    if (failure) { setError(failure); return }
    setEditing(false)
    setDraft(null)
  }

  return (
    <div className="px-4 py-3 space-y-2" data-testid="calorie-budget-section">
      <p className="text-xs font-medium text-muted-foreground">Calorie budget today</p>

      {shownTotal == null ? (
        <p className="text-xs text-muted-foreground">
          Add your weight, height, birth year and sex to see your budget.
        </p>
      ) : (
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold tabular-nums" data-testid="calorie-budget-total">{shownTotal.toLocaleString()}</span>
          <span className="text-xs text-muted-foreground">
            kcal · {hasOwn ? 'your own target' : 'worked out, not typed'}
          </span>
        </div>
      )}

      {!hasOwn && chain != null && budget != null && (
        <>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[13px] tabular-nums">
            <dt className="text-muted-foreground">Resting rate</dt>
            <dd className="text-right font-semibold">{chain.rmr.toLocaleString()}</dd>
            <dt className="text-muted-foreground">
              {DEFICIT_NAME[(data?.goal ?? 'maintain') as FitnessGoal]}
              {chain.deficit !== 0 && data?.goal != null ? ` (${ratePct(data.goal)}% a week)` : ''}
            </dt>
            <dd className="text-right font-semibold">{signed(-chain.deficit)}</dd>
            <dt className="text-muted-foreground">Everyday burn (20%)</dt>
            <dd className="text-right font-semibold">{signed(chain.dailyLiving)}</dd>
            <dt className="text-muted-foreground">Movement today</dt>
            <dd className="text-right font-semibold">{signed(chain.movement)}</dd>
            <dt className="mt-1 border-t border-border pt-1">Budget</dt>
            <dd className="mt-1 border-t border-border pt-1 text-right font-semibold">{budget.total.toLocaleString()}</dd>
          </dl>
          {chain.totalFloored && (
            <p className="text-xs text-muted-foreground">
              The terms above come to less than the floor, so the budget is held at it: never below your resting rate or 1,200.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            It changes with your goal and goal weight above, and with how much you move. Meal plans are sized to it.
          </p>
        </>
      )}

      {shownTotal != null && balance != null && (
        <div>
          <CalorieProgressBar intakeKcal={balance.intakeKcal} budgetKcal={shownTotal} />
          <div className="mt-1 flex justify-between text-xs tabular-nums text-muted-foreground">
            <span>Today {balance.intakeKcal.toLocaleString()} kcal</span>
            <span>of {shownTotal.toLocaleString()}</span>
          </div>
        </div>
      )}

      {showField && (
        <div className="space-y-2">
          <Label htmlFor="goals-ownCalorieTarget" className="text-xs text-muted-foreground">Your own target (kcal per day)</Label>
          <div className="flex items-start gap-2">
            <Input
              id="goals-ownCalorieTarget"
              type="number" inputMode="numeric" enterKeyHint="done"
              value={draft ?? (hasOwn ? String(ownTargetKcal) : '')}
              onChange={e => { setDraft(e.target.value); setError(null) }}
              onKeyDown={e => { if (e.key === 'Enter') void save() }}
              placeholder="kcal per day"
              aria-invalid={error != null}
              aria-describedby={error ? 'goals-ownCalorieTarget-error' : undefined}
              className="border-border bg-muted/60 text-sm font-medium"
            />
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="tap-target-44 shrink-0 rounded-lg bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50"
            >
              Save
            </button>
          </div>
          {error && (
            <p id="goals-ownCalorieTarget-error" role="alert" className="text-xs text-destructive">{error}</p>
          )}
        </div>
      )}

      {hasOwn ? (
        <p className="text-xs text-muted-foreground">
          {workedOut != null && <>Worked-out budget today would be {workedOut.toLocaleString()}. </>}
          Your target replaces it everywhere: Nutrition, Home, meal plans and the coach.{' '}
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy}
            className="tap-target-44 inline-flex items-center font-semibold text-sky-400 underline-offset-2 disabled:opacity-50"
          >
            Use the worked-out budget
          </button>
        </p>
      ) : editing ? (
        <button
          type="button"
          onClick={() => { setEditing(false); setDraft(null); setError(null) }}
          className="tap-target-44 inline-flex items-center text-xs font-semibold text-sky-400"
        >
          Cancel
        </button>
      ) : (
        <button
          type="button"
          onClick={() => { setEditing(true); setDraft(budget ? String(budget.total) : '') }}
          className="tap-target-44 inline-flex items-center text-xs font-semibold text-sky-400"
        >
          Set my own target instead
        </button>
      )}
    </div>
  )
}
