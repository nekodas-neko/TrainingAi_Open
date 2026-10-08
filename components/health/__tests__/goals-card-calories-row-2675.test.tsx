// @vitest-environment jsdom
/**
 * Issue 2675 — the Goals card's Calories row follows the day's budget, not a stored calorie goal.
 * Anyone without their own target has a derived budget, and the row used to vanish for them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'

const h = vi.hoisted(() => ({ data: null as unknown }))
vi.mock('@/app/health/hooks/use-health-calcs', () => ({ useEnergyBalanceToday: () => h.data }))
vi.mock('@/lib/user/preferences-sync', () => ({ usePersistedPreference: () => {} }))

import { GoalsProgressCard } from '../goals-progress-card'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function balance(ownTargetKcal: number | null) {
  return {
    intakeKcal: 910, restingBaseKcal: 1200, activeKcal: 237, targetNetKcal: -232,
    restingRateKcal: 1304, deficitKcal: 232, stepCreditKcal: 0, ownTargetKcal,
    remainingKcal: 0, zoneColor: 'green',
  }
}

const noGoals = {
  stepsGoal: null, calorieGoal: null, calorieGoalType: null, waterGoalMl: null, sleepGoalHours: null,
}
const meta = { steps: 0, calories: 910, waterMl: 0 }

let container: HTMLDivElement
let root: Root | null = null
async function mount(userGoals: unknown = noGoals) {
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(GoalsProgressCard, {
      metaToday: meta, weekToDate: null, userGoals: userGoals, progressSummary: null,
    } as never))
  })
}
const text = () => container.textContent ?? ''

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  localStorage.clear()
})
afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  container.remove()
})

describe('issue 2675 — Calories row on the Goals card', () => {
  it('shows with the derived budget when no calorie goal is stored', async () => {
    const b = balance(null)
    h.data = { balance: b }
    await mount()
    expect(text()).toContain('Calories')
    expect(text()).toContain(`/ ${budgetProvenance(b).total.toLocaleString('en-US')}`)
  })

  it('shows the own target as the target when one is set', async () => {
    const b = balance(2100)
    h.data = { balance: b }
    await mount({ ...noGoals, calorieGoal: 2100, calorieGoalType: 'own' })
    expect(budgetProvenance(b).total).toBe(2100)
    expect(text()).toContain('Calories')
    expect(text()).toContain('/ 2,100')
  })

  it('has no row, and no card, when the budget is null', async () => {
    h.data = null
    await mount()
    expect(text()).not.toContain('Calories')
    expect(container.innerHTML).toBe('')
  })
})
