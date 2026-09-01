'use client'

import { memo, useState } from 'react'
import { Info } from 'lucide-react'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'
import type { NutritionTargets } from '@trainingai/shared/types/nutrition'
import type { EnergyBalanceResponse } from '@/app/api/nutrition/energy-balance/route'
import { CalorieZoneBar } from './calorie-zone-bar'
import { STEP_BASELINE } from './movement-breakdown'
import { macroShares } from './macro-energy'

interface Props {
  data: EnergyBalanceResponse | null
  /** False for a past date — the zone reads as a verdict rather than a running total. */
  isToday: boolean
  loading?: boolean
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  /** The day's calorie budget, already resolved by the caller — `budgetProvenance(...).total` when
   *  there is a balance, the stored goal otherwise. **Never re-derived here.** The screen computes
   *  it once and its comment says why: composing a budget locally is what produced a third one. */
  goalCalories: number | null
  /** The `earned` term inside that same budget — the movement addend, from the same call. */
  earnedKcal: number | null
  /** The **effective** targets: the caller has already substituted the burn-aware calorie budget and
   *  Q-323's earned-scaled macro grams. Passing the raw stored targets would report fat over on a
   *  day with 551 kcal earned when it was well under. */
  targets: NutritionTargets | null
}

/** The ring's own hole, as a mask — a conic gradient with a transparent centre, not an SVG stroke.
 *  Samsung's WebView compositor is unreliable with animated `stroke-dashoffset`. */
const RING_MASK = 'radial-gradient(farthest-side, transparent 69%, black 70% 89%, transparent 90%)'

/**
 * Artboard 1's energy block: one card, the donut left, the numbers right (BF-24 ②).
 *
 * **This merges what were two rows of one grouped section**, `CalorieBalanceBar` and `MacroRing`.
 * Q-395b had already made them one section because a gap between them read as two unrelated cards;
 * the drawing takes the next step and makes them one card.
 *
 * **It takes every number from the caller and derives none of them.** That is the whole discipline
 * here, and it is not caution — three separate findings put it there. Q-401 found two budgets on one
 * screen 274 kcal apart, both labelled "left"; Q-417 found a third appear the moment a screen
 * composed `targets.calories + activeEnergy` locally instead of reading the payload; Q-323 found the
 * ring reporting fat *over* on a 551-kcal-earned day because it drew the base macro targets rather
 * than the earned-scaled ones. `nutrition-content.tsx` resolves all of it once, and this card
 * receives the result. A `budgetProvenance` call in here would be the fourth number.
 *
 * So: the donut fills against `goalCalories`, the headline is that budget's remainder, and
 * `+N burned` is the `earned` term inside the same budget. They cannot disagree, because they are
 * one quantity seen three ways.
 *
 * With no balance to compute — a past day, or a profile missing the fields the estimate needs — the
 * caller passes the stored goal instead, and the card says which it is rather than showing a
 * confident number built from a default.
 */
export const EnergyCard = memo(function EnergyCard({
  data, isToday, loading, calories, proteinG, carbsG, fatG, goalCalories, earnedKcal, targets,
}: Props) {
  const [showInfo, setShowInfo] = useState(false)

  if (loading && data == null) {
    return <div className="h-52 rounded-2xl bg-muted/50 animate-pulse" aria-label="Loading energy" aria-busy="true" />
  }

  const b = data?.balance ?? null
  // `b` can only be non-null when `data` is, but that is not a narrowing tsc can follow through the
  // optional chain — the file already reaches for `data!` two lines below for the same reason.
  const breakdown = data?.activeBreakdown ?? null

  // The denominator the donut fills against, and the number beside it. `remainingKcal` is the
  // shared, tested subtraction; where there is no balance the caller's goal is all there is, so the
  // arithmetic is done here rather than left blank.
  const goal = goalCalories
  const remaining = b ? b.remainingKcal : goal != null ? Math.round(goal - calories) : null
  const overTarget = remaining != null && remaining < 0

  const shares = macroShares({ proteinG, carbsG, fatG })
  const pct = goal != null && goal > 0 ? Math.min(100, (calories / goal) * 100) : 0
  const sweep = pct * 3.6
  const proteinEnd = shares.protein * sweep
  const carbsEnd = proteinEnd + shares.carbs * sweep
  // Degrees accumulate rather than each segment being placed independently, so rounding cannot open
  // a hairline gap between two colours.
  // No `from` clause: CSS `conic-gradient` already starts at 12 o'clock (0deg is the top).
  // The `from -90deg` this used to carry is the SVG/canvas idiom, where 0° is at 3 o'clock and
  // you subtract 90° to reach the top — carried into CSS it rotated the ring a quarter turn
  // counter-clockwise, so it started at 9 o'clock (BF-45 ④). Home's ring had it too.
  const arc = sweep > 0 && shares.protein + shares.carbs + shares.fat > 0
    ? `conic-gradient(`
      + ` ${MACRO_COLORS.protein} 0deg ${proteinEnd}deg,`
      + ` ${MACRO_COLORS.carbs} ${proteinEnd}deg ${carbsEnd}deg,`
      + ` ${MACRO_COLORS.fat} ${carbsEnd}deg ${sweep}deg,`
      + ` transparent ${sweep}deg)`
    // Calories logged but no macros: the goal-progress arc is still true, so it draws in brand
    // rather than vanishing.
    : sweep > 0
      ? `conic-gradient(var(--brand) ${sweep}deg, transparent ${sweep}deg)`
      : 'transparent'

  return (
    <div className="rounded-2xl border border-border bg-muted/60 p-3.5">
      <div className="flex items-center gap-4">
        <div className="relative flex-none" style={{ height: 104, width: 104 }}>
          <div
            className="absolute inset-0 rounded-full text-muted-foreground/30"
            style={{ background: 'currentColor', WebkitMask: RING_MASK, mask: RING_MASK }}
          />
          <div
            className="absolute inset-0 rounded-full"
            style={{ background: arc, WebkitMask: RING_MASK, mask: RING_MASK }}
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-px">
            <span className="text-[22px] font-bold leading-none tracking-tight tabular-nums">
              {Math.round(calories).toLocaleString()}
            </span>
            <span className="text-[9.5px] uppercase tracking-wider text-muted-foreground">
              {goal != null ? `of ${Math.round(goal).toLocaleString()}` : 'kcal'}
            </span>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex items-baseline gap-1.5">
            {remaining != null ? (
              <>
                {/* Plain foreground, not the zone colour, and the artboard agrees. `CalorieBalanceBar`
                    coloured this number by band, which paints the headline red at 10 am for a day
                    that is legitimately "well under so far" — the qualifier its own comment says is
                    there so the bar is not read as a verdict. The verdict keeps the colour, on the
                    label below where it is qualified. */}
                <span className="text-lg font-bold tabular-nums">
                  {Math.abs(remaining).toLocaleString()}
                </span>
                <span className="text-[11.5px] text-muted-foreground">
                  kcal {overTarget ? 'over' : 'left'}
                </span>
              </>
            ) : (
              <span className="text-[11.5px] text-muted-foreground">Set a calorie goal to see what&apos;s left</span>
            )}
            <span className="flex-1" />
            {earnedKcal != null && earnedKcal > 0 && (
              // The same addend the zone bar names, taken from the same call, so the ring and the
              // bar below cannot disagree about it.
              <span className="text-[11px] tabular-nums text-muted-foreground">
                +{Math.round(earnedKcal).toLocaleString()} burned
              </span>
            )}
          </div>

          <div className="flex gap-1">
            <MacroColumn label="Protein" grams={proteinG} target={targets?.proteinG ?? null} share={shares.protein} color={MACRO_COLORS.protein} />
            <MacroColumn label="Carbs"   grams={carbsG}   target={targets?.carbsG   ?? null} share={shares.carbs}   color={MACRO_COLORS.carbs} />
            <MacroColumn label="Fat"     grams={fatG}     target={targets?.fatG     ?? null} share={shares.fat}     color={MACRO_COLORS.fat} />
          </div>
        </div>
      </div>

      {/* Below the drawing, inside the same card. Artboard 1 stops at the two rows above, but the
          band is the only thing that says whether "left" is on track or merely arithmetic — and
          BF-28's rule is that a screen may carry more than its artboard, so long as the entry says
          where the extra went. It went here rather than to a second card, because a second card is
          what Q-395b already found reads as two unrelated things. */}
      {b != null && (
        <div className="mt-3.5 border-t border-border/50 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold" style={{ color: b.zoneColor }}>
              {b.zoneLabel}{isToday ? ' so far' : ''}
            </p>
            <button
              type="button"
              onClick={() => setShowInfo(v => !v)}
              aria-label="How energy balance is calculated"
              aria-expanded={showInfo}
              className="-m-1 rounded-full p-2.5 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* The bar lives in `CalorieZoneBar` so Home's nutrition card draws the identical thing
              (Q-401). Two hand-maintained copies of this scale is the drift class that put two
              different calorie budgets on one screen. */}
          <CalorieZoneBar
            intakeKcal={b.intakeKcal}
            restingBaseKcal={b.restingBaseKcal}
            activeKcal={b.activeKcal}
            targetNetKcal={b.targetNetKcal}
            workoutKcal={breakdown?.workoutKcal ?? 0}
            activityKcal={breakdown?.activityKcal ?? 0}
            stepsKcal={breakdown?.stepsKcal ?? 0}
          />

          {showInfo && <EnergyDetail data={data!} />}
        </div>
      )}

      {b == null && data != null && data.missingProfileFields.length > 0 && (
        <p className="mt-3.5 border-t border-border/50 pt-3 text-sm text-muted-foreground">
          Add your {data.missingProfileFields.join(', ')} in Profile to see calories in vs out.
        </p>
      )}
    </div>
  )
})

/**
 * One macro: its share of the logged calories, its grams, its name — artboard 1's column.
 *
 * The target rides on the grams line rather than becoming a fourth line. The drawing has three and
 * dropping the target would leave the day screen with nowhere to see "108 of 150 g protein", which
 * on a training app is a number people check daily; Profile is where it is *set*, not tracked.
 *
 * Scalar props, deliberately: this renders inside a `.map`-free but memo-wrapped parent, and an
 * object prop here would be a fresh identity every render (`meal-macro-bars.tsx` is the reference).
 */
function MacroColumn({ label, grams, target, share, color }: {
  label: string; grams: number; target: number | null; share: number; color: string
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-px">
      {/* Colour is the only thing tying a column to its arc segment, so the share is said in words
          beside it rather than left to the colour alone. */}
      <span className="text-[11.5px] font-semibold tabular-nums" style={{ color }}>
        {Math.round(share * 100)}%
      </span>
      <span className="text-[15px] font-bold tabular-nums">
        {Math.round(grams)}
        {target != null && (
          <span className="ml-0.5 text-[10.5px] font-normal text-muted-foreground">/{Math.round(target)}</span>
        )}
        <span className="text-[10.5px] font-normal text-muted-foreground"> g</span>
      </span>
      <span className="text-[10.5px] text-muted-foreground">{label}</span>
    </div>
  )
}

/** Eaten / burned / net, the maintenance line, and what the zone means — unchanged from the card
 *  this replaces, but behind the toggle rather than always on: artboard 1 has none of it. */
function EnergyDetail({ data }: { data: EnergyBalanceResponse }) {
  const b = data.balance!
  const m = data.maintenance
  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Eaten" value={b.intakeKcal} />
        <Stat label="Burned" value={b.expenditureKcal} />
        <Stat label="Net" value={b.netKcal} signed />
      </div>

      {m != null && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {m.source === 'calibrated' ? (
            <>
              Your measured maintenance is <span className="font-semibold tabular-nums text-foreground">{m.kcal.toLocaleString()} kcal</span>
              {' '}({m.confidence} confidence, {m.daysLogged} of {m.daysInWindow} days logged)
              {m.weightRateKgPerWeek != null && m.weightRateKgPerWeek !== 0 && (
                <> — trending {m.weightRateKgPerWeek > 0 ? '+' : ''}{m.weightRateKgPerWeek} kg/week</>
              )}.
            </>
          ) : (
            <>Estimated maintenance <span className="font-semibold tabular-nums text-foreground">{m.kcal.toLocaleString()} kcal</span> — {m.gapMessage}.</>
          )}
        </p>
      )}

      <div className="space-y-2 rounded-xl bg-muted/50 p-3">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Calories out</span> = your resting burn
          ({b.restingBaseKcal.toLocaleString()} kcal) plus measured movement ({b.activeKcal.toLocaleString()} kcal
          from workouts, activities, and steps above {STEP_BASELINE.toLocaleString()}/day).
        </p>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">On target</span> means your net
          ({b.netKcal >= 0 ? '+' : ''}{b.netKcal.toLocaleString()}) is within 150 kcal of the
          {' '}{b.targetNetKcal >= 0 ? '+' : ''}{b.targetNetKcal.toLocaleString()} kcal/day your goal calls for.
          Sustaining today&apos;s net works out to {b.projectedWeeklyKg >= 0 ? '+' : ''}{b.projectedWeeklyKg} kg/week.
        </p>
        {m?.source === 'calibrated' && (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Maintenance is measured from your own logged intake against your weight trend, not a
            formula — it re-calibrates as you log.
          </p>
        )}
      </div>
    </div>
  )
}

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
