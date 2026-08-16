'use client'

import { BatteryMediumIcon } from 'lucide-react'
import type { NutritionTargets } from '@trainingai/shared/types/nutrition'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'
import { bodyBatteryColor, type BodyBatteryLabel } from '@trainingai/shared/health/body-battery-band'

interface Props {
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number }
  targets: NutritionTargets | null
  battery: { current: number; label: BodyBatteryLabel; trend: string; drained: number } | null
}

export function DaySummaryCard({ totals, targets, battery }: Props) {
  const calTarget = targets?.calories ?? 2000
  const remaining = Math.max(0, calTarget - totals.calories)
  const calPct = Math.min(100, Math.round((totals.calories / calTarget) * 100))

  return (
    <div className="rounded-2xl bg-muted/40 border border-border px-4 py-4 flex flex-col gap-3.5">
      {/* Calories bar */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold tabular-nums">
            {Math.round(totals.calories)}
            <span className="text-muted-foreground font-normal"> / {Math.round(calTarget)} kcal</span>
          </span>
          <span className="text-xs font-semibold tabular-nums text-muted-foreground">
            {remaining > 0 ? `${remaining} left` : 'Goal reached'}
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-muted/60 overflow-hidden">
          <div
            className="h-full w-full rounded-full origin-left transition-transform duration-300 motion-reduce:transition-none"
            style={{ transform: `scaleX(${calPct / 100})`, background: 'var(--color-brand)' }}
          />
        </div>
      </div>

      {/* Macro totals */}
      <div className="flex items-center gap-4">
        <MacroStat label="Protein" value={totals.proteinG} target={targets?.proteinG} color={MACRO_COLORS.protein} />
        <MacroStat label="Carbs" value={totals.carbsG} target={targets?.carbsG} color={MACRO_COLORS.carbs} />
        <MacroStat label="Fat" value={totals.fatG} target={targets?.fatG} color={MACRO_COLORS.fat} />
      </div>

      {/* Body Battery pill */}
      {battery && (
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2 self-start"
          style={{
            background: `color-mix(in oklch, ${bodyBatteryColor(battery.label)} 14%, transparent)`,
            border: `1px solid ${bodyBatteryColor(battery.label)}`,
          }}
        >
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: bodyBatteryColor(battery.label) }}>
            <BatteryMediumIcon className="w-3 h-3" /> {battery.label}
          </span>
          <span className="text-base font-bold tabular-nums leading-none" style={{ color: bodyBatteryColor(battery.label) }}>
            {battery.current}
          </span>
          {battery.drained > 0 && (
            <span className="text-[11px] font-semibold tabular-nums text-destructive">down {battery.drained}</span>
          )}
        </div>
      )}
    </div>
  )
}

function MacroStat({ label, value, target, color }: { label: string; value: number; target?: number; color: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className="text-sm font-semibold tabular-nums">
        {Math.round(value)}
        {target != null && <span className="text-muted-foreground font-normal">/{Math.round(target)}</span>}g
      </span>
    </div>
  )
}
