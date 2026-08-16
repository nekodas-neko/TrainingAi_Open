'use client'

import { memo, useState } from 'react'
import { Info } from 'lucide-react'
import { barBands, barPosition } from '@trainingai/shared/nutrition/calorie-balance'
import type { EnergyBalanceResponse } from '@/app/api/nutrition/energy-balance/route'

interface Props {
  data: EnergyBalanceResponse | null
  /** False for a past date — the zone reads as a verdict rather than a running total. */
  isToday: boolean
  loading?: boolean
}

const BANDS = barBands()

/**
 * Calories in vs calories out, banded against the user's goal.
 *
 * The headline is `remaining` — kcal still to eat to land on the goal's target net — because
 * that is the only number that is actionable at any hour. The zone label is qualified with
 * "so far" on the current day: at 8am everybody is legitimately "well under", and presenting
 * that as a verdict would train the user to ignore the bar.
 */
export const CalorieBalanceBar = memo(function CalorieBalanceBar({ data, isToday, loading }: Props) {
  const [showInfo, setShowInfo] = useState(false)

  if (loading && data == null) {
    return <div className="h-40 rounded-2xl bg-muted/50 animate-pulse" aria-label="Loading energy balance" aria-busy="true" />
  }
  if (data == null) return null

  if (data.balance == null) {
    return (
      <div className="rounded-2xl border border-border bg-muted/60 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Energy Balance</p>
        <p className="text-sm text-muted-foreground">
          Add your {data.missingProfileFields.join(', ')} in Profile to see calories in vs out.
        </p>
      </div>
    )
  }

  const b = data.balance
  const m = data.maintenance
  const pos = barPosition(b.deviationKcal)
  const overTarget = b.remainingKcal < 0

  return (
    <div className="rounded-2xl border border-border bg-muted/60 p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Energy Balance</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums leading-none" style={{ color: b.zoneColor }}>
            {Math.abs(b.remainingKcal).toLocaleString()}
            <span className="text-xs font-normal ml-1.5 text-muted-foreground">
              kcal {overTarget ? 'over target' : 'left today'}
            </span>
          </p>
          <p className="mt-1 text-[11px] font-semibold" style={{ color: b.zoneColor }}>
            {b.zoneLabel}{isToday ? ' so far' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowInfo(v => !v)}
          aria-label="How energy balance is calculated"
          aria-expanded={showInfo}
          className="p-2.5 -m-1 rounded-full text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Five-band scale. Bands are decorative; the reading is the marker plus the label above. */}
      <div className="relative h-3 rounded-full overflow-hidden flex" role="presentation">
        {BANDS.map(band => (
          <div key={band.zone} style={{ width: `${band.widthPct}%`, backgroundColor: band.color, opacity: 0.35 }} />
        ))}
        <div
          className="absolute top-0 bottom-0 w-1 rounded-full transition-[left] duration-500 ease-out motion-reduce:transition-none"
          style={{ left: `calc(${pos * 100}% - 2px)`, backgroundColor: b.zoneColor, boxShadow: '0 0 0 2px var(--background)' }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] uppercase tracking-wide text-muted-foreground/70">
        <span>Under-eating</span>
        <span>On target</span>
        <span>Over-eating</span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Eaten" value={b.intakeKcal} />
        <Stat label="Burned" value={b.expenditureKcal} />
        <Stat label="Net" value={b.netKcal} signed />
      </div>

      {m != null && (
        <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
          {m.source === 'calibrated' ? (
            <>
              Your measured maintenance is <span className="font-semibold text-foreground tabular-nums">{m.kcal.toLocaleString()} kcal</span>
              {' '}({m.confidence} confidence, {m.daysLogged} of {m.daysInWindow} days logged)
              {m.weightRateKgPerWeek != null && m.weightRateKgPerWeek !== 0 && (
                <> — trending {m.weightRateKgPerWeek > 0 ? '+' : ''}{m.weightRateKgPerWeek} kg/week</>
              )}.
            </>
          ) : (
            <>Estimated maintenance <span className="font-semibold text-foreground tabular-nums">{m.kcal.toLocaleString()} kcal</span> — {m.gapMessage}.</>
          )}
        </p>
      )}

      {showInfo && (
        <div className="mt-3 rounded-xl bg-muted/50 p-3 space-y-2">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Calories out</span> = your resting burn
            ({b.restingBaseKcal.toLocaleString()} kcal) plus measured movement ({b.activeKcal.toLocaleString()} kcal
            from workouts, activities and steps above a baseline).
          </p>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">On target</span> means your net
            ({b.netKcal >= 0 ? '+' : ''}{b.netKcal.toLocaleString()}) is within 150 kcal of the
            {' '}{b.targetNetKcal >= 0 ? '+' : ''}{b.targetNetKcal.toLocaleString()} kcal/day your goal calls for.
            Sustaining today&apos;s net works out to {b.projectedWeeklyKg >= 0 ? '+' : ''}{b.projectedWeeklyKg} kg/week.
          </p>
          {m?.source === 'calibrated' && (
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Maintenance is measured from your own logged intake against your weight trend, not a
              formula — it re-calibrates as you log.
            </p>
          )}
        </div>
      )}
    </div>
  )
})

function Stat({ label, value, signed }: { label: string; value: number; signed?: boolean }) {
  return (
    <div className="rounded-xl bg-muted/40 py-2">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">
        {signed && value >= 0 ? '+' : ''}{value.toLocaleString()}
      </p>
    </div>
  )
}
