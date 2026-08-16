'use client'

import { barBands, barPosition } from '@trainingai/shared/nutrition/calorie-balance'
import { useEnergyBalanceToday } from '@/app/health/hooks/use-health-calcs'

const BANDS = barBands()

/**
 * Home's compact calories-in-vs-out card. Same shared banding and the same server payload as the
 * full bar on Nutrition and Health — this is a denser presentation of one number, not a second
 * calculation. Reads through `useEnergyBalanceToday`, which cache-seeds synchronously, so a
 * revisit paints last-known figures rather than a skeleton.
 */
export function HomeEnergyBalanceCard() {
  const data = useEnergyBalanceToday()

  if (data == null) {
    return (
      <div className="p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Energy Balance</p>
        <div className="h-10 rounded-lg bg-muted/50 animate-pulse" aria-label="Loading energy balance" aria-busy="true" />
      </div>
    )
  }

  if (data.balance == null) {
    return (
      <div className="p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Energy Balance</p>
        <p className="text-sm text-muted-foreground">Add your {data.missingProfileFields.join(', ')} in Profile.</p>
      </div>
    )
  }

  const b = data.balance
  const pos = barPosition(b.deviationKcal)
  const over = b.remainingKcal < 0

  return (
    <div className="p-4">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Energy Balance</p>
        <p className="text-[11px] font-semibold" style={{ color: b.zoneColor }}>{b.zoneLabel}</p>
      </div>

      <p className="text-2xl font-bold tabular-nums leading-none mb-2.5" style={{ color: b.zoneColor }}>
        {Math.abs(b.remainingKcal).toLocaleString()}
        <span className="text-xs font-normal ml-1.5 text-muted-foreground">
          kcal {over ? 'over target' : 'left today'}
        </span>
      </p>

      <div className="relative h-2 rounded-full overflow-hidden flex" role="presentation">
        {BANDS.map(band => (
          <div key={band.zone} style={{ width: `${band.widthPct}%`, backgroundColor: band.color, opacity: 0.35 }} />
        ))}
        <div
          className="absolute top-0 bottom-0 w-1 rounded-full transition-[left] duration-500 ease-out motion-reduce:transition-none"
          style={{ left: `calc(${pos * 100}% - 2px)`, backgroundColor: b.zoneColor, boxShadow: '0 0 0 2px var(--background)' }}
        />
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground tabular-nums">
        {b.intakeKcal.toLocaleString()} eaten · {b.expenditureKcal.toLocaleString()} burned
        {data.maintenance?.source === 'calibrated' && <> · {data.maintenance.kcal.toLocaleString()} maintenance</>}
      </p>
    </div>
  )
}
