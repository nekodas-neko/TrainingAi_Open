'use client'

import { memo } from 'react'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'
import { useEnergyBalanceToday } from '@/app/health/hooks/use-health-calcs'
import { CalorieProgressBar } from '@/components/nutrition/calorie-progress-bar'

/**
 * Home's nutrition card (Q-415, Q-323).
 *
 * **The budget is the route's, never this card's.** It used to render
 * `users.calorie_goal + activeEnergyKcalToday` while the Energy Balance card two rows below rendered
 * `restingBase + targetNet + activeKcal` — 2,447 against 2,176 on the same screen, with the card's
 * own subtitle printing the second figure directly under the first. Q-401 retired that second TDEE
 * model everywhere except here. The stored goal keeps its job as the rest-day floor the derived
 * baseline is built from; it is simply not the number to show.
 *
 * Self-fetching through `useEnergyBalanceToday` rather than threaded through the Home orchestrator,
 * matching `HomeEnergyBalanceCard` beside it: the payload is this card's alone, both share one cache
 * key so `cachedFetch` de-dupes them into a single request, and the hook is on `useCachedValue` so an
 * invalidation repaints it (Q-402 — the bug that made this card need an app restart).
 *
 * **With no balance the ring falls back to composition rather than to a wrong budget.** A profile
 * missing its height or weight has no derived baseline to render, and the stored goal is not a
 * stand-in for one — that substitution is the defect.
 */
export const HomeNutritionCard = memo(function HomeNutritionCard({
  metaLoading, proteinG, carbsG, fatG, caloriesToday, weeklyCalories, isWeekly,
}: {
  metaLoading: boolean
  proteinG: number | null
  carbsG: number | null
  fatG: number | null
  caloriesToday: number | null
  weeklyCalories: number | null
  isWeekly: boolean
}) {
  const balance = useEnergyBalanceToday()?.balance ?? null
  const budget = balance
    ? budgetProvenance({
        restingBaseKcal: balance.restingBaseKcal,
        activeKcal: balance.activeKcal,
        targetNetKcal: balance.targetNetKcal,
      }).total
    : null

  const totalG = (proteinG ?? 0) + (carbsG ?? 0) + (fatG ?? 0)
  const proteinPct = totalG > 0 ? (proteinG ?? 0) / totalG : 0
  const carbsPct = totalG > 0 ? (carbsG ?? 0) / totalG : 0

  // The ring is always today's food, even when the header is framed weekly — a week's macro
  // composition is not what a 58px donut can say, and the header carries the weekly figure.
  //
  // Eaten comes from the SAME payload as the budget whenever there is one. Taking the budget from
  // `energy-balance` and the intake from `body-metadata` would put two independently-refreshed
  // numbers into one fraction, which is a smaller version of the defect this card is being fixed
  // for. The macro grams below still come from `body-metadata`; they are not part of this sum.
  const eaten = balance?.intakeKcal ?? caloriesToday ?? 0
  // Q-323: the coloured arc sweeps to `eaten / budget` and the remainder stays grey, so the same
  // ring answers "what did I eat" and "how much is left". Without a budget there is nothing to be
  // a share of, and it goes back to the full-circle composition it has always drawn.
  const sweep = budget != null ? Math.max(0, Math.min(1, eaten / budget)) : 1
  const remaining = budget != null ? budget - eaten : null

  const headerConsumed = isWeekly ? (weeklyCalories ?? 0) : (balance ? Math.round(eaten) : caloriesToday)
  const headerBudget = budget != null ? (isWeekly ? budget * 7 : budget) : null

  const arc = (frac: number) => (frac * sweep * 360).toFixed(1)
  const ringMask = 'radial-gradient(farthest-side, transparent 60%, black 61%)'

  return (
    <div className="flex items-center gap-4">
      <div className="relative flex-none w-[58px] h-[58px]">
        <div className="absolute inset-0 rounded-full" style={{
          background: totalG > 0
            ? `conic-gradient(from -90deg, ${MACRO_COLORS.protein} 0deg ${arc(proteinPct)}deg, ${MACRO_COLORS.carbs} ${arc(proteinPct)}deg ${arc(proteinPct + carbsPct)}deg, ${MACRO_COLORS.fat} ${arc(proteinPct + carbsPct)}deg ${(sweep * 360).toFixed(1)}deg, var(--border) ${(sweep * 360).toFixed(1)}deg 360deg)`
            : 'var(--border)',
          WebkitMask: ringMask,
          mask: ringMask,
        }} />
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {metaLoading ? (
            <span className="text-[9px] font-extrabold leading-none">…</span>
          ) : remaining != null ? (
            <>
              <span className="text-[9px] font-extrabold leading-none tabular-nums">{Math.abs(Math.round(remaining)).toLocaleString()}</span>
              <span className="text-[7px] leading-none" style={{ opacity: 0.4 }}>{remaining >= 0 ? 'left' : 'over'}</span>
            </>
          ) : (
            <>
              <span className="text-[9px] font-extrabold leading-none tabular-nums">{caloriesToday ?? '—'}</span>
              <span className="text-[7px] leading-none" style={{ opacity: 0.4 }}>kcal</span>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between mb-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Nutrition{isWeekly ? ' (week)' : ''}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {(headerConsumed ?? 0).toLocaleString()}{headerBudget != null ? ` / ${headerBudget.toLocaleString()}` : ''} kcal
          </p>
        </div>

        {balance && (
          <div className="mb-1.5">
            <CalorieProgressBar
              compact
              deviationKcal={balance.deviationKcal}
              restingBaseKcal={balance.restingBaseKcal}
              activeKcal={balance.activeKcal}
              targetNetKcal={balance.targetNetKcal}
            />
          </div>
        )}

        <div className="space-y-0.5">
          {[
            { color: MACRO_COLORS.protein, label: 'Protein', value: proteinG },
            { color: MACRO_COLORS.carbs, label: 'Carbs', value: carbsG },
            { color: MACRO_COLORS.fat, label: 'Fat', value: fatG },
          ].map(m => (
            <div key={m.label} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: m.color }} />
              <p className="text-[10px] text-muted-foreground flex-1">{m.label}</p>
              <p className="text-[10px] font-bold tabular-nums" style={{ color: m.color }}>{m.value != null ? `${m.value}g` : metaLoading ? '…' : '—'}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})
