// @vitest-environment jsdom
/**
 * Issue 2072 (owner's pick 2026-10-05: "striped"). An assumed plan meal is part of the day's total,
 * drawn striped and named in one line, never coloured as food:
 *   · the bar's striped tail is the estimate's share, on the bar's own scale;
 *   · the Nutrition ring's centre counts logged food plus the estimate (so it matches the payload's
 *     `intakeKcal`), the macro arcs stop at logged food, and the striped arc runs on from there;
 *   · the line says "incl. N estimated · lunch", and its Confirm tap is wired;
 *   · nothing changes on a day with no estimate.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { barProgress } from '@trainingai/shared/nutrition/calorie-balance'
import { countedEstimates, countedEstimateKcal } from '@trainingai/shared/nutrition/meal-estimate'
import { CalorieProgressBar } from '../calorie-progress-bar'
import { EnergyCard } from '../energy-card'
import { EstimatedKcalLine } from '../estimated-kcal'
import { energyDaySummary } from '@/components/health/day-detail/energy-summary'
import type { EnergyBalanceResponse } from '@/app/api/nutrition/energy-balance/route'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null
function render(el: ReturnType<typeof createElement>) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(el))
  return host
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })

describe('the striped bar (issue 2072)', () => {
  it('stripes exactly the estimate\'s share of the fill', () => {
    const el = render(createElement(CalorieProgressBar, { intakeKcal: 1300, budgetKcal: 1618, estimatedKcal: 480 }))
    const bar = el.querySelector('[data-calorie-bar]')!
    const full = barProgress({ intakeKcal: 1300, budgetKcal: 1618 }).fillPct * 100
    const logged = barProgress({ intakeKcal: 820, budgetKcal: 1618 }).fillPct * 100
    expect(Number(bar.getAttribute('data-fill-pct'))).toBeCloseTo(full, 1)
    expect(Number(bar.getAttribute('data-estimated-pct'))).toBeCloseTo(full - logged, 1)
  })

  it('draws no stripe on a day with no estimate', () => {
    const el = render(createElement(CalorieProgressBar, { intakeKcal: 1300, budgetKcal: 1618 }))
    expect(el.querySelector('[data-calorie-bar]')!.getAttribute('data-estimated-pct')).toBe('0.00')
  })
})

describe('the Nutrition ring (issue 2072)', () => {
  const base = {
    data: null, isToday: true, calories: 820, proteinG: 40, carbsG: 80, fatG: 30,
    goalCalories: 1618, earnedKcal: 0, targets: null,
  }

  it('counts the estimate in the centre and stripes it after the logged arc', () => {
    const onConfirm = vi.fn()
    const el = render(createElement(EnergyCard, { ...base, estimatedKcal: 480, estimatedMeals: 'lunch', onConfirmEstimate: onConfirm }))
    expect(el.textContent).toContain('1,300')
    expect(el.textContent).toContain('318')            // 1,618 − 1,300 left, with no payload
    const arc = el.querySelector('[data-estimated-arc]')!.getAttribute('data-estimated-arc')!
    const [from, to] = arc.split('-').map(Number)
    expect(from).toBeCloseTo((820 / 1618) * 360, 0)
    expect(to).toBeCloseTo((1300 / 1618) * 360, 0)
    expect(el.textContent).toContain('incl. 480 estimated · lunch')
    act(() => (el.querySelector('button') as HTMLButtonElement).click())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('is unchanged on a day with no estimate', () => {
    const el = render(createElement(EnergyCard, { ...base }))
    expect(el.textContent).toContain('820')
    expect(el.querySelector('[data-estimated-arc]')).toBeNull()
    expect(el.querySelector('[data-estimated-kcal]')).toBeNull()
  })
})

describe('the estimate line and day detail (issue 2072)', () => {
  it('names the estimate without a button where there is nowhere to send the tap', () => {
    const el = render(createElement(EstimatedKcalLine, { estimatedKcal: 480 }))
    expect(el.textContent).toBe('incl. 480 estimated')
    expect(el.querySelector('button')).toBeNull()
  })

  it('carries the payload\'s estimate into the day screen\'s summary', () => {
    const energy = {
      date: '2026-10-11',
      balance: { intakeKcal: 1300, estimatedKcal: 480, expenditureKcal: 2100, netKcal: -800, restingBaseKcal: 1500 },
      activeBreakdown: { workoutKcal: 0, activityKcal: 0, stepsKcal: 200, workoutKcalBySession: [] },
    } as unknown as EnergyBalanceResponse
    expect(energyDaySummary(energy)?.estimatedKcal).toBe(480)
  })
})

describe('countedEstimates (issue 2072)', () => {
  it('lists each counted estimate with its slot, and sums to countedEstimateKcal', () => {
    const mealTypes = [
      { id: 'mt-l', name: 'Lunch', startHour: 11, endHour: 14 },
      { id: 'mt-s', name: 'Snack', startHour: 15, endHour: 17 },
    ] as never
    const input = {
      answers: [
        { planMealId: 'pm-1', answer: 'estimated', estCalories: 480 },
        { planMealId: 'pm-2', answer: 'estimated', estCalories: 200 },
        { planMealId: 'pm-3', answer: 'no', estCalories: null },
      ],
      planMeals: [
        { id: 'pm-1', mealTypeId: 'mt-l', suggestedTime: '12:30' },
        { id: 'pm-2', mealTypeId: 'mt-s', suggestedTime: '15:30' },
        { id: 'pm-3', mealTypeId: 'mt-s', suggestedTime: '16:00' },
      ],
      mealTypes,
      loggedMealTypeIds: new Set<string>(['mt-s']),
    }
    expect(countedEstimates(input)).toEqual([{ planMealId: 'pm-1', mealTypeId: 'mt-l', kcal: 480 }])
    expect(countedEstimateKcal(input)).toBe(480)
  })
})
