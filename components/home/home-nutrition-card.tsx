'use client'

import { useRouter, usePathname } from 'next/navigation'
import { navigateWithTransition } from '@/lib/navigate-with-transition'
import { cn, accentCardStyle } from '@trainingai/shared/utils'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'
import { ColorSwatchPicker } from '@/components/ui/color-swatch-picker'
import { HomeNutritionZoneBar } from '@/components/home/home-nutrition-zone-bar'
import { useEnergyBalanceToday } from '@/app/health/hooks/use-health-calcs'

interface Props {
  sectionEditMode: boolean
  color: string
  onColorChange: (key: string, hex: string) => void
  metaLoading: boolean
  calorieGoal: number | null
  calorieType: 'daily' | 'weekly'
  weekToDate: { steps: number; calories: number; waterMl: number } | null
  nutrCalories: number | null
  nutrProtein: number | null
  nutrCarbs: number | null
  nutrFat: number | null
}

/**
 * Home's nutrition card.
 *
 * Split out of `home-card-widget.tsx` (Q-415) so it can hold a hook of its own: the budget it
 * prints has to come from the same payload as the bar underneath it, and a hook cannot live in a
 * branch of that file's card switch. `useEnergyBalanceToday` shares one cache key with the bar and
 * with `HomeEnergyBalanceCard`, so `cachedFetch` de-dupes all three into a single request.
 *
 * **The budget is `budgetProvenance(...).total`, not `calorieGoal + activeEnergyKcalToday`.** Those
 * two expressions disagreed by 271 kcal on the owner's screen (Q-415): the card read
 * `1458 / 2447 kcal` with `1,629 base + 547 earned from movement` printed directly beneath it, and
 * 1,629 + 547 is 2,176. `nutrition_targets.calories` is the **rest-day floor**, which is not the
 * same quantity as `restingBase + targetNet` — adding movement to it produces a third number that
 * matches nothing else on the screen.
 */
export function HomeNutritionCard({
  sectionEditMode, color, onColorChange, metaLoading,
  calorieGoal, calorieType, weekToDate,
  nutrCalories, nutrProtein, nutrCarbs, nutrFat,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const balance = useEnergyBalanceToday()?.balance ?? null

  const nutrTotalG = (nutrProtein ?? 0) + (nutrCarbs ?? 0) + (nutrFat ?? 0)
  const proteinPct = nutrTotalG > 0 ? (nutrProtein ?? 0) / nutrTotalG : 0
  const carbsPct = nutrTotalG > 0 ? (nutrCarbs ?? 0) / nutrTotalG : 0

  // Falls back to the stored goal alone, never to a self-composed sum: without the payload there
  // is no measured movement to add, and inventing one is how the third budget appeared.
  const dailyBudget = balance ? budgetProvenance(balance).total : calorieGoal
  const isWeekly = calorieType === 'weekly'
  const goalDisplay = isWeekly && dailyBudget ? dailyBudget * 7 : dailyBudget
  const consumedDisplay = isWeekly ? (weekToDate?.calories ?? 0) : nutrCalories
  const ringMask = 'radial-gradient(farthest-side, transparent 60%, black 61%)'

  return (
    <div className="px-4 pb-3 relative">
      {sectionEditMode && (
        <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker value={color} label="Nutrition card" onChange={hex => onColorChange('nutritionDonut', hex)} />
        </div>
      )}
      <div
        role="button"
        tabIndex={0}
        onClick={() => { if (!sectionEditMode) navigateWithTransition(router, pathname, '/nutrition') }}
        className={cn('w-full rounded-2xl p-4 flex items-center gap-4 text-left active:scale-95 transition cursor-pointer', sectionEditMode && 'pointer-events-none')}
        style={accentCardStyle(color)}
      >
        <div className="relative flex-none w-[58px] h-[58px]">
          <div className="absolute inset-0 rounded-full" style={{
            background: nutrTotalG > 0
              ? `conic-gradient(from -90deg, ${MACRO_COLORS.protein} 0deg ${(proteinPct * 360).toFixed(1)}deg, ${MACRO_COLORS.carbs} ${(proteinPct * 360).toFixed(1)}deg ${((proteinPct + carbsPct) * 360).toFixed(1)}deg, ${MACRO_COLORS.fat} ${((proteinPct + carbsPct) * 360).toFixed(1)}deg 360deg)`
              : 'var(--border)',
            WebkitMask: ringMask,
            mask: ringMask,
          }} />
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[9px] font-extrabold leading-none">{metaLoading ? '…' : nutrCalories != null ? nutrCalories : '—'}</span>
            <span className="text-[7px] leading-none" style={{ opacity: 0.4 }}>kcal</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between mb-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Nutrition{isWeekly ? ' (week)' : ''}</p>
            {goalDisplay && <p className="text-xs text-muted-foreground">{consumedDisplay ?? 0} / {goalDisplay} kcal</p>}
          </div>
          {/* Q-401: the gradient progress fill that used to be here measured "how full is the
              tank" against a fixed target. The zone bar measures "am I on target" against a
              budget that rises with what you burned, which is the number the rest of the app
              now uses. Same component as the Nutrition tab's, so the two cannot drift. */}
          <HomeNutritionZoneBar />
          <div className="space-y-0.5">
            {[
              { color: MACRO_COLORS.protein, label: 'Protein', value: nutrProtein },
              { color: MACRO_COLORS.carbs, label: 'Carbs', value: nutrCarbs },
              { color: MACRO_COLORS.fat, label: 'Fat', value: nutrFat },
            ].map(m => (
              <div key={m.label} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: m.color }} />
                <p className="text-[10px] text-muted-foreground flex-1">{m.label}</p>
                <p className="text-[10px] font-bold" style={{ color: m.color }}>{m.value != null ? `${m.value}g` : metaLoading ? '…' : '—'}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
