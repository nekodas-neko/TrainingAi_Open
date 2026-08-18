'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@trainingai/shared/utils'
import { invalidateMealPlans } from '@/lib/cache-groups'
import { MEAL_COUNT_MIN, MEAL_COUNT_MAX } from '@trainingai/shared/nutrition/meal-split'
import type { MealPlan } from '@trainingai/shared/types/nutrition'

interface Props {
  plan: MealPlan | null
  onOpenChange: (open: boolean) => void
  /** Called with the updated plan, or null when it was deleted or deactivated. */
  onChanged: (plan: MealPlan | null) => void
  onRebuild: () => void
  /** Opens the per-meal editor — the answer to "I just want to swap one meal". */
  onEditMeals: () => void
}

/**
 * Everything that can be changed about a saved plan without asking the model for new food.
 *
 * Meals per day, training time and re-anchoring on the current calorie target are all pure
 * redistribution through `splitMacrosAcrossMeals` — the same function that built the plan — so they
 * apply instantly and deterministically. Only "Build a new plan" costs a generation.
 *
 * The sheet previously offered a rename and an active toggle and nothing else, which is what the
 * owner meant by "the manage button doesnt let you change much".
 */
export function MealPlanManageSheet({ plan, onOpenChange, onChanged, onRebuild, onEditMeals }: Props) {
  const [name, setName] = useState('')
  const [mealsPerDay, setMealsPerDay] = useState(3)
  const [trainingTime, setTrainingTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!plan) return
    setName(plan.name)
    setMealsPerDay(plan.mealsPerDay)
    setTrainingTime(plan.trainingTime ?? '')
    setConfirmDelete(false)
  }, [plan])

  if (!plan) return null

  const structureDirty =
    mealsPerDay !== plan.mealsPerDay || (trainingTime || null) !== (plan.trainingTime ?? null)

  async function patch(body: Record<string, unknown>, closeAfter: boolean) {
    setBusy(true)
    try {
      const res = await fetch(`/api/nutrition/meal-plans/${plan!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      const updated: MealPlan = await res.json()
      await invalidateMealPlans()
      // A deactivated plan is no longer "the active plan", so the section must drop it.
      onChanged(updated.isActive ? updated : null)
      if (closeAfter) onOpenChange(false)
    } catch {
      toast.error('Could not save that change')
    } finally {
      setBusy(false)
    }
  }

  /** Reshape the plan: meal count, training time, or re-anchor on the current calorie target. */
  async function restructure(body: Record<string, unknown>, successMessage: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/nutrition/meal-plans/${plan!.id}/structure`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'Could not update the plan')
        return
      }
      const { plan: updated, unnamedPositions } = await res.json() as {
        plan: MealPlan
        unnamedPositions: number[]
      }
      await invalidateMealPlans()
      onChanged(updated.isActive ? updated : null)
      toast.success(
        unnamedPositions.length > 0
          ? `${successMessage} — ${unnamedPositions.length} new ${unnamedPositions.length === 1 ? 'slot needs' : 'slots need'} a meal`
          : successMessage,
      )
    } catch {
      toast.error('Could not update the plan')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      const res = await fetch(`/api/nutrition/meal-plans/${plan!.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      await invalidateMealPlans()
      onChanged(null)
      onOpenChange(false)
      toast.success('Meal plan deleted')
    } catch {
      toast.error('Could not delete the plan')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={plan != null} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[88vh] flex flex-col">
        <SheetHeader>
          <SheetTitle>Manage plan</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5 scrollbar-hide">
          <div>
            <label htmlFor="plan-name" className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Name
            </label>
            <input
              id="plan-name"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full min-h-[48px] rounded-xl border border-border bg-muted/50 px-3 text-sm outline-none"
            />
          </div>

          <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Active</span>
              <span className="block text-[11px] text-muted-foreground">
                Turn off to keep the plan without it showing on Nutrition.
              </span>
            </span>
            <Switch
              checked={plan.isActive}
              disabled={busy}
              onCheckedChange={v => patch({ isActive: v }, true)}
              aria-label="Plan active"
            />
          </label>

          <div className="rounded-xl bg-muted/50 p-3 space-y-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                Meals per day
              </p>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: MEAL_COUNT_MAX - MEAL_COUNT_MIN + 1 }, (_, i) => MEAL_COUNT_MIN + i).map(n => (
                  <button
                    key={n}
                    onClick={() => setMealsPerDay(n)}
                    aria-pressed={n === mealsPerDay}
                    disabled={busy}
                    className={cn(
                      'min-h-[44px] min-w-[44px] rounded-xl border text-sm font-semibold transition-colors',
                      n === mealsPerDay
                        ? 'border-brand/50 bg-brand/15 text-brand'
                        : 'border-border bg-background/50 active:bg-muted/30',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="plan-training-time" className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                Training time
              </label>
              <div className="flex gap-2">
                <input
                  id="plan-training-time"
                  type="time"
                  value={trainingTime}
                  disabled={busy}
                  onChange={e => setTrainingTime(e.target.value)}
                  className="flex-1 min-h-[48px] rounded-xl border border-border bg-background/50 px-3 text-sm outline-none"
                />
                {trainingTime && (
                  <Button variant="ghost" className="min-h-[48px]" disabled={busy} onClick={() => setTrainingTime('')}>
                    Clear
                  </Button>
                )}
              </div>
            </div>

            <p className="text-[11px] leading-snug text-muted-foreground">
              Both of these re-split the same daily totals — no new food is invented. Your meal names
              carry over; extra slots come through unnamed until you rebuild.
            </p>

            <Button
              variant="secondary"
              className="w-full"
              disabled={busy || !structureDirty}
              onClick={() => restructure(
                { mealsPerDay, trainingTime: trainingTime || null },
                'Plan re-split',
              )}
            >
              {busy ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Working…</> : 'Apply re-split'}
            </Button>
          </div>

          <div className="rounded-xl bg-muted/50 p-3 space-y-2">
            <p className="text-sm font-medium">Calorie target</p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Built for {plan.targetCalories.toLocaleString()} kcal · {Math.round(plan.targetProteinG)}P ·{' '}
              {Math.round(plan.targetCarbsG)}C · {Math.round(plan.targetFatG)}F. Your target moves as the
              calibration learns, so this can fall behind.
            </p>
            <Button
              variant="secondary"
              className="w-full"
              disabled={busy}
              onClick={() => restructure({ retarget: true }, 'Plan updated to your current target')}
            >
              Update to my current target
            </Button>
          </div>

          <Button variant="secondary" className="w-full" onClick={onEditMeals} disabled={busy}>
            Edit meals
          </Button>

          <Button variant="secondary" className="w-full" onClick={onRebuild} disabled={busy}>
            Build a new plan
          </Button>

          {confirmDelete ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 space-y-2">
              <p className="text-sm font-medium">Delete “{plan.name}”?</p>
              <p className="text-[11px] leading-snug text-muted-foreground">
                This removes it from every device. Meals you saved to your library stay.
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="destructive" className="flex-1" onClick={remove} disabled={busy}>
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" className="w-full text-destructive" onClick={() => setConfirmDelete(true)} disabled={busy}>
              Delete plan
            </Button>
          )}
        </div>

        <SheetFooter className="flex-row gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)} disabled={busy}>
            Close
          </Button>
          <Button
            className="flex-1"
            disabled={busy || !name.trim() || name.trim() === plan.name}
            onClick={() => patch({ name: name.trim() }, true)}
          >
            Save name
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
